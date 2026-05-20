# 언인스톨 — 수동 제거

[← README로 돌아가기](../../README_KO.md)

> **자동 언인스톨러 사용을 권장합니다** — [README의 언인스톨 섹션](../../README_KO.md#언인스톨) 참고. 자동 언인스톨러를 사용할 수 없는 환경에서만 이 수동 절차를 따르세요.

## 1. CLAUDE.md 마커 블록 제거

```bash
grep -n "cc-baseline" ~/.claude/CLAUDE.md
# <!-- BEGIN cc-baseline --> ... <!-- END cc-baseline --> 블록 삭제
```

## 2. memory 파일 제거

```bash
chmod 755 ~/.claude/memory/
rm ~/.claude/memory/all_session_basic_rules.md
rm ~/.claude/memory/doc_structure_rules.md
rm ~/.claude/memory/phase_start.md
rm ~/.claude/memory/phase_end.md
rm ~/.claude/memory/reference_e2e_manager_guide.md
rm ~/.claude/memory/reference_subagent_boundary.md
rm ~/.claude/memory/reference_doc_writing_style.md
rm ~/.claude/memory/feedback_skill_description_budget.md
rm ~/.claude/memory/reference_security_auditor_protocol.md
rm ~/.claude/memory/reference_code_reviewer_protocol.md
```

## 3. 에이전트, 커맨드, 스크립트 제거

```bash
rm ~/.claude/agents/e2e-tester.md
rm ~/.claude/agents/security-auditor.md
rm ~/.claude/agents/code-reviewer.md
rm ~/.claude/commands/plan.md
rm ~/.claude/commands/clean.md
rm ~/.claude/commands/open-browser.md
rm ~/.claude/commands/check-log.md
rm ~/.claude/scripts/audit-report.js
```

## 4. settings.json에서 훅 제거

`~/.claude/settings.json`을 열고 아래 `statusMessage` 값을 가진 훅을 삭제:
- `"Loading session rules..."`
- `"Applying cc-baseline path policy..."`
- `"Loading E2E test guide..."`
- `pgrep -f '@anthropic-ai/claude-code'`가 포함된 SessionEnd 항목

## 5. MCP 서버 제거 (선택)

`~/.claude.json`의 `mcpServers`에서 `playwright-test-1` ~ `playwright-test-5` 삭제.
