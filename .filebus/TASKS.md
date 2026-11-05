# TASKS.md, the board

The board and the lock. Read sections 1 to 3, then claim exactly one task and work only on it.

## 1. The lock: claim before you write code

One task, one owner. Pick the claim mode that fits your setup:

**Local / fast mode (one machine, a swarm of local agents).** A claim is an atomic lock file. The
worker does this for you: `bus/claims/<id>.OWNED` is created with `wx` (fail-if-exists), so the
second claimant loses the race instantly. No git, no server. This is the default.

**Multi-device / multi-person mode (agon-dev style).** `dev` is branch-protected; nobody pushes to
it directly. A claim is a one-line PR on branch `claim/t-<id>` that edits only the `- Status:` line
of the task you want. The second claim PR on the same task conflicts on that exact line and cannot
merge, so git settles the race. Then branch `feature/t-<id>-<slug>` off updated `dev` and work.

If your claim loses the race (lock exists, or the PR conflicts): **someone beat you to it. Pick
another task.**

## 2. Every result carries evidence

A task is `done` only when its `Evidence:` names a real artifact (a findings file, a test name, a
measured number). `Status: done` with a placeholder `Evidence:` fails the lint.

## 3. Row format

Status values: `open` | `claimed <date> | Owner: <name>` | `in-review <link>` |
`blocked, see OP-N` | `done` | `cut <date>: <reason>`.

```
### T-000, Example row (this block is the format, not a real task)
- Status: open
- Tier: 1
- Depends-on: -
- Touches: src/example.ts
- Acceptance: what "done" means, stated with a number
- Evidence: -
```

---

### T-001, Scaffold the example module
- Status: open
- Tier: 1
- Depends-on: -
- Touches: src/hello.mjs
- Acceptance: `node src/hello.mjs` prints "hello" and exits 0
- Evidence: -

### T-002, Add a checkable helper with a test
- Status: open
- Tier: 2
- Depends-on: T-001
- Touches: src/sum.mjs
- Acceptance: sum([1,2,3]) returns 6; one failing test written first then made green
- Evidence: -

### T-003, Decide the retry/backoff policy for the worker
- Status: open
- Tier: 3
- Depends-on: -
- Touches: config.mjs
- Acceptance: a policy chosen with its tradeoff recorded in DECISIONS.md
- Evidence: -
