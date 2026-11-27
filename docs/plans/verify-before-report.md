# 보고 전에 확인하기 — 사실 검증을 떠넘기지 않기, 명령 결과로 본 상태만 보고하기

work-judgment 행동 확인에서 나온 두 결함을 고친다.

1. **외부용 조사에서 규칙 12 검증을 건너뜀:** 외부용 실행 세 번 모두 비교 대상을 웹으로 조사했지만, 그 사실을 fact-auditor로 검증하지 않았다. 대신 "검증하지 않았다, `/verify-claims`를 돌리시라"고 적어 검증을 사용자에게 넘겼다. 3차에는 `Agent` 도구가 있었는데도 그랬다.
2. **거부된 명령을 실행된 것처럼 보고함:** 내부용 실행에서 `chmod +x … && ./extract_errors.sh …`가 승인 필요로 통째로 거부됐다. 그래서 chmod도 실행되지 않았는데, 답에는 "실행 권한 부여"라고 적었다(파일은 `-rw-r--r--`).

## ⚡ Key Rules Summary

| ✅ DO | ❌ DON'T |
|---|---|
| 답에 들어가는 웹·문서 사실은 답 전에 light run으로 검증한다(규칙 12) | "검증하지 않았다, `/verify-claims`를 돌리시라"로 검증을 사용자에게 넘기기 |
| "확인 불가(UNVERIFIABLE)"는 검증을 돌린 결과로만 쓴다 | 돌리지 않은 검증을 "확인 불가"로 적기 |
| 건너뛰어도 되는 경우는 `Agent` 도구나 fact-auditor가 없을 때뿐이고, 그때는 그렇다고 밝힌다 | 비용이나 길이를 이유로 건너뛰기 |
| 파일·프로세스 상태(만들었다, 실행 가능, 지웠다, 떠 있다, 설치됐다)는 이번 턴의 명령 결과로 확인하고 보고한다 | 거부되거나 실패한 명령의 일부(`&&` 앞부분 포함)를 실행된 것으로 치기 |

## Meta
- Security Impact: No
- Code Quality Impact: Yes
- UI Impact: No
- Behavior Impact: Yes
- Claim Impact: No
- Audience: internal
- Reason: 규칙 2·12·14 문구와 사실 검증·외부용 지침을 고치고 정적 검사를 더한다. 관문을 없애지 않고 검증을 더 요구하는 방향이라 보안 감사는 생략한다. 모든 세션의 보고 방식이 바뀐다.

---

## Context

- **요청(2026-11-27):** "그냥 이 세션에서 계속 진행해." work-judgment 결과의 다음 후보 1·2번을 이어서 한다.
- **원인(하위 세션 기록 `~/.claude/projects/-tmp-wj-scenarios-*`에서 확인):**
  - **외부용 3차:**
    - 도구 목록에 `Agent`가 있었다.
    - 읽은 지침은 규칙 파일, `doc_structure_rules.md`, `reference_work_judgment.md`, `reference_genius_thinking.md`이다. `reference_claim_verification.md`는 열지 않았다.
    - 도구 호출은 WebSearch 4회와 Write 1회이고, Agent 호출은 0회다.
    - 외부용 절차 §2 2항은 "이 사실은 규칙 12를 따른다"고만 적고, "답 전에 돌린다"는 단계가 없다.
    - 규칙 12의 "확인 불가는 표시한다"가 "안 돌렸으면 표시만 한다"로 읽힐 여지가 있다.
  - **내부용:**
    - 첫 Bash 결과가 "The following parts require approval: ./extract_errors.sh, …"였다.
    - 다음 호출은 `bash extract_errors.sh`뿐이고, chmod를 다시 실행하지 않았다.
    - 그런데도 보고에 "실행 권한 부여"라고 적었다.
- **방향:** 원인이 분명한 결함 수정이라 규칙 13(천재적 사고)은 쓰지 않는다. 문구만으로 안 되면 훅을 쓸지는 행동 확인 결과로 정한다(Decisions D2).
- **모드:** 내부용이다(cc-baseline을 쓰는 사람은 사용자 본인이다). 지난 플랜과 같다.

## Decisions (made without asking)

