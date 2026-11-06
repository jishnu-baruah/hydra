# Swarm fit for Hydra (T-D11)

Research plus measured runs, 6 Nov 2026 (IST). Every number below links a source or comes from a run listed under "Runs". Anything not confirmed is marked **unverified**.

Gateways used in the runs: mainnet `https://api.gateway.ethswarm.org`, testnet `https://api.gateway.testnet.ethswarm.org`. All writes in the runs went to the **testnet** gateway, except the existing `hygra-demo2` release, which the live API wrote to mainnet before this task.

## Fit table

| Use | Works | Cost | Effort | Recommendation |
|---|---|---|---|---|
| Use | Works | Cost | Effort (estimate) | Recommendation |
|---|---|---|---|---|
| Store each build plus `hydra-manifest.json`, read the manifest back | yes, both gateways | 0 for us: the gateway buys and spends its own batch | 0 h, shipped | Keep. Move to the testnet gateway (T-A21, OP-11) |
| Serve a release back as a working site ("revert" from Swarm) | no through public gateways (website rule is deny); yes through an own Bee node or ENS plus bzz.link | own node: Sepolia ETH and sBZZ, testnet price unverified | 3 to 5 h for a Sepolia Bee node and batch | Skip for the event. "Revert" stays an Arkiv record pointing at the last good release |
| Evidence snapshots (page HTML plus its scripts) | yes if the HTML is gzipped first; raw HTML is blocked | 0 through the gateway | about 1 h in the indexer | Do it if the indexer wants snapshots: gzip HTML, keep the sha256 of the original |
| Feed for "last good release" per app | yes on testnet: write 1.3 s, resolves in about 60 s | 0 through the gateway | 2 to 3 h in `apps/api` (it signs with its own key) | Optional. Arkiv already answers "latest release"; a feed only helps a Swarm-only reader |
| Own Bee node and postage batch | not needed for the bonus (see 3) | mainnet: about 1.37 xBZZ per 30 days at depth 17 (see 2) | 3 to 5 h | Skip. Name the gateway as the batch giver in `arkiv/swarm.md` |

## 1. Network

