# extension

Chrome MV3 extension. Compares the scripts a site serves with its latest release on Arkiv and warns on a mismatch. Owner: Mouli.

Plain JS modules, no build step.

## Load it

1. Open `chrome://extensions` and turn on Developer mode.
2. Load unpacked, and pick this folder (`apps/extension`).
3. Pin Hydra from the puzzle menu so the badge is visible.

## Badge

| Badge | Meaning |
|---|---|
| green `OK` | every script is in the latest release |
| red `!` | the site serves a script that is in no release |
| grey `?` | no release on record for this site |

The verdict is hard-coded in `src/verdict.js` for now (example.com green, example.org red,
everything else grey). T-C02 replaces it with the real compare.
