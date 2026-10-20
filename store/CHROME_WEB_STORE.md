# Chrome Web Store submission

Everything needed to publish in the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole). Copy each field as written.

## 1. Package

```sh
npm run zip:chrome   # → dist/rate-limit-tracker-for-x-chrome-<version>.zip
```

Upload that zip under **Items → New item**. For later releases, bump `version` in `src/manifest.json`, run the command again, and upload under **Package → Upload new package**.

## 2. Store listing tab

**Name / summary:** taken from the manifest automatically.

**Description:**

```
Rate Limit Tracker for X shows the rate limits X (formerly Twitter) applies to your account, using the requests your browser already makes. No extra requests, no account connection, nothing sent anywhere.

WHAT YOU GET
• Remaining requests and reset countdowns for follows, unfollows, posts and likes
• Limit hits caught even when X doesn't return a 429, such as a follow limit reported as an error code
• Every X API endpoint that reports a rate limit, sorted by how close it is to running out
• A request log you can filter to tracked actions or errors
• A toolbar badge with the lowest remaining count, which turns red after you hit a limit

MAKE IT YOURS
• Choose which actions to track and which appear on the home screen
• Track any other X endpoint by name, path or URL, or with one click from the Endpoints page
• Export your history as JSON, or clear it at any time

PRIVATE BY DESIGN
• Runs only on x.com
• Never reads cookies, tokens or request headers
• Keeps only rate-limit headers, status codes and X's error codes
• All data stays on your device, with no servers, analytics or tracking
• Open source under the MIT license

Not affiliated with or endorsed by X Corp.
```

**Category:** Productivity → Tools

**Language:** English

**Graphics** (all in this folder):

| Field                      | File                                                                               |
| -------------------------- | ---------------------------------------------------------------------------------- |
| Store icon (128×128)       | `icon-128.png`                                                                     |
| Screenshots (1280×800)     | `screenshot-1-home.png`, `screenshot-2-endpoints.png`, `screenshot-3-settings.png` |
| Small promo tile (440×280) | `promo-small-440x280.png`                                                          |

The screenshots use sample data.

## 3. Privacy practices tab

**Single purpose:**

```
Shows the user the rate limits X (Twitter) applies to their account, by reading the status and rate-limit headers of responses to requests the X website makes in their browser.
```

**Permission justifications:**

`webRequest`

```
Reads the status code and rate-limit response headers (such as x-rate-limit-remaining) of requests to https://x.com/i/api/*. The extension only observes; it never blocks, redirects or modifies requests, and never reads request headers.
```

`storage`

```
Stores the captured rate-limit history and the user's settings in local extension storage on the user's device.
```

Host permission `https://x.com/*`

```
Limits webRequest observation to x.com, and runs a content script there that reads the error codes X returns when a limit is hit (for example, a follow limit reported as HTTP 403 with error 161). It doesn't run on any other site.
```

**Remote code:** No, I am not using remote code. (Every script, including the injected `hook.js`, is in the package.)

**Data usage.** Tick **User activity**. The extension monitors network responses on x.com. That data never leaves the device, but declaring it is the safe choice. Leave every other category unticked, then tick all three certifications:

- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** the website's `/privacy` page once it's deployed (it renders [`PRIVACY.md`](../PRIVACY.md)), for example `https://<you>.github.io/<repo>/privacy`. The GitHub link to `PRIVACY.md` works too.

## 4. Distribution tab

Visibility **Public**, all regions, free.

## 5. Submit

Click **Submit for review**. The narrow host permission (`x.com` only) and the absence of remote code usually keep reviews short, but expect anywhere from a day to a couple of weeks.
