Open a browser tab the user drives by hand for manual testing, then use `/check-log` afterward to collect diagnostics. Aside is used first (a tab in the test account's window); Playwright MCP `playwright-test-1` (headed) is the fallback. See `~/.claude/memory/reference_browser_tools.md`.

## Steps

1. Parse the URL argument (required). If no URL is provided, ask the user for one.
   - **Validate**: the URL must match `^https?://[A-Za-z0-9._~:/?#@!*+,;=%&-]+$` — no quotes, `$`, backticks, backslashes, parentheses, brackets, braces, `<`, `>`, `|` or whitespace (it is placed inside a shell argument in step 2). Reject otherwise and ask again.

2. **Aside (primary)** — use it when `~/.claude/scripts/aside-session.sh account` exits 0:
   - `~/.claude/scripts/aside-session.sh stop manual` (ends a previous manual session, if any), then `~/.claude/scripts/aside-session.sh start manual`
   - Open the tab and arm the recorder in one step (URL inside single quotes):
     ```bash
     ~/.claude/scripts/aside-session.sh send manual "await openTab('<url>'); <recorder from reference_browser_tools.md §3.3> console.log(JSON.stringify({ url: page.url(), title: await page.title() }))"
     ```
   - If `start` or `send` exits 2, or `send` fails twice → stop the session and go to step 3 with `fallback_reason` from the guide's §2.
   - The session stays alive in the background; the tab stays open until `/clean` (or `aside-session.sh stop manual`).

3. **Playwright (fallback)** — `playwright-test-1` only (headed, reserved for manual sessions):
   - Use `mcp__playwright-test-1__browser_navigate` with the URL and confirm the page loaded.

4. Save the session state so `/check-log` reads the same browser:
   - Create `.claude/` directory if it does not exist
   - Build the JSON object **as an object first**, then write the serialized form via the Write tool — do not concatenate the URL into a JSON string literal (a `"` in the URL would break out of the value):
     ```js
     const payload = {
       browser: "aside",              // or "playwright"
       aside_session: "manual",       // aside only
       mcp_server: "playwright-test-1", // playwright only
       fallback_reason: "none",       // or the reason from reference_browser_tools.md §2
       url: url,                      // the validated URL from step 1
       opened_at: new Date().toISOString()
     };
     // Pass JSON.stringify(payload) (or your runtime's equivalent) to the Write tool
     ```
   - Target path: `.claude/browser-session.json`

5. Report to the user:
   - Which browser opened: **Aside** — "a tab in the Aside window of the test account" — or **Playwright** (and why)
   - They click and type in that window themselves
   - Run `/check-log [server-log-path]` right after reproducing an issue, **before navigating to another page** (Aside keeps its error recorder per page; after a navigation `/check-log` re-arms it and asks for one more reproduction)
   - Default server log path is `server.log` if not specified at check-log time

## Notes

- Aside runs only with the test account from `cc-baseline-browser.json` — never the user's personal profile.
- `playwright-test-1` is intentionally hardcoded for the fallback — it is the only headed server and is reserved for manual sessions. The manager must not assign it to e2e-tester or publisher.
- `/clean` stops the manual Aside session (its tab closes) and deletes `.claude/browser-session.json`.