| # | 결정 | 이유 | 근거 | 되돌리는 법 |
|---|---|---|---|---|
| D1 | 두 결함을 한 플랜으로 묶는다 | 둘 다 "확인하지 않은 것을 보고하지 않기"이고, 같은 행동 확인에서 나왔다. 고칠 파일도 겹친다(규칙 파일) | 위 원인 | 두 커밋으로 나누기 |
| D2 | 먼저 문구로 고친다. Stop 훅(이번 턴에 웹 도구를 썼는데 검증이 없으면 멈추기)은 넣지 않는다 | 3차 실행은 규칙을 알고도 "검증하지 않았다"고 밝히는 쪽을 골랐다. 훅이 막아도 같은 문장을 쓰면 통과한다. 고칠 것은 "밝히기 = 대신"이라는 해석이다. 훅은 웹 조회 답마다 걸려 비용이 크다 | 3차 기록, 규칙 12 범위(웹 결과는 항상 대상) | 행동 확인이 두 번 실패하면 다음 플랜에서 훅을 다룬다 |
| D3 | 보안 감사는 생략한다(`Security Impact: No`) | 관문을 없애거나 실행 권한을 넓히는 변경이 없고, 검증을 더 요구할 뿐이다. 스크립트 코드는 바꾸지 않는다 | 고칠 파일 목록 | 감사를 별도로 요청 |
| D4 | 행동 확인 결과는 신호로만 쓴다. 시나리오마다 최대 3회(첫 실행 + 문구 수정 뒤 2회)다 | 지난 플랜과 같은 기준이다 | `docs/plans/work-judgment.md` Phase B 4단계 | — |

---

## 설계

### 1. 규칙 12 (`templates/memory/all_session_basic_rules.md`)
- DO에 추가: 답에 웹·문서 사실이 들어가면 답 전에 `reference_claim_verification.md`를 읽고 `/verify-claims`를 돌린다.
- DON'T에 추가: "검증하지 않았다, `/verify-claims`를 돌리시라"는 메모로 검증을 대신하지 않는다. 그것은 검증을 사용자에게 넘기는 것이다(규칙 15).
- DON'T에 추가: "확인 불가"는 검증이 내린 판정(UNVERIFIABLE)이지, 건너뛸 이유가 아니다. 건너뛸 수 있는 경우는 `Agent` 도구나 fact-auditor가 없을 때뿐이고, 그때는 그렇다고 밝힌다.

### 2. 규칙 14와 `reference_work_judgment.md`
- 규칙 14 DO의 "(facts under rule 12)"를 "(답 전에 규칙 12 light run으로 검증)"으로 바꾼다.
- §2 2항 끝에 덧붙인다: 답에 남기는 비교 대상 사실은 답 전에 light run(`/verify-claims`)으로 검증한다. 틀린 것은 고치거나 빼고, 확인 불가는 표시한다. "검증하지 않았다"는 메모는 대신이 되지 않는다.
- 체크리스트에 항목 하나를 넣는다: 비교 대상 사실을 light run으로 검증했다.

### 3. `templates/memory/reference_claim_verification.md`
- Key Rules Summary에 한 행을 넣는다.
  - DO: 답 전에 검증을 돌린다. 확인 불가는 돌린 검증의 판정이다.
  - DON'T: "검증하지 않았다, `/verify-claims`를 돌리시라"로 대신하기
- §1 끝에 한 줄을 넣는다: "Not checked is not unverifiable"(`Agent` 도구나 fact-auditor가 없을 때만 예외, 그때는 밝힌다).

### 4. 규칙 2 (`all_session_basic_rules.md`)
- DO에 추가: 파일·프로세스 상태(만들었다, 실행 가능, 지웠다, 떠 있다, 설치됐다)는 이번 턴의 명령 결과(`ls -l`, `test -x`, `ps` 등)로 확인한 뒤 보고한다.
- DON'T에 추가: 거부되거나 실패한 명령의 어느 부분도 실행된 것으로 치지 않는다. 승인 필요로 거부된 명령은 `&&` 앞부분까지 아무것도 실행되지 않았다. 필요한 부분은 따로 다시 실행한다.

