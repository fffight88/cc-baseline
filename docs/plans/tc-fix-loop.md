# TC 2단계 — 수정 루프 (실패 TC를 고치고 같은 TC를 다시 돌린다)

1단계(TC 생성·판정)와 2단계 정비(Jev 판정 주체화, `tc-jev-loop.md`)로 "고정된 TC를 돌려 판정을 남기는 것"까지는 된다. 이 플랜은 그다음, **실패한 TC를 고치고 같은 TC를 다시 돌려 모든 ready TC가 통과할 때까지 가는 루프**를 만든다. 루프의 판단(무엇을 다시 돌릴지, 언제 멈출지)은 새 스크립트 `tc-fix-loop.js`가 코드로 하고, 매니저(메인 세션)는 그 출력대로 움직인다.

## ⚡ Key Rules Summary

| ✅ DO | ❌ DON'T |
|---|---|
| 다음 행동은 `tc-fix-loop.js next`의 출력(`action`)대로 한다 | 다시 돌릴 TC·멈출 시점을 매니저가 임의로 정하기 |
| 실패마다 분류(`product`·`env`·`fixture`·`runner`·`case`·`decision`)를 먼저 기록한다 | 분류 없이 고치기 |
| `product`만 자동으로 고친다. 나머지는 멈추고 사용자에게 넘긴다 | `case`·`decision` 실패를 제품 코드로 우회하기 |
| 테스트 스위트가 있으면 실패를 재현하는 테스트를 먼저 쓰고 고친다 | 재현 없이 고치고 "통과"라 하기 |
| TC 문장이 틀려 보이면 루프를 멈추고 묻는다. 바꿀 때는 사용자 OK + 사유를 `tc-change`로 남긴다 | TC 문장을 바꾸거나 기대 결과를 약하게 해서 통과시키기 |
| 같은 TC가 같은 실패 지문으로 다시 실패하면 그 TC를 멈춘다 | 같은 수정을 반복하기 |
| 안전 상한: TC당 수정 3번, 전체 5라운드 (`tc-run.json`의 `loop`로 조정) | 상한 없이 돌리기 |
| 부분 재실행이 모두 통과하면 전체 1라운드로 회귀를 확인하고 끝낸다 | 부분 재실행만 보고 "전부 통과"라 하기 |
| 테스트 데이터만 특별 처리하는 수정은 하지 않는다 | TC의 입력값·계정을 코드에서 분기해 통과시키기 |

## Meta
- Security Impact: Yes
- Code Quality Impact: Yes
- UI Impact: No
- Behavior Impact: Yes
- Reason: 새 스크립트가 프로젝트 안 파일(`findings.json`)을 쓰고 TC 파일·결과를 읽는다. 매니저 지침의 실패 처리 흐름이 바뀌고, 루프가 제품 코드를 자동으로 고친다.

---

## Context

- `docs/plans/tc-generation.md`의 로드맵 단계 2("모든 TC가 통과할 때까지")를 별도 플랜으로 미뤄 뒀다(2026-11-08 결정). 같은 문서에 골격이 있다: 통과 정의, TC 원문 동결, 실패 분류 6종, 진전 없음 감지, 상한, 재실행 범위, `findings.json` 기록.
- 지금은 매니저 가이드 §2-A 6번 한 줄("제품을 고치고 같은 TC를 다시 돌린다")뿐이다. 언제 멈추는지, 무엇을 다시 돌리는지, 수정이 어떤 실패에 대한 것인지 남지 않는다.
- 사용자 결정(2026-11-18):
  - 루프 상태는 스크립트와 지침으로 관리한다.
  - `product` 실패는 확인 없이 자동으로 고친다.
  - 테스트 스위트가 있으면 재현 테스트를 필수로 쓴다.
  - 상한은 진전 기준에 안전 상한을 더한다(무한 반복과 비교한 뒤 정함).
- 무한 반복을 택하지 않은 이유는 세 가지다.
  - 고칠 수 없는 실패가 섞이면 끝나지 않는다.
  - 라운드당 약 60만 토큰이 든다.
  - 통과 압박 때문에 테스트를 노린 수정이 나올 위험이 있다.

