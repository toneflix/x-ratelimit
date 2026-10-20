# Privacy Policy

_Last updated: October 20, 2026_

Rate Limit Tracker for X ("the extension") is an open-source browser extension that shows you the rate limits X (formerly Twitter) applies to your account. This policy explains what the extension reads, what it keeps, and where that data goes.

**In short:** everything stays on your device. The extension has no servers, sends nothing anywhere, and contains no analytics or tracking.

## What the extension reads

The extension only looks at responses from `https://x.com/i/api/*`, the API that the X website uses while you browse. For each response it reads:

- the time, the HTTP method, the URL path (query strings are discarded), and the status code
- response headers whose names contain "rate", "limit" or "retry", such as `x-rate-limit-remaining`
- for actions you track, or responses with an error status, the error codes and messages that X includes in the response

## What it never reads or keeps

- Request headers. This means your cookies, authentication tokens and `authorization` headers are never read.
- Any response header that could carry credentials (anything mentioning cookies, auth, tokens, CSRF or sessions). These are discarded even if they also mention a rate limit.
- Response content other than error codes, such as posts, profiles, messages or timelines.
- Activity on any website other than x.com.

## Where data is stored

Captured records and your settings are saved in your browser's local extension storage (`storage.local`), on your device only. History is capped at the last 1,000 tracked actions and 300 other requests. Older entries are deleted automatically.

The extension doesn't transmit any data to the developer or to any third party. It doesn't sell data, share it, or use it for advertising, creditworthiness or any purpose other than showing you your rate limits.

## Your control

- **Settings → Clear history** deletes all captured records.
- **Settings → Export JSON** saves a copy of your data to a file you choose.
- **Settings → Recording** lets you stop recording non-tracked requests, or stop reading error codes.
- Removing the extension deletes all of its stored data.

## Permissions

| Permission                  | Why it's needed                                                                                            |
| --------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `webRequest`                | Read the status and rate-limit headers of X API responses. The extension never blocks or changes requests. |
| `storage`                   | Keep your history and settings on your device.                                                             |
| Access to `https://x.com/*` | Limits the above to x.com, and runs a small script there that reads X's error codes.                       |

## Changes

If this policy changes, the new version will be published here with a new "Last updated" date.

## Contact

The extension is open source, and you can review exactly what it does in its source code. For questions or concerns, open an issue on the project's GitHub repository.
