# cc-baseline

One-command installer that wires up a full Claude Code harness — behavior rules, custom skills, autonomous agents, and hooks — across any machine.

---

## Why cc-baseline?

Setting up Claude Code consistently across machines is tedious. cc-baseline solves this by bundling everything into a single `npx` command that merges cleanly into your existing `~/.claude/` config without overwriting anything you already have.

**What you get out of the box:**

- **11 behavior rules** loaded at session start — response language, uncertainty disclosure, parallel reads, minimal edits, and more
- **Security auditor agent** that runs real SAST/SCA/secret scans (semgrep, gitleaks, trivy) and produces structured JSON+Markdown reports with per-issue `decision_type` (auto / design / business) so you always know what to fix vs. what to discuss; detects **prompt injection patterns** in agent/command definition files (`claude-config` type); reports missing scanners as explicit **HIGH/MEDIUM `scanner-gap` issues** instead of silent skips
- **Code reviewer agent** that checks logic errors, edge cases, convention violations, and CLAUDE.md compliance independently from the security pass; performs **cross-file impact analysis** to catch breaking export changes across dependent files (JS/TS/Python/Go); **verifies `project-patterns.md` integrity** on every load via body hash — reports tampering as a `QA-PROFILE-TAMPER` issue
- **HTML report generator** (`audit-report.js`) that turns audit JSON into a color-coded, severity-sorted web page — opened automatically when a scan loop completes
- **Reliable notifications** via `terminal-notifier` (auto-installed on macOS) so you never miss an interview prompt for design/business decisions
- **E2E tester agent** backed by five parallel Playwright MCP servers — automatically collects browser console, network headers/payloads, and server log on failure; writes a structured `e2e-results/fail-{N}-{timestamp}.md` artifact; skips all log collection on pass
- **`/open-browser` skill** — opens a Playwright-controlled browser (`playwright-test-1`) for manual testing; saves session state so `/check-log` knows which MCP server to query
- **`/check-log` skill** — after you reproduce a bug in the open browser, one command collects console errors, network request/response details, and server log into `e2e-results/fail-manual-{timestamp}.md` at the same depth as an e2e-tester artifact
- **Safe merge strategy** — CLAUDE.md and MEMORY.md use marker-block merge; hooks use status-message deduplication. Your personal settings are never touched.
- **Auto-backup** before every install; one-command uninstall with `--purge` and `--remove-scanners` options

---

## Requirements

- **Node.js 18+**
- macOS or Linux (Windows native not supported — WSL works)
- Write access to `~/.claude/`

---

## Quick Start

```bash
npx github:fffight88/cc-baseline
```

Non-interactive (CI / re-install):

```bash
npx --yes github:fffight88/cc-baseline --yes
```

> `--yes` before the package name tells **npx** to skip its own "Ok to proceed?" prompt. `--yes` after the package name tells **cc-baseline** to auto-approve its prompts.

Preview changes before applying:

```bash
npx github:fffight88/cc-baseline --dry-run
```

---

## What Gets Installed

### Overview

| Component | Description |
|---|---|
| Behavior rules (`CLAUDE.md`, `memory/*.md`) | 11 session rules: response language, uncertainty, parallel reads, minimal edits, git safety, and more |
| Custom skills (`/plan`, `/clean`, `/open-browser`, `/check-log`) | Plan-mode entry; orphan-process + e2e artifact cleanup; Playwright browser for manual testing; fail diagnostics collector |
| E2E tester agent (`e2e-tester`) | Browser-based E2E test runner — PASS: no log collection; FAIL: console + network + server log → `e2e-results/fail-{N}-{timestamp}.md` |
| Security auditor agent (`security-auditor`) | SAST · SCA · secret scan · prompt injection detection; structured per-issue reports; missing-scanner gap issues (HIGH/MEDIUM) |
| Code reviewer agent (`code-reviewer`) | Logic errors · edge cases · CLAUDE.md violations · convention checks · cross-file impact analysis; profile integrity check; defers security to security-auditor |
| HTML report generator (`scripts/audit-report.js`) | Converts audit/review JSON into a severity-colored, decision-badged HTML page. Run with `node ~/.claude/scripts/audit-report.js <audit-dir>` |
| Hook config (`settings.json hooks`) | SessionStart memory load, PreToolUse E2E guide inject · path guard, SessionEnd process cleanup |
| MCP servers (`~/.claude.json`) | `playwright-test-1~5` global MCP server entries (`playwright-test-1` reserved for `/open-browser` manual sessions) |

