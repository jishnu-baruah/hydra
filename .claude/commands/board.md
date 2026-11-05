---
description: Show the orchestration board + recent result quality
allowed-tools: Bash(cd:*), Bash(node:*)
---
Run `cd .filebus && node scripts/board.mjs summary` and summarize the task states (open / claimed / done / escalated). If `.filebus/bus/research` has records, mention the recent runs' PASS/ABSTAIN and faithfulness.
