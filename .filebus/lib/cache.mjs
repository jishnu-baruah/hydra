// lib/cache.mjs — disk cache + in-flight dedup. The biggest latency win under fan-out is not
// re-fetching the same URL many parallel workers all want. Node builtins only.
//   withCache(ns, key, fn, ttlMs) -> cached value or runs fn once and stores it.
// In-flight coalescing means 5 workers asking for the same URL at once share ONE fetch.
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

const DIR = process.env.CACHE_DIR || "./bus/cache";
const inflight = new Map();
const hash = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 24);

export async function withCache(ns, key, fn, ttlMs = 0) {
  if (process.env.NO_CACHE) return fn();
  const file = path.join(DIR, ns, hash(key) + ".json");
  try {
    const st = fs.statSync(file);
    if (!ttlMs || Date.now() - st.mtimeMs < ttlMs) return JSON.parse(fs.readFileSync(file, "utf8")).v;
  } catch { /* miss */ }

  const ik = `${ns}:${key}`;
  if (inflight.has(ik)) return inflight.get(ik);          // coalesce concurrent identical calls
  const p = (async () => {
    const v = await fn();
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify({ t: Date.now(), v })); } catch { /* best effort */ }
    return v;
  })().finally(() => inflight.delete(ik));
  inflight.set(ik, p);
  return p;
}
