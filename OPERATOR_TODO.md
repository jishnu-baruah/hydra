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
- What exactly: create a fresh testnet wallet for the API, claim GLM at hub.arkiv.network/faucet (wallet connect and sign-in, so a human does it), and a second wallet for the indexer. Keys go in `.env` only.
- Done when: both addresses hold GLM; the addresses (not keys) are written here.

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
