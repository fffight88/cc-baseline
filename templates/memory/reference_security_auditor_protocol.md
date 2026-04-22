---
name: 보안감사 에이전트 운용 프로토콜
description: security-auditor 에이전트 자동 트리거 조건, 호출 프로토콜, 루프 관리, decision_type별 후속 처리 가이드
type: reference
---

## 1. 자동 트리거 조건

플랜 파일 상단 `## 메타` 블록의 `Security Impact` 필드 기준:

- `Yes` 또는 `Unknown` → 해당 플랜 완료 후 security-auditor 자동 호출
- `No` → 감사 생략
- 필드 없음 → `Unknown`으로 간주하여 자동 호출

**명시적 요청:** 사용자가 "보안점검/보안감사" 명시 시 즉시 호출.

## 2. 호출 프로토콜

본체가 security-auditor를 Agent 도구로 호출할 때 프롬프트 구조:

```
plan_paths:
  - <absolute path 1>
target_dir: <감사 대상 프로젝트 루트 절대 경로>
iteration: 1
previous_report_path: null  # 재감사 시 직전 리포트 경로
project_type_hint: <선택, 본체 추정 유형>

## 출력 제약 (반드시 준수)
- ❌ 파일 전문, 명령 출력 원본, 중간 로그 붙여넣기 금지
- ❌ 과정 서술 금지
- ❌ 역할 범위 이탈 금지
- ✅ 아래 반환 형식 필드만 채워서 반환
- 길이 상한: 500자 이내

반환 형식:
- 리포트 경로 (md): <abs path>
- 리포트 경로 (json): <abs path>
- Summary: critical=N / high=N / medium=N / low=N
- next_action: done | self_fix | user_interview
```

## 3. 루프 관리

- **종료 A (성공)**: CRITICAL·HIGH = 0 → 즉시 종료. MEDIUM/LOW는 최종 보고에 포함.
- **종료 B (한계 도달)**: 3회 수행 → 잔존 이슈와 함께 사용자 보고 후 중단.
- 매 루프마다 플랜 파일 하단 `## 감사 이력` 섹션에 iteration 카운트 기록.

```markdown
## 감사 이력
- iter-1: 2026-04-22 / critical=0 high=2 medium=3 / next_action=self_fix
- iter-2: 2026-04-22 / critical=0 high=0 medium=2 / next_action=done
```

## 4. decision_type별 후속 처리

| decision_type | 후속 처리 |
|---------------|-----------|
| `auto` | 본체가 코드 수정 후 재감사 요청 |
| `design` | 사용자 인터뷰 (AskUserQuestion) 후 설계 변경 |
| `business` | 사용자 인터뷰 (AskUserQuestion) 후 정책 결정 |

## 5. 인터뷰 직전 알림

`design` 또는 `business` 이슈가 1건 이상 있고, AskUserQuestion 직전에 반드시 실행:

```bash
osascript -e 'display notification "보안감사: 사용자 결정 필요 (N건)" with title "Claude Code" sound name "Glass"'
```

N에는 실제 design+business 이슈 건수를 대입.

## 6. 리포트 경로 규칙

```
<target_dir>/.cc-audits/<plan-slug>/iter-<n>.md
<target_dir>/.cc-audits/<plan-slug>/iter-<n>.json
```

`plan-slug`는 플랜 파일명(확장자 제외). 예: `iridescent-swinging-wave`
