#!/usr/bin/env node
// research.mjs — free, thorough, VERIFIED web research. Map-reduce pipeline.
//   node --env-file-if-exists=.env research.mjs "question" [--mode fast|deep] [--read N] [--tier 1|2|3]
//
// Each step runs on the model that fits it (config.mjs TASKS — task-wise model selection):
//   1. retrieve : decompose (TASKS.decompose) -> multi-engine -> RRF -> rerank -> read top (cached)
//   1b. map     : compress each page to a digest (TASKS.extract) — fast, fits TPM, keeps specifics
//   2. reduce   : synthesize over digests WITH [n] citations (TASKS.synthesize, or --quality / --model)
//   3. verify   : entailment-check each claim (TASKS.verify) -> COMPUTED faithfulness + fail-closed abstain
//
// FAST : <=3 sub-queries, 4 pages, single-model verify  -> sub-minute.
// DEEP : <=5 sub-queries, 8 pages, cross-provider ensemble verify -> slower, higher assurance.
//   --quality  synthesize with the top GLM (glmMax)   --model <id>  force a synthesis model
import { retrieve, readTop } from "./lib/retrieve.mjs";
import { compress } from "./lib/compress.mjs";
import { extractClaims, citationCheck, verifyClaims, score, normalizeCitations } from "./lib/verify.mjs";
import { callLLM } from "./lib/llm.mjs";
import { ROUTES, TASKS, PROVIDERS, SETTINGS } from "./config.mjs";
import fs from "node:fs";

const args = process.argv.slice(2);
const q = args.filter((a) => !a.startsWith("--"))[0];
if (!q) { console.error('usage: research.mjs "question" [--mode fast|deep] [--read N] [--quality] [--model <id>]'); process.exit(2); }
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };

const MODES = {
  fast: { maxSubs: 3, readN: 4, verifyRoutes: [TASKS.verify],                 minFaith: 0.5 },
  deep: { maxSubs: 5, readN: 8, verifyRoutes: [TASKS.verify, PROVIDERS.gemini], minFaith: 0.6 },
};
const mode = MODES[flag("--mode", "fast")] ? flag("--mode", "fast") : "fast";
const cfg = MODES[mode];
const readN = Number(flag("--read", cfg.readN));
// Synthesis model: task-wise default; --tier for legacy, --quality for top GLM, --model to force one.
const tierFlag = flag("--tier");
const synth = tierFlag ? ROUTES[tierFlag]
  : flag("--model") ? { ...PROVIDERS.glm, model: flag("--model") }
  : args.includes("--quality") ? PROVIDERS.glmMax
  : TASKS.synthesize;
const t0 = Date.now();

// 1. RETRIEVE
const { subs, backends, candidates, pooled } = await retrieve(q, { route: TASKS.decompose, topK: readN, maxSubs: cfg.maxSubs });
console.error(`[${mode}] backends=[${backends}] sub-queries=${subs.length} pooled=${pooled} -> top ${candidates.length}`);
if (!candidates.length) { console.error("no results"); process.exit(1); }
let pages = await readTop(candidates, readN);
console.error(`[${mode}] read ${pages.length}/${candidates.length} pages (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
if (!pages.length) { console.error("could not read any pages"); process.exit(1); }

// 1b. MAP — compress each page to a question-focused digest (fast/cheap tier)
pages = await compress(pages, q, TASKS.extract);
const used = pages.filter((p) => p.digest);
console.error(`[${mode}] mapped ${pages.length} pages -> ${used.length} with relevant evidence`);
if (!used.length) { console.error("no relevant evidence after compression"); process.exit(1); }

// 2. REDUCE / SYNTHESIZE over the digests (small context -> stays under free-tier TPM)
const sources = used.map((p, i) => `[${i + 1}] ${p.title}\nURL: ${p.url}\n${p.digest}`).join("\n\n---\n\n");
const synthSys =
  "You are a research analyst. Answer ONLY from the sources given. Cite every factual claim as [n]. " +
  "Keep each sentence to one idea so claims are checkable. If sources disagree, say so. " +
  "If they don't cover something, say 'not in sources' — never guess. Terse: findings first.";
console.error(`[${mode}] synthesize on ${synth.model}`);
const raw = await callLLM({ system: synthSys, prompt: `Question: ${q}\n\nSOURCES:\n${sources}\n\nAnswer with [n] citations.`, route: synth, maxTokens: SETTINGS.maxTokens });
const answer = normalizeCitations(raw);   // unify citation style so the gate and the reader see [n]

// 3. VERIFY (computed gate), checking each claim against its cited digest
const claims = extractClaims(answer);
const cite = citationCheck(claims, used.length);
const results = await verifyClaims(claims, used, cfg.verifyRoutes);
const s = score(results, { minFaithfulness: cfg.minFaith });

// Log this run's quality to the bus so a monitor (terminal watch or the pane mod) can show it.
try {
  fs.mkdirSync("bus/research", { recursive: true });
  fs.writeFileSync(`bus/research/${Date.now()}.json`, JSON.stringify({
    ts: new Date().toISOString(), question: q, mode, model: synth.model,
    faithfulness: s.faithfulness, supported: s.supported, checkable: s.checkable,
    abstain: s.abstain, confidence: s.confidence,
    seconds: Number(((Date.now() - t0) / 1000).toFixed(1)),
    sources: used.map((p) => p.url),
  }, null, 2));
} catch { /* monitoring is best-effort; never fail the run over it */ }

// Output
console.log("\n" + answer + "\n");
console.log("─".repeat(64));
console.log(`VERIFY (${mode}, ${cfg.verifyRoutes.length === 1 ? "single-model" : "cross-model ×" + cfg.verifyRoutes.length}): ` +
  `faithfulness ${s.faithfulness} (${s.supported}/${s.checkable} claims supported), computed confidence ${s.confidence}`);
if (cite.badRefs.length) console.log(`  ⚠ ${cite.badRefs.length} citation(s) point to a source that doesn't exist`);
if (s.unsupported.length) { console.log("  ⚠ unsupported claims:"); s.unsupported.forEach((r) => console.log(`     - ${r.text.slice(0, 110)}`)); }
if (s.unclear.length) console.log(`  · ${s.unclear.length} claim(s) unclear`);
console.log(s.abstain
  ? `  ✗ ABSTAIN — faithfulness ${s.faithfulness} below ${cfg.minFaith}. Treat as unverified; widen search or go --mode deep.`
  : `  ✓ PASS — verified above ${cfg.minFaith} threshold.`);
console.log("\nsources:");
used.forEach((p, i) => console.log(`  [${i + 1}] ${p.url}`));
console.error(`[${mode}] done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
