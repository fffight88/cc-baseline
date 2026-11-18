# TC 반복 실행기 — 기록 재생(`tc-replay.js`)과 스윕 스크립트(`tc-sweep.js`)

수정 루프(`tc-fix-loop.js`)는 같은 TC를 여러 라운드 다시 돌린다. 그런데 매 라운드를 e2e-tester로 돌리면 라운드당 약 60만 토큰이 든다. 샘플 앱에서 손으로 짠 드라이버는 LLM 토큰 0, 라운드당 5~22초였지만 앱마다 손으로 짜야 한다. 이 플랜은 그 중간을 만든다.

- e2e-tester가 처음 돌릴 때 조작과 코드 판정을 **데이터(JSON)로 기록**한다.
- 이후 라운드는 cc-baseline의 **공용 재생기**가 LLM 없이 재생한다.
- 죽은 버튼 점검(데드 컨트롤 스윕)은 **스크립트**로 옮겨 테스터와 재생기가 모두 쓴다.

## ⚡ Key Rules Summary

| ✅ DO | ❌ DON'T |
|---|---|
| 기록은 허용된 동작 목록(`goto`·`click`·`fill`·`press`·`select`·`wait`·`capture`·`check`)만 쓰는 JSON 데이터다 | 테스터가 쓴 JS 코드를 그대로 실행하기 |
| 재생은 `base_url` 출처 안에서만, API·DB·로그 확인은 `tc-api-run.js` 함수로만 한다 | 재생기가 다른 출처로 가거나 `readable` 밖 파일을 읽기 |
| 기록은 검증 재생(데이터 초기화 → 재생 → 기대 결과마다 테스터 판정과 일치)을 통과해야 채택한다 | 검증 없이 기록을 믿기 |
| 재생 중 조작 단계가 막히면 결과를 남기지 않고 그 TC를 테스터로 넘긴다 | 조작이 막힌 것을 제품 FAIL로 기록하기 |
| 기대 결과 판정이 FAIL이면 코드 판정 FAIL로 기록한다 (테스터와 같은 판정) | 기록의 검사를 TC 문장보다 약하게 바꾸기 |
| TC 문장이 바뀌면(digest) 그 기록은 무효다 | 옛 TC로 만든 기록을 재생하기 |
| 라운드 전에 `tc-run.json`의 `reset_command`로 데이터를 초기화한다 | 초기화 없이 재생해 결과를 비교하기 |
| 스윕은 GET·HEAD가 아닌 요청을 모두 막은(abort) 채로 클릭 효과만 본다 | 스윕이 데이터를 바꾸기 |
| 기록·로그인 상태 파일은 `.cc-audits/<slug>/` 아래(커밋 안 함, 0600)에 두고, 비밀은 `$ENV` 이름만 남긴다 | 비밀번호·쿠키 값을 기록에 남기기 |

## Meta
- Security Impact: Yes
- Code Quality Impact: Yes
- UI Impact: No
- Behavior Impact: Yes
- Reason: 새 스크립트 두 개가 브라우저를 띄워 대상 앱을 조작하고, 로그인 상태를 파일로 저장하고, 프로젝트 명령(`reset_command`)을 실행한다. 테스터와 매니저 지침, 수정 루프의 통과 판정이 바뀐다.

---

## Context

- 할 일 1(수정 루프, `docs/plans/tc-fix-loop.md`)의 Phase C에서 숫자가 나왔다.
  - 4라운드에 TC 27번 실행했다.
  - 드라이버로는 라운드당 5~22초, LLM 토큰 0이었다.
  - e2e-tester였다면 수백만 토큰이 들었을 것이다.
- 드라이버(`tc-sample-app/.cc-audits/phase-f/driver.js`)는 TC마다 조작을 손으로 짠 앱 전용 코드다. 그래서 일반화할 수 없다. 데드 컨트롤 스윕도 하지 않는다.
- 사용자 결정(2026-11-18):
  - 범용 실행기가 아니라 **기록 → 재생** 방식으로 간다(로드맵 3단계).
  - 기록은 데이터 형식이고, 공용 재생기가 재생한다.
  - 데이터 초기화는 `reset_command`로 한다.
  - 기록은 검증 재생을 통과한 뒤 채택한다.
  - 스윕은 1라운드부터 항상 스크립트로 한다.
  - 기록은 `.cc-audits/`에 두고 커밋하지 않는다.
- 범용 실행기(TC 문장 → 조작을 매번 판단)는 LLM이나 Jev 판단이 필요하다. 로드맵 4단계로 남긴다.

### 범위 밖

- 화면이 바뀐 곳만 다시 탐색하는 부분 재기록. 재생이 막히면 그 TC 전체를 테스터가 다시 돌리고 다시 기록한다.
- Aside(macOS) 전용 기록 경로. 기록 형식은 브라우저 도구와 무관하다. 테스터는 Playwright MCP 응답의 "Ran Playwright code"를 동작 목록으로 옮긴다. Aside는 같은 동작을 직접 적는다.

---

## 설계

### 1. 기록 파일 — `.cc-audits/<slug>/replay/<tc-id>.json`

