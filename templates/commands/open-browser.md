Open a Playwright-controlled browser for manual testing. The user can then interact with the browser directly, and use `/check-log` afterward to collect diagnostics.

## Steps

1. Parse the URL argument (required). If no URL is provided, ask the user for one.

2. Always use `playwright-test-1` for manual browser sessions (reserved for user-driven testing).

3. Navigate to the URL:
   - Use `mcp__playwright-test-1__browser_navigate` with the provided URL
   - Confirm the page loaded successfully

4. Save the session state so `/check-log` can reference the same MCP server:
   - Write `.claude/browser-session.json` with content: `{"mcp_server": "playwright-test-1", "url": "<url>", "opened_at": "<ISO timestamp>"}`
   - Create `.claude/` directory if it does not exist

5. Report to the user:
   - Confirm browser is open and ready
   - Remind them to run `/check-log [server-log-path]` after reproducing an issue
   - Default server log path assumed to be `server.log` if not specified at check-log time

## Notes

- `playwright-test-1` is reserved for `/open-browser` sessions — the manager must not assign this server to e2e-tester agents while a manual session may be active
- The browser session persists until the user closes it or `/clean` is run
- `/clean` deletes `.claude/browser-session.json`, effectively closing the session reference
