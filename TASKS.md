# TASKS.md, the Hydra board

The board and the lock. Nothing else is the board: not an issue tracker, not a chat message.

**If you are an agent or a person about to write code, read sections 1 to 3 first. They are the
whole protocol. Then claim exactly one task and work only on that task.**

Scope and record formats: `docs/ARCHITECTURE.md`. Decisions taken since: `DECISIONS.md`, which
wins where the two disagree, because it is dated. Human-only blockers: `OPERATOR_TODO.md`.

Event: ETHGlobal Mumbai. Day 0 is 2026-11-05 (evening), day 1 is 2026-11-06, submission is the
morning of 2026-11-07 (check the exact deadline on the ETHGlobal dashboard and write it here).

**Goal by submission:** a judge watches one live run of both flows. (1) A demo team's GitHub
Action publishes a release that lands on Swarm and Arkiv and shows in the explorer. (2) We change
one file on the live demo site; the extension turns red and the explorer shows the mismatch.

---

## 1. The lock: claim before you write code

One task, one owner, one branch, one PR. The race is settled by git, not by asking.

`main` takes pull requests only. A claim is a tiny PR carrying one line, and that is what keeps
the race resolvable: the second claim PR on the same task conflicts on that exact line and cannot
merge.

```bash
git checkout main && git pull --ff-only origin main
git checkout -b claim/t-a02
# edit ONLY the `- Status:` line of the task you want, nothing else in the file
git commit -am "claim T-A02" && git push -u origin claim/t-a02
gh pr create --fill --base main && gh pr merge --auto --squash --delete-branch
```

If the merge is refused for a conflict, or the board lint says the task is already claimed,
**someone beat you to it. Pick another task. Never work on a task claimed by someone else.**

Then branch off the updated `main` and do the work:

```bash
git checkout main && git pull --ff-only origin main
git checkout -b feature/t-a02-publish-api
```

Rules the `board` CI job enforces:

- A claim PR is branch `claim/t-<id>` and may change **only** `- Status:` lines in `TASKS.md` and
  `OPERATOR_TODO.md`. Anything else in that diff fails.
- A work PR is branch `feature/t-<id>-<slug>` and must match the `Branch:` in the row you claimed.
- Adding, cutting or rewording a task goes in a `board/<slug>` PR that touches only `TASKS.md`,
  `OPERATOR_TODO.md` and `DECISIONS.md`.
- Two owners on one task fails the lint. `Status: done` without a real `Evidence:` fails the lint.
- `secrets`, `checks` and `hygiene` must be green before merging.

Status values: `open` | `claimed <date> | Owner: <name> | Branch: <branch>` |
`blocked, see OP-N` | `in-review <PR link>` | `done` | `cut <date>: <reason>`.

Hackathon speed rule: a claim PR needs no reviewer. Merge it the moment CI is green.

## 2. Every task ships as a pull request

No exceptions: one-line changes and docs included.

1. Branch from `main` after claiming.
2. Commit small. Hashing and compare logic gets its failing test first
   (`superpowers:test-driven-development`). Other code: one meaningful check per change.
3. Run `/code-review` at medium. Add `/security-review` when the diff touches `apps/api`, a key,
   or anything that signs or sends a transaction.
4. Run `superpowers:verification-before-completion` before you call it done.
5. Open the PR into `main`. Fill in every line of the template. Squash-merge.
6. Write the finding you measured into your task row, with its number ("a create took 4.1 s",
   "21 of 20 targets load a vendor script").

A second human reviews only what CI cannot see: anything in `apps/api` that holds a key or signs,
and changes to the record contract (`docs/ARCHITECTURE.md`, `packages/core/src/records.ts`), which
need the owners of the API, explorer and extension to agree. CI reviews the rest.

## 3. Rules for agent sessions

- Ponytail is on at level `full` through the `UserPromptSubmit` hook in `.claude/settings.json`.
  It restates itself every turn. Follow it.
- One agent session per claimed task, in its own worktree (`superpowers:using-git-worktrees`).
  Parallel agents never share a checkout.
- CI red or a spike fails: `superpowers:systematic-debugging` before you change any code.
- Hit something only a human can do (faucet sign-in, postage batch, a domain, a sponsor question)?
  Write an `OP-N` entry in `OPERATOR_TODO.md`, set your task to `blocked, see OP-N`, and move to
  another task. **Never fake a transaction hash, a Swarm reference or a measurement.**