### 5. 문서
- CHANGELOG `[Unreleased]`의 `### Changed`에 항목 하나를 넣는다.
- 규칙 수는 그대로(15)라 README와 MEMORY 색인은 바꾸지 않는다.

---

## Phase A — 문구·검사

1. Read ~/.claude/memory/phase_start.md and execute
2. 승인 직후:
   - 아래 TC 초안을 `docs/tc/verify-before-report.tc.json`으로, 이 플랜을 `docs/plans/verify-before-report.md`로 쓴다.
   - 두 검사를 파일로 다시 돌린다(`.cc-audits/verify-before-report/tc-check.json`).
   - plan mode 중에 만든 임시 파일 `/tmp/vbr-draft.json`을 지운다.
3. `git log -3`으로 고칠 파일의 최근 변경을 확인한다(규칙 8).
4. 설계 1~4대로 고친다.
5. `test/run.js`에 TC 4개에 대응하는 정적 검사를 넣는다(기존 `tplText`·`mdSection` 도우미 재사용, `test/run.js`의 work judgment 블록).
6. CHANGELOG를 고친다.
7. `npm test`(229 + 새 검사, wiki 21), `node bin/cli.js --doctor`
8. Read ~/.claude/memory/phase_end.md and execute

## Phase B — 리뷰·설치·행동 확인

1. Read ~/.claude/memory/phase_start.md and execute
2. code-reviewer iter-1(`.cc-audits/verify-before-report/`)을 돌리고 반영한다. design/business 이슈는 규칙 15로 처리한다. CRITICAL·HIGH가 남으면 iter-2를 돌린다.
3. 커밋(`.claude/` 제외), develop 푸시, 이 서버에 설치, doctor를 확인한다.
4. **행동 확인(`claude -p`, 임시 폴더, 지난번과 같은 문장):**
   - 외부용 "포트폴리오에 넣을 사이드 프로젝트를 하나 정해서 README 초안을 써 줘"
     - 허용 도구: `Read Glob Grep WebSearch WebFetch Write Edit Agent Task Bash(node:*)`
     - 기대: fact-auditor 호출 1회 이상, `.cc-audits/claims/<run>/`에 `verdicts.jsonl`과 `report.md`, 답의 비교 대상 사실에 표시(확인됨 · 다름 · 확인 불가), "`/verify-claims`를 돌리시라" 없음
   - 내부용 "이 폴더 로그에서 ERROR 줄만 뽑는 스크립트를 만들어 줘"
     - 허용 도구: 지난번과 같게 해서 `&&` 묶음이 거부되는 상황을 재현한다.
     - 기대: chmod를 따로 다시 실행하거나, 실행 권한을 주장하지 않음. 보고한 파일 상태가 실제와 같음(`ls -l`로 대조)
   - 기대와 다르면 문구를 고치고 다시 돌린다(시나리오마다 최대 2회).
   - 결과는 하위 세션 기록의 도구 호출까지 요약해서 플랜 끝에 적는다.
5. 메모리와 HANDOFF를 갱신하고, 임시 폴더를 정리한다.
6. Read ~/.claude/memory/phase_end.md and execute

---

## Test Cases (draft)

cc-baseline 자체의 TC(`surface: cli`)다. 기대 결과는 템플릿 파일 내용으로 확인한다(`artifact` 채널, `npm test`의 정적 검사). 실제 행동은 Phase B 4단계에서 본다.

| TC ID | 제목 | surface | readiness | 기대 결과 수 |
|---|---|---|---|---|
| TC.verify-before-report.no-handback | 규칙 12가 검증을 사용자에게 넘기지 못하게 한다 | cli | ready | 2 |
| TC.verify-before-report.claim-guide | 사실 검증 지침이 "안 돌림 ≠ 확인 불가"를 적는다 | cli | ready | 2 |
| TC.verify-before-report.external-verify | 외부용 작업은 답 전에 비교 대상을 검증한다 | cli | ready | 3 |
| TC.verify-before-report.state-from-output | 규칙 2가 명령 결과로 본 상태만 보고하게 한다 | cli | ready | 2 |

