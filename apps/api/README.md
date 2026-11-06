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

## Alert channels (T-A30)

A team adds up to 5 channels per app; every verdict alert the indexer sends for that app (a site
turning mismatch, a new loud problem, a recovery) also goes to each channel. All routes take the
app's API key (`Authorization: Bearer hyd_...`) and touch only that key's app.

- `GET /v1/alerts`: `{ app, channels: [{ id, kind, label, created_at }] }`. A label never holds the
  target: `Webhook to <host>`, `Slack incoming webhook`, `Discord webhook`, `Telegram chat ...1234`.
- `POST /v1/alerts` with `{ kind, target }`: `kind` is `webhook` (any public https URL), `slack`
  (`https://hooks.slack.com/services/...`), `discord` (`https://discord.com/api/webhooks/...`) or
  `telegram` (a chat id; add the bot named by `GET /v1/alerts/telegram-bot` to the chat). A test
  message goes out first; only if it lands is the channel stored. `201 { id, kind, label, secret? }`,
  where `secret` (`whsec_...`) is for webhooks and is shown only in this response.
- `POST /v1/alerts/<id>/test`: `200 { sent: true }` or `502 { error }`.
- `DELETE /v1/alerts/<id>`: `200 { deleted: id }`, 404 when the id is not one of this app's channels.
- `GET /v1/alerts/telegram-bot`: `{ username }` or `{ username: null }`; public.

Errors: 400 bad kind or target, 401 missing or bad key, 409 a 6th channel, 429 over 20 changes
(adds, tests, deletes) per app per hour, 502 the target did not take the message, 503 `ALERT_KEY`
or the Arkiv writer wallet is not configured.

Webhooks get `{ type: "hydra.verdict" | "hydra.test", app, domain, from, to, problems[], observed_at
(ms), explorer }`, signed per Standard Webhooks: headers `webhook-id`, `webhook-timestamp` (seconds)
and `webhook-signature: v1,<base64 HMAC-SHA256 of "id.timestamp.body">` keyed with the base64 part of
the secret. Slack gets `{ text }`, Discord `{ content }` with mentions off, Telegram plain text.
Every call to a team's URL goes through `safePost`: https on the default port, a public address
pinned for the connection, no redirects followed, 10 s timeout, 64 KiB of answer read. Network errors
and 5xx get 3 attempts; a 3xx or 4xx stops. Targets are stored on Arkiv (`hydra.alert_sub`) sealed
with AES-256-GCM under `ALERT_KEY`, and are never logged or returned.
