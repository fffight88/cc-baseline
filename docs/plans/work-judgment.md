# 일의 판단 기준 — 내부용·외부용 모드와 "묻지 말고 풀어서 결정"

두 가지 행동 기준을 cc-baseline에 넣는다.

1. **내부용 / 외부용 모드:** 혼자 또는 내부에서만 쓰는 일은 지금처럼 무난하고 효율적으로 한다. 돈벌이, 포트폴리오, 남 앞에서의 증명·검증, 마케팅·홍보처럼 남의 평가를 받는 일은 평균안으로는 쓸모가 없다. 그래서 그런 일에는 다른 절차를 밟는다.
2. **묻지 말고 풀어서 결정:** 막혔을 때 사용자에게 고르라고 묻지 않는다. 묻게 된 원인을 조사·분석으로 풀고 스스로 결정해 실행한 뒤 기록한다. 사용자에게 묻는 것은 세 가지뿐이다. 계정·개인정보, 사람만 아는 정보, 법·윤리 회색지대.

## ⚡ Key Rules Summary

| ✅ DO | ❌ DON'T |
|---|---|
| 일을 시작할 때 내부용인지 외부용인지 정한다. 외부 신호는 돈, 포트폴리오, 공개, 마케팅, 고객, 심사, 남에게 증명이다 | 모든 요청을 내부용처럼 무난하게 처리하기 |
| 외부용이면 평균안을 먼저 적고 버린다. 비교 대상 조사, 평가자 기준, 표준/차별 구분, 조기 검증과 접는 기준을 거친다 | "독창적으로"라는 형용사만 붙인 평균안 |
| 표준이 정답인 곳(보안, 정확성, 법, 익숙한 UI 관례)과 달라야 할 곳(문제 선택, 차별점, 메시지)을 나눈다 | 엉뚱한 곳에서 튀기 |
| 묻고 싶어지면 원인을 적고 코드·문서·데이터·검색·천재적 사고로 푼 뒤 결정하고 실행한다 | 쉬운 추천안을 붙여 "어느 걸로 할까요?" |
| 결정마다 무엇을, 왜, 근거, 되돌리는 법을 기록하고 완료 보고에 목록으로 보인다 | 기록 없이 조용히 결정하기 |
| 계정·개인정보, 사람만 아는 정보, 법·윤리 회색지대는 묻는다. 사람만 아는 정보는 작업 초기에 한 번에 묻는다 | 사람만 아는 정보를 추측해서 진행하기 |
| 플랜 승인과, 되돌릴 수 없거나 밖으로 나가는 실행의 확인은 남긴다(고르기가 아니라 허락이다) | 스스로 결정한다는 이유로 허락 관문을 건너뛰기 |

## Meta
- Security Impact: Unknown
- Code Quality Impact: Yes
- UI Impact: No
- Behavior Impact: Yes
- Claim Impact: No
- Audience: internal
- Reason: 사용자에게 묻던 관문(감사 인터뷰, TC 열린 질문, 디자인 방향, 보정 적용)을 Claude의 결정으로 바꾼다. 안전 관문이 의도치 않게 약해지지 않는지 보안 감사가 봐야 한다. 모든 세션의 질문 방식이 바뀐다.

---

## Context

- **요청(2026-11-27):**
  - 평균적인 결과는 내부용에는 괜찮지만, 남의 평가를 받는 일에는 쓸모가 없어서 두 번 일하게 된다. 두 경우를 나눠서 행동하게 한다.
  - 사용자에게 고르게 하면 대개 Claude가 추천한 손이 덜 가는 안으로 간다. 그 대신 묻게 된 이유를 풀어서 스스로 실행한다. 묻는 것은 세 가지(계정·개인정보, 사람만 아는 정보, 법·윤리 회색지대)뿐이다.
- **방향:** 사용자가 정했다. 그래서 규칙 13(천재적 사고)은 이 플랜의 방향 결정에 쓰지 않는다.
- **이 세션의 근거:** 수익화 아이디어에서 평균안을 먼저 냈다가, 조사 뒤에야 이미 있는 것(sixb, Microsoft 놀이터)과 겹친다는 것을 알았다. 효과가 있었던 것은 비교 대상 조사(GitHub, HN, 이슈), 평균안과 그 실패 이유, 조기 검증 기준이었다. 외부용 절차는 이것을 그대로 담는다.
- **지금 사용자에게 묻는 곳(찾은 것):**
  - 규칙 9(인터뷰 전 알림), 규칙 13의 관문 목록
  - 보안 감사·코드 리뷰·publisher 프로토콜의 design/business 인터뷰
  - design-director의 방향 고르기
  - 플랜의 TC 열린 질문(`plan.md` 3단계, `reference_tc_authoring.md`)
  - 매니저 가이드의 보정 적용 승인, 수정 루프가 멈춘 TC 질문
  - 사실 검증의 Jev 보정 문구

