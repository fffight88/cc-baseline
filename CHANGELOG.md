# Changelog

All notable changes to cc-baseline are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [SemVer](https://semver.org/spec/v2.0.0.html).

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
