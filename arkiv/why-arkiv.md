# Why Arkiv

## If we swapped Arkiv for Postgres, what would our users lose?

Hydra's promise is that the record of "which build did the team release" does not depend on
trusting our server. With Postgres behind our API, a user, a wallet vendor or a security researcher
could only ask us what a team released, and we could change the answer or go offline.

With Arkiv, the records are public entities on a chain, created by a known wallet, and anyone can
query them with SQL-like filters without a key from us: the explorer does exactly that in the
browser, and the README query reproduces it. If the Hydra API disappeared, every release, file hash
and observation would still be readable and checkable.

Two more things we would have had to build ourselves:

- **Expiry as a feature.** Observations live 3 days, so "checked recently" means "an observation
  exists" and the log cleans itself. App names are 30-day leases that a publish extends, so an
  abandoned name frees itself. In Postgres that is cron jobs and delete queries to write and trust.
- **Owner-scoped reads.** Because every entity has a creator wallet, our readers only accept
  records from the Hydra wallets, which is what stops a stranger's fake release from showing up.

Honest limit: Arkiv gives public, tamper-evident records, not a trustless publisher. One API wallet
signs the writes, so users trust that wallet and the API's ownership rule for who may publish a
name. Arkiv makes that trust checkable; it does not remove it.

## What did we keep off Arkiv, and why?

| Kept off Arkiv | Where it lives | Why |
|---|---|---|
| The built site files and the manifest copy | Swarm (`release.swarm_ref` points to them) | Too large for entities, and content-addressed storage fits an immutable build |
| API keys, the signing secret, bot tokens, alert destinations | Host environment on Render, never in git | Arkiv entities are public |
| The raw HTML of live sites | Not stored | Only script hashes and URLs are recorded; HTML changes on every request |
| Inline scripts and anything past the first 60 scripts of a site | Not checked | Size and time limits; stated as limits in the indexer README |
| Payloads over 128 KiB | Rejected with an error telling the caller to trim or use Swarm | Arkiv's body limit |