```json
{
  "schema": 1, "tc": "TC.checkout.success", "tc_digest": "<record와 같은 방식>", "recorded_run_id": "…", "status": "candidate | accepted | rejected",
  "start_path": "/", "session": "customer-t02",
  "login": [ { "op": "goto", "path": "/login" }, { "op": "fill", "label": "이메일", "value": "{{data.email}}" }, "…" ],
  "steps": [
    { "step": 0, "actions": [ { "op": "click", "role": "link", "name": "장바구니" } ],
      "done_when": { "op": "visible", "role": "table", "name": "장바구니 상품" } },
    { "step": 3, "actions": [
        { "op": "capture", "name": "stock_before", "db": "products[id={{data.product_id}}].stock" },
        { "op": "click", "role": "button", "name": "결제하기", "await_response": { "method": "POST", "path": "/api/orders" },
          "capture": { "order_id": "json:order.id" } } ],
      "done_when": { "op": "hidden", "text": "처리 중" } }
  ],
  "expected": [
    { "index": 0, "check": { "op": "text", "selector": "h1", "equals": "주문이 완료되었습니다" } },
    { "index": 1, "check": { "op": "url_path", "equals": "/orders/{{order_id}}" } },
    { "index": 2, "check": { "op": "log_count", "grep": ["payment.captured", "{{order_id}}"], "equals": 1 } },
    { "index": 4, "check": { "op": "db", "json_path": "products[id={{data.product_id}}].stock", "equals": "{{stock_before - data.qty}}" } },
    { "index": 5, "judge": "jev", "region": "main" }
  ],
  "urls": ["/", "/cart", "/checkout", "/orders/:id"],
  "invariants_baseline": { "http": ["GET /api/me 401"], "console": [] }
}
```

- **위치 지정:** `role`+`name`(정확히 일치), `label`, `text`, `selector`(CSS, 마지막 수단) 중 하나를 쓴다.
- **값:** `{{data.x}}`(run 데이터), `{{캡처 이름}}`, 정수 뺄셈·덧셈만 허용한다. `$ENV` 값은 `secret_env`에 있는 이름만 쓰고, 출력에서는 가린다.
- **검사(`check`):** `text`(equals·includes·starts), `count`, `visible`·`hidden`, `enabled`, `url_path`, `api`(status·json_path), `db`(json_path·count), `log_count`. `api`·`db`·`log`는 `tc-api-run.js`의 `request`·`readSource`를 그대로 쓴다.
- **화면만 보고 판정하는 기대 결과(key 없음, `question_id`):** `"judge": "jev"`로 둔다. 재생기가 관찰 파일을 쓰고 `tc-jev-judge.js judge`를 부른다. REVIEW이거나 `audit: true`이면 그 TC를 `pending`으로 두고, 매니저가 판정해 `finish`한다.
- **불변 조건 기준선:** 테스터가 통과시킨 실행에서 본 4xx와 콘솔 오류다. 재생 중 다음 중 하나가 나오면 그 TC는 `invariants: "fail"`이다.
  - 기준선에 없는 4xx
  - 5xx, 처리되지 않은 페이지 오류
  - 오류 페이지

### 2. `templates/scripts/tc-replay.js`

| 명령 | 하는 일 |
|---|---|
| `check --run <tc-run.json> --tc <id>` | 기록 형식 검사: 허용된 op만 있는지, 기대 결과마다 `check`나 `judge: jev`가 정확히 하나인지, TC의 `observe.channel`과 검사 종류가 맞는지(dom↔화면 검사, db↔`db` 등), 경로·출처, digest. 거부하면 종료 코드 2 |
| `run --run <…> --run-id <id> --tcs <a,b> [--verify]` | TC마다 새 브라우저 컨텍스트를 연다. `login` → `steps` → `expected` 순으로 실행하고, 결과 줄을 `tc-jev-judge.js`의 `record`로 남긴다(`browser_tool: "replay"`). TC마다 출력: `recorded` · `fallback`(사유: `stale`·`no_recording`·`not_accepted`·`step_blocked:<n>`·`locator_missing`) · `pending`(Jev REVIEW·재검사) |
| `run … --verify` | 결과 줄은 쓰지 않는다. 같은 run의 테스터 결과 줄과 기대 결과별 판정을 비교해 일치하면 `accepted`, 다르면 `rejected`(어긋난 index 기록) |
| `finish --run <…> --run-id <id> --verdicts <json>` | `pending` TC에 매니저의 판정을 넣어 기록 |
| `urls --run <…> [--tcs …]` | 기록된 방문 URL 목록(스윕 입력) |

- **브라우저 모듈 찾는 순서:** `CC_BASELINE_PLAYWRIGHT`, `require('playwright')`, `npm root -g`/`~/.npm-global`의 `@playwright/mcp/node_modules/playwright`. 셋 다 없으면 모든 TC가 `fallback: no_browser`가 되고 doctor가 경고한다.
- **로그인 상태:** 첫 TC의 `login` 동작 뒤 `storageState`를 `.cc-audits/<slug>/replay-state/<session>.json`(0600)에 저장하고, 같은 라운드의 다른 TC는 그것을 재사용한다. 스윕도 이 파일을 쓴다.
- **안전:**
  - `goto`는 경로만 받는다.
  - 다른 출처로 가는 요청은 막고(route abort) 기록에 남긴다.
  - 비루프백 `base_url`은 `api_remote_ok`가 있어야 한다.
  - 재생기는 스크린샷이나 응답 본문을 저장하지 않는다. 관찰 파일 규칙은 테스터와 같다.

### 3. `templates/scripts/tc-sweep.js`

- **실행:** `node tc-sweep.js --run <tc-run.json> --run-id <id> --urls </a,/b> [--session <name>]` → `.cc-audits/<slug>/sweep/<run_id>.json`. URL별로 `clean`·`fail`(죽은 요소 목록)·`skipped`(파괴적인 요소)를 남긴다.
- **방법:** 지금 테스터 지침 §(B)를 코드로 옮긴다.
  1. 클릭할 수 있는 요소를 모은다.
  2. 하나씩 누르고 효과가 있었는지 본다: 이동, 새 창·팝업, 요청 시작, DOM 변화, 대화상자.
  3. 효과가 없거나 ReferenceError가 나면 `fail`이다.
  4. 나중에 생기는 요소(토스트 등)는 MutationObserver로 모아 바로 누른다.
