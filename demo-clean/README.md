# demo-clean

"Clean Vault", a one-page test dApp that stays untouched, so Hydra has a live site to show as
verified (green) next to the staged hijack in `demo/` (red). One script of ours (`app.js`), no
vendor scripts, and `/.well-known/hydra.txt` binding the domain to the Hydra app `clean-vault`.

Hosted on GitHub Pages as the user site `mouli51ch.github.io`, because the domain proof must sit at
the domain root. `.nojekyll` makes Pages serve `.well-known/` as is.

## Publish it (deploy first, then publish: the domain proof is checked against the live site)

1. Copy this folder's files to the root of the `Mouli51ch/Mouli51ch.github.io` repo and push. Pages
   serves them at https://mouli51ch.github.io within a minute or two.
2. Get a key on the explorer's /publish/ page: connect the wallet, app name `clean-vault`. Keep it
   in `.env`, never in chat or git.
3. Publish:

   ```bash
   HYDRA_API_URL=https://hydra-api-5xmn.onrender.com HYDRA_API_KEY=... HYDRA_DOMAINS=mouli51ch.github.io node packages/action/publish.mjs demo-clean
   ```

4. The indexer checks every published domain on its next run (about every 30 minutes). Searching
   `mouli51ch.github.io` on the explorer then shows Good to go.

Do not edit the hosted files without publishing again: any change turns the site red, which is the
point of Hydra.
