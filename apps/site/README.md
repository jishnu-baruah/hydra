# site

Temporary onboarding page (T-A09): connect a wallet, sign one message, get a Hydra API key and
a filled-in workflow template, then see your releases. Mouli folds it into the explorer later.
Static files, no build step; deploy the folder to Vercel as is.

```bash
node apps/site/dev-server.ts    # whole flow offline: site on :5174, in-memory API on :8788
```

Open http://localhost:5174/?api=http://localhost:8788, connect, sign, then run the template's
publish step against `http://localhost:8788` and press Refresh. Against a real API, serve the
folder with any static server and point `?api=` at it.

Set `API_DEFAULT` in `config.js` to the deployed API before deploying. `?api=` overrides it.
The YAML in `app.js` mirrors `packages/action/hydra.yml`; change both together.