### 범위 밖

- 반복 실행기(할 일 2): 조작을 기록해 재생하는 것, 범용 실행기. 이 루프는 기존 실행 수단(e2e-tester 에이전트, 프로젝트 드라이버)을 그대로 쓴다.
- 실패 분류 자동화. 분류는 매니저(LLM)가 하고 스크립트는 기록과 검증만 한다.

---

## 설계

### 1. 파일

- **루프 파일:** `.cc-audits/<plan-slug>/findings.json` (커밋 안 함, 0600)
  - `frozen`: 시작 시점의 TC별 digest. `tc-jev-judge.js`의 `canonical`·`sha256`과 같은 방식이다.
  - `limits`, `rounds[]`(`run_id`, `kind: full|partial|final`, `tcs`), `failures[]`, `fixes[]`, `tc_changes[]`, `accepted[]`(수용한 NOT_OBSERVABLE)
- **설정:** `tc-run.json`에 선택 항목 `"loop": { "max_fixes_per_tc": 3, "max_rounds": 5, "stuck_after": 2 }`를 둔다. 없으면 이 기본값을 쓴다.
- **결과:** 기존 `tc-results.jsonl`을 그대로 읽는다. 루프에 등록된 `run_id`의 줄만 본다.

### 2. `templates/scripts/tc-fix-loop.js` (런타임 의존성 0)

| 명령 | 하는 일 | 거부(종료 코드 2) |
|---|---|---|
| `start --tc-file <f> --run <tc-run.json> [--results <r>]` | ready이면서 skip이 아닌 TC 목록과 digest를 고정하고, 상한을 읽어 `findings.json` 생성 | 이미 루프가 있으면 거부 (`--restart`로 새로 시작) |
| `next` | 상태를 계산해 JSON 한 줄 출력: `action`, `tcs`, `ask_user[]`, `regressions[]`, `round`, `limits_left` | — |
| `round --run-id <id>` | `next`가 `run_round`·`final_regression`일 때 그 TC 목록으로 라운드 등록 | 상한 초과, TC 문장이 바뀌었는데 `tc-change` 기록이 없음(바뀐 TC id를 출력), 결과가 아직 없는 라운드가 열려 있음 |
| `classify --tc <id> --class <c> --note <text>` | 현재 라운드의 실패에 분류와 지문을 기록 | 그 TC가 이번 라운드에서 실패하지 않음 |
| `fix --tc <id> --files <a,b> --test <path\|none:<reason>> --summary <text> [--affected <id,…>]` | 수정 기록 | `product`가 아닌 실패, `--test` 없음, TC당 수정 상한 초과 |
| `accept --tc <id> --index <n> --reason <text>` | NOT_OBSERVABLE을 수용한 것으로 기록 | 그 결과가 NOT_OBSERVABLE이 아님 |
| `tc-change --tc <id> --reason <text>` | 사용자가 승인한 TC 문장 변경을 기록하고, digest를 새로 고정하고, 그 TC의 시도 수를 초기화 | TC 파일에서 실제로 바뀐 것이 없음 |
| `resume --tc <id>` | 사용자가 처리한 TC(`ask_user`에 있던 것)를 루프로 되돌림 | — |
| `report` | 라운드 수, 수정 수, 분류 비율, 회귀, Jev 비용(결과 줄의 `jev_ms`·`jev_tokens`), 라운드별 시간 | — |

**`next`의 `action` (위에서부터 처음 맞는 것)**

1. `run_round` (첫 라운드): 고정된 TC 전부
2. `wait_results`: 열린 라운드에 결과 줄이 없는 TC가 있음 → `tcs`에 그 TC
3. `classify`: 이번 라운드에서 실패했는데 분류가 없는 TC
4. `fix`: `product`로 분류됐는데 수정 기록이 없는 TC
5. `cap_reached`: 라운드 상한에 닿았는데 아직 실패가 남음
6. `run_round` (부분): 수정된 TC와 `--affected` TC
7. `final_regression`: 남은 실패가 없고 마지막 라운드가 전체 라운드가 아님 → 고정된 TC 전부
8. `ask_user`: 남은 TC가 모두 사용자에게 넘어감
9. `done`: final 라운드가 모두 PASS(또는 수용된 NOT_OBSERVABLE)이고 `ask_user`가 비어 있음

