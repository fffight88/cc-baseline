---
name: TC Authoring Contract
description: How the orchestrator writes user actions and TCs during /plan — the `docs/tc/<feature>.tc.json` format, one-fact expected results, observe channels, basis/readiness, authoring checks, and what the e2e stage may and may not change
type: reference
---

## ⚡ Key Rules Summary

| ✅ DO | ❌ DON'T |
|---|---|
| Write actions (ACT) first, then TCs per action — **once**, while writing the plan; the user's plan approval freezes them | Re-split steps or invent input values at e2e time |
| One expected result = **one fact** a machine can decide (URL, text, element state, API value, log line) | Bundle several checks into one sentence, or write visual/subjective judgments ("looks good") — those belong to publisher |
| Give every expected result an `observe.channel`; off-screen data (API/DB/log) gets `api` / `db` / `log` | Let a screen judgment stand in for server state |
| Mark the basis: `requirement` / `source-observation` / `proposal`; every `proposal` is `needs-decision` | Promote the current implementation's behavior to an approved answer |
| Put the happy path and each rejection/error flow in **separate** TCs | Mix success and failure expectations in one TC, or clone the same TC set onto every function |
| Keep run data (URL, accounts, input values, skip reasons, results) **out** of the TC file | Write results, thresholds or secrets into `docs/tc/*.tc.json` |
| Run the authoring checks and fix the sentence or record why a warning stays | Treat authoring warnings as blockers — they warn only |
| Change TC text only in the TC file, with the user's OK and a reason | Rewrite a TC so a failing run passes, or weaken an expected result |

---

## 1. When TCs are required

- A plan whose `## Meta` has `Behavior Impact: Yes` or `Unknown` must contain actions + TCs.
- `Behavior Impact: No` (pure refactor, docs, build config with no user-visible change) → no TC file; say so in the plan.
- TCs live in the **project**: `docs/tc/<feature>.tc.json`, committed. One file per feature; a later plan updates the same file instead of creating a parallel one.
- Run artifacts live under `.cc-audits/<plan-slug>/` (not committed): `tc-check.json`, `tc-run.json`, `tc-results.jsonl`, `obs/`.

---

## 2. File format — `docs/tc/<feature>.tc.json`

JSON (Node reads it with no dependency). The plan body shows a TC summary table for human review; the file is the machine-readable source.

```json
{
  "schema_version": 1,
  "feature": "password-reset",
  "title": "Password reset",
  "plan": "<plan-slug>",
  "sources": [
    { "id": "SRC.reset-controller", "kind": "source", "locator": "src/auth/reset.ts:42 (commit abc1234)" },
    { "id": "REQ.reset-01", "kind": "requirement", "locator": "user request 2026-11-07" }
  ],
  "actions": [
    {
      "id": "ACT.password-reset.request",
      "title": "Request a reset email",
      "actor": "signed-out user",
      "trigger": "clicks 'Forgot password' on the login screen and submits an email",
      "preconditions": ["a registered email exists"],
      "outputs": ["reset-sent screen", "reset email"],
      "evidence_refs": ["SRC.reset-controller", "REQ.reset-01"]
    }
  ],
  "test_cases": [
    {
      "id": "TC.password-reset.request-success",
      "title": "Requesting with a registered email shows the sent screen",
      "action_refs": ["ACT.password-reset.request"],
      "level": "functional",
      "surface": "ui-web",
      "preconditions": ["signed out", "registered test account"],
      "fixture": "user-basic",
      "steps": [
        { "goal": "Click 'Forgot password' on the login screen",
          "done_when": { "expect": "A reset screen with an email field opens" } },
        { "goal": "Enter the test account email and click 'Send'",
          "input_refs": ["email"],
          "done_when": { "expect": "The screen changes after submit" } }
      ],
      "expected": [
        { "text": "The URL changes to /reset/sent",
          "observe": { "channel": "dom", "key": "location.pathname" } },
        { "text": "A notice says the email was sent",
          "observe": { "channel": "dom", "question_id": "Q.success_notice" } },
        { "text": "A reset-mail send is logged",
          "observe": { "channel": "log", "key": "mail.reset.sent" } }
      ],
      "basis": { "kind": "requirement", "refs": ["REQ.reset-01"] },
      "readiness": "ready"
    }
  ],
  "open_questions": []
}
```

### Field rules

