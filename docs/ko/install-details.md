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

## 프로젝트 모드 (`--project`)

`--project` 플래그로 실행하면 위 표의 모든 경로가 `~/.claude/...` → `./.claude/...`로 바뀌고, 3개 템플릿이 프로젝트 전용 변형으로 교체됩니다:

| 템플릿 (글로벌 모드) | 템플릿 (프로젝트 모드) | 비고 |
|---|---|---|
| `templates/CLAUDE.md` | `templates/project-CLAUDE.md` | 상대경로, `{{HOME}}` 치환 없음 |
| `templates/settings-hooks.json` | `templates/settings-hooks.project.json` | `_ccBaselineId`가 `project-` prefix로 글로벌 ID와 공존; 프로젝트 메모리 대상 SessionStart + PreToolUse 경로 정책 훅 |
| `templates/mcp-servers.json` | `templates/mcp-servers.project.json` | `npx -y @playwright/mcp@latest` (머신 간 휴대성) |

18개 overwrite 파일 (memory/, agents/, commands/, scripts/audit-report.js)은 두 모드 간 바이트 단위 동일.

### JSON 병합 / 쓰기 대상 — 프로젝트 모드

| 대상 | 방식 |
|---|---|
| `./.claude/settings.json` hooks | 글로벌과 동일한 hook 병합 로직; 프로젝트 ID는 `project-` prefix 사용 |
| `./.mcp.json` | 파일 전체가 `{ mcpServers: {...} }` 형태; 기존의 비-하네스 `mcpServers` 항목은 보존 |

> **외부 바이너리** (`semgrep`, `gitleaks`, `trivy`, `@playwright/mcp`, `terminal-notifier`)는 프로젝트 모드에서도 설치 — 머신 글로벌 도구이며 에이전트가 이들 없이는 동작하지 않음. `--skip-scanners`로 건너뛰기 가능.
