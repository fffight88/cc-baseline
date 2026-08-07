# Bare-Harness A/B Test — Measurement Protocol

Decides, with evidence rather than plausibility, which layers of cc-baseline still earn their cost on Opus 5.

## Meta
- **Security Impact:** No — no product code changes; the protocol only installs/uninstalls cc-baseline via supported flags and edits two reversible files.
- **Code Quality Impact:** No — no source changes. Deliverable is a document plus recorded measurements.
- **UI Impact:** No.
- **Reason:** This is a measurement protocol. Any deletion it justifies is a separate plan.

---

## ⚡ Key Rules Summary

| ✅ DO | ❌ DON'T |
|---|---|
| Run **three** arms (full / rules-off / bare) | Run two arms — A-vs-bare cannot separate "rules helped" from "tools helped" |
| Use **reverted real commits** as tasks, original commit = ground truth | Invent tasks with no objective correct answer |
| Check out the **parent** commit so the answer is not in history | Run in a clone where the future commit is visible |
| Fix the prompt as a file, paste **byte-identical** into every run | Retype the prompt per run |
| Write the decision rule **before** the first run | Decide what counts as "better" after seeing results |
| Grade diffs **blind**, in a separate session, arm labels stripped | Grade while knowing which arm produced which diff |
| Counterbalance arm order across repetitions | Run A,A,A then B,B,B then C,C,C |
| Snapshot `~/.claude` before starting | Rely only on `.cc-baseline-backup/` |
| Report "no signal" as a real result | Keep adding runs until a preferred arm wins |

---

## 1. Why three arms

The video's step 1 ("하네스 끄고 한번 돌려보라") is a two-arm test. Applied here it is **confounded**: cc-baseline bundles two unrelated things, and uninstalling removes both at once.

| Layer | Contents | The claim under test |
|---|---|---|
| **Rule layer** | Always-loaded chain — `CLAUDE.md` loader + SessionStart injection of `MEMORY.md` + `all_session_basic_rules.md` (9,946 bytes ≈ 2,500 tokens/session) | Video says: redundant on Opus 5, delete |
| **Tool layer** | 4 agents, 5 Playwright MCP servers, semgrep/gitleaks/trivy, `/clean` `/plan` `/check-log` `/open-browser`, hooks | Video says: keep — these produce new evidence |

A two-arm test (full vs. nothing) that shows "nothing is better" cannot tell you *which* layer to drop. The proposal in the analysis was specifically **drop rules, keep tools** — that is Arm B, and without it the test cannot confirm or refute the actual proposal.

| Arm | Rule layer | Tool layer | Role |
|---|---|---|---|
| **A — full** | on | on | current state, baseline |
| **B — rules-off** | off | on | **the proposal under test** |
| **C — bare** | off | off | floor; catches "the tools weren't helping either" |

**Falsifiability note:** the analysis claimed measuring gates (e2e-tester, publisher, scanners) keep their value while the re-reading gate (code-reviewer) does not. Task T3 below is designed so that claim can **fail** — if Arm C catches the seeded defect as often as Arm A, the tool layer does not earn its keep either, and the recommendation was wrong.

---

## 2. Building the arms

Snapshot first — this is the rollback that does not depend on cc-baseline behaving correctly:

```bash
tar czf ~/claude-harness-snapshot-$(date +%Y%m%d).tgz -C ~ .claude
```

| Arm | Procedure | Restore |
|---|---|---|
| **A** | `npx --yes github:fffight88/cc-baseline --yes` → confirm `--doctor` is 10 ok / 0 fail | — |
| **B** | From A: (1) delete the `session-start-load-rules` hook from `~/.claude/settings.json`; (2) blank the marker block body in `~/.claude/CLAUDE.md`. **Leave `~/.claude/memory/*.md` on disk.** | re-run A's install |
| **C** | `npx --yes github:fffight88/cc-baseline --uninstall --yes` (omit `--remove-scanners` — scanner binaries are machine-global and irrelevant to the comparison) | re-run A's install |

- ✅ DO: In Arm B leave the memory files on disk. Agents like code-reviewer **explicitly read** `MEMORY.md` / `all_session_basic_rules.md` / `doc_structure_rules.md` in their own pre-load step. Deleting the files would break the agents and silently turn Arm B into a tool-layer test too.
- ✅ DO: Verify each arm before the first run of that block — `--doctor` for A, and for B confirm no rules text appears in the session's opening context.
- ❌ DON'T: Edit `~/.claude/memory/*.md` to build Arm B. The PreToolUse hook blocks it, and the always-on chain is switched off at the loader/hook level anyway.
- ❌ DON'T: Switch arms mid-session. One arm per session, always a fresh session.