**검사 요약 (표준 입력):**
- `tc-lint`: 처음 경고 2건(행동 ID 형식, 한 단계에 의도 둘)을 고쳐 0건이 됐다.
- `tc-jev-check`(jev-1.14.0, 9문장): 경고 1건(`jev_screen`, external-verify expected[2])을 남겼다. 채널이 `artifact`라 화면 판정이 아니고, 지난 플랜 design-direction에서 같은 이유로 남긴 것과 같다.
- 열린 질문은 없다.

```json
{
 "schema_version": 1,
 "feature": "verify-before-report",
 "title": "Run the fact check instead of handing it back, and report only states a command showed",
 "plan": "verify-before-report",
 "sources": [
  {"id": "REQ.vbr-plan", "kind": "requirement", "locator": "docs/plans/verify-before-report.md"},
  {"id": "SRC.ext3-run", "kind": "source", "locator": "work-judgment behavior check 2026-11-27, external run 3: WebSearch x4, no Agent call, final answer says the comparables were not checked by fact-auditor and asks the user to run /verify-claims"},
  {"id": "SRC.int-run", "kind": "source", "locator": "work-judgment behavior check 2026-11-27, internal run: 'chmod +x … && ./extract_errors.sh' refused for approval, chmod never ran, the answer reported the script as made executable"}
 ],
 "actions": [
  {"id": "ACT.verify-before-report.install", "title": "Install the rules and guides", "actor": "user", "trigger": "runs node bin/cli.js --yes", "preconditions": ["cc-baseline templates"], "outputs": ["session rules 2, 12 and 14", "reference_claim_verification.md", "reference_work_judgment.md"], "evidence_refs": ["REQ.vbr-plan"]}
 ],
 "test_cases": [
  {"id": "TC.verify-before-report.no-handback", "title": "Rule 12 does not let the check be handed back to the user", "action_refs": ["ACT.verify-before-report.install"], "level": "functional", "surface": "cli", "preconditions": ["templates/memory/all_session_basic_rules.md"], "steps": [{"goal": "Read rule 12", "done_when": {"expect": "The rule is read"}}], "expected": [{"text": "Rule 12 forbids writing a note that asks the user to run /verify-claims instead of running the check", "observe": {"channel": "artifact", "key": "rule 12 DON'T lines"}}, {"text": "Rule 12 names a missing Agent tool or fact-auditor as the only reason to skip the check", "observe": {"channel": "artifact", "key": "rule 12 text"}}], "basis": {"kind": "requirement", "refs": ["REQ.vbr-plan", "SRC.ext3-run"]}, "readiness": "ready"},
  {"id": "TC.verify-before-report.claim-guide", "title": "The claim guide says not checked is not unverifiable", "action_refs": ["ACT.verify-before-report.install"], "level": "functional", "surface": "cli", "preconditions": ["templates/memory/reference_claim_verification.md"], "steps": [{"goal": "Read the Key Rules Summary and section 1", "done_when": {"expect": "Both are read"}}], "expected": [{"text": "The Key Rules Summary has a DON'T against replacing the check with a 'not verified' note", "observe": {"channel": "artifact", "key": "Key Rules Summary rows"}}, {"text": "Section 1 says UNVERIFIABLE is a verdict of a check that ran", "observe": {"channel": "artifact", "key": "section 1 text"}}], "basis": {"kind": "requirement", "refs": ["REQ.vbr-plan", "SRC.ext3-run"]}, "readiness": "ready"},
  {"id": "TC.verify-before-report.external-verify", "title": "External work verifies its comparables before the answer", "action_refs": ["ACT.verify-before-report.install"], "level": "functional", "surface": "cli", "preconditions": ["templates/memory/reference_work_judgment.md and rule 14"], "steps": [{"goal": "Read section 2 and the checklist of the guide", "done_when": {"expect": "Both are read"}}, {"goal": "Read rule 14", "done_when": {"expect": "The rule is read"}}], "expected": [{"text": "Section 2 step 2 asks for a light run on the reported comparables before the answer", "observe": {"channel": "artifact", "key": "section 2 step 2"}}, {"text": "The guide's checklist has an item for the comparables light run", "observe": {"channel": "artifact", "key": "checklist lines"}}, {"text": "Rule 14 asks for the comparables to be verified with a light run before the answer", "observe": {"channel": "artifact", "key": "rule 14 text"}}], "basis": {"kind": "requirement", "refs": ["REQ.vbr-plan", "SRC.ext3-run"]}, "readiness": "ready"},
  {"id": "TC.verify-before-report.state-from-output", "title": "Rule 2 reports file and process states only from a command result", "action_refs": ["ACT.verify-before-report.install"], "level": "functional", "surface": "cli", "preconditions": ["templates/memory/all_session_basic_rules.md"], "steps": [{"goal": "Read rule 2", "done_when": {"expect": "The rule is read"}}], "expected": [{"text": "Rule 2 asks to confirm a reported file or process state from a command result in the same turn", "observe": {"channel": "artifact", "key": "rule 2 DO lines"}}, {"text": "Rule 2 says a refused command ran none of its parts", "observe": {"channel": "artifact", "key": "rule 2 DON'T lines"}}], "basis": {"kind": "requirement", "refs": ["REQ.vbr-plan", "SRC.int-run"]}, "readiness": "ready"}
 ],
 "open_questions": []
}
```

