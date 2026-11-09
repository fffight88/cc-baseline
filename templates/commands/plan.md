Switch to EnterPlanMode. Read `~/.claude/memory/doc_structure_rules.md` before writing.

When the plan includes phases, add the following to the first and last steps of each phase:
- First step: `Read ~/.claude/memory/phase_start.md and execute`
- Last step: `Read ~/.claude/memory/phase_end.md and execute`

When the plan includes implementation changes, always include the following `## Meta` block at the top of the plan (below ⚡ Key Rules Summary):

```markdown
## Meta
- Security Impact: Yes | No | Unknown
- Code Quality Impact: Yes | No | Unknown
- UI Impact: Yes | No | Unknown
- Behavior Impact: Yes | No | Unknown
- Reason: <1 line — which areas are affected if Yes/Unknown>
```

`Behavior Impact` = the change alters what a user can do or what they see as a result (new/changed flow, rule, error, output). Pure refactors, docs and build config with no user-visible change are `No`.

When `Behavior Impact: Yes` or `Unknown`: read `~/.claude/memory/reference_tc_authoring.md`, then while writing the plan
1. Write the user actions and TCs into `docs/tc/<feature>.tc.json` (reading the source directly for the current behavior).
2. Run the authoring checks — `node ~/.claude/scripts/tc-lint.js <tc file>`, plus `node ~/.claude/scripts/tc-jev-check.js <tc file>` (does nothing without a Jev key). Fix each warning or note why it stays.
3. Add a `## Test Cases` section to the plan: the TC file path, a summary table (TC ID · title · surface · readiness · expected-result count) and the check summary (warnings by rule, warnings kept and why). Approving the plan freezes these TCs.

When the plan includes implementation changes: add an E2E section at the end of the plan. With TCs, it lists which `ui-web` TCs e2e will run and the run add-on (`.cc-audits/<plan-slug>/tc-run.json`: base URL, start paths, accounts, fixtures, skip reasons) — never new steps or expected results. Without TCs, write the scenario in the input format of `~/.claude/memory/reference_e2e_manager_guide.md`.
