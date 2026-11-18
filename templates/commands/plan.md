Switch to EnterPlanMode. Read `~/.claude/memory/doc_structure_rules.md` before writing.

Before drafting, look up what is already built (`~/.claude/memory/reference_wiki.md` §4):
- `docs/wiki/` exists → run `node ~/.claude/scripts/wiki.js find <term>` for the screens, components and APIs the task touches, and read the hits. A hit that is not `ok` (`stale` / `broken` / `unstamped`) is refreshed first — re-read its files, update the page, `wiki.js stamp <slug>`. Name the screens and components to reuse in the plan's Context. Grep the code only for what the wiki does not answer.
- No `docs/wiki/` but the project already has screens → suggest `/wiki init` in one line and go on without it.

When the plan includes phases, add the following to the first and last steps of each phase:
- First step: `Read ~/.claude/memory/phase_start.md and execute`
- Last step: `Read ~/.claude/memory/phase_end.md and execute`

When the plan includes implementation changes, always include the following `## Meta` block at the top of the plan (below ⚡ Key Rules Summary):

```markdown
## Meta
- Security Impact: Yes | No | Unknown
- Code Quality Impact: Yes | No | Unknown
- UI Impact: Yes | No | Unknown
- Behavior Impact: Yes | No | Unknown
- Reason: <1 line — which areas are affected if Yes/Unknown>
```

`Behavior Impact` = the change alters what a user can do or what they see as a result (new/changed flow, rule, error, output). Pure refactors, docs and build config with no user-visible change are `No`.

When `Behavior Impact: Yes` or `Unknown`: read `~/.claude/memory/reference_tc_authoring.md`. Plan mode writes no files, so the TCs are drafted **in the plan** and written to disk right after approval:
1. **Draft (plan mode)** — write the user actions and TCs as the TC file's JSON in a `## Test Cases (draft)` section (reading the source directly for the current behavior), above it a summary table (TC ID · title · surface · readiness · expected-result count).
2. **Check the draft (plan mode)** — pipe the JSON block to the checkers, no file needed: `node ~/.claude/scripts/tc-lint.js -` and `node ~/.claude/scripts/tc-jev-check.js -` (the second does nothing without a Jev key). Fix each warning or note why it stays; put the check summary (warnings by rule, kept and why) under the table.
3. **Ask the open questions (plan mode, before ExitPlanMode)** — for every `open_questions` entry, ask with AskUserQuestion (the `default` as the first, recommended option; up to 4 per call). Record each answer in the draft: `answer` + `decided_at` on the question, a `kind: decision` source, and the affected TCs moved to `ready`. A question the user skips keeps its TCs `needs-decision` — e2e does not run them.
4. **Right after approval (first execution step)** — write the approved draft verbatim to `docs/tc/<feature>.tc.json` and the run add-on to `.cc-audits/<plan-slug>/tc-run.json`, then re-run both checks on the file (`--json` / `--out .cc-audits/<plan-slug>/tc-check.json`). Approving the plan freezes these TCs.

When the plan includes implementation changes: add an E2E section at the end of the plan. With TCs, it lists which `ready` TCs e2e will run (`ui-web` by browser, `api` with `tc-api-run.js`) and the run add-on (`tc-run.json`: `base_url`, start paths, accounts, fixtures, `readable` data files, skip reasons; `api_remote_ok: true` only if the user approves API requests to a non-loopback `base_url`) — never new steps or expected results. Failing TCs then go through the fix loop (`reference_e2e_manager_guide.md` §2-B, `tc-fix-loop.js`) until every ready TC passes. Without TCs, write the scenario in the input format of `~/.claude/memory/reference_e2e_manager_guide.md`.
