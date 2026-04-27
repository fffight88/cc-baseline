---
name: 문서 작성 구조 원칙
description: 모든 문서 작성 시 적용할 구조 규칙 — 상단 요약, 하단 체크리스트, DO/DON'T 형식
type: feedback
---

모든 문서(CLAUDE.md, memory 파일, plan, 사용자 요청 문서 등)를 작성·수정할 때 아래 구조를 따를 것.

- ✅ DO: 문서 상단에 `⚡ 핵심 규칙 요약` DO/DON'T 표 배치 (삼중 반복: 상단 요약 → 본문 → 하단 체크리스트)
- ✅ DO: 작업 완료 직전 체크리스트를 하단에도 배치 (결과 검증 강제 + 중요 내용 망각 방지)
- ✅ DO: 규칙은 DO/DON'T 형식으로 명확하게 대비

## 플랜 작성 시 추가 규칙

구현 변경이 포함된 플랜(Plan)을 작성할 때 반드시 상단 메타 블록을 포함할 것:

```markdown
## 메타
- Security Impact: Yes | No | Unknown
- Code Quality Impact: Yes | No | Unknown
- 사유: <1줄, Yes/Unknown인 경우 어떤 영역이 영향받는지>
```

- ✅ DO: `Security Impact: Yes` 또는 `Unknown`이면 플랜 완료 후 security-auditor 자동 트리거
- ✅ DO: `Code Quality Impact: Yes` 또는 `Unknown`이면 플랜 완료 후 code-reviewer 자동 트리거
- ✅ DO: 두 필드가 모두 Yes/Unknown이면 두 에이전트를 단일 메시지에서 병렬 호출
- ✅ DO: `Security Impact: No` / `Code Quality Impact: No`이면 해당 감사 생략
- ❌ DON'T: `Security Impact` 또는 `Code Quality Impact` 필드 없이 구현 플랜 제출 금지
