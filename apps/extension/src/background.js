import { STATES, isWeb } from "./verdict.js";
import { compare } from "./compare/compare.js";
import { appForDomain, appForHashes, latestManifest } from "./compare/lookup.js";
import { present } from "./ui/present.js";
import { showBanner } from "./ui/banner.js";
import { EXPLORER } from "./ui/links.js";

// Per tab, the script URLs the page loaded. webRequest sees runtime-loaded chunks that a scan of
// the HTML would miss (spike F3). Kept in storage.session, so it survives the worker sleeping.
const SETTLE_MS = 2500; // lazy chunks load after the load event
const POOL = 6;

const key = (tabId) => `s:${tabId}`;
const timers = new Map();
const bannered = new Set(); // tabs whose page may be showing the red banner
// In memory, so scripts that finish together are not lost to a read-then-write race on storage;
// mirrored to storage.session and read back after the worker wakes.
const seen = new Map();
async function urlsOf(tabId) {
  if (!seen.has(tabId)) seen.set(tabId, new Set((await chrome.storage.session.get(key(tabId)))[key(tabId)] ?? []));
  return seen.get(tabId);
}

async function paint(tabId, state, title) {
  const s = STATES[state];
  try {
    await chrome.action.setBadgeText({ tabId, text: s.text });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: s.color });
    await chrome.action.setTitle({ tabId, title: `Hydra: ${title ?? s.label}` });
  } catch {
    // The tab closed before we painted it. Nothing to show.
  }
}

chrome.webRequest.onBeforeRequest.addListener(
  (d) => {
    if (d.tabId < 0) return;
    seen.set(d.tabId, new Set());
    bannered.delete(d.tabId); // a navigation drops the old page and its banner
    chrome.storage.session.remove([key(d.tabId), `v:${d.tabId}`]);
    paint(d.tabId, isWeb(d.url) ? "checking" : "none");
  },
  { urls: ["<all_urls>"], types: ["main_frame"] },
);

// Top frame only: an iframe's scripts belong to whoever ships that frame (spike F3).
chrome.webRequest.onCompleted.addListener(
  async (d) => {
    if (d.tabId < 0 || d.frameId !== 0) return;
    const urls = await urlsOf(d.tabId);
    urls.add(d.url);
    chrome.storage.session.set({ [key(d.tabId)]: [...urls] });
    schedule(d.tabId);
  },
  { urls: ["<all_urls>"], types: ["script"] },
);

chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === "complete") schedule(tabId);
});
chrome.tabs.onRemoved.addListener((tabId) => {
  seen.delete(tabId);
  bannered.delete(tabId);
  chrome.storage.session.remove([key(tabId), `v:${tabId}`]);
});

// Check once the page has gone quiet, not on every script.
function schedule(tabId) {
  clearTimeout(timers.get(tabId));
  timers.set(tabId, setTimeout(() => check(tabId), SETTLE_MS));
}

// One retry before a script counts as unreadable, so a CDN hiccup is not a red badge.
const sha256Hex = (url) => sha256Once(url).catch(() => sha256Once(url));

async function sha256Once(url) {
  // Script bytes are data: hashed, never evaluated. no-store, so we hash what the host serves now.
  const res = await fetch(url, { cache: "no-store", credentials: "omit" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const digest = await crypto.subtle.digest("SHA-256", await res.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hashAll(urls) {
  const out = [];
  for (let i = 0; i < urls.length; i += POOL) {
    out.push(
      ...(await Promise.all(
        urls.slice(i, i + POOL).map((url) =>
          sha256Hex(url).then(
            (sha256) => ({ url, sha256 }),
            (e) => ({ url, error: String(e.message ?? e) }),
          ),
        ),
      )),
    );
  }
  return out;
}

async function check(tabId) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || !isWeb(tab.url)) return;
  const origin = new URL(tab.url).origin;
  const scripts = await hashAll([...(await urlsOf(tabId))]);

  let result;
  try {
    // Once a site is known, keep its app, so a site whose every script was swapped is still
    // compared (red) instead of looking unknown (grey).
    const known = (await chrome.storage.local.get(`app:${origin}`))[`app:${origin}`];
    const own = scripts.filter((s) => s.sha256 && new URL(s.url).origin === origin).map((s) => s.sha256);
    const app = known ?? (await appForDomain(new URL(tab.url).hostname)) ?? (await appForHashes(own));
    if (!app) {
      result = { verdict: "grey", reason: "No release on record matches this site's scripts." };
    } else {
      const found = await latestManifest(app);
      if (!found) {
        result = { verdict: "grey", app, reason: `No release of ${app} on record.` };
      } else {
        result = { ...compare(found.manifest, origin, scripts), app, version: found.release.version };
        // Remember the site's app only after a full match, so a stray hash match on a shared
        // file cannot bind a site to the wrong app for good.
        if (!known && result.verdict === "green") await chrome.storage.local.set({ [`app:${origin}`]: app });
      }
    }
  } catch (e) {
    result = { verdict: "grey", reason: `Could not reach the Hydra API (${e.message}). The page is unverified; reload to retry.` };
  }

  result = { ...result, origin, at: Date.now() };
  await chrome.storage.session.set({ [`v:${tabId}`]: result });
  const view = present(result, { explorer: EXPLORER, origin });
  await paint(tabId, result.verdict, title(view));
  await banner(tabId, view);
}

// Red puts the banner in the page; a later non-red result on the same page takes it down.
async function banner(tabId, view) {
  const red = view.state === "red";
  if (!red && !bannered.has(tabId)) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, func: showBanner, args: [red ? view : null] });
    if (red) bannered.add(tabId);
    else bannered.delete(tabId);
  } catch {
    // Pages the browser does not let extensions touch (the Web Store, other extensions). The
    // badge and the popup still carry the verdict.
  }
}

// The badge tooltip: present()'s message, plus the first 3 flagged files when red.
function title(view) {
  if (view.state !== "red") return view.message;
  const rest = view.items.length - 3 + view.more;
  const names = view.items.slice(0, 3).map((i) => `${i.path} (${i.text.toLowerCase()})`).join(", ");
  return `${names}${rest > 0 ? ` and ${rest} more` : ""}. ${view.message}`;
}
