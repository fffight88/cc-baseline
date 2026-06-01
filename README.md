# cc-baseline

One-command installer that wires up a full Claude Code harness — behavior rules, custom skills, autonomous agents, and hooks — across any machine.

---

## Table of Contents

- [Why cc-baseline?](#why-cc-baseline)
- [Requirements](#requirements)
- [Quick Start](#quick-start)
- [Project-local Install](#project-local-install)
- [What Gets Installed](#what-gets-installed)
- [Auto-installed Tools](#auto-installed-tools)
- [Options](#options)
- [Hooks Installed](#hooks-installed)
- [Hook Conflict Warning Guide](#hook-conflict-warning-guide)
- [Editing memory/ Files After Install](#editing-memory-files-after-install)
- [Backup & Recovery](#backup--recovery)
- [Uninstall](#uninstall)
- [Updating Templates](#updating-templates)
- [Manual Testing with Playwright](#manual-testing-with-playwright)
- [Audit Report Storage](#audit-report-storage)
- [Security Policy: No `permissions` Key Distribution](#security-policy-no-permissions-key-distribution)
- [Security & Privacy Notes](#security--privacy-notes)
- [Tech Stack & Structure](#tech-stack--structure)
- [Troubleshooting](#troubleshooting)

---

## Why cc-baseline?

Setting up Claude Code consistently across machines is tedious. cc-baseline solves this by bundling everything into a single `npx` command that merges cleanly into your existing `~/.claude/` config without overwriting anything you already have.

**What you get out of the box:**

- **11 behavior rules** loaded at session start — response language, uncertainty disclosure, parallel reads, minimal edits, and more
- **Security auditor agent** that runs real SAST/SCA/secret scans (semgrep, gitleaks, trivy) and produces structured JSON+Markdown reports with per-issue `decision_type` (auto / design / business) so you always know what to fix vs. what to discuss; detects **prompt injection patterns** in agent/command definition files (`claude-config` type); reports missing scanners as explicit **HIGH/MEDIUM `scanner-gap` issues** instead of silent skips
- **Code reviewer agent** that checks logic errors, edge cases, convention violations, and CLAUDE.md compliance independently from the security pass; performs **cross-file impact analysis** to catch breaking export changes across dependent files (JS/TS/Python/Go); detects **async/Promise pattern errors** (missing `await`, unhandled rejections, `Promise.all` misuse); checks **test coverage gaps** (new exports with no corresponding test, changed signatures with stale tests); **verifies `project-patterns.md` integrity** on every load via body hash — reports tampering as a `QA-PROFILE-TAMPER` issue
- **Publisher agent** for structured/admin-style UI work — caches a **design-system profile** (`design-profile.md`: auto-detected stack, design tokens, component inventory) like code-reviewer caches its profile; analyzes spec assets (md/image/pdf/html), matches the **tone & manner** of reference screens, and authors markup + CSS + static components **reuse-first** (new classes only when no existing match, token/naming-compliant) covering all UI states with **a11y enforced**; self-verifies via render compare + **axe-core a11y runtime scan** over Playwright MCP. Scope stays in markup/CSS only — no data binding, API, state, or event logic. Auto-triggered by the `UI Impact` plan-meta field; hands off **functional** verification to the e2e-tester
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

## Project-local Install

By default cc-baseline installs into your global `~/.claude/`. Pass `--project` to install into the **current directory's `./.claude/` and `./.mcp.json`** instead. Use this when you want a shared harness inside a repo — anyone who clones it inherits the same behavior rules, agents, and skills without running cc-baseline themselves.

```bash
# Preview
npx github:fffight88/cc-baseline --project --dry-run

# Install into ./.claude/ + ./.mcp.json
npx github:fffight88/cc-baseline --project --yes

# Health check
npx github:fffight88/cc-baseline --project --doctor

# Uninstall (project only — global install is left alone)
npx github:fffight88/cc-baseline --project --uninstall --yes
```

### What's different from global mode

| | Global mode | Project mode (`--project`) |
|---|---|---|
| Target dir | `~/.claude/` | `./.claude/` |
| MCP config | `~/.claude.json` (merged) | `./.mcp.json` (project-local, auto-detected by Claude Code) |
| `CLAUDE.md` content | absolute paths with `{{HOME}}` | relative paths, no substitution |
| Hook `_ccBaselineId` | `session-start-load-rules`, etc. | `project-session-start-load-rules`, etc. (prefix so global + project IDs coexist) |
| Playwright MCP command | absolute path to `~/.npm-global/bin/playwright-mcp` | `npx -y @playwright/mcp@latest` (portable) |
| External binaries (semgrep/gitleaks/trivy/etc.) | installed if missing | **same** — they're machine-global anyway |

### Overlay vs. standalone

You can run **both** global and project installs at once. Claude Code merges global + project settings.json, and the `project-` prefix on project hook IDs ensures the two don't dedup each other. The project doctor reports this explicitly:

```
✅ Global cc-baseline (informational)
   installed (project hooks layer on top — overlay mode)
```

### Committing the project install

`./.claude/` and `./.mcp.json` are safe to commit. Common gitignore entries:

```
# typically committed (team-shared):
.claude/CLAUDE.md
.claude/memory/
.claude/agents/
.claude/commands/
.claude/scripts/
.claude/settings.json
.mcp.json

# typically ignored:
.claude/.cc-baseline-backup/
.claude/.cc-baseline-uninstall-backup/
.claude/.cc-baseline-install.log
.cc-audits/
```

> First-run trust prompt: Claude Code asks the user to approve the project's `.mcp.json` the first time it's detected. This is expected — accept the prompt to enable the five `playwright-test-*` servers.

### Security notes (project mode)

Because `./.claude/memory/` and `./.mcp.json` are committable and run on every team member's machine, treat them like any other executable artifact:

- **Review changes to `.claude/memory/MEMORY.md` and `.claude/memory/all_session_basic_rules.md`** in PRs. The project SessionStart hook validates that each file contains the expected cc-baseline signature (marker block on MEMORY.md, frontmatter `name:` line on the rules file) and caps each at 64 KB; if either check fails, context injection is skipped and a warning is surfaced instead.
- **`@playwright/mcp` is pinned** (currently `@0.0.75`) in `templates/mcp-servers.project.json` to avoid silent supply-chain pulls of `@latest`. To upgrade: `npm view @playwright/mcp version` → edit the template → re-run `--project --yes`. Review the diff and the package's changelog before bumping.
- **`CLAUDE_PROJECT_DIR` is not trusted blindly.** The project PreToolUse path-policy hook only honors it when `realpath(CLAUDE_PROJECT_DIR) == realpath(cwd)`; otherwise it falls back to `cwd` so a poisoned env var can't move the protected boundary off `./.claude/memory/`.

---

## What Gets Installed

### Overview

| Component | Description |
|---|---|
| Behavior rules (`CLAUDE.md`, `memory/*.md`) | 11 session rules: response language, uncertainty, parallel reads, minimal edits, git safety, and more |
| Custom skills (`/plan`, `/clean`, `/open-browser`, `/check-log`) | Plan-mode entry; orphan-process + e2e artifact cleanup; Playwright browser for manual testing; fail diagnostics collector |
| E2E tester agent (`e2e-tester`) | Browser-based E2E test runner — PASS: no log collection; FAIL: console + network + server log → `e2e-results/fail-{N}-{timestamp}.md` |
| Security auditor agent (`security-auditor`) | SAST · SCA · secret scan · prompt injection detection; structured per-issue reports; missing-scanner gap issues (HIGH/MEDIUM) |
| Code reviewer agent (`code-reviewer`) | Logic errors · edge cases · CLAUDE.md violations · convention checks · cross-file impact analysis · async/Promise errors · test coverage gaps; profile integrity check; defers security to security-auditor |
| Publisher agent (`publisher`) | UI publishing for admin-style projects — design-profile cache (stack/tokens/components) · spec-asset analysis (md/image/pdf/html) · tone-and-manner match · reuse-first markup + CSS + static components · all UI states + a11y · render compare + axe-core scan via Playwright MCP; markup/CSS only (no logic/binding); hands functional checks to e2e-tester |
| HTML report generator (`scripts/audit-report.js`) | Converts audit/review JSON into a severity-colored, decision-badged HTML page. Run with `node ~/.claude/scripts/audit-report.js <audit-dir>` |
| Hook config (`settings.json hooks`) | SessionStart memory load, PreToolUse E2E guide inject · path guard, SessionEnd process cleanup |
| MCP servers (`~/.claude.json`) | `playwright-test-1~5` global MCP server entries (`playwright-test-1` reserved for `/open-browser` manual sessions) |

### File Install Details

File-by-file mapping (templates → target paths, marker-block merge vs overwrite) and JSON merge behavior for `settings.json` hooks and `.claude.json` `mcpServers`.

**Full details → [docs/install-details.md](docs/install-details.md)**

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
| `--skip-scanners` | Skip auto-install of `semgrep`/`gitleaks`/`trivy` and Playwright MCP. Useful in CI or restricted-network environments |
| `--doctor` | Verify installed state (files, hooks, MCP servers, scanners, drift). Exits 0 if all checks pass, 1 otherwise |
| `--version`, `-v` | Print version |
| `--help`, `-h` | Show help |

### Verifying your install

```bash
npx github:fffight88/cc-baseline --doctor
```

Runs 9 checks: `~/.claude/` presence, manifest integrity, marker blocks, file drift, all 4 managed hooks, MCP servers, security scanners, Playwright MCP binary, notifier.

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

The installer checks your existing `~/.claude/settings.json` hooks against four rules and prints warnings for SessionStart overlap, broad PreToolUse matchers, blocking hooks, and existing SessionEnd entries.

**Full details → [docs/hook-conflicts.md](docs/hook-conflicts.md)**

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

If the automatic uninstaller is unavailable, see [docs/uninstall-manual.md](docs/uninstall-manual.md) for the step-by-step procedure (marker blocks, memory files, agents, commands, scripts, hooks, MCP servers).

---

## Updating Templates

To customize and republish: fork the repo, edit `templates/`, use `{{HOME}}` as the `$HOME` placeholder, and scan for sensitive data before committing.

**Full details → [docs/updating-templates.md](docs/updating-templates.md)**

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

`security-auditor`, `code-reviewer`, and `publisher` write reports to:

```
<project-root>/.cc-audits/<plan-slug>/iter-<n>.{md,json}
<project-root>/.cc-audits/<plan-slug>/code-review-iter-<n>.{md,json}
<project-root>/.cc-audits/<plan-slug>/publish-iter-<n>.{md,json}
<project-root>/.cc-audits/design-profile.md   # shared design-system profile (publisher)
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
    ├── memory/             # MEMORY.md + 12 rule files
    ├── agents/             # e2e-tester.md, security-auditor.md, code-reviewer.md, publisher.md
    ├── commands/           # plan.md, clean.md, open-browser.md, check-log.md
    ├── scripts/            # audit-report.js
    ├── settings-hooks.json # hooks section only
    └── mcp-servers.json    # playwright-test-1~5 only
```

---

## Troubleshooting

Common issues — Windows/WSL, Node version, permissions on `~/.claude/`, scanner install failures, JSON parse errors, stale npx cache, Playwright MCP connectivity — are documented separately.

**Full details → [docs/troubleshooting.md](docs/troubleshooting.md)**