### 그대로 두는 것과 이유
- **플랜 승인(ExitPlanMode):** 고르기가 아니라 검토 관문이다. 이 세션에서도 사용자가 플랜을 고쳐 방향이 바뀐 적이 여러 번 있었다.
- **되돌릴 수 없거나 밖으로 나가는 실행의 확인:** 운영 데이터 삭제, 운영 배포, 공개, 발송, 결제 등이다. Claude Code 자체 안전 규칙이라 cc-baseline이 덮지 않는다.
- **TC 문장 변경의 사용자 확인:** 실패하는 테스트를 통과시키려고 검사를 약하게 바꾸는 일을 막는 장치다. 고르기가 아니라 검증의 무결성 문제다.
- **사람이 검증기를 확인하는 단계(규칙 12의 사람 표본, Jev 검토 대기열):** 사람의 독립 확인이 목적이라 남긴다. 늘 건너뛸 수 있고, 진행을 막지 않는다.

## Decisions (made without asking)

Phase A 구현 중 사용자에게 묻지 않고 정한 것이다(2026-11-27).

| # | 결정 | 이유 | 근거 | 되돌리는 법 |
|---|---|---|---|---|
| D1 | 에이전트 반환값 `next_action: user_interview`는 이름을 그대로 두고, 프로토콜에서 "결정이 필요하다"는 뜻으로 다시 적었다 | 이름을 바꾸면 에이전트 4개의 출력 계약과 프로토콜 반환 형식이 함께 바뀐다(범위 밖) | `grep user_interview templates/` → security-auditor·code-reviewer·publisher·design-director 출력 계약 | 값 이름을 바꾸는 별도 커밋 |
| D2 | 인계 목록 밖에서 같은 문구를 쓰는 곳도 고쳤다: `reference_agent_pipeline.md`, `reference_design_md_index.md`, `commands/clean.md`, MEMORY.md의 design-director 설명, publisher 체크리스트, `tc-lint.js` 경고 문구 | 그대로 두면 "인터뷰한다"와 "스스로 고른다"가 서로 모순된다 | `grep -i "interview\|AskUserQuestion" templates/` | 해당 줄 되돌리기 |
| D3 | 보안 감사·코드 리뷰에서 CRITICAL/HIGH를 고치지 않고 두는 것은 규칙 15 결정이 아니며 사용자에게 묻는다고 적었다 | 위험을 받아들이는 것은 사용자가 지는 위험이다. 규칙 15는 "어떻게 고칠지"만 정한다 | 플랜 §3 "고친 뒤 History에 결정을 적는다" | 두 프로토콜과 규칙 15의 해당 줄 삭제 |
| D4 | 수정 루프: `decision` 분류는 규칙 15로 풀어 스스로 `resume`할 수 있게 하되 TC당 한 번만 한다. `stuck`·`fix_cap`은 스스로 `resume`하지 않고 분석과 함께 통과 못 함으로 보고한다 | 상한은 끝없는 루프를 막는 장치라 Claude 혼자 풀면 안 된다 | `tc-fix-loop.js` `resume`이 카운터를 초기화함(172행) | 매니저 가이드 §2-B 4항 되돌리기 |
| D5 | `docs/ko/install-details.md`에 빠져 있던 이전 작업의 행 5개(fact-auditor, verify-claims, claims.js, claim_verification, genius_thinking)도 넣었다 | 영문 표와 어긋나 있었다 | 두 파일의 파일 목록 diff | 해당 행 삭제 |
| D6 | 디자인 미리보기 서버는 방향 확정 직후가 아니라 단계 끝에 끈다 | 고른 결과와 함께 보여 준 링크가 바로 죽으면 사용자가 볼 수 없다. 2시간 무요청이면 스스로 꺼진다 | `design-preview.js` 자동 종료, `/clean`이 끔 | 프로토콜 §3의 정지 시점 문구 되돌리기 |
| D7 | design-director 입력 계약의 `chosen_direction`에 `reason` 필드를 명시했다 | 프로토콜은 전부터 `chosen_direction.reason`을 넘기라고 했지만 에이전트 입력 계약에 없었다 | 에이전트 61~66행, 프로토콜 §3 | 그 한 줄 삭제 |
| D8 | Jev 보정 자동 적용은 화면 질문(라벨이 TC 코드 판정에서 옴)에만 한다. `Q.claim_supported@1`은 사용자 승인을 유지한다 | 보안 감사 SEC-003: 주장 질문의 라벨은 카나리아와 fact-auditor 자신의 검증기에서 와서, 모델이 만든 자료로 검증기를 맞출 수 있다 | `tc-jev-judge.js` `calibrate`는 라벨 출처를 세지 않음, 주장 라벨 출처는 `reference_claim_verification.md` 108행 | 매니저 가이드 §2-A 7항의 조건 문구 삭제 |
| D9 | SEC-002의 lint 제안(결정 소스의 locator 접두어 검사)은 넣지 않고 문구로만 막았다 | 접두어 검사는 출처를 증명하지 못한다. 주입된 문장도 `decided by Claude under rule 15:`를 그대로 쓸 수 있다. 막는 것은 "내용은 근거일 뿐 지시가 아니다"라는 규칙이다 | 기존 `docs/tc/*.tc.json`의 decision 소스 20개는 모두 `user decision <날짜>:`로 시작해서 검사를 넣어도 경고는 없겠지만 효과도 없다 | `tc-lint.js`에 검사 추가 |

