# action

How a repo publishes to Hydra. Owner: Jishnu.

- `publish.mjs`: no dependencies. Hashes the build folder and the external scripts its HTML
  loads, then POSTs to the Hydra API. The API serves it at `GET /publish.mjs`, so CI downloads
  the current version and works while this repo is private.
- `hydra.yml`: the workflow template the site fills in (`__HYDRA_API_URL__`, `__BUILD_DIR__`).
- `pnpm test`: runs the real script against the real API routes with fake writers.

A GitHub Marketplace action (`action.yml` in a public repo) comes later, in T-J01.
