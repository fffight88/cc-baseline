---
name: Core Rules for Every Session
description: Essential behavior rules that must be applied every session regardless of project
type: feedback
---

## 1. Response Language

Always respond in the same language the user uses. Technical terms such as class names, method names, and library names may remain in their original form.

---

## 2. Obligation to Disclose Uncertainty

Always explicitly express anything that cannot be confirmed or verified.

- ✅ DO: State uncertainty explicitly — "I cannot confirm this", "This is my assumption", etc.
- ✅ DO: When reporting task completion, always include **list of changed files + risk factors**
- ✅ DO: Never report "complete" if build, test, or other verification gates have not passed
- ❌ DON'T: Never present guesses, assumptions, or inferences as confirmed facts — in long or short sentences, or in prose form

---

## 3. Parallel Reads First

When a task requires multiple files, perform all reads in parallel before any writes or executions.

- ✅ DO: Issue multiple Read calls simultaneously in a single message to collect all at once
- ❌ DON'T: No serial read→write→read→write patterns

---

## 4. Minimal Edit Principle

Never make code changes outside the requested scope.

- ✅ DO: Focus only on the requested feature/bugfix
- ❌ DON'T: No refactoring, naming unification, import reordering, or arbitrary replacement with "a better way"
- Exception: if you find an obvious bug within the requested scope, notify the user and ask whether to fix it

---

## 5. Follow Existing Code Patterns and Style

Follow the existing patterns and style within the same module (package, directory).

- ✅ DO: Read 1–2 similar files in the same directory before writing new code to understand patterns
- ✅ DO: Preserve existing naming conventions, error handling style, logging style, and return type structures
- ❌ DON'T: No arbitrary changes in the name of "a better way" or "modern convention"

---

## 6. Never Commit .claude/ to Git

The `.claude/` folder must never be committed to git in any project.

- ✅ DO: `git add --all -- ':!.claude'`
- ❌ DON'T: `git add -A`, `git add .`, `git add .claude/` are forbidden
- Verify: before committing, run `git status` and confirm no `.claude/` files are staged

---

## 7. Stop Server After Task Completion

If you started a server, always stop it when the task is done.

- ✅ DO: Run `/clean` after task completion (bulk cleanup of orphan processes)
- ❌ DON'T: Never report "server stopped" without running `/clean`
- ❌ DON'T: Never leave a server running without explicit instruction ("I'll leave the server running")

---

## 8. Check Recent Git Log Before Editing

Before modifying shared modules, config files, or core logic files, run `git log -3 -- <filepath>` to review recent change history.

- ✅ DO: If there is a recent commit by someone else, notify the user and confirm intent before proceeding
- ❌ DON'T: Never edit a shared file without checking history first

---

## 9. Notify Before Security Audit / Code Review Interview

When a security-auditor or code-reviewer report contains 1 or more issues with `decision_type: design` or `business`, and just before the orchestrator starts an interview via AskUserQuestion, send a notification using the Bash command below:

```bash
MSG="Security audit: user decision required (N issues)"  # replace N with actual design+business count
if command -v terminal-notifier >/dev/null 2>&1; then
  terminal-notifier -title "Claude Code" -message "$MSG" -sound Glass
elif [ "$(uname)" = "Darwin" ]; then
  osascript -e "display notification \"$MSG\" with title \"Claude Code\" sound name \"Glass\"" \
    || osascript -e "display dialog \"$MSG\" with title \"Claude Code\" buttons {\"OK\"} default button \"OK\""
elif command -v notify-send >/dev/null 2>&1; then
  notify-send "Claude Code" "$MSG"
fi
```

- ✅ DO: Trigger only immediately before the interview when `design` / `business` issues are present
- ❌ DON'T: Never trigger at audit start or audit completion
- ❌ DON'T: Never trigger when only `auto` issues are present

---

## 10. Memory Path Distinction (Global vs Project)

- ✅ DO: Save project-specific progress and decision history to the auto-memory path in the system prompt (`~/.claude/projects/<project-slug>/memory/`)
- ✅ DO: Keep only cross-project common rules and references in `~/.claude/memory/`
- ❌ DON'T: Never save project-scoped memory like `project_*.md` to `~/.claude/memory/`
- Verify: if `project_*` entries appear in global `MEMORY.md`, that is the wrong location

---

## 11. Global Memory Changes Must Go Through cc-baseline Templates

- ✅ DO: To change `~/.claude/memory/*.md`, edit `templates/memory/*.md` in cc-baseline → re-run `node bin/cli.js --yes` to propagate
- ❌ DON'T: Never bypass the PreToolUse hook via Bash `cat >>`, `sed -i`, or direct edit after `chmod 755`
- Why: changes made by bypassing the hook will be overwritten the next time cc-baseline is installed from templates
- Exception: direct edits to cc-baseline's own directory (`templates/`, `src/`, etc.) are normal (not hook targets)
