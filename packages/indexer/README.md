# indexer

Scheduled (GitHub Actions): fetch each site in `targets.json` (Manish) plus the top `INDEXER_TOP` (227) protocols by TVL from DefiLlama (`api.llama.fi/protocols`), hash every script it loads (`<script
src>`, modulepreload), compare with the app's latest Hydra release, and write a `hydra.observation`
to Arkiv, only when the site changed (see Cost) from the indexer wallet. Owner: Jishnu.

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
- **Cost:** earlier observations are read back from Arkiv (last 3 days, indexer wallet), not memory. A site is written only when its status, script hash or problem codes changed, or once a day as a heartbeat; unchanged sites are skipped, so a steady run costs a few transactions (10 per tx) instead of one per site. Jina is called only for a first sight, a site last seen over 24 h ago, a changed script hash, or a blocked direct fetch; otherwise the previous runtime origins are reused. Concurrency is `INDEXER_POOL` (8). A dry run reads for `HYDRA_INDEXER_ADDRESS`, or the address of `ARKIV_INDEXER_PRIVATE_KEY` if set.
- **Limits:** 60 scripts per site (Uniswap loads 713); regex-grade HTML parsing; inline scripts
  are not checked (Next.js Flight data, spike T12). A host can serve the indexer clean files and
  victims bad ones (spike T8); the extension is the better vantage point.

Binding: a site is compared with a release only when that app's latest manifest lists the domain (the API adds it after the `/.well-known/hydra.txt` proof passed). A `targets.json` app label alone binds nothing, so the site stays `unknown`. A bound site is re-proved every run; if the proof fails the status is `mismatch` with `DOMAIN_PROOF_LOST <reason>`. An unreadable file (network, timeout, 5xx) is only `DOMAIN_PROOF_UNREACHABLE`; the script compare decides.
- **Safe fetch:** pages and scripts are fetched with `safeGet` from `@hydra/core`: https on the default port,
  no IP-literal hosts, public addresses only, pinned connection, each redirect rechecked (at most 3).
  A script on plain http or a private host is recorded as unreadable.
- **A failing second view is loud (T-A24):** `src/jina.ts` counts renders and failures and names the cause (HTTP 402 credit out, 401 bad key, 429, timeout). After 3 failures in a row it stops calling for the rest of the run. The run summary then carries 1 error line, which the workflow and `/v1/indexer/status` print, and a `jina` field with the counts. Because up to 8 sites are scanned at once, a few calls already in flight can still fail after the breaker opens.