**Faster alternative to verify before relying on it:** if this Claude Code version honours a config-directory override env var, three pre-built directories can be swapped per run instead of install/uninstall cycles. I have not verified that this version supports it — check before designing the run schedule around it; the install/uninstall path above is known to work.

---

## 3. Tasks

Built from **reverted real commits**, so the original commit is the ground truth. Work in a throwaway clone, checked out at the commit's **parent**, so the answer is not present in history.

```bash
git clone git@github.com:fffight88/cc-baseline.git /tmp/ab-test && cd /tmp/ab-test
git checkout <parent-sha>          # answer commit is now in the future, not in log
git switch -c run-<arm>-<n>
```

| ID | Source commit | Size | What it exercises | Ground truth |
|---|---|---|---|---|
| **T1** | `85da2a7` fix(clean): macOS portability | 1 file, small | The video's own trigger scenario — a small fix where harness overhead can dominate | the commit diff |
| **T2** | `40dbf89` fix(install): dedup across reinstalls | 9 files, medium | Multi-file work + the plan/agent pipeline | the commit diff |
| **T3** | `ab-test-ui` fixture (built, verified) | 4 seeded defects | Whether the measuring gates actually catch what they claim | `ab-test-ui/DEFECTS.md` |

**T3 detail.** The fixture lives at `../ab-test-ui` — a zero-dependency admin screen with four planted defects, each reachable by exactly one class of gate:

| ID | Defect | Only catchable by |
|---|---|---|
| D1 | `ReferenceError` on click (module-scoped fn behind inline `onclick`) | runtime invariant — e2e-tester §0 (A) |
| D2 | Dead Reset button, **silent** — no console error | dead-control sweep — e2e-tester §0 (B) |
| D3 | Unstyled `thead` misaligned against `tbody` | render-compare — publisher §9 |
| D4 | Unescaped `innerHTML` XSS sink, **no runtime symptom** | source review — security-auditor |

All four were verified to manifest as described before the fixture was committed. D1–D3 are invisible to source reading; D4 is invisible to the browser, which makes it the **positive control** — an arm with security-auditor that misses D4 means the setup is broken, not the theory.

- ✅ DO: Run T3 as a **verification** task ("report every defect, fix nothing"), not a build task. The defects are pre-planted; asking an arm to build the screen would measure something else entirely.
- ✅ DO: Record *which* defect IDs each arm found. The identity is the signal; a bare count is not.
- ❌ DON'T: Run T3 against cc-baseline itself — it is a Node CLI with no UI, so publisher and e2e-tester never engage and Arm A would be denied half its harness.
- ❌ DON'T: Read `DEFECTS.md` before a run, or hint at the defect count in the prompt.

**T3's own limitation:** A-vs-C here is close to definitional — Arm C has no Playwright MCP, so it cannot open a browser and misses D1–D3 by construction. The informative comparison for T3 is **A vs B**: same tools, rule layer removed. If B finds what A finds, the always-loaded rule layer contributed nothing to gate effectiveness.

Prompts live in `prompts/T1.txt`, `T2.txt`, `T3.txt` and are pasted verbatim. Write them once, before any run.

---

## 4. Measurements

Record per run, into one CSV row:

| Field | Source | Notes |
|---|---|---|
| `arm`, `task`, `rep`, `date` | — | |
| `wall_min` | stopwatch, first prompt → final answer | excludes your own reading time |
| `cost_usd`, `tokens_in/out` | `/cost` at session end | **verify `/cost` exists in your version before run 1**; if absent, fall back to turn count only |
| `turns`, `tool_calls` | transcript count | |
| `agents_invoked` | which of the 4 ran | expected 0 in Arm C |
| `quality_0_5` | blind grading, §5 | filled in later, not during the run |
| `defect_caught` | T3 only | yes/no |
| `notes` | free text | anything that would change interpretation |

---

## 5. Blind grading

Execution cannot be blinded — you know which arm you installed. Grading can be, and that is where the bias would do the most damage.

1. After all runs, export each run's final diff to `graded/<random-id>.diff`; keep the id→arm map in a file you do not open.
2. In a **fresh session**, grade every diff against the ground-truth commit on this fixed rubric:

