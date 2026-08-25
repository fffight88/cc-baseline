---
name: Design Director Agent Protocol
description: design-director auto-trigger (greenfield only), call protocol, shortlist→interview→commit loop, and the seeded-profile handoff contract with publisher
type: reference
---

## ⚡ Key Rules Summary

- ✅ DO: Call design-director **only on greenfield** — no `.cc-audits/design-profile.md` **and** no existing design system/screens
- ✅ DO: Run it **before publisher**, as the first stage of a UI-bearing plan — publisher needs a system to enforce
- ✅ DO: Run the user interview **yourself** (AskUserQuestion) from its 3 candidates, then re-call with `iteration: 2` + `chosen_direction`
- ✅ DO: Notify (§5) immediately before that interview — it is a `design` decision
- ✅ DO: Honor the **seeded-profile contract** (§7): a `profile_origin: seeded` profile is a cache hit for publisher, not a stale one
- ❌ DON'T: Call it when a design system already exists — publisher's own Step 0 scan owns that path
- ❌ DON'T: Let it author markup/CSS/components, or let publisher decide the direction — one role each
- ❌ DON'T: Route `product-ui` (dashboards, tables, admin, wizards) to the `taste-skill` lane — the skill refuses that class itself
- ❌ DON'T: Re-run it on every plan — direction is decided **once per project** and then cached in the profile

---

## 1. Auto-trigger Conditions

> **Pipeline position:** design-director is the **direction** stage — it runs *before* publisher, which runs before the audit gates. For the full five-agent order see `reference_agent_pipeline.md`.

Trigger when **all** of:

- The plan's `## Meta` has `UI Impact: Yes` or `Unknown`, **and**
- `<target_dir>/.cc-audits/design-profile.md` does **not** exist, **and**
- The project has no detectable design system (no `tailwind.config.*` / token / theme file, no `@layer`/`@theme`/`--color-*` in stylesheets) and no built screens.

Skip when **any** of:

- A design profile already exists (direction is already decided — go straight to publisher).
- The project has an existing design system or completed screens — even a half-finished one. **Inheriting someone else's design is publisher's core competence**; overriding it with a fresh direction is the wrong move and the reason publisher exists.
- `UI Impact: No`, or the plan is backend/logic-only.

> One decision per project. Once the profile is seeded, every later plan is a plain publisher flow.

### 1.1 Re-deciding an existing direction

Only on explicit user request ("디자인 방향을 바꾸자"), and then call with `regenerate_profile: true`. This overwrites the `## Design Direction` block. Warn the user first: screens already built to the old direction will drift until re-published.

---

## 2. Call Protocol

### 2.1 Pre-call Briefing Checklist (before invoking)

- [ ] **Greenfield confirmed** → you checked for a profile / design system / built screens yourself. Do not make the agent discover a wasted call.
- [ ] **What the product is** → `product_brief.what` + `audience` + `surfaces`. The lane classification is only as good as this.
- [ ] **Any words the user already used** → `vibe_words`. If the user said "Linear 같은 느낌", that belongs here, not discarded.
- [ ] **Existing brand assets** → `brand_assets`: logo, brand color, an existing marketing site. A direction that contradicts the user's own brand is dead on arrival.
- [ ] **Stack already committed?** → mention it in `product_brief`; the seeded profile records `detected_stack`.

### 2.2 Prompt Template

```
plan_paths:
  - <absolute path>
spec_assets:                      # optional (md/image/pdf/html)
  - <path>
target_dir: <absolute path to project root>
product_brief:
  what: <one line — what this product is>
  audience: <who uses it, how long, how often>
  surfaces: [<dashboard, list+detail CRUD, settings, landing, ...>]
vibe_words: [<user's own words, if any>]
brand_assets:                     # optional
  - <path or description>
iteration: 1                      # 1 = shortlist, 2 = commit
chosen_direction: null            # required on iteration 2
previous_report_path: null

## Output Constraints (strictly enforced)
- ❌ No pasting full file content, raw command output, or fetched DESIGN.md bodies
- ❌ No process narration
- ❌ No role scope violations (no markup/CSS/components, no server, no git)
- ✅ Fill in only the return format fields below
- Length limit: under 500 characters

Return format:
- Report path (md): <abs path>
- Report path (json): <abs path>
- Lane: product-ui | marketing-web
- Candidates: <slug1>, <slug2>, <slug3>       (iteration 1)
- Chosen: <slug>                              (iteration 2)
- Profile written: <abs path | none>
- next_action: user_interview | done | call_publisher
```

---

## 3. Shortlist → Interview → Commit Loop

Two iterations, no self-fix loop (there is nothing to verify — only a decision to record).

| Iteration | Agent does | Orchestrator does next |
|-----------|-----------|------------------------|
| 1 | Greenfield gate → lane → 3 candidates → `next_action: user_interview` | Notify (§5), then AskUserQuestion with the 3 candidates + their `why` lines |
| 2 | Fetch source → seed `design-profile.md` → `next_action: done` | Proceed to publisher for screen 1 |

