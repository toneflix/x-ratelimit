# Rate limits on X

X limits how often an account can do things. It reports those limits in two different ways, and the extension catches both.

## HTTP 429 and rate-limit headers

Many X API responses include headers like these:

```
x-rate-limit-limit: 50
x-rate-limit-remaining: 3
x-rate-limit-reset: 1792492522
```

`reset` is the time the window ends, in seconds since 1970. When `remaining` reaches 0, further requests get **HTTP 429 Too Many Requests** until the window resets.

## Limits sent as error codes

For some actions, X doesn't send a 429. It returns another status with an error code in the response body. Status codes alone would make these look like ordinary failures, or even successes. The extension recognises these codes:

| Code | Meaning |
|------|---------|
| 88   | Rate limit exceeded |
| 161  | Follow limit reached (usually with HTTP 403) |
| 185  | Daily post limit reached |
| 226  | Request looked automated |
| 326  | Account temporarily locked |
| 344  | Daily limit reached (can come with HTTP 200) |

Reading error codes requires **Settings → Read X error codes from the page**, which is on by default.

## Testing whether an action returns 429

1. Under **Does it return 429?** on Home, select the action, for example **Follow**.
2. Use the action on x.com as you normally would. Each response appears on the Requests page.
3. Read the result:
   - **"Yes: X returned HTTP 429"**: the limit can be detected from the status code. The response's rate-limit headers are shown with it.
   - **"Limited, but not with a 429: HTTP 403 + error 161"**: X enforced the limit with an error code.
   - **"No limit response observed yet"**: the extension lists every status it has seen, and says whether the endpoint sends rate-limit headers at all.
4. Use **Settings → Export JSON** to keep the raw records.

::: warning
Don't try to hit limits on purpose. Bursts of follows or posts can get an account flagged (error 226) or locked (error 326). The extension only watches. It never sends requests itself.
:::
