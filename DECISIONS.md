# DECISIONS.md

Every decision taken after `docs/ARCHITECTURE.md` was written: date, topic, decision, why. Where
this file and another disagree, **this file wins, because it is dated**, and the other file is
corrected to match.

**Hand-written, append-only, newest last.** An `OP-N` whose Status starts with `decided` must have
a row here naming it; `node scripts/board.mjs` fails otherwise. Add the row in the same PR as the
decision. If two PRs add a row at once, git conflicts on the last line, and the fix is to keep
both rows.

The Why column is one sentence. Reasoning and the options that lost go on the OP row.

| Date | Topic | Decision | Why | Ref |
|---|---|---|---|---|
| 2026-11-05 | Scope | Build on Arkiv and Swarm only. No ENS, no wallet plugin, no rollback runner. | Agreed with a judge: the clearest story for the Arkiv tracks and the Arkiv + Swarm bonus in 2 days. | chat, 5 Nov |
| 2026-11-05 | Onboarding | Teams publish with one API key; the API holds the testnet-funded Arkiv wallet and the Swarm postage batch. | A team should not need a wallet, tokens or chain knowledge to try it. | chat, 5 Nov |
| 2026-11-05 | Cold start | An indexer records what popular dApp frontends serve, before they onboard. | The judge suggested indexing; it makes the explorer and extension useful on day one. | chat, 5 Nov |
| 2026-11-05 | Process | The agon-dev protocol: claim PR, then feature PR, board lint in CI, OP queue for humans. | Three people and their agents work in parallel without stepping on each other. | T-A00 |
| 2026-11-05 | Pre-event spikes | Nothing is copied from the pre-event spike repo into this repo. | The event rules; we reuse what the spikes taught, not their code. | README |
| 2026-11-05 | Arkiv network | Use the Rabdi testnet (chain 7794095) with an access key, not Tiramisu. | Arkiv's docs list Tiramisu as "Replaced by Rabdi"; our spike ran on Tiramisu. | docs.arkiv.network/networks |
| 2026-11-05 | Onboarding flow | Temp site: wallet signs one message, the API issues a stateless signed API key; teams copy a workflow template that runs a no-dependency publish script served by the API. API is a separate Node server (Render or Fly) next to the Bee node; it also serves reads so the access key stays server side. | Fastest path to a full end-to-end test; Mouli folds the site into the explorer later. | T-A09 |
| 2026-11-06 | Swarm stamping | Upload through the EF public gateway, which stamps for us; no postage batch. `SWARM_POSTAGE_BATCH_ID` stays optional for an own Bee node. | T-F02 uploaded without a batch id and read the manifest back byte-identical; OP-2 needs no faucet or Bee node. | OP-2, T-F02 |
| 2026-11-06 | Alerts | Next slice is checkers plus alerts: a DNS checker from 2 resolvers, alert subscriptions stored encrypted on Arkiv as 30-day leases, and Standard Webhooks plus Discord and Slack delivery. | Research leads (sources not yet opened): in the 2026 CoW Swap and Name.com hijacks a third party warned first and teams warned 47 min to hours later, and the attacks were DNS-level, which script hashing alone sees late. | T-A16, T-A17, T-A18 |
| 2026-11-06 | Indexer order | Domain proof (T-A19) first, then coverage with write on change (T-A20), then alerts; the DNS checker shrinks to NS and CNAME, if time allows. Jina stays for the second view; Playwright in Actions and SearXNG wait until after the event. | Free DNS monitors exist (sources opened), so our difference is the public record compared with a proven release, and that needs a domain bound to an app. Write on change keeps 227 sites at about 70 tx a day. | T-A19, T-A20, T-A16 |
| 2026-11-06 | Swarm network | Use the Swarm testnet gateway `https://api.gateway.testnet.ethswarm.org`, not `api.gateway.ethswarm.org`, for uploads and reads. | The latter is mainnet (a testnet reference returns 404 there) and the project is testnet only; the testnet gateway also stamps uploads, 4 of 5 fixture files read back byte-identical and HTML is blocked the same way. | OP-11, T-A21 |
| 2026-11-06 | Plan to submission | Demo loop first (T-D04 demo dApp bound to its release, staged script change, Telegram alert, extension), then the prize files. T-A16 (DNS) and T-A17 (subscriptions) are cut, T-A18 ships as Telegram only. Feature freeze 7 Nov 05:00 IST, video 06:30, submit 08:00 (deadline about 09:00 IST, unconfirmed). | The repo is private with no license and only 1 of 6 required /arkiv files exists, which disqualify us before any feature matters; the demo needs one bound site to show a real match or mismatch. | T-D04, T-D10, T-J03, OP-6 |
| 2026-11-06 | Swarm network (supersedes the row above) | Keep uploads on the free public gateway `api.gateway.ethswarm.org` for the event, not the testnet gateway. | Render is on the free plan so only its owner can change the env, and the bonus text sets no Swarm network; no funds are spent and Arkiv stays on Rabdi testnet. Jishnu to confirm. | OP-11, T-A21 |