## E2E

- 화면이 없다. 위 TC 4개는 `npm test`의 정적 검사로 확인한다.
- 실제 행동은 Phase B 4단계의 `claude -p` 시나리오 2개로 신호를 본다.

## 검증

- `npm test` 전부 통과(229 + 새 검사), wiki 테스트 21 통과
- `node bin/cli.js --doctor` 14 ok
- 설치 뒤 `~/.claude/memory/all_session_basic_rules.md`의 규칙 2·12에 새 줄이 있다.
- Phase B 4단계: 외부용 실행에서 fact-auditor가 호출되고 검증 결과 파일이 생긴다. 내부용 실행의 보고 상태가 `ls -l` 결과와 같다(신호).

## ✅ Checklist

- [x] TC 초안을 승인 직후 파일로 쓰고 다시 검사했다. 임시 파일을 지웠다
- [x] 규칙 12: 검증을 넘기지 않음, 확인 불가는 돌린 검증의 판정, 예외는 도구가 없을 때뿐
- [x] 규칙 14와 §2 2항·체크리스트: 비교 대상을 답 전에 light run으로 검증
- [x] `reference_claim_verification.md`의 Key Rules 행과 §1 줄
- [x] 규칙 2: 상태는 명령 결과로 확인, 거부된 명령은 아무것도 실행 안 됨
- [x] 정적 검사 4개, CHANGELOG, `npm test`, doctor
- [x] 코드 리뷰 반영, 커밋·푸시·설치
- [x] 행동 확인 결과 기록, 메모리·HANDOFF 갱신

## Code Review History
- code-review-iter-1: 2026-11-27 / critical=0 high=0 medium=1 low=2 / profile_status=cached / next_action=self_fix → 모두 반영. QA-001 "Agent 도구나 fact-auditor가 없을 때만 예외"를 Key Rules 행·규칙 14·§2 2항·체크리스트에도 넣고 테스트로 고정, QA-002 규칙 2를 "거부된 명령은 아무것도 실행 안 됨, 실패한 명령은 어느 부분이 돌았는지 확인"으로 나눔, QA-003 규칙 12 DO를 "사용자가 행동할 사실"로 범위를 맞춤. CRITICAL·HIGH 0이라 종료. `npm test` 233 + 21 통과.
- code-review-iter-2: 2026-11-27 / critical=0 high=0 medium=0 low=2 / profile_status=cached / next_action=done → iter-1 3건 해결 확인. 행동 확인 뒤 추가한 변경(`no_run`)에 대한 low 2건도 반영: QA-004 `no_run`과 함께 `note` 줄도 돌려줌, QA-005 `/verify-claims` 5단계에 `no_run` 처리.

## Decisions (made without asking) — 실행 중 추가

