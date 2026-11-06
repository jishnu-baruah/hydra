// A hostname on a public phishing list. The list is MetaMask's eth-phishing-detect (a "Don't Be A
// Dick" public licence, updated daily on GitHub). A copy is kept in storage.local, refreshed at
// most once a day, and every lookup runs in memory, so no visited hostname leaves the browser.
// The downloaded JSON is data: it is compared, never executed. A miss says nothing about safety.

export const LIST_URL = "https://raw.githubusercontent.com/MetaMask/eth-phishing-detect/main/src/config.json";
export const SOURCE = "MetaMask's phishing list";
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MIN_ENTRIES = 1000; // a real list has about 100,000; a tiny answer is an error page, not a list
const KEY = "blocklist";

// { black, white } as lower-case strings, or null when the answer is not a plausible list.
export function parseList(json, { min = MIN_ENTRIES } = {}) {
  const strings = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === "string" && x).map((x) => x.toLowerCase()) : []);
  if (!json || typeof json !== "object" || !Array.isArray(json.blacklist)) return null;
  const black = strings(json.blacklist);
  return black.length >= min ? { black, white: strings(json.whitelist) } : null;
}

// The listed domain that covers `host` (the host itself or a parent, never a bare TLD), or null. A
// host covered by the allowlist is never flagged, as in eth-phishing-detect.
export function matchHost(host, { black, white }) {
  const parts = String(host).toLowerCase().replace(/\.$/, "").split(".");
  const covers = (set) => {
    for (let i = 0; i < parts.length - 1; i++) {
      const d = parts.slice(i).join(".");
      if (set.has(d)) return d;
    }
    return null;
  };
  return covers(white) ? null : covers(black);
}

let memo = null; // { at, sets } so a woken worker parses the stored array once

async function load({ fetch: f = fetch, storage, now = Date.now, min }) {
  let stored = (await storage.get(KEY))[KEY] ?? null;
  if (!stored || now() - stored.at > MAX_AGE_MS) {
    try {
      const res = await f(LIST_URL, { cache: "no-store", credentials: "omit" });
      if (res.ok && Number(res.headers.get("content-length") ?? 0) <= MAX_BYTES) {
        const text = await res.text();
        const list = text.length <= MAX_BYTES ? parseList(JSON.parse(text), { min }) : null;
        if (list) {
          stored = { at: now(), ...list };
          await storage.set({ [KEY]: stored });
        }
      }
    } catch {
      // Offline, rate limited or junk: keep whatever copy we have.
    }
  }
  if (!stored) return null;
  if (memo?.at !== stored.at) memo = { at: stored.at, sets: { black: new Set(stored.black), white: new Set(stored.white) } };
  return memo.sets;
}

// The listed domain covering `host`, or null (not listed, or no list could be loaded). Never throws.
export async function listedHost(host, opts) {
  try {
    const sets = await load(opts);
    return sets ? matchHost(host, sets) : null;
  } catch {
    return null;
  }
}
