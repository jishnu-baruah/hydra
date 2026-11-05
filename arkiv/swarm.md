# Arkiv + Swarm bonus — Hydra

Required by the Arkiv + Swarm bonus prize (ETHGlobal Mumbai 2026-11; qualification text in `docs/prizes.md`). Authoritative design doc: [`docs/swarm.md`](../docs/swarm.md). This file is the judge-facing summary.

## 1. What lives on Swarm vs. what lives on Arkiv

| Lives on Swarm | Lives on Arkiv |
| --- | --- |
| The built site files (every `/index.html`, `/assets/*.js`, etc.), uploaded as one Swarm collection per release | `hydra.release` entity (one per publish) |
| The release manifest JSON at path **`hydra-manifest.json`** inside the same collection | `hydra.file` entities (indexed by `app`+`sha256`+`release` key, up to 200 per release) |
| | `hydra.app` entity (one per registered app) |
| | `hydra.observation` entities (indexer, per-site-per-poll) |
| | The full manifest JSON also rides in `release.body` when ≤ 100 KB (`apps/api/src/publish.ts:123`) |

Arkiv is the queryable index; Swarm is the immutable blob. Enforced by `packages/core/src/records.ts:68` (the Arkiv body cap throws with "trim it or store it on Swarm").

## 2. Entity field holding the Swarm reference

**`hydra.release.swarm_ref`** — an indexed `str` column (≤ 128 B). Defined at `packages/core/src/records.ts:23`. Set by the API at `apps/api/src/publish.ts:131` from the string returned by `swarmUploader` at `apps/api/src/swarm.ts:21`. References are plain content-addressed roots (64 hex chars). No encrypted or feed references are written — see § 7.

## 3. One entity with a Swarm reference, linked for verification

**TBD at submission time.** No `hydra.release` has been written to Rabdi yet (see the T-B01 finding note in `TASKS.md`: *"0 hydra.release records exist yet"*). Once T-A02 publishes its first release in Phase 1/2, replace this section with:

- Entity key on Rabdi: `0x…` — open in the Arkiv explorer at `https://rabdi.explorer.arkiv.network/entity/<key>`
- `swarm_ref` returned: `<64-hex>`
- Gateway read: `https://api.gateway.ethswarm.org/bzz/<64-hex>/hydra-manifest.json`

Owner for the fill-in: **Jishnu** (API) → **Manish** (submission text).

## 4. Postage batch ID and purchasing wallet

**We do not hold a postage batch.** Uploads go to the Ethereum Foundation's public Swarm gateway at `https://api.gateway.ethswarm.org`, which envelope-stamps on our behalf. Confirmed 2026-11-05 that the gateway accepts and ignores the `Swarm-Postage-Batch-Id` header entirely (see `spikes/F2/result.json` and the "batch-id header is ignored" test in `docs/swarm.md` § Path B). So:

- **Batch ID:** none (gateway-managed).
- **Purchasing wallet:** none (the EF gateway owns its batch).

This is the Arkiv + Swarm bonus's expected answer for teams using the public gateway. If we later switch to a self-hosted Bee, the batch ID and wallet address go here.

## 5. Bee node or hosted service used for uploads

**EF public gateway** `https://api.gateway.ethswarm.org`. No local Bee node. Spike `T-F02` ran a 5-file folder upload and read every file back, see `spikes/F2/result.json`.

## 6. Files in this repo that upload to and read from Swarm

| Role | File | Notes |
| --- | --- | --- |
| Upload | [`apps/api/src/swarm.ts`](../apps/api/src/swarm.ts) | `POST /bzz` with `Swarm-Collection: true`, `Swarm-Index-Document: index.html`, 120 s abort |
| Upload caller | [`apps/api/src/publish.ts`](../apps/api/src/publish.ts) (lines 107-112) | Appends `hydra-manifest.json` to the tar, stores the returned ref into `release.swarm_ref` |
| Tar builder | [`apps/api/src/tar.ts`](../apps/api/src/tar.ts) | Minimal ustar writer for the Bee collection upload |
| Config wiring | [`apps/api/src/main.ts`](../apps/api/src/main.ts) (line 24) | Reads `BEE_API_URL` + `SWARM_POSTAGE_BATCH_ID` from env |
| Arkiv column | [`packages/core/src/records.ts`](../packages/core/src/records.ts) (line 23) | `swarm_ref: str().indexed()` on `ReleaseSchema` |
| Explorer read | [`apps/explorer/src/main.js`](../apps/explorer/src/main.js) (line 58) | Renders `swarm_ref` on the home list; app page (T-B02) will link out |
| Extension read | `apps/extension/` (T-C02) | Will fetch `<gateway>/bzz/<swarm_ref>/hydra-manifest.json` to verify |

## 7. Reproducible upload and read

Smallest possible end-to-end against the public gateway. Prerequisites: `curl`.

```bash
# 1. Upload (a tiny tar of one file, Swarm collection)
cd /tmp && mkdir -p demo && echo '{"hi":"hydra"}' > demo/hydra-manifest.json
tar -cf demo.tar -C demo .
curl -sS -X POST \
  -H "Content-Type: application/x-tar" \
  -H "Swarm-Collection: true" \
  --data-binary @demo.tar \
  "https://api.gateway.ethswarm.org/bzz"
# -> {"reference":"<64-hex>"}

# 2. Read back
REF=<paste reference>
curl -sS "https://api.gateway.ethswarm.org/bzz/$REF/hydra-manifest.json"
# -> {"hi":"hydra"}
```

Full 5-file spike with sha256 byte-compare: `spikes/F2/result.json`.

## 8. Demo-video timestamp where Swarm is used

**TBD at submission time.** Manish records the video in Phase 3 (7 Nov). The Swarm moment: the publish-step UI prints `swarmRef`, and the explorer opens it in the EF gateway to show the manifest byte-identical.

## 9. Friction encountered

- **EF gateway blocks HTML reads** (302 → `bzz.link/forbidden`). JSON/JS/CSS/plain text work. We serve the manifest from Swarm and the site from the dApp's origin, so this does not block our critical path — but a "render the site from Swarm" link in the explorer would need a different gateway.
- **The API requires a non-empty `SWARM_POSTAGE_BATCH_ID`** (`apps/api/src/main.ts:24`) to construct the uploader, even though the gateway ignores the value. Workaround: set it to any non-empty string. Clean fix (noted in `docs/swarm.md` § Path B): drop the env-guard from `main.ts:24` and make the header conditional in `swarm.ts:11`.
- **No encrypted Swarm references on-chain.** The bonus rules forbid encrypted refs in public Arkiv entities; our refs are plain 64-hex, so this is a note not a blocker.
- **Pre-event spike T7** (Tiramisu): `0.8.1` SDK, since replaced by `1.0.1` on Rabdi; `docs/prior-learnings.md` records the lowercase-attribute and i32-number issues we hit then, which are now encoded in `packages/core/src/records.ts` so publishers can't re-step on them. More Arkiv builder feedback goes in `docs/FEEDBACK.md` before submission.
