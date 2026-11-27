# 사실 검증 후속 — 턴 줄이기, 재확인 문구의 질, 누락된 사실, 확인 불가 비율, 위험 가중 표본, 수정 영수증

요청하신 세 묶음 중 cc-baseline 쪽(새 후보 2개와 이전 후보)을 이 플랜으로 한다. grimbang B·D는 저장소와 위험이 달라(운영 앱, 배포 확인 필요) 이 플랜이 끝나면 바로 다음 플랜으로 올린다.

## ⚡ Key Rules Summary

| ✅ DO | ❌ DON'T |
|---|---|
| 검증 절차의 스크립트 단계를 `open`(lint → prepare)과 `close`(score → recheck → report) 두 명령으로 묶어 본 세션의 턴을 줄인다 | 단계마다 명령을 하나씩 돌려 턴마다 맥락 전체를 다시 읽게 하기 |
| 재확인 문구가 주장의 기대 값을 담고 있는지 `score`가 보고, 아니면 "약한 recipe"로 표시한다 | 다른 문구를 다시 읽은 것을 "재현됨"으로만 보고하기 |
| 보고서 초안의 숫자·URL·코드 식별자 중 장부에 없는 것을 스크립트로 뽑는다(경고만) | 장부에 넣지 않은 사실을 검증된 것처럼 답에 남기기 |
| 확인 불가 비율이 높으면 `score`가 경고하고 보고서에 비율을 적는다 | 대부분 확인하지 못한 실행을 "반박 0건"으로만 보고하기 |
| 위험 가중 항목은 무작위 표본과 따로 두고 오차 상한에는 넣지 않는다 | 위험 항목을 섞어 상한 계산을 깨뜨리기 |
| 기존 명령(`lint`, `prepare`, `score`, `recheck`, `report`)은 그대로 둔다 | 기존 호출을 깨는 변경 |

## Meta
- Security Impact: Unknown
- Code Quality Impact: Yes
- UI Impact: No
- Behavior Impact: Yes
- Claim Impact: No
- Audience: internal
- Reason: `claims.js`에 명령 4개(`open`, `close`, `coverage`, `diff`)가 생기고 `score`·`sample`·`report`의 출력이 늘어난다. `coverage`가 오케스트레이터가 준 초안 파일을 읽는다(경로 검사 필요). `/verify-claims` 절차가 바뀐다.

---

## Context

- **요청(2026-11-27):** 남은 후보(재확인 문구의 질, 검증 비용, 주장 누락 검사·위험 가중 표본 등, grimbang B·D)를 "이것들도 진행해".
- **비용의 근거(지난 행동 확인 실행의 기록 `~/.claude/projects/-tmp-crw-scenario-run1`):**

  | 구간 | 모델 | 턴 | 캐시 읽기 | 환산 금액 |
  |---|---|---|---|---|
  | 본 세션 | claude-fable-5-2 | 14 | 711,540 토큰(턴당 약 5만) | $1.114 (85%) |
  | fact-auditor | claude-sonnet-5-5 | 13 | 360,498 토큰 | $0.183 (14%) |
  | 웹 요약 | claude-haiku-5-5 | — | — | $0.008 |

  - 비용은 검증 에이전트가 아니라 본 세션의 턴 수에서 나온다. 턴마다 맥락 전체를 다시 읽기 때문이다. 실제 작업 세션은 맥락이 더 커서 턴당 비용도 더 크다.
  - 본 세션 14턴의 도구 호출: Skill 1, Read 5, Write 3, Bash 10(거부된 묶음 명령 2, `ls`, `date`, `lint` 2, `prepare`, `score`, `recheck`, `report`), Edit 1, Agent 1.
- **재확인 문구의 근거:** "Svix는 주로 Rust" 주장(기대 값 Rust)의 recipe가 `Cargo.toml`의 `members = […]` 줄이었다. 그 줄에는 Rust가 없는데 `recheck`는 "재현됨"으로 셌다.
- **누락의 근거:** 같은 실행의 답에 장부에 없던 수치(Rust 1,482,037바이트)가 들어갔다. verify-before-report 외부용 3차의 답도 검증 안 된 표현 2개를 스스로 밝혔다.
- **이전 후보의 출처:** `docs/plans/claim-verification.md` "범위 밖"의 ③⑨⑩⑪⑬⑭. 11/24 천재적 사고 분석의 14개 중 남은 것이라 규칙 13은 다시 돌리지 않는다.
- **모드:** 내부용이다.

## Decisions (made without asking)

