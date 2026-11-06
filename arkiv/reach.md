# Reach

## Who is it for, and would they use it?

- **dApp frontend teams** that want a tamper-evident public record of every release. They add one
  GitHub Action and one secret; no wallet or token handling. The 2026 front-end hijacks (CoW Swap in
  April, a dozen DeFi sites at one registrar in October) were flagged by outside security firms
  at about the same time as, or before, the teams' own warnings, which is the gap this fills. We have not verified those incident
  details against primary sources yet.
- **Users of dApps** who want a check before they sign: the browser extension compares the scripts a
  page serves with the team's latest release and warns on a mismatch.
- **Wallets, researchers and security tools** that want to read the same records without asking us.

We do not have outside users yet, and we do not claim demand. What exists today is measured, not
projected: 10 releases from 8 app names published through the live API (3 of them with a Swarm
reference; try the query in the README), and the indexer has recorded 250 public sites. Only our own demo site is bound to a
release; the others show as "unknown" until a team publishes.

## Can people try it today, and will we keep building it?

Today, with a wallet and a GitHub repo:

1. Sign in on https://hydra-site-one.vercel.app for an API key and copy the handoff block into an
   AI coding agent or your workflow. The key is stored as a repo secret and the Action publishes.
2. Check what the system recorded: https://hydra-site-one.vercel.app/activity/ (everything the API
   wrote) and https://hydra-site-one.vercel.app/indexed/ (every site the indexer watches).
3. See a live match and a staged mismatch on https://hydra-demo-dapp.vercel.app, a demo dApp we
   bound to a release. The explorer and the extension are in the repo with install steps.

After Mumbai: the record format is open and readable by anyone without us, which is deliberate. Beyond
that we have not decided whether the team keeps running the indexer and the API; this file will be
updated if that changes.