### File Install Details

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

### JSON Merge Details

| Target | Method |
|---|---|
| `hooks` key in `~/.claude/settings.json` | Deduplicates by `statusMessage`; replaces only harness hooks, leaves user hooks intact |
| `mcpServers` key in `~/.claude.json` | Adds `playwright-test-1~5`; always silently overwrites existing entries with the same key (cc-baseline managed) |

> **Never touched:** `settings.json` fields like `env`, `model`, `effortLevel`; usage stats and UI state in `~/.claude.json`

---

## Auto-installed Tools

### Security Scanners

`semgrep`, `gitleaks`, and `trivy` are installed automatically:

- **macOS**: `brew install semgrep gitleaks trivy`
- **Linux/WSL**: installed to `~/.local/bin` (no sudo required)
  - `semgrep` → isolated venv at `~/.local/share/cc-baseline/semgrep-venv`, symlinked into `~/.local/bin` (PEP 668 bypass for Ubuntu 24.04+)
  - `gitleaks` → latest GitHub release binary, architecture auto-detected (x64/arm64)
  - `trivy` → latest GitHub release binary, SHA256 verified (x64/arm64)

> **PATH:** ensure `~/.local/bin` is in your `$PATH`. cc-baseline prints a warning if not. Add to your shell rc:
> ```bash
> export PATH="$HOME/.local/bin:$PATH"
> ```

Already installed? Skipped silently. If a scanner's auto-install fails, cc-baseline prints a manual command and proceeds — `security-auditor` falls back to manual code review when scanners are absent.

### terminal-notifier (macOS)

`terminal-notifier` is installed automatically on macOS via `brew install terminal-notifier`. It registers directly with Notification Center, making audit interview alerts more reliable than plain `osascript`. On Linux, `notify-send` is used as a fallback.

### Playwright MCP

`@playwright/mcp` is installed to `~/.npm-global`:

```bash
npm install -g @playwright/mcp --prefix ~/.npm-global
```

The five `playwright-test-*` MCP server entries in `~/.claude.json` point to the absolute binary path, so no PATH change is required for Claude Code itself.

> **Optional — add to PATH for terminal use:**
> ```bash
> export PATH="$HOME/.npm-global/bin:$PATH"
> ```

---

## Options

| Flag | Description |
|---|---|
| `--dry-run` | Print planned changes without writing any files |
| `--yes`, `-y` | Auto-approve all cc-baseline prompts. For fully non-interactive install, also pass `--yes` to npx itself: `npx --yes github:fffight88/cc-baseline --yes` |
| `--help`, `-h` | Show help |

---

## Hooks Installed

| Event | Matcher | Role |
|---|---|---|
| `SessionStart` | (none) | Injects `~/.claude/memory/MEMORY.md` and session rules into context |
| `PreToolUse` | `Write\|Edit` | Auto-approves writes to `/.cc-audits/`; blocks writes to `~/.claude/memory/` and redirects to the correct project memory path |
| `PreToolUse` | `mcp__playwright-test-.*` | Injects E2E manager guide into context on first Playwright MCP call per session |
| `SessionEnd` | (none) | Cleans up orphaned claude processes |

### Path Policy Hook Details

Applied in order on every Write/Edit attempt:

