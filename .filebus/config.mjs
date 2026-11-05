// config.mjs — model routing + providers.
// The whole speed/correctness story lives here. Edit tiers to change who does what.
//
// Tiers mirror Bombe's claim tiers:
//   T1 = deterministic/mechanical (boilerplate, scaffolding, format, obvious fixes)  -> cheapest, fastest, parallel
//   T2 = checkable (implement to a spec, write a test, derive a value)                -> mid model, needs >=2 agreeing OR 1 high-confidence
//   T3 = judgment (design, security tradeoff, "is this right?")                       -> frontier model; workers ABSTAIN, planner decides
//
// Providers come in three shapes:
//   "anthropic"   -> POST {base}/v1/messages           (Claude direct, z.ai GLM, exe.dev gateway)
//   "openai"      -> POST {base}/chat/completions       (Groq, Gemini OpenAI-compat, most others)
//   "claude-code" -> spawn `claude -p "<prompt>"`       (uses your Claude MAX subscription — no API key)
//
// Keys load from .env via `node --env-file-if-exists=.env ...` (the npm scripts do this).

export const PROVIDERS = {
  // Planner on your Max plan, consumed through headless Claude Code (no key, uses the subscription).
  claudeMax: { shape: "claude-code", model: "opus" },

  // Cheap/fast workers.
  // glm-5-turbo: ~7x faster than glm-4.6 with full-quality coding output (benched 9.5s vs 68.9s).
  // For max quality over speed, swap to "glm-5.3" (benched ~32s).
  glm:    { shape: "anthropic", base: process.env.GLM_BASE   || "https://api.z.ai/api/anthropic", key: process.env.GLM_KEY,    model: process.env.GLM_MODEL || "glm-5-turbo" },
  // Top-quality GLM for code/synthesis when correctness beats speed (benched ~32s vs turbo's ~9s).
  glmMax: { shape: "anthropic", base: process.env.GLM_BASE   || "https://api.z.ai/api/anthropic", key: process.env.GLM_KEY,    model: "glm-5.3" },
  groq:   { shape: "openai",    base: process.env.GROQ_BASE  || "https://api.groq.com/openai/v1", key: process.env.GROQ_KEY,   model: "openai/gpt-oss-120b", reasoning_effort: "low" },
  gemini: { shape: "openai",    base: process.env.GEM_BASE   || "https://generativelanguage.googleapis.com/v1beta/openai", key: process.env.GEM_KEY, model: "gemini-flash-latest" },
  // Frontier via API key, if you'd rather not use Claude Code for the planner:
  claudeApi: { shape: "anthropic", base: "https://api.anthropic.com", key: process.env.ANTHROPIC_API_KEY, model: "claude-opus-4-8" },
};

// The SWARM routes by task TIER (tasks in TASKS.md carry a Tier). This is that map.
export const ROUTES = {
  planner: PROVIDERS.claudeMax,   // decomposition + T3 judgment + final decisions  -> correctness
  1:       PROVIDERS.groq,        // mechanical grunt work                           -> speed (Groq free)
  2:       PROVIDERS.glm,         // checkable work: coding on glm-5-turbo           -> quality, fast
  3:       PROVIDERS.claudeMax,   // judgment — workers abstain, planner handles it  -> correctness
};

// The RESEARCH pipeline routes by what each STEP actually is — task-wise model selection.
// Each step goes to the model that fits it, chosen from the benchmarks. This is the knob to tune.
//   mechanical/fast steps -> Groq (free, ~170 tok/s)
//   write-ups & code      -> GLM (glm-5-turbo: quality + speed; glmMax = glm-5.3 for max quality)
//   hard judgment         -> Claude Max
export const TASKS = {
  decompose:  PROVIDERS.groq,      // question -> sub-queries: cheap, fast, parallel
  extract:    PROVIDERS.groq,      // compress each page to a digest: mechanical
  verify:     PROVIDERS.groq,      // entailment-check each claim: fast; the verdict is computed, not modeled
  synthesize: PROVIDERS.glm,       // write the cited answer: quality (glm-5-turbo)
  code:       PROVIDERS.glm,       // code generation: GLM's strength (glm-5-turbo; set to glmMax for top quality)
  judge:      PROVIDERS.claudeMax, // planning / "is this right?" / T3
};

export const SETTINGS = {
  bus: "./bus",                 // the shared filesystem message bus
  workersPerTask: 2,            // T2 consensus needs agreement across this many
  highConfidence: 85,           // a single T1/T2 finding at/above this auto-passes
  pollMs: 1000,                 // watcher poll interval
  maxTokens: 2048,
  // Your "no safety theater / no hedging" lever — applied to every worker call.
  workerSystem:
    "You are a worker agent. Be terse. No preamble, no caveats, no safety lectures, " +
    "no apologies. Output only what the task asks for. If the task is a judgment call " +
    "you cannot verify, reply exactly with the single token ABSTAIN.",
};
