// lib/retrieve.mjs — the retrieval spine: decompose -> parallel multi-engine -> RRF fuse ->
// rerank -> read the few survivors. This is ~80% of research quality (BrowseComp: token spend
// per tier explains ~80% of variance), so it's step 1 of the plan->fan-out->verify->synthesize
// pipeline. Decompose + rerank use cheap/fast calls; nothing here needs a frontier model.
import { searchWith, availableBackends, readUrl } from "./search.mjs";
import { callLLM } from "./llm.mjs";
import { withCache } from "./cache.mjs";

const SEARCH_TTL = 6 * 3600 * 1000;        // search results go stale; 6h
const READ_TTL = 7 * 24 * 3600 * 1000;     // page bodies change slowly; 7d

// Normalize a URL so the same page from two engines fuses into one row (free dedup).
function normUrl(u) {
  try {
    const x = new URL(u);
    x.hash = "";
    for (const p of [...x.searchParams.keys()]) if (/^utm_|^ref$|^fbclid$|^gclid$/i.test(p)) x.searchParams.delete(p);
    let s = x.toString().replace(/\/$/, "");
    return s.toLowerCase();
  } catch { return (u || "").trim().toLowerCase().replace(/\/$/, "") || null; }
}

// Break a question into 3-5 focused search queries. Cheap/fast model. Simple questions pass through.
export async function decompose(query, route) {
  if (!route) return [query];
  const system = "You turn a research question into focused web-search queries. Output queries only.";
  const prompt = `Question: ${query}\n\nReturn 3-5 focused search queries that together cover this question, one per line, no numbering, no quotes. If the question is already simple and factual, return just the original question.`;
  try {
    const text = await callLLM({ system, prompt, route, maxTokens: 300 });
    const qs = text.split(/\r?\n/).map((s) => s.replace(/^[-*\d.)\s]+/, "").trim())
      .filter((s) => s && s.length > 2 && !/^CONFIDENCE:/i.test(s)).slice(0, 5);
    // keep the original query in the mix so we never lose the user's exact phrasing
    return [...new Set([query, ...qs])].slice(0, 5);
  } catch { return [query]; }
}

// Reciprocal Rank Fusion, keyed on normalized URL. score = sum 1/(k+rank). k=60 is the standard.
// URLs found by several engines rise; no calibrated scores needed.
export function rrfFuse(lists, k = 60) {
  const byUrl = new Map();
  for (const list of lists) {
    list.forEach((item, rank) => {
      const key = normUrl(item.url);
      if (!key) return;
      const cur = byUrl.get(key) || { title: item.title, url: key, snippet: item.snippet || "", score: 0, engines: 0 };
      cur.score += 1 / (k + rank + 1);
      cur.engines += 1;
      if (!cur.snippet && item.snippet) cur.snippet = item.snippet;
      if (!cur.title && item.title) cur.title = item.title;
      byUrl.set(key, cur);
    });
  }
  return [...byUrl.values()].sort((a, b) => b.score - a.score);
}

// Cross-encoder rerank via Jina's hosted API (needs JINA_KEY). Reranks on cheap snippets, not
// full pages. Fails open to the RRF order so retrieval never hard-depends on it.
export async function rerank(query, docs, topN = 8) {
  if (!process.env.JINA_KEY || docs.length <= topN) return docs.slice(0, topN);
  try {
    const documents = docs.map((d) => `${d.title || ""}\n${d.snippet || ""}`.slice(0, 800));
    const r = await fetch("https://api.jina.ai/v1/rerank", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.JINA_KEY}` },
      body: JSON.stringify({ model: "jina-reranker-v2-base-multilingual", query, documents, top_n: topN }),
    });
    if (!r.ok) return docs.slice(0, topN);
    const j = await r.json();
    return (j.results || []).map((x) => docs[x.index]).filter(Boolean);
  } catch { return docs.slice(0, topN); }
}

// Full spine: returns { subs, backends, candidates }. candidates are ranked, deduped, not yet read.
// Search calls are cached (6h) and concurrent-identical calls are coalesced.
export async function retrieve(query, { route, perQuery = 6, topK = 6, pool = 10, maxSubs = 5 } = {}) {
  const subs = (await decompose(query, route)).slice(0, maxSubs);
  const backends = availableBackends();
  // fan every sub-query across every backend at once — pay the slowest engine, not the sum
  const jobs = [];
  for (const sq of subs) for (const b of backends)
    jobs.push(withCache("search", `${b}|${perQuery}|${sq}`, () => searchWith(b, sq, perQuery), SEARCH_TTL).catch(() => []));
  const lists = await Promise.all(jobs);
  const fused = rrfFuse(lists);
  const candidates = await rerank(query, fused, Math.max(topK, pool));
  return { subs, backends, candidates: candidates.slice(0, topK), pooled: fused.length };
}

// Read the top candidates' full pages, in parallel (amortizes reader latency). Cached (7d),
// concurrent-identical reads coalesced. Drops failures.
export async function readTop(candidates, n, maxChars = 6000) {
  const settled = await Promise.allSettled(
    candidates.slice(0, n).map((c) =>
      withCache("read", `${maxChars}|${c.url}`, () => readUrl(c.url, maxChars), READ_TTL).then((body) => ({ ...c, body }))),
  );
  return settled.filter((s) => s.status === "fulfilled" && s.value.body).map((s) => s.value);
}
