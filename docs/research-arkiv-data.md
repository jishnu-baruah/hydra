# What's already on Arkiv, and can we use it?

Scoping note from TASKS.md: "What data is already indexed (Sourcify verified contracts? other datasets)? Can we query it, and would it help the explorer or extension?"

Read on 2026-11-05.

## TL;DR

- The one real dataset on Arkiv today is the **Sourcify prefill** at <https://sourcify.arkiv.network>: every Ethereum mainnet contract verified by Sourcify, deduplicated into typed Arkiv entities. It's user-searchable by chain id, address, contract name, bytecode and compiler settings.
- Beyond Sourcify, Arkiv's ecosystem page lists hackathon winners (MentorGraph, Agora, Ocean, Infinite Conspiracy, OpenArkiv) — these are apps, not datasets we can lean on. There is no generic "DeFi frontends" or "domains" dataset already on Arkiv.
- **Best fit for Hydra:** use Sourcify-Arkiv as a **narrative parallel** and, if cheap, as an **optional enrichment** in the explorer — "this app's frontend talks to N Sourcify-verified contracts." Nothing to pull in for the extension.

## 1. The dataset: Sourcify verified contracts on Arkiv

- **Frontend:** <https://sourcify.arkiv.network>. Search by address / contract name / ABI, filterable by chain id, deployer, compiler settings, bytecode match and block range.
- **Source pipeline:** [`Arkiv-Network/sourcify-arkiv-entity-processor`](https://github.com/Arkiv-Network/sourcify-arkiv-entity-processor) turns the Sourcify Postgres DB into a deduplicated Arkiv seed bundle. Runs as: `prepare → process → verify → pack/upload`.
- **Entity schema (as published):** four kinds per contract:
  - `sourcefile` — one per unique source file.
  - `code` — bytecode entities.
  - `compilation` — compiler metadata (shared across contracts that reuse it).
  - `verified_contract` — the wrapper; payload is `sourcify.verified-contract.v3`, a stripped JSON with a `references` manifest that re-hydrates values at JSON Pointer paths by hash.
- **Identity:** entities are ordered by Sourcify `matchId`, owned by a single `ENTITY_OWNER` wallet, with `ExpiresAt = 2^64 - 1` (effectively permanent in that API, though Rabdi caps at ~182.5 days in practice — worth asking the stall).
- **Scale:** Sourcify has ~11M verified contracts (end-2025); the Arkiv prefill is multi-MB bundles, packed up to 120 KB calldata per tx.

### Can we query it from client code?

Yes — the backend of `sourcify.arkiv.network` is an Arkiv query, so the same SDK calls work from anywhere. Expected pattern (needs to be confirmed when Jishnu has Rabdi SDK set up):

```ts
import { select, eq } from "@arkiv-network/sdk";
// pseudo — exact attribute names to be confirmed from the processor schema
const rows = await select({ attributes: true, payload: true })
  .where(eq("kind", "verified_contract"))
  .where(eq("chain_id", 1))
  .where(eq("address", address.toLowerCase()))
  .limit(1);
```

**Caveats:**
- The processor doesn't commit to stable public attribute names in its README. Before relying on any specific field, confirm by inspecting one entity in `rabdi.explorer.arkiv.network` or asking at the stall.
- Query page size is 100 rows (`docs/ARCHITECTURE.md` and SDK limits). For "verified?" lookups we need at most 1 row — fine.
- Lookup will cost one RPC call per contract address. For a dApp like Uniswap that talks to dozens of contracts, batch or cache.

## 2. What else is there?

- **Block explorer:** <https://rabdi.explorer.arkiv.network>. Useful for us as a demo visual ("here's the release tx on Arkiv") but not a dataset we query.
- **Ecosystem apps** (<https://arkiv.network/blog>): MentorGraph (trust graph), Agora (eight entity types no DB), Ocean, Infinite Conspiracy, OpenArkiv. All are applications, not shared datasets.
- **The faucet / access-key hub:** <https://hub.arkiv.network>. Operational, not data.

Nothing else is a shared dataset we could pull from.

## 3. One idea for Hydra: a "contracts" badge in the explorer

On any `app` page in the explorer, for each **domain** we observe:
1. From the latest manifest, extract the list of **RPC calls / contract addresses** the frontend references. (This is cheap to grep out of built JS — addresses are 40-hex-char literals.)
2. For each address, query `verified_contract` on the Sourcify-on-Arkiv dataset by `(chain_id, address)`.
3. Show a small badge on the app page: **"Frontend references N contracts; M are Sourcify-verified."** Link each verified one to `sourcify.arkiv.network/contract/<chain>/<address>`.

**Why this helps:**
- Cheap: a few Arkiv reads per release, cached by address.
- Tells a complete story for judges: "the backend is verified (Sourcify), the frontend is verified (Hydra), and both read from one Arkiv."
- Explicit callback to Sourcify is on-brand — our pitch is literally "Sourcify for app builds."

**Why it might not help the extension:**
- The extension runs per page view and is already doing real-time hashing. Adding N contract lookups would blow the latency budget and the point-in-time evidence (an extension screenshot showing red is the strongest demo signal). Keep the extension focused on scripts.

**Scope this feature small:** address grep + N parallel reads + a one-line badge. Don't build a full verified-contract viewer — link out to Sourcify's own page.

## 4. Alternative ideas, rejected

- **Pull Sourcify data into our own entities.** No. Duplicates a dataset Arkiv already has and violates the "Mirror" track's "cannot be Sourcify" rule. And we're entering the "Build on Arkiv" track, not Mirror.
- **Index all historical dApp frontends via Sourcify back-references.** No. Sourcify indexes contracts, not frontends. No link in the data.
- **Use `rabdi.explorer.arkiv.network` as our own explorer.** No. It's a chain explorer, not a dataset UI. Our explorer is app-build-centric.

## 5. Open questions (tie in with `docs/prizes.md`)

- Confirm the live attribute names on Sourcify-on-Arkiv entities (`chain_id`? `chainId`? `address`? case?). The processor code is the source of truth; the prior-learnings note says uppercase attributes revert on chain, so expect snake_case.
- Confirm whether the Sourcify prefill is on Rabdi, mainnet, or a different Arkiv network. If it's not on Rabdi, our client can't read it from the same provider we're using for Hydra writes.

Follow-ups go in `docs/prizes.md` under the stall-questions section.
