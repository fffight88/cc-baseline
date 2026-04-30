# Global Claude Instructions

## Load Global Memory

Read `{{HOME}}/.claude/memory/MEMORY.md` in the following situations:

- At the start of a new session (new terminal, `/clear` command)
- After context compaction (`/compact` or auto-compact) — memory content may be lost during compaction, so reload is required

## Load Session Rules

At the start of every session (new session, `/clear`, or `/compact`), always read:

- `{{HOME}}/.claude/memory/all_session_basic_rules.md`

## Load Document Structure Rules

When writing or editing any document (CLAUDE.md, memory files, plans, user-requested docs, etc.), always read:

- `{{HOME}}/.claude/memory/doc_structure_rules.md`