| Score | Meaning |
|---|---|
| 5 | Solves the real cause; equal to or better than the original commit |
| 4 | Solves it; minor stylistic divergence |
| 3 | Works but misses an edge case the original handled |
| 2 | Partial — one of several sub-problems fixed |
| 1 | Plausible but wrong |
| 0 | Broken or does not run |

3. Only then join on the id→arm map.

- ✅ DO: Fix this rubric before run 1.
- ❌ DON'T: Adjust the rubric after seeing diffs.

---

## 6. Run schedule and what it can detect

Counterbalanced so your own prompting drift does not align with arm order:

```
rep 1:  A B C
rep 2:  B C A
rep 3:  C A B
```

| Scope | Runs | Detects |
|---|---|---|
| **Minimum viable** — T1 only | 9 | Large effects only (≥2×). Sufficient for the video's claim, which is a 7× effect (20 min → 2.5 h) |
| **Full** — T1 + T2 | 18 | Same, across two task sizes |
| **+ T3** | 27 | Adds the tool-layer claim — fixture ready at `../ab-test-ui` |

**Honest power statement:** n=3 per cell detects large effects and nothing else. If arms land within ~20% of each other, the correct conclusion is **"no measurable difference"** — not "run more until one wins." That outcome is still decisive; see the decision rule.

---

## 7. Decision rule — write this down before running

| Result | Action |
|---|---|
| B quality ≥ A, B cheaper/faster | **Proposal confirmed.** Delete the rule layer (v2.0 major). |
| A quality > B by ≥1 rubric point | Rule layer earns its keep. Bisect *which* rule: re-run B with one rule restored at a time. Do not keep all 11 on one rule's evidence. |
| A ≈ B ≈ C on quality, A/B slower | Tool layer is not paying for itself on these tasks either — **re-examine before deleting**; more likely the tasks failed to engage it (see T3 note) than that the agents are worthless. |
| All three within ~20% | No signal. Decide on **maintenance cost alone**, and the default is deletion — an unused harness still has to be maintained, which is the video's "비슷하면 비용만 쓰는 중". |
| T3: A catches defect, C misses | Tool layer confirmed. Keep agents; the deletion plan touches rules only. |
| T3: C catches it too | Tool-layer claim refuted. The analysis's "측정기는 남기고 재독기는 줄인다" cut line was wrong — redo the analysis. |

---

## 8. Known confounders

| Confounder | Control |
|---|---|
| Model version drift mid-test | Pin Opus 5 for every run; abort and restart the block if it changes |
| Starting-state drift | `git checkout <parent-sha>` fresh per run; never reuse a dirty tree |
| Context carryover | New session per run — `/clear` is not sufficient |
| Prompt wording drift | Paste from `prompts/*.txt`, never retype |
| Your expectancy | Blind grading (§5); accept that execution is unblinded |
| Order/drift effects | Counterbalanced schedule (§6) |
| Answer leakage via git history | Check out the **parent** commit, verify with `git log --oneline -3` |
| Task doesn't engage the harness | Deliberate — that is what T3 exists to prevent |

---

## ✅ Checklist

**Before run 1**
- [ ] `~/.claude` snapshot tarball created and its path recorded
- [ ] `prompts/T1.txt`, `T2.txt` (and `T3.txt` if in scope) written and frozen
- [ ] `/cost` availability verified, or the fallback metric chosen
- [ ] Grading rubric (§5) and decision rule (§7) written down — **before** any result exists
- [ ] Throwaway clone at the parent SHA; `git log` confirms the answer commit is absent
- [ ] Scope chosen (9 / 18 / 27 runs) with the time cost accepted
- [ ] T3: `ab-test-ui` cloned/reset clean, `node server.js` reachable, `DEFECTS.md` unopened

**Per run**
- [ ] Correct arm built and verified (`--doctor` for A; no rules text in opening context for B)
- [ ] Fresh session; clean tree at the parent SHA
- [ ] Prompt pasted verbatim from file
- [ ] Row appended to the CSV; diff exported under a random id

**After all runs**
- [ ] Blind grading finished before the id→arm map is opened
- [ ] Result matched against §7 — including the "no signal" and "claim refuted" branches
- [ ] Arms restored (`--yes` reinstall) and `--doctor` back to 10 ok / 0 fail
- [ ] Findings written up; any deletion raised as a **separate** plan, not executed here
