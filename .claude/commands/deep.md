---
description: Deep verified research — wider search, cross-model verification, GLM synthesis
argument-hint: <question>
allowed-tools: Bash(cd:*), Bash(node:*)
---
Run exactly this and show me the result:

`cd .filebus && node --env-file-if-exists=../.env research.mjs "$ARGUMENTS" --mode deep --tier 2`

Present the answer with [n] citations, the computed verdict (faithfulness, PASS/ABSTAIN), and the source links. This mode is slower but higher-assurance (GLM synthesis + Groq/Gemini ensemble verification).