1. **Block (deny):** `~/.claude/memory/` is managed by cc-baseline only. If the model tries to write here directly, the hook blocks it and suggests `~/.claude/projects/…/memory/` instead.
2. **Auto-approve (allow):** Any path containing `/.cc-audits/` is approved automatically — this is where `security-auditor` and `code-reviewer` write their reports.

Both checks normalize paths via `os.path.realpath()` to prevent symlink or `../` traversal bypasses.

---

## Hook Conflict Warning Guide

The installer checks your existing `~/.claude/settings.json` hooks against four rules:

### `[WARN]` Existing SessionStart hook

cc-baseline also uses SessionStart to inject memory context. Conflicting instructions may produce unexpected behavior. **Action:** review and merge the two SessionStart hooks after installation.

### `[WARN]` PreToolUse matcher overlap

A broad matcher like `".*"` may double-fire with the Playwright E2E guide hook or block MCP calls. **Action:** narrow the matcher or exclude `mcp__playwright-test-.*`.

### `[HIGH]` Blocking hook detected

A hook returning `decision: block` or `decision: deny` may prevent cc-baseline from booting or MCP calls from completing. **Action:** remove or adjust the hook before installing.

### `[INFO]` Existing SessionEnd hook

Low conflict risk — both hooks run together. No action required.

---

## Editing memory/ Files After Install

`~/.claude/memory/` is protected by a `PreToolUse` hook that **denies Claude's `Write`/`Edit` tool** from modifying this path (so auto-memory writes go to `~/.claude/projects/...` instead). The directory itself uses normal permissions (755), so **you can edit files manually** with any editor.

> **Note:** Manual edits are overwritten on the next `cc-baseline` install. To customize, fork the repo and modify `templates/memory/`.

> **Migrating from older versions (≤ v1.0.x):** Earlier releases locked this directory with `chmod 555`. Re-running the installer automatically restores normal permissions.

---

## Backup & Recovery

### Backup Location

Modified files are snapshotted before every install:

```
~/.claude/.cc-baseline-backup/<ISO-timestamp>/
```

### Recovery

```bash
# Example: restore CLAUDE.md
cp ~/.claude/.cc-baseline-backup/<timestamp>/.claude/CLAUDE.md ~/.claude/CLAUDE.md
```

---

## Uninstall

### Automatic (recommended)

```bash
npx github:fffight88/cc-baseline --uninstall
```

```bash
# Preview only
npx github:fffight88/cc-baseline --uninstall --dry-run

# Non-interactive
npx github:fffight88/cc-baseline --uninstall --yes

# Remove everything including backups and scanners
npx github:fffight88/cc-baseline --uninstall --yes --purge --remove-scanners
```

A pre-uninstall snapshot is saved to `~/.claude/.cc-baseline-uninstall-backup/<timestamp>/`.

| Option | Effect |
|---|---|
| `--uninstall` | Removes harness files (preserves backups and external scanners) |
| `--dry-run` | Preview only |
| `--yes` | Non-interactive; does not touch external scanners |
| `--purge` | Also deletes `~/.claude/.cc-baseline-backup/` |
| `--remove-scanners` | Uninstalls semgrep/gitleaks/trivy + @playwright/mcp |

### Manual Removal

**1. Remove the CLAUDE.md marker block**

```bash
grep -n "cc-baseline" ~/.claude/CLAUDE.md
# Delete the <!-- BEGIN cc-baseline --> ... <!-- END cc-baseline --> block
```

**2. Remove memory files**

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

**3. Remove agents, commands, and scripts**

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

**4. Remove hooks from settings.json**

Open `~/.claude/settings.json` and delete hooks with these `statusMessage` values:
- `"Loading session rules..."`
- `"Applying cc-baseline path policy..."`
- `"Loading E2E test guide..."`
- The SessionEnd entry containing `pgrep -f '@anthropic-ai/claude-code'`

**5. Remove MCP servers (optional)**

Delete `playwright-test-1` through `playwright-test-5` from `mcpServers` in `~/.claude.json`.

---