`ask_user[]`는 어떤 `action`과도 함께 나온다. 각 항목은 `{tc, reason: class|stuck|fix_cap, class?, note?}`이다. 사용자에게 넘긴 TC가 있어도 나머지 TC의 루프는 계속 돈다.

**실패 지문:** TC 결과 줄의 `failed_at_step`과, FAIL인 기대 결과 index를 정렬한 목록을 sha256해 앞 12자를 쓴다. `observed` 값은 넣지 않는다(주문 번호처럼 매번 바뀌기 때문). 같은 TC가 수정 뒤 같은 지문으로 다시 실패하면 `stuck_after`에 걸려 `ask_user`(stuck)로 간다.

**회귀:** 이 루프에서 PASS였던 TC가 이후 라운드에서 실패하면 `regressions[]`에 넣는다. 분류와 수정은 다른 실패와 똑같이 거친다.

**TC 원문 동결:** `round`와 `next`는 TC 파일의 현재 digest를 `frozen`과 비교한다. 결과 줄의 `tc_digest`가 `frozen`과 다르면 그 줄은 이 루프의 결과로 치지 않는다.

**쓰기 범위:** `findings.json`은 `.cc-audits/<slug>/` 안에만 쓴다. `tc-api-run.js`처럼 경로 이름을 검사한다. 입력 경로는 프로젝트 루트 안으로 제한한다.

### 3. 지침

- **`reference_e2e_manager_guide.md`**
  - §2-A 6번을 "§2-B로"로 바꾼다.
  - 새 §2-B "Fix loop"를 둔다.
    - 루프 순서: `start` → (`next` → `round` → 실행 → `classify` → `fix` → `next`) 반복 → `final_regression` → `done` → `report`
    - 분류 기준표(6종, 각각 누가 처리하는지)
    - 수정 규칙: 재현 테스트를 먼저 쓴다. 테스트 데이터·계정·TC id로 분기하지 않는다. TC 파일을 건드리지 않는다(`git diff --quiet -- docs/tc/`).
    - `ask_user` 처리: AskUserQuestion으로 묻고, `tc-change`·`resume`을 쓴다.
    - 실행 수단: 첫 라운드는 e2e-tester, 이후는 프로젝트에 드라이버가 있으면 써도 된다(실행 수단을 결과 줄의 `browser_tool`에 남긴다).
  - Checklist에 항목을 추가한다.
- **`reference_tc_authoring.md` §"what e2e may not change"**: 수정 루프에서도 같은 규칙이 적용된다는 한 줄과 `tc-change` 언급
- **`commands/plan.md` E2E 단락**: 실패 TC가 있으면 §2-B 수정 루프로 간다는 한 줄
- **`e2e-tester.md`**: 바꾸지 않는다. 테스터는 지금처럼 실행과 기록만 한다.
- **`manifest.json`**: `scripts/tc-fix-loop.js` 추가

---

## Phase A — `tc-fix-loop.js`

1. Read ~/.claude/memory/phase_start.md and execute
2. 승인 직후: 아래 TC 초안을 `docs/tc/tc-fix-loop.tc.json`으로 그대로 쓰고, 플랜을 `docs/plans/tc-fix-loop.md`로 복사한다. `tc-lint.js --json`, `tc-jev-check.js --out .cc-audits/tc-fix-loop/tc-check.json`을 다시 돌린다.
3. `templates/scripts/tc-fix-loop.js` 작성
   - `jev-client.js`의 `parseArgs`를 재사용한다.
   - digest는 `tc-jev-judge.js`와 같은 `canonical` + sha256 방식을 쓴다. 공용 함수로 꺼낼 수 있으면 export해서 재사용하고, 아니면 같은 구현임을 테스트로 고정한다.
4. `test/run.js`에 단위 테스트 추가: 아래 TC 10개에 대응하는 것 + 경로 거부 + `tc-change`·`resume`·`accept`·`report`
5. `npm test` 통과
6. Read ~/.claude/memory/phase_end.md and execute

## Phase B — 지침·설치

