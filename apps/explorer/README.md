# explorer

Sourcify-style explorer for app builds. Reads Arkiv and Swarm directly; no backend. Owner: Mouli.

Static files, no build step. The Arkiv SDK (`@arkiv-network/sdk` 1.0.1) and viem load in the
browser from jsdelivr, all from the one CDN: mixing CDNs gave the page two copies of the SDK and
queries failed. No key and no wallet: the public Rabdi RPC serves reads.

## Run it

Any static server works; ES modules do not load from `file://`.

```bash
cd apps/explorer && python -m http.server 5173
```

## Views

- `/`: the newest Hydra releases (`arkiv.schema = hydra.release`), newest first.
- `/?key=0x...`: any Arkiv entity by key, with its owner, blocks and every attribute.

Everything read from Arkiv is shown with `textContent`, never as HTML.
