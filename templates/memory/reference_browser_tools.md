---
name: Browser Tools — Aside primary, Playwright fallback
description: Which browser tool the harness uses (Aside first, Playwright MCP as fallback), when to switch, how to drive Aside with `aside repl`, and what every report must record
type: reference
---

## ⚡ Key Rules Summary

| ✅ DO | ❌ DON'T |
|---|---|
| Use **Aside** first for every browser task: e2e-tester, publisher Step 6, `/open-browser`, `/check-log` | Remove or skip the Playwright MCP path — it is the fallback |
| Drive Aside only through the CLI: `aside repl --account <test account>` or `~/.claude/scripts/aside-session.sh` | Use `aside exec` (Aside's own agent) or `aside mcp` for tests |
| Always pass the **test account** from `cc-baseline-browser.json` | Run without `--account`, or use the user's personal profile/account |
| Switch to Playwright on the conditions in §2 and write `browser_tool` + `fallback_reason` | Switch silently, or report a Playwright run as an Aside PASS |
| Inject the `__e2e` recorder after every navigation (§3.3) | Rely on `page.on('console' / 'pageerror' / 'response')` — Aside does not deliver these events |
| Save screenshots in the Aside session dir, then `cp` them to `<project_dir>/e2e-results/` | Pass a project path to `page.screenshot` — Aside rejects paths outside its session dir |

---

## 1. Pick the tool

1. Read the config: `<project root>/.claude/cc-baseline-browser.json`, else `~/.claude/cc-baseline-browser.json`.
   ```json
   { "primary": "aside", "fallback": "playwright", "aside": { "account": "u2" } }
   ```
2. `primary` is `aside` **and** `~/.local/bin/aside` exists **and** `aside.account` is set → use Aside.
3. Otherwise use Playwright MCP (`mcp__playwright-test-{N}__*`) and record why (§2).

`~/.claude/scripts/aside-session.sh account` prints the test account, or exits 2 when Aside is not usable.

---

## 2. Switch to Playwright when

| Condition | `fallback_reason` |
|---|---|
| CLI missing, or `primary` is not `aside` | `aside-not-installed` / `config-primary-playwright` |
| No test account in the config, or the account is not in `aside account list` | `no-test-account` |
| `aside-session.sh start` exits 2, or `aside repl` cannot reach the browser | `aside-unavailable` |
| The same step fails twice in a row with an Aside error or the 120 s timeout | `aside-step-error: <one line>` |
| The task needs something Aside cannot do (§5) | `aside-unsupported: <capability>` |

- Switch once, at the point of failure, and finish the task on Playwright. Do not flip back and forth.
- A **test** failure (assertion, console error in the app, dead control) is not a reason to switch. Only tool failures are.

### Report fields (every browser report)

```
BROWSER_TOOL: aside | playwright
FALLBACK_REASON: <reason from the table, or none>
```

---

## 3. Driving Aside

### 3.1 One-shot vs. session

- `aside repl --account <acct> "<js>"` is a **fresh session per call**: variables and the tabs it opened are gone when it returns. Use it for a self-contained check (open → act → read → print in one call, under 120 s).
- For multi-step work use the session helper — one session per tester / manual browser:

```bash
S=~/.claude/scripts/aside-session.sh
$S start e2e-2                                   # name: lowercase, digits, dashes
$S send  e2e-2 "await openTab('http://localhost:3100/'); console.log(page.url())"
$S send  e2e-2 "<next step, one line, statements joined with ;>"
$S stop  e2e-2                                   # always stop; the tab closes with the session
```

`send` prints the step output and returns 0 (`[ok]`), 3 (`[error]` or timeout) or 2 (session gone). Variables persist between `send` calls — use fresh names each time (`const s2 = …`).

### 3.2 Reading the page

- `snapshot(page, { interactive: true })` first, then `snapshot(page)`. Print the whole `tree` (or `diff` after an action) — never slice it.
- Ref ids (`e12`) are valid until the next snapshot: `await page.locator('e12').click()`.
- `annotatedScreenshot(page)` / `page.screenshot({ path: './artifacts/<name>.png' })` for visual checks.
- `listBrowserTabs()` + `attachBrowserTab(id)` to reach a tab another session opened (e.g. `/check-log`).
- Do not put the text `import(` anywhere in the code — the REPL rejects it.

### 3.3 Runtime invariants recorder (inject after every navigation)

Aside does not deliver console, page-error or response events. Inject this once per page load, then read `window.__e2e` after each action:

```js
await page.evaluate(() => { if (window.__e2e) return; window.__e2e = []; const ce = console.error.bind(console); console.error = (...a) => { window.__e2e.push('console: ' + a.map(String).join(' ')); ce(...a); }; addEventListener('error', e => window.__e2e.push('pageerror: ' + (e.message || e.type))); addEventListener('unhandledrejection', e => window.__e2e.push('rejection: ' + String(e.reason))); const f = window.fetch; window.fetch = async (...a) => { const r = await f(...a); if (r.status >= 400) window.__e2e.push('http ' + r.status + ' ' + (a[0] && a[0].url || a[0])); return r; }; const o = XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open = function (m, u, ...rest) { this.addEventListener('loadend', () => { if (this.status >= 400) window.__e2e.push('http ' + this.status + ' ' + u); }); return o.call(this, m, u, ...rest); }; });
```

Limits — state them in reports:
- Errors thrown **before** the recorder was injected (during page load) are not captured. After each navigation also check the page status with a same-origin `fetch(page.url())` (`page.goto` returns no response object in Aside).
- Network history is only what the recorder saw. For the full request list of a failure, use the server log or the Playwright fallback.

### 3.4 Response headers

`fetch(url)` in the REPL returns status and headers, **including `Set-Cookie`**, and sends the test profile's cookies.
- Replay only same-origin `GET`/`HEAD` requests. Never replay `POST`/`PUT`/`PATCH`/`DELETE`.
- Redact `Authorization`, `Cookie`, `Set-Cookie`, `X-API-Key`, `X-Auth-Token`, `Proxy-Authorization` and any header matching `/auth|token|secret|api[_-]?key/i` to `[REDACTED]` before printing or writing anything.

### 3.5 Files

- `page.screenshot` and the REPL `fs` can only write inside the session dir (`pwd`) — project paths are refused.
- Save to `./artifacts/<file>.png`, print `pwd`, then copy with Bash: `cp "<pwd>/artifacts/<file>.png" "<project_dir>/e2e-results/<file>.png"`.

### 3.6 Parallel testers

Each tester runs its own session (`e2e-<N>`) with its own tab in the same test account. Sessions do not share variables; they do share cookies and storage of the test account — design scenarios so they do not log each other out.

---

## 4. Playwright fallback

Use the existing procedures unchanged: `mcp__playwright-test-{N}__*`, `browser_console_messages`, `browser_network_requests`, absolute screenshot paths. `playwright-test-1` is headed and reserved for `/open-browser`; 2–5 are headless for testers.

---

## 5. What Aside cannot do (use Playwright for these)

| Need | Why |
|---|---|
| Page with a Content-Security-Policy that blocks the CDN `<script>` used for axe-core | axe is injected with a `<script>` tag |
| Full network list with response bodies for every request | no response events; the recorder sees fetch/XHR only |
| Errors raised during initial page load | the recorder is injected after load |
| File download tests (`waitForEvent('download')`) | not verified on Aside |

---

## ✅ Checklist

- [ ] Tool chosen from `cc-baseline-browser.json`; Aside used with `--account <test account>` only
- [ ] Every report has `BROWSER_TOOL` and `FALLBACK_REASON`
- [ ] `__e2e` recorder injected after every navigation; its limits noted when relevant
- [ ] Screenshots copied into `<project_dir>/e2e-results/`, none in the project root
- [ ] Sensitive headers `[REDACTED]`; only same-origin GET/HEAD replayed
- [ ] Every `aside-session.sh start` has a matching `stop`
