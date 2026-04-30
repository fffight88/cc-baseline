---
name: Code Reviewer Agent Protocol
description: code-reviewer agent auto-trigger conditions, call protocol, loop management, decision_type follow-up handling guide
type: reference
---

## ⚡ Key Rules Summary

- ✅ DO: `Code Quality Impact: Yes/Unknown` → auto-call code-reviewer after plan completion
- ✅ DO: If `Security Impact: Yes/Unknown` is also met, **call in parallel with security-auditor in a single message**
- ✅ DO: Use `regenerate_profile: true` only after large-scale changes to key_files
- ❌ DON'T: Never trigger notifications at audit start or completion (only immediately before design/business issue interview)
- ❌ DON'T: Never ask code-reviewer to check security vulnerabilities or secrets (security-auditor territory)

---

## 1. Auto-trigger Conditions

Based on the `Code Quality Impact` field in the `## Meta` block at the top of a plan file:

- `Yes` or `Unknown` → auto-call code-reviewer after that plan completes
- `No` → skip review
- Field missing → treat as `Unknown` and auto-call

**Explicit request:** call immediately when the user explicitly says "code review / quality check".

---

## 2. Call Protocol

Prompt structure when the orchestrator calls code-reviewer via Agent tool:

```
plan_paths:
  - <absolute path 1>
target_dir: <absolute path to project root under review>
iteration: 1
previous_report_path: null  # path to previous report on re-review
regenerate_profile: false   # true only after large-scale key_files changes

## Output Constraints (strictly enforced)
- ❌ No pasting full file content, raw command output, or intermediate logs
- ❌ No process narration
- ❌ No role scope violations
- ✅ Fill in only the return format fields below
- Length limit: under 500 characters

Return format:
- Report path (md): <abs path>
- Report path (json): <abs path>
- Summary: critical=N / high=N / medium=N / low=N
- profile_status: generated | cached | regenerated
- next_action: done | self_fix | user_interview
```

### Parallel Call (simultaneous with security-auditor)

When both `Security Impact: Yes/Unknown` and `Code Quality Impact: Yes/Unknown` apply:

```
# call both agents simultaneously in a single message (no report filename collision)
# security-auditor → .cc-audits/<slug>/iter-<n>.md
# code-reviewer    → .cc-audits/<slug>/code-review-iter-<n>.md
```

---

## 3. Loop Management

- **Termination A (success)**: CRITICAL·HIGH = 0 → terminate immediately. MEDIUM/LOW included in final report.
- **Termination B (limit reached)**: 3 iterations → report remaining issues to user and stop.
- Record iteration count in a `## Code Review History` section at the bottom of the plan file each loop.

```markdown
## Code Review History
- code-review-iter-1: 2026-04-27 / critical=0 high=2 medium=1 / profile_status=generated / next_action=self_fix
- code-review-iter-2: 2026-04-27 / critical=0 high=0 medium=1 / profile_status=cached / next_action=done
```

---

## 4. Follow-up by decision_type

| decision_type | Follow-up |
|---------------|-----------|
| `auto` | orchestrator fixes code and requests re-review |
| `design` | user interview (AskUserQuestion) then design change |
| `business` | user interview (AskUserQuestion) then policy decision |

---

## 5. Notification Before Interview

When 1 or more `design` or `business` issues exist, always run this before AskUserQuestion:

```bash
MSG="Code review: user decision required (N issues)"  # replace N with actual design+business count
if command -v terminal-notifier >/dev/null 2>&1; then
  terminal-notifier -title "Claude Code" -message "$MSG" -sound Glass
elif [ "$(uname)" = "Darwin" ]; then
  osascript -e "display notification \"$MSG\" with title \"Claude Code\" sound name \"Glass\"" \
    || osascript -e "display dialog \"$MSG\" with title \"Claude Code\" buttons {\"OK\"} default button \"OK\""
elif command -v notify-send >/dev/null 2>&1; then
  notify-send "Claude Code" "$MSG"
fi
```

---

## 6. Report Path Rules

```
<target_dir>/.cc-audits/<plan-slug>/code-review-iter-<n>.md
<target_dir>/.cc-audits/<plan-slug>/code-review-iter-<n>.json
<target_dir>/.cc-audits/project-patterns.md   # shared profile (reused across plans)
```

`plan-slug` is the plan filename without extension. Example: `wondrous-bubbling-newell`

---

## 8. HTML Report After Audit Completes

When the loop reaches `done` (critical=0/high=0) or the limit (3 iterations), the orchestrator runs:

```bash
AUDIT_DIR="<target_dir>/.cc-audits/<plan-slug>"
node ~/.claude/scripts/audit-report.js "$AUDIT_DIR"
# macOS:
open "$AUDIT_DIR/report.html"
# Linux:
# xdg-open "$AUDIT_DIR/report.html"
```

- ✅ DO: Auto-open once at loop termination
- ✅ DO: When called in parallel with security-auditor, **the orchestrator runs this once after both agents complete** (both reports in the same AUDIT_DIR combine into a single HTML)
- ❌ DON'T: Never auto-open on every iteration (disrupts the fix workflow)

---

## 7. Profile Cache Management

| Situation | `regenerate_profile` value | Reason |
|-----------|--------------------------|--------|
| Normal run | `false` (default) | hash-based auto-detection is sufficient |
| Large-scale package upgrade | `true` | force refresh before key_files hash changes |
| After architecture refactor | `true` | reflect full convention change |
| `project-patterns.md` corrupted or deleted | `true` | force regeneration |
