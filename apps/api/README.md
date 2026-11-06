# api

Publish API. Holds the Arkiv wallet, the Arkiv access key and the Swarm postage batch, so teams
only need a Hydra API key. Owner: Jishnu. Plain Node (24, type stripping), no framework.

```bash
node --env-file=../../.env src/main.ts    # from apps/api; needs HYDRA_KEY_SECRET (32+ chars)
pnpm test                                 # offline: fake Arkiv and Swarm writers
```

| Route | What |
|---|---|
| `GET /health` | Arkiv writes and Swarm configured? publisher wallet address |
| `GET /publish.mjs` | the CI publish script (`packages/action/publish.mjs`) |
| `GET /v1/auth/message?address=&app=` | the exact message the wallet signs |
| `POST /v1/auth/key` | `{ address, app, issuedAt, signature }` to `{ apiKey }` |
| `POST /v1/releases` | `Authorization: Bearer <apiKey>`; body `{ files: {"/path": base64}, scripts, commit, version, ciRunUrl }` |
| `GET /v1/apps/:app/releases` | releases on Arkiv, newest first |
| `GET /v1/files/:sha256` | which app and release a file hash belongs to |

Keys are stateless (`hyd_<claims>.<hmac>`), expire after 30 days, and rotating
`HYDRA_KEY_SECRET` revokes all of them.

**Trust and spend.** Anyone can write `hydra.*` records to Arkiv with their own wallet, so reads
keep only records created by our publisher wallet. An app name belongs to the first address that
gets a key for it: issuing the key writes the `hydra.app` record at once (at most 5 new names per
address per hour), so the name cannot be taken between key and first publish; other addresses get 403 for both keys and publishes, and
their records are dropped from reads. Client `domains` are ignored until domain ownership can be
proven. Every publish spends our gas and postage, so `HYDRA_ALLOWED_ADDRESSES` (optional
allowlist) and `HYDRA_PUBLISHES_PER_HOUR` (default 30 per address) bound it. Two key requests
racing for one name can both claim it; the earliest `created_at` wins on read.
A release: the server hashes every file itself, uploads the build plus `hydra-manifest.json` to
Swarm when `BEE_API_URL` is set (else `swarm_ref` is `pending`),
writes 1 `hydra.release` record, then `hydra.file` records for up to 200 code files in batches
of 20. All writes go through core's guarded path: one transaction each, never resent.

## Demo live checker (T-A25)

An in-memory watcher that checks one bound site every 5 seconds, for the demo. A check fetches the page
and its scripts (through `safeGet`), rechecks the site's `hydra.txt` and compares with the release; it
reads and writes nothing on Arkiv. When the verdict flips (match to mismatch or back) it runs the normal
one-site observation write and the Telegram alert, once. It switches itself off after 15 minutes, and a
restart or sleep of the host clears it.

- `GET /v1/watch`: public state: on or off, the domain, the last check, the last 30 checks and the flips.
- `POST /v1/watch` with `{ "domain": "app.example.com", "on": true }` or `{ "on": false }`, header
  `Authorization: Bearer <DEMO_WATCH_TOKEN>`. 401 for a wrong token, 503 when `DEMO_WATCH_TOKEN` is
  unset or shorter than 16 characters, 404 when no release binds the domain.
- The explorer's `/live/` page is the front end.

