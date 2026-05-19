Open a Playwright-controlled browser for manual testing. The user can then interact with the browser directly, and use `/check-log` afterward to collect diagnostics.

## Steps

1. Parse the URL argument (required). If no URL is provided, ask the user for one.
   - **Validate**: the URL must match `^https?://` and contain no whitespace, newline, or null byte. Reject otherwise and ask again.

2. Always use `playwright-test-1` for manual browser sessions (reserved for user-driven testing).

3. Navigate to the URL:
   - Use `mcp__playwright-test-1__browser_navigate` with the provided URL
   - Confirm the page loaded successfully

4. Save the session state so `/check-log` can reference the same MCP server:
   - Create `.claude/` directory if it does not exist
   - Build the JSON object **as an object first**, then write the serialized form via the Write tool — do not concatenate the URL into a JSON string literal (a `"` in the URL would break out of the value):
     ```js
     const payload = {
       mcp_server: "playwright-test-1",
       url: url,            // the validated URL from step 1
       opened_at: new Date().toISOString()
     };
     // Pass JSON.stringify(payload) (or your runtime's equivalent) to the Write tool
     ```
   - Target path: `.claude/browser-session.json`

5. Report to the user:
   - Confirm browser is open and ready
   - Remind them to run `/check-log [server-log-path]` after reproducing an issue
   - Default server log path assumed to be `server.log` if not specified at check-log time

## Notes

- `playwright-test-1` is intentionally hardcoded (not a variable) — it is the only server reserved for manual sessions; `check-log.md` reads the server number dynamically from `browser-session.json` to allow future changes without modifying both files
- The manager must not assign `playwright-test-1` to e2e-tester agents while a manual session may be active
- The browser session persists until the user closes it or `/clean` is run
- `/clean` deletes `.claude/browser-session.json`, effectively closing the session reference