**Interview construction** — build the AskUserQuestion from the agent's `candidates[]`:

- One question, `multiSelect: false`, 3 options. Use each candidate's `label` as the option label and its `one_line` + `why` as the description.
- Do **not** add a "you decide" option. The whole point of this stage is that the direction is on record.
- Pass the user's own words back as `chosen_direction.reason` — the profile stores it as "Chosen because", which is what makes the decision auditable later.

**Terminations other than `done`:**

| `termination.reason` | Meaning | Follow-up |
|---------------------|---------|-----------|
| `not_applicable` | Greenfield gate failed — a profile or design system exists | Skip design-director, call publisher directly. Nothing was written. |
| `source_unavailable` | The chosen DESIGN.md could not be fetched | Re-interview against the remaining 2 candidates; do not let the agent invent a system |

---

## 4. Handoff to publisher

After `next_action: done`, call publisher for screen 1 as normal. Two things change versus a brownfield call:

1. **`regenerate_profile` stays `false`.** The profile was just written. Forcing a regenerate here would scan an empty project and destroy the direction.
2. **`reference_screens` is empty and that is expected** — publisher records `reference_basis: spec-only` on screen 1. From screen 2 onward it auto-selects screen 1 as the reference, and normal tone-and-manner enforcement resumes.

**Division of responsibility (do not overlap):**

| Concern | Owner |
|---------|-------|
| What the product should look like (palette, type voice, density, lane) | **design-director** (once per project) |
| Recording that decision so it survives | **design-director** (seeds `design-profile.md`) |
| Making screen N look like that decision | **publisher** (reuse-first authoring + Step 5 self-check) |
| Keeping screens 2..N consistent with screen 1 | **publisher** (Step 2 reference selection) |
| Whether the built screen actually renders correctly | **publisher** (Step 6) |

> design-director decides **once**; publisher enforces **every time**. Never collapse the two — a per-screen direction decision is exactly the drift this stage exists to prevent.

---

## 5. Notification Before Interview

The direction choice is a `design` decision, so the standard rule applies — run this **immediately before** AskUserQuestion:

```bash
MSG="Design direction: user decision required (3 candidates)"
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

## 6. Report Path Rules

```
<target_dir>/.cc-audits/<plan-slug>/design-direction-iter-<n>.md
<target_dir>/.cc-audits/<plan-slug>/design-direction-iter-<n>.json
<target_dir>/.cc-audits/design-profile.md   # the seeded profile — shared, cross-plan, publisher reads it
```

The direction report is a **decision record**, not an audit finding. It is not merged into `report.html` (that file is security + code-review only).

---

## 7. Seeded-Profile Contract (design-director ↔ publisher)

This is the one place the two agents share state, and the one place it can silently break.

**The problem:** publisher's Step 0 decides freshness by hashing `key_files` and comparing to `key_files_hash`. A seeded profile is written **before those files exist**. A naive hash check would find a mismatch, call the profile `stale`, regenerate it from an empty project, and **erase the direction the user just chose** — with no error.

**The contract:**

| Field | Seeded (design-director) | Scanned (publisher) |
|-------|--------------------------|---------------------|
| `profile_origin` | `seeded` | `scanned` |
| `key_files` | `[]` | actual file list |
| `key_files_hash` | `null` | sha256 |
| `## Design Direction` | present | **preserved verbatim** |
| `## Component Inventory` | empty | populated |

- ✅ DO: publisher treats `profile_origin: seeded` **plus** empty `key_files` as a **cache hit** — load and use, never regenerate on a hash check.
- ✅ DO: When publisher does eventually rescan (explicit `regenerate_profile: true`, or the project now has real key_files), it flips `profile_origin` to `scanned` and fills `key_files`/`key_files_hash` — while **copying the `## Design Direction` section through unchanged**.
- ❌ DON'T: Let a regeneration drop `## Design Direction`. The scan can re-derive tokens from code; it cannot re-derive *why this direction was chosen* or what was rejected.
- ❌ DON'T: Hash-check a profile whose `key_files` is empty. There is nothing to hash; a "mismatch" there is meaningless.

---

## ✅ Checklist

- [ ] Greenfield verified by the orchestrator before calling (no profile, no design system, no built screens)
- [ ] `product_brief` supplied with `what` / `audience` / `surfaces`; user's own `vibe_words` passed through, not discarded
- [ ] Iteration 1 returned 3 candidates and wrote nothing
- [ ] Notification fired immediately before the interview (§5)
- [ ] Interview offered exactly the agent's 3 candidates, no "you decide" option; user's reason captured
- [ ] Iteration 2 wrote `design-profile.md` with `profile_origin: seeded` + `key_files: []` + `key_files_hash: null`
- [ ] publisher called next with `regenerate_profile: false`; `reference_basis: spec-only` on screen 1 accepted as normal
- [ ] (§7) Any later profile regeneration preserved the `## Design Direction` section verbatim
- [ ] `not_applicable` / `source_unavailable` terminations handled per §3 (no invented design system)
