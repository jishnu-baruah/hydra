# demo

A one-page stand-in dApp ("Demo Swap") for the Hydra demo: 1 script of ours (`app.js`), 1 vendor
script (`dayjs` from jsdelivr, pinned), and `/.well-known/hydra.txt` binding the domain to the Hydra
app `demo-dapp`. Production domain: see `DEMO_URL` below once deployed. Vercel previews inject
a `vercel.live` script and are login-protected, so only the production deployment is used.

## Publish it (deploy first, then publish: the domain proof is checked against the live site)

```bash
cd demo && vercel --prod --yes
# key from the Hydra site (sign in with the wallet, app name demo-dapp); keep it in .env, never in chat
HYDRA_API_KEY=... HYDRA_DOMAINS=<the production domain> node ../packages/action/publish.mjs .
```

Then run the indexer (`POST /v1/indexer/run`, or the Indexer workflow). `/indexed/` shows the
domain as `match`.

## Staged hijack (T-D10)

1. `node tamper.mjs` appends one harmless line to `app.js` and the demo site is
   redeployed with `vercel --prod --yes`. Do NOT publish.
2. Trigger one indexer run. The domain turns `mismatch` (`CHANGED /app.js`) and the Telegram group
   gets the alert.
3. Undo: `git checkout app.js` and redeploy.
