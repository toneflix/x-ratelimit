# Rate Limit Tracker for X

[![CI](https://github.com/toneflix/x-ratelimit/actions/workflows/ci.yml/badge.svg)](https://github.com/toneflix/x-ratelimit/actions/workflows/ci.yml)
[![Website](https://github.com/toneflix/x-ratelimit/actions/workflows/website.yml/badge.svg)](https://toneflix.github.io/x-ratelimit/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

[Website](https://toneflix.github.io/x-ratelimit/) · [Guide](https://toneflix.github.io/x-ratelimit/guide/getting-started) · [Privacy](https://toneflix.github.io/x-ratelimit/privacy)

An open source browser extension for Chrome, Firefox and Safari. It records X (Twitter) rate limits from the requests x.com already makes in your browser. It doesn't send any requests of its own and doesn't automate any actions.

For every response from `https://x.com/i/api/*` it records:

- the timestamp, method, status and URL path (the query string is dropped)
- headers whose names contain `rate`, `limit` or `retry`, such as `x-rate-limit-limit/remaining/reset` and `retry-after`
- for tracked actions, or any error status: the `errors[].code` and `message` from the JSON body

These actions are tracked by default:

| Action   | Request |
|----------|---------|
| Follow   | `POST /i/api/1.1/friendships/create.json` |
| Unfollow | `POST /i/api/1.1/friendships/destroy.json` |
| Post     | `POST /i/api/graphql/<id>/CreateTweet` |
| Like     | `POST /i/api/graphql/<id>/FavoriteTweet` |

GraphQL actions are matched by operation name, because the query ID (for example `wR5Z_lEibLvkew3tF9w-Sg`) changes whenever X deploys a new web client.

## The popup

- **Home** shows a card for each action you've put on the home screen: remaining / limit, reset countdown, 24h counts and the last limit hit. Below the cards are the "Does it return 429?" check and links to the other pages.
- **Endpoints** lists every X API endpoint that has sent rate-limit headers, sorted by how close each is to its limit. Click **Track** on any row to turn it into a tracked action.
- **Requests** is the log of captured responses. You can filter it to all requests, tracked actions only, or errors only.
- **Settings** (the gear icon):
  - **Actions:** for each action, choose whether it's tracked (recorded and checked for limit errors) and whether it appears on Home. Remove custom actions with ×.
  - **Add an action:** enter a GraphQL operation name (`CreateRetweet`), an `/i/api/…` path, or a full URL, plus an optional label.
  - **Recording:** turn off recording of non-tracked API calls, or turn off reading error codes from the page.
  - **Data:** export the history as JSON, or clear it.

## Privacy

- The only permissions are `webRequest`, `storage` and the host `https://x.com/*`.
- Request headers are never read, so cookies and `authorization` are never seen.
- Response headers are filtered against an allowlist. A second denylist (`cookie`, `auth`, `token`, `csrf`, `session`, …) always wins, so `set-cookie` is never stored.
- Response bodies are parsed only to pull out error codes. Nothing else from the body is kept.
- Everything stays in `storage.local`: the last 1000 tracked actions, the last 300 other API calls, and the latest limit for each endpoint. Turn off **Record all other X API calls** to keep only tracked actions.

## How it works

```
x.com page ─ fetch/XHR ─▶ hook.js (page world)
                              │ postMessage: status, limit headers, error codes
                          content.js ─ runtime.sendMessage ─┐
                                                            ▼
webRequest.onHeadersReceived ── status + headers ──▶ background.js ──▶ storage.local ──▶ popup
```

The two sources do different jobs:

- **webRequest** gives reliable status codes and headers, but it can't see response bodies.
- **The page hook** can see bodies. That matters because X often reports a limit through an error code instead of HTTP 429: `161` on a 403 for follows, `344` or `185` on a 200 for posts. Safari also relies mostly on the hook, because its MV3 webRequest doesn't reliably expose response headers.

When both sources report the same response within 5 seconds, it is stored as one record.

## Build

The extension is written in TypeScript. [tsdown](https://tsdown.dev) bundles each entry point into one self-contained IIFE per browser, `tsc` type-checks, and tests run on the sources through `tsx`.

```sh
npm install
cp .env.example .env   # optional: API keys and build settings, see the file
npm run check       # tsc type-check + unit and sandboxed runtime tests
npm run build       # dist/chrome, dist/firefox, dist/safari
npm run build:chrome   # one target (also :firefox, :safari)
npm run safari      # build + wrap dist/safari into an Xcode project at dist/safari-xcode
```

### Load it

- **Chrome / Edge / Brave:** open `chrome://extensions`, turn on Developer mode, click **Load unpacked**, and choose `dist/chrome`.
- **Firefox:** open `about:debugging#/runtime/this-firefox`, click **Load Temporary Add-on**, and choose `dist/firefox/manifest.json`. Firefox makes host access opt-in, so click **Grant x.com access** in the popup, or allow it under the extension's Permissions tab.
- **Safari:** run `npm run safari` and open `dist/safari-xcode/Rate Limit Tracker for X/Rate Limit Tracker for X.xcodeproj`. Build and run the macOS target. In Safari, go to Settings → Advanced, turn on "Show features for web developers", then Develop → Allow Unsigned Extensions. Enable the extension and allow it on x.com.

### Publish

- **Chrome Web Store:** `npm run zip:chrome` builds the upload package. [store/CHROME_WEB_STORE.md](store/CHROME_WEB_STORE.md) has the listing text, graphics and privacy answers.
- **Firefox Add-ons:** `npm run sign:firefox` submits the package and its source code with your AMO API keys. [store/FIREFOX_ADDONS.md](store/FIREFOX_ADDONS.md) covers both that route and the manual one.
- [PRIVACY.md](PRIVACY.md) is the privacy policy.

### Website

`website/` is a [VitePress](https://vitepress.dev) site with a guide and the privacy policy. The privacy page includes `PRIVACY.md` directly, so edit the policy there.

```sh
npm run docs:dev      # local dev server
npm run docs:build    # static site in website/.vitepress/dist
```

The output is static files, so any static host works. Set `BASE` when serving from a sub-path, for example `BASE=/x-ratelimit/ npm run docs:build` for a GitHub Pages project site.

### Continuous integration

- [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs on every push and pull request: type-check, tests, build for all three browsers, a Firefox lint, and the store zips (downloadable from the run as `extension-zips`).
- [`.github/workflows/website.yml`](.github/workflows/website.yml) builds the website whenever it or its sources change, and publishes it to GitHub Pages from `main`. To turn on publishing, set **Settings → Pages → Source** to **GitHub Actions** once.

## Testing whether follow returns a 429

1. Load the extension and reload any open x.com tabs, so the page hook is installed before X's scripts run.
2. Open the popup. Under **Does it return 429?**, select **Follow**.
3. Follow accounts the way you normally would. Each follow appears on the **Requests** page with its status, the remaining count (if X sent rate-limit headers) and any error code.
4. Read the result:
   - **"Yes: X returned HTTP 429"**: the limit can be detected from the status. The headers on that response are shown too, including the `x-rate-limit-reset` time.
   - **"Limited, but not with a 429: HTTP 403 + error 161"**: X enforced the limit through an error code. Status-only monitoring would miss it, but this extension catches it through the page hook.
   - **"No limit response observed yet"**: the extension lists every status it has seen, and says whether the endpoint sends `x-rate-limit-*` headers at all.
5. Use **Settings → Export JSON** to save the raw records as evidence.

Use your own normal activity, or a test account, to reach the limit. Deliberately bursting follows can get an account flagged (error `226`) or temporarily locked (`326`). The extension only observes requests and won't send any.

## Files

```
src/manifest.json      shared MV3 manifest (background is set per browser by the build)
src/background.ts      webRequest listener, message handling, storage, badge
src/content.ts         injects hook.js, sends it the tracked list, relays its reports
src/hook.ts            page-world fetch/XHR observer (must not import lib/api.ts)
src/popup/             Home, Endpoints, Requests and Settings views
src/lib/types.ts       shared types: records, settings, messages
src/lib/endpoints.ts   endpoint definitions, matching, settings validation
src/lib/records.ts     header filtering, record building, merging, summaries
src/lib/state.ts       storage shape
src/lib/api.ts         `browser` / `chrome` namespace
tsdown.config.ts       one IIFE build per entry and browser
scripts/targets.ts     browser targets, entry list, manifest + icon output
scripts/icons.ts       draws the PNG icons from simple geometry
scripts/zip.ts         zips a built target for store upload
scripts/zip-source.ts  zips the committed source for AMO review
scripts/sign-firefox.ts  submits to addons.mozilla.org with web-ext
scripts/env.ts         loads .env (see .env.example)
store/                 store listing text and graphics
website/               VitePress site (guide + privacy policy)
.github/workflows/     CI and website deployment
scripts/website-assets.ts  renders the site's logo and favicon
test/                  node:test suites (run on the .ts sources)
```

## License

[MIT](LICENSE). Contributions are welcome. Run `npm run check` before opening a pull request.

This project isn't affiliated with or endorsed by X Corp. "X" and the X logo are trademarks of X Corp.
