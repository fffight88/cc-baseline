---
name: Test Environment Setup
description: Before the first e2e run on a project with a real backend — test backend with the production schema only, a guarded test login, a reset script that refuses anything but the test project, CSP and host rules, fake servers for paid external APIs, and test-env-check.js
type: reference
---

## ⚡ Key Rules Summary

| ✅ DO | ❌ DON'T |
|---|---|
| Use a separate test backend with the production **schema only** | Point tests at production, or copy production rows / personal data |
| Guard the test login three ways (not a production build, an explicit flag, the backend is the test project) — anything else answers 404 | Add a login bypass that one env var switches on |
| Make the reset script refuse unless it points at the test project | Write a reset that deletes before checking its target |
| Read backend hosts in the CSP from env; list them in `browser_origins` | Hard-code the production host in the CSP |
| Use one host everywhere (`localhost` **or** `127.0.0.1`) | Mix them — cookies are per host |
| Bind test databases and dev servers to 127.0.0.1 | Publish a dev database on 0.0.0.0 on a public machine |
| Replace a paid third-party API with a loopback fake server only when approved, recorded in `external_stubs` and named in the report | Override functions in JS, or report faked results without saying so |
| Run `test-env-check.js` before the first round; fix every `fail` | Discover CSP or cookie problems in the middle of a round |

---

## 1. When

A project whose screens reach a real backend (database, auth provider, storage, paid APIs) needs a test environment **before** the first e2e round. In the plan's E2E section, list what is missing (sections 2–7) as execution steps; the user approves them with the plan. On the first real project this setup took more than half of the e2e time — do it once, commit it, and reuse it.

---

## 2. Test backend — production schema, no production data

- A separate project or database for tests (e.g. a second Supabase project). Never the production one.
- Copy the **structure only**: tables, constraints, indexes, functions, triggers, row-level-security policies, storage buckets. No rows.
- Prefer a CLI dump when you can connect: `supabase db dump --schema-only`, `pg_dump --schema-only`.
- Without a direct connection, generate the DDL with a catalog query in the provider's SQL editor (`pg_catalog` / `information_schema`, `pg_get_functiondef`, `pg_get_triggerdef`, `pg_policies`).
  - SQL editors split a script at every `;`, including the ones inside function bodies. In the generating query, build `;` with `chr(59)`, and run the generated statements one at a time.
- Commit the result as the first migration (e.g. `supabase/migrations/<ts>_initial_schema.sql`, header "structure only, no rows") and apply it to the test project. Later schema changes go through migrations applied to both.
- Keys of the test project go in `.env.development.local` / `.env.test.local` (mode 600, gitignored). Never print them.

---

## 3. Test login — three guards

