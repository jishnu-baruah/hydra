# Prior learnings from the pre-event spikes

We ran 14 throwaway spikes before kickoff. **No spike code is in this repo, and none may be
copied in** (event rules). This page keeps what they taught: numbers, algorithms and traps, as
prose. Rewrite from here, do not port. Spikes about ENS, Safe, Chainlink CRE and the wallet Snap
are left out: they are out of scope (DECISIONS.md, 2026-11-05).

## Arkiv (spike T7, ran on Tiramisu; we now use Rabdi)

- Write, query, read and expiry all worked with `@arkiv-network/sdk` 0.8.1 and viem.
- A create took **3 to 7 s**. Plan for batching, and never write inside a user request path
  without a timeout.
- **Uppercase attribute names revert on chain** (`checkedAt` failed with
  `Ident32InvalidByte`), although the SDK's own error text says A to Z is allowed. Use lowercase
  snake_case everywhere.
- **A bare JS number is encoded as i32**, so `Date.now()` throws. Timestamps are
  `u64(BigInt(ms))`.
- Expiry uses `expires: ExpirationTime.fromSeconds(n)`. Older tutorials say `expiresIn` or BTL;
  ignore them. After expiry a record drops out of queries and `getEntity` errors with
  "No live entity with key".
- Query worked as `select({key, attributes, payload}).where(eq("run", RUN))`. "Latest per site"
  was computed client side from a timestamp attribute.
- Reverts are wrapped about six errors deep in viem output. Print the innermost cause.

## Compare algorithm (spike T4)

What the indexer and the extension do, proven on a static Vite site:

1. Read the release manifest (path to sha256).
2. Fetch every listed file from the live origin and hash it.
3. Parse `index.html` and check that every `<script src>` and `<link>` is in the manifest.
4. Report `CHANGED <path>` for a hash mismatch and `EXTRA <url>` for anything not listed.

Results: a **1-byte change in the JS was caught on the next poll (3 s)**, an injected
`<script src="https://cdn.evil.example/x.js">` was reported as `EXTRA`, and a restore went back to
healthy on the next poll. **0 false positives over 30 minutes** (122 healthy polls, 2 origins).
`fetch()` decodes gzip and brotli, so hashes match the served bytes; this held against real Vercel
production.

## Dynamic sites, Next.js (spike T12)

Most real dApp frontends are Next.js, and their HTML changes on every request (a timestamp, a
random value, React tree ids), so **hashing the HTML fails**. What stays fixed is the code:

- All code the browser runs is in `/_next/static/**` with content-hashed names. Hash those.
- Check every external `<script src>` and `<link rel=stylesheet|preload|modulepreload>`: same
  origin and in the manifest, else `EXTERNAL_ORIGIN` or `NOT_IN_MANIFEST`.
- Inline scripts must be either a release-time constant (render twice at release, keep what is
  identical, allowlist by sha256) or a data-only React Flight push,
  `self.__next_f.push(<JSON>)`, else `UNKNOWN_INLINE`.
- No inline event handlers (`INLINE_HANDLER`), no `javascript:` URLs.

It caught **6 of 6 planted attacks** (cookie-stealing inline script, external drainer script,
`<img onerror>`, raw HTML in the Flight payload, the same with unicode-escaped key names, a 1-byte
chunk change) with **0 false positives** after allowlisting Next's own not-found `<style>`.

Limits to say out loud: this proves the browser runs released **code**, not that the **data** is
honest (a compromised server can still serve a fake deposit address through real code). Server
logic is invisible from outside. The rules are Next.js App Router specific. Third-party scripts
need pinning by hash. The spike's HTML parsing was regex-grade; use a real tokenizer here.

For the event: the indexer and extension should compare **scripts by policy**, not whole HTML, on
any site that renders per request.

## Cloaking (spike T8)

A host served clean JS to one user agent and modified JS to everyone else. Checker A said healthy,
checker B said tampered, and the disagreement raised an alarm on the first poll.

- Splitting by user agent is easy to beat. Real cloaking is by IP or region, so vantage points
  must be on different networks.
- **The extension is the best vantage point we have**: it sees exactly what the victim's browser
  got. Use that in the pitch.
- An attacker who serves clean files to every known checker and bad files only to victims still
  wins against the indexer. Say so on stage.

## Reproducible builds (spike T11)

Two clean `npm ci && vite build` runs produced **identical manifests**, on the same machine with
Node 24.13.1. Not tested across machines. This backs the "Reproduced" level in the registry, with
that caveat.

## Vercel traps (spike T6)

- **Preview deployments inject a `vercel.live` feedback script into the HTML and are
  login-protected by default.** The extension and indexer would flag that script as foreign. The
  demo dApp must be checked on a **production** deployment.
- Static files were served byte-identical to the build output.

## Sponsor doc friction, for docs/FEEDBACK.md (T-J03)

- The Arkiv README said `^0.6.0`, and older tutorials use `expiresIn`/BTL, while 0.8.1 uses
  `expires` + `ExpirationTime`.
- The faucet cooldown is not stated.
- Uppercase attribute names revert on chain while the SDK error text says A to Z is allowed.
- Bare numbers default to i32 with no warning.
- Recheck each of these on Rabdi before filing it; some may be fixed.