| # | 결정 | 이유 | 근거 | 되돌리는 법 |
|---|---|---|---|---|
| D1 | grimbang B·D는 이 플랜에 넣지 않고 바로 다음 플랜으로 한다 | 다른 저장소의 운영 앱이다. TC·e2e·배포 확인이 따로 필요하고, 한 플랜에 넣으면 검토와 감사가 섞인다 | HANDOFF "남은 것", grimbang 운영 반영은 사용자 확인 후 | 이 플랜 뒤에 올리지 않기 |
| D2 | "검증 비용"은 측정으로 끝내지 않고 턴 수를 줄인다 | 위 표에서 본 세션이 85%이고 턴당 약 5만 토큰을 다시 읽는다. 스크립트 단계 6개를 2개로 묶으면 턴이 준다 | 위 비용 표 | `/verify-claims`를 개별 명령으로 되돌리기 |
| D3 | fact-auditor의 모델은 바꾸지 않는다 | 이미 Sonnet으로 돌았고 전체의 14%다 | 위 비용 표 | — |
| D4 | ⑩(사전 등록 강제)는 이미 들어 있어 코드를 더하지 않는다 | `checkFreeze`가 `prepare` 뒤에 장부가 바뀌면 `score`·`recheck`·`sample`을 거절한다 | `claims.js` 721행 | — |
| D5 | ⑬(제3 채널 판정)은 하지 않는다 | 시범 실행들에서 생산자와 검증자의 판정을 가를 제3자가 필요했던 경우가 없다. D 등급은 이미 Jev로 간다 | Phase E 결과(13개 실행), 이 세션의 실행 3개 | 다음 플랜 후보로 되살리기 |
| D6 | 약한 recipe는 경고와 표시만 하고 "재현 안 됨"으로 세지 않는다 | 기대 값이 문장인 주장, 목록인 주장은 문구에 값이 그대로 있기 어렵다. 잘못 걸릴 수 있어 사람이 보게만 한다 | 기존 lint의 문장 `expected` 경고 | 표시를 `not_reproduced`로 올리기 |
| D7 | 누락 검사는 LLM이 아니라 스크립트의 토큰 대조로 한다(경고만) | 비용이 0이고 결정적이다. 숫자·URL·식별자 없는 사실은 못 잡는다는 한계를 지침에 적는다 | 위 누락의 근거 두 건이 모두 숫자·이름 토큰이다 | `coverage` 삭제 |
| D8 | 수정 영수증(⑭)은 두 실행의 장부와 판정을 비교하는 `diff`로 한다 | 생산자의 설명이 아니라 파일 비교로 "무엇이 고쳐졌나"를 보여 준다 | Phase E에서 반박 뒤 다시 돌린 실행들 | `diff` 삭제 |
| D9 | TC는 `docs/tc/claims.tc.json`에 덧붙인다 | 같은 기능의 후속이다 | 기존 43개 TC | — |

---

## 설계

### 1. 턴 줄이기 — `open`, `close` (Phase A)

- **`claims.js open <run> [--seed N] [--mode light|bulk] [--draft <file>]`**
  - `lint` → 오류가 있으면 exit 1(prepare 안 함) → `prepare` → `--draft`가 있으면 `coverage`.
  - 출력은 JSON 한 줄: lint 경고, `mode`, `items`, `canaries`, `audit_input`, `coverage`.
- **`claims.js close <run>`**
  - `score` → 실패(판정 누락, 형식 오류, 걸린 검증 스크립트)면 exit 1로 멈춘다 → `recheck` → `report`.
  - 출력은 JSON 한 줄: `counts`, `canaries`, 신뢰 못 하는 채널, `verifiers`, 재실행 수, 문제 항목, 약한 recipe, 확인 불가 비율, 경고, `report` 경로, 보고서 요약 줄.
  - 재현되지 않은 증거가 있으면 보고서는 쓰고 exit 1.
- **`templates/commands/verify-claims.md`를 다시 쓴다:**
  - 장부 3개(와 초안)는 한 메시지에서 Write로 함께 쓴다.
  - `open` → fact-auditor → `close` → 답. 화면 항목과 사람 표본 단계는 그대로 둔다.
  - 실행 이름은 `date`를 부르지 않고 짧은 이름으로 정한다. 셸은 한 번에 명령 하나만 쓴다(본 세션에도 같은 주의를 적는다).
- 기존 명령은 그대로 두고, `open`·`close`는 그 함수들을 부르기만 한다.

### 2. 재확인 문구의 질 (Phase A)

- `score`에서, SUPPORTED 판정에 recipe가 있고 주장의 `expected`가 짧은 값(숫자, 또는 40자 이하 문자열. boolean·목록·문장은 제외)이면 `contains`가 그 값을 온전한 토큰으로 담고 있는지 본다(`hasWhole` 재사용).
- 담고 있지 않으면 `score.json`의 그 주장에 `weak_recipe: true`를 남기고 경고를 낸다. 보고서 요약 줄에 `weak recipes N`을, 주장 행에 표시를 넣는다.
- fact-auditor 지침: recipe의 `contains`는 주장의 기대 값을 보여 주는 문구여야 한다.

### 3. 누락된 사실 — `coverage` (Phase A, ③)