## Updating Templates

```bash
cd /path/to/cc-baseline

# Edit files under templates/
# Use {{HOME}} as a placeholder for $HOME

# Scan for sensitive data before committing
grep -rE "$(whoami)|/Users/|/home/" templates/

git add templates/ && git commit -m "feat: update harness templates"
git push
```

---

## Manual Testing with Playwright

`/open-browser` and `/check-log` let you use the Playwright-controlled browser yourself, with Claude collecting diagnostics on demand.

### Workflow

> **`/check-log` requires `/open-browser` first.** It reads `.claude/browser-session.json` written by `/open-browser` to know which Playwright MCP server to query. Running `/check-log` without an active browser session will prompt you to run `/open-browser <url>` first.

```
1.  Start your dev server:  npm run dev 2>&1 | tee server.log
2.  /open-browser http://localhost:3000   →  browser opens (playwright-test-1)
3.  Reproduce the bug manually in the browser
4.  /check-log server.log                →  Claude reads console + network + server log
5.  e2e-results/fail-manual-{timestamp}.md  is written automatically
6.  Claude analyzes and offers to debug
7.  /clean                               →  deletes fail-*.md + browser session state
```

### Fail artifact content (on error)

| Section | Source |
|---|---|
| Console Errors | `browser_console_messages` |
| Network Requests | `browser_network_requests` (method · URL · status) |
| Failed Requests (4xx/5xx) | headers · request params · response body |
| Server Log — Errors & Warnings | `grep -E "ERROR\|WARN"` |
| Server Log — Last 200 Lines | `tail -n 200` |

> **No artifact is written if no errors are detected** — the skill reports "No issues detected" and stops.

### E2E agent fail artifacts

The `e2e-tester` agent follows the same policy automatically:
- **PASS** → no files written
- **FAIL** → writes `e2e-results/fail-{N}-{timestamp}.md` (N = MCP server number) and includes the path in the report

`playwright-test-1` is reserved for `/open-browser` manual sessions. The manager assigns `playwright-test-2` through `playwright-test-5` to e2e-tester agents for automated runs.

---

## Audit Report Storage

`security-auditor` and `code-reviewer` write reports to:

```
<project-root>/.cc-audits/<plan-slug>/iter-<n>.{md,json}
<project-root>/.cc-audits/<plan-slug>/code-review-iter-<n>.{md,json}
```

- Outside `~/.claude/` — no Claude Code path-protection prompts
- The PreToolUse hook auto-approves Write/Edit to any `/.cc-audits/` path
- When a scan loop finishes, generate an HTML report: `node ~/.claude/scripts/audit-report.js <audit-dir>`

**Recommended:** add `.cc-audits/` to your project's `.gitignore`.

---

## Security Policy: No `permissions` Key Distribution

cc-baseline never reads or writes the `permissions` key in `~/.claude/settings.json`:

- `permissions.allow` rules bypass Claude Code's user-consent prompts (e.g., `Bash(*)` silently allows all shell commands)
- Distributing permission rules as part of a baseline is a supply-chain risk
- Rules like `Edit(~/.claude/**)` would also bypass Claude Code's built-in `.claude/` path protection

**Principle:** permission rules must be added by each user for their own environment. The installer never creates or modifies them.

---

## Security & Privacy Notes

- `templates/` contains no usernames, passwords, API keys, or connection strings
- All paths in hook commands are stored as `{{HOME}}` and substituted at install time
- Install logs (`~/.claude/.cc-baseline-install.log`), backups, and audit reports (`.cc-audits/`) are listed in `.gitignore`
- Only `playwright-test-1~5` in `~/.claude.json` are read/written; all other keys are left untouched

---

## Tech Stack & Structure

- **Runtime:** Node.js 18+ (zero external dependencies — built-in modules only)
- **Distribution:** public GitHub repo → `npx github:fffight88/cc-baseline`

