# explorer

Sourcify-style explorer for app builds. Reads Arkiv and Swarm directly in the browser, with no key and no wallet. The two lookups that Arkiv cannot answer on its own, which app proved a domain and the app page's bound domains, ask the Hydra API's public read routes. Owner: Mouli.

Static files, no build step. The Arkiv SDK (`@arkiv-network/sdk` 1.0.1) and viem load in the
browser from jsdelivr, all from the one CDN: mixing CDNs gave the page two copies of the SDK and
queries failed. No key and no wallet: the public Rabdi RPC serves reads.

## Run it

Any static server works; ES modules do not load from `file://`.

```bash
cd apps/explorer && python -m http.server 5173
```

## Views

- `/`: the landing page. The hero panel is an example of a check, labelled as one.
- `/releases/`: the newest Hydra releases (`arkiv.schema = hydra.release`), newest first.
- `/releases/?key=0x...`: any Arkiv entity by key, with its owner, blocks and every attribute.
- `/search/?q=...`: find an app by domain, app name, file sha256 or Swarm reference. A site nobody published but the indexer watches shows as "watched by the indexer, not published by the team".
- `/app/?name=<app>`: one app's release history, plus "Where it runs": the domains its newest release binds, each with the indexer's latest verdict.
- `/observed/` (nav: Sites) and `/observed/?domain=<site>`: every site the indexer watches, and one site's history.
- `/events/` (nav: Activity): releases, app claims and indexer observations, newest first.
- `/publish/`: sign in with a wallet, get an API key, add the workflow, bind the domain.

Everything read from Arkiv is shown with `textContent`, never as HTML.

## Design

`assets/hydra.css` holds the tokens and shared parts; `assets/landing.css` and `assets/landing.js`
are the landing page only. Dark only, square corners, IBM Plex Sans and Mono with Bebas Neue, one
cold accent (`#7aa2ff`, 8.0:1 on the background). The landing page scrolls with Lenis 1.3.15 at the
settings of the interface template. Under `prefers-reduced-motion` there is no smooth scroll, no
reveal, no ticker and no split-flap.
