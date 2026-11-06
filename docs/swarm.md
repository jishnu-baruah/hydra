# Swarm in Hydra: what, where, how

Owner of this doc: Manish (research/docs). Owner of the upload code: Jishnu (`apps/api`). Blocks for `T-F02` and the Arkiv + Swarm bonus (`docs/prizes.md`).

Read on 2026-11-05.

## 1. Why Swarm is in this project at all

Arkiv is a **structured** database — 128 B per string column, 128 KiB per entity body, 32 columns per entity (`docs/ARCHITECTURE.md` § Arkiv facts). A dApp build is **unstructured** — N arbitrary files, ranging from one JS bundle to hundreds of chunks. Those two shapes don't fit together, and `packages/core/src/records.ts:68` enforces the Arkiv body cap by throwing with the hint *"trim it or store it on Swarm."*

**So Swarm is Hydra's blob store, and Arkiv is Hydra's index.** Everything that a judge or a user *queries* lives on Arkiv (app, release, file, observation); everything they *download byte-for-byte* lives on Swarm (the build, the manifest). The link between the two is the single column `release.swarm_ref` (`packages/core/src/records.ts:23`).

That split is also the exact shape the Arkiv + Swarm bonus wants to see (`docs/prizes.md` § Arkiv + Swarm Bonus).

## 2. The exact Swarm/Arkiv split

| Lives on Swarm | Lives on Arkiv |
| --- | --- |
| The built site files (every `/index.html`, `/assets/*.js`, etc.), uploaded as a folder | `hydra.release` entity (one per publish) |
| The release **manifest** JSON (see § 3) | `hydra.file` entities (one per file; indexed by `app`+`sha256`+`release` key) |
|  | `hydra.app` entity (registration metadata) |
|  | `hydra.observation` entities (indexer records) |

**Reference flow:** publish uploads the folder to Swarm → Swarm returns one `swarmRef` (64–128 hex content-addressed root of the folder; `apps/api/src/swarm.ts:22` regex) → the API writes that reference into `release.swarm_ref` on Arkiv → anyone reading the release from Arkiv can reach the files on Swarm by that reference.

`release.swarm_ref` is a `str().indexed()` column (128 B max). A plain Swarm reference is 64 hex chars (32 B). Fits. Feeds and encrypted references are **not used** — the prize rules forbid encrypted references in public Arkiv entities, and our build is public anyway.

**Belt-and-braces:** when the manifest JSON is ≤ 100 KB, `apps/api/src/publish.ts:123` *also* puts the full manifest into the Arkiv `release.body` payload. Over that size, only `{ manifest_on_swarm: true }` is written to Arkiv and the manifest only lives on Swarm. Either way, the pointer `swarm_ref` is authoritative.

**Fallback:** if `BEE_API_URL` is missing (`apps/api/src/main.ts:23`), the API still publishes with `swarm_ref = "pending"`. Explorer and extension must tolerate `pending` as a read-only mode.

## 3. The manifest

Defined in `packages/core/src/records.ts:54-61`:

```ts
interface Manifest {
  app: string;
  version: string;
  commit: string;
  domains: string[];
  files: Record<string /*path*/, string /*"sha256-<hex>"*/>;
  scripts: Record<string /*external URL*/, string /*"sha256-<hex>"*/>;
}
```

The manifest is uploaded to Swarm **as part of the same folder** as the build (so one `swarmRef` covers both). Filename inside the Swarm collection: **`hydra-manifest.json`** (no leading slash, hyphen not dot — `apps/api/src/publish.ts:111`). The explorer and the extension fetch exactly that path from the Swarm gateway.

## 4. Who touches Swarm, where

Grep for `swarm`/`bee` across the repo (already done). Four live touch points:

1. **`apps/api`** (Jishnu, task **T-A02**, merged). On `POST /v1/releases`:
   - Takes `files: { "/path": "<base64>" }` plus `scripts` from the publish script.
   - The server hashes every file itself (`apps/api/src/publish.ts:82`); the client is only trusted for *external* script hashes, which it fetched at build time.
   - Builds the `Manifest`, serialises to JSON, calls `swarmUploader` (`apps/api/src/swarm.ts`) with `[...files, { path: "hydra-manifest.json", data: manifestJson }]` → one `/bzz` POST → returns `swarmRef`.
   - Writes `hydra.release` with `swarmRef` and `hydra.file` records in batches of `MAX_BATCH` for up to `MAX_INDEXED_FILES=200` code files.
