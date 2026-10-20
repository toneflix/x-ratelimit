# How it works

The extension uses two sources, because neither one sees everything on its own.

```
x.com page ─ fetch/XHR ─▶ page hook (hook.js)
                              │  status, limit headers, error codes
                          content script ─────────┐
                                                  ▼
webRequest ── status + limit headers ──▶ background ──▶ local storage ──▶ popup
```

- **Response headers.** The browser's `webRequest` API reports the status and response headers of every request to `x.com/i/api/*`. It's reliable, but it can't see response bodies, where X puts its error codes. In Safari it may not show the headers at all.
- **The page hook.** A small script on x.com watches the responses to X's own `fetch` and `XMLHttpRequest` calls. It reports the same status and headers, plus any `errors[].code` in the body. It only does this for tracked actions or error responses, and only error codes and messages are kept.

When both sources report the same response within five seconds, it's stored as one record.

## What's kept

For each response, the extension keeps the time, method, path (without the query string), status, headers whose names contain `rate`, `limit` or `retry`, and any X error codes. Response headers that could carry credentials, such as cookies or tokens, are always dropped. Request headers are never read. The full policy is on the [Privacy](../privacy) page.

History is capped at the last 1,000 tracked actions and 300 other requests.

## Source

The extension is written in TypeScript and bundled with tsdown into one script per part (background, content script, page hook, popup) for each browser. It's MIT licensed.

```sh
npm run check     # type-check and tests
npm run build     # build every browser
npm run docs:dev  # this website
```