- Search through the `Explore` subagent. Never paste whole files, logs or JSON into the
  conversation. One agent per task; multi-agent workflows only when a human asks for one.
- Work is credited to the person who ran the agent. No AI co-author lines in commits.
- You may edit only the files in your task's `Touches:` line. Need a file another task owns? Say
  so in the PR and let that owner change it.

Default tool per step:

| Step | Tool |
|---|---|
| Scope every change | Ponytail, level `full`, always on |
| Set up the workspace | `superpowers:using-git-worktrees` |
| Find code | `Explore` subagent |
| Library docs (Arkiv SDK, Bee, Chrome MV3) | Context7, then the vendor docs |
| Hashing, manifest and compare code | `superpowers:test-driven-development` |
| CI red or a spike fails | `superpowers:systematic-debugging` |
| Before opening a PR | `/code-review` at medium, plus `/security-review` on `apps/api` and keys |
| Claiming a task done | `superpowers:verification-before-completion` |
| Research, copy, submission text (Manish) | `/research <question>` (fast) or `/deep <question>` (cross-model verified), from the filebus-research kit; cite every source, and read the sources before trusting a number |

## 4. Task row format

```
### T-X01, Example task
- Status: open
- Suggested: <name>
- Depends-on: T-F01
- Touches: apps/example/
- Serves: Technicality (judged) ; Arkiv track
- Acceptance: 3 of 3 sample records read back with matching payloads in under 2 s each
- Evidence: <link to the PR, a tx hash, a Swarm reference, a recording>
- Kill criterion: still failing after 2 hours, so fall back to <plan B>
```

`Serves:` must name an ETHGlobal judged criterion (Technicality, Originality, Practicality,
Usability, WOW factor) or a prize (Arkiv track, Swarm bonus), or a measured metric. `Acceptance:`
must contain a number. Both are linted. `Suggested:` is who the plan expects to take it; anyone
may claim any open task.

ID ranges: `T-A` API, chain and CI (Jishnu). `T-B` explorer, `T-C` extension (Mouli). `T-D`
research, demo and docs (Manish). `T-F` feasibility spikes, each with a `Kill criterion:`. `T-J`
submission deliverables. `OP-N` operator items.

## 5. Priority, and what can run at the same time

Tasks in one wave touch disjoint files, so three people or three agents can hold one each.

| Wave | When | Parallel-safe set |
|---|---|---|
| P0 | Day 0, 5 Nov night | T-A00 **first, alone**; then T-A08, T-F01, T-F02, T-A01, T-B01, T-C01, T-F03, T-D01, T-D02, T-D03, T-D07 |
| P1 | 6 Nov morning | T-A02, T-A09, T-B02, T-B03, T-D04, T-D05 |
| P2 | 6 Nov afternoon and night | T-A04, T-A05, T-A06, T-A07, T-B04, T-B05, T-C02, T-C03, T-D06 |
| P3 | 7 Nov morning | T-J01, T-J02, T-J03, T-C04, T-B06 |

Exit checks. **P1:** a manual `curl` to the API creates a release whose manifest is on Swarm and
whose records are on Arkiv, and the explorer shows it. **P2:** the GitHub Action runs on the demo
repo, and the extension goes red when we change a file on the live site.

## 6. Qualification checklist, per prize

From pre-event research (28 Oct): Arkiv runs three tracks of $4,000 (1st $3k each) plus the
Arkiv + Swarm bonus of $1,000. T-D02 replaces this list with the exact rule text; until then, this
is what we must be able to show. Tick in a `board/` PR as items land.

**Arkiv track**
- [ ] Arkiv is on the critical path: `release`, `file` and `observation` records written and read live (T-A02, T-A06, T-B02)
- [ ] The explorer reads Arkiv directly in the browser, no backend (T-B01)
- [ ] README section "How we used Arkiv" with explorer links to at least 2 transactions and the query we run
- [ ] Builder feedback in docs/FEEDBACK.md (T-J03)
- [ ] Which of the three Arkiv tracks we enter is confirmed (OP-4, T-D02)