- **`claims.js coverage <run> --draft <file>`**: 초안에서 사실처럼 보이는 토큰을 뽑아 장부(주장·전제의 `text`, `expected`, `target.ref`, `source_url`)에 온전한 토큰으로 있는지 본다.
  - 토큰: 두 자리 이상의 수와 소수·퍼센트·천 단위 구분 수, 버전, 날짜, URL, 백틱으로 싼 60자 이하 문구.
  - 출력: `tokens`, `covered`, `uncovered`(토큰, 줄 번호, 그 줄. 최대 50개). 늘 exit 0(경고).
- 초안 경로는 프로젝트 루트 안의 일반 파일이어야 한다(`recheckFile`의 경로·심볼릭 링크·비밀 파일 검사와 `readCapped` 재사용). 아니면 exit 2.
- `/verify-claims`: 걸린 토큰마다 주장으로 넣거나, 의견·계획이면 두거나, 답에 "검증 안 됨"으로 적는다.

### 4. 확인 불가 비율 (Phase A, ⑪)

- `score.json`에 `unverifiable_share`(전체와 채널별)를 넣는다.
- 주장이 4개 이상이고 30% 이상이 확인 불가면 `score`가 경고한다: "N of M claims could not be checked".
- 보고서 요약 줄의 `could not be checked N`을 `could not be checked N (x%)`로 바꾼다.

### 5. 위험 가중 표본 (Phase B, ⑨)

- `sample`이 무작위 표본과 coverage 항목 뒤에 `risk` 항목을 최대 10개 더한다.
  - 위험 점수: decision 주장, C·D 등급, 재현되지 않은 증거나 약한 recipe, 신뢰 못 하거나 시험 안 된 채널.
  - 무작위 표본과 coverage에 이미 있는 것은 뺀다. 같은 점수면 `audit_id` 순이다.
- `sample.md`에 "Risk-weighted" 절을 넣는다. 오차 상한은 지금처럼 무작위 표본으로만 계산한다(`human`이 `risk` 답을 상한에 넣지 않는지 테스트로 고정).

### 6. 수정 영수증 — `diff` (Phase B, ⑭)

- **`claims.js diff <old run> <new run>`**: 이전 실행에서 supported가 아니었던 주장을 주장 id로 맞춰 본다.
  - 새 실행에 없으면 `dropped`, `text`나 `expected`가 바뀌었으면 `corrected`(이전 값 → 새 값, 새 판정), 그대로면 `unchanged`(새 판정).
  - 새 실행 폴더에 `receipts.md`를 쓰고 JSON 한 줄을 낸다.
- 두 폴더는 같은 프로젝트의 `.cc-audits/claims/` 아래여야 한다.
- `/verify-claims`: 고쳐서 다시 돌린 실행이면 `diff`를 돌리고 답에 영수증을 붙인다.

### 7. 문서

- `reference_claim_verification.md`: §2 표(새 파일 `receipts.md`, `sample.json`의 `risk`), §4 흐름(open/close), §8 한계(coverage는 토큰 대조라 하한일 뿐, 약한 recipe는 표시일 뿐).
- `fact-auditor.md`(recipe 문구), README(영·한), CHANGELOG.

### 8. 고칠 파일

- `templates/scripts/claims.js`
- `templates/commands/verify-claims.md`, `templates/agents/fact-auditor.md`, `templates/memory/reference_claim_verification.md`
- `test/run.js`
- `docs/tc/claims.tc.json`(TC 13개, 행동 4개, 소스 2개 추가), `docs/plans/claims-followups.md`
- `README.md`, `README_KO.md`, `CHANGELOG.md`

---

## Phase A — 가벼운 실행 경로 (턴, recipe, 누락, 확인 불가)

1. Read ~/.claude/memory/phase_start.md and execute
2. 승인 직후: 아래 TC 초안을 `docs/tc/claims.tc.json`에 덧붙이고, 이 플랜을 `docs/plans/claims-followups.md`로 쓴다. 두 검사를 파일로 다시 돌린다(`.cc-audits/claims-followups/tc-check.json`).
3. `git log -3`으로 고칠 파일의 최근 변경을 확인한다(규칙 8).
4. 설계 1~4대로 `claims.js`를 고친다.
5. 테스트: `open-*`, `close-*`, `weak-recipe`, `recipe-shows-value`, `coverage-*`, `unverifiable-share`
6. `/verify-claims`, fact-auditor, 지침을 고친다. 테스트 `verify-claims-short`
7. Read ~/.claude/memory/phase_end.md and execute

## Phase B — 대량 실행 경로 (위험 표본, 영수증)

1. Read ~/.claude/memory/phase_start.md and execute
2. 설계 5·6대로 `claims.js`를 고친다.
3. 테스트: `sample-risk`, `diff-receipts`
4. 지침·README·CHANGELOG를 고친다.
5. `npm test`(240 + 새 검사, wiki 21), `node bin/cli.js --doctor`
6. Read ~/.claude/memory/phase_end.md and execute

## Phase C — 감사·설치·행동 확인

