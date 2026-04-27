---
name: 코드 리뷰 에이전트 운용 프로토콜
description: code-reviewer 에이전트 자동 트리거 조건, 호출 프로토콜, 루프 관리, decision_type별 후속 처리 가이드
type: reference
---

## ⚡ 핵심 규칙 요약

- ✅ DO: `Code Quality Impact: Yes/Unknown` → 플랜 완료 후 code-reviewer 자동 호출
- ✅ DO: `Security Impact: Yes/Unknown`도 동시에 충족 시 security-auditor와 **단일 메시지에서 병렬 호출**
- ✅ DO: `regenerate_profile: true`는 key_files 대규모 변경 후에만 사용
- ❌ DON'T: 감사 시작·완료 시점에 알림 발동 금지 (design/business 이슈 인터뷰 직전에만)
- ❌ DON'T: code-reviewer에 보안 취약점·시크릿 점검 요청 금지 (security-auditor 영역)

---

## 1. 자동 트리거 조건

플랜 파일 상단 `## 메타` 블록의 `Code Quality Impact` 필드 기준:

- `Yes` 또는 `Unknown` → 해당 플랜 완료 후 code-reviewer 자동 호출
- `No` → 리뷰 생략
- 필드 없음 → `Unknown`으로 간주하여 자동 호출

**명시적 요청:** 사용자가 "코드리뷰/품질점검" 명시 시 즉시 호출.

---

## 2. 호출 프로토콜

본체가 code-reviewer를 Agent 도구로 호출할 때 프롬프트 구조:

```
plan_paths:
  - <absolute path 1>
target_dir: <리뷰 대상 프로젝트 루트 절대 경로>
iteration: 1
previous_report_path: null  # 재검토 시 직전 리포트 경로
regenerate_profile: false   # key_files 대규모 변경 후에만 true

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
- profile_status: generated | cached | regenerated
- next_action: done | self_fix | user_interview
```

### 병렬 호출 (security-auditor와 동시)

`Security Impact: Yes/Unknown` + `Code Quality Impact: Yes/Unknown` 모두 해당 시:

```
# 단일 메시지에서 두 에이전트 동시 호출 (리포트 파일명 충돌 없음)
# security-auditor → .cc-audits/<slug>/iter-<n>.md
# code-reviewer    → .cc-audits/<slug>/code-review-iter-<n>.md
```

---

## 3. 루프 관리

- **종료 A (성공)**: CRITICAL·HIGH = 0 → 즉시 종료. MEDIUM/LOW는 최종 보고에 포함.
- **종료 B (한계 도달)**: 3회 수행 → 잔존 이슈와 함께 사용자 보고 후 중단.
- 매 루프마다 플랜 파일 하단 `## 코드 리뷰 이력` 섹션에 iteration 카운트 기록.

```markdown
## 코드 리뷰 이력
- code-review-iter-1: 2026-04-27 / critical=0 high=2 medium=1 / profile_status=generated / next_action=self_fix
- code-review-iter-2: 2026-04-27 / critical=0 high=0 medium=1 / profile_status=cached / next_action=done
```

---

## 4. decision_type별 후속 처리

| decision_type | 후속 처리 |
|---------------|-----------|
| `auto` | 본체가 코드 수정 후 재검토 요청 |
| `design` | 사용자 인터뷰 (AskUserQuestion) 후 설계 변경 |
| `business` | 사용자 인터뷰 (AskUserQuestion) 후 정책 결정 |

---

## 5. 인터뷰 직전 알림

`design` 또는 `business` 이슈가 1건 이상 있고, AskUserQuestion 직전에 반드시 실행:

```bash
osascript -e 'display notification "코드리뷰: 사용자 결정 필요 (N건)" with title "Claude Code" sound name "Glass"'
```

N에는 실제 design+business 이슈 건수를 대입.

---

## 6. 리포트 경로 규칙

```
<target_dir>/.cc-audits/<plan-slug>/code-review-iter-<n>.md
<target_dir>/.cc-audits/<plan-slug>/code-review-iter-<n>.json
<target_dir>/.cc-audits/project-patterns.md   # 공통 프로파일 (여러 플랜 간 공유)
```

`plan-slug`는 플랜 파일명(확장자 제외). 예: `wondrous-bubbling-newell`

---

## 7. 프로파일 캐시 관리

| 상황 | `regenerate_profile` 값 | 이유 |
|------|------------------------|------|
| 일반 실행 | `false` (기본) | 해시 기반 자동 감지로 충분 |
| 패키지 대규모 업그레이드 | `true` | key_files 해시 변경 전 강제 갱신 |
| 아키텍처 리팩토링 후 | `true` | 컨벤션 전면 변경 반영 |
| `project-patterns.md` 손상·삭제 | `true` | 재생성 강제 |
