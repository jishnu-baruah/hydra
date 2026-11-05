# Hydra

Hydra keeps a public, tamper-evident record of every dApp frontend build on **Arkiv**, with the build itself stored on **Swarm**, so anyone can check whether the site they are using is a build the team actually released.

Built at ETHGlobal Mumbai (5 to 7 Nov 2026). Scope for the event: **Arkiv + Swarm only.**

## Two flows

**1. Protocol teams publish releases**

A team adds the Hydra GitHub Action to their deploy workflow with one secret, `HYDRA_API_KEY`. On every deploy the action fingerprints the build and sends the manifest to the Hydra API. The API stores the build and manifest on Swarm, then writes `release` and `file` records to Arkiv from Hydra's testnet-funded wallet. The team needs no wallet, tokens or chain knowledge.

**2. Users check what they are running**

- **Explorer** (`apps/explorer`), a Sourcify-style site for app builds. Search by domain, app, file hash or Swarm reference, and see each app's release history and observed changes.
- **Chrome extension** (`apps/extension`). On every page it compares the scripts the site serves with the latest release on Arkiv, and warns when they don't match.
- **Indexer** (`packages/indexer`). Watches popular dApp frontends that haven't onboarded yet and records what they serve, so the explorer and extension are useful from day one.

## Layout

| Path | What | Owner |
| --- | --- | --- |
| `packages/core` | Shared record types, Arkiv attribute names, hashing, Arkiv query helpers | Jishnu |
| `apps/api` | Publish API: API keys, Swarm upload, Arkiv writes | Jishnu |
| `packages/action` | GitHub Action: hash the build, call the API | Jishnu |
| `packages/indexer` | Crawls listed dApps and writes `observation` records | Jishnu, with Manish's list |
| `apps/explorer` | Public explorer (reads Arkiv and Swarm directly) | Mouli |
| `apps/extension` | Chrome MV3 extension | Mouli |
| `docs/` | Architecture, tasks, research, submission | Manish |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the record formats.

## How we work

Read [TASKS.md](TASKS.md) sections 1 to 3 before writing code. In short: claim a task with a one-line `claim/t-<id>` PR, do the work in a `feature/t-<id>-<slug>` PR, and fill in the PR template. CI (`board` and `gates`) enforces the rules. Human-only blockers go in [OPERATOR_TODO.md](OPERATOR_TODO.md), decisions in [DECISIONS.md](DECISIONS.md). Claude sessions pick up [CLAUDE.md](CLAUDE.md) automatically.

## Rules

- **Testnets only:** Arkiv Rabdi testnet and the Swarm testnet. No mainnet funds.
- **No secrets in git.** Keys go in `.env` (see `.env.example`), which is gitignored.
- Nothing is copied from the pre-event spike repo. We use what it taught us; the code here is new.