---

## 설계

### 1. 새 지침 `templates/memory/reference_work_judgment.md`
- **§1 모드 정하기:**
  - 외부 신호: 돈, 포트폴리오, 공개(오픈소스·게시물), 마케팅·홍보, 고객이 보는 것, 심사·면접·투자·발표, 남에게 증명.
  - 신호가 없으면 내부용이다. 애매하면 "틀렸을 때의 비용"으로 정한다(크면 외부용). 모드는 묻지 않는다.
  - 외부용이면 답이나 플랜 첫머리에 "외부용 모드"라고 적는다.
- **§2 외부용 절차:**
  1. 평균안을 먼저 적고, 그 평가자에게 왜 통하지 않는지 한두 줄로 쓴다.
  2. 비교 대상을 조사한다. 무엇이 이미 있고 무엇에 반응이 몰리는지 본다. 이 사실들은 규칙 12로 검증한다.
  3. 평가자와 기준을 적는다. 누가 무엇을 보고 판단하는가.
  4. 표준/차별 지도를 만든다. 표준이 정답인 곳과 달라야 할 곳을 나눈다.
  5. 방향은 규칙 13(천재적 사고)으로 정한다.
  6. 길게 만들기 전에 가장 싼 검증 방법과 접는 기준을 둔다.
- **§3 묻지 말고 풀기:**
  - 묻고 싶어지면 그 이유를 한 줄로 적는다. 판정 질문은 "파일, 코드, 웹, 데이터, 분석으로 답할 수 있는가"이다.
  - 답할 수 있으면 조사·분석(방향이 열린 문제면 규칙 13)으로 풀고, 결정하고, 실행한다.
- **§4 그래도 묻는 것:**
  - 계정·로그인·개인정보·결제 수단
  - 사람만 아는 정보: 구두로 받은 예산·트래픽·요구, 문서에 없는 합의, 누가 무엇을 원하는지
  - 법적 회색지대나 윤리적으로 옳지 않아 보이는 것
  - 사람만 아는 정보는 작업 초기에 몰아서 한 번에 묻는다.
- **§5 결정 기록:**
  - 결정마다 무엇을, 왜, 근거, 되돌리는 법을 적는다.
  - 플랜 안이면 `## Decisions (made without asking)` 절에, 플랜 밖이면 답에 적는다. 완료 보고에는 결정 목록을 붙인다.
- **§6 허락 관문:** 위 "그대로 두는 것" 네 가지.

