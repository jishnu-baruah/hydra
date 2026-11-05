# Tasks

**Goal:** by submission, a judge can watch one live run of both flows:

1. A demo team's GitHub Action publishes a release. It shows up on Arkiv and Swarm, and in the explorer.
2. We change one file on the live demo site. The extension turns red and the explorer shows the mismatch.

Scope: **Arkiv + Swarm only.** No ENS, no wallet plugin, no rollback runner.

**Owners:** **Jishnu** (backend, chain, CI and testing) · **Mouli** (explorer and extension) · **Manish** (research, docs, demo, submission; builds with Claude where useful).

Tick boxes as you go. If you're blocked for more than 30 minutes, say so in the group chat.

---

## Phase 0: tonight, 5 Nov. Set up and remove the unknowns

### Jishnu
- [ ] Create the Hydra Arkiv wallet and fund it from the faucet. Put the key in `.env` only.
- [ ] Arkiv check: create one `release` record with the exact attributes in ARCHITECTURE.md, query it back by `project`+`type`, and confirm the longest allowed expiry. Write the numbers into ARCHITECTURE.md.
- [ ] **Swarm spike (biggest unknown):** run a Bee light node on testnet, or find a hosted testnet option. Buy or obtain a postage batch, upload a folder, and read it back through a gateway URL. Note the steps in `docs/swarm.md`.
- [ ] Set up `packages/core`: TypeScript build, the record types (already drafted), a `sha256File()` helper and an Arkiv client wrapper with retries.

### Mouli
- [ ] Scaffold `apps/explorer` (Next.js or Vite + React; your call) with a search bar and a placeholder app page.
- [ ] Scaffold `apps/extension` (Chrome MV3): a background service worker, a popup, and a badge that can show green, red or grey.
- [ ] Read one record from Arkiv in the browser with `@arkiv-network/sdk` (Jishnu's test record) to prove the read path works without a backend.

### Manish
- [ ] **Research: what's already on Arkiv.** Open sourcify.arkiv.network and the Arkiv explorer. What data is already indexed (Sourcify verified contracts? other datasets)? Can we query it, and would it help the explorer or extension? Write `docs/research-arkiv-data.md`: what exists, how to query it, one idea for using it.
- [ ] **Research: Arkiv + Swarm bonus rules.** Copy the exact qualification text from the prize pages into `docs/prizes.md`, and confirm which Arkiv track we enter.
- [ ] **Indexer target list:** 15–20 real dApp frontends (DEXs, bridges, wallets' web apps) with their domains, as `packages/indexer/targets.json`. Include Polymarket and one of the Name.com-affected sites if they're live.
- [ ] Ask at the Arkiv stall: query limits, max expiry, best way to index many small records, mainnet timing. Note the answers in `docs/prizes.md`.

## Phase 1: 6 Nov morning. One thin end-to-end slice

**Exit check:** a manual `curl` to the API creates a release whose manifest is on Swarm and whose records are on Arkiv, and the explorer shows it.

### Jishnu
- [ ] `apps/api`: `POST /v1/releases` with header `Authorization: Bearer <api key>` and a body containing the manifest plus the build as a tarball or multipart upload. It checks the key, uploads to Swarm, writes the `release` + `file` records to Arkiv, and returns the entity keys and `swarm_ref`.
- [ ] `POST /v1/apps`: registers an app and its domains, then writes an `app` record. Domain check via `/.well-known/hydra.txt` (stub it for the demo domain if time is short).
- [ ] API keys: read `HYDRA_API_KEYS` from `.env` for the demo; store only hashes if we add a key-issue page.
- [ ] Deploy the API somewhere public with HTTPS (Railway, Fly or similar). The wallet key goes in the host's secrets, never in the repo.

### Mouli
- [ ] Explorer app page: given an app, list its releases (newest first) with version, commit, time, file count and a Swarm link.
- [ ] Explorer search: by domain, app name, file hash and Swarm ref.

### Manish
- [ ] Build the **demo dApp**: a tiny static site (one page and one JS file) deployed to Vercel at a domain we control. This is what we publish and later "attack".
- [ ] Write the demo script (below) and time it.

## Phase 2: 6 Nov afternoon and night. Both flows, real

**Exit check:** the GitHub Action runs on the demo repo and the extension goes red when we change a file on the live site.

### Jishnu
- [ ] `packages/action`: a GitHub Action (`action.yml` + a JS entry) with inputs `api-key`, `build-dir`, `app` and `domains`. It hashes every file, finds external `<script src>` in the built HTML and hashes them, then POSTs to the API and prints the explorer link.
- [ ] Wire the action into the demo dApp's repo; a push to main deploys and publishes.
- [ ] `packages/indexer`: for each target, fetch the page, collect and hash its scripts, compare with the previous observation, and write an `observation` record. Run it on a timer (every 10–15 min) for the demo window.
- [ ] Testing: one script that runs the full publish flow against testnet, plus a check that bad API keys are rejected.

### Mouli
- [ ] Extension compare logic as in ARCHITECTURE.md ("How the extension decides"), with a red banner listing the scripts that don't match.
- [ ] Explorer "events" view: a timeline mixing releases and observations (for example "script changed on app.example.com at 14:02").
- [ ] Explorer page for indexed sites that haven't onboarded: show observation history, labelled "observed, not published by the team".

### Manish
- [ ] Landing page copy and a "Get started" page: add the action, set `HYDRA_API_KEY`, done. The page can live in the explorer.
- [ ] README per app: how to run it.
- [ ] Start the submission text: what it does, how we used Arkiv, how we used Swarm (with tx hashes and Swarm refs).

## Phase 3: 7 Nov morning. Demo and submit

- [ ] **All:** a full dry run of the demo, twice, timed.
- [ ] **Jishnu:** publish the action from a separate **public** repo (GitHub Marketplace needs `action.yml` at the root of a public repo). Fund the wallet for the demo window.
- [ ] **Mouli:** package the extension (zip and load-unpacked instructions). Deploy the explorer.
- [ ] **Manish:** record the backup demo video; fill every submission field; add `docs/FEEDBACK.md` with Arkiv builder feedback (the lowercase-attribute and i32 issues from the spike, plus anything new).

---

## Demo script (target 3 minutes)

1. The problem in one line: Bybit, Polymarket, Name.com. The contracts were fine; the website wasn't.
2. **Flow 1:** push a commit to the demo repo. The action runs and publishes; open the explorer, where the new release appears with its Swarm link and Arkiv tx.
3. **Flow 2:** open the demo site with the extension installed: green. Change one line of the JS on Vercel directly, as an attacker would, and reload: red, "app.js isn't part of any release". The explorer shows the mismatch event.
4. Indexer: the explorer already shows observed history for real dApps that never onboarded.
5. Close: "Sourcify for app builds, on Arkiv and Swarm."

## Risks

| Risk | Fallback | Owner |
| --- | --- | --- |
| Swarm testnet setup is slow or the postage batch is hard to get | A hosted gateway; worst case, store the manifest on Arkiv and the build on Swarm later | Jishnu |
| Arkiv write limits or slow writes for many `file` records | Index scripts only, not every file; batch creates | Jishnu |
| An extension can't re-fetch some scripts (CORS) | Fetch from the background worker, which has host permissions | Mouli |
| Faucet rate limits | Fund two wallets on night 0 | Jishnu |
