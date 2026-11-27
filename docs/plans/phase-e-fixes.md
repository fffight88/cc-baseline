# Phase E 결함 수정 — 첫 실제 프로젝트 사실 검증에서 나온 E1~E5

ERP 프로젝트(사용자 기기)에서 `/verify-claims`를 13번 돌린 결과(`docs/plans/claim-verification-d-fixes.md` §Phase E 결과)를 보면, 검증 기능의 원래 목적은 동작했다. 생산자가 놓친 틀린 전제를 실제로 잡았다. 다만 고칠 곳 다섯 가지가 나왔다. 이 플랜이 그것을 고친다. 끝나면 저장해 둔 `docs/plans/work-judgment.md`(모드·묻지 말고 결정) 작업으로 돌아간다.

## ⚡ Key Rules Summary

| ✅ DO | ❌ DON'T |
|---|---|
| 코드의 구조 사실(있다, 선언된다, 호출한다, 설정돼 있다)을 다시 돌릴 수 있는 명령으로 읽었으면 B 등급을 준다 | 코드에서 실행 시 동작(실행된다, 쓰인다, 순서, 효과)을 추론하고 B 이상을 주기 |
| code 채널 B 판정에 recheck 레시피가 없으면 `score`가 C로 본다 | 검증자의 등급을 그대로 믿기 |
| `expected`는 주장이 말하는 값 하나(숫자, 이름, 참·거짓)로 쓴다 | 문장 전체를 `expected`로 두어 카나리아가 우연히 참이 되게 하기 |
| 실데이터 화면 스윕은 `sweep_labels: "redact"`로 컨트롤 글자를 남기지 않는다 | 실명 같은 화면 글자를 결과 파일에 남기기 |
| axe-core는 로컬 설치본(`~/.claude/vendor`)으로만 주입한다 | 외부 CDN 스크립트를 사용자 화면에 넣기 |
| 오케스트레이터는 검증자의 요약이 아니라 결과 파일에서 센다 | 반환 요약의 숫자를 그대로 보고하기 |

## Meta
- Security Impact: Yes
- Code Quality Impact: Yes
- UI Impact: No
- Behavior Impact: Yes
- Claim Impact: No
- Audience: internal
- Reason: 외부 CDN 스크립트 주입을 없애고 로컬 패키지를 설치한다(설치기 변경). 스윕 결과의 화면 글자를 가린다(개인정보). 검증 등급 규칙이 바뀌어 decision 주장의 판정 결과가 달라진다.

---

## Context

- **근거:** ERP 세션의 Phase E 보고(2026-11-27, 숫자·요약만, 그 세션이 사용자 승인 뒤 보냄).
  - 대표 실행: 주장 28 중 not_established 6
  - 7차: 카나리아 9/21만 잡았고 untrusted 204
  - 스윕 결과에 실명 링크가 남음
  - CDN axe가 분류기에 막힘
- **결함 원인(코드에서 확인):**
  - E1: `fact-auditor.md` 등급 표와 지침 §3에서 코드 읽기는 늘 C다. `claims.js score`는 `impact: decision`이면서 C·D면 `not_established`로 둔다. 그래서 구조 사실의 decision 주장은 늘 확정되지 못한다.
  - E2: `lint`는 `expected`의 길이·모양을 보지 않는다. `mutateSwap`은 긴 문장 값도 바꾼다.
  - E3: 검증자 요약과 결과 파일이 한 번 어긋났다. 지침은 오케스트레이터가 무엇을 읽어야 하는지 말하지 않는다.
  - E4: `tc-sweep.js`는 `fail`·`skipped` 항목에 컨트롤 이름(최대 80자)을 그대로 적는다.
  - E5: `publisher.md` Step 6.4가 `https://cdn.jsdelivr.net/npm/axe-core@4/axe.min.js`를 `<script>`로 넣는다.
- **이미 고쳐 둔 것:** Mac 뱅크 `projects` 0은 `c0d50b4`(claims-run `project`)를 전파하면 새 샘플부터 풀린다.

## Decisions (made without asking)

