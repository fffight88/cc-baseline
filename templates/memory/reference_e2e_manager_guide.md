---
name: E2E Test Manager Guide
description: Reference for the manager (Claude orchestrator) when calling and operating e2e-tester sub-agents — MCP server management, scenario writing, parallel execution, result aggregation, file cleanup
type: reference
---

## Summary

The manager oversees the entire E2E test process. The manager is responsible for scenario design, sub-agent calls, result aggregation, and file cleanup. The tester agent (`e2e-tester`) only executes the given scenario and reports results.

---

## 1. MCP Servers

- Up to 5 available: `playwright-test-1` through `playwright-test-5`
- Assign 1:1 per sub-agent for parallel tests

---

## 2. Scenario Writing Principles

- The manager writes scenarios directly and delivers them to the tester
- The tester does not modify scenarios arbitrarily
- Delivery format:

```
mcp_server: playwright-test-{N}
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
- Assign a different `mcp_server` number to each instance

```
Agent(e2e-tester, { mcp_server: playwright-test-1, scenario: login })
Agent(e2e-tester, { mcp_server: playwright-test-2, scenario: checkout })
Agent(e2e-tester, { mcp_server: playwright-test-3, scenario: signup })
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

---

## 7. Fail Log File Naming and Cleanup

### File naming pattern
```
e2e-results/fail-{N}-{YYYYMMDD-HHmmss}.md
```
- `N`: MCP server number (1–5) — guarantees uniqueness in parallel runs
- Timestamp: prevents overwrite when the same server runs multiple times
- Example: `e2e-results/fail-3-20260519-143022.md`

### Log collection policy
- **PASS**: no log collection, no file written
- **FAIL or ERROR**: tester collects browser console + network requests (headers + request/response params) + server log → writes to the file above → includes `LOG_FILE` path in the report

### MCP server reservation
- `playwright-test-1` is reserved for `/open-browser` manual sessions
- Do not assign `playwright-test-1` to e2e-tester agents unless no manual session is active

### Cleanup
- Run `/clean` to delete all `e2e-results/fail-*.md` files and `.claude/browser-session.json`
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
- Inline screenshot on failure (base64 embed or relative path)
- Color coding: PASS → green, FAIL → red

### Web Server Execution
```bash
# Use Python built-in server (no extra install required)
cd .playwright-mcp && python3 -m http.server 7777
```
- Port: `7777` (fixed)
- After launch, open `http://localhost:7777/report.html` via Playwright MCP and show to user for confirmation

### Server Shutdown
- After user confirms, run `/clean` to stop the server

---

## Checklist

- [ ] Confirm number of active MCP servers before testing
- [ ] Do not assign `playwright-test-1` if a `/open-browser` manual session may be active
- [ ] Include `server_log` path in scenario delivery if server log is available
- [ ] Call tester after scenario writing is complete
- [ ] On parallel call, confirm no duplicate MCP server numbers
- [ ] After all tests complete, generate HTML report (`.playwright-mcp/report.html`)
- [ ] Include `LOG_FILE` paths from FAIL reports in the HTML report for traceability
- [ ] Launch web server and open report in browser
- [ ] Run `/clean` to stop server after user confirms (also deletes `e2e-results/fail-*.md`)
- [ ] Clean up `.playwright-mcp/` files before commit
