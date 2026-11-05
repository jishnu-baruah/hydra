# site

Temporary onboarding page (T-A09): connect a wallet, sign one message, get a Hydra API key and
a filled-in workflow template, then see your releases. Mouli folds it into the explorer later.
Static files, no build step; deploy the folder to Vercel as is.

```bash
cd apps/site && python -m http.server 5174     # then open http://localhost:5174/?api=http://localhost:8787
```

Set `API_DEFAULT` in `config.js` to the deployed API before deploying. `?api=` overrides it.
The YAML in `app.js` mirrors `packages/action/hydra.yml`; change both together.
