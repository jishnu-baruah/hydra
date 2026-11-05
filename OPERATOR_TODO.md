# OPERATOR_TODO.md, the human-only queue

Things no agent can do: sign in to a faucet, get a postage batch, own a domain, talk to a sponsor,
record a video. An agent that hits one of these writes the `OP-N` entry here, sets its task to
`blocked, see OP-N` in `TASKS.md`, and moves to another task.

**Never fake a transaction, a Swarm reference or a measurement to look done.** A blocked task
with an honest `OP-N` is worth more than a green row with nothing behind it.

Entry format, and every entry says which task it unblocks:

```
### OP-0, One-line title (this block is the format, not a real item)
- Status: open
- Owner: <name>
- Needed by: <date>
- Unblocks: T-A02
- What exactly: ...
- Done when: ...
```

Status values: `open` | `claimed <date> | Owner: <name>` | `done <date>: <result>` |
`decided <date>: <decision>` | `dropped <date>: <reason>`. A `decided` item needs a row in
`DECISIONS.md` in the same PR.

---

### OP-1, Fund the Hydra Arkiv wallet
- Status: open
- Owner: Jishnu
- Needed by: 2026-11-05 night
- Unblocks: T-F01, T-A02, T-A06
- What exactly: on the **Rabdi** testnet (chain 7794095), create a fresh wallet for the API and a second for the indexer, claim tGLM at hub.arkiv.network/faucet (wallet connect and sign-in, so a human does it), and create an access key at hub.arkiv.network/access-keys (the public RPC is rate limited). Keys go in `.env` only.
- Done when: both addresses hold tGLM and the access key works for one query; the addresses (not keys) are written here.

### OP-2, Swarm testnet postage batch
- Status: open
- Owner: Jishnu
- Needed by: 2026-11-06 morning
- Unblocks: T-F02, T-A02
- What exactly: run or pick a Bee node on the Swarm testnet and get a postage batch (testnet tokens from a faucet, or ask the Swarm team at their stall).
- Done when: the batch id is in `.env` and one upload succeeds.

### OP-3, Demo domain on Vercel
- Status: open
- Owner: Manish
- Needed by: 2026-11-06 morning
- Unblocks: T-D04
- What exactly: a domain or subdomain we control, pointed at a Vercel project for the demo dApp, so we can serve `/.well-known/hydra.txt` and change a file live during the demo.
- Done when: the domain serves a placeholder page over HTTPS.

### OP-4, Questions for the Arkiv stall
- Status: open
- Owner: Manish
- Needed by: 2026-11-06 midday
- Unblocks: T-F01, T-D02
- What exactly: ask the maximum expiry on testnet, query limits per second, the best way to write many small records, whether there is a live-subscription API, and which prize track fits us.
- Done when: the answers, with who gave them, are in docs/prizes.md.

### OP-5, Protect main
- Status: open
- Owner: Jishnu
- Needed by: 2026-11-05 night
- Unblocks: T-A00
- What exactly: require a pull request and green `secrets`, `checks` and `hygiene` before merging to `main`. GitHub only allows this on a private personal repo with a paid plan; otherwise make the repo public or rely on the `board` lock job.
- Done when: a direct push to `main` is refused, or the decision is in DECISIONS.md.

### OP-6, Code judges can open
- Status: open
- Owner: Jishnu
- Needed by: 2026-11-07 morning, before submitting
- Unblocks: T-J03
- What exactly: the repo is private. Before submitting, either make jishnu-baruah/hydra public or publish a public mirror of `main`, after a final secret scan. Decide which and log it in DECISIONS.md.
- Done when: the submission's repo link opens in a private browser window.

### OP-7, Publish 1 demo release through the live API
- Status: done 2026-11-06: Jishnu published hydra-test-a (3 releases) and test-dapp (2 releases) through the live API; the publisher wallet sent 12 transactions
- Owner: Mouli
- Needed by: 2026-11-06 morning
- Unblocks: T-B02, T-B03, T-C02
- What exactly: the publisher wallet (0xdD0d4167959291A2eb930Fe82Fed58070134348b) holds 5 tGLM and has sent 0 transactions, so Arkiv has 0 Hydra records and the explorer and extension have nothing real to show. A person signs in on the onboarding site (apps/site, T-A09) with a wallet, gets an API key, and publishes 1 small build (the demo dApp from T-D04, or any folder with an index.html) via `node publish.mjs`. An agent cannot do this: it needs a wallet signature and handles an API key.
- Done when: `GET /v1/apps/<app>/releases` on the API returns 1 release, and its app name is written here.

### OP-8, Turn on Swarm uploads on the deployed API
- Status: open
- Owner: Jishnu
- Needed by: 2026-11-06 midday
- Unblocks: T-B02, T-B03
- What exactly: `GET /health` on the deployed API reports `"swarm": false`, so all 5 live releases have `swarm_ref = pending` and the explorer has no Swarm link to show. docs/swarm.md (Path B) needs no code change: on the API host set `BEE_API_URL` and `SWARM_GATEWAY_URL` to `https://api.gateway.ethswarm.org` and `SWARM_POSTAGE_BATCH_ID` to any non-empty value (the gateway ignores it), then publish once.
- Done when: `/health` reports `"swarm": true` and the next release's `swarm_ref` is 64 hex characters whose `hydra-manifest.json` opens through the gateway.

### OP-9, Hand-time the extension install in Chrome
- Status: open
- Owner: Mouli
- Needed by: 2026-11-06 afternoon
- Unblocks: T-C04
- What exactly: T-C04's acceptance asks for the install to work on 1 clean Chrome profile in under 2 minutes. An automated load into a clean Chromium profile took 9.6 s from unzip to the first verdict, but branded Chrome's Load unpacked has to be clicked by a person. Make a new Chrome profile, start a timer, download the zip from https://github.com/jishnu-baruah/hydra/releases/tag/extension-v0.4.0, follow the 4 install steps, and stop when a site shows a badge.
- Done when: the time is written here and in the T-C04 row.

### OP-10, Deploy the explorer on Vercel
- Status: open
- Owner: Jishnu
- Needed by: 2026-11-06 afternoon
- Unblocks: T-B06
- What exactly: hosting needs an account sign-in, which no agent does. The repo is Jishnu's and Mouli is not an admin, so the simplest path is Jishnu adding the explorer as a second project in the Vercel account that already hosts apps/site: import jishnu-baruah/hydra with Root Directory apps/explorer and Framework Preset Other, then deploy (apps/explorer/deploy/README.md, option A). Mouli can instead deploy from a local checkout with the Vercel CLI (option B).
- Done when: the explorer's public URL is written here and in the T-B06 row.
