Collect browser diagnostics and server log after a user-reported failure in a manually opened Playwright browser. Produces a fail report file equivalent in depth to what the e2e-tester agent generates.

## Usage

`/check-log [server-log-path]`

- `server-log-path`: path to the server log file (default: `server.log`)

## Steps

1. **Read session state**
   - Read `.claude/browser-session.json` to get the MCP server number
   - If file does not exist → tell the user to run `/open-browser <url>` first and stop

2. **Collect browser diagnostics** from the MCP server recorded in the session file:
   - `browser_console_messages` — all console output (log, warn, error)
   - `browser_network_requests` — all network requests including method, URL, status code, request headers, request body, response headers, response body

3. **Read server log**
   - Read the last 200 lines of the server log file (`tail -n 200 <server-log-path>`)
   - Also grep for ERROR and WARN: `grep -E "ERROR|WARN|error|warn" <server-log-path> | tail -n 50`

4. **Evaluate severity**
   - If there are NO console errors AND NO server errors AND the user did not explicitly say something failed → report "No issues detected" and stop (do not write a file)
   - Otherwise → proceed to write the fail report

5. **Write fail report**
   - Path: `e2e-results/fail-manual-{timestamp}.md` (timestamp format: YYYYMMDD-HHmmss)
   - Create `e2e-results/` directory if it does not exist
   - Content structure:

```
# Fail Report — Manual Session
Date: <ISO datetime>
URL: <url from session file>
Server Log: <server-log-path>

## Console Errors
<filtered console errors and warnings>

## Network Requests
<all requests: method + URL + status>

### Failed Requests (4xx / 5xx)
<for each failed request: headers + request params + response body>

## Server Log — Errors & Warnings
<grep output>

## Server Log — Last 200 Lines
<tail output>
```

6. **Report to user**
   - State the file path written
   - Summarize the top issues found (2–3 lines max)
   - Ask if they want Claude to start debugging

## Notes

- `/clean` deletes `e2e-results/fail-*.md` and `.claude/browser-session.json`
- This skill does not close the browser — the user can keep testing and run `/check-log` multiple times
- Each run writes a new timestamped file; previous files are not overwritten