**Arkiv + Swarm bonus**
- [ ] Every release's build and manifest is on Swarm, with `swarm_ref` on its Arkiv record (T-A02)
- [ ] A Swarm gateway link a judge can open from the explorer (T-B02)
- [ ] README section "How we used Swarm" with at least 1 reference

**ETHGlobal submission**
- [ ] Code a judge can open: the repo is private today (OP-6)
- [ ] Demo video within the event's rules, every submission field filled (T-J02, T-J03)

---

# P0, day 0. Nothing branches until T-A00 lands.

### T-A00, Workspace, CI and the board
- Status: done
- Suggested: Jishnu
- Depends-on: none
- Touches: CLAUDE.md, TASKS.md, OPERATOR_TODO.md, DECISIONS.md, README.md, .env.example, docs/ARCHITECTURE.md, docs/prior-learnings.md, .github/, scripts/board.mjs, .claude/
- Serves: unblocks every task ; Practicality (judged)
- Acceptance: board lint passes on 30 rows; a claim PR that edits a non-Status line fails CI in 1 run
- Evidence: https://github.com/jishnu-baruah/hydra/pull/1 (merged as cef6743; hygiene, checks and secrets green)
- Finding: GitHub showed the PR on a stale head for over 2 minutes after a push and refused the merge as out of date; closing and reopening the PR resynced it at once.

### T-A08, Core write safety and key hygiene
- Status: in-review | Branch: feature/t-a08-write-safety
- Suggested: Jishnu
- Depends-on: T-A01
- Touches: packages/core/, docs/ARCHITECTURE.md
- Serves: Technicality (judged) ; Arkiv track
- Known: Arkiv guides/known-issues and guides/quickstart (SDK 1.0.1): no automatic write resend; explicit latest nonce and gasPrice; gas >= max(1,000,000, 2 x estimate) and <= half the block gas limit; receipt.status must be success; keyed RPC URLs are secrets; eth_getLogs only reaches about 1,000 blocks back
- Acceptance: writes go through 1 guarded path that sends at most 1 transaction per call with the gas rule applied; reads retry up to 3 times; 0 errors contain an RPC URL; all tests pass offline
- Evidence: <PR link>

### T-F01, Arkiv on Rabdi: write, query, timings
- Status: open
- Suggested: Jishnu
- Depends-on: OP-1
- Touches: spikes/F1/
- Serves: Technicality (judged) ; Arkiv track
- Known: spike T7 (Tiramisu): SDK 0.8.1 works; creates took 3 to 7 s; uppercase names revert; numbers default to i32. See docs/prior-learnings.md
- Acceptance: on Rabdi (chain 7794095) with an access key, 1 `release` and 20 `file` records written with ARCHITECTURE.md attributes and the maximum lifetime; all 21 queried back by project+type; lowercase-name and u64 rules re-confirmed; median create time and the SDK version written in result.json. Limits are already documented, so target 45 minutes.
- Evidence: <spikes/F1/result.json at a commit, tx hashes>
- Kill criterion: 20 file records take over 2 minutes, so index external scripts only and drop per-file records

### T-F02, Swarm upload and read spike
- Status: open
- Suggested: Jishnu
- Depends-on: OP-2
- Touches: spikes/F2/, docs/swarm.md
- Serves: Technicality (judged) ; Swarm bonus
- Acceptance: a 5-file folder uploaded to the Swarm testnet and all 5 files read back byte-identical through a gateway URL; steps written in docs/swarm.md
- Evidence: <Swarm reference and gateway URL>
- Kill criterion: no working upload after 3 hours, so keep the manifest in the Arkiv payload and mark the Swarm bonus at risk in DECISIONS.md

### T-F03, Extension can hash the scripts a page loads
- Status: done
- Suggested: Mouli
- Depends-on: none
- Touches: spikes/F3/
- Serves: Technicality (judged) ; Usability (judged)
- Known: spike T4: fetch() decodes gzip and brotli, so re-fetched hashes match served bytes; T12: on Next.js, check scripts by policy, not HTML
- Acceptance: on 5 real dApp pages, the extension background worker lists every script URL and hashes it; 5 of 5 pages succeed, CORS failures counted
- Evidence: spikes/F3/result.json in https://github.com/jishnu-baruah/hydra/pull/10 (5 of 5 pages, 1081 of 1081 scripts hashed, 0 worker failures; 2 of 1081 page-context fetches failed CORS or network)
- Kill criterion: over 2 of 5 pages fail for CORS, so hash only same-origin scripts and say so in the UI
- Finding: Uniswap serves 0 of 816 scripts from its own origin (780 from cdn.app.uniswap.org), so a same-origin-only fallback checks nothing; every script that changed between 2 fetches (3 in run 1, 2 in run 2) was a Cloudflare /cdn-cgi/challenge-platform/ bot check, which T-C02 must allow or Cloudflare sites go red.

