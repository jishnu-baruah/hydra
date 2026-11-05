---
description: Deep verified research, cross-model, GLM synthesis, through the filebus-research kit
argument-hint: <question>
allowed-tools: Bash(node scripts/research.mjs:*)
---
Run exactly this and show me the result:

`node scripts/research.mjs research "$ARGUMENTS" --mode deep --tier 2`

Present the answer with [n] citations, the computed verdict (faithfulness, PASS or ABSTAIN) and the source links. Open the cited source before a number goes into a doc.