1. Read ~/.claude/memory/phase_start.md and execute
2. 매니저 가이드 §2-A 6번을 고치고, §2-B와 Checklist를 추가한다.
3. `reference_tc_authoring.md`, `commands/plan.md`에 한 줄씩 추가하고, `manifest.json`에 스크립트를 추가한다.
4. `node bin/cli.js --yes`로 이 서버에 설치하고, `--doctor`가 정상인지 확인한다.
5. Read ~/.claude/memory/phase_end.md and execute

## Phase C — 샘플 앱 검증 (레포 밖)

1. Read ~/.claude/memory/phase_start.md and execute
2. `/home/workspace/tc-sample-app`에서 브랜치 `fix-loop-trial`을 만든다(로컬 git, 커밋하지 않은 변경이 있으면 먼저 확인).
3. 결함 몇 개를 켜고(`BUG=...`, 화면 2·API 1 이상) `node scripts/matrix.js start`로 서버를 띄운 뒤 루프를 돈다.
   - 1라운드는 드라이버(`driver.js --run-id`)로 돌린다.
   - 실패를 분류한다.
   - 결함 분기를 실제 코드에서 제거하는 방식으로 고친다(`BUG` 값을 끄는 것은 수정으로 치지 않는다). 재현 테스트도 쓴다.
   - `--only`로 다시 돌리고, `final_regression`을 거쳐 `done`까지 간다.
4. 일부러 하나는 `case`로 분류해 `ask_user` 흐름을 보고, 하나는 고치지 않은 채 다시 돌려 stuck 흐름을 확인한다.
5. `report` 결과(라운드 수, 수정 수, 시간, Jev 비용)를 이 플랜 아래 "Phase C 결과"에 적는다. 이 결과는 할 일 2(반복 실행기) 판단에 쓴다.
6. `node scripts/matrix.js stop`, `/clean`
7. Read ~/.claude/memory/phase_end.md and execute

## Phase D — 게이트·푸시

1. Read ~/.claude/memory/phase_start.md and execute
2. security-auditor와 code-reviewer를 병렬로 돌리고, 지적 사항을 반영한다.
3. 커밋(`.claude/` 제외 규칙)하고, 푸시는 사용자 확인 뒤에 한다.
4. 프로젝트 메모리와 `HANDOFF-next.md`를 갱신한다(할 일 1 완료, S4·Jev 키 교체는 남은 일).
5. Read ~/.claude/memory/phase_end.md and execute

---

## Test Cases (draft)

cc-baseline 자체의 TC(`surface: cli`)다. 승인 직후 `docs/tc/tc-fix-loop.tc.json`으로 쓴다. 기대 결과는 모두 종료 코드·출력 JSON·파일 내용으로 확인한다(`artifact` 채널, 코드 판정).

| TC ID | 제목 | surface | readiness | 기대 결과 수 |
|---|---|---|---|---|
| TC.tc-fix-loop.first-round-all | 첫 라운드는 skip이 아닌 ready TC 전부 | cli | ready | 2 |
| TC.tc-fix-loop.unclassified-blocks | 분류 없는 실패가 다음 라운드를 막는다 | cli | ready | 2 |
| TC.tc-fix-loop.rerun-only-fixed | 수정 뒤에는 수정·영향 TC만 다시 돈다 | cli | ready | 2 |
| TC.tc-fix-loop.non-product-to-user | `case` 실패는 사용자에게 가고 다시 돌지 않는다 | cli | ready | 2 |
| TC.tc-fix-loop.fix-needs-test | `--test` 없는 수정 기록은 거부된다 | cli | ready | 2 |
| TC.tc-fix-loop.stuck-same-fingerprint | 수정 뒤 같은 지문이면 그 TC는 멈춘다 | cli | ready | 2 |
| TC.tc-fix-loop.round-cap | 6번째 라운드는 거부된다 | cli | ready | 2 |
| TC.tc-fix-loop.tc-text-frozen | 승인 기록 없이 TC 문장이 바뀌면 라운드가 거부된다 | cli | ready | 2 |
| TC.tc-fix-loop.final-regression | 부분 재실행이 통과하면 전체 1라운드 뒤에 끝난다 | cli | ready | 2 |
| TC.tc-fix-loop.regression-flagged | 전에 통과했던 TC가 실패하면 회귀로 표시된다 | cli | ready | 1 |

