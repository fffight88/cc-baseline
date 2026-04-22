EnterPlanMode로 전환. 작성 전 `~/.claude/memory/doc_structure_rules.md` 읽을 것.

phase 포함 시 각 phase 첫/마지막 스텝에 아래 포함:
- 첫 스텝: `Read ~/.claude/memory/phase_start.md and execute`
- 마지막 스텝: `Read ~/.claude/memory/phase_end.md and execute`

구현 변경이 포함된 플랜 작성 시: 플랜 마지막에 E2E 테스트 시나리오 섹션 추가. 형식은 `~/.claude/memory/reference_e2e_manager_guide.md` 입력 형식 참조.

플랜에 구현 변경이 포함된 경우 반드시 아래 `## 메타` 블록을 플랜 상단(⚡ 핵심 규칙 요약 아래)에 포함:

```markdown
## 메타
- Security Impact: Yes | No | Unknown
- 사유: <1줄, Yes/Unknown인 경우 어떤 영역이 영향받는지>
```
