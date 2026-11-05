// lib/verify.mjs — the computed verification gate (step 3 of the pipeline).
//
// Principle (repo contract): the VERDICT is computed arithmetic; the model only writes prose and
// casts per-claim SUPPORTED/NOT_SUPPORTED votes. Faithfulness, the ensemble majority, and the
// abstain decision are all math here — no LLM gets to declare the answer "good".
//
// Flow: split answer into claims (deterministic) -> check citations resolve (deterministic) ->
// entailment-check each claim against ITS cited source, optionally across several models
// (cross-provider ensemble, >=majority) -> compute faithfulness -> fail-closed abstain gate.
import { callLLM } from "./llm.mjs";

// Normalize the citation styles different models emit into [n]. gpt-oss uses 【1†Lx-Ly】;
// others use (1) or [[1]]. Run before claim extraction so verify always sees [n].
export function normalizeCitations(answer) {
  return answer
    .replace(/【\s*(\d+)[^】]*】/g, (_, n) => `[${n}]`)   // 【1†L78-L84】 -> [1]
    .replace(/\[\[(\d+)\]\]/g, "[$1]")                      // [[1]] -> [1]
    .replace(/(?<![\w\]])\((\d{1,2})\)(?=[\s.,;])/g, "[$1]"); // bare (1) -> [1]
}

// Split a cited answer into claim sentences, each tagged with the [n] indices it cites.
// Deterministic: breaks on lines/bullets first (markdown-safe), then on sentence boundaries.
export function extractClaims(answer) {
  const body = normalizeCitations(answer).replace(/CONFIDENCE:.*$/is, "").trim();
  const out = [];
  for (const rawLine of body.split(/\r?\n+/)) {
    const line = rawLine.replace(/^[\s>#*\-•]+/, "").replace(/\*\*/g, "").trim();  // strip bullet/heading/bold
    if (line.length < 8) continue;
    for (const s of line.split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)) {
      const text = s.trim();
      if (text.length < 8) continue;
      out.push({ text, cites: [...new Set([...text.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])))] });
    }
  }
  return out;
}

// Deterministic: every cited index exists; flag factual-looking sentences with no citation.
export function citationCheck(claims, nSources) {
  const badRefs = [];
  for (const c of claims) for (const i of c.cites) if (i < 1 || i > nSources) badRefs.push({ text: c.text, i });
  const uncited = claims.filter((c) => c.cites.length === 0 && /\d|\b(is|are|was|were|has|have|will|can|does)\b/i.test(c.text));
  return { badRefs, uncitedCount: uncited.length };
}

// One model's entailment judgment for one claim against its source. Verdict token parsed deterministically.
async function entail(claim, sourceText, route) {
  const system =
    "You are a strict fact-checker. Decide whether the SOURCE text supports the CLAIM. " +
    "End your reply with a line exactly: VERDICT: SUPPORTED  or  VERDICT: NOT_SUPPORTED  or  VERDICT: UNCLEAR.";
  const prompt = `CLAIM: ${claim}\n\nSOURCE:\n${sourceText.slice(0, 2000)}\n\nAnswer, then the VERDICT line:`;
  try {
    // Budget clears reasoning models' hidden reasoning; low reasoning_effort (set on the route)
    // keeps it short enough to stay under free-tier tokens-per-minute limits.
    const out = await callLLM({ system, prompt, route, maxTokens: 256 });
    // Prefer the explicit VERDICT line (last one wins); ignore the word elsewhere in reasoning.
    const marked = [...out.matchAll(/VERDICT:\s*(NOT[_\s]?SUPPORTED|SUPPORTED|UNCLEAR)/gi)];
    const pick = (v) => (/NOT/i.test(v) ? "NOT_SUPPORTED" : /UNCLEAR/i.test(v) ? "UNCLEAR" : "SUPPORTED");
    if (marked.length) return pick(marked[marked.length - 1][1]);
    const tail = out.slice(-40);                        // fallback: only trust the very end
    if (/NOT[_\s]?SUPPORTED/i.test(tail)) return "NOT_SUPPORTED";
    if (/SUPPORTED/i.test(tail)) return "SUPPORTED";
    return "UNCLEAR";
  } catch { return "UNCLEAR"; }
}

// Verify each cited claim against its source(s). `routes` is 1+ providers; >1 = cross-model ensemble.
// The per-claim verdict is the computed majority of independent votes — not any single model's call.
export async function verifyClaims(claims, pages, routes) {
  const out = [];
  for (const c of claims) {
    if (!c.cites.length) { out.push({ ...c, verdict: "UNCITED", votes: [] }); continue; }
    // check against the digest when present (whole, untruncated) else the raw body
    const src = c.cites.map((i) => pages[i - 1]?.digest || pages[i - 1]?.body || "").join("\n\n---\n\n");
    const votes = await Promise.all(routes.map((r) => entail(c.text, src, r)));
    const sup = votes.filter((v) => v === "SUPPORTED").length;
    const nsup = votes.filter((v) => v === "NOT_SUPPORTED").length;
    // computed majority; ties and NOT_SUPPORTED-leaning both fail closed
    const verdict = sup > nsup && sup >= Math.ceil(routes.length / 2) ? "SUPPORTED"
      : nsup >= sup && nsup > 0 ? "NOT_SUPPORTED" : "UNCLEAR";
    out.push({ ...c, verdict, votes });
  }
  return out;
}

// Computed faithfulness + fail-closed abstain decision. All arithmetic.
export function score(results, { minFaithfulness = 0.6 } = {}) {
  const checkable = results.filter((r) => r.verdict !== "UNCITED");
  const supported = checkable.filter((r) => r.verdict === "SUPPORTED").length;
  const faithfulness = checkable.length ? supported / checkable.length : 0;
  const unsupported = results.filter((r) => r.verdict === "NOT_SUPPORTED");
  const unclear = results.filter((r) => r.verdict === "UNCLEAR");
  const abstain = checkable.length === 0 || faithfulness < minFaithfulness;
  return {
    faithfulness: Number(faithfulness.toFixed(2)),
    supported, checkable: checkable.length,
    unsupported, unclear, abstain,
    confidence: Math.round(faithfulness * 100),
  };
}
