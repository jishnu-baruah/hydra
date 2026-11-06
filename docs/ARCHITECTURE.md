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
- SDK **`@arkiv-network/sdk` 1.0.1** with viem (pinned in `packages/core`). 1.x is
  **schema-based**: `defineSchema(name, { col: str().indexed(), ... })`, then
  `walletClient.createEntity(Schema, values, { expiration })` and
  `publicClient.select(...).from(Schema).where(eq(...)).fetch()`. The spike's 0.8 attribute-array
  API is gone.
- **Limits:** max lifetime 7,884,000 blocks (about 182.5 days) from the create or extension;
  32 columns per entity (31 for a named schema); **128 bytes per `str`**; 128 KiB of `bytes` per
  create; 100 rows per query page. "long" expiry below means `ExpirationTime.max()`.
- Long values (script URLs, file paths over 128 bytes) are replaced by their `sha256-<hex>` tag in
  the column (`fitStr` in core); the full value stays in the `body` payload.
- Column names: we use lowercase snake_case. A bare JS number is an `i32`, so times are
  `u64(BigInt(ms))` (the builders in core do this). The SDK checks values against the schema
  before sending; a bad value throws `SchemaMismatchError` with no transaction.
- Only `.indexed()` columns can be filtered on. `bytes` cannot be indexed.
- A create took about 3 to 7 s on the old testnet. Batch with `executeBatch` where we can.

### Rules from Arkiv's known-issues guide (SDK 1.0.1, Rabdi), enforced in `packages/core`

- **Writes go through `guardedCreate` only.** One wallet, one queue, one transaction per call,
  **never resent automatically**. Nonce and gasPrice are read at `latest`; gas is at least
  max(1,000,000, 2 x estimate) and at most half the block gas limit (`policyGas`). The receipt must
  say `success`. A `WriteNotVerifiedError` with phase `submission_unknown` or `submitted` means a
  transaction may exist: look up its hash and reconcile with a query before writing again.
- **Reads** may retry (`readWithRetry`, 3 tries). Never wrap a write in it.
- **The access key is a server-side secret.** The keyed RPC URL contains it, so every error from
  core is redacted (`redact`) and carries no `cause`. Never put the key in a browser bundle, a
  log, a URL we print, or the extension.
- **Event logs only reach about 1,000 blocks (about 30 minutes) back.** `eth_getLogs` and
  `watchEntityEvents` fail for older ranges, and a watcher that falls behind never recovers. Build
  history views (the explorer timeline) from **queries** over records, not from event logs.
- State reads are at the chain head only (`latest`); `safe`, `finalized` and old block tags fail.

### Open decision: how browsers read Arkiv

The explorer and the extension cannot hold the access key, and anonymous RPC is heavily rate
limited. Options: (a) a small read proxy in `apps/api` that holds the key and only forwards
`select` queries; (b) anonymous reads with caching, accepting rate limits for the demo. Decide in
DECISIONS.md before T-B01 and T-C02 depend on it.

## Records

Each record type is a **named schema** in `packages/core/src/records.ts`; the name is written as an
indexed `arkiv.schema` tag, so `.from(ReleaseSchema)` returns only Hydra releases. Use the value
builders there (`releaseValues` and friends), never hand-built objects. Payloads are JSON in the
`body` bytes column.

| Schema | Written by | Indexed columns | Other columns | `body` payload | Expiry |
| --- | --- | --- | --- | --- | --- |
| `hydra.app` | API, when the first key for a name is issued (the name claim) | `app`, `domain`, `publisher`, `created_at` (u64) | | `{ name, domains[], repo? }` | lease: 30 days, renewed to long by every publish |
| `hydra.release` | API, on publish | `app`, `publisher` (lowercase wallet address from the API key), `version`, `commit`, `swarm_ref`, `published_at` (u64) | `file_count` (u64), `source` = `ci` | `{ manifest summary, ci_run_url }` | long |
| `hydra.file` | API, on publish | `app`, `sha256`, `release` (entity key) | `path` | none | long |

**Expiry as a feature.** An app name is a lease: the claim lives 30 days (one API key's life), and
each publish extends it to long inside the first file batch, so active apps keep their name and
unused names free themselves with no cleanup job. Arkiv rejects an extension that moves an expiry
earlier, so renewals only ever extend to long (which counts from now). Reads ignore expired claims
because Arkiv no longer returns them. Next uses: observations with a 3 day TTL as freshness, and
self-clearing incident flags kept alive by renewal.
| `hydra.observation` | Indexer | `domain`, `status` (`match`, `mismatch`, `unknown`), `observed_at` (u64), `scripts_hash` | `app` (optional) | `{ scripts: [{url, sha256}] }` | 3 days |

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
In a release manifest, `domains` lists only proven domains (see Domain proof below).

### Domain proof

A publish may list up to 5 domains (the GitHub Action sends them from `HYDRA_DOMAINS`, a comma list).
The API keeps a domain in `domains` only if `https://<domain>/.well-known/hydra.txt` contains the line
`hydra-app=<app>`, checked once at publish (public addresses only, no redirects, 4 KiB max). An
unproven domain does not fail the publish: the response lists it in `domainsUnverified` with the
reason and the fix, and the Action prints it. The indexer rechecks the file on every run. A bound
domain that loses the file is flagged `DOMAIN_PROOF_LOST` and marked `mismatch`, because a hijacker
could delete the file to dodge the check. A copied file does not help, since the scripts must still
match the release. No token is needed: the app owner lists the domain with the API key, and the
domain serves the file.

## How the extension decides

1. On each page, read the origin and collect the URLs of the scripts the page loaded.
2. Look up the origin's `app`, then that app's latest `release`, then fetch its manifest from Swarm. Cache it.
3. Re-fetch the page's scripts, hash them, and compare with `files` and `scripts` in the manifest.
4. Badge: green = every script is in the release; red = something isn't (show which); grey = no release for this site. Also show the latest indexer `observation` if there is one (a `DOMAIN_PROOF_LOST` observation shows as mismatch, with that flag).

## Open decisions

- **Swarm setup.** Our own Bee node with a testnet postage batch, or a hosted gateway. This is a day-1 spike.
- **Pages that change on every request** (Next.js). Compare scripts only, not the HTML.
