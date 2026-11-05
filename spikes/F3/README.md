# Spike F3: can the extension hash the scripts a page loads?

Yes. Run on 2026-11-05 against 5 live dApp frontends, Playwright 1.49.1 Chromium, `--headless=new`.
Raw data in `result.json`.

```bash
cd spikes/F3 && npm ci && npx playwright install chromium
npm test        # sha256 helper against the FIPS 180-2 vectors
node run.mjs    # writes result.json
```

## How

- `extension/background.js` listens to `chrome.webRequest.onCompleted` with `types: ["script"]`,
  so it sees every script the page loads, including chunks added at runtime that an HTML scan misses.
- On request it re-fetches each URL with `cache: "no-store"`, hashes the bytes with Web Crypto,
  and fetches a second time to flag scripts that change per request.
- `run.mjs` also repeats the fetches from the page itself, which is all a content script could
  do, to count CORS failures.

## Results

| Page | Scripts seen | Hashed | Same origin | From iframes | Page-context fails | Unstable |
|---|---|---|---|---|---|---|
| app.uniswap.org | 816 | 816 | 0 | 35 | 1 | 0 |
| app.aave.com | 121 | 121 | 88 | 33 | 1 | 1 |
| stake.lido.fi | 17 | 17 | 16 | 0 | 0 | 0 |
| app.1inch.io (redirects to 1inch.com) | 93 | 93 | 91 | 2 | 0 | 1 |
| pancakeswap.finance | 34 | 34 | 32 | 0 | 0 | 0 |
| **Total** | **1081** | **1081** | | **70** | **2** | **2** |

- **5 of 5 pages, 1081 of 1081 scripts hashed, 0 worker failures**, on 2 runs (the first saw
  1109 scripts, 1inch loads a different set each time). With `host_permissions` the worker is not
  subject to CORS. The kill criterion (over 2 of 5 pages fail for CORS) did not fire.
- From the page context only 2 of 1081 cross-origin fetches failed, both Cloudflare challenge
  scripts. fetch() reports CORS and network errors the same way, so 2 is an upper bound on CORS.
- Median 48 ms per script for the 2 fetches, p95 160 ms. Fetches run one at a time, so Uniswap's
  816 scripts take about 40 s; T-C02 should use a small pool.
- 70 of 1081 scripts came from iframes (`frame_id` is not 0 in `result.json`), for example
  Uniswap's 35 from `privy.app.uniswap.org`. Compare them against the top app's manifest only if
  the app ships that frame.

## What the compare code must know

- **Same origin is the wrong test.** Uniswap serves 780 of its 816 scripts from
  `cdn.app.uniswap.org` and 35 from `privy.app.uniswap.org`, so 0 are same origin. A
  "hash same-origin only" fallback would check nothing there. The manifest must list the app's
  own CDN origins.
- **Every unstable script, 3 in run 1 and 2 in run 2, is a Cloudflare bot check** (`/cdn-cgi/challenge-platform/.../main.js?ray=...`),
  a fresh body on every request. The host injects them, not the build. T-C02 needs a rule for them,
  or every Cloudflare-fronted site goes red.
- 1inch redirects `app.1inch.io` to `1inch.com`, so the lookup must use the final origin.
- 25 of 1081 scripts came from the browser cache on first load; the re-fetch hashes what the host
  serves now, not what ran. Fine for a match check, worth saying out loud.
