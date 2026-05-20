# Uninstall — Manual Removal

[← Back to README](../README.md)

> **Prefer the automatic uninstaller** — see the [Uninstall section in README](../README.md#uninstall). Use this manual procedure only when the automatic uninstaller is unavailable.

## 1. Remove the CLAUDE.md marker block

```bash
grep -n "cc-baseline" ~/.claude/CLAUDE.md
# Delete the <!-- BEGIN cc-baseline --> ... <!-- END cc-baseline --> block
```

## 2. Remove memory files

```bash
chmod 755 ~/.claude/memory/
rm ~/.claude/memory/all_session_basic_rules.md
rm ~/.claude/memory/doc_structure_rules.md
rm ~/.claude/memory/phase_start.md
rm ~/.claude/memory/phase_end.md
rm ~/.claude/memory/reference_e2e_manager_guide.md
rm ~/.claude/memory/reference_subagent_boundary.md
rm ~/.claude/memory/reference_doc_writing_style.md
rm ~/.claude/memory/feedback_skill_description_budget.md
rm ~/.claude/memory/reference_security_auditor_protocol.md
rm ~/.claude/memory/reference_code_reviewer_protocol.md
```

## 3. Remove agents, commands, and scripts

```bash
rm ~/.claude/agents/e2e-tester.md
rm ~/.claude/agents/security-auditor.md
rm ~/.claude/agents/code-reviewer.md
rm ~/.claude/commands/plan.md
rm ~/.claude/commands/clean.md
rm ~/.claude/commands/open-browser.md
rm ~/.claude/commands/check-log.md
rm ~/.claude/scripts/audit-report.js
```

## 4. Remove hooks from settings.json

Open `~/.claude/settings.json` and delete hooks with these `statusMessage` values:
- `"Loading session rules..."`
- `"Applying cc-baseline path policy..."`
- `"Loading E2E test guide..."`
- The SessionEnd entry containing `pgrep -f '@anthropic-ai/claude-code'`

## 5. Remove MCP servers (optional)

Delete `playwright-test-1` through `playwright-test-5` from `mcpServers` in `~/.claude.json`.
