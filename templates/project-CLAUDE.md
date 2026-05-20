# Project-local Claude Instructions

This project has cc-baseline installed in project-local mode. The hooks
in `./.claude/settings.json` load the project memory automatically at
session start, so anyone who clones this repo inherits the same
behavior rules and skills as the original author.

## Load Project Memory

Read these files when starting a session on this project:

- `./.claude/memory/MEMORY.md`
- `./.claude/memory/all_session_basic_rules.md`

## Load Document Structure Rules

When writing or editing any document (plans, memory files, user-requested docs, etc.), read:

- `./.claude/memory/doc_structure_rules.md`
