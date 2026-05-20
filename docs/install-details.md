# File Install Details

[← Back to README](../README.md)

## File-by-file install matrix

| File | Target path | Method |
|---|---|---|
| `CLAUDE.md` | `~/.claude/CLAUDE.md` | Marker-block merge — existing content preserved, only `<!-- BEGIN cc-baseline -->` block added/replaced |
| `memory/MEMORY.md` | `~/.claude/memory/MEMORY.md` | Marker-block merge |
| `memory/all_session_basic_rules.md` | `~/.claude/memory/` (same name) | Overwrite (backup taken first) |
| `memory/doc_structure_rules.md` | 〃 | Overwrite |
| `memory/phase_start.md` | 〃 | Overwrite |
| `memory/phase_end.md` | 〃 | Overwrite |
| `memory/reference_e2e_manager_guide.md` | 〃 | Overwrite |
| `memory/reference_subagent_boundary.md` | 〃 | Overwrite |
| `memory/reference_doc_writing_style.md` | 〃 | Overwrite |
| `memory/feedback_skill_description_budget.md` | 〃 | Overwrite |
| `memory/reference_security_auditor_protocol.md` | 〃 | Overwrite |
| `memory/reference_code_reviewer_protocol.md` | 〃 | Overwrite |
| `agents/e2e-tester.md` | `~/.claude/agents/e2e-tester.md` | Overwrite |
| `agents/security-auditor.md` | `~/.claude/agents/security-auditor.md` | Overwrite |
| `agents/code-reviewer.md` | `~/.claude/agents/code-reviewer.md` | Overwrite |
| `commands/plan.md` | `~/.claude/commands/plan.md` | Overwrite |
| `commands/clean.md` | `~/.claude/commands/clean.md` | Overwrite |
| `commands/open-browser.md` | `~/.claude/commands/open-browser.md` | Overwrite |
| `commands/check-log.md` | `~/.claude/commands/check-log.md` | Overwrite |
| `scripts/audit-report.js` | `~/.claude/scripts/audit-report.js` | Overwrite |

## JSON merge details

| Target | Method |
|---|---|
| `hooks` key in `~/.claude/settings.json` | Deduplicates by `statusMessage`; replaces only harness hooks, leaves user hooks intact |
| `mcpServers` key in `~/.claude.json` | Adds `playwright-test-1~5`; always silently overwrites existing entries with the same key (cc-baseline managed) |

> **Never touched:** `settings.json` fields like `env`, `model`, `effortLevel`; usage stats and UI state in `~/.claude.json`

## Project mode (`--project`)

When the installer is run with `--project`, every path in the table above shifts from `~/.claude/...` to `./.claude/...`, and three templates are swapped for project-specific variants:

| Template (global mode) | Template (project mode) | Notes |
|---|---|---|
| `templates/CLAUDE.md` | `templates/project-CLAUDE.md` | Relative paths, no `{{HOME}}` substitution |
| `templates/settings-hooks.json` | `templates/settings-hooks.project.json` | `_ccBaselineId` values prefixed with `project-` so they coexist with global IDs; SessionStart + PreToolUse path-policy hooks scoped to project memory |
| `templates/mcp-servers.json` | `templates/mcp-servers.project.json` | `npx -y @playwright/mcp@latest` (portable across machines) |

The 18 overwrite files (memory/, agents/, commands/, scripts/audit-report.js) are byte-identical between modes.

### JSON merge / write targets — project mode

| Target | Method |
|---|---|
| `./.claude/settings.json` hooks | Same hook merge logic as global; project IDs use `project-` prefix |
| `./.mcp.json` | Whole-file `{ mcpServers: {...} }` shape; preserves any non-harness `mcpServers` entries already present |

> **External binaries** (`semgrep`, `gitleaks`, `trivy`, `@playwright/mcp`, `terminal-notifier`) are installed in project mode as well — they're machine-global, and the agents won't run without them. Pass `--skip-scanners` to bypass.
