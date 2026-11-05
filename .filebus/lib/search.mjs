// lib/search.mjs — web search + page read. Zero deps (global fetch).
//
// Search is a TOOL, not a model. "Thorough / unfiltered" is about the backend, not the LLM.
// Each backend is individually callable via searchWith(), so the retrieval spine can fan one
// query across several at once and fuse the results. webSearch() keeps the old single-backend
// behaviour (auto-picks the best one you have a key for).
//
// Backends:  tavily (TAVILY_KEY) · brave (BRAVE_KEY) · jina (JINA_KEY) · searxng (SEARXNG_URL) · ddg (keyless)

const UA = "Mozilla/5.0 (filebus-orchestrator)";

// Auto-pick a single backend (used by webSearch / research single-source mode).
export function searchBackend() {
  if (process.env.SEARCH_BACKEND) return process.env.SEARCH_BACKEND;
  if (process.env.TAVILY_KEY) return "tavily";
  if (process.env.BRAVE_KEY) return "brave";
  if (process.env.JINA_KEY) return "jina";
  if (process.env.SEARXNG_URL) return "searxng";
  return "ddg";
}

// Every backend we can actually hit right now — what the spine fans across in parallel.
export function availableBackends() {
  const b = [];
  if (process.env.TAVILY_KEY) b.push("tavily");
  if (process.env.BRAVE_KEY) b.push("brave");
  if (process.env.JINA_KEY) b.push("jina");
  if (process.env.SEARXNG_URL) b.push("searxng");
  return b.length ? b : ["ddg"];
}

function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Search one named backend. Returns [{ title, url, snippet }]. Throws on HTTP error.
export async function searchWith(backend, query, n = 6) {
  if (backend === "tavily") {
    const r = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ api_key: process.env.TAVILY_KEY, query, max_results: n, search_depth: "advanced" }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(`tavily ${r.status}: ${JSON.stringify(j).slice(0, 160)}`);
    return (j.results || []).map((x) => ({ title: x.title, url: x.url, snippet: x.content }));
  }

  if (backend === "brave") {
    const u = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${n}`;
    const r = await fetch(u, { headers: { accept: "application/json", "x-subscription-token": process.env.BRAVE_KEY } });
    const j = await r.json();
    if (!r.ok) throw new Error(`brave ${r.status}: ${JSON.stringify(j).slice(0, 160)}`);
    return (j.web?.results || []).slice(0, n).map((x) => ({ title: x.title, url: x.url, snippet: x.description }));
  }

  if (backend === "jina") {
    const r = await fetch(`https://s.jina.ai/?q=${encodeURIComponent(query)}`, {
      headers: { accept: "application/json", "x-respond-with": "no-content", authorization: `Bearer ${process.env.JINA_KEY || ""}` },
    });
    if (!r.ok) throw new Error(`jina search ${r.status}: ${(await r.text()).slice(0, 160)}`);
    const j = await r.json();
    const data = j.data || j.results || [];
    return data.slice(0, n).map((x) => ({ title: x.title, url: x.url, snippet: x.description || x.snippet || "" }));
  }

  if (backend === "searxng") {
    const base = process.env.SEARXNG_URL.replace(/\/$/, "");
    const r = await fetch(`${base}/search?q=${encodeURIComponent(query)}&format=json`, { headers: { "user-agent": UA } });
    const j = await r.json();
    if (!r.ok) throw new Error(`searxng ${r.status}`);
    return (j.results || []).slice(0, n).map((x) => ({ title: x.title, url: x.url, snippet: x.content }));
  }

  // keyless DuckDuckGo HTML endpoint. Fragile but needs no key.
  const r = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: { "user-agent": UA, accept: "text/html" },
  });
  if (!r.ok) throw new Error(`ddg ${r.status}`);
  const html = await r.text();
  const out = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) && out.length < n) {
    let href = m[1];
    const uddg = /[?&]uddg=([^&]+)/.exec(href);
    if (uddg) href = decodeURIComponent(uddg[1]);
    if (href.startsWith("//")) href = "https:" + href;
    out.push({ title: stripTags(m[2]), url: href, snippet: "" });
  }
  return out;
}

// Single-backend search (auto-picked). Back-compat with the original API.
export async function webSearch(query, n = 6) {
  return searchWith(searchBackend(), query, n);
}

// Fetch a page as clean text. r.jina.ai (great markdown) when JINA_KEY is set, else raw strip.
export async function readUrl(url, maxChars = 6000) {
  let text;
  if (process.env.JINA_KEY) {
    const r = await fetch(`https://r.jina.ai/${url}`, {
      headers: { "user-agent": UA, "x-retain-images": "none", authorization: `Bearer ${process.env.JINA_KEY}` },
    });
    if (!r.ok) throw new Error(`jina read ${r.status} for ${url}`);
    text = await r.text();
  } else {
    const r = await fetch(url, { headers: { "user-agent": UA, accept: "text/html" } });
    if (!r.ok) throw new Error(`fetch ${r.status} for ${url}`);
    text = stripTags(await r.text());
  }
  return text.length > maxChars ? text.slice(0, maxChars) + "\n…[truncated]" : text;
}
