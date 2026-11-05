// lib/compress.mjs — the "map" of map-reduce. Each fetched page is compressed by a fast/cheap
// model into a question-focused digest that keeps the specifics (numbers, names, dates) and drops
// the fluff. Synthesis then runs over the small digests, which (a) keeps one request under the
// free-tier token-per-minute ceiling and (b) lets the verify gate check claims against the WHOLE
// digest instead of an arbitrary mid-page slice — so it stops false-abstaining on true answers.
import { callLLM } from "./llm.mjs";

const MAP_SYS =
  "You extract evidence. From the SOURCE, pull only the facts that help answer the QUESTION. " +
  "Terse bullet points. Keep numbers, names, dates and short quotes EXACT. Omit everything else. " +
  "If the source has nothing relevant, reply with exactly: NONE";

// Run fn over items with a concurrency cap (gentler on per-minute rate limits than Promise.all).
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  }));
  return out;
}

// Returns pages with a `.digest` field ("" when the page had nothing relevant). Fails open to a
// raw truncation so a map error never drops a source silently.
export async function compress(pages, question, route, { concurrency = 2, maxOut = 500, srcChars = 3000 } = {}) {
  return mapLimit(pages, concurrency, async (p) => {
    try {
      const digest = await callLLM({
        system: MAP_SYS,
        prompt: `QUESTION: ${question}\n\nSOURCE (${p.title}):\n${(p.body || "").slice(0, srcChars)}`,
        route, maxTokens: maxOut,
      });
      return { ...p, digest: /^\s*NONE\s*$/i.test(digest) ? "" : digest.trim() };
    } catch { return { ...p, digest: (p.body || "").slice(0, 1500) }; }
  });
}