- No Swarm doc states which network `api.gateway.ethswarm.org` serves; the docs only use it as the public gateway in `/bzz` links ([publish a website](https://docs.ethswarm.org/docs/desktop/publish-a-website)).
- Ethersphere's own CI labels the testnet host: its "Upload to testnet" step uses `bee-url: https://api.gateway.testnet.ethswarm.org` ([bee-dashboard check.yaml](https://github.com/ethersphere/bee-dashboard/blob/master/.github/workflows/check.yaml)). The Swarm testnet is Sepolia since Bee 2.0 ([configuration](https://docs.ethswarm.org/docs/bee/working-with-bee/configuration#sepolia-testnet-configuration)).
- The gateway software "manages postage stamps for uploads" and can autobuy batches ([swarm-gateway README](https://github.com/ethersphere/swarm-gateway)). Its default upload cap is `1gb`; whether the public instances override it is **unverified**. Rate limits: **unverified**.
- Own testnet node: set `mainnet: false` and a Sepolia RPC endpoint ([configuration](https://docs.ethswarm.org/docs/bee/working-with-bee/configuration#sepolia-testnet-configuration)); fund it with Sepolia ETH from a faucet and sBZZ bought on Uniswap with Sepolia selected, token `0x543dDb01Ba47acB11de34891cD86B675F04840db` ([fund your node](https://docs.ethswarm.org/docs/bee/installation/fund-your-node)).
- Conclusion: `api.gateway.ethswarm.org` is mainnet by our measurement and by the testnet label on the other host, not by a written statement. Use the testnet gateway (DECISIONS.md, 6 Nov).

Measured: the T-F02 fixture uploaded to the testnet gateway returned reference `4fc1a331...` (HTTP 201, no batch header). The same reference returns 404 on `api.gateway.ethswarm.org`, so the two gateways serve separate networks. The reference the live API wrote on 5 Nov (`c98c1935...`, release `hygra-demo2`) is readable on `api.gateway.ethswarm.org`, so the live API has been writing to that network.

## 2. Retention

- A batch costs `2^depth × amount`, and its balance "is then slowly depleted as time ticks on"; the minimum depth is 17 ([postage stamps](https://docs.ethswarm.org/docs/concepts/incentives/postage-stamps)).
- `amount = (price ÷ block time) × seconds`, with a Gnosis block time of 5 s (same page). Bee's `/chainstate` reports `currentPrice` in PLUR per chunk per block ([Bee API](https://docs.ethswarm.org/docs/bee/working-with-bee/bee-api)).
- Current mainnet price: 201,212 PLUR per chunk per block, set at 2026-11-06 04:39:45 UTC ([Swarmscan price oracle](https://api.swarmscan.io/v1/events/storage-price-oracle/price-update), contract `0x47eef336...`). 1 xBZZ is 10^16 PLUR.
- Cost of a depth-17 batch (the smallest; it holds far more than a 1 MB build, which is 256 chunks), if the price stays flat:
  - 30 days: amount 104,308,300,800, total about **1.37 xBZZ**.
  - 6 months (182.5 days): amount 634,542,163,200, total about **8.32 xBZZ**.
- Testnet price and the xBZZ fiat price: **unverified**.
- How long the public gateway keeps its own uploads: **unverified**. It hides `/stamps` and `/chainstate` (404, see below), so its batch TTL cannot be read.

Measured: the 5 Nov T-F02 upload (`bef3c15a...`, mainnet gateway, no batch of ours) still read back on 6 Nov at 10:20 IST (HTTP 200). Neither gateway exposes `/stamps` or `/chainstate` (HTTP 404 on both), so the gateway's own batch TTL cannot be read from outside.

## 3. Prize fit

From the [ETHGlobal Mumbai prizes page](https://ethglobal.com/events/mumbai/prizes), Arkiv section, read 6 Nov:

- The only Swarm prizes are two Arkiv + Swarm bonuses of $500 each, "from scratch" and "existing projects" (the second is Continuity Track only). There is no standalone Swarm prize, and a Swarm-only project does not qualify.
- The bonus says nothing about Swarm mainnet or testnet.
- `/arkiv/swarm.md` must hold the items below. Status for Hydra:

| Required in `/arkiv/swarm.md` | Hydra |
|---|---|
| What lives on Swarm and on Arkiv, and "which entity field holds the Swarm reference or feed" | met: `release.swarm_ref` |
| One Arkiv entity key and the Swarm reference it points to | met for mainnet (`hygra-demo2`); relink to a testnet release after OP-11 |
| "The postage stamp batch ID you uploaded with and the wallet that bought it", or "(or who gave you the batch)", and the Bee node or service | met by naming the gateway as the giver: we cannot see its batch ID |
| Files that upload and read, reproducible steps | met |
| Demo-video timestamp | open, comes with the video |
| Friction | met |

- Feeds, ACT and an own Bee node are not required. ACT "implements the operation of encryption at the chunk level" ([access control](https://docs.ethswarm.org/docs/concepts/access-control)); the page warns that an encrypted reference contains its key, so Hydra keeps plain references.

## 4. Revert and mirror

Measured on both gateways:

| Build | Gateway | Upload | Non-HTML files read back | `index.html` and `/bzz/<ref>/` |
|---|---|---|---|---|
| Vite SPA, release `hygra-demo2` (`c98c1935...`) | mainnet | by the live API, 5 Nov | `assets/index-9kLZXjpr.js` HTTP 200, time to first byte 0.43 s | HTTP 302 to `bzz.link/forbidden`, 0.72 s |
| Next.js 15.0.3 static export, 18 files, 755 KB (`fd2fe5d2...`) | testnet | HTTP 201 in 5.8 s | 15 of 15 byte-identical | 3 of 3 HTML files and the root: HTTP 302 to `/forbidden`, time to first byte 0.49 to 0.62 s |

So a release cannot be loaded as a working site from either public gateway: both refuse HTML. The Next.js export also links its scripts as absolute `/_next/...` paths, which would resolve to the gateway root, not to the collection, even where HTML is served under `/bzz/<ref>/`.

Why: the gateway code sniffs `<!doctype html` and applies `defaultWebsiteRule: 'deny'`, while plain files default to allow ([swarm-gateway proxy.ts](https://github.com/ethersphere/swarm-gateway/blob/master/src/proxy.ts)). Its forbidden page offers 2 ways out: run an own Bee node, or register the hash with ENS and open it on a `bzz.link` subdomain. Swarm's site guide also serves sites from a local Bee `/bzz/<hash>/` or through ENS plus `bzz.link` or `eth.limo` ([host your website](https://docs.ethswarm.org/docs/develop/host-your-website)). No written policy reason for the block was found: **unverified**.

## 5. Evidence snapshots

Measured on the testnet gateway, a 230,058-byte HTML file plus 3 scripts of 5,019 bytes each:

| Upload as | Upload | Read back |
|---|---|---|
| One collection (`/bzz`, tar) | HTTP 201, 248,832 bytes in 2.6 s, ref `36a8ec50...` | 3 of 3 scripts byte-identical (first byte 0.55 to 2.48 s); `index.html` HTTP 302 to `/forbidden` |
| HTML alone as raw bytes (`/bytes`, `application/octet-stream`) | HTTP 201 in 1.6 s | HTTP 302: the gateway sniffs the content, not the declared type |
| HTML alone via `/bzz` as `application/octet-stream` | HTTP 201 | HTTP 302 |
| HTML gzipped (`gzip -9`, 101,177 bytes) via `/bytes` | HTTP 201 in 2.8 s, ref `8f5aea6a...` | HTTP 200, first byte 0.67 s, total 0.95 s; gunzipped sha256 `4ec83faf...` equals the original |

So snapshots work if the HTML is compressed before upload and its sha256 is taken from the original.

## 6. Feeds

Measured on the testnet gateway with a throwaway key made for the run (never stored): a `sequence` feed update pointing at the Q5 collection was written in 1.3 s (HTTP 201, no batch of ours). A direct feed read returned 404 for about 60 s, then resolved (63.5 s after the write). A feed manifest was created, and `/bzz/<feed manifest>/a.js` returned the right file (HTTP 200), so the feed resolves to the collection it points at.

- A feed is a set of single owner chunks found by "an _Ethereum address_ and _Topic ID_", and the writer must sign its chunks with an Ethereum keypair ([feeds](https://docs.ethswarm.org/docs/develop/tools-and-features/feeds)). Reading the feed's manifest address gives the latest version (same page).
- Fit for "last good release": yes, if only the API writes an update when a release passes. Only `apps/api` may hold keys, so the API signs with one Hydra feed key and uses the app name as the topic; teams sign nothing.
- The gateway software proxies `POST /soc/*` and `POST /feeds/*` ([swarm-gateway README](https://github.com/ethersphere/swarm-gateway)); the run above shows the public testnet gateway accepts them.

## Runs

All on 6 Nov 2026, from a laptop in Mumbai over home broadband, with `curl` and `@ethersphere/bee-js` 8.3.1. Full references:

- T-F02 fixture, testnet: `4fc1a3318caab28fe15e99c8221f89097e7bad1509252545adaf195bf9c8cefa`
- Q5 collection, testnet: `36a8ec5066f72fbfea136b57f2c7598dbb9cb8f753c44ffb6d20a8a988cec26b`
- Q5 gzipped HTML, testnet: `8f5aea6a41844f9bf22702758c77489780ec61d282996a222be584118c7c4d92`
- Next.js export, testnet: `fd2fe5d23077c455fbf55fba78f5dfd04fb5af9d84dedad50aa15ea6786f65f0`
- Feed manifest, testnet: `09c41c86171606a0677b0eb97bf266528b3cb4b0a8c5779ea1aac9c252a169b7`
- `hygra-demo2` release, mainnet: `c98c1935aa29b10a088779266dfddcb521985741175182ef1b9e11d5a42c04ad`
- T-F02 upload, mainnet, 5 Nov: `bef3c15af9a3ebfefaee14cc5675f15dd3ec9080230351bf38ee340cd0d43006`
