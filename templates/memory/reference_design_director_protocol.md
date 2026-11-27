---
name: Design Director Agent Protocol
description: design-director auto-trigger (greenfield only), call protocol, shortlist→choose→commit loop (the orchestrator chooses under rule 15), and the seeded-profile handoff contract with publisher
type: reference
---

## ⚡ Key Rules Summary

- ✅ DO: Call design-director **only on greenfield** — no `.cc-audits/design-profile.md` **and** no existing design system/screens
- ✅ DO: Run it **before publisher**, as the first stage of a UI-bearing plan — publisher needs a system to enforce
- ✅ DO: **Choose** one of its 3 candidates yourself (session rule 15; for an external product, `reference_work_judgment.md` §2 first), then re-call with `iteration: 2` + `chosen_direction` (§3)
- ✅ DO: Show the choice in the answer — chosen, why, the two rejected, each candidate's preview link — and record it in the plan's `## Decisions (made without asking)`
- ✅ DO: Start the local preview server before choosing so the links work; stop it at the end of the phase (§3)
- ✅ DO: Honor the **seeded-profile contract** (§7): a `profile_origin: seeded` profile is a cache hit for publisher, not a stale one
- ❌ DON'T: Call it when a design system already exists — publisher's own Step 0 scan owns that path
- ❌ DON'T: Let it author markup/CSS/components, or let publisher decide the direction — one role each
- ❌ DON'T: Let the agent choose, or choose a direction outside its 3 candidates
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

## 3. Shortlist → Choose → Commit Loop

Two iterations, no self-fix loop (there is nothing to verify — only a decision to record).

| Iteration | Agent does | Orchestrator does next |
|-----------|-----------|------------------------|
| 1 | Greenfield gate → lane → 3 candidates → `next_action: user_interview` (its fixed value for "a choice is needed") | Start the preview server, choose one candidate (below), show the choice with the preview links |
| 2 | Fetch source → seed `design-profile.md` → `next_action: done` | Proceed to publisher for screen 1; stop the preview server at the end of the phase |

**Preview server** — the catalog's preview pages are installed in `~/.claude/design-previews/` (project installs: `.claude/design-previews/`). Before choosing:

```bash
BASE=$(node ~/.claude/scripts/design-preview.js start)   # prints e.g. http://127.0.0.1:4310/ — reuses a running server
```

- Each candidate's link is `$BASE` + its `preview_path` (`$BASE<slug>/`); the whole catalog is `$BASE`. A `taste-lane` candidate (`preview_path: null`) has no page.
- The server binds `127.0.0.1` only. If Claude Code runs on a remote machine, tell the user to open a tunnel first: `ssh -L <port>:127.0.0.1:<port> <host>`.
- If `start` exits non-zero (pages not installed, no free port in 4310–4339), show the choice without links and say so; it is not a blocker.
- At the end of the phase that called design-director: `node ~/.claude/scripts/design-preview.js stop` (`/clean` does it too). The server also exits by itself after 2 hours without requests.

**Choosing** (session rule 15, `reference_work_judgment.md` §3):

- The orchestrator chooses **one of the agent's 3 candidates** — never a fourth of its own; the agent itself never chooses.
- Weigh the product brief, the lane, the user's `vibe_words` and `brand_assets`, and each candidate's `why`.
- External product (rule 14 — a landing page, a product to sell, a portfolio piece): apply `reference_work_judgment.md` §2 first — name the candidate that is the average pick for this kind of product and why it fails, look at how the comparables look, and choose where the product should be distinct.
- Ask the user only for a rule-15 category — e.g. a brand guide the user mentioned that is not in the files. Then notify as in session rule 9 just before asking.
- Pass `chosen_direction.reason` as one line: `decided by Claude under rule 15: <reason>` — the profile stores it as "Chosen because", which keeps the decision auditable.
- Record it in the plan's `## Decisions (made without asking)`: chosen, the two rejected and why, how to undo (§1.1).

**Showing the choice** — in the answer, right after choosing: the chosen candidate and its reason, the two rejected ones, the three preview links and the gallery link as clickable URLs in plain text. Say that the user can switch: before screen 1 is built, a switch costs one re-run (§1.1).

**Terminations other than `done`:**

| `termination.reason` | Meaning | Follow-up |
|---------------------|---------|-----------|
| `not_applicable` | Greenfield gate failed — a profile or design system exists | Skip design-director, call publisher directly. Nothing was written. |
| `source_unavailable` | The chosen DESIGN.md could not be fetched | Choose again from the remaining 2 candidates the same way; do not let the agent invent a system |

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

## 5. Notification

None by default — the orchestrator chooses, so nothing waits on the user; the choice is shown in the answer (§3). Only when a rule-15 question remains (§3 Choosing) does the session rule 9 notification run, immediately before asking.

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
- [ ] The orchestrator chose one of the agent's 3 candidates under rule 15 (external product: `reference_work_judgment.md` §2 first); the reason was passed as `chosen_direction.reason`
- [ ] The choice, its reason, the two rejected candidates and the preview links were shown in the answer and recorded in `## Decisions (made without asking)`
- [ ] Preview server started before choosing and stopped at the end of the phase
- [ ] Iteration 2 wrote `design-profile.md` with `profile_origin: seeded` + `key_files: []` + `key_files_hash: null`
- [ ] publisher called next with `regenerate_profile: false`; `reference_basis: spec-only` on screen 1 accepted as normal
- [ ] (§7) Any later profile regeneration preserved the `## Design Direction` section verbatim
- [ ] `not_applicable` / `source_unavailable` terminations handled per §3 (no invented design system)