| Field | Rule |
|---|---|
| `feature` | kebab-case; used as the ID prefix |
| IDs | `ACT.<feature>.<name>`, `TC.<feature>.<name>`, `SRC.<name>` / `REQ.<name>` — **meaning names**, never renumbered when order changes |
| `sources[].kind` | `source` (code you read: repo path + line/symbol + commit) · `requirement` (user request, spec) · `decision` (a user decision in this conversation) |
| `actions[]` | `id, title, actor, trigger, preconditions, outputs, evidence_refs` — who / under what condition / does what / what state or result follows |
| `level` | `functional` · `contract` · `integration` |
| `surface` | `ui-web` (e2e-tester runs it) · `api` · `cli` |
| `steps[].goal` | one user intent per step |
| `steps[].done_when.expect` | one sentence: what the screen looks like when the step is done. Required |
| `steps[].input_refs` | names of inputs; the values come from the run add-on file (`tc-run.json`), never from the TC |
| `expected[].text` | one fact, non-empty |
| `expected[].observe.channel` | `dom` · `ax-node` · `api` · `db` · `log` · `artifact` · `env` · `unknown` |
| `expected[].observe.key` | what to read: a URL part, selector, endpoint + status, log key, file path |
| `expected[].observe.question_id` | optional standard question (§4) for screen judgments that code cannot decide |
| `basis` | `{ kind: requirement | source-observation | proposal, refs: [...] }` |
| `readiness` | `ready` · `needs-decision`. `proposal` ⇒ `needs-decision`. `ready` means the TC text is ready, **not** that the feature passes |
| `fixture` | optional name of a data/account bundle defined in `tc-run.json` |

---

## 3. Writing rules

### Actions
- Write from the user's side. Group the awaits/fetches/transactions of one user action into **one** action.
- Read the source directly; cite it in `sources` with `kind: source`. Code-only behavior that no requirement mentions → TC with `basis.kind: source-observation`, and list it in `open_questions` as a spec gap. Requirement-only behavior with no code yet → keep it as a TC; the run will show it missing.

### Expected results
- **One fact per line.** "Saved and an email is sent" is two lines.
- **Name the channel.** Anything that is not on the screen (stored row, sent mail, audit log, response field) uses `api` / `db` / `log` — the screen showing "Saved" does not prove the row exists.
- **Words on the screen.** Quote button and menu labels exactly as the product shows them.
- **No subjective words** ("nice", "natural", "clean", "awkward"). Visual quality is publisher's (§3 of `reference_agent_pipeline.md`).
- When the channel truly cannot be named yet, use `channel: unknown` and keep the sentence — never delete or soften it.

### Cases
- Happy path, rejection, error, boundary, cancel, retry → separate TCs, and only where the contract actually has that behavior.
- Login or existing data needed → say so in `preconditions` and name a `fixture`.
- Never invent numbers or expected values to make a TC `ready`; missing facts → `needs-decision` + an `open_questions` entry.

---

## 4. Standard questions

For screen judgments code cannot decide, prefer a fixed question over a free sentence. The sentence is fixed per version; changing it creates a new version, and scores of different versions are never mixed.

| ID | Type | Question |
|---|---|---|
| `Q.error_visible@1` | Noul | Is a message or mark telling of an error or failure on the screen? |
| `Q.loading@1` | Noul | Is the screen still loading? |
| `Q.dialog_open@1` | Noul | Is a dialog or popup open? |
| `Q.success_notice@1` | Noul | Is a message or mark telling that the action just done succeeded? |
| `Q.item_added@1` | Noul | Is a new item matching `{item}` visible in the list? |

Only the `{item}` placeholder is filled from the TC.

---

## 5. Authoring checks (run after writing, before asking for approval)

```bash
node ~/.claude/scripts/tc-lint.js docs/tc/<feature>.tc.json --json .cc-audits/<plan-slug>/tc-check.json
node ~/.claude/scripts/tc-jev-check.js docs/tc/<feature>.tc.json --out .cc-audits/<plan-slug>/tc-check.json   # Jev key set only
```

- `tc-lint.js` (code rules) always runs. `tc-jev-check.js` scores each expected result with three Noul questions — `single` (one fact?), `hidden` (needs off-screen data?), `screen` (decidable from the screen alone?) — and does nothing when no Jev key is configured.
- Both **warn only** (exit 0). Fix the sentence, or keep it and write the reason in the plan.
- Put a short summary in the plan: TC count, warning count by rule, warnings kept and why.

---

## 6. What the e2e stage may change

| May | May not |
|---|---|
| Write `.cc-audits/<plan-slug>/tc-run.json`: start path, persona/account, fixture data, input values (secrets as env var names), `skip: <reason>` | Edit `steps` or `expected` text in the TC file |
| Report a TC as `unmapped` or `skip` with a reason (`api-only`, `external-idp`, `real-input-device`, `server-injection`, `decided-out`) | Weaken or drop an expected result because it is hard to observe |
| Append results to `tc-results.jsonl` | Write results into the TC file |
| Propose a TC text fix to the user when the sentence itself is wrong | Apply that fix without the user's OK and a recorded reason |

---

## ✅ Checklist (per plan with `Behavior Impact: Yes/Unknown`)

- [ ] `docs/tc/<feature>.tc.json` exists and parses; IDs are meaning names, unique, and every `action_refs` / `evidence_refs` resolves
- [ ] Every action has a source; every TC has a `basis`; every `proposal` is `needs-decision`
- [ ] Every step has `done_when.expect`; every input is an `input_refs` name, never a literal value
- [ ] Every expected result is one fact with an `observe.channel`; off-screen facts use `api` / `db` / `log`
- [ ] Success and failure flows are separate TCs; no subjective/visual sentences
- [ ] No URLs, results, thresholds or secrets in the TC file
- [ ] Authoring checks ran; warnings fixed or kept with a reason in the plan
- [ ] The plan shows the TC summary table; the user's approval freezes the TCs