1. Read ~/.claude/memory/phase_start.md and execute
2. security-auditor와 code-reviewer를 병렬로 돌리고 반영한다. design/business 이슈는 규칙 15로 처리하고, CRITICAL·HIGH를 고치지 않고 두는 것은 사용자에게 묻는다. 최대 3회.
3. 커밋(`.claude/` 제외), develop 푸시, 이 서버에 설치, doctor 확인
4. **행동 확인(`claude -p` 1회, 신호일 뿐 증명은 아님):** 지난번과 같은 문장(사실 4개를 `/verify-claims`로 검증)과 같은 허용 목록으로 돌려 비교한다.
   - 기대:
     - 본 세션 턴이 14에서 9 이하로 준다. `open`과 `close`를 쓴다.
     - 환산 금액이 $1.31보다 낮다(같은 모델 기준).
     - `Cargo.toml` 같은 recipe가 다시 나오면 약한 recipe로 표시된다.
   - 기대와 다르면 문구를 고치고 다시 돌린다(최대 2회). 실행당 약 $1 안팎으로 예상한다(지난 실행 $1.31 기준).
   - 결과는 턴 수·토큰·금액 표로 플랜 끝에 적는다.
5. 메모리와 HANDOFF를 갱신하고 임시 폴더를 정리한다.
6. Read ~/.claude/memory/phase_end.md and execute
7. grimbang B·D 플랜을 올린다(D1).

---

## Test Cases (draft)

cc-baseline 자체의 TC(`surface: cli`)다. 승인 직후 `docs/tc/claims.tc.json`에 덧붙인다. 아래 JSON은 추가분만 담았다(`ACT.claims.sample`, `ACT.claims.install-guides`는 이미 파일에 있다). 기대 결과는 `npm test`가 실행 결과 파일과 템플릿 내용으로 확인한다(`artifact` 채널).

| TC ID | 제목 | surface | readiness | 기대 결과 수 |
|---|---|---|---|---|
| TC.claims.open-prepares | `open`이 lint와 prepare를 한 번에 한다 | cli | ready | 3 |
| TC.claims.open-lint-stops | lint 오류면 `open`이 멈춘다 | cli | ready | 2 |
| TC.claims.close-one-call | `close`가 score·recheck·report를 한 번에 한다 | cli | ready | 5 |
| TC.claims.close-missing-verdict | 판정이 빠지면 `close`가 멈춘다 | cli | ready | 2 |
| TC.claims.close-not-reproduced | 재현 안 된 증거가 있으면 보고서를 쓰고 exit 1 | cli | ready | 2 |
| TC.claims.weak-recipe | 기대 값이 없는 recipe는 약한 recipe로 표시된다 | cli | ready | 2 |
| TC.claims.recipe-shows-value | 기대 값이 있는 recipe는 표시되지 않는다 | cli | ready | 1 |
| TC.claims.coverage-uncovered | 초안의 토큰 중 장부에 없는 것을 뽑는다 | cli | ready | 3 |
| TC.claims.coverage-outside-refused | 프로젝트 밖 초안은 거절한다 | cli | ready | 1 |
| TC.claims.unverifiable-share | 확인 불가가 많으면 경고하고 비율을 적는다 | cli | ready | 2 |
| TC.claims.sample-risk | 표본에 위험 가중 항목이 따로 붙는다 | cli | ready | 2 |
| TC.claims.diff-receipts | `diff`가 고쳐진 주장과 빠진 주장을 적는다 | cli | ready | 2 |
| TC.claims.verify-claims-short | `/verify-claims`가 open·close를 쓴다 | cli | ready | 3 |

**검사 요약 (표준 입력):**
- `tc-lint`: 처음 경고 1건(`run_data`, 기대 결과 문장에 URL)을 문장을 고쳐 0건으로 만들었다.
- `tc-jev-check`(jev-1.14.0, 30문장): `jev_screen` 경고 4건을 남겼다. 모두 채널이 `artifact`(파일 존재, 종료 코드)라 화면 판정이 아니다.
- 열린 질문은 없다.