- **데이터 보호:**
  - GET·HEAD가 아닌 요청은 모두 abort한다. 요청을 시작했다는 것 자체는 효과로 친다.
  - 이름이 `/delete|remove|logout|sign\s*out|pay|purchase|approve|삭제|로그아웃|결제|승인/i`에 맞는 요소는 누르지 않고 `skipped (destructive)`로 남긴다.
  - 누를 때마다 원래 URL로 다시 연다.
- **결과 반영:** 스윕이 `fail`인 URL을 방문한 TC는 결과 줄에 `sweep: "fail"`이 붙는다. 재생기는 기록을 남길 때 넣고, 테스터는 자기 결과에 넣는다.

### 4. 수정 루프·지침 연결

- **`tc-fix-loop.js`의 `outcomeOf`:** 결과 줄의 `invariants: "fail"`과 `sweep: "fail"`도 실패로 본다. 실패 지문에 `inv`·`sweep`을 포함한다. 테스터 지침의 "TC PASS = 기대 결과 ∧ 불변 조건 ∧ 스윕"을 코드로 맞추는 것이다.
- **`tc-run.json`:** `reset_command`를 추가한다. 형식 제한은 지금의 `*_command`와 같다(`node <프로젝트 스크립트> <일반 인자>`). 매니저가 라운드 전과 검증 재생 전에 실행한다.
- **매니저 가이드 §2-C "Replay rounds" 신설:**
  1. 1라운드: `reset_command`를 돌리고 e2e-tester로 실행한다. 테스터가 기록과 스윕 결과를 남긴다.
  2. 검증: `reset_command` → `tc-replay.js run --verify`. `accepted`가 아닌 TC는 다음 라운드도 테스터가 돌린다.
  3. 다음 라운드: `reset_command` → `tc-sweep.js`(full·final 라운드는 기록된 모든 URL, partial은 그 라운드 TC들의 URL) → `tc-replay.js run`. `fallback` TC만 e2e-tester로 돌리고 다시 기록한다. `pending` TC는 관찰 파일로 매니저가 판정해 `finish`한다.
  4. `report`에 라운드별 실행 수단(재생·테스터) 수를 남긴다(결과 줄의 `browser_tool`).
- **`e2e-tester.md`:**
  - TC Judging에 "Recording" 절을 추가한다. 실행하면서 동작과 코드 검사를 기록 파일로 쓰고, `tc-replay.js check`를 통과시킨다.
  - §0(B) 스윕을 "`tc-sweep.js`를 화면마다 호출"로 바꾼다.
  - 결과 줄에 `invariants`·`sweep`을 넣는다.
- **`reference_tc_authoring.md`:** 바꾸지 않는다(TC 형식은 그대로).
- **doctor:** "Replay browser" 항목을 추가한다. Playwright 모듈을 찾을 수 있는지 본다.
- **`manifest.json`:** 스크립트 두 개를 추가한다.

---

## Phase A — `tc-replay.js`

1. Read ~/.claude/memory/phase_start.md and execute
2. 승인 직후: 아래 TC 초안을 `docs/tc/tc-replay.tc.json`으로 쓰고, 플랜을 `docs/plans/tc-replay.md`로 복사한다. 검사 두 개를 다시 돌린다(`.cc-audits/tc-replay/tc-check.json`).
3. `templates/scripts/tc-replay.js`를 작성한다.
   - 재사용: `jev-client.js`의 `parseArgs`, `tc-api-run.js`의 `request`·`readSource`·`projectRoot`, `tc-jev-judge.js`의 `record`·`judge`·`canonical`.
   - 형식 검사(`check`)는 브라우저 없이 동작해야 하므로 별도 함수로 둔다.
4. `test/run.js`:
   - 형식 검사 단위 테스트(브라우저 불필요)
   - 로컬 HTTP 테스트 서버와 실제 Chromium으로 재생 테스트. Playwright가 없으면 그 테스트는 건너뛰고 `skipped`로 표시한다.
5. `npm test`
6. Read ~/.claude/memory/phase_end.md and execute

## Phase B — `tc-sweep.js`

1. Read ~/.claude/memory/phase_start.md and execute
2. `templates/scripts/tc-sweep.js`를 작성한다. 브라우저 모듈 찾기와 로그인 상태는 `tc-replay.js`와 같은 함수를 쓴다(export 공유).
3. 테스트(로컬 서버): 죽은 버튼, 요청 abort, 파괴적인 요소 건너뛰기, 늦게 생긴 토스트 버튼.
4. `tc-fix-loop.js`의 `outcomeOf`에 `invariants`·`sweep`을 반영하고 테스트를 추가한다.
5. `npm test`
6. Read ~/.claude/memory/phase_end.md and execute

## Phase C — 지침·설치

1. Read ~/.claude/memory/phase_start.md and execute
2. `e2e-tester.md`에 Recording 절을 추가하고, 스윕을 스크립트 호출로 바꾸고, 결과 줄 필드를 추가한다.
3. 매니저 가이드에 §2-C와 Checklist를 추가하고, `tc-run.json` 설명에 `reset_command`를 넣는다.
4. doctor 항목과 `manifest.json`을 바꾸고, `node bin/cli.js --yes`, `--doctor`.
5. Read ~/.claude/memory/phase_end.md and execute

