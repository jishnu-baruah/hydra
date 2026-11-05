<!--
One task, one PR. The `board` job reads the lines below, so keep the labels exactly as written.
Delete nothing. If a line does not apply, write "n/a" and why.
-->

**Task:** T-

**Serves:** <!-- copy the Serves line from your TASKS.md row: a judged criterion (Technicality,
Originality, Practicality, Usability, WOW factor) or a prize (Arkiv track, Swarm bonus). -->

**Acceptance, and the number it hit:** <!-- the acceptance line from your row, then what you
measured. "21 records in 38 s" not "works". -->

**Evidence:** <!-- tx hash, Swarm reference, Actions run, deployed URL, recording. `board` refuses
`Status: done` without one. -->

**Finding:** <!-- what you discovered that nobody expected, with its number. Write "none" only if
you genuinely looked. -->

---

- [ ] `TASKS.md` row updated: `Status: in-review <this PR>`, and the branch matches `Branch:`
- [ ] I changed only files in my row's `Touches:` line
- [ ] `/code-review` at medium run
- [ ] `superpowers:verification-before-completion` run
- [ ] Hashing or compare logic has its failing test first, committed before the implementation
- [ ] No em dashes or en dashes anywhere in the diff

**Dependency:** <!-- Required only if this PR adds a dependency. Say why the stdlib, a native
platform feature, or an already-installed package will not do. -->

**Diff-size:** <!-- Required only if the diff is over 600 changed lines. Split, or say why not. -->

**Second reviewer needed?** <!-- CI cannot see these, so a human must. Tick and name them. -->

- [ ] Touches `apps/api` keys, signing or Arkiv writes, so `/security-review` was also run
- [ ] Changes the record contract (`docs/ARCHITECTURE.md` or `packages/core/src/records.ts`), so the API, explorer and extension owners agreed

**Reviewer:** <!-- name, or "CI only". Not the person who wrote the code. -->