```json
{
 "schema_version": 1,
 "feature": "claims",
 "title": "Claim verification follow-ups: fewer turns, recipe quality, omitted facts, unverifiable share, risk sample, correction receipts",
 "plan": "claims-followups",
 "sources": [
  {"id": "REQ.claims-followups", "kind": "requirement", "locator": "docs/plans/claims-followups.md"},
  {"id": "SRC.claims-run1-cost", "kind": "source", "locator": "claims-recheck-web behavior check 2026-11-27: the main session took 14 turns and 85% of the run's cost (cost-state of the run); the 'mainly Rust' claim was re-read on a Cargo.toml line that does not show Rust"}
 ],
 "actions": [
  {"id": "ACT.claims.open", "title": "Lint and prepare a run in one call", "actor": "orchestrator", "trigger": "runs claims.js open <run dir>", "preconditions": ["claims.jsonl is written"], "outputs": ["audit-input.jsonl", "one JSON line with the lint and prepare results"], "evidence_refs": ["REQ.claims-followups"]},
  {"id": "ACT.claims.close", "title": "Score, re-read and report in one call", "actor": "orchestrator", "trigger": "runs claims.js close <run dir>", "preconditions": ["the run was prepared", "verdicts.jsonl exists"], "outputs": ["score.json", "recheck.json", "report.md", "one JSON line with the counts and the report path"], "evidence_refs": ["REQ.claims-followups"]},
  {"id": "ACT.claims.coverage", "title": "List fact-like tokens of a draft that no claim holds", "actor": "orchestrator", "trigger": "runs claims.js coverage <run dir> --draft <file>", "preconditions": ["claims.jsonl is written", "the draft is a file inside the project"], "outputs": ["a list of uncovered tokens with their draft lines"], "evidence_refs": ["REQ.claims-followups"]},
  {"id": "ACT.claims.diff", "title": "Show what changed between two runs of the same report", "actor": "orchestrator", "trigger": "runs claims.js diff <old run dir> <new run dir>", "preconditions": ["both runs have score.json"], "outputs": ["receipts.md in the new run dir"], "evidence_refs": ["REQ.claims-followups"]}
 ],
 "test_cases": [
  {"id": "TC.claims.open-prepares", "title": "open lints and prepares a clean ledger", "action_refs": ["ACT.claims.open"], "level": "functional", "surface": "cli", "preconditions": ["claims.jsonl holds 3 valid db claims"], "steps": [{"goal": "Run claims.js open on the run dir", "done_when": {"expect": "The command exits"}}], "expected": [{"text": "The exit code is 0", "observe": {"channel": "artifact", "key": "exit code"}}, {"text": "audit-input.jsonl exists in the run dir", "observe": {"channel": "artifact", "key": "audit-input.jsonl"}}, {"text": "The output names the mode light", "observe": {"channel": "artifact", "key": "stdout .mode"}}], "basis": {"kind": "requirement", "refs": ["REQ.claims-followups", "SRC.claims-run1-cost"]}, "readiness": "ready"},
  {"id": "TC.claims.open-lint-stops", "title": "open stops at a lint error", "action_refs": ["ACT.claims.open"], "level": "functional", "surface": "cli", "preconditions": ["one claim in claims.jsonl has no channel"], "steps": [{"goal": "Run claims.js open on the run dir", "done_when": {"expect": "The command exits"}}], "expected": [{"text": "The exit code is 1", "observe": {"channel": "artifact", "key": "exit code"}}, {"text": "No audit-input.jsonl is written", "observe": {"channel": "artifact", "key": "audit-input.jsonl"}}], "basis": {"kind": "requirement", "refs": ["REQ.claims-followups"]}, "readiness": "ready"},
  {"id": "TC.claims.close-one-call", "title": "close scores, re-reads and reports", "action_refs": ["ACT.claims.close"], "level": "functional", "surface": "cli", "preconditions": ["the run was prepared and every item has a verdict", "one verdict has a file recipe that reproduces"], "steps": [{"goal": "Run claims.js close on the run dir", "done_when": {"expect": "The command exits"}}], "expected": [{"text": "The exit code is 0", "observe": {"channel": "artifact", "key": "exit code"}}, {"text": "score.json exists in the run dir", "observe": {"channel": "artifact", "key": "score.json"}}, {"text": "recheck.json exists in the run dir", "observe": {"channel": "artifact", "key": "recheck.json"}}, {"text": "report.md exists in the run dir", "observe": {"channel": "artifact", "key": "report.md"}}, {"text": "The output names the path of report.md", "observe": {"channel": "artifact", "key": "stdout .report"}}], "basis": {"kind": "requirement", "refs": ["REQ.claims-followups", "SRC.claims-run1-cost"]}, "readiness": "ready"},
  {"id": "TC.claims.close-missing-verdict", "title": "close stops when a verdict is missing", "action_refs": ["ACT.claims.close"], "level": "functional", "surface": "cli", "preconditions": ["the run was prepared", "one item has no verdict line"], "steps": [{"goal": "Run claims.js close on the run dir", "done_when": {"expect": "The command exits"}}], "expected": [{"text": "The exit code is 1", "observe": {"channel": "artifact", "key": "exit code"}}, {"text": "No report.md is written", "observe": {"channel": "artifact", "key": "report.md"}}], "basis": {"kind": "requirement", "refs": ["REQ.claims-followups"]}, "readiness": "ready"},
  {"id": "TC.claims.close-not-reproduced", "title": "close reports evidence that did not come back", "action_refs": ["ACT.claims.close"], "level": "functional", "surface": "cli", "preconditions": ["the run was prepared and every item has a verdict", "one verdict has a file recipe whose text is not in the file"], "steps": [{"goal": "Run claims.js close on the run dir", "done_when": {"expect": "The command exits"}}], "expected": [{"text": "The exit code is 1", "observe": {"channel": "artifact", "key": "exit code"}}, {"text": "report.md counts 1 claim under evidence did not reproduce", "observe": {"channel": "artifact", "key": "report.md summary line"}}], "basis": {"kind": "requirement", "refs": ["REQ.claims-followups"]}, "readiness": "ready"},
  {"id": "TC.claims.weak-recipe", "title": "A recipe that does not show the expected value is marked weak", "action_refs": ["ACT.claims.close"], "level": "functional", "surface": "cli", "preconditions": ["the claim of A-0001 expects the value Rust", "the SUPPORTED verdict of A-0001 has a file recipe containing members = [\"svix-server\"]", "the file holds that line"], "steps": [{"goal": "Run claims.js close on the run dir", "done_when": {"expect": "The command exits"}}], "expected": [{"text": "score.json marks the claim of A-0001 as a weak recipe", "observe": {"channel": "artifact", "key": "score.json .claims[…].weak_recipe"}}, {"text": "report.md counts 1 weak recipe", "observe": {"channel": "artifact", "key": "report.md summary line"}}], "basis": {"kind": "requirement", "refs": ["REQ.claims-followups", "SRC.claims-run1-cost"]}, "readiness": "ready"},
  {"id": "TC.claims.recipe-shows-value", "title": "A recipe that shows the expected value is not marked", "action_refs": ["ACT.claims.close"], "level": "functional", "surface": "cli", "preconditions": ["the claim of A-0001 expects the value MIT", "the SUPPORTED verdict of A-0001 has a file recipe containing \"spdx_id\":\"MIT\"", "the file holds that line"], "steps": [{"goal": "Run claims.js close on the run dir", "done_when": {"expect": "The command exits"}}], "expected": [{"text": "score.json does not mark the claim of A-0001 as a weak recipe", "observe": {"channel": "artifact", "key": "score.json .claims[…].weak_recipe"}}], "basis": {"kind": "requirement", "refs": ["REQ.claims-followups"]}, "readiness": "ready"},
  {"id": "TC.claims.coverage-uncovered", "title": "coverage lists draft tokens that no claim holds", "action_refs": ["ACT.claims.coverage"], "level": "functional", "surface": "cli", "preconditions": ["claims.jsonl holds one claim: Table orders has 27 rows", "draft.md line 3 reads The API answers in 340 ms at https://api.example.org/health"], "steps": [{"goal": "Run claims.js coverage on the run dir with the draft", "done_when": {"expect": "The command exits"}}], "expected": [{"text": "The output lists 340 as uncovered on line 3", "observe": {"channel": "artifact", "key": "stdout .uncovered"}}, {"text": "The output lists the draft's URL as uncovered on line 3", "observe": {"channel": "artifact", "key": "stdout .uncovered"}}, {"text": "The output does not list 27", "observe": {"channel": "artifact", "key": "stdout .uncovered"}}], "basis": {"kind": "requirement", "refs": ["REQ.claims-followups"]}, "readiness": "ready"},
  {"id": "TC.claims.coverage-outside-refused", "title": "coverage refuses a draft outside the project", "action_refs": ["ACT.claims.coverage"], "level": "functional", "surface": "cli", "preconditions": ["the draft path points outside the project root"], "steps": [{"goal": "Run claims.js coverage on the run dir with that draft", "done_when": {"expect": "The command exits"}}], "expected": [{"text": "The exit code is 2", "observe": {"channel": "artifact", "key": "exit code"}}], "basis": {"kind": "requirement", "refs": ["REQ.claims-followups"]}, "readiness": "ready"},
  {"id": "TC.claims.unverifiable-share", "title": "A run that checked little says so", "action_refs": ["ACT.claims.close"], "level": "functional", "surface": "cli", "preconditions": ["the run was prepared with 4 claims", "2 of the 4 claims have the verdict UNVERIFIABLE"], "steps": [{"goal": "Run claims.js close on the run dir", "done_when": {"expect": "The command exits"}}], "expected": [{"text": "The warning output says 2 of 4 claims could not be checked", "observe": {"channel": "artifact", "key": "stderr"}}, {"text": "report.md shows could not be checked 2 (50%)", "observe": {"channel": "artifact", "key": "report.md summary line"}}], "basis": {"kind": "requirement", "refs": ["REQ.claims-followups"]}, "readiness": "ready"},
  {"id": "TC.claims.sample-risk", "title": "The human sample adds risk-weighted items outside the bound", "action_refs": ["ACT.claims.sample"], "level": "functional", "surface": "cli", "preconditions": ["a bulk run was scored", "3 claims are decision claims judged at grade C", "the random draw of 5 does not hold them"], "steps": [{"goal": "Run claims.js sample on the run dir with --n 5", "done_when": {"expect": "The command exits"}}], "expected": [{"text": "sample.json lists the 3 claims under risk", "observe": {"channel": "artifact", "key": "sample.json .risk"}}, {"text": "sample.json keeps 5 items in the random sample", "observe": {"channel": "artifact", "key": "sample.json .items"}}], "basis": {"kind": "requirement", "refs": ["REQ.claims-followups"]}, "readiness": "ready"},
  {"id": "TC.claims.diff-receipts", "title": "diff lists what was corrected between two runs", "action_refs": ["ACT.claims.diff"], "level": "functional", "surface": "cli", "preconditions": ["the old run refuted claim C-0002 (expected 27)", "the new run has C-0002 with expected 31 judged SUPPORTED", "claim C-0003, refuted in the old run, is not in the new run"], "steps": [{"goal": "Run claims.js diff on the old and the new run dir", "done_when": {"expect": "The command exits"}}], "expected": [{"text": "receipts.md lists C-0002 as corrected from 27 to 31", "observe": {"channel": "artifact", "key": "receipts.md"}}, {"text": "receipts.md lists C-0003 as dropped", "observe": {"channel": "artifact", "key": "receipts.md"}}], "basis": {"kind": "requirement", "refs": ["REQ.claims-followups"]}, "readiness": "ready"},
  {"id": "TC.claims.verify-claims-short", "title": "/verify-claims uses open and close", "action_refs": ["ACT.claims.install-guides"], "level": "functional", "surface": "cli", "preconditions": ["templates/commands/verify-claims.md"], "steps": [{"goal": "Read the command's steps", "done_when": {"expect": "The steps are read"}}], "expected": [{"text": "The command prepares the run with claims.js open", "observe": {"channel": "artifact", "key": "verify-claims.md steps"}}, {"text": "The command finishes the run with claims.js close", "observe": {"channel": "artifact", "key": "verify-claims.md steps"}}, {"text": "The command says to write the ledger files in one message", "observe": {"channel": "artifact", "key": "verify-claims.md steps"}}], "basis": {"kind": "requirement", "refs": ["REQ.claims-followups", "SRC.claims-run1-cost"]}, "readiness": "ready"}
 ],
 "open_questions": []
}
```

