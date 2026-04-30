Switch to EnterPlanMode. Read `~/.claude/memory/doc_structure_rules.md` before writing.

When the plan includes phases, add the following to the first and last steps of each phase:
- First step: `Read ~/.claude/memory/phase_start.md and execute`
- Last step: `Read ~/.claude/memory/phase_end.md and execute`

When the plan includes implementation changes: add an E2E test scenario section at the end of the plan. Follow the input format in `~/.claude/memory/reference_e2e_manager_guide.md`.

When the plan includes implementation changes, always include the following `## Meta` block at the top of the plan (below ⚡ Key Rules Summary):

```markdown
## Meta
- Security Impact: Yes | No | Unknown
- Reason: <1 line — which areas are affected if Yes/Unknown>
```
