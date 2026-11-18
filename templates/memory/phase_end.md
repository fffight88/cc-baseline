---
name: Phase End Checklist
description: Checklist to complete before ending a phase
type: feedback
---

Before ending a phase, first update the project wiki, then repeat the loop below until all tasks are complete.

**[Wiki — only when `docs/wiki/` exists and this phase added or changed a screen or a cross-screen feature]**

Write or update the page of each such screen/feature (`~/.claude/memory/reference_wiki.md` §2 — read the files you list), then run `node ~/.claude/scripts/wiki.js stamp <slugs>`, `wiki.js index` and `wiki.js check --strict` (must exit 0).


**[Repeat loop — continue until all tasks are confirmed complete]**

1. Check the task list for this phase from TaskList or the plan.
2. Check whether any tasks are incomplete.
3. If there are incomplete tasks, execute them immediately.
4. After execution, return to step 1 and re-confirm all tasks are complete.
5. When all tasks are confirmed complete, exit the loop and close the phase.

**Why:** To ensure no tasks are missed and the phase is fully wrapped up before closing.