사용자가 2026-11-27에 정한 원칙("고르게 하지 말고 풀어서 결정")에 따라 정했다.

| 결정 | 이유 | 근거 | 되돌리는 법 |
|---|---|---|---|
| E1은 "구조 사실 + 재실행 레시피 = B"로 하고, 실행 시 동작 추론은 C로 남긴다 | C11 교훈은 동작 추론이 약하다는 것이지 구조 사실이 약하다는 것이 아니다. 구조 사실은 코드가 1차 자료다 | ERP not_established 11건이 모두 코드 구조 주장이었다. recheck reproduced 26/30 | 등급 표 한 줄과 `score`의 확인 한 줄을 되돌린다 |
| B 등급 code 판정에 레시피가 없으면 `score`가 C로 본다 | D1(등급 부풀림) 재발 방지. 검증자 판단을 코드로 묶는다 | Phase D D1 | `score` 조건을 지운다 |
| `expected`가 40자를 넘거나 여섯 단어 이상이면 경고하고, 그런 주장으로는 값 바꾸기 카나리아를 만들지 않는다 | 7차 9/21, 7b차(값 하나로 바꿈) 15/16 | ERP 보고 | 기준 상수 하나 |
| 스윕은 `tc-run.json`의 `sweep_labels: "redact"`일 때 이름 대신 `<label:sha8>`(이름의 SHA-256 앞 8자리)과 태그를 적는다. 기본값은 지금 그대로다 | 개발 데이터 화면에서는 이름이 디버깅에 필요하다. 실데이터 화면은 실행 파일에서 켠다 | ERP는 실데이터 화면에서 스크립트를 쓰지 못하고 손으로 훑었다 | 필드를 지우면 지금 동작이다 |
| axe-core는 설치 때 `npm install --prefix ~/.claude/vendor axe-core@4`로 깔고, publisher는 `page.addScriptTag({ path })`로 넣는다. 없으면 스캔을 건너뛰고 `a11y: skipped (axe-core not installed)`로 적는다. CDN 대체 경로는 없앤다 | 외부 스크립트를 사용자 화면에 넣는 것은 데이터 유출 경로다. 분류기도 막았다 | ERP 보고 | 설치기 함수와 publisher 한 단락 |

---

## 설계

### E1 — 코드 구조 사실의 등급 (`claims.js`, `fact-auditor.md`, `reference_claim_verification.md`)
- 등급 표: "코드 구조 사실을 다시 돌릴 수 있는 명령(`recheck` 레시피: file/grep 종류)으로 읽음 → B"를 추가한다. "코드에서 실행 시 동작 추론 → C"는 그대로다. 예시를 쌍으로 넣는다. 구조 예는 "`/api/x` 경로에 `@PreAuthorize("hasRole('ADMIN')")`가 붙어 있다", 동작 예는 "이 함수는 실행되지 않는다".
- `score`: `channel: code` 이고 `grade: B`인데 `recheck`가 없으면 C로 보고 상태를 정한다. `score.json` 항목에 `grade_capped: "B→C (no recheck recipe)"`를 남긴다.
- recheck가 `differs`·`failed`면 지금처럼 `not_reproduced`다.

### E2 — 값 하나인 `expected` (`claims.js`)
- `lint` 경고: 문자열 `expected`가 40자를 넘거나 공백으로 나눈 단어가 6개 이상이면 "`expected`는 주장이 말하는 값 하나로 쓴다(숫자·이름·참거짓). 문장 전체는 카나리아를 우연히 참으로 만든다"라고 경고한다.
- `mutateSwap`: 자기 값이나 상대 값이 그 기준을 넘으면 바꾸지 않는다.

### E3 — 결과 파일 기준 (`commands/verify-claims.md`, 지침 §4)
- "검증자의 반환 요약은 길잡이일 뿐이다. 보고하는 숫자는 `verdicts.jsonl`·`score.json`·`report.json`에서 읽는다"를 넣는다.

