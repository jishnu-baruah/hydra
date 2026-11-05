---
name: hydra-publish
description: Add Hydra to a dApp frontend repo so every push to main records the build on Arkiv and stores it on Swarm. Use when the user asks to add Hydra, publish builds to Arkiv, or set up build verification for their frontend.
---

# Add Hydra to this repo

Hydra records every frontend build on Arkiv (Rabdi testnet) and Swarm from GitHub Actions.
Full reference: https://hydra-site-one.vercel.app/llms.txt

## 1. Find the build

Read `package.json` and the lockfile. Work out:
- install command: `npm ci` (package-lock.json), `pnpm install --frozen-lockfile` (pnpm-lock.yaml,
  add `pnpm/action-setup@v4` before setup-node), `yarn install --frozen-lockfile` (yarn.lock),
  `bun install` (bun.lockb, use `oven-sh/setup-bun@v2`).
- build command: usually the `build` script.
- output folder: from the framework config. Vite and Astro `dist`, Create React App `build`,
  Next.js only with `output: 'export'` in next.config (folder `out`), SvelteKit with adapter-static
  `build`. If the app is server rendered with no static export, stop and tell the user Hydra needs
  a static build with an `index.html`.
- Monorepo: use the app's folder as `working-directory` and its output path.

Run the build locally if you can and confirm the folder contains `index.html`.

## 2. Ask the human for the key (you cannot do this step)

Tell the user:
1. Open https://hydra-site-one.vercel.app, connect a wallet, choose an app name (2 to 40
   lowercase letters, digits, dashes), sign the message. No transaction, no gas.
2. Copy the key shown once and run `gh secret set HYDRA_API_KEY` in this repo, pasting it when
   prompted (or add it under Settings, Secrets and variables, Actions).

Never ask for the key in chat, never write it to a file, never echo it.

## 3. Write `.github/workflows/hydra.yml`

```yaml
name: hydra

on:
  push:
    branches: [main]

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: <INSTALL> && <BUILD>
      - name: Publish to Hydra
        env:
          HYDRA_API_URL: https://hydra-api-5xmn.onrender.com
          HYDRA_API_KEY: ${{ secrets.HYDRA_API_KEY }}
        run: |
          curl -fsSL "$HYDRA_API_URL/publish.mjs" -o hydra-publish.mjs
          node hydra-publish.mjs <OUTPUT_DIR>
```

Use the repo's default branch if it is not `main`. Keep any build env vars the app needs.

## 4. Verify

After the user confirms the secret is set, commit and push (ask before pushing). In the Actions
run, the publish step prints the release, an Arkiv transaction link and the Swarm reference.
Then check `curl https://hydra-api-5xmn.onrender.com/v1/apps/<app>/releases`.

If it fails, read the message:
- 401: the secret is missing or the key expired (30 days). Get a new key.
- 403 "owned by": that app name belongs to another address. Choose another name and a new key.
- 400: fix what it names (no index.html, wrong folder, over 2000 files or 20 MB).
- 502 `submitted` or `submission_unknown`: do not re-run; check the releases route first.
- Timeout on the first call: the free API was asleep. Re-run once.
