---
name: E2E Test Manager Guide
description: Reference for the manager (Claude orchestrator) when calling and operating e2e-tester sub-agents — browser assignment (Aside first, Playwright MCP fallback), scenario writing, parallel execution, result aggregation, file cleanup
type: reference
---

## Summary

The manager oversees the entire E2E test process. The manager is responsible for scenario design, sub-agent calls, result aggregation, and file cleanup. The tester agent (`e2e-tester`) only executes the given scenario and reports results.

---

## 0. MANDATORY Pre-pass — Runtime Invariants + Dead-Control Sweep (always, before AND after scenarios)

> **This is a required gate, separate from happy-path scenarios.** A scenario verifies "the flow ran end to end"; it does NOT verify "every element produced its correct effect / no screen broke". The defects that slip through every other gate (whitelabel/500 on click, unbound event handlers = ReferenceError, visual drift, raw/duplicated values) are caught **only** by mechanically triggering every interactive element and asserting the result. Run this sweep on **every screen**. Any single violation = that screen **FAILs**, independent of whether the scenario passed.

> **Who runs it:** the `e2e-tester` agent runs this sweep **automatically as a built-in protocol** (it is mechanical, not scenario design — see `e2e-tester.md`). The manager does **not** author sweep steps; the manager's job is to **require and read the `INVARIANTS` / `SWEEP` fields** in the tester's report and treat any `violated` / `FAIL: …` as a screen failure (do not mark PASS without them). Destructive controls (delete/logout/pay/…) are skipped by the sweep and reported as `skipped-destructive` — drive those explicitly via scenario steps if they must be tested.

### (A) Global runtime invariants — assert immediately after every navigation and every click

- **No whitelabel / error page**: no "Whitelabel Error Page" text on the page · URL did not fall through to `/error` · HTTP status is not 4xx/5xx.
- **Zero console errors** (level=error). In particular `ReferenceError` / `is not defined` is the **decisive signature of an unbound event handler** (the click does nothing / throws). Only known-harmless items (e.g. favicon 404) may go on an explicit allowlist — everything else fails.
- **No unhandled 4xx/5xx network responses** (XHR / fetch / navigation).

### (B) Dead-control sweep — enumerate every clickable element → activate one by one → assert an effect

