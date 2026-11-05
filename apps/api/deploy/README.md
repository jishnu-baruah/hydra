# Deploy the publish API

One Docker container: `apps/api/deploy/Dockerfile`, built with the **repo root** as context
(the API imports `@hydra/core` and serves `packages/action/publish.mjs` by relative path).
It runs `node src/main.ts` as the non-root `node` user and listens on `PORT`.

Testnets only: Arkiv Rabdi (chain 7794095) and the Swarm testnet.

## Environment

Set every value in the host dashboard as a secret (Render: Environment; Fly: `fly secrets set`).
Never commit any of them, and never put them in `fly.toml` or the Dockerfile.

| Variable | Required | What |
|---|---|---|
| `HYDRA_KEY_SECRET` | yes | signs every API key, 32+ chars. Generate: `openssl rand -hex 32`. Rotating it revokes all keys |
| `ARKIV_PRIVATE_KEY` | for writes | the publisher wallet (Rabdi testnet, funded from the faucet). Unset means a read-only API |
| `ARKIV_ACCESS_KEY` | recommended | from hub.arkiv.network/access-keys; the public RPC is rate limited |
| `BEE_API_URL` | for Swarm | the Bee node API, see below |
| `SWARM_POSTAGE_BATCH_ID` | for Swarm | the postage batch the Bee node stamps uploads with (OP-2) |
| `HYDRA_CORS_ORIGIN` | yes in prod | the Vercel site origin, for example `https://hydra-site.vercel.app`. Unset means `*` |
| `HYDRA_ALLOWED_ADDRESSES` | optional | comma-separated wallets allowed to get keys; empty means anyone |
| `HYDRA_PUBLISHES_PER_HOUR` | optional | per-address publish limit, default 30 |
| `HYDRA_PUBLISHER_ADDRESS` | read-only only | the wallet whose records reads trust, when `ARKIV_PRIVATE_KEY` is unset |
| `PORT` | set by host | Render sets it; the Fly config sets 8787. Falls back to `HYDRA_API_PORT`, then 8787 |

Without `BEE_API_URL` and `SWARM_POSTAGE_BATCH_ID` the API still publishes, with
`swarm_ref: pending`.

## Bee

Bee runs on the same host as the API and a teammate sets it up (OP-2). Point `BEE_API_URL` at
its API port over the private network, never a public URL:

- Render: run Bee as a private service; set `BEE_API_URL=http://<bee-service-name>:1633`.
- Fly: run Bee as its own app in the same org; set `BEE_API_URL=http://<bee-app>.internal:1633`.

## Render (Docker web service)

1. New, Web Service, connect `jishnu-baruah/hydra`, branch `main`.
2. Runtime: Docker. Dockerfile path: `apps/api/deploy/Dockerfile`. Docker build context: `.`
   (the repo root).
3. Health check path: `/health`.
4. Environment: add each variable above as a secret.
5. Create. Render builds the image and gives you an `https://<name>.onrender.com` URL.

## Fly.io

1. `fly auth login`, then from the repo root `fly launch --no-deploy --copy-config --config apps/api/deploy/fly.toml`
   (change `app` in `fly.toml` if the name is taken).
2. Secrets: `fly secrets set HYDRA_KEY_SECRET=... ARKIV_PRIVATE_KEY=... ARKIV_ACCESS_KEY=... --config apps/api/deploy/fly.toml`
   and the same for the rest. Type them into your own shell, not into a file in the repo.
3. Deploy from the repo root:
   `fly deploy . --config apps/api/deploy/fly.toml --dockerfile apps/api/deploy/Dockerfile`.

## Check the deploy

```bash
curl -s https://<host>/health
```

Expect `"ok":true`, `"arkivWrites":true` (the wallet key is set) and `"swarm":true` (Bee and the
batch are set), plus `publisherWallet` with the wallet address. `arkivWrites:false` means
`ARKIV_PRIVATE_KEY` is missing; `swarm:false` means `BEE_API_URL` or `SWARM_POSTAGE_BATCH_ID` is.
If the container exits at start, read the log: a short `HYDRA_KEY_SECRET` is named there.

`curl -s https://<host>/publish.mjs` should return the CI publish script.

## Build locally

```bash
docker build -f apps/api/deploy/Dockerfile -t hydra-api .
docker run --rm -p 8787:8787 -e PORT=8787 -e HYDRA_KEY_SECRET="$(openssl rand -hex 32)" hydra-api
```

The Dockerfile copies only named paths, so a local `.env` never enters the image even if a host
ignores `Dockerfile.dockerignore`.