검사 요약 (표준 입력): `tc-lint` 0건. 첫 검사의 5건(single_fact 2, format 3)은 고쳤다. 결정 근거는 `basis.kind: requirement` + `DEC.loop-limits` 참조로 바꿨다. `tc-jev-check`는 jev-1.14.0으로 19개 문장을 검사해 경고 0건이다.

열린 질문은 없다. 상한 값(3·5·2)은 이 플랜에서 정했고 `tc-run.json`에서 바꿀 수 있다.

```json
{
  "schema_version": 1,
  "feature": "tc-fix-loop",
  "title": "Stage-2 TC fix loop",
  "plan": "tc-fix-loop",
  "sources": [
    { "id": "REQ.tc-fix-loop-plan", "kind": "requirement", "locator": "docs/plans/tc-fix-loop.md (approved 2026-11-18)" },
    { "id": "REQ.stage2-skeleton", "kind": "requirement", "locator": "docs/plans/tc-generation.md, stage 2 fix loop section (decided 2026-11-08)" },
    { "id": "DEC.loop-limits", "kind": "decision", "locator": "user decision 2026-11-18: progress-based stop plus safety caps (3 fixes per TC, 5 rounds), script plus guide, auto-fix product failures, repro test required when a suite exists" }
  ],
  "actions": [
    { "id": "ACT.tc-fix-loop.next", "title": "Ask the loop what to do next", "actor": "e2e manager", "trigger": "runs tc-fix-loop.js next", "preconditions": ["tc-fix-loop.js start was run"], "outputs": ["one JSON line with action and TC list"], "evidence_refs": ["REQ.tc-fix-loop-plan", "REQ.stage2-skeleton"] },
    { "id": "ACT.tc-fix-loop.round", "title": "Open a run round", "actor": "e2e manager", "trigger": "runs tc-fix-loop.js round --run-id <id>", "preconditions": ["next returned run_round or final_regression"], "outputs": ["round entry in findings.json"], "evidence_refs": ["REQ.tc-fix-loop-plan"] },
    { "id": "ACT.tc-fix-loop.classify", "title": "Classify a failing TC", "actor": "e2e manager", "trigger": "runs tc-fix-loop.js classify --tc <id> --class <class>", "preconditions": ["the TC failed in the current round"], "outputs": ["failure entry with class and fingerprint"], "evidence_refs": ["REQ.stage2-skeleton"] },
    { "id": "ACT.tc-fix-loop.fix", "title": "Record a product fix", "actor": "e2e manager", "trigger": "runs tc-fix-loop.js fix --tc <id> --files <list> --test <path or none:reason>", "preconditions": ["the TC failure is classified product"], "outputs": ["fix entry in findings.json"], "evidence_refs": ["REQ.stage2-skeleton", "DEC.loop-limits"] }
  ],
  "test_cases": [
    { "id": "TC.tc-fix-loop.first-round-all", "title": "The first round runs every ready TC that is not skipped", "action_refs": ["ACT.tc-fix-loop.next"], "level": "functional", "surface": "cli",
      "preconditions": ["a TC file with 3 ready TCs and 1 needs-decision TC", "tc-run.json skips one ready TC", "tc-fix-loop.js start was run"],
      "steps": [{ "goal": "Run tc-fix-loop.js next", "done_when": { "expect": "The command exits" } }],
      "expected": [
        { "text": "The output action is run_round", "observe": { "channel": "artifact", "key": "stdout JSON .action" } },
        { "text": "The output tcs list holds exactly the 2 ready TCs that are not skipped", "observe": { "channel": "artifact", "key": "stdout JSON .tcs" } }
      ], "basis": { "kind": "requirement", "refs": ["REQ.stage2-skeleton"] }, "readiness": "ready" },
    { "id": "TC.tc-fix-loop.unclassified-blocks", "title": "A failure with no class blocks the next round", "action_refs": ["ACT.tc-fix-loop.next"], "level": "functional", "surface": "cli",
      "preconditions": ["round 1 recorded one FAIL line and no classify call"],
      "steps": [{ "goal": "Run tc-fix-loop.js next", "done_when": { "expect": "The command exits" } }],
      "expected": [
        { "text": "The output action is classify", "observe": { "channel": "artifact", "key": "stdout JSON .action" } },
        { "text": "The output tcs list holds the failing TC id", "observe": { "channel": "artifact", "key": "stdout JSON .tcs" } }
      ], "basis": { "kind": "requirement", "refs": ["REQ.stage2-skeleton"] }, "readiness": "ready" },
    { "id": "TC.tc-fix-loop.rerun-only-fixed", "title": "After a fix only the fixed and affected TCs run again", "action_refs": ["ACT.tc-fix-loop.next"], "level": "functional", "surface": "cli",
      "preconditions": ["round 1: TC A failed, TC B and C passed", "A classified product", "fix recorded for A with --affected B"],
      "steps": [{ "goal": "Run tc-fix-loop.js next", "done_when": { "expect": "The command exits" } }],
      "expected": [
        { "text": "The output action is run_round", "observe": { "channel": "artifact", "key": "stdout JSON .action" } },
        { "text": "The output tcs list equals [A, B]", "observe": { "channel": "artifact", "key": "stdout JSON .tcs" } }
      ], "basis": { "kind": "requirement", "refs": ["REQ.stage2-skeleton"] }, "readiness": "ready" },
    { "id": "TC.tc-fix-loop.non-product-to-user", "title": "A case-class failure goes to the user and is not run again", "action_refs": ["ACT.tc-fix-loop.classify"], "level": "functional", "surface": "cli",
      "preconditions": ["round 1: TC A failed", "A classified case with a note"],
      "steps": [{ "goal": "Run tc-fix-loop.js next", "done_when": { "expect": "The command exits" } }],
      "expected": [
        { "text": "The output ask_user list holds A with class case", "observe": { "channel": "artifact", "key": "stdout JSON .ask_user" } },
        { "text": "A is not in the output tcs list", "observe": { "channel": "artifact", "key": "stdout JSON .tcs" } }
      ], "basis": { "kind": "requirement", "refs": ["REQ.stage2-skeleton"] }, "readiness": "ready" },
    { "id": "TC.tc-fix-loop.fix-needs-test", "title": "A fix record with no --test is refused", "action_refs": ["ACT.tc-fix-loop.fix"], "level": "functional", "surface": "cli",
      "preconditions": ["TC A failed and is classified product"],
      "steps": [{ "goal": "Run tc-fix-loop.js fix --tc A --files src/x.js without --test", "done_when": { "expect": "The command exits" } }],
      "expected": [
        { "text": "The exit code is 2", "observe": { "channel": "artifact", "key": "exit code" } },
        { "text": "findings.json has no fix entry for A", "observe": { "channel": "artifact", "key": "findings.json .fixes" } }
      ], "basis": { "kind": "requirement", "refs": ["DEC.loop-limits"] }, "readiness": "ready" },
    { "id": "TC.tc-fix-loop.stuck-same-fingerprint", "title": "The same failure fingerprint after a fix stops that TC", "action_refs": ["ACT.tc-fix-loop.next"], "level": "functional", "surface": "cli",
      "preconditions": ["TC A failed in round 1 at expected index 1", "A classified product and fixed", "A failed again in round 2 at expected index 1 only"],
      "steps": [{ "goal": "Run tc-fix-loop.js next", "done_when": { "expect": "The command exits" } }],
      "expected": [
        { "text": "The output ask_user list holds A with reason stuck", "observe": { "channel": "artifact", "key": "stdout JSON .ask_user" } },
        { "text": "A is not in the output tcs list", "observe": { "channel": "artifact", "key": "stdout JSON .tcs" } }
      ], "basis": { "kind": "requirement", "refs": ["DEC.loop-limits"] }, "readiness": "ready" },
    { "id": "TC.tc-fix-loop.round-cap", "title": "A sixth round is refused", "action_refs": ["ACT.tc-fix-loop.round"], "level": "functional", "surface": "cli",
      "preconditions": ["5 rounds opened with the default limits", "one TC still fails"],
      "steps": [{ "goal": "Run tc-fix-loop.js round --run-id with a new id", "done_when": { "expect": "The command exits" } }],
      "expected": [
        { "text": "The exit code is 2", "observe": { "channel": "artifact", "key": "exit code" } },
        { "text": "tc-fix-loop.js next prints action cap_reached", "observe": { "channel": "artifact", "key": "stdout JSON .action" } }
      ], "basis": { "kind": "requirement", "refs": ["DEC.loop-limits"] }, "readiness": "ready" },
    { "id": "TC.tc-fix-loop.tc-text-frozen", "title": "A round is refused after TC text changed without an approved change", "action_refs": ["ACT.tc-fix-loop.round"], "level": "functional", "surface": "cli",
      "preconditions": ["loop started", "one expected text in the TC file was edited afterwards", "no tc-change entry"],
      "steps": [{ "goal": "Run tc-fix-loop.js round --run-id with a new id", "done_when": { "expect": "The command exits" } }],
      "expected": [
        { "text": "The exit code is 2", "observe": { "channel": "artifact", "key": "exit code" } },
        { "text": "The error output names the changed TC id", "observe": { "channel": "artifact", "key": "stderr" } }
      ], "basis": { "kind": "requirement", "refs": ["REQ.stage2-skeleton"] }, "readiness": "ready" },
    { "id": "TC.tc-fix-loop.final-regression", "title": "When reruns pass, one full round runs before done", "action_refs": ["ACT.tc-fix-loop.next"], "level": "functional", "surface": "cli",
      "preconditions": ["round 1: A failed, B passed", "A fixed", "round 2 ran only A and it passed"],
      "steps": [{ "goal": "Run tc-fix-loop.js next", "done_when": { "expect": "The command exits" } }],
      "expected": [
        { "text": "The output action is final_regression", "observe": { "channel": "artifact", "key": "stdout JSON .action" } },
        { "text": "The output tcs list equals [A, B]", "observe": { "channel": "artifact", "key": "stdout JSON .tcs" } }
      ], "basis": { "kind": "requirement", "refs": ["REQ.stage2-skeleton"] }, "readiness": "ready" },
    { "id": "TC.tc-fix-loop.regression-flagged", "title": "A TC that passed before and fails now is marked as a regression", "action_refs": ["ACT.tc-fix-loop.next"], "level": "functional", "surface": "cli",
      "preconditions": ["TC B passed in round 1", "B failed in round 2"],
      "steps": [{ "goal": "Run tc-fix-loop.js next", "done_when": { "expect": "The command exits" } }],
      "expected": [
        { "text": "The output regressions list holds B", "observe": { "channel": "artifact", "key": "stdout JSON .regressions" } }
      ], "basis": { "kind": "requirement", "refs": ["REQ.stage2-skeleton"] }, "readiness": "ready" }
  ],
  "open_questions": []
}
```