## Phase D — 샘플 앱 검증 (레포 밖, 실제 e2e-tester 사용)

1. Read ~/.claude/memory/phase_start.md and execute
2. 샘플 앱에 브랜치 `replay-trial`을 만든다(`main`에서). `reset_command`는 `node scripts/matrix.js start R1 --bugs …`처럼 지정한다.
3. 대상은 `order-list`(9개)와 `checkout.success`다. 결함은 `filter_ignored`, `pager_dead`, `empty_no_message`, `stock_not_decremented`를 켠다.
4. 진행:
   - 1라운드: e2e-tester 에이전트로 실행하고 기록을 남긴다. 에이전트 토큰을 기록한다.
   - 검증 재생을 한다.
   - 수정 루프 라운드: 재생과 스윕으로 돌린다.
5. 확인할 것:
   - 테스터와 재생의 판정이 일치한다.
   - 재생 라운드에 LLM 토큰이 0이다.
   - 로케이터를 일부러 깨뜨리면 `fallback` → 테스터 재실행 → 재기록 흐름이 돈다.
   - 스윕이 `pager_dead`를 잡는다.
   - 드라이버 결과와 비교한다.
6. 결과(라운드별 실행 수단, 시간, 토큰, Jev 호출)를 이 플랜 아래 "Phase D 결과"에 적는다.
7. 서버를 정지한다(`matrix.js stop`, `/clean`).
8. Read ~/.claude/memory/phase_end.md and execute

## Phase E — 게이트·푸시

1. Read ~/.claude/memory/phase_start.md and execute
2. security-auditor와 code-reviewer를 병렬로 돌리고, 지적 사항을 반영한다.
3. 커밋한다(`.claude/` 제외). 푸시는 사용자 확인 뒤에 한다.
4. 메모리와 `HANDOFF-next.md`를 갱신한다.
5. Read ~/.claude/memory/phase_end.md and execute

---

## Test Cases (draft)

cc-baseline 자체의 TC(`surface: cli`)다. 승인 직후 `docs/tc/tc-replay.tc.json`으로 쓴다. 기대 결과는 모두 종료 코드·출력 JSON·파일 내용으로 확인한다(`artifact` 채널, 코드 판정). 브라우저가 필요한 TC는 로컬 테스트 서버에서 확인한다.

| TC ID | 제목 | surface | readiness | 기대 결과 수 |
|---|---|---|---|---|
| TC.tc-replay.check-unknown-op | 허용 목록 밖 동작이 있는 기록은 거부된다 | cli | ready | 1 |
| TC.tc-replay.check-absolute-goto | 절대 URL로 가는 기록은 거부된다 | cli | ready | 1 |
| TC.tc-replay.check-channel-mismatch | db 기대 결과에 화면 검사를 붙인 기록은 거부된다 | cli | ready | 1 |
| TC.tc-replay.run-pass-recorded | 정상 서버에서 재생하면 코드 판정 PASS 줄이 남는다 | cli | ready | 2 |
| TC.tc-replay.run-fail-recorded | 기대 결과가 틀리면 코드 판정 FAIL 줄이 남는다 | cli | ready | 1 |
| TC.tc-replay.locator-missing-fallback | 조작 대상이 없으면 결과 없이 fallback이다 | cli | ready | 2 |
| TC.tc-replay.stale-digest-fallback | TC 문장이 바뀌면 기록은 stale이다 | cli | ready | 1 |
| TC.tc-replay.verify-mismatch-rejected | 검증 재생 판정이 테스터와 다르면 rejected다 | cli | ready | 1 |
| TC.tc-replay.unknown-4xx-invariant | 기준선에 없는 4xx가 나오면 invariants가 fail이다 | cli | ready | 1 |
| TC.tc-replay.sweep-dead-button | 효과 없는 버튼은 스윕 fail로 나온다 | cli | ready | 1 |
| TC.tc-replay.sweep-no-mutation | 스윕 중 POST는 서버에 닿지 않는다 | cli | ready | 1 |
| TC.tc-replay.sweep-destructive-skipped | 삭제 버튼은 눌리지 않고 skipped로 남는다 | cli | ready | 1 |
| TC.tc-replay.loop-sweep-fail | sweep이 fail인 결과 줄은 수정 루프에서 실패다 | cli | ready | 1 |

검사 요약 (표준 입력):
- `tc-lint`는 13 TC에서 경고 0건이다.
- `tc-jev-check`(jev-1.14.0, 15문장)는 `jev_screen` 경고 2건을 냈다(locator-missing-fallback[1], sweep-no-mutation[0]). 그대로 둔다. 두 문장 모두 `artifact` 채널이라 코드가 파일·서버 로그로 판정하고, 화면으로 판정하지 않는다.

열린 질문은 없다(데이터 초기화·검증 재생·스윕·기록 위치는 2026-11-18 결정).

