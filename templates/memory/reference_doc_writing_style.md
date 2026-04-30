---
name: Reference Document Writing Style Guide
description: Structure principles to follow when writing/editing CLAUDE.md, MEMORY.md, and reference documents (cost tiers, parallel reads, 7-technique guide)
type: feedback
---

Follow these principles when writing or editing global/project CLAUDE.md and their reference documents.

**Why:** In the allviacl project (2026-04-08), applying 7 prompt engineering techniques across 17 reference documents confirmed that cost hints are only effective when embedded in auto-loaded files. Extending this principle globally for consistency.

**How to apply:**

**Cost-awareness Principles (when writing CLAUDE.md · MEMORY.md)**
- ✅ DO: Include a **scale/cost tier** column in trigger tables (🟢 low/<150 lines | 🟡 medium/150–350 lines | 🔴 high/>350 lines)
- ✅ DO: For 🔴 high-cost documents, explicitly state a partial-read strategy (`offset/limit`)
- ✅ DO: For documents commonly read together, explicitly show a "multiple Read calls simultaneously in a single message" example
- ❌ DON'T: Never put cost hints inside reference documents (circular logic — you'd have to open it to see them)
- ❌ DON'T: Never write long guides directly in MEMORY.md body (auto-loaded, so it increases cost every conversation)

**Notes**
- ❌ DON'T: Never claim to apply CoT stripping to static documents (it is an AI response generation technique, not a document structure technique)
