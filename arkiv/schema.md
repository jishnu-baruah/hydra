# Schema: our Arkiv entities

Network: Rabdi testnet (chain 7794095), `@arkiv-network/sdk` 1.0.1. Source of truth:
[`packages/core/src/records.ts`](../packages/core/src/records.ts). Column names are lowercase
snake_case, timestamps are `u64` milliseconds, and the JSON payload sits in a `body` bytes column
(128 KiB cap, enforced in code). Only `.indexed()` columns can be filtered on.

## Who writes and owns the entities

Two wallets write every Hydra entity. Anyone can write an entity with a `hydra.*` schema name, so
every read in the API, explorer and extension keeps only entities **created by these wallets**
(`createdBy`), and an app name belongs to the creator of its earliest `hydra.app` record.

| Wallet | Address | Writes |
|---|---|---|
| Hydra API (publisher) | `0xdD0d4167959291A2eb930Fe82Fed58070134348b` | `hydra.app`, `hydra.release`, `hydra.file` |
| Hydra indexer | `0xc4e52D70880a83331E1cCd0AD745059D12565ea9` | `hydra.observation` |

Teams never hold a wallet: they sign in once with theirs to get an API key, and the API writes on
their behalf. The team's address is recorded in the `publisher` column, which is how app ownership
is checked.

## Entities

| Schema | Indexed columns (what we filter on) | Other columns | Body | Expires |
|---|---|---|---|---|
| `hydra.app` (a name claim) | `app`, `domain`, `publisher`, `created_at` | | `{ name, domains[], repo? }` | 30-day lease, extended to the network maximum (about 182.5 days) by every publish |
| `hydra.release` (one per publish) | `app`, `publisher`, `version`, `commit`, `swarm_ref`, `published_at` | `file_count` (u64), `source` | the release manifest (file and script hashes, domains) | network maximum |
| `hydra.file` (one per code file, up to 200 per release) | `app`, `sha256`, `release` (key) | `path` | none | network maximum |
| `hydra.observation` (indexer, per site, when it changes) | `domain`, `status`, `observed_at`, `scripts_hash` | `app` (optional) | scripts and their hashes, problems, third-party origins, category | 3 days |

`status` is `match`, `mismatch` or `unknown` (no release for that site).

## Queries we run

- Releases of an app, newest first: `select(...).from(ReleaseSchema).where(eq('app', app)).createdBy(API_WALLET).orderBy(desc('published_at'))`. This is the one in the README and in [`scripts/query-releases.mjs`](../scripts/query-releases.mjs).
- Which app serves this file: `from(FileSchema).where(eq('sha256', hash))`, then keep files whose `release` belongs to the app owner's releases. The extension asks the API, which runs this once per script hash.
- Latest observations: `from(ObservationSchema).where(gte('observed_at', u64(since))).createdBy(INDEXER_WALLET).orderBy(desc('observed_at'))`, paged 100 at a time.

Notes: `observed_at` filters need the value wrapped as `u64(...)`, and a page holds at most 100 rows
(see [`friction.md`](friction.md)).