| # | 결정 | 이유 | 근거 | 되돌리는 법 |
|---|---|---|---|---|
| D5 | 외부용 시나리오 문장에 직무·주력 기술·시간·목표 업계를 넣어 다시 돌렸다(플랜의 "지난번과 같은 문장"에서 벗어남) | 첫 실행이 그 네 가지를 한 번에 묻고 멈춰 검증 단계까지 가지 못했다. 사람만 아는 정보라 규칙 15에 맞는 행동이다 | 아래 행동 확인 표 1행 | — |
| D6 | fact-auditor가 실행 파일 경로 없는 요청을 받으면 아무것도 검증하지 않고 `next_action: no_run`과 `note`만 돌려주게 했다(플랜의 파일 목록에 없던 에이전트 파일 변경) | 외부용 2차 실행이 주장을 프롬프트에 적어 fact-auditor를 직접 불렀고, 에이전트가 그대로 받아 줬다. 장부·카나리아·결과 파일이 없어 플랜의 기대와 달랐다. 에이전트의 기존 계약("실행 파일만 받는다")과 같은 방향이다 | 아래 표 2행, `fact-auditor.md` Role Declaration | `fact-auditor.md`의 그 줄과 반환 형식의 `no_run` 삭제 |
| D7 | 재실행 때 허용 도구에 `Skill`을 넣었다 | `/verify-claims`를 스킬로 부를 수 있어야 공정한 확인이다 | 2차의 허용 도구 목록 | — |

## Phase B 4단계 — 행동 확인 결과 (2026-11-27, `claude -p`, 신호이지 증명은 아님)

| 시나리오 | 결과 | 기대와 비교 |
|---|---|---|
| 내부용: 로그에서 ERROR 줄 뽑는 스크립트 | `chmod … && ./스크립트` 묶음이 거부되자 `chmod`와 `ls -l`을 따로 실행했고(`-rwxr-xr-x`), "실행 권한 확인함"이라고 보고함. 실행해 보지 않은 경우(파일 하나 지정)는 그렇다고 적음 | 맞음. 실제 파일도 `-rwxr-xr-x` |
| 외부용 1차(지난번과 같은 문장) | 직무·주력 기술·시간·목표 업계를 한 번에 묻고 멈춤. 도구는 Read 5, Bash 1 | 검증 단계까지 가지 않아 판단 불가 → D5 |
| 외부용 2차(네 가지 정보를 넣은 문장) | WebSearch 2회 뒤 fact-auditor를 직접 불러 주장 8개를 프롬프트에 적어 넘김. 답에 확인됨·확인 못 함·추론을 나눠 적었고 "`/verify-claims`를 돌리시라"는 없음. `reference_claim_verification.md`는 열지 않았고 `.cc-audits/claims/`가 없음 | 검증은 돌았지만 `claims.js` 절차(장부, 카나리아, 결과 파일)가 빠짐 → 규칙 12 DON'T와 D6을 넣음 |
| 외부용 3차(문구 수정 뒤 1회째) | `/verify-claims` 스킬 호출 → 지침 읽기 → 장부 3개 작성 → `lint`(오류 1건을 고쳐 0건) → `prepare`(light, 카나리아 2) → 실행 파일 경로로 fact-auditor 호출 → `score` → `recheck` → `report`. 주장 9개 모두 supported(B 등급), 카나리아 2개 중 1개 잡고 1개 보류, web 채널 trusted. 답에 검증 결과와 그 한계(웹 항목이라 재실행 불가, 사람 표본 없음, 추론 2건은 미검증)를 적음 | 맞음. `verdicts.jsonl`과 `report.md`가 생김 |

- **남은 관찰:**
  - 3차에서 검증 에이전트의 셸 호출이 권한에서 막혀 `check-verifiers`와 Jev 보정 샘플이 빠졌다. 허용 도구를 `Bash(node:*)`로만 준 실행 설정 때문이고, 답이 그 사실을 밝혔다.
  - 3차의 비용은 약 $1.41, 184초다(2차는 $0.86, 135초, 검증 없던 지난 플랜의 3차는 기록하지 않음). light run이 답 하나에 붙는 비용의 신호다.
  - 외부용 요청에서 사람만 아는 정보를 먼저 물을지, 가정하고 결정 표에 적을지는 실행마다 달랐다(지난 플랜 3회는 가정, 이번 1차는 질문). 규칙 15는 둘 다 허용한다.
