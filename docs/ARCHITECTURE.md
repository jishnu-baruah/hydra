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

## Arkiv facts

Network values are from docs.arkiv.network/networks/rabdi and /reference/limits, read 2026-11-05.
The SDK behaviour notes are from our pre-event spike, which ran on Tiramisu: re-check them on Rabdi
in T-F01.

- Testnet **Rabdi**, chain id `7794095`, RPC `https://rpc.rabdi.db-chain.testnet.arkiv.network`
  (WebSocket `wss://rpc.rabdi.db-chain.testnet.arkiv.network`), gas token tGLM, 2 s blocks.
  Faucet `hub.arkiv.network/faucet`, explorer `rabdi.explorer.arkiv.network`.
- **The public RPC is rate limited.** Get an access key at `hub.arkiv.network/access-keys` and pass
  it as `rabdi({ accessKey })` from `@arkiv-network/sdk/chains`.
- Tiramisu (chain `7738577`), which the spike used, is "Replaced by Rabdi". Do not use it.
- SDK `@arkiv-network/sdk` with viem; Node 22.10 or later. The docs do not pin a version, and the
  spike used 0.8.1. Pin whatever T-F01 installs.
- **Limits:** max lifetime 7,884,000 blocks (about 182.5 days) from the create or extension;
  32 attributes per entity; **128 bytes per string attribute**; 128 KiB of bytes per create;
  100 rows per query page. "long" expiry below means this maximum.
- Long values (script URLs, file paths over 128 bytes) go in the payload, not in an attribute.
- **Attribute names must be lowercase** (`checked_at`, not `checkedAt`). Uppercase reverts on chain, and the SDK doesn't warn you.
- **Numbers default to i32.** Timestamps must be `u64(BigInt(ms))`.
- Expiry uses `expires: ExpirationTime.fromSeconds(n)`. Expired entities drop out of queries.
- A create took about 3 to 7 s on testnet. Batch where we can.

## Records

Every record has the attributes `project = "hydra"` and `type`, so all our data can be queried with one filter. Payloads are JSON.

| `type` | Written by | Attributes (all lowercase) | Payload | Expiry |
| --- | --- | --- | --- | --- |
| `app` | API, on registration | `app`, `domain`, `publisher`, `created_at` (u64) | `{ name, domains[], repo? }` | long |
| `release` | API, on publish | `app`, `version`, `commit`, `swarm_ref`, `file_count`, `published_at` (u64), `source` = `ci` | `{ manifest summary, ci_run_url }` | long |
| `file` | API, on publish | `app`, `sha256`, `path`, `release` (release entity key) | none | long |
| `observation` | Indexer | `app` or `domain`, `status` (`match`, `mismatch`, `unknown`), `observed_at` (u64), `scripts_hash` | `{ scripts: [{url, sha256}] }` | days |

"long" means the maximum lifetime, about 182.5 days. A `path` or URL over 128 bytes is hashed into the attribute and kept in full in the payload.

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
