---
name: Agent Pipeline / Orchestration Order
description: canonical end-to-end order of the four cc-baseline agents (publisher build → security-auditor + code-reviewer review → e2e-tester verify) and de-duplication rules
type: reference
---

## ⚡ Key Rules Summary

- ✅ DO: For a UI-bearing plan, run **publisher during execution** (it builds the UI) **before** the post-implementation audit gates
- ✅ DO: After implementation, run **security-auditor + code-reviewer in parallel** (single message) on the produced code — publisher output is included
- ✅ DO: Run **e2e-tester last**, for **functional** verification only, on the post-fix code
- ❌ DON'T: Re-check a11y / design tokens in code-reviewer or e2e-tester — publisher already verified those (its Step 5/6)
- ❌ DON'T: Start the audit gates before publisher finishes the UI (they would review half-built markup)
- ❌ DON'T: Run publisher for a non-UI plan (`UI Impact: No`) — the flow reverts to the original flat post-implementation fan-out

---

## 1. Canonical Order

The four agents form a **sequence**, not a flat fan-out, whenever a plan involves UI work:

```
/plan  (## Meta: Security Impact / Code Quality Impact / UI Impact)
   │
   ▼
EXECUTION
   ├─ [UI portion]  → publisher        (build static UI: profile → reuse-first author
   │                                     → self-check tokens/states/a11y → render+axe verify)
   │                  └─ publisher self-fix loop (visual/a11y), max 3
   └─ [logic/binding] → orchestrator wires data/events into publisher's markup
   │
   ▼
AUDIT GATES  (parallel, single message — review the produced code, publisher output included)
   ├─ security-auditor   (Security Impact: Yes/Unknown)
   └─ code-reviewer      (Code Quality Impact: Yes/Unknown)
       └─ each loops (auto→self_fix, design/business→interview), max 3 → HTML report once both done
   │
   ▼
e2e-tester   (functional interaction only — visual & a11y already covered by publisher)
   │
   ▼
done
```

**Non-UI plan**: publisher is skipped; the flow is the original `implementation → (security-auditor ∥ code-reviewer) → e2e-tester`.

---

## 2. Per-stage Trigger (Meta fields)

| Stage | Agent | Trigger | When it runs |
|-------|-------|---------|--------------|
| Build | publisher | `UI Impact: Yes/Unknown` (or explicit request / UI-natured task) | **during** execution, first for the UI portion |
| Review | security-auditor | `Security Impact: Yes/Unknown` | after implementation (incl. publisher output) |
| Review | code-reviewer | `Code Quality Impact: Yes/Unknown` | after implementation, parallel with security-auditor |
| Verify | e2e-tester | E2E scenario section in the plan | after audit gates settle (tests the post-fix code) |

See each agent's protocol: `reference_publisher_protocol.md`, `reference_security_auditor_protocol.md`, `reference_code_reviewer_protocol.md`, `reference_e2e_manager_guide.md`.

---

## 3. De-duplication Matrix (who owns what — no overlap)

| Concern | Owner | Others must NOT re-do |
|---------|-------|------------------------|
| Design-token / class-naming compliance | publisher (Step 5) | code-reviewer skips CSS class-naming nitpicks |
| UI-state coverage (empty/loading/error/…) | publisher (Step 5) | — |
| Tone & manner, render breakage | publisher (Step 6 render compare) | e2e-tester does not assert visuals |
| Runtime a11y (axe-core) | publisher (Step 6) | code-reviewer / e2e-tester skip a11y |
| Logic errors, edge cases, CLAUDE.md, conventions, dead code, async | code-reviewer | — |
| XSS / `innerHTML` / inline secrets / dependency vulns | security-auditor | — |
| Functional interaction (click→result, nav, form submit, console-clean) | e2e-tester | publisher does not test interaction |

> publisher-authored markup/CSS **is** reviewed by the audit gates (it is still code — CLAUDE.md conventions, XSS surface, inline secrets, dead CSS apply). The gates simply do not duplicate publisher's a11y / design-token / UI-state checks.

---

## 4. Parallelism & Sequencing Rules

- publisher and the audit gates are **sequential** (publisher first) — never parallel.
- security-auditor and code-reviewer run **in parallel with each other** (single message, no report-path collision).
- e2e-tester runs **after** the audit gates settle, so it tests the post-fix code, not an intermediate state.
- The HTML report (`audit-report.js`) is generated **once**, after both audit gates complete (it merges `iter-*.json` + `code-review-iter-*.json`; publisher's `publish-iter-*.json` is a separate build record, not part of the audit HTML).

---

## 5. Report Artifacts (same `.cc-audits/<plan-slug>/` dir)

```
publish-iter-<n>.{md,json}      # publisher build record
iter-<n>.{md,json}              # security-auditor
code-review-iter-<n>.{md,json}  # code-reviewer
report.html                     # merged audit HTML (security + code-review)
.cc-audits/design-profile.md    # shared design-system profile (publisher, cross-plan)
.cc-audits/project-patterns.md  # shared code-convention profile (code-reviewer, cross-plan)
```

---

## ✅ Checklist (orchestrator, per UI-bearing plan)

- [ ] `UI Impact` present in plan `## Meta`; if Yes/Unknown, UI portion delegated to publisher
- [ ] publisher finished (self-fix loop closed) **before** invoking the audit gates
- [ ] security-auditor + code-reviewer called in parallel on the produced code (publisher output included)
- [ ] No a11y / design-token / UI-state re-check inside the audit gates or e2e-tester
- [ ] e2e-tester run last, functional scenarios only, after gates settle
- [ ] HTML report generated once after both gates complete
