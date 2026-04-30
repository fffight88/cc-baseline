---
name: Sub-agent Boundary and Return Format Guide
description: Read before calling Agent/sub-agents — role boundaries, output constraints, return format templates by task type
type: reference
---

**Trigger:** Always read this document immediately before calling an Agent tool (sub-agent), and include the rules below in the prompt.

**Why:** When a sub-agent's intermediate logs, full file content, or verbose process narration flows into the orchestrator's context, irrelevant information pollutes the orchestrator's judgment and wastes context budget.

---

## 1. Common Boundary Clause (include in every sub-agent prompt)

Always append the following block at the end of every sub-agent prompt:

```markdown
## Output Constraints (strictly enforced)
- ❌ No pasting full file content, raw command output, or intermediate logs
- ❌ No process narration ("I searched X and found Y and confirmed Z")
- ❌ No role scope violations (modifying production code, restarting servers, changing other files)
- ✅ Fill in only the designated return format fields below
- ✅ If additional information is needed, ask the orchestrator instead of expanding arbitrarily
- Length limit: under 500 characters (trim to essentials if exceeded)
```

---

## 2. Return Format Templates by Task Type

When calling a sub-agent, explicitly specify one of the templates below as the **"return format"**.

### 🔍 Exploration / Research (Explore)
```
Return format:
- File path: <path>
- Line number: <line>
- Key excerpt: <one line, under 20 words>
- Further exploration needed: Y/N
```
Limit results to 5 or fewer.

### 🛠 Implementation
```
Return format:
- Modified file list: <paths listed>
- Per-file change summary: <one line each>
- Build/test result: success/failure + 1-line error message
- Unresolved issues: present/none
```
No pasting full code or diffs (orchestrator reads directly).

### ✅ Verification
```
Return format:
- Result per verification item: [item name] PASS/FAIL
- On failure, cause: <one line>
- Overall verdict: PASS/FAIL
```
No intermediate logs or raw command output.

### 📊 Analysis
```
Return format:
- Conclusion: <under 2 lines>
- Rationale: <up to 3 bullets>
- Confidence: high/medium/low + one-line reason
```

---

## 3. Explicit Permission Scope (include in prompt)

State the following at the beginning of the sub-agent prompt:

```markdown
## Role Scope
- Allowed: <list specifically — file reading, grep, specific directory exploration, etc.>
- Forbidden: <list specifically — modifying production code, restarting servers, external API calls, commits, etc.>
```

---

## 4. Summary: Pre-call Checklist

- [ ] Did you specify role scope (allowed/forbidden)?
- [ ] Did you designate a return format template matching the task type?
- [ ] Did you include the common boundary clause (output constraints block) at the end of the prompt?
- [ ] Did you state the length limit?
