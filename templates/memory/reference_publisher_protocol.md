---
name: Publisher Agent Protocol
description: publisher agent auto-trigger conditions, call protocol, self-fix loop, decision_type follow-up, and the post-publish handoff to e2e-tester
type: reference
---

## ⚡ Key Rules Summary

- ✅ DO: `UI Impact: Yes/Unknown` in a plan's `## Meta` block → delegate UI/publishing work to publisher
- ✅ DO: After publisher returns `done`, **hand off to e2e-tester for functional verification** (responsive/states/console) — see §6
- ✅ DO: Provide a running `base_url` so publisher can run render compare + axe-core a11y scan
- ✅ DO: Pass `quality_flags` (responsive/i18n/dark_mode) only when the user/spec requires them
- ❌ DON'T: Expect publisher to write data binding, API, state, or event logic (out of its role)
- ❌ DON'T: Duplicate publisher's visual/a11y verification inside e2e-tester — e2e-tester does **functional** checks only
- ❌ DON'T: Trigger notifications at start/completion (only immediately before a design/business interview)

---

## 1. Auto-trigger Conditions

> **Pipeline position:** publisher is the **build** stage — it runs *during* execution, **before** the security-auditor / code-reviewer audit gates and the e2e-tester. For the full four-agent order and de-duplication matrix see `reference_agent_pipeline.md`.

publisher is a **builder** (it produces UI), so it is delegated **as the UI portion of a plan is executed**, not after the plan completes.

Trigger when **any** of:

- The plan's `## Meta` block has `UI Impact: Yes` or `Unknown` (field missing → treat as `Unknown` for UI-natured plans).
- The user explicitly says "publish / 퍼블리싱 / mark up this screen / build the UI".
- The active task is clearly markup/CSS/component authoring for a structured/admin-style screen.

Skip when: backend-only / logic-only work, or `UI Impact: No`.

> The `UI Impact` field lives alongside `Security Impact` / `Code Quality Impact` in the plan meta block (see `doc_structure_rules.md`).

---

## 2. Call Protocol

### 2.1 Pre-call Briefing Checklist (do this BEFORE invoking)

The orchestrator **briefs**, it does not raw-forward the spec. Resolve these before calling — publisher works better and cheaper when they are supplied (each maps to an Input Contract field):