### E4 — 스윕 글자 가리기 (`tc-sweep.js`, `e2e-tester.md`, `reference_test_env.md`)
- `tc-run.json`의 `sweep_labels: "redact"`이면 `fail`·`skipped`의 `control`과 그 밖에 결과에 들어가는 화면 글자를 `<label:sha8>`로 바꾼다.
- e2e-tester와 테스트 환경 지침에 "실데이터 화면은 `sweep_labels: "redact"`"를 넣는다.

### E5 — 로컬 axe-core (`src/installers/`, `src/install.js`, `src/doctor.js`, `publisher.md`, `reference_browser_tools.md`)
- 새 설치기 `src/installers/axe.js`: `playwright-mcp.js` 모양을 그대로 따른다(이미 있으면 건너뜀, npm 없으면 안내, `--skip-scanners`면 건너뜀). 경로는 `~/.claude/vendor/node_modules/axe-core/axe.min.js`이다(프로젝트 설치도 전역 vendor를 쓴다).
- doctor: 위 파일이 없으면 `warn('axe-core (local)', …)`.
- publisher Step 6.4: `addScriptTag({ path: '<vendor 경로>' })`(Aside와 Playwright 모두 `page` API). 파일이 없으면 건너뛰고 기록한다. CDN 문장을 지운다.
- `reference_browser_tools.md`의 CSP/CDN 행을 고친다.

### 문서
- `CHANGELOG [Unreleased]`, README·README_KO(설치 도구 목록에 axe-core), `docs/install-details.md`(vendor 폴더).

---

## Phase A — 검증 등급·expected·결과 파일 (E1~E3)

1. Read ~/.claude/memory/phase_start.md and execute
2. 승인 직후: 아래 TC 초안을 `docs/tc/phase-e-fixes.tc.json`으로, 플랜을 `docs/plans/phase-e-fixes.md`로 쓴다. 검사 두 개를 다시 돌린다(`.cc-audits/phase-e-fixes/tc-check.json`).
3. `git log -3`으로 `claims.js`, `tc-sweep.js`, `publisher.md`, `src/install.js`, `src/doctor.js`의 최근 변경을 확인한다(규칙 8).
4. E1·E2·E3을 고치고 테스트를 추가한다(TC code-structure-b, code-b-needs-recipe, sentence-expected, no-sentence-swap).
5. `npm test`
6. Read ~/.claude/memory/phase_end.md and execute

## Phase B — 스윕 가리기·로컬 axe (E4~E5)

1. Read ~/.claude/memory/phase_start.md and execute
2. E4를 고치고 테스트한다(TC sweep-redact, 로컬 HTTP 서버와 Chromium, 브라우저가 없으면 기존처럼 건너뜀).
3. E5를 고친다. 설치기·doctor·publisher·browser 지침. 테스트는 TC local-axe, doctor-axe.
4. 문서를 고친다.
5. `npm test`, `node bin/cli.js --doctor`
6. Read ~/.claude/memory/phase_end.md and execute

## Phase C — 감사·설치·푸시

1. Read ~/.claude/memory/phase_start.md and execute
2. security-auditor와 code-reviewer를 병렬로 돌리고 반영한다.
3. 커밋(`.claude/` 제외), develop 푸시, 이 서버에 설치(axe-core 설치 확인), doctor 확인.
4. HANDOFF·메모리를 갱신하고, ERP 세션에 전파 안내를 보낸다(무엇이 바뀌었는지, 숫자만).
5. Read ~/.claude/memory/phase_end.md and execute
6. 저장된 `docs/plans/work-judgment.md` 작업으로 돌아간다.

---

## Test Cases (draft)

cc-baseline 자체의 TC(`surface: cli`)다. 승인 직후 `docs/tc/phase-e-fixes.tc.json`으로 쓴다. 기대 결과는 모두 종료 코드·출력·파일 내용으로 확인한다(`artifact` 채널, 코드 판정).

