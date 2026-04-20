EnterPlanMode로 전환. 작성 전 `~/.claude/memory/doc_structure_rules.md` 읽을 것.

phase 포함 시 각 phase 첫/마지막 스텝에 아래 포함:
- 첫 스텝: `Read ~/.claude/memory/phase_start.md and execute`
- 마지막 스텝: `Read ~/.claude/memory/phase_end.md and execute`

구현 변경이 포함된 플랜 작성 시: 플랜 마지막에 E2E 테스트 시나리오 섹션 추가. 형식은 `~/.claude/memory/reference_e2e_manager_guide.md` 입력 형식 참조.
