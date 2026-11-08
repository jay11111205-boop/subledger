# SubLedger

A subscription tracker for Android that runs entirely on your phone. No account, no ads, no analytics, and no internet permission, so it cannot send your data anywhere.

iOS version coming soon.

## What it does

* Keep every subscription in one list with its price, billing cycle, renewal date, category and a note
* See your total cost per month and per year
* See what renews in the next 7 days, and how much it adds up to
* Break the monthly cost down by category
* Pause a subscription without deleting it
* Save a backup file and restore from it, including on a new phone
* Renewal dates move forward on their own, and a renewal on the 31st lands on the last day of shorter months

## Install

1. Open the Releases page of this repository and download SubLedger.apk.
2. Open the file on your phone. Android will ask you to allow installs from your browser or files app. Allow it for this one install.
3. Open SubLedger.

Needs Android 8.0 or newer.

The APK is signed with a key made on GitHub's build servers unless the maintainer has added a permanent signing key. If you install a build with a different signature, uninstall the old one first and export a backup before you do.

## Privacy

The app declares no permissions at all. Without the internet permission Android will not let it open a network connection. Read PRIVACY.md for the full policy. To check the APK yourself:

```
aapt dump permissions SubLedger.apk
```

## Build it yourself

The easy way: fork this repository, push a change, and open the Actions tab. The build produces SubLedger.apk as a downloadable artifact. Push a tag that starts with v, for example v1.0.1, and the build also publishes a release.

On your own machine you need Java 17, the Android SDK and Gradle 8.9:

```
gradle :app:assembleRelease
```

The APK lands in app/build/outputs/apk/release.

### Permanent signing key (optional)

Create a key once, then add four repository secrets so every release is signed the same way and updates install over each other.

```
keytool -genkeypair -v -keystore release.jks -alias subledger -keyalg RSA -keysize 2048 -validity 10000
base64 -i release.jks | pbcopy
```

Secrets to add under Settings, Secrets and variables, Actions: KEYSTORE_BASE64 (the base64 text), KEYSTORE_PASSWORD, KEY_ALIAS and KEY_PASSWORD. Never commit the keystore file. Keep a copy somewhere safe, because losing it means you cannot update installed copies.

## Try the interface in a browser

Open app/src/main/assets/index.html in any desktop browser. The backup buttons download and upload files instead of using the Android file picker.

## Tests

```
node --test tests/*.test.js
```

The tests cover the date, money, totals and import logic.

## How it is built

A small native Android shell (one Java file) around a WebView that loads plain HTML, CSS and JavaScript from the app's own assets. There are no frameworks and no dependencies. The shell only adds two things a web page cannot do alone: saving and opening backup files through the system file picker, and handling the Back button. Because the interface is ordinary web code, it can be reused for an iOS version.

```
app/src/main/assets/       the interface (logic.js, app.js, style.css, index.html)
app/src/main/java/         the Android shell
tests/                     tests for logic.js
.github/workflows/         the build that produces the APK
```

## Roadmap

* iOS version (coming soon)
* Dark mode
* Optional renewal reminders

## Disclaimer

SubLedger is a personal organizing tool and is not financial advice. It does not connect to any bank, store or subscription service. Every price and date is what you typed in, so check your real statements for what you are actually charged. The software is provided as is, without warranty.

## License

MIT. See LICENSE.

Android is a trademark of Google LLC. iOS is a trademark or registered trademark of Cisco in the U.S. and other countries and is used under license by Apple Inc. This project is not affiliated with or endorsed by Google or Apple.
