---
description: Verified web research (fast) through the filebus-research kit
argument-hint: <question>
allowed-tools: Bash(node scripts/research.mjs:*)
---
Run exactly this and show me the result:

`node scripts/research.mjs research "$ARGUMENTS" --mode fast`

Then present, concisely:
- the answer with its [n] citations,
- the computed verdict line (faithfulness, PASS or ABSTAIN),
- the source links.

Treat the answer as leads, not facts: open the cited source before a number goes into a doc. If it ABSTAINs, say so and offer `/deep $ARGUMENTS`.
