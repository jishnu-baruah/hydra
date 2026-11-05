# Prizes we are entering

Source: <https://ethglobal.com/events/mumbai/prizes>, read 2026-11-05.

> **Rules check.** Hydra is a new repo, built at ETHGlobal Mumbai 5–7 Nov 2026. It writes to Arkiv Rabdi via `@arkiv-network/sdk`, and has user-facing reads from Arkiv (explorer, extension). This puts us in the **From Scratch** tracks. The pre-event spikes are not in this repo (see `docs/prior-learnings.md`, which is prose only).

## Tracks we are targeting

### 1. Build on Arkiv (From Scratch) — **primary**
- **Prize pool:** $4,000 total ($3,000 first, $1,000 second).
- **Why us:** Hydra writes `app`, `release`, `file`, `observation` entities to Arkiv Rabdi via `@arkiv-network/sdk`. The explorer and the extension both read Arkiv as a user-facing feature.
- **Each team wins at most one Arkiv track prize**, so this is our pick.

**Qualification checklist (copy from source, exact):**
- [x] New repo, built from scratch at ETHGlobal Mumbai, follows event rules.
- [ ] Writes to Arkiv's current testnet with `@arkiv-network/sdk` or the JSON-RPC API. *(Rabdi — Jishnu)*
- [ ] At least one user-facing feature reads Arkiv data. *(Explorer + extension — Mouli)*
- [ ] README includes the wallet address(es) that wrote entities and one executable query.
- [ ] Public repo with an open-source license.
- [ ] Disclose AI usage in the submission.
- [ ] **Required files (exact paths):**
  - [ ] `/arkiv/schema.md`
  - [ ] `/arkiv/friction.md`
  - [ ] `/arkiv/reach.md`
  - [ ] `/arkiv/why-arkiv.md`
  - [ ] `/arkiv/how-you-use-arkiv.md`
- [ ] SDK installation alone is not enough; the submission must demonstrate a read.

> ⚠️ **File-location conflict to resolve with the team.** Our scaffold has `docs/ARCHITECTURE.md` and will have `docs/FEEDBACK.md`. The prize requires files at `/arkiv/*` paths at the repo root. Proposal: add an `/arkiv/` directory at the repo root and either move the files or make them short pointers (`/arkiv/schema.md` → "see docs/ARCHITECTURE.md § Records"). Decide by Phase 1 morning.

### 2. Arkiv + Swarm Bonus (From Scratch) — **stackable**
- **Prize:** +$500 on top of the Arkiv track.
- **Why us:** Hydra puts the build and manifest on Swarm; the `release` entity's `swarm_ref` attribute is the pointer. This is *exactly* what the bonus asks for.

**Qualification checklist (copy from source, exact):**
- [ ] Project uses both Arkiv and Swarm meaningfully. Arkiv-only projects are ineligible.
- [ ] **Required file:** `/arkiv/swarm.md` containing all of:
  - [ ] What lives on Swarm vs. what lives on Arkiv.
  - [ ] The entity field that holds the Swarm reference (for us: `release.swarm_ref`).
  - [ ] One entity key with a Swarm reference, linked so a judge can verify.
  - [ ] Postage stamp batch ID and the wallet that purchased it.
  - [ ] Bee node or hosted service used for uploads.
  - [ ] The files in the repo that upload to and read from Swarm.
  - [ ] Reproducible steps for one upload and one read.
  - [ ] Demo-video timestamp where Swarm is used.
  - [ ] Friction encountered.
- [ ] **Do not** store encrypted Swarm references directly in public Arkiv entities — encrypt first, or keep off-chain. *(We only store plain refs, so this is a note, not a blocker.)*
- [ ] On submission, select "Build on Arkiv (From Scratch)" and tick the bonus.

### 3. Swarm standalone — **not eligible**
- The Swarm prize is only offered as the Arkiv + Swarm bonus. A Swarm-only project does not qualify.

## Tracks we are *not* entering, and why

- **Mirror Something Ethereum Depends On** ($3k/$1k): requires mirroring a public dataset into Arkiv (not Sourcify). Hydra is building a new dataset, not mirroring one.
- **Node Tooling** ($2k): requires the submission to operate alongside an Arkiv node. Hydra uses the public RPC, not a side-car tool on the node.
- **Build on Arkiv (Existing Projects)**: Continuity Track only; Hydra is new work.

## Open questions for the Arkiv stall

> Manish: ask these at the stall on 5 Nov and fill answers inline.

1. Public RPC rate limits on Rabdi: what are the per-key limits, and is there a batch write path? *(We may need to write many `file` records per release.)*
2. Max per-entity expiry — the docs say 7,884,000 blocks (~182.5 days). Is that the hard max, and can we extend before expiry?
3. Best way to index many small records (per-file hashes) without hitting query-page limits (100 rows). Do they recommend a different pattern?
4. Mainnet timing — is there a Rabdi-to-mainnet deadline that would affect the demo window or post-event story?
5. Faucet cooldown numbers (prior-learnings notes this is undocumented).
6. For the judging, which wallet should sign? One Hydra wallet or per-team? (We plan to use one.)

**Answers (fill in):**
- _(pending stall visit)_

## Submission hygiene

- Open-source license at the repo root (MIT or Apache-2.0 — team to pick).
- Add AI-usage disclosure to the submission text.
- README gets: wallet address(es) that wrote the entities + one executable query.
- Include demo video with a visible Swarm-upload moment.
