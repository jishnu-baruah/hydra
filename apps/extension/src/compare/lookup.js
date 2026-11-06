// Which app a page belongs to, and that app's latest manifest, through the Hydra API's public read
// routes. Those routes keep only records the publisher wallet wrote (apps/api/src/reads.ts), and
// an MV3 extension cannot load the Arkiv SDK from a CDN. Everything returned is data: it is
// compared, never executed.

export const API_DEFAULT = "https://hydra-api-5xmn.onrender.com";

// A test may point the extension at a local API through storage.local "api". Only localhost is
// accepted, so nothing a page does can move the extension to another server.
async function api() {
  const { api: o } = await chrome.storage.local.get("api");
  try {
    if (o && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(o).hostname)) return o.replace(/\/+$/, "");
  } catch {
    // Not a URL: use the default.
  }
  return API_DEFAULT;
}
const GATEWAY = "https://api.gateway.ethswarm.org";
const TIMEOUT_MS = 20000; // the API's free host sleeps; a cold start takes a while

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), credentials: "omit" });
  if (!res.ok) throw new Error(`${new URL(url).host} answered HTTP ${res.status}`);
  return res.json();
}

// The app that proved this hostname (the site served hydra.txt for it when the app published). Asked
// before the script hashes, so a site whose every script was swapped still names its app and goes
// red on a first visit. Any failure, or an API without the route, is just "unknown": null.
export async function appForDomain(hostname) {
  if ((hostname ?? "").length > 253 || !/^(?:(?!-)[a-z0-9-]{1,63}(?<!-)\.)+(?!-)[a-z0-9-]{1,63}(?<!-)$/i.test(hostname ?? "")) return null;
  try {
    const { app } = await getJson(`${await api()}/v1/domains/${hostname.toLowerCase()}`);
    return typeof app === "string" && app ? app : null;
  } catch {
    return null;
  }
}

// The first of these hashes that the API has on record names the app. Up to `tries` lookups.
export async function appForHashes(hexes, tries = 5) {
  for (const hex of hexes.slice(0, tries)) {
    const { files } = await getJson(`${await api()}/v1/files/sha256-${hex}`);
    if (files?.length) return String(files[0].app);
  }
  return null;
}

// The newest release's manifest: in the release payload when it fit, else on Swarm.
export async function latestManifest(app) {
  const { releases } = await getJson(`${await api()}/v1/apps/${encodeURIComponent(app)}/releases`);
  const latest = releases?.[0];
  if (!latest) return null;
  if (latest.payload?.manifest) return { manifest: latest.payload.manifest, release: latest };
  if (/^[0-9a-f]{64}$/.test(String(latest.swarm_ref))) {
    return { manifest: await getJson(`${GATEWAY}/bzz/${latest.swarm_ref}/hydra-manifest.json`), release: latest };
  }
  throw new Error(`release ${latest.version} of ${app} has no readable manifest`);
}