Social or e-mail-link login cannot be automated. Add a route that signs in as the test account, and make it answer **404 unless all three hold**:
1. Not a production build (`NODE_ENV !== 'production'`).
2. An explicit flag (`E2E_TEST_LOGIN=1`).
3. The backend is the test project (its URL host equals the test project's, e.g. `${SUPABASE_TEST_REF}.supabase.co`).

```ts
// app/auth/test-login/route.ts (Next.js + Supabase example)
function enabled(): boolean {
  if (process.env.NODE_ENV === 'production') return false
  if (process.env.E2E_TEST_LOGIN !== '1') return false
  const ref = process.env.SUPABASE_TEST_REF
  if (!ref || !process.env.E2E_TEST_EMAIL || !process.env.E2E_TEST_PASSWORD) return false
  try { return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').host === `${ref}.supabase.co` } catch { return false }
}
export async function GET(request: Request) {
  if (!enabled()) return new Response('Not Found', { status: 404 })
  // sign in with E2E_TEST_EMAIL / E2E_TEST_PASSWORD, then redirect to the signed-in start page
}
```

- The test account's password lives only in env files. The route never accepts credentials from the request.
- It signs in on a plain GET, so a link or prefetch can trigger it: it must never be reachable on a shared or deployed host — the three guards keep it to local test servers.
- After deploying, check by hand that production answers 404 on the path.
- Put the path in `tc-run.json` as `test_login_path`; recordings use it as their login step.

---

## 4. Reset script — the test project or nothing

`reset_command` puts the data back to the TCs' starting state before every round and every verify replay.
- First compare the configured backend host with the test project's; on any difference print a refusal and exit 2 **before** any request.
- Touch only the test account: delete its rows and files, restore its starting values (credits, plan). Running it twice gives the same state.
- Form: `<node|bash|sh|python3> scripts/<name> <plain args>` — the interpreter by name, never a path such as `.venv/bin/python`; no shell syntax; a script committed to git inside the project, not under `.cc-audits/`.
- A test reset is not the project's dev reset: it puts back only what the TCs change, in seconds. A reset that drops volumes, takes minutes or touches the developer's own database does not belong in `reset_command` — give the tests their own database (e.g. a second database in the same container) and reset that one. Record it as `reset_command`. The same form and rule hold for every `data.<name>_command` (e.g. switching a fake server's mode), which recordings run by name.

---

## 4-B. Local ports on a shared or public machine

- Databases and other infrastructure for tests listen on `127.0.0.1` only. Docker publishes ports past the host firewall (ufw does not stop it), and dev databases use well-known passwords.
- When the repository's `docker-compose.yml` publishes on all interfaces (`"5433:5432"`), add an uncommitted `docker-compose.override.yml` and list it in `.git/info/exclude`:
  ```yaml
  services:
    postgres:
      ports: !override
        - "127.0.0.1:5433:5432"
  ```
- Start dev servers on loopback too (`vite --host 127.0.0.1`, `uvicorn --host 127.0.0.1`).
- `test-env-check.js` warns (`docker_ports`) when a compose container of the project publishes on `0.0.0.0` / `[::]`.

---

## 5. Origins and CSP

- Every other https origin the app's browser code calls (the backend, its storage) goes in `browser_origins`. Replays and sweeps abort everything else.
- The app's CSP (`connect-src`, `img-src`) must allow the **test** backend. Read the host from the same env var the app uses (`NEXT_PUBLIC_SUPABASE_URL`) instead of hard-coding the production host; otherwise the browser blocks the test backend and screens show empty data.

---

## 6. One host

Cookies belong to a host: a session set on `localhost` is not sent to `127.0.0.1`, and the reverse.
- `base_url`, the app's site URL / auth redirect URL, and every redirect the app makes must use the same host and port.
- Binding the dev server (`next dev -H 127.0.0.1`) does not change the host the app writes in redirects — check the redirects (`test-env-check.js` follows them).

---

## 7. Paid external APIs — a fake server (conditional exception to No Mock)

The No Mock policy (`reference_e2e_manager_guide.md` §4) still holds. One exception: a **paid or irreversible third-party API** (image generation, payments, SMS) may be replaced by a fake server when **all** of these hold:
- The app's own code runs unchanged. Only the address of the third-party call changes — through an env var the SDK supports (e.g. a base URL), ignored in production builds.
- The fake server runs on loopback and answers like the real API: a fixed success response, and error responses (429, 500) you can select per run, so error paths can be tested.
- The user approved it in the plan, and `tc-run.json` lists it: `"external_stubs": [{ "name": "gemini", "url": "http://127.0.0.1:4010", "env": "GEMINI_BASE_URL" }]`.
- The report names every faked API ("faked external API: gemini"). An expected result about the quality of the external output (the generated image itself) is `NOT_OBSERVABLE`, never PASS.
- Overriding functions or return values in JS is still forbidden.

---

## 8. Check before the first round

```bash
node ~/.claude/scripts/test-env-check.js --run .cc-audits/<plan-slug>/tc-run.json
```

It requests only `base_url` and the `external_stubs` URLs (GET), writes nothing, and checks: `base_url` answers; redirects stay on one host; the CSP allows `browser_origins`; `browser_origins` is well-formed; `reset_command` has the allowed form and its script is committed; no compose container of the project publishes on all interfaces (warn); `test_login_path` does not answer 404; every fake server is on loopback and answers. Exit 1 = a `fail` — fix it before running testers. Notes: requesting `test_login_path` signs in the test account, so it is requested once and only on a loopback `base_url`. The CSP is read from `/` only — a page with its own CSP is not checked. Exit 3 = the check itself broke.

---

## ✅ Checklist

- [ ] Test backend separate from production; schema-only migration committed and applied; no production rows
- [ ] Test login answers 404 unless not-production + flag + test backend; production checked by hand
- [ ] Reset script refuses anything but the test project; touches only the test account; `reset_command` set
- [ ] Test databases and dev servers listen on 127.0.0.1 (`docker_ports` not warned)
- [ ] CSP reads backend hosts from env; `browser_origins` lists them
- [ ] One host in `base_url`, site URL and redirects
- [ ] Faked paid APIs approved, in `external_stubs`, named in the report; no JS overrides
- [ ] `test-env-check.js` ran with no `fail`