2. **`apps/explorer/src/main.js:58`** renders `swarm_ref` as a column. **T-B02** expands this into an app page where the ref becomes a **working gateway link** per release. **T-B03** (claimed) accepts a Swarm ref as a search input.
3. **`apps/extension`** (task **T-C02**, not yet in `TASKS.md` body shown here but implied by `apps/extension/src/verdict.js:18`). On each page: reads latest `hydra.release` from Arkiv → fetches `/hydra-manifest.json` from `<gateway>/bzz/<swarm_ref>/hydra-manifest.json` → compares live scripts with `files`+`scripts`.
4. **`packages/action`** (Jishnu, task **T-A05**). **Does not talk to Swarm directly.** It hashes files and POSTs the build to the API; the API is the only thing that holds the batch id.

## 5. Config surface (already defined)

From `.env.example:10-13`:

```
BEE_API_URL=http://localhost:1633
SWARM_POSTAGE_BATCH_ID=
SWARM_GATEWAY_URL=
```

- `BEE_API_URL`: the Bee endpoint the API writes to. Can be `http://localhost:1633` (own node) or a hosted URL (`https://api.gateway.testnet.ethswarm.org` for the testnet, `https://gateway.etherna.io`, etc.).
- `SWARM_POSTAGE_BATCH_ID`: required if the Bee endpoint needs us to stamp; empty if the hosted gateway envelope-stamps for us.
- `SWARM_GATEWAY_URL`: the public URL the **explorer** and **extension** read from. Can equal `BEE_API_URL` or be a separate public gateway.

## 6. The three ways to make this work — and which one we take

From `docs/ARCHITECTURE.md:109` and the Phase 0 research in this chat:

### Path A — Swarm stall at ETHGlobal Mumbai
Walk up, ask for either a hosted Bee URL for the event or a testnet batch id. Takes 10 minutes if a human is there. **Try this first.**

### Path B — EF public gateway (`api.gateway.ethswarm.org`) — **confirmed working, 2026-11-05**
- Spike `T-F02` ran against it from this repo. Result: `spikes/F2/result.json`.
- Upload: `POST /bzz` with `Content-Type: application/x-tar`, `Swarm-Collection: true`, `Swarm-Index-Document: index.html`. Status 201, reference returned.
- Read: `GET /bzz/<ref>/<path>` serves JSON, JS, CSS and plain text byte-identical. HTML is **blocked** with a 302 to `https://bzz.link/forbidden?hash=<ref>` (anti-phishing). `Accept: text/plain` and `Accept: application/octet-stream` do not bypass it. `<ref>.bzz.link` subdomain does not resolve.
- **Batch-id header is ignored by the gateway.** Verified 2026-11-05: `Swarm-Postage-Batch-Id:` (empty) and 64-zero dummy both return HTTP 201 with a valid reference. The gateway envelope-stamps regardless. So we don't need a real batch id to run Path B against the current API code.
- **Impact on Hydra:** none on the critical path. The extension fetches the manifest JSON from Swarm (works) and verifies scripts by hash against the dApp's own origin. Swarm is never asked to render HTML. The explorer can link to any non-HTML asset by Swarm URL; a "render the site on Swarm" link would need a different gateway and is not a demo requirement.
- **How to run it:** set `BEE_API_URL=https://api.gateway.testnet.ethswarm.org` and `SWARM_GATEWAY_URL=https://api.gateway.testnet.ethswarm.org` (the testnet gateway; `https://api.gateway.ethswarm.org` is mainnet, DECISIONS.md 2026-11-06), and leave `SWARM_POSTAGE_BATCH_ID` empty. The API then sends no batch header (`apps/api/src/swarm.ts`); with a batch id set it sends one, so Path C still works.
- OP-2 is amended to "an upload succeeds and reads back byte-identical through a gateway URL" and marked decided (DECISIONS.md, 2026-11-06).

