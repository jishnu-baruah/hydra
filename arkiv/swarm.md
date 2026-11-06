# Hydra on Arkiv + Swarm

Hydra keeps a public, tamper-evident record of every dApp frontend build. The build files and their manifest live on **Swarm**; the release records that point at them live on **Arkiv** (Rabdi testnet). The explorer and the Chrome extension read the record from Arkiv, fetch the manifest from Swarm, and compare it with the scripts the live site serves.

Each heading below answers one line of the Arkiv + Swarm bonus requirements. Design notes: [`docs/swarm.md`](../docs/swarm.md). Measured tests and costs: [`docs/research/swarm-fit.md`](../docs/research/swarm-fit.md).

## 1. What we keep on Swarm, what we keep on Arkiv, and the field that holds the reference

| On Swarm (one collection per release) | On Arkiv |
| --- | --- |
| Every file of the build (`index.html`, `assets/*.js`, CSS, images) | `hydra.release`: one entity per publish, with app, version, commit, CI run link and `swarm_ref` |
| `hydra-manifest.json`: app, version, commit, and the sha256 of every file and every external script the HTML loads | `hydra.file`: one entity per code file (app, sha256, release), so a file hash can be looked up |
| | `hydra.app`: who owns an app name; `hydra.observation`: what the indexer saw a live site serve |

**The field:** `hydra.release.swarm_ref`, an indexed string holding the plain 64-hex Swarm reference of the release's collection ([`packages/core/src/records.ts:24`](../packages/core/src/records.ts)). We write no feeds and no encrypted references.

Arkiv is the index you can query (by app, by file hash, by owner); Swarm holds the bytes. A manifest over 100 KB does not fit an Arkiv payload ([`records.ts:72`](../packages/core/src/records.ts) throws "trim it or store it on Swarm"), so Swarm is where the full manifest always lives.

## 2. One Arkiv entity and the Swarm reference it points to

Release `hygra-demo2` version `2026-11-05.4`, published from a GitHub Actions run through the live API:

