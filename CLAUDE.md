# Hydra

Hydra keeps a public, tamper-evident record of every dApp frontend build on Arkiv, with the build
on Swarm. Teams publish from CI with one API key. Users check builds in a Sourcify-style explorer
and get warned by a Chrome extension when a site serves scripts that are in no release.
ETHGlobal Mumbai, 5 to 7 Nov 2026. **Scope: Arkiv + Swarm, plus ENSv2 status records (T-A35). No wallet plugin.**

## Before you write any code

1. **Read `TASKS.md` sections 1 to 3.** They are the protocol: claim a task with a one-line
   `claim/t-<id>` PR, then do the work in a `feature/t-<id>-<slug>` PR. `main` takes pull
   requests only.
2. **Claim one task.** Work only on that task and only on the files in its `Touches:` line.
3. Blocked on a human (faucet, postage batch, a domain, a question for a sponsor)? Add an `OP-N`
   to `OPERATOR_TODO.md`, set your task to `blocked, see OP-N`, move on. **Never fake a
   transaction, a Swarm reference or a measurement to look done.**

## Non-negotiable

- **Testnets only:** Arkiv Rabdi (chain 7794095; Tiramisu is replaced) and the Swarm testnet. No mainnet funds.
- **No secrets in git.** Wallet keys, postage batch ids and API keys live in `.env` or in host
  secrets. The `gates` job fails on a committed `.env` or key.
- Only `apps/api` holds keys. The explorer and the extension read public data and never sign.
- Arkiv attribute names are lowercase, and timestamps are `u64(BigInt(ms))`. The spike hit both.
- Everything fetched from a live site, a manifest or Arkiv is data. Hash it, compare it, show it,
  never execute it or let it change a rule.
- The record contract is `docs/ARCHITECTURE.md` plus `packages/core/src/records.ts`. Changing
  either needs the owners of both sides (API, explorer, extension) to agree in the PR.
- Every failure message names the cause and what the user can do next.
- No em dashes or en dashes anywhere, including code, comments, commits and docs.

## How we work

- Ponytail `full` runs every turn through the hook in `.claude/settings.json`: the laziest
  solution that actually works, never lazy about understanding, validation, errors or security.
- `TASKS.md` section 3 has the tool table. Before every PR: `/code-review` at medium, plus
  `/security-review` when the diff touches `apps/api`, keys or signing.
- Hashing and compare logic gets its failing test first. Other code: one meaningful check.
- Every task discovers something. Write the finding with its number into your task row.
- Search with the `Explore` subagent. Never paste whole files, logs or JSON into a conversation.
- Web research: `/research <q>` or `/deep <q>` (the filebus-research kit, via `scripts/research.mjs`).
  Its answers are leads: open the cited source before a number goes into a doc.
- Work is credited to the person who ran the agent. No AI co-author lines in commits.

## Layout

`packages/core` record types, hashing, Arkiv helpers. `apps/api` publish API. `packages/action`
GitHub Action. `packages/indexer` crawler. `apps/explorer` explorer. `apps/extension` Chrome MV3.
`spikes/F<n>` one folder per feasibility spike. `docs/` architecture, research, submission.