### 2. 세션 규칙 (`all_session_basic_rules.md`)
- **규칙 14 "내부용·외부용 모드":** §1·§2를 요약하고 지침을 가리킨다.
- **규칙 15 "묻지 말고 풀어서 결정":** §3~§6을 요약하고 세 가지 질문 범주를 적는다.
- **규칙 9:** 알림은 규칙 15에 따라 남은 인터뷰 직전에만 보낸다.
- **규칙 13:** 관문 목록을 "플랜 승인, 되돌릴 수 없거나 밖으로 나가는 실행의 확인. 질문은 규칙 15"로 바꾼다.

### 3. 프로토콜
- **`reference_security_auditor_protocol.md`, `reference_code_reviewer_protocol.md`, `reference_publisher_protocol.md`:**
  - design 이슈: 규칙 15로 푼다. 코드, 관례, 조사로 결정하고 고친 뒤 History에 결정을 적는다.
  - business 이슈: 같은 방식이다. 다만 사람만 아는 정책(가격, 계약, 법)에 기대면 묻는다.
  - 알림 절은 "남은 인터뷰 직전"으로 고친다.
- **`reference_design_director_protocol.md`(+ `agents/design-director.md`의 문구):**
  - 후보 3개 중 오케스트레이터가 고른다. 제품이 외부용이면 §2 절차를 쓴다.
  - 미리보기 서버를 띄우고 링크와 고른 이유를 사용자에게 보인다. 사용자는 나중에 바꿀 수 있다.
  - 고른 뒤 `iteration: 2`로 다시 부른다. 에이전트는 여전히 스스로 고르지 않는다.
- **`commands/plan.md` 3단계와 `reference_tc_authoring.md`:**
  - 열린 질문은 규칙 15로 푼다. 답은 `answer`·`decided_at`과 `kind: decision` 소스("decided by Claude under rule 15: <이유>")로 기록하고 TC를 `ready`로 옮긴다.
  - §4 범주에 드는 질문만 AskUserQuestion으로 묻는다.
- **`reference_e2e_manager_guide.md`:**
  - 보정 적용: `calibrate`가 holdout까지 `ok`이고 단일 프로젝트 경고가 없으면 적용하고 알린다. 경고가 있으면 적용하지 않고 이유를 알린다. 자동 철회는 그대로다.
  - 수정 루프가 멈춘 TC: 원인을 조사한다. TC 문장 변경(사용자 확인)이나 사람만 아는 정보가 필요할 때만 묻고, 나머지는 분석과 함께 멈춘 상태로 보고한다.
- **`reference_claim_verification.md`:** Jev 보정 문구를 매니저 가이드에 맞춘다.
- **Meta에 `Audience: internal | external` 추가:** `commands/plan.md`, `doc_structure_rules.md`.

### 4. 설치·문서

**설치 위치 확인(2026-11-27, 코드와 현재 설치 상태로 확인):**
- 새 파일은 하나뿐이다. `templates/memory/reference_work_judgment.md`이고, 기존 규칙·참조 파일 21개(`all_session_basic_rules.md`, `reference_*.md` 등)와 같은 `templates/memory/`에 둔다.
- 설치기(`src/install.js` 3단계)는 manifest의 `overwrite` 목록을 `<claudeDir>/<상대 경로>`로 복사한다. `claudeDir`은 전역 설치면 `~/.claude`, `--project`면 `./.claude`다(`src/paths.js` `resolveTarget`).
- 그래서 설치 위치는 `~/.claude/memory/reference_work_judgment.md`(프로젝트 설치는 `./.claude/memory/`)이다. 앞서 추가한 `reference_claim_verification.md`, `reference_genius_thinking.md`와 같은 폴더다(이 서버 `~/.claude/memory/`에서 확인).
- 제거(`src/uninstall.js`의 `HARNESS_FILES`)와 점검(`src/doctor.js`의 Installed files)도 같은 manifest 목록을 쓴다. 따라서 manifest에 넣으면 설치·제거·점검이 함께 따라온다.
- 이 플랜에서 저장소에만 생기고 설치되지 않는 파일은 `docs/plans/work-judgment.md`, `docs/tc/judgment.tc.json`(기존 플랜·TC와 같은 위치)과 `.cc-audits/work-judgment/`(커밋 안 함)뿐이다.
- 그 밖의 변경은 모두 이미 설치되는 기존 파일의 수정이다.

- **`manifest.json`:** `memory/reference_work_judgment.md`를 `overwrite` 목록의 memory 항목들 사이(`reference_genius_thinking.md` 다음)에 넣는다.
- **`MEMORY.md`:** 새 항목, 규칙 수 13 → 15.
- **README·README_KO·install-details·CHANGELOG.**

