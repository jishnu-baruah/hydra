---
description: Decompose a goal and run the file-bus agent swarm
argument-hint: <goal>
allowed-tools: Bash(cd:*), Bash(node:*)
---
Do these in order and report after each. The board lives in `.filebus/TASKS.md` (self-contained sandbox).

1. `cd .filebus && node --env-file-if-exists=../.env orchestrator.mjs "$ARGUMENTS"` — the planner decomposes the goal into tiered tasks in TASKS.md.
2. `cd .filebus && node --env-file-if-exists=../.env swarm.mjs` — spawn workers to execute the open tasks.
3. `cd .filebus && node scripts/board.mjs summary` — show the board.

Then tell me what got done, what escalated (tier-3 judgment for me), and anything blocked on an operator decision in `.filebus/OPERATOR_TODO.md`.
