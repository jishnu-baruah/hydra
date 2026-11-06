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

## How we used Swarm

Every release's build lives on Swarm, and Arkiv holds the index that points at it.

- **What goes on Swarm.** On each publish the API uploads the build files plus a `hydra-manifest.json` (app, version, commit, the sha256 of every file and of every external script) as one Swarm collection. Code: `apps/api/src/swarm.ts`, called from `apps/api/src/publish.ts`.
- **What goes on Arkiv.** The `hydra.release` record stores the collection's reference in `swarm_ref`, next to the version and commit. The explorer and the extension read `swarm_ref` from Arkiv, then fetch `<gateway>/bzz/<swarm_ref>/hydra-manifest.json` and compare hashes.
- **Stamping.** We upload through the public gateway `https://api.gateway.ethswarm.org`, which stamps uploads itself, so we hold no postage batch (OP-2, `DECISIONS.md`). An own Bee node works too: set `SWARM_POSTAGE_BATCH_ID` and the API sends it.
- **What we found.** The gateway refuses to serve HTML (a 302 to `bzz.link/forbidden`, against phishing). That costs us nothing: Hydra only reads the JSON manifest from Swarm and checks scripts by hash, so Swarm never has to render a page.

A live release to check, `hygra-demo2` version `2026-11-05.4`:

- Manifest on Swarm: [`bzz/c98c1935.../hydra-manifest.json`](https://api.gateway.ethswarm.org/bzz/c98c1935aa29b10a088779266dfddcb521985741175182ef1b9e11d5a42c04ad/hydra-manifest.json)
- Its Arkiv record: [`0xda3a4c82...`](https://rabdi.explorer.arkiv.network/entity/0xda3a4c82685b8f7c1ff3ea77eb53e928decbc98fcb6e33ce253bfa5af40ab289), field `swarm_ref` = `c98c1935aa29b10a088779266dfddcb521985741175182ef1b9e11d5a42c04ad`

More detail for judges: [`arkiv/swarm.md`](arkiv/swarm.md). Design notes: [`docs/swarm.md`](docs/swarm.md).

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

**Research kit (optional).** For `/research`, `/deep` and `/swarm` in Claude Code, clone `jishnu-baruah/filebus-research` next to this repo (or set `HYDRA_RESEARCH_KIT` to its folder), copy its `.env.example` to `.env` and add your Groq, GLM, Tavily and Jina keys there. The keys never go in this repo. `scripts/research.mjs` runs the kit from its own folder, so nothing it writes lands here.

## Rules

- **Testnets only:** Arkiv Rabdi testnet and the Swarm testnet. No mainnet funds.
- **No secrets in git.** Keys go in `.env` (see `.env.example`), which is gitignored.
- Nothing is copied from the pre-event spike repo. We use what it taught us; the code here is new.