```json
{
  "schema_version": 1,
  "feature": "tc-replay",
  "title": "Replay rounds and dead-control sweep script",
  "plan": "tc-replay",
  "sources": [
    { "id": "REQ.tc-replay-plan", "kind": "requirement", "locator": "docs/plans/tc-replay.md (approved 2026-11-18)" },
    { "id": "DEC.replay-design", "kind": "decision", "locator": "user decision 2026-11-18: record-and-replay as data, reset_command, verify before accepting, sweep always by script, recordings under .cc-audits" }
  ],
  "actions": [
    { "id": "ACT.tc-replay.check", "title": "Check a recording", "actor": "e2e-tester", "trigger": "runs tc-replay.js check --run <tc-run.json> --tc <id>", "preconditions": ["a recording file exists"], "outputs": ["exit code and one JSON line"], "evidence_refs": ["REQ.tc-replay-plan"] },
    { "id": "ACT.tc-replay.run", "title": "Replay TCs for a round", "actor": "e2e manager", "trigger": "runs tc-replay.js run --run <tc-run.json> --run-id <id> --tcs <ids>", "preconditions": ["accepted recordings", "the app is running at base_url"], "outputs": ["one JSON line per TC", "tc-results.jsonl lines"], "evidence_refs": ["REQ.tc-replay-plan", "DEC.replay-design"] },
    { "id": "ACT.tc-replay.sweep", "title": "Sweep screens for dead controls", "actor": "e2e manager or e2e-tester", "trigger": "runs tc-sweep.js --run <tc-run.json> --run-id <id> --urls <paths>", "preconditions": ["the app is running at base_url"], "outputs": ["sweep/<run_id>.json"], "evidence_refs": ["REQ.tc-replay-plan", "DEC.replay-design"] }
  ],
  "test_cases": [
    { "id": "TC.tc-replay.check-unknown-op", "title": "A recording with an op outside the allowed list is refused", "action_refs": ["ACT.tc-replay.check"], "level": "functional", "surface": "cli",
      "preconditions": ["a recording whose step has op eval"],
      "steps": [{ "goal": "Run tc-replay.js check for that TC", "done_when": { "expect": "The command exits" } }],
      "expected": [{ "text": "The exit code is 2", "observe": { "channel": "artifact", "key": "exit code" } }],
      "basis": { "kind": "requirement", "refs": ["REQ.tc-replay-plan"] }, "readiness": "ready" },
    { "id": "TC.tc-replay.check-absolute-goto", "title": "A recording that goes to an absolute URL is refused", "action_refs": ["ACT.tc-replay.check"], "level": "functional", "surface": "cli",
      "preconditions": ["a recording with goto path https://example.com/"],
      "steps": [{ "goal": "Run tc-replay.js check for that TC", "done_when": { "expect": "The command exits" } }],
      "expected": [{ "text": "The exit code is 2", "observe": { "channel": "artifact", "key": "exit code" } }],
      "basis": { "kind": "requirement", "refs": ["REQ.tc-replay-plan"] }, "readiness": "ready" },
    { "id": "TC.tc-replay.check-channel-mismatch", "title": "A screen check on a db expected result is refused", "action_refs": ["ACT.tc-replay.check"], "level": "functional", "surface": "cli",
      "preconditions": ["a TC whose expected[0] has channel db", "a recording whose expected[0] check op is text"],
      "steps": [{ "goal": "Run tc-replay.js check for that TC", "done_when": { "expect": "The command exits" } }],
      "expected": [{ "text": "The exit code is 2", "observe": { "channel": "artifact", "key": "exit code" } }],
      "basis": { "kind": "requirement", "refs": ["REQ.tc-replay-plan"] }, "readiness": "ready" },
    { "id": "TC.tc-replay.run-pass-recorded", "title": "Replay on a working server records a code PASS line", "action_refs": ["ACT.tc-replay.run"], "level": "functional", "surface": "cli",
      "preconditions": ["a local test server whose page shows the expected heading", "an accepted recording for the TC"],
      "steps": [{ "goal": "Run tc-replay.js run for that TC", "done_when": { "expect": "The command exits" } }],
      "expected": [
        { "text": "The output line for the TC says recorded", "observe": { "channel": "artifact", "key": "stdout JSON .tcs[0].outcome" } },
        { "text": "The new tc-results line has verdict PASS judged by code", "observe": { "channel": "artifact", "key": "tc-results.jsonl last line .expected[0]" } }
      ], "basis": { "kind": "requirement", "refs": ["REQ.tc-replay-plan"] }, "readiness": "ready" },
    { "id": "TC.tc-replay.run-fail-recorded", "title": "A wrong heading records a code FAIL line", "action_refs": ["ACT.tc-replay.run"], "level": "functional", "surface": "cli",
      "preconditions": ["the test server shows a different heading", "an accepted recording for the TC"],
      "steps": [{ "goal": "Run tc-replay.js run for that TC", "done_when": { "expect": "The command exits" } }],
      "expected": [{ "text": "The new tc-results line has verdict FAIL judged by code", "observe": { "channel": "artifact", "key": "tc-results.jsonl last line .expected[0]" } }],
      "basis": { "kind": "requirement", "refs": ["REQ.tc-replay-plan"] }, "readiness": "ready" },
    { "id": "TC.tc-replay.locator-missing-fallback", "title": "A missing click target gives fallback and no result line", "action_refs": ["ACT.tc-replay.run"], "level": "functional", "surface": "cli",
      "preconditions": ["the test server page lacks the button the recording clicks"],
      "steps": [{ "goal": "Run tc-replay.js run for that TC", "done_when": { "expect": "The command exits" } }],
      "expected": [
        { "text": "The output line for the TC says fallback", "observe": { "channel": "artifact", "key": "stdout JSON .tcs[0].outcome" } },
        { "text": "tc-results.jsonl has no line with this run_id", "observe": { "channel": "artifact", "key": "tc-results.jsonl" } }
      ], "basis": { "kind": "requirement", "refs": ["DEC.replay-design"] }, "readiness": "ready" },
    { "id": "TC.tc-replay.stale-digest-fallback", "title": "A recording made for older TC text is stale", "action_refs": ["ACT.tc-replay.run"], "level": "functional", "surface": "cli",
      "preconditions": ["an accepted recording", "the TC expected text edited afterwards"],
      "steps": [{ "goal": "Run tc-replay.js run for that TC", "done_when": { "expect": "The command exits" } }],
      "expected": [{ "text": "The output fallback reason is stale", "observe": { "channel": "artifact", "key": "stdout JSON .tcs[0].reason" } }],
      "basis": { "kind": "requirement", "refs": ["REQ.tc-replay-plan"] }, "readiness": "ready" },
    { "id": "TC.tc-replay.verify-mismatch-rejected", "title": "A verify replay that disagrees with the tester rejects the recording", "action_refs": ["ACT.tc-replay.run"], "level": "functional", "surface": "cli",
      "preconditions": ["a candidate recording", "a tester result line with verdict FAIL for expected[0]", "the test server makes the check pass"],
      "steps": [{ "goal": "Run tc-replay.js run with --verify for that run_id", "done_when": { "expect": "The command exits" } }],
      "expected": [{ "text": "The recording file status is rejected", "observe": { "channel": "artifact", "key": "replay/<tc>.json .status" } }],
      "basis": { "kind": "requirement", "refs": ["DEC.replay-design"] }, "readiness": "ready" },
    { "id": "TC.tc-replay.unknown-4xx-invariant", "title": "A 4xx outside the baseline fails the invariants", "action_refs": ["ACT.tc-replay.run"], "level": "functional", "surface": "cli",
      "preconditions": ["an accepted recording with an empty invariants baseline", "the test page requests a path that returns 404"],
      "steps": [{ "goal": "Run tc-replay.js run for that TC", "done_when": { "expect": "The command exits" } }],
      "expected": [{ "text": "The new tc-results line has invariants fail", "observe": { "channel": "artifact", "key": "tc-results.jsonl last line .invariants" } }],
      "basis": { "kind": "requirement", "refs": ["REQ.tc-replay-plan"] }, "readiness": "ready" },
    { "id": "TC.tc-replay.sweep-dead-button", "title": "A button with no effect is a sweep failure", "action_refs": ["ACT.tc-replay.sweep"], "level": "functional", "surface": "cli",
      "preconditions": ["a test page with a button that has no handler"],
      "steps": [{ "goal": "Run tc-sweep.js on that page", "done_when": { "expect": "The command exits" } }],
      "expected": [{ "text": "The sweep file lists that button under fail for the page", "observe": { "channel": "artifact", "key": "sweep/<run_id>.json" } }],
      "basis": { "kind": "requirement", "refs": ["REQ.tc-replay-plan"] }, "readiness": "ready" },
    { "id": "TC.tc-replay.sweep-no-mutation", "title": "A POST started by the sweep never reaches the server", "action_refs": ["ACT.tc-replay.sweep"], "level": "functional", "surface": "cli",
      "preconditions": ["a test page with a button that sends POST /api/save"],
      "steps": [{ "goal": "Run tc-sweep.js on that page", "done_when": { "expect": "The command exits" } }],
      "expected": [{ "text": "The test server received no POST request", "observe": { "channel": "artifact", "key": "test server request log" } }],
      "basis": { "kind": "requirement", "refs": ["DEC.replay-design"] }, "readiness": "ready" },
    { "id": "TC.tc-replay.sweep-destructive-skipped", "title": "A delete button is not clicked and is reported skipped", "action_refs": ["ACT.tc-replay.sweep"], "level": "functional", "surface": "cli",
      "preconditions": ["a test page with a button named 삭제 whose click handler sets a flag"],
      "steps": [{ "goal": "Run tc-sweep.js on that page", "done_when": { "expect": "The command exits" } }],
      "expected": [{ "text": "The sweep file lists the 삭제 button under skipped", "observe": { "channel": "artifact", "key": "sweep/<run_id>.json" } }],
      "basis": { "kind": "requirement", "refs": ["REQ.tc-replay-plan"] }, "readiness": "ready" },
    { "id": "TC.tc-replay.loop-sweep-fail", "title": "A result line with sweep fail counts as a failure in the fix loop", "action_refs": ["ACT.tc-replay.run"], "level": "functional", "surface": "cli",
      "preconditions": ["a fix loop with one TC", "its round result line has every expected PASS and sweep fail"],
      "steps": [{ "goal": "Run tc-fix-loop.js next", "done_when": { "expect": "The command exits" } }],
      "expected": [{ "text": "The output action is classify", "observe": { "channel": "artifact", "key": "stdout JSON .action" } }],
      "basis": { "kind": "requirement", "refs": ["REQ.tc-replay-plan"] }, "readiness": "ready" }
  ],
  "open_questions": []
}
```

