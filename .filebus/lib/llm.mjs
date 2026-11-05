// lib/llm.mjs — one call, three provider shapes. Set DRY=1 to run the whole pipeline with no keys.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileP = promisify(execFile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// POST JSON with retry/backoff on 429 (rate limit) and 5xx. Honors Retry-After when present.
async function postJSON(url, headers, body, label) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    if ((r.status === 429 || r.status >= 500) && attempt < 3) {
      const ra = Number(r.headers.get("retry-after"));
      await sleep(ra ? ra * 1000 + 250 : 1500 * (attempt + 1));
      continue;
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${label} ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
    return j;
  }
}

export async function callLLM({ system, prompt, route, maxTokens = 2048 }) {
  if (process.env.DRY) return `[dry:${route.model}] ${prompt.slice(0, 60)}\nCONFIDENCE: 90`;

  if (route.shape === "claude-code") {
    // Uses your Claude Max subscription via headless Claude Code. No API key.
    const args = ["-p", prompt, "--model", route.model];
    if (system) args.push("--append-system-prompt", system);
    const { stdout } = await execFileP("claude", args, { maxBuffer: 64 * 1024 * 1024 });
    return stdout.trim();
  }

  if (route.shape === "anthropic") {
    const j = await postJSON(`${route.base}/v1/messages`,
      { "content-type": "application/json", "x-api-key": route.key || "", "anthropic-version": "2023-06-01" },
      { model: route.model, max_tokens: maxTokens, system, messages: [{ role: "user", content: prompt }] },
      "anthropic");
    // Find the text block — reasoning models (GLM-4.6) emit a `thinking` block at index 0 first.
    return ((j.content || []).find((c) => c.type === "text")?.text ?? "").trim();
  }

  if (route.shape === "openai") {
    const j = await postJSON(`${route.base}/chat/completions`,
      { "content-type": "application/json", authorization: `Bearer ${route.key || ""}` },
      {
        model: route.model, max_tokens: maxTokens,
        ...(route.reasoning_effort ? { reasoning_effort: route.reasoning_effort } : {}),
        messages: [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: prompt }],
      },
      "openai");
    return (j.choices?.[0]?.message?.content ?? "").trim();
  }
  throw new Error(`unknown route shape: ${route.shape}`);
}

export function parseConfidence(text, fallback = 50) {
  const m = /CONFIDENCE:\s*(\d{1,3})/i.exec(text);
  return m ? Math.min(100, Number(m[1])) : fallback;
}