- Arkiv entity: [`0xda3a4c82685b8f7c1ff3ea77eb53e928decbc98fcb6e33ce253bfa5af40ab289`](https://rabdi.explorer.arkiv.network/entity/0xda3a4c82685b8f7c1ff3ea77eb53e928decbc98fcb6e33ce253bfa5af40ab289) (Rabdi explorer)
- Its `swarm_ref`: `c98c1935aa29b10a088779266dfddcb521985741175182ef1b9e11d5a42c04ad`
- Open on Swarm: [`https://download.gateway.ethswarm.org/bzz/c98c1935aa29b10a088779266dfddcb521985741175182ef1b9e11d5a42c04ad/hydra-manifest.json`](https://download.gateway.ethswarm.org/bzz/c98c1935aa29b10a088779266dfddcb521985741175182ef1b9e11d5a42c04ad/hydra-manifest.json)

You should see the manifest JSON with `"app": "hygra-demo2"`. The script it lists, `/assets/index-9kLZXjpr.js`, opens at the same reference and its sha256 matches the manifest.

## 3. Postage batch, who gave it, and the service we upload through

- **Batch ID and buying wallet:** not ours. We hold no batch and no wallet with BZZ. The gateway stamps each upload with its own batch and does not expose it (`/stamps` returns 404).
- **Who gave us the batch:** the public Swarm gateway `https://api.gateway.ethswarm.org`, which runs Ethersphere's [swarm-gateway](https://github.com/ethersphere/swarm-gateway) and "manages postage stamps for uploads".
- **Service we upload through:** that same gateway. No Bee node of our own. The API sends a `Swarm-Postage-Batch-Id` header only when `SWARM_POSTAGE_BATCH_ID` is set, so an own Bee node with its own batch also works ([`apps/api/src/swarm.ts`](../apps/api/src/swarm.ts)).
- **Service we read through:** `https://download.gateway.ethswarm.org`, the same Ethersphere gateway server under a second name (see section 7). The explorer and the extension read manifests from it.

## 4. Files that upload to Swarm and read from it

| Role | File |
| --- | --- |
| Upload a build as one collection (`POST /bzz`, tar, 120 s timeout) | [`apps/api/src/swarm.ts`](../apps/api/src/swarm.ts) |
| Add `hydra-manifest.json` to the upload and store the reference in `swarm_ref` | [`apps/api/src/publish.ts:148`](../apps/api/src/publish.ts) |
| Build the tar | [`apps/api/src/tar.ts`](../apps/api/src/tar.ts) |
| Turn Swarm on from `BEE_API_URL` | [`apps/api/src/main.ts:26`](../apps/api/src/main.ts) |
| Explorer: link each release to its manifest on Swarm | [`apps/explorer/app/releases.js:18`](../apps/explorer/app/releases.js), shown by [`apps/explorer/app/page.js`](../apps/explorer/app/page.js) |
| Extension: fetch the newest release's manifest from Swarm to check the live page | [`apps/extension/src/compare/lookup.js:56`](../apps/extension/src/compare/lookup.js) |
| Teams publish with this script, served by the API | [`packages/action/publish.mjs`](../packages/action/publish.mjs) |

## 5. Run one upload and one read yourself

Needs only `curl` and `tar`. No key, no wallet, no batch.

```bash
mkdir -p demo && echo '{"hi":"hydra"}' > demo/hydra-manifest.json
tar -cf demo.tar -C demo .
curl -sS -X POST -H "Content-Type: application/x-tar" -H "Swarm-Collection: true" \
  --data-binary @demo.tar https://api.gateway.ethswarm.org/bzz
```

You should see `{"reference":"<64 hex characters>"}`. Then read it back:

```bash
curl -sS https://api.gateway.ethswarm.org/bzz/<reference>/hydra-manifest.json
```

You should see `{"hi":"hydra"}`. We ran exactly these steps on 2026-11-06 and got reference `a86be79f0083c312484c31ea5bbaf8602ddb2d58ab7578e2b24b767a5fb7f953`.

To publish a whole build the way a team does, with an API key from the Hydra site:

```bash
curl -sO https://hydra-api-5xmn.onrender.com/publish.mjs
HYDRA_API_URL=https://hydra-api-5xmn.onrender.com HYDRA_API_KEY=<your key> node publish.mjs <build folder>
```

You should see `release ... recorded on Arkiv`, the entity key, the transaction link and a `swarm` reference whose `hydra-manifest.json` opens on the gateway.

## 6. Where Swarm appears in the demo video

**To fill when the video is cut.** The Swarm moment: the publish prints its `swarm` reference, then the explorer's Manifest link opens `hydra-manifest.json` on the gateway.

## 7. What got in our way

- **Public gateways refuse HTML.** Every `index.html` read gets a 302 to a "forbidden" page, on both the mainnet and testnet gateways. The gateway sniffs the content for `<!doctype html`, so uploading a page as raw bytes or as `application/octet-stream` does not help. It costs Hydra nothing, since we only read the JSON manifest from Swarm, but a release cannot be served back as a working site. Gzipping the HTML first gets it through and reads back byte-identical after unzipping ([research, section 5](../docs/research/swarm-fit.md)).
- **Which network a gateway serves is not written down.** We found by test that `api.gateway.ethswarm.org` and `api.gateway.testnet.ethswarm.org` are separate networks (a reference from one returns 404 on the other). We upload through the first; it is free, so no funds are spent (DECISIONS.md, 6 Nov). Arkiv stays on Rabdi testnet.
- **The gateway's API hostname does not resolve everywhere.** On 7 Nov a home router's DNS in Mumbai returned nothing for `api.gateway.ethswarm.org`, so the explorer's Manifest link failed, while `download.gateway.ethswarm.org` (same server, 128.140.29.197) resolved and served the same manifest with HTTP 200. Reads now go through the download host; uploads stay on `api.gateway.ethswarm.org` (T-A34).
- **The batch you upload with is invisible on a public gateway.** We cannot quote a batch ID, only the gateway that gave it (section 3).
- **Feeds lag.** A feed update written on the testnet gateway took about 60 s before a direct read found it; reading through its feed manifest worked ([research, section 6](../docs/research/swarm-fit.md)).
- **No encrypted references on Arkiv.** Our references are plain, so nothing secret sits in a public entity.
