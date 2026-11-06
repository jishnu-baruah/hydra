# Hydra demo runbook (T-D12)

The story: a team published a release of its dApp. Someone changes the live site. Hydra notices, in public, within seconds.

Commands run from the repo root. They need the Vercel CLI logged in and the repo `.env` (set `HYDRA_ENV_FILE` to use another `.env`). Never paste keys on screen.

## Before you go on stage (about 15 minutes before)

1. Wake the API: open https://hydra-api-5xmn.onrender.com/health. It sleeps after 15 minutes idle and the first request can take about 50 s. Wait for a reply.
   Then warm the indexed-sites data: open https://hydra-api-5xmn.onrender.com/v1/observations once. Uncached it took 87 s on 6 Nov (the API has no Arkiv access key, so the public RPC rate limits it); after that it is cached. Show the explorer pages on stage, which read Arkiv per domain and stay fast. `node demo/status.mjs` reads Arkiv directly and answers in about 1 s.
2. Run `node demo/status.mjs` (read only). Expect MATCH everywhere: live hash equals the release, latest verdict MATCH. If not, run `node demo/restore.mjs` first.
3. Open these tabs in this order:
   1. Demo site: https://hydra-demo-dapp.vercel.app
   2. Explorer app page: https://hydra-registry.vercel.app/app/?name=demo-dapp
   3. Live page: https://hydra-registry.vercel.app/live/ (only once T-A25, PR #112, is merged and deployed)
   4. Activity: https://hydra-registry.vercel.app/events/
   5. Telegram, with the "Hydra Test" group visible.
4. Extension: load the `apps/extension` folder unpacked from the main checkout (chrome://extensions, Developer mode, Load unpacked). Do not trust the packaged zip, it may be out of date. On the demo tab the badge must be green OK.
5. Switch the watcher on (after T-A25 is deployed). `DEMO_WATCH_TOKEN` must already be set on Render (a human step). Either use the switch on /live/ (paste the token into the "Demo token" field, press "Switch on"), or POST to https://hydra-api-5xmn.onrender.com/v1/watch with header `Authorization: Bearer <DEMO_WATCH_TOKEN>` and body `{"domain":"hydra-demo-dapp.vercel.app","on":true}`. A wrong token shows "That demo token is wrong."
6. Check the time left. The watcher checks every 5 s and stops itself after 15 minutes. /live/ shows the countdown. Switch it on again if under 3 minutes remain, or switch it on as late as you can. A Render restart or sleep clears it.
7. Not deployed yet? Skip the watcher. `hack.mjs` runs a real one-site check itself (15 to 25 s). Say so honestly if asked.
8. Keep a terminal ready at the repo root, font large.

## On stage (about 90 seconds)

1. Show the demo site and the green OK badge. Say: "This dApp has a published release, demo-1." Screen: Demo Swap page, extension badge green OK.
2. Show /app/?name=demo-dapp. Say: "The release and its scripts are public, on Arkiv, with the build on Swarm." Screen: release history, and "Where it runs" with the domain and verdict MATCH.
3. Show /live/ (or the status output). Say: "Hydra is watching this site every 5 seconds." Screen: big match status, "checked N s ago", the last 30 checks.
4. Run `node demo/hack.mjs`. Say: "Now I act as an attacker and change one script." Screen: terminal prints the tampered deploy, then the check and the time to alert. Takes about 10 to 30 s for Vercel plus up to about 25 s for the check.
5. Switch to Telegram. Say: "The team is told." Screen: "Hydra alert: hydra-demo-dapp.vercel.app (app demo-dapp) is now MISMATCH (was match)." with the changed file. Earlier rehearsal: 28 s from tamper to alert with a 10 s redeploy.
6. Show /live/: the status turns red MISMATCH and names the change. Then /app/?name=demo-dapp: "Where it runs" shows MISMATCH.
7. Go to the demo tab and reload it. Say: "A user with the extension is warned on the spot." Screen: red ! badge and a banner naming /app.js. The extension decides on page load, so reload is required.
8. Optional, if time: run `node demo/restore.mjs`. Telegram then shows "Hydra: hydra-demo-dapp.vercel.app (app demo-dapp) recovered: MATCH again, every script is in the release." Reload the demo tab to see green again.

## Reset after the demo

1. Run `node demo/restore.mjs`. It deploys the clean demo, waits until the live script equals the release, then records a match the same way as a check.
2. Run `node demo/status.mjs`. Expect live hash equals release and latest verdict MATCH.
3. Reload the demo tab: badge green OK. The explorer "Where it runs" shows MATCH.
4. Switch the watcher off on /live/ if still on.
5. History cannot be erased. Past mismatch observations stay on Arkiv for 3 days and show in the history strip. The latest verdict is what badges and "Where it runs" show.

## If something goes wrong

- API asleep or /live/ says it cannot read the live state: open /health, wait up to about 50 s, the page retries every second. Recommended and not set up yet: an uptime monitor on /health every 5 minutes.
- Vercel deploy slow (normally 10 to 30 s): keep talking over the beat, the terminal prints progress. The alert comes after the deploy is live.
- Watcher not deployed, off, or expired: switch it on again (see step 5 above). If T-A25 is not deployed, use the check built into `hack.mjs` and show Telegram and the explorer pages instead of /live/.
- Extension still green: reload the demo tab. It decides on page load. If still green, run `node demo/status.mjs` to confirm the live script really differs. Extension finds the app by hostname first. If it is grey ?, no release was found: check the API is awake.
- Telegram silent: check you are in the "Hydra Test" group, then run `node demo/status.mjs` to see the watcher state and what each screen will show. Wait for the next check.
- Explorer shows an old verdict: the next check updates it. The older onboarding site https://hydra-site-one.vercel.app (/indexed/, /activity/) also shows the verdict. Also try /search/?q=hydra-demo-dapp.vercel.app and /observed/?domain=hydra-demo-dapp.vercel.app.
- Site left tampered after a failed run: `node demo/restore.mjs`.

## What this does not show

- One demo site, not the 248 watched sites.
- A match means the site serves the scripts the team published. It is not a claim that the site or its code is safe.
- The record shows what changed and when, not who changed it or why.
