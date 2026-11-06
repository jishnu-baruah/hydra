# extension

Chrome MV3 extension. Compares the scripts a site serves with its latest release on Arkiv and warns on a mismatch. Owner: Mouli.

## Install

1. Get `hydra-extension-<version>.zip` (or build it: `node apps/extension/scripts/pack.mjs`) and unzip it to a folder.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the unzipped folder, the one that holds `manifest.json`.
4. Pin Hydra from the puzzle-piece menu, so the badge is always in view.

Chrome cannot load the zip itself; it needs the unzipped folder. The zip is reproducible: building
the same source again gives the same sha256.

## What the badge means

| Badge | Meaning |
|---|---|
| green `OK` | every script the page loaded is in the site's latest release |
| red `!` | a script changed or is in no release. A banner on the page and the popup name each one. Do not sign or approve anything there |
| grey `?` | no release on record for this site, or the Hydra API could not be reached. The page is unverified |
| `..` | still checking |

Click the icon for the popup: the verdict, up to 10 flagged scripts, and a link to the app's page on
the Hydra explorer.

## How it decides

After a page loads, the background worker re-fetches every script the top frame loaded, hashes it
(sha256), finds the app through the Hydra API's public read routes, and compares every script with
that app's latest manifest (`src/compare/compare.js`). It finds the app first by the site's hostname (an
app "proves" a domain by serving `/.well-known/hydra.txt` when it publishes), so a site whose every
script was swapped still goes red on a first visit; if no app has proved that hostname it falls back to
the hashes of the page's own scripts, and it remembers each site's app after a full match. Cloudflare's injected bot
check is not judged, because the host adds it, not the build.

## Permissions, and why

- `<all_urls>` host access: to re-fetch and hash the scripts a page loaded, from any origin.
- `webRequest`: to see every script a page loads, including chunks loaded after the HTML.
- `scripting`: to show the red banner inside the page.
- `storage`: to keep each tab's result while the worker sleeps, and each site's app once it has matched.

## What leaves your browser

For each page you open, the extension sends the page's hostname, and if no app has proved it the sha256
of up to 5 of the page's own scripts, to the Hydra API (`hydra-api-5xmn.onrender.com`) to find the app,
then asks for that app's releases. A site it has already matched is not asked about again. It sends
no page content, no cookies and no wallet data, and it never signs anything. The hostname and a script hash
both identify which site you are on, so the API operator can learn which sites you visit, bound or not.

## Develop

`node --test apps/extension/src/compare/compare.test.mjs apps/extension/src/ui/present.test.mjs` runs
the unit tests. Load `apps/extension` itself unpacked to try changes, and reload it from
`chrome://extensions` after each edit.

The explorer link in the popup and banner comes from `src/ui/links.js`. It points at the deployed
explorer, `https://hydra-registry.vercel.app`; for local work run `apps/explorer` on
`http://localhost:5173` and change it there. Build the zip again after changing it.