### T-A01, packages/core: records, hashing, Arkiv client
- Status: in-review | Branch: feature/t-a01-core
- Suggested: Jishnu
- Depends-on: T-A00
- Touches: packages/core/
- Serves: Technicality (judged)
- Known: spike T7: lowercase attribute names and u64(BigInt(ms)) timestamps are mandatory; print the innermost viem cause on revert
- Acceptance: sha256 helper matches `sha256sum` on 3 fixture files; Arkiv wrapper retries 3 times; 1 test per record type encodes lowercase attributes and u64 times
- Evidence: <PR link>

### T-B01, Explorer scaffold that reads Arkiv in the browser
- Status: done
- Suggested: Mouli
- Depends-on: T-A00
- Touches: apps/explorer/
- Serves: Usability (judged) ; Arkiv track
- Acceptance: the explorer page renders 1 record read live from Arkiv testnet in the browser with no backend, in under 3 s
- Evidence: https://github.com/jishnu-baruah/hydra/pull/15, screenshot apps/explorer/evidence/t-b01-entity.png (a live Rabdi entity with 31 attributes rendered in 682 to 1103 ms over 9 runs, public RPC, no key)
- Finding: Arkiv SDK 1.0.1 ESM does not load on Node 22.17 (ERR_REQUIRE_CYCLE_MODULE on a 0-byte dist chunk) but loads in the browser from jsdelivr in about 2 s; mixing 2 CDNs broke every query; 0 hydra.release records exist yet, so home shows the empty state.

