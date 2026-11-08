/*
 * SubLedger logic. Pure functions with no DOM access, so the same file
 * runs in the app and in the Node tests.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Logic = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CYCLES = {
    weekly: { label: 'Weekly', months: 0 },
    monthly: { label: 'Monthly', months: 1 },
    quarterly: { label: 'Every 3 months', months: 3 },
    yearly: { label: 'Yearly', months: 12 }
  };

  var CATEGORIES = [
    'Streaming', 'Music', 'Software', 'Games', 'Cloud storage',
    'News', 'Fitness', 'Shopping', 'Other'
  ];

  var MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  var MAX_CENTS = 1000000000;

  function has(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  function pad(n) {
    return (n < 10 ? '0' : '') + n;
  }

  /* m is 1 to 12 */
  function daysInMonth(y, m) {
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
  }

  /* Dates are plain "YYYY-MM-DD" strings so time zones never shift them. */
  function parseDate(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof s === 'string' ? s : '');
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (y < 1970 || y > 2200 || mo < 1 || mo > 12) return null;
    if (d < 1 || d > daysInMonth(y, mo)) return null;
    return { y: y, m: mo, d: d };
  }

  function formatParts(p) {
    return p.y + '-' + pad(p.m) + '-' + pad(p.d);
  }

  function dayNumber(p) {
    return Math.round(Date.UTC(p.y, p.m - 1, p.d) / 86400000);
  }

  function fromDayNumber(n) {
    var dt = new Date(n * 86400000);
    return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
  }

  function compare(a, b) {
    return (a.y - b.y) || (a.m - b.m) || (a.d - b.d);
  }

  /* Keeps the original day of month where it exists, clamps where it does not. */
  function addMonths(p, n) {
    var total = p.y * 12 + (p.m - 1) + n;
    var y = Math.floor(total / 12);
    var m = (total % 12) + 1;
    return { y: y, m: m, d: Math.min(p.d, daysInMonth(y, m)) };
  }

  function todayString(now) {
    var d = now || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  /* Whole days from one date string to another. Negative if "to" is earlier. */
  function daysBetween(fromStr, toStr) {
    var a = parseDate(fromStr);
    var b = parseDate(toStr);
    if (!a || !b) return null;
    return dayNumber(b) - dayNumber(a);
  }

  /*
   * First renewal on or after today, counted forward from the saved date.
   * A renewal that falls on today counts as today.
   */
  function nextRenewal(startStr, cycle, todayStr) {
    var a = parseDate(startStr);
    var t = parseDate(todayStr);
    if (!a || !t || !has(CYCLES, cycle)) return null;
    if (compare(a, t) >= 0) return formatParts(a);

    var k;
    if (cycle === 'weekly') {
      k = Math.ceil((dayNumber(t) - dayNumber(a)) / 7);
      return formatParts(fromDayNumber(dayNumber(a) + k * 7));
    }

    var step = CYCLES[cycle].months;
    var monthsApart = (t.y - a.y) * 12 + (t.m - a.m);
    k = Math.max(0, Math.floor(monthsApart / step));
    var cand = addMonths(a, k * step);
    while (compare(cand, t) < 0) {
      k++;
      cand = addMonths(a, k * step);
    }
    return formatParts(cand);
  }

  function formatDate(dateStr, todayStr) {
    var p = parseDate(dateStr);
    var t = parseDate(todayStr);
    if (!p) return '';
    var text = MONTH_NAMES[p.m - 1] + ' ' + p.d;
    if (t && p.y !== t.y) text += ', ' + p.y;
    return text;
  }

  function describeDays(n) {
    if (n === 0) return 'today';
    if (n === 1) return 'tomorrow';
    return 'in ' + n + ' days';
  }

  /* Returns whole cents or null. Accepts 9.99, 9,99 and 10. */
  function parseMoney(text) {
    if (typeof text !== 'string') return null;
    var t = text.replace(/\s+/g, '');
    if (!/^\d{1,9}([.,]\d{1,2})?$/.test(t)) return null;
    var cents = Math.round(parseFloat(t.replace(',', '.')) * 100);
    return cents <= MAX_CENTS ? cents : null;
  }

  function formatMoney(cents, symbol) {
    var neg = cents < 0;
    var abs = Math.abs(Math.round(cents));
    var whole = Math.floor(abs / 100);
    var frac = abs % 100;
    var grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (neg ? '-' : '') + (symbol || '') + grouped + '.' + pad(frac);
  }

  /* What one subscription costs per month, as a float. */
  function monthlyCents(sub) {
    var c = sub.cents;
    switch (sub.cycle) {
      case 'weekly': return c * 52 / 12;
      case 'monthly': return c;
      case 'quarterly': return c / 3;
      case 'yearly': return c / 12;
    }
    return 0;
  }

  function totals(subs) {
    var monthly = 0;
    var active = 0;
    var byCategory = {};
    subs.forEach(function (s) {
      if (!s.active) return;
      var m = monthlyCents(s);
      monthly += m;
      active++;
      var cat = s.category || 'Other';
      byCategory[cat] = (byCategory[cat] || 0) + m;
    });
    Object.keys(byCategory).forEach(function (k) {
      byCategory[k] = Math.round(byCategory[k]);
    });
    return {
      monthly: Math.round(monthly),
      yearly: Math.round(monthly * 12),
      active: active,
      byCategory: byCategory
    };
  }

  /* Actual charges (not monthly averages) that land within the next N days. */
  function dueWithin(subs, todayStr, days) {
    var cents = 0;
    var count = 0;
    subs.forEach(function (s) {
      if (!s.active) return;
      var next = nextRenewal(s.start, s.cycle, todayStr);
      var n = next ? daysBetween(todayStr, next) : null;
      if (n !== null && n <= days) {
        cents += s.cents;
        count++;
      }
    });
    return { cents: cents, count: count };
  }

  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /* Returns a clean subscription or null if the input cannot be used. */
  function sanitizeSub(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 60) : '';
    var cents = typeof raw.cents === 'number' && isFinite(raw.cents) ? Math.round(raw.cents) : NaN;
    var start = typeof raw.start === 'string' ? raw.start : '';
    if (!name || !(cents >= 0 && cents <= MAX_CENTS) || !parseDate(start)) return null;
    return {
      id: typeof raw.id === 'string' && raw.id && raw.id.length <= 40 ? raw.id : newId(),
      name: name,
      cents: cents,
      cycle: typeof raw.cycle === 'string' && has(CYCLES, raw.cycle) ? raw.cycle : 'monthly',
      start: start,
      category: CATEGORIES.indexOf(raw.category) >= 0 ? raw.category : 'Other',
      note: typeof raw.note === 'string' ? raw.note.trim().slice(0, 200) : '',
      active: raw.active !== false
    };
  }

  /*
   * Accepts a backup object or a bare array. Returns
   * { subs, skipped, currency } or null if it is not a backup at all.
   */
  function sanitizeImport(raw) {
    var isArray = Array.isArray(raw);
    var list = isArray ? raw : (raw && Array.isArray(raw.subscriptions) ? raw.subscriptions : null);
    if (!list) return null;
    var subs = [];
    var seen = Object.create(null);
    var skipped = 0;
    list.slice(0, 2000).forEach(function (item) {
      var s = sanitizeSub(item);
      if (!s) {
        skipped++;
        return;
      }
      while (seen[s.id]) s.id = newId();
      seen[s.id] = true;
      subs.push(s);
    });
    skipped += Math.max(0, list.length - 2000);
    var currency = !isArray && raw && typeof raw.currency === 'string' ? raw.currency.trim().slice(0, 3) : '';
    return { subs: subs, skipped: skipped, currency: currency || '$' };
  }

  /* Imported items replace current ones with the same id, the rest are added. */
  function mergeSubs(current, incoming) {
    var result = current.slice();
    incoming.forEach(function (s) {
      for (var i = 0; i < result.length; i++) {
        if (result[i].id === s.id) {
          result[i] = s;
          return;
        }
      }
      result.push(s);
    });
    return result;
  }

  function buildExport(state) {
    return JSON.stringify({
      app: 'SubLedger',
      version: 1,
      exportedAt: new Date().toISOString(),
      currency: state.currency,
      subscriptions: state.subs
    }, null, 2);
  }

  return {
    CYCLES: CYCLES,
    CATEGORIES: CATEGORIES,
    parseDate: parseDate,
    todayString: todayString,
    daysBetween: daysBetween,
    nextRenewal: nextRenewal,
    formatDate: formatDate,
    describeDays: describeDays,
    parseMoney: parseMoney,
    formatMoney: formatMoney,
    monthlyCents: monthlyCents,
    totals: totals,
    dueWithin: dueWithin,
    newId: newId,
    sanitizeSub: sanitizeSub,
    sanitizeImport: sanitizeImport,
    mergeSubs: mergeSubs,
    buildExport: buildExport
  };
});