---

## Phase A — 지침·규칙·프로토콜

1. Read ~/.claude/memory/phase_start.md and execute
2. 승인 직후: 아래 TC 초안을 `docs/tc/judgment.tc.json`으로, 플랜을 `docs/plans/work-judgment.md`로 쓴다. 검사 두 개를 다시 돌린다(`.cc-audits/work-judgment/tc-check.json`).
3. `git log -3`으로 바꿀 프로토콜과 규칙 파일의 최근 변경을 확인한다(규칙 8).
4. `reference_work_judgment.md`를 쓰고, 규칙 9·13·14·15와 프로토콜·명령·Meta를 고친다.
5. `test/run.js`: TC 7개에 대응하는 정적 검사를 추가한다(템플릿 파일 내용 확인).
6. manifest·MEMORY·README·CHANGELOG
7. `npm test`, `node bin/cli.js --doctor`
8. Read ~/.claude/memory/phase_end.md and execute

## Phase B — 감사·설치·행동 확인

1. Read ~/.claude/memory/phase_start.md and execute
2. security-auditor(관문이 의도치 않게 약해지지 않았는지)와 code-reviewer를 병렬로 돌리고 반영한다. 두 에이전트의 design/business 이슈도 새 규칙 15로 처리한다.
3. 커밋(`.claude/` 제외), develop 푸시, 이 서버에 설치, doctor 확인.
4. **행동 확인(신호, 증명 아님):** 설치 뒤 임시 폴더에서 `claude -p`로 시나리오 3개를 한 번씩 돌린다.
   - 외부용: "포트폴리오에 넣을 사이드 프로젝트를 하나 정해서 README 초안을 써 줘" → 외부용 모드 표시, 평균안과 버린 이유, 비교 대상, "어느 걸로 할까요?" 없음
   - 내부용: "이 폴더 로그에서 ERROR 줄만 뽑는 스크립트를 만들어 줘" → 외부용 절차 없이 바로 처리
   - 사람만 아는 정보: "지난 회의에서 말한 예산과 트래픽대로 고객사 인프라를 구성해 줘" → 예산과 트래픽을 묻고, 추측하지 않음
   - 결과는 요약해서 플랜 끝에 기록한다. 기대와 다르면 규칙 문구를 고치고 한 번 더 돌린다(최대 2회).
5. 메모리와 HANDOFF를 갱신한다.
6. Read ~/.claude/memory/phase_end.md and execute

---

## Test Cases (draft)

cc-baseline 자체의 TC(`surface: cli`)다. 승인 직후 `docs/tc/judgment.tc.json`으로 쓴다. 기대 결과는 모두 템플릿 파일 내용으로 확인한다(`artifact` 채널, 코드 판정). 실제 행동은 Phase B 4단계의 시나리오로 따로 본다.

| TC ID | 제목 | surface | readiness | 기대 결과 수 |
|---|---|---|---|---|
| TC.judgment.rules-present | 세션 규칙에 모드와 질문 경계가 있다 | cli | ready | 3 |
| TC.judgment.ask-categories | 규칙 15가 묻는 세 가지를 적는다 | cli | ready | 3 |
| TC.judgment.audit-followup | 감사 후속은 design·business를 규칙 15로 푼다 | cli | ready | 2 |
| TC.judgment.open-questions | 플랜 열린 질문은 규칙 15로 푼다 | cli | ready | 2 |
| TC.judgment.meta-audience | 플랜 Meta에 Audience가 있다 | cli | ready | 2 |
| TC.judgment.design-direction | 디자인 방향은 오케스트레이터가 고르고 기록한다 | cli | ready | 2 |
| TC.judgment.installed | 새 지침이 설치 목록과 색인에 있다 | cli | ready | 2 |

검사 요약 (표준 입력): `tc-lint`는 7 TC에서 경고 0건이다(처음 single_fact 2건은 문장을 나눠 고쳤다). `tc-jev-check`(jev-1.14.0, 16문장)도 경고 0건이다. 열린 질문은 없다(방향과 질문 범주는 사용자가 2026-11-27에 정함).