```
cc-baseline/
├── bin/cli.js              # CLI entry point (shebang + arg parsing)
├── src/
│   ├── install.js          # Install orchestration
│   ├── paths.js            # {{HOME}} ↔ $HOME substitution
│   ├── backup.js           # Timestamped backup
│   ├── prompt.js           # readline Y/n prompt
│   ├── conflict-checker.js # Hook conflict detection (4 rules)
│   └── merge/
│       ├── markdown.js        # Marker-block merge
│       ├── settings-hooks.js  # hooks statusMessage dedup merge
│       └── mcp-servers.js     # mcpServers key merge
└── templates/              # Bundle files ({{HOME}} placeholders)
    ├── CLAUDE.md
    ├── memory/             # MEMORY.md + 10 rule files
    ├── agents/             # e2e-tester.md, security-auditor.md, code-reviewer.md
    ├── commands/           # plan.md, clean.md, open-browser.md, check-log.md
    ├── scripts/            # audit-report.js
    ├── settings-hooks.json # hooks section only
    └── mcp-servers.json    # playwright-test-1~5 only
```

---

## Troubleshooting

### Windows

cc-baseline hooks and the `/clean` skill use bash, `pgrep`, and other Unix commands. **Windows native (cmd, PowerShell) is not supported.** Use WSL:

```bash
npx github:fffight88/cc-baseline
```

### Node version error

```
error: The engine "node" is incompatible with this module.
```

Upgrade to Node.js 18+. Check with `node --version`.

### Permission error

```
EACCES: permission denied, open '~/.claude/settings.json'
```

Fix ownership: `sudo chown -R $(whoami) ~/.claude/`

### Permission error on memory/ (WSL2/Linux)

```
EACCES: permission denied, open '~/.claude/memory/MEMORY.md'
```

Legacy `chmod 555` lock from an older install. The new installer auto-recovers, but if it fails manually:

```bash
chmod 755 ~/.claude/memory
chmod 644 ~/.claude/memory/*.md
npx github:fffight88/cc-baseline --yes
```

### Scanner install failed (Linux/WSL)

If `semgrep`, `gitleaks`, or `trivy` failed to install automatically, cc-baseline prints the manual command. Or run these yourself:

```bash
# semgrep (Ubuntu 24.04+)
sudo apt install -y python3-venv pipx
pipx install semgrep

# gitleaks — download latest linux binary from:
# https://github.com/gitleaks/gitleaks/releases/latest
# then: mv gitleaks ~/.local/bin/ && chmod 755 ~/.local/bin/gitleaks

# trivy — download latest linux binary from:
# https://github.com/aquasecurity/trivy/releases/latest
# then: tar -xzf trivy_*_Linux-64bit.tar.gz trivy && mv trivy ~/.local/bin/ && chmod 755 ~/.local/bin/trivy
```

Add `~/.local/bin` to PATH if not already:

```bash
export PATH="$HOME/.local/bin:$PATH"  # add to ~/.bashrc or ~/.zshrc
```

### JSON parse error

```
SyntaxError: Unexpected token ...
```

Your `settings.json` or `.claude.json` is malformed. Restore from backup or validate with a JSON linter.

### Stale npx cache

```bash
npx --yes github:fffight88/cc-baseline --yes
# or pin a specific commit/tag:
npx github:fffight88/cc-baseline#v1.0.0
```

### Playwright MCP not connecting ("Failed to reconnect")

**Check the binary exists:**

```bash
ls ~/.npm-global/bin/playwright-mcp
```

If missing, install manually:

```bash
npm install -g @playwright/mcp --prefix ~/.npm-global
```

**Check the command path in `.claude.json`:**

```bash
cat ~/.claude.json | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('mcpServers',{}).get('playwright-test-1',{}).get('command'))"
```

Should print `~/.npm-global/bin/playwright-mcp`. If it shows `npx`, re-run `npx --yes github:fffight88/cc-baseline --yes` to fix it automatically.

**Restart Claude Code** after confirming the path is correct.