## E2E

- cc-baseline에는 화면이 없다. 위 TC 13개는 `npm test`(단위 테스트, 로컬 서버와 Chromium)로 대응해서 확인한다.
- 실제 검증은 Phase D에서 샘플 앱으로 한다.
  - `tc-run.json`은 기존 `tc-sample-app/.cc-audits/phase-f/tc-run.json`이고, `reset_command`를 추가한다.
  - base_url은 `http://127.0.0.1:3100`(loopback)이다.
  - 1라운드는 e2e-tester 에이전트로, 이후는 재생으로 돌린다.
  - 실패 TC는 수정 루프(§2-B)로 처리한다.

## 검증

- `npm test` 전부 통과(기존 183개 + 새 테스트). Playwright가 없는 환경에서는 브라우저 테스트가 `skipped`로 표시되고 실패하지 않는다.
- `node bin/cli.js --doctor`에 "Replay browser"가 정상으로 나온다.
- Phase D:
  - 재생 판정이 테스터 판정과 같다.
  - 재생 라운드의 LLM 토큰이 0이다.
  - fallback → 재기록 흐름이 돈다.
  - 스윕이 `pager_dead`를 잡는다.
  - 스윕 동안 서버 로그에 GET이 아닌 요청이 없다.
- 기록·로그인 상태 파일이 `.cc-audits/` 밖에 생기지 않고 권한이 0600이다.