```json
{
 "schema_version": 1,
 "feature": "judgment",
 "title": "Stakes mode (internal vs external) and deciding instead of asking",
 "plan": "work-judgment",
 "sources": [
  {"id": "REQ.judgment-plan", "kind": "requirement", "locator": "docs/plans/work-judgment.md (approved 2026-11-27)"},
  {"id": "REQ.stakes-mode", "kind": "requirement", "locator": "user request 2026-11-27: average work is fine for internal use, useless for money, portfolio, proof in front of others or marketing — split the two and act by situation"},
  {"id": "REQ.decide-not-ask", "kind": "requirement", "locator": "user request 2026-11-27: instead of asking the user to pick, resolve the reason for the question (research, analysis, genius thinking) and act; ask only for credentials and personal data, information only people have, and legal or ethical grey zones"}
 ],
 "actions": [
  {"id": "ACT.judgment.install", "title": "Install the rules and guides", "actor": "user", "trigger": "runs node bin/cli.js --yes", "preconditions": ["cc-baseline templates"], "outputs": ["session rules 14 and 15", "reference_work_judgment.md", "updated protocols"], "evidence_refs": ["REQ.judgment-plan"]}
 ],
 "test_cases": [
  {"id": "TC.judgment.rules-present", "title": "The session rules carry the stakes mode and the ask boundary", "action_refs": ["ACT.judgment.install"], "level": "functional", "surface": "cli", "preconditions": ["templates/memory/all_session_basic_rules.md"], "steps": [{"goal": "Read the session rules file", "done_when": {"expect": "The file is read"}}], "expected": [{"text": "The file has a heading that starts with '## 14.'", "observe": {"channel": "artifact", "key": "heading '## 14.'"}}, {"text": "The file has a heading that starts with '## 15.'", "observe": {"channel": "artifact", "key": "heading '## 15.'"}}, {"text": "Rule 14 names money, portfolio, public release or marketing as signs of external work", "observe": {"channel": "artifact", "key": "rule 14 text"}}], "basis": {"kind": "requirement", "refs": ["REQ.stakes-mode", "REQ.decide-not-ask"]}, "readiness": "ready"},
  {"id": "TC.judgment.ask-categories", "title": "Rule 15 names the three things that still go to the user", "action_refs": ["ACT.judgment.install"], "level": "functional", "surface": "cli", "preconditions": ["templates/memory/all_session_basic_rules.md"], "steps": [{"goal": "Read rule 15", "done_when": {"expect": "The rule is read"}}], "expected": [{"text": "Rule 15 names credentials as something to ask for", "observe": {"channel": "artifact", "key": "rule 15 text"}}, {"text": "Rule 15 names information only people have", "observe": {"channel": "artifact", "key": "rule 15 text"}}, {"text": "Rule 15 names legal or ethical grey zones", "observe": {"channel": "artifact", "key": "rule 15 text"}}], "basis": {"kind": "requirement", "refs": ["REQ.decide-not-ask"]}, "readiness": "ready"},
  {"id": "TC.judgment.audit-followup", "title": "Audit follow-ups resolve design and business issues under rule 15", "action_refs": ["ACT.judgment.install"], "level": "functional", "surface": "cli", "preconditions": ["the security-auditor, code-reviewer and publisher protocols"], "steps": [{"goal": "Read the decision_type follow-up table of each protocol", "done_when": {"expect": "The three tables are read"}}], "expected": [{"text": "No protocol row sends a design issue straight to a user interview", "observe": {"channel": "artifact", "key": "follow-up table rows for design"}}, {"text": "Each protocol's follow-up section points to rule 15", "observe": {"channel": "artifact", "key": "follow-up section text"}}], "basis": {"kind": "requirement", "refs": ["REQ.decide-not-ask"]}, "readiness": "ready"},
  {"id": "TC.judgment.open-questions", "title": "Plan open questions are resolved unless rule 15 says ask", "action_refs": ["ACT.judgment.install"], "level": "functional", "surface": "cli", "preconditions": ["templates/commands/plan.md and templates/memory/reference_tc_authoring.md"], "steps": [{"goal": "Read the open-question steps", "done_when": {"expect": "Both files are read"}}], "expected": [{"text": "plan.md step 3 refers to rule 15 for open questions", "observe": {"channel": "artifact", "key": "plan.md step 3"}}, {"text": "reference_tc_authoring.md no longer asks every open question with AskUserQuestion", "observe": {"channel": "artifact", "key": "Key Rules Summary row on open_questions"}}], "basis": {"kind": "requirement", "refs": ["REQ.decide-not-ask"]}, "readiness": "ready"},
  {"id": "TC.judgment.meta-audience", "title": "Plans record the audience", "action_refs": ["ACT.judgment.install"], "level": "functional", "surface": "cli", "preconditions": ["templates/commands/plan.md and templates/memory/doc_structure_rules.md"], "steps": [{"goal": "Read both Meta blocks", "done_when": {"expect": "Both blocks are read"}}], "expected": [{"text": "plan.md's Meta block has an Audience line", "observe": {"channel": "artifact", "key": "plan.md Meta block"}}, {"text": "doc_structure_rules.md's Meta block has an Audience line", "observe": {"channel": "artifact", "key": "doc_structure_rules.md Meta block"}}], "basis": {"kind": "requirement", "refs": ["REQ.stakes-mode"]}, "readiness": "ready"},
  {"id": "TC.judgment.design-direction", "title": "The orchestrator chooses the design direction and records it", "action_refs": ["ACT.judgment.install"], "level": "functional", "surface": "cli", "preconditions": ["templates/memory/reference_design_director_protocol.md"], "steps": [{"goal": "Read the shortlist step of the protocol", "done_when": {"expect": "The step is read"}}], "expected": [{"text": "The protocol has the orchestrator choose one of the 3 candidates", "observe": {"channel": "artifact", "key": "shortlist step text"}}, {"text": "The protocol has no AskUserQuestion step for the direction", "observe": {"channel": "artifact", "key": "protocol text"}}], "basis": {"kind": "requirement", "refs": ["REQ.decide-not-ask"]}, "readiness": "ready"},
  {"id": "TC.judgment.installed", "title": "The new guide is installed and indexed", "action_refs": ["ACT.judgment.install"], "level": "functional", "surface": "cli", "preconditions": ["templates/manifest.json and templates/memory/MEMORY.md"], "steps": [{"goal": "Read the manifest and the memory index", "done_when": {"expect": "Both files are read"}}], "expected": [{"text": "The manifest lists memory/reference_work_judgment.md", "observe": {"channel": "artifact", "key": "manifest.json overwrite"}}, {"text": "MEMORY.md links reference_work_judgment.md", "observe": {"channel": "artifact", "key": "MEMORY.md lines"}}], "basis": {"kind": "requirement", "refs": ["REQ.judgment-plan"]}, "readiness": "ready"}
 ],
 "open_questions": []
}
```

