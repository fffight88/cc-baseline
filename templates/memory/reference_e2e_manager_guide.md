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

## 4. Failure Handling Flow

1. Tester reports failure → manager analyzes cause
2. Manager instructs tester with one of: retry / skip step / abort entirely
3. On retry instruction, re-deliver same scenario or deliver modified scenario

---

## 5. Screenshot Policy

- Tester auto-captures in these cases:
  - On test failure
  - On unexpected error
  - When `screenshot_mode: always` is specified
- Manager explicitly requests with `screenshot_mode: on_request` when needed

---

## 6. File Cleanup After Tests

Immediately after commit, delete all Claude-generated files in the `.playwright-mcp/` folder.

- ✅ Delete `.png`, `.yml`, `.log` files in `.playwright-mcp/` immediately after commit
- ❌ Never commit with those files staged
- **Verify:** after commit, run `ls .playwright-mcp/` to confirm no leftover files

---

## 7. Result Aggregation and User Report

- Receive tester reports in English
- Manager summarizes and delivers to user in the user's language
- After all tests complete, always generate an HTML report → open immediately via web server (see section 8 below)

---

## 8. HTML Report Generation and Web Open

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
- [ ] Call tester after scenario writing is complete
- [ ] On parallel call, confirm no duplicate MCP server numbers
- [ ] After all tests complete, generate HTML report (`.playwright-mcp/report.html`)
- [ ] Launch web server and open report in browser
- [ ] Run `/clean` to stop server after user confirms
- [ ] Clean up `.playwright-mcp/` files before commit
