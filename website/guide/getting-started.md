# Getting started

Rate Limit Tracker for X runs in Chrome (and other Chromium browsers like Edge and Brave), Firefox and Safari. It only works on `x.com`.

## Install from source

The extension isn't in the stores yet, so for now you build it yourself. You need Node.js 22 or newer.

```sh
git clone https://github.com/toneflix/x-ratelimit.git
cd x-ratelimit
npm install
npm run build        # writes dist/chrome, dist/firefox and dist/safari
```

### Chrome, Edge, Brave

1. Open `chrome://extensions` (or `edge://extensions`, `brave://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and choose the `dist/chrome` folder.

### Firefox

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on** and choose `dist/firefox/manifest.json`.
3. Open the extension's popup and click **Grant x.com access**. Firefox doesn't grant access to sites automatically.

### Safari

1. Run `npm run safari`. This builds the extension and wraps it in an Xcode project.
2. Open `dist/safari-xcode/Rate Limit Tracker for X/Rate Limit Tracker for X.xcodeproj` and run the macOS target.
3. In Safari, open **Settings → Advanced** and turn on **Show features for web developers**. Then choose **Develop → Allow Unsigned Extensions**.
4. Turn on the extension in **Settings → Extensions** and allow it on `x.com`.

## First run

1. Reload any x.com tabs you already had open, so the extension can start watching them.
2. Browse X as usual. Every response from X's API that includes rate-limit information is recorded.
3. Click the toolbar icon to open the popup.

The badge on the toolbar icon shows the lowest remaining count among your tracked actions. It turns red with a **!** for 15 minutes after you hit a limit.

Next: [Using the popup](./using).