## E2E

- cc-baseline에는 화면이 없다. 위 TC 10개는 `npm test`의 단위 테스트로 대응해서 확인한다.
- 실제 루프 검증은 Phase C에서 샘플 앱으로 한다.
  - `tc-run.json`은 기존 `tc-sample-app/.cc-audits/<slug>/tc-run.json`을 쓰고 `loop`는 기본값으로 둔다.
  - base_url은 `http://localhost:3100`(loopback)이다.
  - 화면 TC는 드라이버로, api TC는 `tc-api-run.js`로 돌린다.

## 검증

- `npm test` 전부 통과(기존 169개 + 새 테스트)
- `node bin/cli.js --doctor` 정상, `~/.claude/scripts/tc-fix-loop.js` 설치됨
- Phase C:
  - `done`까지 간다.
  - `case` → `ask_user`, 같은 지문 → stuck을 확인한다.
  - 루프 내내 `git diff --quiet -- docs/tc/`가 유지된다.
  - `report` 수치를 기록한다.
- `findings.json`이 `.cc-audits/` 밖에 생기지 않는다.

## ✅ Checklist

- [ ] TC 초안을 승인 직후 파일로 썼고, 다시 검사했다
- [ ] `next`의 action 순서(1~9)와 `ask_user` 병행이 테스트로 고정됐다
- [ ] TC 문장이 바뀌면 `tc-change` 없이는 라운드가 거부된다
- [ ] `product` 외 분류는 수정 기록이 거부되고 `ask_user`로 간다
- [ ] `--test` 없는 수정은 거부된다(`none:<reason>`은 허용)
- [ ] 상한(3·5·2)이 기본값이고 `tc-run.json`의 `loop`로 바뀐다
- [ ] 매니저 가이드 §2-B와 Checklist, authoring·plan 한 줄, manifest를 반영했다
- [ ] 샘플 앱 루프가 `done`까지 갔고, BUG를 끄는 것이 아니라 코드를 고쳤다
- [ ] 보안 감사와 코드 리뷰를 반영했다. 푸시는 사용자 확인 뒤에 한다
- [ ] 서버를 정지했다(`matrix.js stop`, `/clean`)