| TC ID | 제목 | surface | readiness | 기대 결과 수 |
|---|---|---|---|---|
| TC.phase-e-fixes.code-structure-b | 재실행 가능한 코드 근거의 B 등급 decision 주장은 supported | cli | ready | 1 |
| TC.phase-e-fixes.code-b-needs-recipe | 레시피 없는 code B는 C로 본다 | cli | ready | 1 |
| TC.phase-e-fixes.sentence-expected | 문장 전체 expected는 lint 경고 | cli | ready | 1 |
| TC.phase-e-fixes.no-sentence-swap | 긴 expected로는 값 바꾸기 카나리아를 만들지 않는다 | cli | ready | 1 |
| TC.phase-e-fixes.sweep-redact | 가리기 스윕은 화면 글자를 남기지 않는다 | cli | ready | 2 |
| TC.phase-e-fixes.local-axe | publisher는 로컬 axe-core를 쓴다 | cli | ready | 2 |
| TC.phase-e-fixes.doctor-axe | 로컬 axe-core가 없으면 doctor가 경고한다 | cli | ready | 1 |

검사 요약 (표준 입력): `tc-lint` 7 TC 경고 0건, `tc-jev-check`(jev-1.14.0, 9문장) 경고 0건. 열린 질문은 없다(위 Decisions 표로 정함).