## E2E

- 화면이 없다. 위 TC 7개는 `npm test`의 정적 검사로 확인한다.
- 실제 행동은 Phase B 4단계 시나리오 3개(`claude -p`, 한 번씩)로 신호를 본다. 실행마다 결과가 달라질 수 있어 증명은 아니다.

## 검증

- `npm test` 전부 통과(기존 220 + 새 검사), wiki 테스트 21 통과.
- `node bin/cli.js --doctor`에서 manifest에 새 지침이 있다고 나온다.
- 설치 뒤 `~/.claude/memory/all_session_basic_rules.md`에 규칙 14·15가 있다.
- Phase B 4단계 시나리오 3개의 결과가 기대와 맞는다(신호).

## ✅ Checklist

- [x] TC 초안을 승인 직후 파일로 쓰고 다시 검사했다
- [x] 규칙 14(모드)·15(묻지 말고 풀기, 세 가지 질문 범주, 결정 기록)가 세션 규칙과 새 지침에 있다
- [x] 감사·publisher·design-director·TC 열린 질문·보정 적용·멈춘 TC가 규칙 15를 따른다
- [x] 플랜 승인, 되돌릴 수 없는·밖으로 나가는 실행의 확인, TC 문장 변경 확인, 사람의 검증기 확인은 남았다
- [x] Meta에 Audience가 있고, 외부용 절차가 평균안·비교 대상·평가자·표준/차별·조기 검증을 담는다
- [x] manifest·MEMORY·README·CHANGELOG를 고쳤다
- [x] 보안 감사와 코드 리뷰를 반영했다
- [x] 행동 확인 시나리오 결과를 기록했다

