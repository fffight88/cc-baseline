---
name: Document Structure Principles
description: Structure rules to apply when writing any document — top summary, bottom checklist, DO/DON'T format
type: feedback
---

Follow the structure below when writing or editing any document (CLAUDE.md, memory files, plans, user-requested docs, etc.).

- ✅ DO: Place a `⚡ Key Rules Summary` DO/DON'T table at the top of the document (triple repetition: top summary → body → bottom checklist)
- ✅ DO: Place a checklist at the bottom as well (forces result verification + prevents forgetting important items)
- ✅ DO: Express rules clearly in DO/DON'T format as contrasting pairs

## Additional Rules for Plans

When writing a Plan that includes implementation changes, always include a meta block at the top:

```markdown
## Meta
- Security Impact: Yes | No | Unknown
- Code Quality Impact: Yes | No | Unknown
- UI Impact: Yes | No | Unknown
- Reason: <1 line — which areas are affected if Yes/Unknown>
```

- ✅ DO: If `Security Impact: Yes` or `Unknown`, auto-trigger security-auditor after plan completion
- ✅ DO: If `Code Quality Impact: Yes` or `Unknown`, auto-trigger code-reviewer after plan completion
- ✅ DO: If `UI Impact: Yes` or `Unknown`, delegate the markup/CSS/component work to the publisher agent (see `reference_publisher_protocol.md`)
- ✅ DO: If both audit fields are Yes/Unknown, call both agents in parallel in a single message
- ✅ DO: If `Security Impact: No` / `Code Quality Impact: No` / `UI Impact: No`, skip the corresponding agent
- ❌ DON'T: Never submit an implementation plan without the `Security Impact`, `Code Quality Impact`, or `UI Impact` fields
