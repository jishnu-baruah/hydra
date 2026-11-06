# indexer

Every 15 minutes: fetch each site in `targets.json` (Manish), hash every script it loads (`<script
src>`, modulepreload), compare with the app's latest Hydra release, and write 1 `hydra.observation`
per site to Arkiv from the indexer wallet. Owner: Jishnu.

```bash
node --env-file=../../.env src/main.ts          # forever (needs ARKIV_INDEXER_PRIVATE_KEY)
node --env-file=../../.env src/main.ts --once   # one run
node src/main.ts --dry                          # one run, print only, no key, no writes
```

- **Status:** `match` (every script is in the release), `mismatch` (CHANGED, EXTRA or UNREADABLE),
  `unknown` (no Hydra release for this site yet: still recorded, with its script hashes).
- **Change detection:** the body says `changed: true` when a site's script set differs from the
  previous run, for every site, onboarded or not.
- **Second view (T-A14, needs `JINA_KEY`):** Jina's reader renders each page in a browser from
  another network. Third-party script origins seen only at runtime are recorded; with a release,
  any the release does not list is `RUNTIME_ORIGIN` (mismatch); without one, only origins new since
  the previous run are flagged (`NEW_RUNTIME_ORIGIN`). Sites that block us directly are read through
  the renderer (`DIRECT_BLOCKED`), and every script is still hashed by a direct fetch.
- **Expiry:** observations live 3 days, so "checked recently" is "an observation exists".
- **Cost:** 20 sites = 2 transactions, about 0.0053 tGLM per run, about 0.5 tGLM per day.
- **Limits:** 60 scripts per site (Uniswap loads 713); regex-grade HTML parsing; inline scripts
  are not checked (Next.js Flight data, spike T12). A host can serve the indexer clean files and
  victims bad ones (spike T8); the extension is the better vantage point.

Binding: a site is compared with a release only when that app's latest manifest lists the domain (the API adds it after the `/.well-known/hydra.txt` proof passed). A `targets.json` app label alone binds nothing, so the site stays `unknown`. A bound site is re-proved every run; if the proof fails the status is `mismatch` with `DOMAIN_PROOF_LOST <reason>`. An unreadable file (network, timeout, 5xx) is only `DOMAIN_PROOF_UNREACHABLE`; the script compare decides.
- **Safe fetch:** pages and scripts are fetched with `safeGet` from `@hydra/core`: https on the default port,
  no IP-literal hosts, public addresses only, pinned connection, each redirect rechecked (at most 3).
  A script on plain http or a private host is recorded as unreadable.