## ✅ Checklist

- [ ] TC 초안을 승인 직후 파일로 쓰고 다시 검사했다
- [ ] 기록 형식이 허용된 op 목록만 받고, 경로·출처·채널을 `check`가 코드로 막는다
- [ ] 조작이 막히면 결과 없이 fallback, 기대 결과가 틀리면 code FAIL로 남는다
- [ ] TC digest가 다른 기록은 재생하지 않는다
- [ ] 기록은 검증 재생에서 테스터 판정과 일치해야 accepted가 된다
- [ ] 스윕은 GET·HEAD가 아닌 요청을 abort하고 파괴적인 요소를 누르지 않는다
- [ ] 수정 루프가 `invariants`·`sweep` fail을 실패로 본다
- [ ] 테스터 지침(Recording, 스윕 스크립트)과 매니저 가이드 §2-C, `reset_command`, doctor, manifest를 반영했다
- [ ] 샘플 앱에서 e2e-tester 1라운드 → 검증 → 재생 라운드가 돌았고 수치를 기록했다
- [ ] 보안 감사와 코드 리뷰를 반영했다. 푸시는 사용자 확인 뒤에 한다
- [ ] 서버를 정지했다

---

## Phase D 결과 (2026-11-18, 샘플 앱 `replay-trial` 브랜치)

- **대상:** `order-list` 9개(수정 루프) + `checkout.success`(검증만). 결함은 `filter_ignored`, `pager_dead`, `empty_no_message`, `stock_not_decremented`를 켰다.
- **수정 루프:** 3라운드 만에 `done`이 됐다(full → partial → final). 분류는 product 6, runner 1(1라운드 스윕 오탐)이다. 결함 4개는 코드에서 지웠다.

| 라운드 | 테스터 실행 | 재생 | LLM 토큰(테스터) | 재생 시간 |
|---|---|---|---|---|
| 1 (full) | 10 TC (에이전트 4) | 0 | 약 39.9만 | — |
| 검증 재생 | — | 10 | 0 | 39초 |
| 2 (partial) | 3 TC 재기록 (에이전트 2) | 4 | 약 17.7만 | 78초(스윕 포함) |
| 3 (final) | 0 | 9 | 0 | 60초(스윕 포함) |

- Jev 호출은 라운드당 1번(약 1천 토큰)이었다. REVIEW가 2번 나와서 매니저가 관찰 파일로 판정하고 `finish`했다.
- 모든 라운드를 테스터로 돌렸다면 약 120만 토큰이 들었을 것이다(라운드당 약 40만). 실제로는 약 58만 토큰이었고, 마지막 라운드는 0이었다.
- **검증 재생이 잡은 것(채택 거부):**
  - 테스터가 단계를 1부터 셌다.
  - 재생기가 기록할 수 없던 결과가 있었다.
  - 테스터의 NOT_OBSERVABLE과 재생 FAIL이 엇갈렸다.
  - 서버 재초기화 뒤 API 세션 쿠키가 무효였다(재생기 수정 뒤 `--retry-rejected`로 채택).
- **실험에서 드러나 고친 것:**
  - 기록 형식:
    - 목록 검사 `all_equals`·`in`·`not_in`·`field`, `excludes`
    - 쿼리를 포함한 `url` 검사
    - api 검사의 자체 GET 요청
    - db `count`를 캡처 값과 비교
  - `record`가 0부터 세는 `failed_at_step`의 범위를 검사한다.
  - 스윕:
    - 로딩이 끝날 때까지 기다린다.
    - 다시 그려진 요소나 비활성·클릭할 수 없는 요소는 실패가 아니라 건너뛴다.
    - 앱 안에서 화면이 바뀌면 새 화면의 요소를 '늦게 생긴 요소'로 치지 않는다.
    - 나중에 생긴 요소의 키에 링크 주소를 포함한다.
    - 로그인 출처는 더 최근 파일을 쓴다.
  - 재생: 기록의 `session`과 같은 이름의 API 요청은 브라우저 로그인 쿠키를 쓴다.
- **스윕 확인(`main` 코드):** `pager_dead`를 켜면 '다음'이 `fail: no effect`, 끄면 `clean`이다. 비활성 '이전'과 '로그아웃'은 건너뛰었다.
- **확인하지 못한 것:**
  - 로케이터를 일부러 깨뜨리는 fallback은 단위 테스트로만 확인했다. 실험에서는 자연스럽게 생긴 fallback(`not_accepted`·`bad_recording`·`rejected` → 테스터 재기록)으로 흐름을 확인했다.
  - 테스터 여러 명이 같은 `sweep/<run_id>.json`에 동시에 쓰면 일부 URL 결과가 빠질 수 있다. 같은 라운드에서는 마지막 쓰기만 남는다.

## TC 변경 기록

- 2026-11-18, 사용자 OK: `TC.tc-replay.sweep-dead-button`과 `TC.tc-replay.sweep-destructive-skipped`의 `observe.key`를 `sweep/<run_id>.json`에서 `sweep/<run_id>/`로 바꿨다.
  - 사유: 병렬 테스터의 동시 쓰기로 결과가 빠지는 것을 막으려고 스윕 결과를 URL별 파일로 나눴다.
  - 문장(text)은 바꾸지 않았다.