- [ ] **Scope this call** → `screen_brief`: the single screen/route, its concrete `elements`, the `required_states` mandatory for *this* screen, and `out_of_scope`. Distill from the plan — do not dump the whole spec.
- [ ] **Where it goes** → `screen_brief.target_file` + `registration`: the file to write and how screens register (routing/page convention). publisher writes production files; it must not guess the location.
- [ ] **Data structure (read-only)** → `data_shape`: columns/fields the screen renders, so static markup is correct (not data binding).
- [ ] **Tone & manner basis** → `reference_screens` + `reference_notes`: which existing screen is the canonical example, and *what to mirror vs. skip*. A bare path is not enough.
- [ ] **Reuse anchors** → `reuse_anchors`: existing components you already know should be preferred, to prevent wrong new-class creation.
- [ ] **Reachability for visual verify** → `base_url` + `auth_note`: admin screens sit behind login; without `auth_note`, visual verification hits the login wall. State the authenticated route or a bypass.
- [ ] **Quality scope (decide, don't defer)** → `quality_flags`: set `i18n` / `responsive` / `dark_mode` from the project reality (e.g., i18n true if the project uses i18n everywhere). publisher must not guess these.
- [ ] **Profile freshness** → `regenerate_profile: true` only if the design system materially changed since the cached `design-profile.md`.

> a11y + all UI states are always enforced by publisher — they are not flags and need no briefing.

### 2.2 Prompt Template

Prompt structure when the orchestrator calls publisher via the Agent tool:

```
plan_paths:
  - <absolute path 1>
spec_assets:                     # optional design inputs (md/image/pdf/html)
  - <path>
screen_brief:                    # scoped target for THIS call (distilled, not the whole spec)
  screen: <screen / route>
  target_file: <file to write, e.g. src/pages/users/UserList.tsx>
  registration: <how screens register, e.g. route already at /admin/users>
  elements: [<FilterBar, DataTable(7 cols), Pagination, ...>]
  required_states: [<empty(0 results), loading skeleton, load error>]
  out_of_scope: [<detail modal, ...>]
data_shape:                      # read-only field/column shape (NOT binding)
  - <User = { name, email, joinedAt, status, role, lastSeenAt }>
reuse_anchors:                   # known existing components to prefer
  - <DataTable, FilterBar, Pagination, StatusBadge>
target_dir: <absolute path to project root>
reference_screens:               # optional; publisher auto-selects if empty
  - <screen path or route>
reference_notes: <what to mirror vs. skip, e.g. "copy OrderList padding/row height/empty copy; skip its old paginator">
base_url: <running dev-server URL>   # omit to skip visual verification
auth_note: <how to reach the screen — e.g. "session already logged in as admin@test"; omit only for public screens>
mcp_server: playwright-test-1    # optional, default
quality_flags:
  responsive: false              # set true only when required
  i18n: false
  dark_mode: false
iteration: 1
previous_report_path: null       # path to previous report on re-run
regenerate_profile: false        # true only after large design-system changes

## Output Constraints (strictly enforced)
- ❌ No pasting full file content, raw command output, or intermediate logs
- ❌ No process narration
- ❌ No role scope violations (no logic/binding/API; no server start)
- ✅ Fill in only the return format fields below
- Length limit: under 500 characters

Return format:
- Report path (md): <abs path>
- Report path (json): <abs path>
- Changed files: <N>
- Reused: <N> / Created: <N>
- Visual: passed | mismatch | skipped  (axe critical=N serious=N)
- profile_status: generated | cached | regenerated
- next_action: done | self_fix | user_interview
```

---

## 3. Self-fix Loop

publisher self-fixes token/naming/UI-state/a11y-static violations internally (no user loop needed for those). The orchestrator-level loop is for **visual mismatch or runtime a11y violations** that need a design/content decision.

- **Termination A (clean)**: `visual_status: passed` AND axe critical/serious = 0 → done.
- **Termination B (limit reached)**: 3 iterations → report remaining items to user and stop.
- Record each loop in a `## Publish History` section at the bottom of the plan file:

```markdown
## Publish History
- publish-iter-1: 2026-05-29 / reused=6 created=2 / visual=mismatch axe(serious=1) / profile=generated / next_action=self_fix
- publish-iter-2: 2026-05-29 / reused=6 created=2 / visual=passed axe(0) / profile=cached / next_action=done
```

---

## 4. Follow-up by decision_type

| decision_type | Follow-up |
|---------------|-----------|
| `auto` | publisher (re-call) fixes markup/CSS and re-verifies |
| `design` | user interview (AskUserQuestion) — layout/tone/component-structure decision |
| `business` | user interview (AskUserQuestion) — copy/UX/policy (e.g., i18n wording, empty-state message) |

---

## 5. Notification Before Interview

When 1 or more `design`/`business` items require a user decision, run this **immediately before** AskUserQuestion:

```bash
MSG="Publishing: user decision required (N items)"  # replace N with actual design+business count
if command -v terminal-notifier >/dev/null 2>&1; then
  terminal-notifier -title "Claude Code" -message "$MSG" -sound Glass
elif [ "$(uname)" = "Darwin" ]; then
  osascript -e "display notification \"$MSG\" with title \"Claude Code\" sound name \"Glass\"" \
    || osascript -e "display dialog \"$MSG\" with title \"Claude Code\" buttons {\"OK\"} default button \"OK\""
elif command -v notify-send >/dev/null 2>&1; then
  notify-send "Claude Code" "$MSG"
fi
```

---

## 6. Handoff to e2e-tester (post-publish functional verification)

publisher covers **visual tone & manner + runtime a11y**. It does **not** test functional interaction. After publisher returns `next_action: done`, the orchestrator hands the new screen to e2e-tester (per `reference_e2e_manager_guide.md`).

**Division of responsibility (do not overlap):**

| Concern | Owner |
|---------|-------|
| Tone & manner, render breakage | publisher (Step 6 render compare) |
| Runtime a11y (axe-core) | publisher (Step 6) |
| Token/naming/UI-state coverage | publisher (Step 5 self-check) |
| **Functional interaction** (click → expected result, navigation, form submit) | **e2e-tester** |
| Console-error-free during interaction | e2e-tester (already collects console) |
| Responsive behavior under interaction | e2e-tester scenario (if `responsive` flag was on) |

**The orchestrator (not publisher, not a change to e2e-tester) is responsible for:**

1. Generating e2e scenarios focused on the **interactive behavior** of the newly published UI — using the elements/states publisher created. Do **not** re-assert visual tone or a11y (already covered).
2. Delivering those scenarios to e2e-tester in the standard input format (`mcp_server`, `base_url`, `scenario.steps`, `screenshot_mode`).
3. If `quality_flags.responsive` was true, include `browser_resize` steps at the profile breakpoints (e2e-tester already supports resize + screenshot — no agent change needed).

> **No modification to `e2e-tester.md` is required.** It already supports navigation, clicks, resize, screenshots, and console/network collection. The publishing-specific knowledge lives here, in the scenarios the orchestrator authors — keeping e2e-tester a pure functional executor.

---

## 7. Report Path Rules

```
<target_dir>/.cc-audits/<plan-slug>/publish-iter-<n>.md
<target_dir>/.cc-audits/<plan-slug>/publish-iter-<n>.json
<target_dir>/.cc-audits/design-profile.md   # shared design profile (reused across plans)
```

`plan-slug` is the plan filename without extension.

---

## 8. Profile Cache Management

| Situation | `regenerate_profile` | Reason |
|-----------|----------------------|--------|
| Normal run | `false` (default) | hash-based auto-detection is sufficient |
| Design-system token overhaul | `true` | force refresh before key_files hash changes |
| Framework migration (e.g., Bootstrap→Tailwind) | `true` | reflect full convention change |
| `design-profile.md` corrupted or deleted | `true` | force regeneration |

---

## ✅ Checklist

- [ ] Triggered only on UI/publishing work (`UI Impact` / explicit request / UI-natured task)
- [ ] Pre-call briefing done (§2.1): `screen_brief` scoped, `data_shape`, `reuse_anchors`, `reference_notes`, `auth_note`, `quality_flags` resolved
- [ ] `base_url` provided when visual verification is wanted; `quality_flags` set per requirement
- [ ] Self-fix loop terminated on clean or 3-iteration limit; `## Publish History` updated
- [ ] design/business items → notify then interview
- [ ] After `done`, handed off to e2e-tester for **functional** verification (no visual/a11y overlap)
- [ ] e2e-tester.md left unmodified; publishing knowledge kept in orchestrator-authored scenarios