## E2E

- 화면이 없다. 위 TC 13개는 `npm test`로 확인한다(외부 요청 없음).
- 실제 동작은 Phase C 4단계의 `claude -p` 한 번으로 신호를 본다.

## 검증

- `npm test` 전부 통과(240 + 새 검사), wiki 테스트 21 통과
- `node bin/cli.js --doctor` 14 ok
- Phase C 4단계: 턴 수·금액을 지난 실행(14턴, $1.31)과 비교한다.

## ✅ Checklist

- [x] TC를 `claims.tc.json`에 덧붙이고 다시 검사했다
- [x] `open`·`close`가 기존 함수를 부르고, 기존 명령은 그대로 동작한다
- [x] 약한 recipe 표시, `coverage`, 확인 불가 비율과 경고
- [x] `sample`의 `risk` 항목(상한 밖), `diff`와 `receipts.md`
- [x] `/verify-claims`·fact-auditor·지침·README·CHANGELOG
- [x] 보안 감사와 코드 리뷰 반영, 커밋·푸시·설치
- [x] 행동 확인 결과(턴·금액 비교) 기록, 메모리·HANDOFF 갱신
- [x] grimbang B·D 플랜을 올렸다

## Decisions (made without asking) — 실행 중 추가

| # | 결정 | 이유 | 근거 | 되돌리는 법 |
|---|---|---|---|---|
| D10 | (QA-002, design) 누락 검사에서 숫자는 주장의 `text`·`expected`에 있을 때만 "있음"으로 보고, 코드 이름은 온전한 토큰으로 맞춘다. 퍼센트·부호의 느슨함은 한계로 지침에 적는다 | `src/12.js` 같은 경로나 URL 속 숫자가 초안의 12를 덮으면 안 된다. `id`가 `identifier`에 덮이는 것도 같다 | 코드 리뷰 QA-002 | `held`의 분기 되돌리기 |
| D11 | (QA-003, business) 숫자 앞의 한글·다른 문자는 허용하고 라틴 문자만 이름의 일부로 본다(`v2`, `ES2022`는 제외, `약30명`은 포함) | 한국어 초안은 숫자를 낱말에 붙여 쓴다 | 코드 리뷰 QA-003 | 정규식의 lookbehind를 `\p{L}`로 |
| D12 | (QA-004, business) 약한 recipe 검사에서 한두 글자 낱말(`no`, `on`)은 보지 않고, `30 %`는 `30%`로 본다 | 한두 글자는 거의 모든 문구에 들어 있어 검사가 뜻이 없다 | 코드 리뷰 QA-004 | `shortValue`의 조건 삭제 |
| D13 | (QA-005, design) `diff`는 `report.json`이 `score.json`보다 오래됐으면 쓰지 않고, 기대 값은 키 순서를 맞춘 형태로 비교한다. id가 바뀌면 다른 사실끼리 비교된다는 점은 지침에 적는다 | 오래된 보고서는 이전 집계의 상태다 | 코드 리뷰 QA-005 | `runStatuses`의 mtime 비교 삭제 |
| D14 | (QA-007, design) 위험 항목을 만들 때 재실행 결과가 없거나 오래됐으면 `sample.json`의 `risk_basis`와 `sample.md`에 적는다. 위험 항목의 사람 답도 coverage 항목처럼 Jev 라벨로 쓴다 | 조용히 빠지는 것이 문제였다. 라벨 처리는 coverage 항목과 같게 둔다 | 코드 리뷰 QA-007 | — |
| D15 | (SEC-001) 초안은 금지 경로와 키 폴더 밖이어야 하고, 실행 폴더 안에서는 `draft.md`만 허용한다 | 프로젝트 루트가 키 폴더를 품는 경우 카나리아 키가 초안으로 읽혀 출력에 나올 수 있었다. 실행 폴더의 다른 파일은 실행 자체의 자료다 | 보안 감사 SEC-001(재현됨) | `readDraft`의 두 검사 삭제 |

