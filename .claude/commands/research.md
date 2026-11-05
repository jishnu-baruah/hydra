---
description: Verified web research — search, read, synthesize, verify
argument-hint: <question>
allowed-tools: Bash(cd:*), Bash(node:*)
---
Run exactly this and show me the result:

`cd .filebus && node --env-file-if-exists=../.env research.mjs "$ARGUMENTS" --mode fast`

Then present, concisely:
- the answer with its [n] citations,
- the computed verdict line (faithfulness, PASS or ABSTAIN),
- the source links.

If it ABSTAINs, say so plainly and offer to re-run with `/deep $ARGUMENTS` (deeper search + cross-model verification).
