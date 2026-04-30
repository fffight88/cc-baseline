---
name: Security Auditor Agent Protocol
description: security-auditor agent auto-trigger conditions, call protocol, loop management, decision_type follow-up handling guide
type: reference
---

## 1. Auto-trigger Conditions

Based on the `Security Impact` field in the `## Meta` block at the top of a plan file:

- `Yes` or `Unknown` → auto-call security-auditor after that plan completes
- `No` → skip audit
- Field missing → treat as `Unknown` and auto-call

**Explicit request:** call immediately when the user explicitly says "security check / security audit".

## 2. Call Protocol

Prompt structure when the orchestrator calls security-auditor via Agent tool:

```
plan_paths:
  - <absolute path 1>
target_dir: <absolute path to project root under audit>
iteration: 1
previous_report_path: null  # path to previous report on re-audit
project_type_hint: <optional, orchestrator's estimated type>

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
- next_action: done | self_fix | user_interview
```

## 3. Loop Management

- **Termination A (success)**: CRITICAL·HIGH = 0 → terminate immediately. MEDIUM/LOW included in final report.
- **Termination B (limit reached)**: 3 iterations → report remaining issues to user and stop.
- Record iteration count in a `## Audit History` section at the bottom of the plan file each loop.

```markdown
## Audit History
- iter-1: 2026-04-22 / critical=0 high=2 medium=3 / next_action=self_fix
- iter-2: 2026-04-22 / critical=0 high=0 medium=2 / next_action=done
```

## 4. Follow-up by decision_type

| decision_type | Follow-up |
|---------------|-----------|
| `auto` | orchestrator fixes code and requests re-audit |
| `design` | user interview (AskUserQuestion) then design change |
| `business` | user interview (AskUserQuestion) then policy decision |

## 5. Notification Before Interview

When 1 or more `design` or `business` issues exist, always run this before AskUserQuestion:

```bash
MSG="Security audit: user decision required (N issues)"  # replace N with actual design+business count
if command -v terminal-notifier >/dev/null 2>&1; then
  terminal-notifier -title "Claude Code" -message "$MSG" -sound Glass
elif [ "$(uname)" = "Darwin" ]; then
  osascript -e "display notification \"$MSG\" with title \"Claude Code\" sound name \"Glass\"" \
    || osascript -e "display dialog \"$MSG\" with title \"Claude Code\" buttons {\"OK\"} default button \"OK\""
elif command -v notify-send >/dev/null 2>&1; then
  notify-send "Claude Code" "$MSG"
fi
```

## 6. Report Path Rules

```
<target_dir>/.cc-audits/<plan-slug>/iter-<n>.md
<target_dir>/.cc-audits/<plan-slug>/iter-<n>.json
```

`plan-slug` is the plan filename without extension. Example: `iridescent-swinging-wave`

## 7. HTML Report After Audit Completes

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
- ✅ DO: When security-auditor and code-reviewer are called in parallel, **the orchestrator runs this once after both agents complete**
- ❌ DON'T: Never auto-open on every iteration (disrupts the fix workflow)