## Audit History
- iter-1: 2026-11-27 / critical=0 high=0 medium=3 low=1 / next_action=self_fix → 모두 반영. SEC-001 → D15. SEC-002: 줄마다 `clip`을 한 번만 하고 50개를 넘으면 세기만 한다. 줄은 앞 4,000자만 읽는다(15,000개 숫자가 든 100 KB 한 줄이 26초 → 테스트 상한 5초 안). SEC-003: 토큰을 가리고 200자로 자르며 URL은 쿼리를 뺀다. 200자 넘는 토큰은 맞춰 보지 않는다. 오류 메시지는 첫 줄 300자만 찍는다. SEC-004: `receipts.md`를 심볼릭 링크로는 쓰지 않고, 셀의 `| < > [ ]` 백틱을 이스케이프한다. CRITICAL·HIGH 0이라 종료(수정 뒤 재감사는 하지 않았고 테스트로 확인했다).

## Code Review History
- code-review-iter-1: 2026-11-27 / critical=0 high=0 medium=1 low=7 / profile_status=cached / next_action=self_fix → 모두 반영. QA-001(MEDIUM): 숫자 정규식이 뒤의 쉼표를 삼켜 `100, 200`의 100을 "없음"으로 냈다. 천 단위 묶음만 허용하게 고쳤다. QA-002 → D10, QA-003 → D11, QA-004 → D12, QA-005 → D13, QA-006: `open`이 초안을 prepare 전에 검사한다. QA-007 → D14, QA-008: 빠진 테스트(쉼표, 50개 상한, 이전 형식 파일, 집계 없는 새 실행, 객체 기대 값)를 넣었다. CRITICAL·HIGH 0이라 종료. `npm test` 248 + 21 통과.