```json
{
 "schema_version": 1,
 "feature": "phase-e-fixes",
 "title": "Fixes from the first real-project claim runs (Phase E)",
 "plan": "phase-e-fixes",
 "sources": [
  {"id": "REQ.phase-e-plan", "kind": "requirement", "locator": "docs/plans/phase-e-fixes.md (approved 2026-11-27)"},
  {"id": "OBS.phase-e", "kind": "source", "locator": "docs/plans/claim-verification-d-fixes.md §Phase E 결과 (ERP session report 2026-11-27: E1-E5)"}
 ],
 "actions": [
  {"id": "ACT.phase-e-fixes.score", "title": "Score a claims run", "actor": "orchestrator", "trigger": "runs claims.js score <run dir>", "preconditions": ["verdicts for every item"], "outputs": ["score.json"], "evidence_refs": ["OBS.phase-e"]},
  {"id": "ACT.phase-e-fixes.lint", "title": "Lint and prepare a claims run", "actor": "orchestrator", "trigger": "runs claims.js lint and prepare", "preconditions": ["claims.jsonl"], "outputs": ["warnings", "audit-input.jsonl"], "evidence_refs": ["OBS.phase-e"]},
  {"id": "ACT.phase-e-fixes.sweep", "title": "Sweep a screen", "actor": "e2e-tester", "trigger": "runs tc-sweep.js", "preconditions": ["a run file"], "outputs": ["sweep result file"], "evidence_refs": ["OBS.phase-e"]},
  {"id": "ACT.phase-e-fixes.axe", "title": "Run the a11y scan", "actor": "publisher", "trigger": "Step 6 a11y runtime scan", "preconditions": ["a rendered screen"], "outputs": ["axe violations"], "evidence_refs": ["OBS.phase-e"]}
 ],
 "test_cases": [
  {"id": "TC.phase-e-fixes.code-structure-b", "title": "A decision claim backed by re-runnable code evidence at grade B is supported", "action_refs": ["ACT.phase-e-fixes.score"], "level": "functional", "surface": "cli", "preconditions": ["claim C-0001 has impact decision and channel code", "its verdict is SUPPORTED, grade B, with a recheck recipe"], "steps": [{"goal": "Run claims.js score on the run dir", "done_when": {"expect": "The command exits"}}], "expected": [{"text": "score.json gives C-0001 the status supported", "observe": {"channel": "artifact", "key": "score.json .claims[C-0001].status"}}], "basis": {"kind": "requirement", "refs": ["OBS.phase-e"]}, "readiness": "ready"},
  {"id": "TC.phase-e-fixes.code-b-needs-recipe", "title": "Grade B on code without a re-run recipe counts as C", "action_refs": ["ACT.phase-e-fixes.score"], "level": "functional", "surface": "cli", "preconditions": ["claim C-0002 has impact decision and channel code", "its verdict is SUPPORTED, grade B, with no recheck recipe"], "steps": [{"goal": "Run claims.js score on the run dir", "done_when": {"expect": "The command exits"}}], "expected": [{"text": "score.json gives C-0002 the status not_established", "observe": {"channel": "artifact", "key": "score.json .claims[C-0002].status"}}], "basis": {"kind": "requirement", "refs": ["OBS.phase-e"]}, "readiness": "ready"},
  {"id": "TC.phase-e-fixes.sentence-expected", "title": "A whole sentence as expected value draws a lint warning", "action_refs": ["ACT.phase-e-fixes.lint"], "level": "functional", "surface": "cli", "preconditions": ["claim C-0003 has an expected string of 60 characters"], "steps": [{"goal": "Run claims.js lint on the run dir", "done_when": {"expect": "The command exits"}}], "expected": [{"text": "The output warns that C-0003 should use one value as expected", "observe": {"channel": "artifact", "key": "stdout"}}], "basis": {"kind": "requirement", "refs": ["OBS.phase-e"]}, "readiness": "ready"},
  {"id": "TC.phase-e-fixes.no-sentence-swap", "title": "No swap canary is made from a sentence-long expected value", "action_refs": ["ACT.phase-e-fixes.lint"], "level": "functional", "surface": "cli", "preconditions": ["every claim of the run has an expected string longer than 40 characters"], "steps": [{"goal": "Run claims.js prepare with --seed 1", "done_when": {"expect": "The command exits"}}], "expected": [{"text": "The canary key has no item made by the swap operation", "observe": {"channel": "artifact", "key": "key.json items op"}}], "basis": {"kind": "requirement", "refs": ["OBS.phase-e"]}, "readiness": "ready"},
  {"id": "TC.phase-e-fixes.sweep-redact", "title": "A redacting sweep keeps control text out of its result file", "action_refs": ["ACT.phase-e-fixes.sweep"], "level": "functional", "surface": "cli", "preconditions": ["tc-run.json has sweep_labels redact", "the page has a dead button labelled 'Kim Minsu'"], "steps": [{"goal": "Run tc-sweep.js on the page", "done_when": {"expect": "The command exits"}}], "expected": [{"text": "The sweep result file does not contain the text 'Kim Minsu'", "observe": {"channel": "artifact", "key": "sweep result file"}}, {"text": "The failing control is listed with a label that starts with '<label:'", "observe": {"channel": "artifact", "key": "sweep result .fail[0].control"}}], "basis": {"kind": "requirement", "refs": ["OBS.phase-e"]}, "readiness": "ready"},
  {"id": "TC.phase-e-fixes.local-axe", "title": "Publisher loads axe-core from the local install", "action_refs": ["ACT.phase-e-fixes.axe"], "level": "functional", "surface": "cli", "preconditions": ["templates/agents/publisher.md"], "steps": [{"goal": "Read the a11y scan step", "done_when": {"expect": "The step is read"}}], "expected": [{"text": "The step has no cdn.jsdelivr.net URL", "observe": {"channel": "artifact", "key": "publisher.md Step 6.4"}}, {"text": "The step names the local axe-core path under ~/.claude/vendor", "observe": {"channel": "artifact", "key": "publisher.md Step 6.4"}}], "basis": {"kind": "requirement", "refs": ["OBS.phase-e"]}, "readiness": "ready"},
  {"id": "TC.phase-e-fixes.doctor-axe", "title": "Doctor warns when the local axe-core is missing", "action_refs": ["ACT.phase-e-fixes.axe"], "level": "functional", "surface": "cli", "preconditions": ["a temporary HOME installed with --skip-scanners"], "steps": [{"goal": "Run the doctor in that HOME", "done_when": {"expect": "The command exits"}}], "expected": [{"text": "The doctor output has a warning line about axe-core", "observe": {"channel": "artifact", "key": "doctor stdout"}}], "basis": {"kind": "requirement", "refs": ["OBS.phase-e"]}, "readiness": "ready"}
 ],
 "open_questions": []
}
```

## E2E