---

## Phase C 결과 (2026-11-18, 샘플 앱 `fix-loop-trial` 브랜치)

- **대상:** `docs/tc/order-list.tc.json` 9개(화면 6, API 3). 결함은 `filter_ignored`, `page_overlap`(서버), `empty_no_message`, `pager_dead`(화면). 실행은 드라이버(code 판정)로 했다.
- **흐름:**

| 라운드 | 종류 | TC | 통과 | 시간 |
|---|---|---|---|---|
| 1 | full | 9 | 4 | 22.4초 |
| 2 | partial | 6 | 4 | 15.8초 |
| 3 | partial | 3 | 3 | 4.9초 |
| 4 | final | 9 | 9 | 12.0초 |

- 수정 5건. 분류는 product 5, case 1이다. 수정은 모두 결함 분기를 코드에서 지웠다(`BUG` 값은 그대로 켜 둠). 샘플 앱에는 테스트 스위트가 없어 `--test none:`으로 기록했다.
- **확인한 흐름:**
  - `case`로 분류한 TC는 `ask_user`로 빠졌다. 그동안 나머지 TC의 루프는 계속 돌았다.
  - 실제 변경 없이 수정만 기록한 TC는 2라운드에서 같은 지문으로 실패해 `stuck`이 됐다.
  - 수정 뒤 실패 지문이 바뀐 TC(`page-next`)는 멈추지 않고 다시 분류 단계로 갔다.
  - 부분 재실행이 모두 통과한 뒤 `final_regression`을 거쳐 `done`이 됐다.
  - 루프 동안 `docs/tc/`는 바뀌지 않았다.
