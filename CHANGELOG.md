# Changelog

All notable changes to cc-baseline are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [SemVer](https://semver.org/spec/v2.0.0.html).

## [1.2.0] — 2026-05-20

### Added
- `--project` flag — installs cc-baseline into the current project's `./.claude/` and `./.mcp.json` instead of the global `~/.claude/` home. Lets teams check the harness into a repo so anyone who clones it inherits the same behavior rules, agents, and skills automatically.
- Three new project-mode templates:
  - `templates/project-CLAUDE.md` — relative paths, no `{{HOME}}` substitution.
  - `templates/settings-hooks.project.json` — SessionStart + PreToolUse hooks scoped to the project, with `_ccBaselineId` values prefixed `project-` so they coexist with global IDs (Claude Code merges global + project settings.json at runtime). Hooks resolve the project root via `$CLAUDE_PROJECT_DIR` with `os.getcwd()` fallback, and use `os.path.realpath()` to defeat symlink/traversal bypasses.
  - `templates/mcp-servers.project.json` — uses `npx -y @playwright/mcp@latest` for portability across machines (no absolute paths).
- `--project --doctor` — 8 checks specific to project installs: `./.claude/` exists, manifest integrity, project CLAUDE.md marker block, project MEMORY.md marker block, 18 overwrite files, project hook IDs, `./.mcp.json` MCP servers, and an informational check that reports whether the global cc-baseline is also installed (overlay vs. standalone).
- `--project --uninstall` — removes the project install while leaving the global install untouched. `.mcp.json` cleanup preserves any non-harness `mcpServers` entries the team added.
- README split — Troubleshooting, Hook Conflict Warning Guide, Uninstall Manual Removal, Updating Templates, and File Install Details are now in `docs/` (English) and `docs/ko/` (Korean), shortening the main READMEs from ~570 lines to ~375 and improving discoverability.
- `docs/plans/v1.2-plan.md` — design plan for this release (Meta block, interview decisions, execution order, checklist).
- 11 new tests (50 total) covering `resolveTarget()`, project template structure, install round-trip, hook ID prefixing, `.mcp.json` shape, and the 8-check project doctor.

### Changed
- `src/install.js` / `src/uninstall.js` / `src/doctor.js` — module-level `CLAUDE_DIR` / `BACKUP_ROOT` / `LOG_FILE` constants replaced by a single `resolveTarget(opts)` helper in `src/paths.js`. Global mode is unchanged; project mode is the new branch.
- `src/backup.js` — `createBackup()` gains an optional `basePath` argument (defaults to `$HOME`) so project-mode backups land at sensible relative paths inside the backup dir.
- External tools (semgrep / gitleaks / trivy / `@playwright/mcp` / terminal-notifier) are still installed in project mode (skip if already present) — they're machine-global anyway, and the agents wouldn't run without them.

### Security
- Project SessionStart hook now validates `MEMORY.md` (cc-baseline marker block) and `all_session_basic_rules.md` (`Core Rules for Every Session` signature) before injecting them into context, and caps each file at 64 KB. If validation fails the hook surfaces a warning and skips injection (no silent context pollution).
- Project PreToolUse path-policy hook now only trusts `CLAUDE_PROJECT_DIR` when `realpath(env) == realpath(cwd)`, defeating env-var poisoning that could move the protected `./.claude/memory/` boundary.
- `mcp-servers.project.json` pins `@playwright/mcp@0.0.75` instead of `@latest` so cloning the repo doesn't silently pull a future `@latest` release; README documents the upgrade procedure.
- `src/uninstall.js` mcpServers cleanup now uses `shortPath()` for the label (correctly shows `.mcp.json` vs `.claude.json` per mode) and matches install.js's trailing-newline convention so re-installs after a partial uninstall stay idempotent.

### Notes
- Project install and global install can coexist; their hooks layer on top of each other (overlay mode). The project doctor reports this explicitly.
- `.mcp.json` is auto-detected by Claude Code at project root and prompts the user for trust on first run — expected behavior, not a bug.

## [1.1.0] — 2026-05-20

### Added
- `templates/manifest.json` — single source of truth for every installable file. `install.js` and `uninstall.js` derive their file lists from it, eliminating 3-way drift between three previously-hardcoded arrays.
- `src/manifest.js` — loader for the manifest.
- `_ccBaselineId` field on each managed hook in `templates/settings-hooks.json` — dedup now keys on a stable ID instead of fragile `statusMessage` string match. Legacy installs are still recognized via `statusMessage` and SessionEnd command-prefix fallbacks, so old hooks are upgraded in place on re-install.
- Content-hash idempotency: unchanged files are skipped from both backup and write. Repeat installs are now true no-ops.
- `test/run.js` — 37+ unit tests (Node built-in `assert`, zero external dependencies). Covers marker-block merge, hook ID dedup + legacy migration, mcp-servers merge, manifest integrity, conflict-checker, and the recently-added-file regression that motivated this release (`f63e378`).
- `--doctor` flag — verifies installed state across 9 checks: `~/.claude/` presence, manifest integrity, marker blocks, file drift, all 4 managed hooks, MCP servers, scanners, Playwright MCP binary, notifier. Exit code 1 if any check fails.
- `--skip-scanners` flag — bypasses the auto-install of `semgrep` / `gitleaks` / `trivy` and Playwright MCP. Useful in CI or restricted-network environments.
- `--version` / `-v` flag.
- GitHub Actions CI (`.github/workflows/ci.yml`) — runs `npm test` and a full lifecycle smoke test (dry-run, install, idempotency re-install, doctor, uninstall) on `ubuntu-latest` × `macos-latest` × Node 18 / 20.

### Changed
- `src/install.js` shrunk from 524 → ~240 lines. Scanner / notifier / Playwright-MCP installers extracted to `src/installers/`.
- `src/conflict-checker.js` now imports `isHarnessHook` from `src/merge/settings-hooks.js`, recognizing all 4 managed hooks (previously missed the path-policy and orphan-cleanup hooks, producing spurious INFO warnings on re-install).
- Backup directory is no longer created when there is nothing to write.

### Fixed
- `--uninstall` now removes 5 files that previously leaked: `memory/reference_code_reviewer_protocol.md`, `agents/code-reviewer.md`, `commands/check-log.md`, `commands/open-browser.md`, `scripts/audit-report.js`. These were added to `install.js` over time but never to the uninstall hardcoded list.

## [1.0.0]

Initial public release. See `git log` for pre-1.1.0 history.