- 화면이 없다. 위 TC 7개는 `npm test`로 대응해서 확인한다. 스윕 TC는 로컬 HTTP 서버와 Chromium을 쓰고, 브라우저가 없으면 건너뛴다.
- 실제 확인은 ERP 세션의 다음 `/verify-claims` 실행에서 한다. 전파 뒤 not_established 수와 카나리아 탐지율이 바뀌는지 본다.

## 검증

- `npm test` 전부 통과(기존 220 + 새 테스트), wiki 테스트 21 통과.
- 이 서버 설치 뒤 `~/.claude/vendor/node_modules/axe-core/axe.min.js`가 있고 doctor에 axe-core 경고가 없다.
- `grep -r cdn.jsdelivr templates/`가 비어 있다.

## ✅ Checklist

- [ ] TC 초안을 승인 직후 파일로 쓰고 다시 검사했다
- [ ] 코드 구조 사실 + 재실행 레시피 = B, 동작 추론 = C이고, 레시피 없는 code B는 `score`가 C로 본다
- [ ] 문장 전체 `expected`는 경고되고 값 바꾸기 카나리아에 쓰이지 않는다
- [ ] `/verify-claims`와 지침이 결과 파일 기준으로 세라고 말한다
- [ ] `sweep_labels: "redact"`면 스윕 결과에 화면 글자가 없다
- [ ] axe-core가 로컬에서만 주입되고, 설치기와 doctor가 다룬다
- [ ] 문서·CHANGELOG를 고쳤다
- [ ] 보안 감사와 코드 리뷰를 반영했다
- [ ] ERP 세션에 전파 안내를 보냈다
- [ ] work-judgment 작업으로 돌아갔다

## Audit History
- iter-1: 2026-11-27 / critical=0 high=1 medium=3 low=2 / next_action=self_fix
  - SEC-001 가리기 모드에서도 페이지 오류 문구, `result.error`, `clickError`, 디버그 출력에 화면 글자가 남았다 → `hidden()`으로 모두 가린다.
  - SEC-002 소금 없는 SHA-256 8자리 → 프로젝트마다 무작위 키(`sweep/.label-salt`, 0600)로 HMAC, 12자리.
  - SEC-003 axe-core를 범위 버전으로 받고 패키지 스크립트가 돌았다 → 4.14.1 고정, `--ignore-scripts`, `--save-exact`.
  - SEC-004 줄 없는 file 레시피는 파일 어디서나 일치해 B가 부풀 수 있었다 → code B에는 `line`이 있어야 한다.
  - SEC-005 셸 문자열 안의 경로 → `execFileSync` 인자 배열.
  - SEC-006 (design) 가리기가 선택 사항이었다 → 아래 결정.

## Code Review History
- code-review-iter-1: 2026-11-27 / critical=0 high=0 medium=1 low=2 / next_action=done
  - QA-001 Jev 샘플 경고 계산이 낮춘 등급을 쓰지 않았다 → `codeBCapped()`를 함께 쓴다.
  - QA-002 (business) 가리기 해시가 소금 없음 → SEC-002와 같이 고쳤다.
  - QA-003 제거 뒤 `package.json`이 남고 모드 구분이 없었다 → 제거 시 정리, 전역 설치에서만 지운다.
- 반영 뒤 `npm test` 222 + 21 통과.

## Decisions (made without asking, 감사 후속)

| 결정 | 이유 | 근거 | 되돌리는 법 |
|---|---|---|---|
| `sweep_labels`가 없으면 `base_url`이 loopback이 아닐 때 가리고, loopback이면 보여 준다 | 원격(스테이징·운영 사본)은 실데이터일 가능성이 높다. 로컬 개발에서는 이름이 디버깅에 필요하다. loopback에서 실데이터를 쓰면 실행 파일에 직접 적는다 | SEC-006, ERP 보고 | `runContext`의 기본값 한 줄 |
| 가리기 라벨은 프로젝트별 무작위 키의 HMAC 12자리 | 이름 목록을 해시해 맞춰 볼 수 없게 하면서, 같은 프로젝트 안에서는 같은 컨트롤을 이어 볼 수 있다 | SEC-002, QA-002 | `shown()`·`labelSalt()` |

