// The texts the publish page hands a team: the workflow file and the block for a coding agent.
// From apps/site (T-A09), unchanged in what they do. Pure, so they run in the page and under
// `node --test`.

const APP = /^[a-z0-9][a-z0-9-]{1,39}$/;
// The build folder is written into a workflow that runs in CI, so it may only be a plain path.
const DIR = /^[A-Za-z0-9._/-]{1,100}$/;

export function appError(name) {
  if (!name) return "Enter an app name.";
  return APP.test(name) ? null : "Use 2 to 40 lowercase letters, digits and dashes, starting with a letter or digit.";
}

export function dirError(dir) {
  if (!dir) return "Enter the folder your build writes to, the one with index.html.";
  return DIR.test(dir) && !dir.includes("..") ? null : "Use letters, digits, dots, dashes, underscores and slashes only, such as dist or apps/web/out.";
}

export const workflow = (api, dir) => `name: hydra

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
      - run: npm ci && npm run build # your build
      - name: Publish to Hydra
        env:
          HYDRA_API_URL: ${api}
          HYDRA_API_KEY: \${{ secrets.HYDRA_API_KEY }}
        run: |
          curl -fsSL "$HYDRA_API_URL/publish.mjs" -o hydra-publish.mjs
          node hydra-publish.mjs ${dir}
`;

// The command the user runs themselves. The key stays out of the agent block.
export const secretCommand = (key) => `gh secret set HYDRA_API_KEY --body "${key}"`;

// Everything an agent needs in one paste: who, what and how to check it worked. No key: the user
// stores it as a GitHub secret themselves, and the agent never handles it.
export const handoff = ({ app, api, docs }) => `Set up Hydra in this repo so every push to main records the build on Arkiv.
Docs: ${docs}

App name: ${app} (reserved for your wallet; the key works only for this name)
HYDRA_API_URL: ${api}

The key: I store it as a GitHub Actions secret named HYDRA_API_KEY myself. Do not ask for the key, do not print it, and never write it to a file.
1. Add .github/workflows/hydra.yml from the docs template, with this repo's real install and build
   commands and its build output folder (the folder that contains index.html). It reads the key
   from secrets.HYDRA_API_KEY.
2. Commit and push to main. If the secret is not set yet, tell me to run: gh secret set HYDRA_API_KEY
   (from inside the repo clone, or add -R <owner>/<repo>). Then watch the run: gh run watch
3. Confirm the release: curl ${api}/v1/apps/${app}/releases
If a step fails, read the error section of the docs before retrying. A 401 or 403 means the key
cannot be used: tell me to get a new block from the Hydra site; never retry with the same key.
Optional: to bind your domain, serve /.well-known/hydra.txt with the line hydra-app=${app} on it and set HYDRA_DOMAINS=<your domain> in the publish step's env.`;