## Audit History

- iter-1: 2026-11-18 / critical=0 high=0 medium=1 low=7 / next_action=done
  - SEC-001(design): 사용자 결정으로 채택을 `replay-accepted.json`에만 남긴다. 기록 파일의 status는 candidate만 허용한다.
  - SEC-002~008 반영:
    - url_regex 제한
    - 기록의 TC id와 파일 이름 일치
    - `tc_file`은 `docs/tc/*.tc.json`만 허용
    - 읽기 금지 목록에 replay-state·replay-pending·obs 추가
    - 관찰 파일의 비밀 값 마스킹
    - 서비스 워커 차단, 다른 출처 웹소켓 차단, destructive 단어 확장
    - 심볼릭 링크 거부

## Code Review History

- code-review-iter-1: 2026-11-18 / critical=0 high=0 medium=2 low=4 / profile_status=cached / next_action=self_fix
  - QA-001(design): 사용자 결정으로 스윕 error를 fail로 본다.
  - QA-002: destructive 정규식에 단어 경계를 넣었다.
  - QA-003(design): 사용자 결정으로 채택하되 `unverified`로 표시한다.
  - QA-004: 같은 이름의 컨트롤을 순번으로 구분한다.
  - QA-005: 스윕 컨텍스트를 finally에서 닫는다.
  - QA-006: api TC에서 화면 동작을 거부하고, 단계가 없는 TC에 맞는 메시지를 낸다.
  - 모두 반영했고 테스트 193개가 통과한다.

## 감사 반영 뒤 재확인 (2026-11-18)

- 채택 방식을 `replay-accepted.json`으로 바꾼 뒤 샘플 앱 기록 10개를 다시 검증했다.
- 결함을 고친 코드에서 1라운드(결함 있는 코드) 테스터 판정과 비교하면 3개가 `rejected`가 됐다.
  - 테스터는 FAIL, 재생은 PASS였다. 검증 재생은 테스터와 같은 코드에서 해야 한다.
  - 매니저 가이드 §2-C에 "수정 전에 검증"을 명시했다.
  - 1라운드 코드(`e7cb0db`)로 되돌려 `--retry-rejected`로 다시 검증하니 모두 `accepted`가 됐다(`filter-by-status`는 `unverified: [1]`).
- 고친 코드에서 10개를 모두 재생했다(1분 30초, 스윕 포함, LLM 토큰 0).
  - 9개가 PASS로 기록됐다.
  - 1개는 Jev REVIEW라 매니저가 판정했다(PASS).
- **남은 관찰:** `filter-by-status`[1]("주소의 status 값이 shipped이다")은 테스터가 `judge: jev`로 기록해 매 라운드 REVIEW가 난다. `url` 검사가 생겼으니 다시 기록하면 코드 판정이 된다.

## 실제 프로젝트(grimbang) 적용에서 고친 것 (2026-11-18)

- `browser_origins`: 앱의 브라우저 코드가 부르는 다른 https 출처(예: Supabase)를 실행 설정에서 허용한다. 재생과 스윕은 `base_url`과 이 목록만 통과시킨다.
- 재생기:
  - api 검사에 응답 헤더(`header`)를 추가했다.
  - 기대 결과를 확인한 뒤 진행 중인 요청이 끝날 때까지(최대 3초) 기다렸다가 불변 조건을 판정한다.
- 스윕:
  - 단계마다 시간 제한, 화면당 3분 상한, DOM 안정 대기를 둔다.
  - "효과 없음"이면 재시도하고, 클릭 실패는 판정하지 않는다.
  - 덮인 컨트롤은 건너뛰고 개수를 기록한다.
  - 같은 출처 웹소켓은 열어 두되, 쓰기 방지를 위해 페이지→서버 메시지를 버린다.
  - `CC_SWEEP_DEBUG=1`로 진단 로그를 남긴다.
- **남은 한계:** 애니메이션처럼 DOM이 계속 바뀌는 앱에서는 효과 판정이 부정확하다(모든 클릭이 "효과 있음"). 판정 방식 재설계는 별도 작업이다.
- **알려진 약점:** 검증 재생은 판정 결과만 비교한다. 이유가 달라도 결과가 같으면 채택된다(grimbang 1라운드에서 CSP 차단 FAIL과 잘못된 선택자 FAIL이 일치로 채택됨).

## Audit History (iter-2, 실제 프로젝트 후속)

- iter-2: 2026-11-18 / critical=0 high=0 medium=2 low=1 / next_action=self_fix
  - SEC-001: 웹소켓 페이지→서버 메시지를 버리도록 반영했다.
  - SEC-002: `browser_origins`는 계획 승인으로만 늘어나며, 지침에 명시했다.
  - gitleaks 이력 3건은 테스트용 가짜 값(`sk_live_ABCD…` 마스킹 문자열, `apikey_test_…`)이다.

## Code Review History (iter-2)

- code-review-iter-2: 2026-11-18 / critical=0 high=0 medium=1 low=3 / profile_status=cached / next_action=self_fix
  - QA-007: 웹소켓(SEC-001과 같음)을 반영했다.
  - QA-008: 덮임 판정에 scrollIntoView와 ShadowRoot를 반영하고 개수를 기록한다.
  - QA-009: 들여쓰기를 고쳤다.
  - QA-010: 시간 상한을 늦게 생긴 요소와 재시도에도 적용했다.
  - 테스트 193개가 통과한다. 웹소켓 메시지 차단은 자동 테스트가 없다.
