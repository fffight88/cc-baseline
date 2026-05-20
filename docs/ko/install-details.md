# 파일 설치 상세

[← README로 돌아가기](../../README_KO.md)

## 파일별 설치 매트릭스

| 파일 | 대상 경로 | 방식 |
|---|---|---|
| `CLAUDE.md` | `~/.claude/CLAUDE.md` | 마커 블록 병합 — 기존 내용 보존, `<!-- BEGIN cc-baseline -->` 블록만 추가/교체 |
| `memory/MEMORY.md` | `~/.claude/memory/MEMORY.md` | 마커 블록 병합 |
| `memory/all_session_basic_rules.md` | `~/.claude/memory/` (동일 이름) | 덮어쓰기 (백업 먼저 생성) |
| `memory/doc_structure_rules.md` | 〃 | 덮어쓰기 |
| `memory/phase_start.md` | 〃 | 덮어쓰기 |
| `memory/phase_end.md` | 〃 | 덮어쓰기 |
| `memory/reference_e2e_manager_guide.md` | 〃 | 덮어쓰기 |
| `memory/reference_subagent_boundary.md` | 〃 | 덮어쓰기 |
| `memory/reference_doc_writing_style.md` | 〃 | 덮어쓰기 |
| `memory/feedback_skill_description_budget.md` | 〃 | 덮어쓰기 |
| `memory/reference_security_auditor_protocol.md` | 〃 | 덮어쓰기 |
| `memory/reference_code_reviewer_protocol.md` | 〃 | 덮어쓰기 |
| `agents/e2e-tester.md` | `~/.claude/agents/e2e-tester.md` | 덮어쓰기 |
| `agents/security-auditor.md` | `~/.claude/agents/security-auditor.md` | 덮어쓰기 |
| `agents/code-reviewer.md` | `~/.claude/agents/code-reviewer.md` | 덮어쓰기 |
| `commands/plan.md` | `~/.claude/commands/plan.md` | 덮어쓰기 |
| `commands/clean.md` | `~/.claude/commands/clean.md` | 덮어쓰기 |
| `commands/open-browser.md` | `~/.claude/commands/open-browser.md` | 덮어쓰기 |
| `commands/check-log.md` | `~/.claude/commands/check-log.md` | 덮어쓰기 |
| `scripts/audit-report.js` | `~/.claude/scripts/audit-report.js` | 덮어쓰기 |

## JSON 병합 상세

| 대상 | 방식 |
|---|---|
| `~/.claude/settings.json`의 `hooks` 키 | `statusMessage` 기준 중복 제거; 하네스 훅만 교체, 사용자 훅은 유지 |
| `~/.claude.json`의 `mcpServers` 키 | `playwright-test-1~5` 추가; 동일 키의 기존 항목은 조용히 덮어씀 (cc-baseline 관리 항목) |

> **절대 건드리지 않는 것:** `settings.json`의 `env`, `model`, `effortLevel` 필드; `~/.claude.json`의 사용 통계 및 UI 상태