### T-C01, Extension scaffold with a 3-state badge
- Status: done
- Suggested: Mouli
- Depends-on: T-A00
- Touches: apps/extension/
- Serves: Usability (judged)
- Acceptance: loads unpacked in Chrome; the badge shows all 3 states (green, red, grey) driven by a hard-coded verdict
- Evidence: https://github.com/jishnu-baruah/hydra/pull/6 (unpacked into Chromium, 3 of 3 badge states read back via chrome.action.getBadgeText, 0 service worker errors)
- Finding: tab-scoped badge state is kept by Chrome, so 3 tabs showed 3 different badges at once with 0 lines of storage code; non-web pages (chrome://, file://) get no badge so grey only means "a site with no release".

### T-D01, Research: what data is already on Arkiv
- Status: open
- Suggested: Manish
- Depends-on: none
- Touches: docs/research-arkiv-data.md
- Serves: Originality (judged) ; Arkiv track
- Acceptance: at least 3 existing Arkiv datasets or apps described (including sourcify.arkiv.network), each with a working query example and 1 idea for using it in the explorer or extension
- Evidence: <doc link>

### T-D02, Prize rules for Arkiv and the Arkiv + Swarm bonus
- Status: open
- Suggested: Manish
- Depends-on: none
- Touches: docs/prizes.md
- Serves: Arkiv track ; Swarm bonus
- Acceptance: the exact qualification text for 2 prizes copied with links, and a checklist of every item we must show
- Evidence: <doc link>

### T-D03, Indexer target list
- Status: open
- Suggested: Manish
- Depends-on: none
- Touches: packages/indexer/targets.json
- Serves: Practicality (judged) ; WOW factor (judged)
- Acceptance: 15 to 20 live dApp frontends with name, domain and category, each opened in a browser to confirm it loads
- Evidence: <PR link>

### T-D07, Research kit wired into the repo
- Status: done
- Suggested: Jishnu
- Depends-on: none
- Touches: scripts/research.mjs, .claude/commands/, CLAUDE.md, README.md
- Serves: unblocks T-D01, T-D02 ; Practicality (judged)
- Acceptance: /research answers 1 question with citations and a computed verdict in under 60 s, run from this repo, leaving 0 new files in it
- Evidence: https://github.com/jishnu-baruah/hydra/pull/5 (merged as b07d341)
- Finding: a question answered in 13 s with 3 cited sources and 0 files left in this repo; a fast answer passed the verify gate with a wrong hex conversion, so answers are leads

# P1, 6 Nov morning

### T-A02, Publish API: POST /v1/releases
- Status: in-review | Branch: feature/t-a02-publish-api
- Suggested: Jishnu
- Depends-on: T-A01, T-F01, T-F02
- Touches: apps/api/, packages/core/
- Serves: Technicality (judged) ; Arkiv track ; Swarm bonus
- Scope: also wallet sign-in (signed message) to stateless API keys, and read routes the site and explorer use, so the Arkiv access key stays on the server
- Acceptance: one call with a valid key uploads the build to Swarm and writes 1 release plus N file records; a bad key gets 401 with 0 writes; returns entity keys and swarm_ref
- Evidence: <curl transcript, tx hashes, Swarm reference>

### T-A03, Register apps and domains: POST /v1/apps
- Status: cut 2026-11-05: replaced for the temp flow by wallet sign-in keys (T-A02, T-A09); domain checks come back after the demo
- Suggested: Jishnu
- Depends-on: T-A02
- Touches: apps/api/src/apps.ts
- Serves: Practicality (judged)
- Acceptance: registering checks /.well-known/hydra.txt on 1 real domain and writes 1 app record; a domain without the file is refused with the reason
- Evidence: <curl transcript, tx hash>

### T-B02, Explorer app page with release history
- Status: blocked, see OP-7 | Branch: feature/t-b02-app-page
- Suggested: Mouli
- Depends-on: T-B01, T-A02
- Touches: apps/explorer/app/, apps/explorer/src/arkiv.js, apps/explorer/search/page.js
- Serves: Usability (judged)
- Acceptance: an app page lists all releases newest first with version, commit, time, file count and a working Swarm link, for 1 real published app
- Evidence: tests 4 of 4 in apps/explorer/app/releases.test.mjs; live Rabdi reads with the publisher filter run with 0 errors but return 0 releases, so the real-app check waits for OP-7
- Finding: the publisher wallet holds 5 tGLM and has sent 0 transactions, so the blocker is a first publish, not funding; every Hydra record comes from that 1 wallet, so the explorer now trusts only entities created by it

### T-B03, Explorer search
- Status: blocked, see OP-7 | Branch: feature/t-b03-explorer-search
- Suggested: Mouli
- Depends-on: T-B01
- Touches: apps/explorer/search/, apps/explorer/src/arkiv.js, apps/explorer/index.html
- Serves: Usability (judged) ; Originality (judged)
- Acceptance: search finds the right app from 4 kinds of input: domain, app name, file sha256 and Swarm reference
- Evidence: https://github.com/jishnu-baruah/hydra/pull/19 (4 of 4 input kinds resolve offline; live Rabdi queries run with 0 errors but 0 Hydra records exist, so the real-app check waits for OP-1 and T-A02)
- Finding: anyone can write an entity tagged hydra.app, so search and the home list must filter by the API wallet address (ownedBy) before showing real data; a bare 64-hex input is ambiguous (file sha256 or Swarm ref), so both are queried.

### T-D04, Demo dApp on a domain we control
- Status: open
- Suggested: Manish
- Depends-on: OP-3
- Touches: demo/
- Serves: WOW factor (judged)
- Known: spike T6: Vercel previews inject a vercel.live script and are login-protected, so demo and check the production deployment only
- Acceptance: a 1-page static site with 1 JS file and 1 vendor script, live on Vercel at our domain, deployed from its own repo
- Evidence: <live URL>

### T-D05, Demo script, timed
- Status: open
- Suggested: Manish
- Depends-on: none
- Touches: docs/demo.md
- Serves: WOW factor (judged)
- Acceptance: a 3-minute script covering both flows and the indexer, run once against a timer, with the real time written down
- Evidence: <doc link>

### T-A09, Temp onboarding site: wallet sign-in, API key, repo template
- Status: in-review | Branch: feature/t-a09-onboarding-site
- Suggested: Jishnu
- Depends-on: T-A02
- Touches: apps/site/
- Serves: Usability (judged) ; Practicality (judged)
- Scope: temporary; Mouli merges it into the explorer later
- Acceptance: a new user connects a wallet, signs 1 message, gets an API key and a filled-in workflow template, and their first push lands a release on Arkiv, in under 5 minutes end to end
- Evidence: <PR link>

# P2, 6 Nov afternoon and night

### T-A04, Deploy the API with HTTPS
- Status: claimed 2026-11-05 | Owner: Jishnu | Branch: feature/t-a04-deploy-api
- Suggested: Jishnu
- Depends-on: T-A02
- Touches: apps/api/deploy/
- Serves: Practicality (judged)
- Acceptance: the public URL answers 3 of 3 health checks; the wallet key is in host secrets only, confirmed by 0 matches in the repo
- Evidence: <URL>

### T-A05, GitHub Action
- Status: in-review | Branch: feature/t-a05-publish-script
- Suggested: Jishnu
- Depends-on: T-A04
- Touches: packages/action/
- Serves: Practicality (judged) ; Usability (judged)
- Acceptance: on the demo repo, 1 push to main hashes the build and its external scripts, calls the API and prints the explorer link, in under 2 minutes
- Evidence: <Actions run link>

### T-A06, Indexer on a timer
- Status: open
- Suggested: Jishnu
- Depends-on: T-A01, T-D03
- Touches: packages/indexer/
- Serves: WOW factor (judged) ; Arkiv track
- Known: spike T4 algorithm (1-byte change caught next poll, 0 false positives in 30 min) and T12 Next.js policy (6 of 6 attacks, 0 false positives). See docs/prior-learnings.md
- Acceptance: runs every 15 minutes over all targets and writes 1 observation per target per run; a changed script flips status to mismatch within 1 run
- Evidence: <tx hashes, explorer link>

### T-A07, End-to-end test against testnet
- Status: open
- Suggested: Jishnu
- Depends-on: T-A05
- Touches: scripts/e2e.mjs
- Serves: Technicality (judged)
- Acceptance: one command publishes a release, reads it back from Arkiv and Swarm and checks 1 bad key is refused; passes 3 runs in a row
- Evidence: <CI or local run log>

### T-B04, Explorer events timeline
- Status: open
- Suggested: Mouli
- Depends-on: T-B02, T-A06
- Touches: apps/explorer/events/
- Serves: WOW factor (judged) ; Usability (judged)
- Acceptance: one timeline mixes releases and observations newest first, and a planted script change appears within 1 indexer run
- Evidence: <recording>

### T-B05, Pages for sites that have not onboarded
- Status: open
- Suggested: Mouli
- Depends-on: T-B04
- Touches: apps/explorer/observed/
- Serves: Practicality (judged) ; Originality (judged)
- Acceptance: all 15 or more indexed targets have a page labelled "observed, not published by the team" with their observation history
- Evidence: <deployed URL>

### T-C02, Extension compare logic
- Status: blocked, see OP-7 | Branch: feature/t-c02-compare
- Suggested: Mouli
- Depends-on: T-C01, T-F03, T-A02
- Touches: apps/extension/src/compare/, apps/extension/src/background.js, apps/extension/src/verdict.js, apps/extension/manifest.json
- Serves: Technicality (judged) ; Usability (judged)
- Known: spike T4 compare algorithm and T12 Next.js rules; the extension is the best vantage point against cloaking (T8). See docs/prior-learnings.md
- Acceptance: on the demo site, green with 0 mismatches; after changing 1 line of the JS on the host, red naming that 1 file, within 1 reload
- Evidence: 7 of 7 tests in apps/extension/src/compare/compare.test.mjs; end to end in Chromium against a local demo site and a local stand-in for the API read routes, 3 of 3 runs: green in about 2.7 s, then 1 line added to app.js on the host turns it red naming /assets/app.js within 1 reload. The live demo site check waits for OP-7 (a first publish) and T-D04
- Finding: the API ignores domains until ownership is provable, so the extension finds the app from the page's own script hashes (1 lookup per hash, up to 5); a site whose every script was swapped would then look unknown, so the extension remembers each site's app after the first match and shows it red instead of grey

### T-C03, Warning banner and popup detail
- Status: in-review https://github.com/jishnu-baruah/hydra/pull/37 | Branch: feature/t-c03-banner-popup
- Suggested: Mouli
- Depends-on: T-C02
- Touches: apps/extension/src/ui/, apps/extension/src/popup.html, apps/extension/src/popup.js, apps/extension/src/background.js, apps/extension/manifest.json, apps/extension/evidence/
- Serves: Usability (judged) ; WOW factor (judged)
- Acceptance: a red banner lists every mismatched script (up to 10) and links to the app's explorer page; a grey state says "no release on record" for 1 unknown site
- Evidence: apps/extension/evidence/t-c03-*.png; end to end in Chromium, 3 of 3 runs, 10 of 10 checks: the red banner names 1 changed file and links to the explorer page, lists 10 of 12 flagged scripts then "and 2 more", comes back when the page removes it, stays dismissed, and stays styled under a page CSP of style-src 'none'; the popup reads "No release on record" on example.com
- Finding: a hidden attribute loses to a display rule in the same stylesheet, so the grey popup showed an empty explorer button while a test that read the attribute passed; the check now asks whether the element is visible, and fails without the fix

### T-D06, Get-started page and per-app READMEs
- Status: open
- Suggested: Manish
- Depends-on: T-A05
- Touches: docs/get-started.md, apps/*/README.md, packages/*/README.md
- Serves: Usability (judged) ; Practicality (judged)
- Acceptance: a new team can publish from the doc alone in 3 steps; tested once by someone who did not write the action
- Evidence: <doc link, name of the tester>

# P3, 7 Nov morning

### T-C04, Package the extension
- Status: open
- Suggested: Mouli
- Depends-on: T-C03
- Touches: apps/extension/
- Serves: Usability (judged)
- Acceptance: a zip plus load-unpacked steps that work on 1 clean Chrome profile in under 2 minutes
- Evidence: <zip link>

### T-B06, Deploy the explorer
- Status: open
- Suggested: Mouli
- Depends-on: T-B05
- Touches: apps/explorer/deploy/
- Serves: Usability (judged)
- Acceptance: the public URL loads the home page and 1 app page in under 3 s each
- Evidence: <URL>


### T-B07, Landing page and explorer design from the interface template
- Status: done
- Suggested: Mouli
- Depends-on: T-B03
- Touches: apps/explorer/index.html, apps/explorer/assets/, apps/explorer/releases/, apps/explorer/search/index.html, apps/explorer/search/page.js, apps/explorer/src/main.js, apps/explorer/README.md
- Serves: Usability (judged) ; WOW factor (judged)
- Acceptance: a landing page plus the releases, search and entity views share 1 token set with text contrast of at least 4.5:1; 0 page errors and no horizontal scroll at 375 px and 1440 px; reduced motion turns off smooth scroll and every animation
- Evidence: https://github.com/jishnu-baruah/hydra/pull/28 (0 page errors and no horizontal scroll at 1440 px and 375 px on 5 views; text contrast 5.7:1 to 16.9:1; reduced motion stops all 4 kinds of motion)
- Finding: the template look needs none of its about 60 packages: 1 CSS file, a 20-line split-flap and Lenis reproduce it, and IntersectionObserver replaces GSAP in about 15 lines.
### T-J01, Public action repo for the Marketplace
- Status: open
- Suggested: Jishnu
- Depends-on: T-A05
- Touches: packages/action/
- Serves: Practicality (judged)
- Acceptance: a public repo with action.yml at its root, used by the demo repo in 1 green run
- Evidence: <repo link, run link>

### T-J02, Backup demo video
- Status: open
- Suggested: Manish
- Depends-on: T-C02, T-A05
- Touches: docs/submission/
- Serves: WOW factor (judged)
- Acceptance: a recording of the full demo under 4 minutes, covering both flows
- Evidence: <video link>

### T-J03, Submission text and Arkiv feedback
- Status: open
- Suggested: Manish
- Depends-on: T-D02
- Touches: docs/submission/, docs/FEEDBACK.md
- Serves: Arkiv track ; Swarm bonus
- Known: docs/prior-learnings.md lists 4 Arkiv doc issues from the spike; recheck each on Rabdi before filing
- Acceptance: every submission field filled; 1 section each for Arkiv and Swarm with at least 2 tx hashes and 1 Swarm reference; FEEDBACK.md lists at least 3 builder issues
- Evidence: <submission link>
