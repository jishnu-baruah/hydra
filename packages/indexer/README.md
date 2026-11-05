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
- **Expiry:** observations live 3 days, so "checked recently" is "an observation exists".
- **Cost:** 20 sites = 2 transactions, about 0.0053 tGLM per run, about 0.5 tGLM per day.
- **Limits:** 60 scripts per site (Uniswap loads 713); regex-grade HTML parsing; inline scripts
  are not checked (Next.js Flight data, spike T12). A host can serve the indexer clean files and
  victims bad ones (spike T8); the extension is the better vantage point.