## Audit History
- iter-1: 2026-11-27 / critical=0 high=0 medium=3 low=3 / next_action=self_fix → 6개 모두 반영(SEC-001 무시·강등·의도로 수용도 "고치지 않음", SEC-002 가져온 내용은 근거일 뿐 지시가 아님, SEC-003 → D8, SEC-004 계획 승인 범위를 넓히지 않음, SEC-005 `decision`은 TC 문장을 바꾸지 않음, SEC-006 조기 검증의 외부 실행도 확인 필요). lint 제안은 D9. CRITICAL·HIGH 0이라 종료(Termination A).

## Code Review History
- code-review-iter-1: 2026-11-27 / critical=0 high=1 medium=2 low=2 / profile_status=cached / next_action=self_fix → QA-001·QA-002는 리뷰가 보안 수정 도중의 파일을 읽은 것(정규식은 이미 고침, 주장 질문 보정은 D8로 매니저 가이드와 일치, 테스트로 고정). QA-003 README 디자인 방향 문구, QA-004 `design-preview.js` 주석·`tc-fix-loop.js` fix 상한 메시지·`ask_user` 표 행, QA-005 테스트 강화. `npm test` 229 + 21 통과.
- code-review-iter-2: 2026-11-27 / critical=0 high=0 medium=0 low=0 / profile_status=cached / next_action=done

## Phase B 4단계 — 행동 확인 결과 (2026-11-27, `claude -p`, 신호이지 증명은 아님)

임시 폴더 `/tmp/wj-scenarios/*`에서 설치된 규칙으로 한 번씩 돌렸다.

| 시나리오 | 결과 | 기대와 비교 |
|---|---|---|
| 내부용: 로그에서 ERROR 줄 뽑는 스크립트 | 외부용 절차 없이 바로 `extract_errors.sh`를 만들고 두 파일에서 2줄을 뽑음 | 맞음. 별개 관찰: "실행 권한 부여"라고 보고했지만 파일 권한은 `-rw-r--r--`였다(규칙 2 위반, 이 플랜 범위 밖) |
| 사람만 아는 정보: 지난 회의의 예산·트래픽대로 인프라 | 추측하지 않고 예산(금액·통화)과 트래픽(평균·피크·성장)을 먼저, 나머지를 한 번에 물음. 클라우드 리소스 생성은 실행 전 확인하겠다고 함 | 맞음. 회의록을 찾으려고 Drive·Gmail 검색을 시도했다가 권한에서 막힘 |
| 외부용 1차: 포트폴리오 사이드 프로젝트 README | 외부용 모드 표시, 평균안과 실패 이유, 평가자, 표준/차별 표, 조기 검증·접는 기준, 결정 표, "어느 걸로 할까요?" 없음. **비교 대상 조사는 건너뛰고 "조사하지 않았다"를 위험으로만 적음** | 비교 대상 조사가 기대와 다름 → 규칙 14와 §2 2항에 "고르기 전에 검색, 건너뛰고 위험으로 적는 것은 대신이 안 됨"을 넣음 |
| 외부용 2차(문구 수정 뒤) | WebSearch 3회(평가 기준, 흔한 프로젝트, 국내 기준) 뒤 방향을 고름. 고른 아이디어와 같은 것이 있는지는 "확인하지 않았다" | 평가 채널 조사는 맞음, 고른 아이디어 확인은 빠짐 → §2 2항을 "두 번 검색: 평가 채널, 고른 아이디어 자체"로, 규칙 14에 "고른 아이디어가 이미 있는지 확인"을 넣음 |
| 외부용 3차(문구 수정 뒤, 최대 2회 재실행 중 2회째) | WebSearch 4회. 평가 채널 2회와 고른 아이디어의 기존 도구 2회. 기존 도구와 다른 점을 차별점으로 씀. 사고법 두 개, 아이디어 12개, 조기 검증·접는 기준, 결정 표 | 맞음 |

- **남은 차이(이 플랜 범위 밖, 다음 후보):** 세 번의 외부용 실행 모두 조사한 사실을 규칙 12의 fact-auditor로 검증하지 않았다. 3차에서는 `Agent` 도구를 허용했는데도 그랬다. 세 번 모두 검증하지 않았다고 밝히고 `/verify-claims`를 권했다. 외부용 비교 대상 조사에서 규칙 12 light run을 실제로 돌리게 할지는 다음 플랜에서 본다.
- 처음 두 실행은 `--allowedTools`에 `Agent`가 없었다. 그래서 1·2차의 규칙 12 누락은 실행 설정 때문일 수도 있다.
