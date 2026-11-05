import { sha256Hex } from "./hash.js";

// tabId -> Map(script url -> { status, from_cache }). webRequest sees every script the page
// loads, including ones added at runtime, which a scan of the HTML would miss (spike T12).
const seen = new Map();

chrome.webRequest.onBeforeRequest.addListener(
  (d) => d.tabId >= 0 && seen.set(d.tabId, new Map()),
  { urls: ["<all_urls>"], types: ["main_frame"] },
);

chrome.webRequest.onCompleted.addListener(
  (d) => {
    if (d.tabId < 0) return;
    if (!seen.has(d.tabId)) seen.set(d.tabId, new Map());
    // frame_id 0 is the top document; anything else came from an iframe in the tab.
    seen.get(d.tabId).set(d.url, { status: d.statusCode, from_cache: d.fromCache, frame_id: d.frameId });
  },
  { urls: ["<all_urls>"], types: ["script"] },
);

chrome.tabs.onRemoved.addListener((tabId) => seen.delete(tabId));

async function fetchHash(url) {
  // Script bytes are data: hashed, never evaluated. no-store, so we hash what the host serves now.
  const res = await fetch(url, { cache: "no-store", credentials: "omit" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return sha256Hex(await res.arrayBuffer());
}

// Re-fetch every script the tab loaded and hash it twice, so scripts that change on every
// request show up as unstable. Called by spikes/F3/run.mjs.
globalThis.hydraReport = async (pageUrl) => {
  const [tab] = (await chrome.tabs.query({})).filter((t) => t.url === pageUrl);
  if (!tab) throw new Error(`No open tab at ${pageUrl}. Open the page, then ask again.`);
  const scripts = [];
  for (const [url, info] of seen.get(tab.id) ?? []) {
    const row = { url, ...info };
    const t0 = performance.now();
    try {
      const [a, b] = [await fetchHash(url), await fetchHash(url)];
      Object.assign(row, { sha256: a, stable: a === b });
    } catch (e) {
      row.error = String(e.message ?? e);
    }
    row.ms = Math.round(performance.now() - t0);
    scripts.push(row);
  }
  return scripts;
};
