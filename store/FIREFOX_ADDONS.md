# Firefox Add-ons (AMO) submission

Everything needed to publish on [addons.mozilla.org](https://addons.mozilla.org/developers/). You can submit from the command line (recommended) or through the website.

AMO requires **source code** for bundled or compiled extensions, and this one is TypeScript bundled with tsdown. Both submission routes upload a source archive alongside the package. Reviewers rebuild from it and compare with the package, and builds are deterministic.

## Before you start

- Commit your changes. `npm run zip:source` archives `HEAD` and refuses to run with uncommitted changes.
- To release a new version, bump `version` in `src/manifest.json` first. AMO rejects a version number it has already seen.
- The add-on ID is `x-ratelimit@toneflix` (set in `scripts/targets.ts`). It's permanent once uploaded.

## Option A: command line

1. Sign in at addons.mozilla.org and create API credentials at <https://addons.mozilla.org/developers/addon/api/key/>.
2. Copy `.env.example` to `.env` and fill in the two keys. `.env` is git-ignored.

   ```sh
   cp .env.example .env
   # WEB_EXT_API_KEY=user:12345:67   (JWT issuer)
   # WEB_EXT_API_SECRET=…            (JWT secret)
   ```

3. Run:

   ```sh
   npm run sign:firefox
   ```

   Keys already set in your shell environment work too, and take precedence over `.env`.

This builds `dist/firefox`, creates the source archive, and submits both for listed review. On the first submission, it also creates the listing from [`amo-metadata.json`](amo-metadata.json): summary, description, category, homepage, MIT license and reviewer notes. It doesn't wait for the review to finish.

Then finish the listing in the Developer Hub (see "After submitting").

## Option B: website

1. Build both archives:

   ```sh
   npm run zip:firefox   # → dist/rate-limit-tracker-for-x-firefox-<version>.zip
   npm run zip:source    # → dist/rate-limit-tracker-for-x-source-<version>.zip
   ```

2. Go to **Developer Hub → Submit a New Add-on**, choose **On this site**, and upload the Firefox zip.
3. When asked **Do you need to submit source code?**, choose **Yes** and upload the source zip.
4. Fill in the listing with the values from [`amo-metadata.json`](amo-metadata.json):
   - **Summary** and **Description:** copy them as written.
   - **Category:** Social & Communication.
   - **Homepage:** `https://toneflix.github.io/x-ratelimit/`
   - **License:** MIT.
   - **Notes to reviewer:** paste the `approval_notes` text.

## After submitting

In **Developer Hub → your add-on → Edit product page**:

- **Support website:** `https://github.com/toneflix/x-ratelimit/issues`. The API can't set this on creation.
- **Privacy policy:** optional, because the manifest declares no data collection (`data_collection_permissions: none`). Adding `https://toneflix.github.io/x-ratelimit/privacy` reassures users.
- **Screenshots:** upload `screenshot-1-home.png`, `screenshot-2-endpoints.png` and `screenshot-3-settings.png` from this folder. The icon comes from the package.

Reviews range from minutes (automatic) to a few days if a human reviewer picks it up. Watch for email from AMO.

## Notes for reviewers

These are already in `approval_notes`, repeated here for reference:

- Build with Node.js 24 and npm 11: run `npm ci`, then `npm run build:firefox`. The output is in `dist/firefox/`.
- `hook.js` is a packaged `web_accessible_resource` that `content.js` injects into x.com pages. It wraps `fetch` and `XMLHttpRequest` to observe responses only.
- The extension uses no remote code and makes no network requests of its own. Data stays in `storage.local`.
