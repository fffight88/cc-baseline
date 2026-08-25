# Changelog

All notable changes to cc-baseline are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `templates/memory/reference_design_md_index.md` — a catalog of the 68 ready-made brand `DESIGN.md` files published at getdesign.md (indexed by [VoltAgent/awesome-claude-design](https://github.com/VoltAgent/awesome-claude-design), MIT), for picking a **greenfield** project's design direction. Each entry carries slug, brand, a one-line character description, and a **Lane** column (`product-ui` / `marketing-web`) — 42 of the 68 are usable for dense product UI; the rest assume large imagery and sparse pacing and are marked marketing-only, because those systems fall apart under a data table. The catalog is a pointer list: cc-baseline vendors none of the files, they are fetched at decision time and their concrete token values copied into the design profile so it stands alone after the URL rots. Includes an explicit trademark / trade-dress section — these are live companies' visual systems, so the system (scale, density, type voice) is fair to learn from while wordmarks, logos, and licensed typeface binaries are not.

## [1.5.0] — 2026-08-03

### Added
- `--dedupe-legacy` install flag + a `Duplicate pre-marker content` doctor check. Installs predating the `<!-- BEGIN cc-baseline -->` marker had no block to replace, so `mergeMarkerBlock` appended one — stranding a pre-cc-baseline copy of the same instructions above the markers. That copy never updates again, so `CLAUDE.md` / `MEMORY.md` state every rule twice, once stale and once current, on every session load. `stripDuplicatePreamble()` removes a preamble section only when its `# ` heading is byte-identical to a heading inside the block being installed (fenced code regions excluded); sections under any other heading are preserved. Removal is opt-in via the flag and the affected files are backed up first; doctor reports the condition either way.

### Fixed
- `mergeHooks` left duplicate copies of a managed hook behind. It replaced the **first** entry matching a `_ccBaselineId` and stopped, so hooks accumulated by pre-tagging installs were never collapsed — one observed install had the `session-end-orphan-cleanup` hook 23 times, all firing on every session end, while doctor still reported it as correctly registered. Merge now collapses every remaining copy of an ID after replacing the first, prunes entries emptied by the sweep, and unrelated user hooks in the same event are untouched.
- `LEGACY_STATUS_MESSAGE_TO_ID` only listed the post-i18n English `statusMessage` values, but that field doubles as the matching key against already-installed hooks. Hooks installed before `fad22c6` (2026-04-30) carried the Korean strings, so `harnessIdOf` read them as foreign and every subsequent install appended a duplicate instead of replacing. The three pre-i18n Korean values are now mapped, with a comment recording that any shipped `statusMessage` must stay listed.
- `--doctor` reported `Hooks` as fully OK whenever the expected IDs were merely present. It now counts occurrences and warns when a managed hook is registered more than once.
- `templates/commands/clean.md` — the stale playwright-mcp cleanup now works on macOS, not just Linux. Two portability bugs fixed: (1) `ps -eo pid,etimes` used the Linux-only `etimes` keyword, so on macOS the pipeline produced nothing and the age-based kill silently did nothing — replaced with the portable `etime` keyword plus an awk conversion of its `[[dd-]hh:]mm:ss` format to seconds; (2) the protected-PID collection loop relied on word splitting of an unquoted variable (`for _x in $_q`), which zsh (macOS default shell) does not perform — the multi-line pgrep output was treated as one word and the loop never terminated. The list is now expanded via command substitution (`for _x in $(echo "$_q")`, newline→space normalized), which both bash and zsh split. Verified by dry run under both zsh and bash on macOS.

## [1.4.0] — 2026-06-25

### Added
- QA gate hardening for the runtime/visual defect class (whitelabel/500-on-click, unbound event handlers = `ReferenceError`, visual baseline drift, raw/duplicated values) that was passing all four agents and only getting caught in the final human pass. Three reference templates updated:
  - `templates/memory/reference_e2e_manager_guide.md` — new **§0 MANDATORY Pre-pass: Runtime Invariants + Dead-Control Sweep**, required on every screen separate from happy-path scenarios. (A) global runtime invariants asserted after every nav/click (no whitelabel/`/error`, no 4xx/5xx, zero console errors — `ReferenceError` = unbound-handler signature); (B) dead-control sweep enumerating every clickable element and asserting an observable effect (no-effect / ReferenceError = FAIL; popups actually opened and re-checked); (C) "PASS" redefined to require invariants-held + sweep-clean, not just "scenario ran to the end"; (D) TC evidence principle (executed assert + actual value, never a bare ✓).
  - `templates/memory/reference_publisher_protocol.md` — new **§9 Visual Verification Thoroughness & Runtime Invariants**: render-compare must cover thead **and** tbody and all key states (empty form + populated edit form + popups), assert each visual contract as PASS/FAIL + measured computed value, and assert the §0 runtime invariants on every rendered screen.
  - `templates/memory/reference_agent_pipeline.md` — new **§3.1 Gate Responsibility Boundary** + two de-dup matrix rows: runtime invariants / dead-control sweep / visual thoroughness are owned **only** by e2e-tester (§0) + publisher (§9); source-based security-auditor / code-reviewer structurally cannot detect this class and must not be assumed to cover it.
  - `templates/agents/e2e-tester.md` — the §0 sweep is now a **built-in fixed protocol** the tester runs automatically on every screen (not manager-authored steps): runtime-invariant assertions + a `browser_run_code` dead-control enumeration that clicks each control and asserts an observable effect, with a safety bound that skips destructive controls (delete/logout/pay/…) and reports them as `skipped-destructive`. Report format gained `INVARIANTS` / `SWEEP` fields so a green scenario with a §0 violation surfaces as FAIL.
  - `templates/agents/publisher.md` — Step 6 render-compare made **exhaustive** (thead **and** tbody, all key states: empty + populated + popups, each visual contract asserted as PASS/FAIL + measured computed value) and gained a **runtime-invariant** sub-step (no whitelabel / no console error on every rendered screen).
  - Reconciled the previously-absolute "no modification to e2e-tester.md" wording in `reference_publisher_protocol.md` §6: e2e-tester now carries the §0 sweep as a general built-in capability, while publishing-specific functional scenarios still need no per-publish change.

## [1.3.1] — 2026-06-15

### Added
- README / README_KO — "Pinning a version" section in Quick Start. Documents that unpinned `npx github:` installs from `main` (released only), and how to pin a release (`#v1.3.0`) or track the in-development integration branch (`#develop`). Reflects the develop+main release-branch model adopted in v1.3.0. Tracked in Jira CB-12.

- `test/run.js` — new test asserting `README.md` and `README_KO.md` keep an identical section-header structure (same heading levels in the same order, fenced code blocks ignored). Drift now fails `npm test`, so it cannot survive to a release. (53 tests total.)

### Fixed
- `templates/commands/clean.md` — the stale playwright-mcp cleanup now protects the current session's own MCP children. It walks up from the invoking shell (`$$`) to the highest `claude` ancestor, collects that subtree's descendant PIDs, and excludes them from the age-based (`etimes > 21600` = 6h) kill — so running `/clean` in a long-lived session (>6h) no longer disconnects that session's own playwright. Stale MCPs from other/forgotten sessions are still reaped; the 6h threshold is unchanged.
- README_KO — restored sync with README: added the missing Options rows (`--skip-scanners`, `--doctor`, `--version`) and the `설치 확인` (Verifying your install) subsection. Both READMEs now have identical section structure (39 headers).

## [1.3.0] — 2026-06-01

### Added
- `templates/agents/security-auditor.md` — **Supply Chain Hardening Detection** block added to Step 3 (runs for any project type when CI workflow files or dependency manifests exist). Four preventive structural checks motivated by recent supply-chain incidents (compromised npm/PyPI packages, mutable GitHub Action tags, poisoned Docker images): ① GitHub Actions third-party `uses:` not pinned to a 40-char commit SHA (HIGH/`auto`); ② workflow missing a top-level least-privilege `permissions:` block (MEDIUM/`auto`); ③ floating dependency ranges (`^`/`~`/`*`/`latest`) / mutable Docker tags / missing lockfile (MEDIUM/`auto`); ④ unexpected npm `pre/post-install` scripts in `package.json` (HIGH/`design`). New issue category `supply-chain`. Structural checks only — known-CVE/version matching is left to SCA scanners (`npm audit` / `pip-audit` / `trivy`), so no CVE numbers are hardcoded into the agent. Tracked in Jira CB-11.
- `templates/agents/publisher.md` — UI publishing agent for structured/admin-style projects. Caches a design-system profile (`.cc-audits/design-profile.md`: auto-detected stack, design tokens, component inventory) the same way code-reviewer caches `project-patterns.md`; analyzes spec assets (md/image/pdf/html) into a required-pattern list; selects reference screens (user-specified first, else auto) for tone-and-manner analysis; applies reuse-first (creates a new class only when no existing match, token/naming-compliant); authors markup + CSS + static components covering all UI states with a11y enforced; and self-verifies via render compare + axe-core a11y runtime scan through Playwright MCP against a running `base_url`. Scope is deliberately limited to markup/CSS/static components — no data binding, API, state, or event logic. Responsive / i18n / dark-mode are gated behind `quality_flags`. Tracked in Jira CB-10.
- `templates/memory/reference_publisher_protocol.md` — publisher auto-trigger conditions (`UI Impact` plan-meta field / explicit request / UI-natured task), call protocol, self-fix loop, decision_type follow-up, and the post-publish handoff to e2e-tester. Division of responsibility: publisher owns visual tone & manner + runtime a11y; **e2e-tester (unmodified) owns functional interaction**, driven by scenarios the orchestrator authors — keeping e2e-tester a pure functional executor with no overlap.
- `UI Impact: Yes | No | Unknown` field added to the plan `## Meta` block (`doc_structure_rules.md`, `commands/plan.md`) so publishing work auto-triggers consistently with `Security Impact` / `Code Quality Impact`. (`commands/plan.md` also gained the previously-missing `Code Quality Impact` line to match the canonical meta block.)
- Publisher **orchestrator briefing** — enriched the publisher Input Contract with `screen_brief` (scoped screen + target_file + registration + elements + required_states + out_of_scope), `data_shape` (read-only column/field shape for correct static markup, not binding), `reuse_anchors` (known components to prefer), `reference_notes` (what to mirror vs. skip from a reference screen), and `auth_note` (how to reach an auth-gated screen for visual verification — without it, visual verify hits the login wall and now records `visual_status: skipped` / reason `auth required`). Process steps 1/2/3/6 consume these fields; `reference_publisher_protocol.md` §2 gains a **pre-call briefing checklist** plus an updated prompt template. Fields are recommended, not required (publisher falls back to deriving them). Tracked in Jira CB-10.
- `templates/memory/reference_agent_pipeline.md` — central orchestration-order doc that defines where publisher slots into the existing flow. Canonical four-agent sequence: **publisher (build, during execution) → security-auditor + code-reviewer (review, parallel) → e2e-tester (functional verify)**. Includes a de-duplication matrix (publisher owns design-tokens/UI-states/tone & manner/runtime-a11y; the audit gates still review publisher-authored markup/CSS for CLAUDE.md/conventions/XSS/secrets but do not re-do a11y or token checks; e2e-tester does functional interaction only) and the report-artifact layout. Linked from `reference_publisher_protocol.md` §1 and `doc_structure_rules.md`. Tracked in Jira CB-10.
- `templates/memory/reference_e2e_manager_guide.md` §10 — File Download Test Pattern. Documents the `browser_click`-on-download hang in @playwright/mcp (>= 0.0.19, incl. 0.0.71; refs playwright-mcp #355 / #154), and the verified workaround: `browser_run_code` with `Promise.all(waitForResponse, waitForEvent('download'), click)`. Also covers the ESM sandbox caveat (no `require`/`fs` — parse file bytes outside the block) and a negative/permission TC pattern via `browser_evaluate` + `fetch` with `credentials: 'same-origin'`. Tracked in Jira CB-9.

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