### Path C — Run a Bee light node on Sepolia
- Half a day of setup: Sepolia ETH faucet → sBZZ on Uniswap → Bee 2.x Docker → `POST /stamps/<amount>/<depth>` → batch id.
- Only do this if A fails and Jishnu picks the "stamp yourself" branch of the Path B decision.

**Recommendation for Hydra:** Path A today at the stall; fall back to Path B with OP-2's acceptance relaxed; only hit Path C if the bonus writeup becomes blocking.

## 7. Reproducible upload + read, the minimum demo

These are the exact commands we need to pass to the Arkiv + Swarm bonus prize (`/arkiv/swarm.md` asks for "reproducible steps for one upload and one read").

Assuming `BEE_API_URL` is set and (if required) a `-H "swarm-postage-batch-id: ..."` header or `?batch` query param is accepted:

```bash
# Upload a folder as one Swarm folder (gets back a root reference)
curl -sS -X POST \
  -H "Content-Type: application/x-tar" \
  -H "swarm-index-document: index.html" \
  -H "swarm-postage-batch-id: ${SWARM_POSTAGE_BATCH_ID:-<batch>}" \
  --data-binary @site.tar \
  "${BEE_API_URL}/bzz"
# -> {"reference":"<64-hex>"}

# Read one file back from the folder, by content address
REF=<the reference above>
curl -sS "${SWARM_GATEWAY_URL:-$BEE_API_URL}/bzz/$REF/hydra-manifest.json"
```

(If using the EF public gateway, drop the batch-id header; the gateway stamps.)

## 8. What the extension and explorer actually fetch

- **Explorer app page (T-B02):** for each release row, the "Swarm link" is `${SWARM_GATEWAY_URL}/bzz/${swarm_ref}/`.
- **Explorer "open release":** `${SWARM_GATEWAY_URL}/bzz/${swarm_ref}/hydra-manifest.json` to get the manifest JSON.
- **Extension (T-C02):** same URL as above, called from the background worker (CORS: Swarm gateways typically allow `*`, confirm when the spike lands). Cache per `swarm_ref`; refs are immutable, so cache forever.

Note from `spikes/F3/result.json` (via T-F03 findings): Uniswap serves 0 of 816 scripts from its own origin, so the extension can't fall back to same-origin-only. The Swarm manifest is the sole source of truth.

## 9. Open decisions and questions (tie in with `docs/prizes.md` § stall questions)

- **D-SW1 — Who stamps?** Does our API POST to Bee with a batch-id header (we own the batch), or POST to a stamp-forwarding gateway? Resolve once OP-2 is unblocked.
- **D-SW2 — Where does the gateway URL point?** If we run our own Bee, we probably still want a public gateway URL for the explorer/extension so users don't need localhost. Consider `https://api.gateway.ethswarm.org` for the public read side regardless of what we use for writes.
- **Q-SW1** — Does the Swarm testnet gateway allow unauthenticated reads by any `swarmRef`? (Expected yes; verify in the spike.)
- **Q-SW2** — What is the batch depth and amount for a hackathon's worth of uploads (small; a dozen small folders at most)? Ask the Swarm stall.
- **Q-SW3** — CORS on the gateway: does the extension need a custom header, or does the default allow it? Verify during T-C02.
- **Q-SW4** — Encrypted-reference rule: we're plain, so no action, but call it out in `/arkiv/swarm.md`.

## 10. Checklist before Phase 1 end

- [ ] `OP-2` unblocked: a batch id OR an accepted gateway-stamp path, logged in `.env.example` comments and `DECISIONS.md`.
- [ ] `T-F02` spike: 5-file folder uploaded and all 5 read back byte-identical through a gateway URL, with the ref written into `spikes/F2/result.json`.
- [ ] `apps/api` (T-A02) can POST a folder and store the returned ref into `release.swarm_ref`.
- [ ] A root `/arkiv/swarm.md` (pointer to this file) exists for the bonus-prize requirement. See `docs/prizes.md`.
- [ ] One entity key with a working `swarm_ref` is linked in `/arkiv/swarm.md` for judge verification.
- [ ] Demo video timestamp noted next to the Swarm upload moment.