- **Enumerate**: `button`, `a[href]` (excluding `#` and `javascript:void`), `[onclick]`, `[role=button]`, tab / popup triggers.
- After clicking each element, **one observable effect** must occur: navigation / new window or popup / network request / DOM change / dialog. **No effect at all OR a ReferenceError = dead/broken control → FAIL.**
- For controls that open a popup, **actually open it** and apply the (A) invariants to the popup too (this is how the popup's own whitelabel / console error gets caught — an unopened popup hides its defects).
- **Transient controls** (toast close buttons, snackbars, auto-closing modals) appear only after an action and vanish within seconds, so a load-time sweep misses them. The tester records controls added after load and clicks them right after each step (`e2e-tester.md` §0-B). As the manager, still add an **explicit scenario step** for any transient UI you know about (e.g. "while the toast is shown, click its close button") — a `transient-missed` entry in `SWEEP` means the control was never checked.

### (C) "PASS" is redefined

Screen e2e PASS = **(a)** the scenario completed with all explicit assertions **∧ (b)** the (A) invariants held across the entire run **∧ (c)** the (B) sweep was clean. **"The scenario ran to the end" alone is NOT a PASS.**

### (D) TC evidence principle

Convert each blocking TC item into an **executable assertion** (selector / action + expected value), run it, and leave the **actual value as evidence**. A markdown check (✓) alone must never be treated as passing — there must be an executed assert plus the real observed value.

---

## 1. Browser Assignment (Aside first, Playwright fallback)

Read `reference_browser_tools.md` first — it defines the tool choice and the switch conditions.

- **Aside (primary)**: each tester gets its own session name `aside_session: e2e-{N}` (one tab in the test account). Check once before a run: `~/.claude/scripts/aside-session.sh account` exits 0 → `browser: aside`; otherwise `browser: playwright` for every tester and tell the user why.
- **Playwright (fallback)**: each tester still gets a distinct `mcp_server: playwright-test-{N}`, N = 2–5 (1 is the headed server reserved for `/open-browser`). Use the same N as the Aside session so fail files (`fail-{N}-…`) never collide.
- Every tester report carries `BROWSER_TOOL` / `FALLBACK_REASON`. A tester that switched to Playwright mid-run is still valid — note it in the summary.

---

## 2. Scenario Writing Principles

- The manager writes scenarios directly and delivers them to the tester
- The tester does not modify scenarios arbitrarily
- Delivery format:

```
browser: aside | playwright
aside_session: e2e-{N}
mcp_server: playwright-test-{N}        # fallback, N = 2–5
project_dir: <absolute path to the project root>   # screenshots go to <project_dir>/e2e-results/
base_url: <target URL>
server_log: <path to server log file>   # e.g. server.log — omit if no server log
scenario:
  name: <scenario name>
  steps:
    - <step 1>
    - <step 2>
    ...
screenshot_mode: on_failure_only | always | on_request
```

---

## 3. How to Run in Parallel

- There is one agent definition file (`e2e-tester`); call N instances in parallel
- Call the Agent tool multiple times simultaneously in a single message for parallel processing
- Assign a different N to each instance (Aside session `e2e-{N}` + fallback `playwright-test-{N}`)

```
Agent(e2e-tester, { browser: aside, aside_session: e2e-2, mcp_server: playwright-test-2, scenario: login })
Agent(e2e-tester, { browser: aside, aside_session: e2e-3, mcp_server: playwright-test-3, scenario: checkout })
Agent(e2e-tester, { browser: aside, aside_session: e2e-4, mcp_server: playwright-test-4, scenario: signup })
```

---

## 4. No Mock Data Policy

- ❌ Under no circumstances use JS mocks (function overrides, fake return value injection) to conduct tests
- ❌ Mock-based tests only verify "code structure" — they are not E2E validation and must never be reported as PASS
- ✅ Must verify actual server API calls, actual DB/Redis state, and actual browser behavior
- ✅ Repeat modify-test-modify-test cycles until the intended behavior is actually verified

---

## 5. Unverifiable Scenario Handling Flow

Decision tree for situations where a scenario cannot actually be verified.

### 1-1. When test can proceed with code modification

e.g. masterSeq missing on page load prevents pending check → add URL parameter support then test

1. Modify **only the minimum code** needed to proceed with testing
2. Run test → confirm pass/fail
3. **Revert** the modified code
4. Note in the report: "tested after temporary code modification, reverted after completion"

### 1-2. When test is impossible even with code modification

e.g. external infrastructure not set up, test environment missing

1. Abort the scenario test
2. **Send notification to user** (notify-send / PushNotification)
3. Propose alternatives + proceed only after receiving user approval
4. No alternative (including mock) may be applied without user approval

### 1-3. When a specific user action is required to proceed

e.g. upload must be in a paused state to test resume, user must directly select a specific file

1. Hold only that scenario, continue other scenarios
2. **Send notification to user** + provide detailed instructions on required preparation
3. Resume the scenario only after user signals "ready"
4. No arbitrary progression (including mock) before ready signal

---

## 6. Screenshot Policy

- Tester auto-captures in these cases:
  - On test failure
  - On unexpected error
  - When `screenshot_mode: always` is specified
- Manager explicitly requests with `screenshot_mode: on_request` when needed
- Save path: always the absolute `<project_dir>/e2e-results/fail-{N}-{YYYYMMDD-HHmmss}-<slug>.png`. A bare filename is resolved against the MCP server's working directory and can land in the project root. After a run, the manager checks `ls <project_dir>/*.png` is empty

---

## 7. Fail Log File Naming and Cleanup

### File naming pattern
```
e2e-results/fail-{N}-{YYYYMMDD-HHmmss}.md
```
- `N`: the tester number (2–5, same as `e2e-{N}` / `playwright-test-{N}`) — guarantees uniqueness in parallel runs
- Timestamp: prevents overwrite when the same server runs multiple times
- Example: `e2e-results/fail-3-20260519-143022.md`

### Log collection policy
- **PASS**: no log collection, no file written
- **FAIL or ERROR**: tester collects browser console + network requests (headers + request/response params) + server log → writes to the file above → includes `LOG_FILE` path in the report

### Browser reservation
- `playwright-test-1` (headed) and the Aside session name `manual` are reserved for `/open-browser` — never assign them to testers or publisher
- Testers use N = 2–5 for both the Aside session (`e2e-{N}`) and the fallback MCP server

### Cleanup
- Run `/clean` to delete all `e2e-results/fail-*` files and `.claude/browser-session.json`, and to stop this project's Aside sessions
- Each tester stops its own Aside session; after a run, `~/.claude/scripts/aside-session.sh list` should show no `e2e-*` session
- ✅ Delete `.png`, `.yml`, `.log` files in `.playwright-mcp/` immediately after commit
- ❌ Never commit with those files staged
- **Verify:** after commit, run `ls .playwright-mcp/` to confirm no leftover files

---

## 8. Result Aggregation and User Report

- Receive tester reports in English
- Manager summarizes and delivers to user in the user's language
- After all tests complete, always generate an HTML report → open immediately via web server (see section 9 below)

---

## 9. HTML Report Generation and Web Open

When all tests are complete, create an HTML file with results and serve it via a local web server.

### Report File Location
- Save path: `.playwright-mcp/report.html`
- Do not commit (entire `.playwright-mcp/` is cleanup target)

### Required HTML Report Content
- Test execution date/time
- Overall result summary (PASS/FAIL count, elapsed time)
- Per-scenario result table (scenario name, result, failed step, cause)
- Per-screen §0 status column: `INVARIANTS` (held/violated) + `SWEEP` (clean N / dead-control) from the tester reports — so a green scenario with a §0 violation is visibly FAIL
- Inline screenshot on failure (base64 embed or relative path)
- Color coding: PASS → green, FAIL → red

### Web Server Execution
```bash
# Use Python built-in server (no extra install required)
cd .playwright-mcp && python3 -m http.server 7777
```
- Port: `7777` (fixed)
- After launch, open `http://localhost:7777/report.html` in the user's own browser (`open <url>` on macOS, `xdg-open <url>` on Linux) — an Aside REPL tab closes when its session ends and the Playwright testers are headless

### Server Shutdown
- After user confirms, run `/clean` to stop the server

---

## 10. File Download Test Pattern (avoid Playwright MCP hang)

`browser_click` on a download-triggering element **hangs** with @playwright/mcp
(>= 0.0.19, incl. 0.0.71): a download response (`Content-Disposition: attachment`)
is not a navigation, so the load/navigation event the click waits for never fires
(playwright-mcp #355 / #154). Never use `browser_click` to trigger a download.

### Positive download TC (verify wiring + status + headers + data)

Use `browser_run_code`. Its `code` is invoked as `async (page) => {...}` with `page`
injected as the argument. Capture the response (headers/status) and the download (file)
in a single `Promise.all` triggered by the real click — this proves the button→API
wiring AND avoids the hang:

```js
async (page) => {
  const [resp, download] = await Promise.all([
    page.waitForResponse(r => r.url().includes('/your/download/url')), // headers + status
    page.waitForEvent('download'),                                     // actual file
    page.locator('#yourDownloadBtn').click(),                          // wiring
  ]);
  return {
    status: resp.status(),
    content_type: resp.headers()['content-type'],
    content_disposition: resp.headers()['content-disposition'],
    suggested_filename: download.suggestedFilename(),
    saved_path: await download.path(),
  };
}
```

- The `run_code` sandbox is ESM: `require`/`fs` are NOT available. Do not read file
  bytes inside the block. Return `download.path()` (or use the auto-saved
  `.playwright-mcp/<filename>`) and parse the file outside the block via Bash/Read
  (e.g. unzip+parse an xlsx, count columns).
- Get HTTP headers from `resp` (the `Download` object does not expose response headers).

### Negative / permission TC (must NOT trigger a download)

Use `browser_evaluate` + `fetch` to hit the endpoint directly and assert rejection,
without invoking the browser download flow:

```js
async () => {
  const res = await fetch('/your/download/url', { credentials: 'same-origin' });
  return { status: res.status }; // expect 400/403
}
```

`credentials: 'same-origin'` rides the session cookie so admin endpoints return the
authenticated result (not a login redirect). Same-origin means all headers
(incl. `Content-Disposition`) are readable.

### Tool selection summary

| TC type | Tool | What it proves |
|---|---|---|
| Normal download (wiring + headers + data) | `browser_run_code` (waitForResponse + waitForEvent + click) | full server output + click wiring, no hang |
| Permission / negative (no download) | `browser_evaluate` + `fetch` | endpoint rejects (400/403) |
| ❌ Any download trigger | `browser_click` | forbidden — hangs |

---

## Checklist

- [ ] **(§0 mandatory pre-pass)** Ran the runtime-invariant + dead-control sweep on every screen — not just the happy-path scenario
- [ ] **(§0-A)** Each navigation/click asserted: no whitelabel/`/error`, no 4xx/5xx, zero console errors (ReferenceError = unbound handler = FAIL)
- [ ] **(§0-B)** Enumerated every clickable element and confirmed an observable effect for each (no-effect / ReferenceError = dead control = FAIL); popups actually opened and re-checked under (A)
- [ ] **(§0-B)** Transient UI (toasts, auto-closing modals) has an explicit scenario step; no `transient-missed` left in `SWEEP`
- [ ] `project_dir` passed to every tester; no screenshot in the project root after the run
- [ ] **(§0-C/D)** PASS granted only with executed asserts + actual-value evidence — never on a markdown ✓ alone
- [ ] Checked `aside-session.sh account` once and set `browser:` for every tester; reports carry `BROWSER_TOOL` / `FALLBACK_REASON`
- [ ] Distinct N (2–5) per tester for `aside_session: e2e-{N}` and fallback `mcp_server`; never `manual` / `playwright-test-1`
- [ ] No `e2e-*` Aside session left running after the run
- [ ] Include `server_log` path in scenario delivery if server log is available
- [ ] Call tester after scenario writing is complete
- [ ] On parallel call, confirm no duplicate tester numbers (N)
- [ ] After all tests complete, generate HTML report (`.playwright-mcp/report.html`)
- [ ] Include `LOG_FILE` paths from FAIL reports in the HTML report for traceability
- [ ] Launch web server and open report in browser
- [ ] Run `/clean` to stop server after user confirms (also deletes `e2e-results/fail-*`)
- [ ] Clean up `.playwright-mcp/` files before commit
- [ ] For download TCs: never use `browser_click` to trigger a download — use `browser_run_code` with `Promise.all(waitForResponse, waitForEvent('download'), click)`
- [ ] For negative/permission download TCs: use `browser_evaluate` + `fetch` with `credentials: 'same-origin'`
- [ ] Parse downloaded file bytes outside the `run_code` block (sandbox is ESM, no `require`/`fs`)