## Phase C 4단계 — 행동 확인 결과 (2026-11-27, `claude -p` 1회, 신호이지 증명은 아님)

지난 실행(claims-recheck-web)과 같은 문장, 같은 허용 목록, 같은 모델로 돌렸다.

| | 지난 실행 | 이번 실행 |
|---|---|---|
| 본 세션 턴 | 14 | 9 |
| 본 세션 캐시 읽기 | 711,540 토큰 | 429,565 토큰 |
| 본 세션 캐시 쓰기 | 47,884 토큰 | 46,108 토큰 |
| 본 세션 환산 금액 | $1.114 | $0.988 |
| fact-auditor 턴 / 환산 금액 | 13 / $0.183 | 7 / $0.132 |
| 전체 환산 금액 | $1.306 | $1.121 |
| 걸린 시간 | 105초 | 68초 |

- **기대와 비교:**
  - 턴 9 이하: 맞음. `open`과 `close`를 썼고, 장부 3개와 `draft.md`를 한 메시지에서 썼다.
  - 금액이 $1.31보다 낮음: 맞음(14% 감소).
  - 약한 recipe: 이번에는 나오지 않았다. "주로 Rust" 주장의 recipe가 `"language":"Rust"`로, 기대 값을 담았다. 표시 자체는 `npm test`로만 확인됐다.
- **결과:** 주장 4개 모두 supported(B), 카나리아 2/2, 증거 재실행 4/4 재현, 스크립트 점검 파일 2개 문제 0, Jev 샘플 1개. 누락 검사는 초안의 토큰 2개가 모두 장부에 있다고 냈다.
- **관찰:**
  - 9턴 중 3턴은 낭비였다. `claims.js open oss-license-1`처럼 실행 이름만 넘겨 "no run dir"가 났고, `--help`와 `pwd`를 거쳐 전체 경로로 다시 돌렸다. 실행 이름만 넘겨도 프로젝트 루트에서는 찾게 `runPaths`를 고치고 명령 문서에 적었다(테스트 추가, 다시 돌려 확인하지는 않았다).
  - 턴은 36% 줄었는데 금액은 14%만 줄었다. 캐시 읽기는 40% 줄었지만 캐시 쓰기(약 4.6만 토큰)는 그대로다. 새 세션이 처음 맥락을 올리는 비용이 금액의 큰 몫으로 보인다(단가를 확인하지 못해 추정이다). `claude -p`는 매번 새 세션이라 이 비용을 매번 낸다. 이미 열려 있는 작업 세션에서는 이 몫이 없고 턴 수에 비례하는 몫만 든다.