- **고친 점:** `resume`한 TC를 사용자가 "역시 제품 결함"이라고 답한 경우 다시 분류할 수 없었다. 이제 `classify`가 resume된 TC의 마지막 실패도 받는다(테스트·지침 반영).
- **할 일 2에 넘길 수치:**
  - 드라이버 1라운드(9 TC)는 약 12~22초가 걸리고 LLM 토큰이 0이다.
  - 같은 4라운드(27 TC 실행)를 e2e-tester로 돌리면 라운드당 약 60만 토큰 기준으로 수백만 토큰이 든다.
  - 이 루프 하나만으로도 실행 비용이 반복 실행기를 결정하는 핵심 근거가 된다.
- **판단 방식:** 분류는 이 세션(매니저)이 했다. `case` 분류와 `stuck`을 위한 가짜 수정, `resume`은 흐름을 확인하려고 일부러 한 것이고, 실제 사용자에게 묻지 않았다.

## Audit History

- iter-1: 2026-11-18 / critical=0 high=0 medium=0 low=2 / next_action=done
  - SEC-001: re-check the loop file's paths when loading it
  - SEC-002: random temp file name with `wx`, null-prototype maps, reserved TC ids excluded
  - Both fixed.

## Code Review History

- code-review-iter-1: 2026-11-18 / critical=0 high=0 medium=1 low=2 / profile_status=cached / next_action=done
  - User decisions, both on the recommended option:
    - QA-001: new `no-result` command
    - QA-002: `tc-change` takes a TC out of the loop
  - QA-003: refuse a broken loop file and point to `--restart`
  - All fixed. 183 tests pass.
