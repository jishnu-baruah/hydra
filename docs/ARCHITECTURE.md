# Architecture

This file is the contract between the three parts of the build. Change it before you change the code, and tell the others.

## Components

```
GitHub Action ──(manifest + API key)──► Hydra API ──► Swarm  (build + manifest)
                                              └──────► Arkiv  (app, release, file records)

Indexer ──(fetch live sites)──► Arkiv (observation records)

Explorer ──(read)──► Arkiv + Swarm gateway
Extension ──(read)──► Arkiv + Swarm gateway, compares with the live page
```

The API is the only thing that holds keys: the Arkiv wallet and the Swarm postage batch. The explorer and the extension only read public data.

## Arkiv facts (from the pre-event spike, re-check on day 1)

- Testnet "Tiramisu", chain id `7738577`, RPC `https://rpc.tiramisu.db-chain.testnet.arkiv.network`, gas token GLM, faucet `hub.arkiv.network/faucet`.
- SDK `@arkiv-network/sdk` (0.8.1 at the spike) with viem.
- **Attribute names must be lowercase** (`checked_at`, not `checkedAt`). Uppercase reverts on chain, and the SDK doesn't warn you.
- **Numbers default to i32.** Timestamps must be `u64(BigInt(ms))`.
- Expiry uses `expires: ExpirationTime.fromSeconds(n)`. Expired entities drop out of queries.
- A create took about 3–7 s on testnet. Batch where we can.

## Records

Every record has the attributes `project = "hydra"` and `type`, so all our data can be queried with one filter. Payloads are JSON.

| `type` | Written by | Attributes (all lowercase) | Payload | Expiry |
| --- | --- | --- | --- | --- |
| `app` | API, on registration | `app`, `domain`, `publisher`, `created_at` (u64) | `{ name, domains[], repo? }` | long |
| `release` | API, on publish | `app`, `version`, `commit`, `swarm_ref`, `file_count`, `published_at` (u64), `source` = `ci` | `{ manifest summary, ci_run_url }` | long |
| `file` | API, on publish | `app`, `sha256`, `path`, `release` (release entity key) | none | long |
| `observation` | Indexer | `app` or `domain`, `status` (`match`, `mismatch`, `unknown`), `observed_at` (u64), `scripts_hash` | `{ scripts: [{url, sha256}] }` | days |

"long" means the longest expiry the testnet allows. Find that number on day 1.

## Manifest (stored on Swarm, referenced by `release.swarm_ref`)

```json
{
  "app": "example-dex",
  "version": "2026-11-06.1",
  "commit": "abc123",
  "domains": ["app.example.com"],
  "files": { "/index.html": "sha256-…", "/assets/app.js": "sha256-…" },
  "scripts": { "https://cdn.vendor.example/rum.js": "sha256-…" }
}
```

`scripts` lists the external scripts the built HTML loads (vendor scripts), hashed at publish time.

## How the extension decides

1. On each page, read the origin and collect the URLs of the scripts the page loaded.
2. Look up the origin's `app`, then that app's latest `release`, then fetch its manifest from Swarm. Cache it.
3. Re-fetch the page's scripts, hash them, and compare with `files` and `scripts` in the manifest.
4. Badge: green = every script is in the release; red = something isn't (show which); grey = no release for this site. Also show the latest indexer `observation` if there is one.

## Open decisions

- **Domain ownership.** How the API checks that a team owns the domains it registers. Proposal: a `/.well-known/hydra.txt` file containing a token from the API, checked once at registration.
- **Swarm setup.** Our own Bee node with a testnet postage batch, or a hosted gateway. This is a day-1 spike.
- **Pages that change on every request** (Next.js). Compare scripts only, not the HTML.
