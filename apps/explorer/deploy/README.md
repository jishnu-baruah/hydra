# Deploy the explorer

The explorer is static files with no build, served as they are. `apps/explorer/vercel.json` holds
the host settings: no install or build step, `trailingSlash` (so `/releases` becomes `/releases/`
and relative links resolve), and the security headers below.

## Option A: a second Vercel project from the repo (deploys on every push)

Needs a Vercel account that can see `jishnu-baruah/hydra` on GitHub, which only the repo owner can
grant. If the import list does not show the repo, install the Vercel GitHub app on it first, or use
option B.

1. In Vercel: **Add New** > **Project**, and import `jishnu-baruah/hydra`.
2. Set **Root Directory** to `apps/explorer`, and **Framework Preset** to **Other**. Leave the build
   and output settings empty; `vercel.json` sets them.
3. **Deploy**. No environment variables: the explorer has no keys.

## Option B: from a local checkout with the Vercel CLI (redeploy by hand)

For an account that cannot see the repo on GitHub.

```bash
cd apps/explorer && npx vercel@latest deploy --prod
```

The first run asks you to sign in and to name the project; accept `.` as the directory.

## After the first deploy

1. Check the acceptance: the home page and 1 app page (for example `/app/?name=hydra-test-a`) each
   load in under 3 s.
2. Set `EXPLORER` in `apps/extension/src/ui/links.js` to the new URL, then build the extension zip
   again (`node apps/extension/scripts/pack.mjs`), so its "Open on Hydra" links leave localhost.

## Security headers

| Header | Value, and why |
|---|---|
| `Content-Security-Policy` | Only this site's own files, the Arkiv SDK and Lenis from `cdn.jsdelivr.net`, Google Fonts, and reads from the Rabdi RPC. No inline script, no eval, no framing. Every page was checked with it: 0 violations |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `no-referrer`: the Swarm and Arkiv links do not learn which explorer page sent you |
| `Permissions-Policy` | no camera, microphone, location or payment |

Anything the pages start loading from a new origin must be added to the CSP, or the browser blocks it.
