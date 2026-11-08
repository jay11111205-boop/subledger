/*
 * SubLedger interface. Plain JavaScript, no framework.
 * Data lives in localStorage inside the app's private WebView storage.
 */
(function () {
  'use strict';

  var L = window.Logic;
  var STORAGE_KEY = 'subledger.v1';
  var SORTS = ['date', 'cost', 'name'];

  var app = document.getElementById('app');
  var statusEl = document.getElementById('status');
  var bridge = window.Android || null;

  var state = loadState();
  var route = { name: 'list' };
  var pendingImport = null;
  var statusTimer = null;

  /* ---------- storage ---------- */

  function loadState() {
    var fallback = { currency: '$', sort: 'date', subs: [] };
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return fallback;
      var data = JSON.parse(raw);
      var clean = L.sanitizeImport(data);
      if (!clean) return fallback;
      return {
        currency: clean.currency,
        sort: SORTS.indexOf(data.sort) >= 0 ? data.sort : 'date',
        subs: clean.subs
      };
    } catch (e) {
      return fallback;
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        currency: state.currency,
        sort: state.sort,
        subscriptions: state.subs
      }));
    } catch (e) {
      say('Could not save. Phone storage may be full.');
    }
  }

  /* ---------- small helpers ---------- */

  function say(message) {
    statusEl.textContent = message;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(function () { statusEl.textContent = ''; }, 4000);
  }

  function append(parent, child) {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) {
      child.forEach(function (c) { append(parent, c); });
    } else if (typeof child === 'string' || typeof child === 'number') {
      parent.appendChild(document.createTextNode(String(child)));
    } else {
      parent.appendChild(child);
    }
  }

  /* h('div', { class: 'x', onclick: fn }, child, child) */
  function h(tag, props) {
    var el = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
        else if (v === true) el.setAttribute(k, '');
        else if (v !== false && v !== null && v !== undefined) el.setAttribute(k, v);
      });
    }
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }

  /* A button that needs two taps within four seconds. Replaces confirm(). */
  function confirmButton(label, armedLabel, action) {
    var armed = false;
    var timer = null;
    var b = h('button', { type: 'button', class: 'danger', text: label });
    b.addEventListener('click', function () {
      if (!armed) {
        armed = true;
        b.textContent = armedLabel;
        timer = setTimeout(function () {
          armed = false;
          b.textContent = label;
        }, 4000);
        return;
      }
      clearTimeout(timer);
      action();
    });
    return b;
  }

  function field(label, input, hint) {
    return h('label', { class: 'field' },
      h('span', { class: 'label', text: label }),
      input,
      hint ? h('span', { class: 'hint', text: hint }) : null);
  }

  function money(cents) {
    return L.formatMoney(cents, state.currency);
  }

  function go(name, extra) {
    route = { name: name, id: extra || null };
    render();
    window.scrollTo(0, 0);
  }

  /* ---------- list view ---------- */

  function sorter(mode) {
    return function (a, b) {
      if (a.s.active !== b.s.active) return a.s.active ? -1 : 1;
      if (mode === 'cost') return (b.monthly - a.monthly) || a.s.name.localeCompare(b.s.name);
      if (mode === 'name') return a.s.name.localeCompare(b.s.name);
      return (a.days - b.days) || a.s.name.localeCompare(b.s.name);
    };
  }

  function viewList() {
    var today = L.todayString();
    var rows = state.subs.map(function (s) {
      var next = L.nextRenewal(s.start, s.cycle, today);
      return { s: s, next: next, days: L.daysBetween(today, next), monthly: L.monthlyCents(s) };
    });
    rows.sort(sorter(state.sort));

    var t = L.totals(state.subs);
    var due = L.dueWithin(state.subs, today, 7);
    var paused = state.subs.length - t.active;
    var out = [];

    out.push(h('section', { class: 'summary' },
      h('div', null,
        h('div', { class: 'label', text: 'Per month' }),
        h('div', { class: 'big', text: money(t.monthly) })),
      h('div', null,
        h('div', { class: 'label', text: 'Per year' }),
        h('div', { class: 'big', text: money(t.yearly) }))));

    var meta = t.active + ' active' + (paused ? ', ' + paused + ' paused' : '');
    if (due.count) {
      meta += '. Next 7 days: ' + money(due.cents) + ' across ' + due.count +
        (due.count === 1 ? ' renewal' : ' renewals');
    }
    out.push(h('p', { class: 'meta', text: meta }));

    if (!state.subs.length) {
      out.push(h('div', { class: 'empty' },
        h('p', { text: 'No subscriptions yet.' }),
        h('p', { text: 'Add your first one below. Everything stays on this phone.' })));
      return out;
    }

    var sortSelect = h('select', {
      'aria-label': 'Sort order',
      onchange: function (e) {
        state.sort = e.target.value;
        saveState();
        render();
      }
    },
      h('option', { value: 'date', selected: state.sort === 'date', text: 'Next renewal' }),
      h('option', { value: 'cost', selected: state.sort === 'cost', text: 'Highest cost' }),
      h('option', { value: 'name', selected: state.sort === 'name', text: 'Name' }));
    out.push(h('div', { class: 'sortline' }, h('span', { text: 'Sort by' }), sortSelect));

    rows.forEach(function (r) {
      var s = r.s;
      var soon = s.active && r.days <= 7;
      var cycle = L.CYCLES[s.cycle].label;
      var line2 = s.active
        ? cycle + ', renews ' + L.formatDate(r.next, today) + ' (' + L.describeDays(r.days) + ')'
        : cycle + ', paused';
      out.push(h('button', {
        type: 'button',
        class: 'row' + (soon ? ' soon' : '') + (s.active ? '' : ' paused'),
        onclick: function () { go('form', s.id); }
      },
        h('span', { class: 'line1' },
          h('span', { text: s.name }),
          h('span', { text: money(s.cents) })),
        h('span', { class: 'line2', text: line2 }),
        s.note ? h('span', { class: 'line3', text: s.note }) : null));
    });

    var cats = Object.keys(t.byCategory);
    if (cats.length > 1) {
      cats.sort(function (a, b) { return t.byCategory[b] - t.byCategory[a]; });
      out.push(h('h2', { text: 'By category, per month' }));
      cats.forEach(function (c) {
        out.push(h('div', { class: 'cat' },
          h('span', { text: c }),
          h('span', { text: money(t.byCategory[c]) })));
      });
    }

    return out;
  }

  /* ---------- add and edit ---------- */

  function viewForm(id) {
    var editing = null;
    state.subs.forEach(function (s) { if (s.id === id) editing = s; });

    var nameIn = h('input', {
      type: 'text', maxlength: '60', autocomplete: 'off', placeholder: 'Netflix',
      value: editing ? editing.name : ''
    });
    var priceIn = h('input', {
      type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '9.99',
      value: editing ? (editing.cents / 100).toFixed(2) : ''
    });
    var cycleIn = h('select', null, Object.keys(L.CYCLES).map(function (k) {
      return h('option', {
        value: k, text: L.CYCLES[k].label,
        selected: (editing ? editing.cycle : 'monthly') === k
      });
    }));
    var startIn = h('input', {
      type: 'date', value: editing ? editing.start : L.todayString()
    });
    var catIn = h('select', null, L.CATEGORIES.map(function (c) {
      return h('option', {
        value: c, text: c,
        selected: (editing ? editing.category : 'Other') === c
      });
    }));
    var noteIn = h('input', {
      type: 'text', maxlength: '200', autocomplete: 'off', placeholder: 'Optional',
      value: editing ? editing.note : ''
    });
    var activeIn = h('input', { type: 'checkbox', checked: editing ? editing.active : true });
    var errorEl = h('p', { class: 'error', role: 'alert' });

    function fail(message) {
      errorEl.textContent = message;
    }

    function save() {
      var name = nameIn.value.trim();
      var cents = L.parseMoney(priceIn.value);
      if (!name) return fail('Enter a name.');
      if (cents === null) return fail('Enter a price like 9.99.');
      if (!L.parseDate(startIn.value)) return fail('Pick a renewal date.');

      var sub = {
        id: editing ? editing.id : L.newId(),
        name: name,
        cents: cents,
        cycle: cycleIn.value,
        start: startIn.value,
        category: catIn.value,
        note: noteIn.value.trim().slice(0, 200),
        active: activeIn.checked
      };
      if (editing) {
        state.subs = state.subs.map(function (s) { return s.id === sub.id ? sub : s; });
      } else {
        state.subs.push(sub);
      }
      saveState();
      say(editing ? 'Saved.' : 'Added.');
      go('list');
    }

    var actions = h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'primary', text: 'Save', onclick: save }),
      h('button', { type: 'button', text: 'Cancel', onclick: function () { go('list'); } }));
    if (editing) {
      actions.appendChild(confirmButton('Delete', 'Tap again to delete', function () {
        state.subs = state.subs.filter(function (s) { return s.id !== editing.id; });
        saveState();
        say('Deleted.');
        go('list');
      }));
    }

    return [
      field('Name', nameIn),
      field('Price', priceIn, 'What you are charged each time, in ' + state.currency + '.'),
      field('Billed', cycleIn),
      field('Renewal date', startIn, 'Any date works. A date in the past rolls forward on its own.'),
      field('Category', catIn),
      field('Note', noteIn),
      h('label', { class: 'check' }, activeIn, h('span', { text: 'Active. Untick to pause without deleting.' })),
      errorEl,
      actions
    ];
  }

  /* ---------- settings, backup, import ---------- */

  function downloadInBrowser(text, filename) {
    var url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function exportBackup() {
    var json = L.buildExport(state);
    var filename = 'subledger_backup_' + L.todayString().replace(/-/g, '_') + '.json';
    if (bridge && bridge.exportBackup) bridge.exportBackup(json, filename);
    else downloadInBrowser(json, filename);
  }

  function importBackup() {
    if (bridge && bridge.importBackup) {
      bridge.importBackup();
      return;
    }
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = function () {
      var file = input.files && input.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () { window.onImportedText(String(reader.result)); };
      reader.readAsText(file);
    };
    input.click();
  }

  /* Called by the Android shell, or by the browser fallback above. */
  window.onImportedText = function (text) {
    var clean = null;
    try {
      clean = L.sanitizeImport(JSON.parse(text));
    } catch (e) {
      clean = null;
    }
    if (!clean || (!clean.subs.length && !clean.skipped)) {
      say('That file is not a SubLedger backup.');
      return;
    }
    pendingImport = clean;
    go('import');
  };

  window.onNativeMessage = function (message) {
    say(String(message));
  };

  function viewSettings() {
    var currencyIn = h('input', {
      type: 'text', maxlength: '3', autocomplete: 'off', value: state.currency,
      onchange: function (e) {
        state.currency = e.target.value.trim() || '$';
        e.target.value = state.currency;
        saveState();
        say('Currency symbol saved.');
      }
    });
    var version = bridge && bridge.getVersion ? bridge.getVersion() : '';

    return [
      field('Currency symbol', currencyIn, 'Shown in front of prices. Examples: $, EUR, GBP.'),

      h('h2', { text: 'Backup' }),
      h('p', { text: 'Your data lives only on this phone. Save a backup file now and then so you can restore it after a reinstall or on a new phone.' }),
      h('div', { class: 'actions' },
        h('button', { type: 'button', text: 'Export backup', onclick: exportBackup }),
        h('button', { type: 'button', text: 'Import backup', onclick: importBackup })),

      h('h2', { text: 'Erase' }),
      h('div', { class: 'actions' },
        confirmButton('Delete all data', 'Tap again to erase everything', function () {
          state.subs = [];
          saveState();
          say('All data deleted.');
          go('list');
        })),

      h('h2', { text: 'About' }),
      h('p', { class: 'small', text: 'SubLedger' + (version ? ' ' + version : '') }),
      h('p', { class: 'small', text: 'Everything stays on this device. The app has no internet permission, so it cannot send your data anywhere.' }),
      h('p', { class: 'small', text: 'iOS version coming soon.' }),
      h('p', { class: 'small', text: 'Not financial advice. Prices and dates are only what you type in.' }),
      h('p', { class: 'small', text: 'Open source under the MIT license. Source: github.com/jay11111205-boop/subledger' })
    ];
  }

  function viewImport() {
    if (!pendingImport) return [h('p', { text: 'Nothing to import.' })];
    var p = pendingImport;
    var msg = 'Found ' + p.subs.length + (p.subs.length === 1 ? ' subscription' : ' subscriptions') + ' in the file.';
    if (p.skipped) msg += ' ' + p.skipped + ' could not be read and will be skipped.';

    return [
      h('p', { text: msg }),
      h('p', { text: 'You have ' + state.subs.length + ' saved now.' }),
      h('div', { class: 'actions' },
        h('button', {
          type: 'button', class: 'primary', text: 'Add to current data',
          onclick: function () {
            state.subs = L.mergeSubs(state.subs, p.subs);
            pendingImport = null;
            saveState();
            say('Imported.');
            go('list');
          }
        }),
        h('button', {
          type: 'button', text: 'Replace current data',
          onclick: function () {
            state.subs = p.subs;
            state.currency = p.currency;
            pendingImport = null;
            saveState();
            say('Imported.');
            go('list');
          }
        }),
        h('button', {
          type: 'button', text: 'Cancel',
          onclick: function () { pendingImport = null; go('settings'); }
        }))
    ];
  }

  /* ---------- shell ---------- */

  function render() {
    var title = 'SubLedger';
    var actionLabel = 'Back';
    var actionTarget = 'list';
    var body;

    if (route.name === 'form') {
      var exists = state.subs.some(function (s) { return s.id === route.id; });
      title = exists ? 'Edit subscription' : 'Add subscription';
      body = viewForm(route.id);
    } else if (route.name === 'settings') {
      title = 'Settings';
      body = viewSettings();
    } else if (route.name === 'import') {
      title = 'Import backup';
      actionTarget = 'settings';
      body = viewImport();
    } else {
      actionLabel = 'Settings';
      actionTarget = 'settings';
      body = viewList();
    }

    app.textContent = '';
    app.appendChild(h('header', { class: 'top' },
      h('h1', { text: title }),
      h('button', {
        type: 'button', text: actionLabel,
        onclick: function () {
          if (route.name === 'import') pendingImport = null;
          go(actionTarget);
        }
      })));
    append(app, body);

    if (route.name === 'list') {
      app.appendChild(h('div', { class: 'bar' },
        h('button', {
          type: 'button', class: 'primary', text: 'Add subscription',
          onclick: function () { go('form'); }
        })));
    }
  }

  /* The Android shell asks this when the back button is pressed. */
  window.appBack = function () {
    if (route.name === 'list') return false;
    if (route.name === 'import') {
      pendingImport = null;
      go('settings');
    } else {
      go('list');
    }
    return true;
  };

  render();
})();
