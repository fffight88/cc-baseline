# TC/Jev 2단계 — Jev를 판정 주체로, 문제집, API TC 실행기, 플랜 흐름 정리

실제 검증(V1·V7·V9·V10)에서 판정 흐름 자체는 설계대로 동작했다. 이번 플랜은 드러난 문제 10개를 고치고, Jev를 **판정 주체**로 세운다. 목표는 같은 판정을 LLM이 다시 하지 않아서 e2e 판정이 싸고 빠르게 끝나는 것이다. 판정을 Jev에 맡기는 대신 세 가지를 함께 둔다.

- 표본을 모아 두는 **문제집**
- Jev 판정 일부를 LLM이 다시 확인하는 **재검사**
- 엇갈림이 쌓이면 기준을 스스로 내리는 **자동 해제**

## ⚡ Key Rules Summary

| ✅ DO | ❌ DON'T |
|---|---|
| 기준이 있는 질문은 Jev가 PASS/FAIL을 내고, 일부(기본 10%)만 LLM이 재검사 | 기준이 있는데도 모든 판정을 LLM이 다시 하기 |
| Jev와 LLM이 엇갈리면 그 실행은 LLM 판정을 쓰고, 문제를 "검토 대기"로 문제집에 넣기 | 엇갈림을 버리거나 Jev 판정을 그대로 두기 |
| 최근 재검사에서 엇갈림이 기준을 넘으면 그 질문의 기준을 **자동 해제** | 기준을 자동으로 **새로 적용**하기 (적용은 지금처럼 사용자 승인) |
| 문제집을 기준용/검증용으로 고정 분할하고, 검증용에서도 오판이 없어야 적용 가능 | 기준을 계산한 표본으로만 기준을 검증하기 |
| 문제집은 이 서버의 `~/.claude/jev/` 아래에만 둔다 (화면 내용 포함) | 문제집·화면 텍스트를 공개 저장소 cc-baseline에 넣기 |
| API·DB·로그 확인은 e2e-tester가 `tc-api-run.js`로만 실행 | 테스터가 curl 등으로 직접 요청하거나 임의 파일 읽기 |
| `tc-api-run.js`는 `tc-run.json`의 `base_url`과 `readable` 파일만 허용 (코드로 강제) | 허용 범위를 지침 문장으로만 지키기 |
| 플랜 모드에서는 TC 초안을 플랜 본문에 두고, 승인 직후 TC 파일과 `tc-run.json`을 쓴다 | 플랜 모드 읽기 전용 원칙에 예외 두기 |
| "결정 필요" 항목은 플랜 승인 직전에 AskUserQuestion으로 묻는다 | 결정 안 된 TC를 그대로 e2e에 넘기기 |

## Meta
- Security Impact: Yes
- Code Quality Impact: Yes
- UI Impact: No
- Behavior Impact: Yes
- Reason:
  - 새 스크립트가 HTTP 요청을 보내고 로그인 쿠키를 저장하며 프로젝트 파일을 읽는다.
  - Jev 판정 권한이 넓어지고, 기준이 자동으로 해제된다.
  - `/plan` 흐름, e2e-tester와 매니저 지침, 설치기가 바뀐다.

---

## Context

### 실제 검증에서 확인된 것 (2026-11-16)

- 화면 TC 6개를 정상 서버와 결함 서버에서 돌렸다. 코드 판정이 결함을 모두 FAIL로 잡았다.
- Jev 점수는 PASS(0.68~0.99)와 FAIL(0.01~0.09)이 겹치지 않았다.
- Q.holds × jev-1.14.0 기준을 적용했다. 표본 31개, PASS 0.9 이상·FAIL 0.1 이하에서 오판 0건이었다. 적용 뒤 Jev가 PASS와 FAIL을 직접 맞혔다.
- 화면에 없는 사실(DB·로그·메일·재고)을 묻자 Jev는 4개 모두 "관찰 불가"로 보고 LLM에 넘겼다. FAIL을 잘못 내린 경우는 없었다.

### 고칠 문제

| # | 문제 | 처리 |
|---|---|---|
| 1 | `jev_hidden` 경고가 이미 api/db/log 채널인 문장에도 남 (29건 오탐) | Phase A |
| 2 | 플랜 모드는 파일 쓰기가 안 되는데 `/plan`은 TC 파일 작성을 요구 | Phase B |
| 3 | 승인 뒤 `needs-decision` TC를 처리하는 방법이 없음 | Phase B |
| 4 | API TC를 실행할 주체가 없음 (`skip: api-only`로 7개 미실행) | Phase C |
| 5 | `open_questions` 형식이 정의되지 않음, API TC의 `done_when` 기준이 없음 | Phase A |
| 6 | `basis`가 TC 단위에만 있음 | Phase A |
| 7 | 드물게 쓰는 질문은 표본 30개를 채우기 어려움 | Phase D(문제집 현황), Phase F(표본 수집) |
| 8 | 같은 TC를 다시 돌리면 관찰 파일을 덮어씀 | Phase A |
| 9 | DB·로그를 누가 어떻게 읽는지 모호함 | Phase C |
| 10 | Jev 점수가 호출마다 조금 다름 | 처리 안 함. 경계값은 이미 LLM으로 넘어감 |
| 11 | root 리눅스에서 Playwright MCP에 `--no-sandbox`가 빠짐. 재설치하면 손으로 넣은 값도 덮어씀 | Phase A |

### 범위 밖

- Jev가 화면 조작을 고르는 실행 루프, 단계 2 수정 루프. 로드맵에 있던 그대로 둔다.
- V11(판정 방식 비교 실험). 이번 변경 뒤에 별도로 한다. → Phase F에서 `--judge-mode jev`로 앞당겨 했다(아래 "Phase F 결과").

---

## 설계

### 1. Jev 판정 주체화 — 재검사와 자동 해제 (`tc-jev-judge.js`)

**재검사 선정**
- Jev가 PASS/FAIL을 내면 일부 판정에 `audit: true`를 붙인다.
- 선정 기준은 요청 sha256의 앞 2바이트 % 100 < `audit_rate × 100`이다. 같은 화면은 늘 같은 결과가 나와서 재현할 수 있다.
- `audit_rate`는 calibration 항목마다 두고, 기본값은 0.1이다.

**재검사 기록**
- `audit: true`가 붙으면 테스터가 같은 관찰 파일로 LLM 판정을 하나 더 하고 `tc-jev-judge.js audit --sample <sha> --llm PASS|FAIL`을 실행한다.
- 결과는 `~/.claude/jev/audits.jsonl`에 남는다.
- 둘이 일치하면 그 실행의 판정자는 `jev`로 남는다.
- 둘이 엇갈리면 그 실행은 LLM 판정을 쓴다(`judged_by: llm`, `jev_disputed: true`). 해당 표본은 `disputed` 상태가 되고 문제집 "검토 대기"에 들어간다.

**자동 해제**
- 질문 × 모델별 최근 재검사 20건 중 엇갈림이 2건 이상이면 calibration 항목을 지운다.
- 지운 기록은 `calibration.json`의 `revoked[]`에 이유·시각·건수와 함께 남긴다. 그 뒤로 그 질문은 다시 REVIEW, 즉 LLM 판정으로 돌아간다.
- 해제는 안전한 방향이라 자동으로 한다. 다시 적용할 때는 지금처럼 사용자 승인이 필요하다.

**사람 정답 입력**
- `tc-jev-judge.js label --sample <sha> human:PASS|FAIL`로 검토 대기 문제에 사람 정답을 붙인다.
- 사람 정답은 다음 기준 계산부터 쓴다.
- e2e 매니저는 실행이 끝나면 검토 대기 목록(화면 요약 + 기대 결과 + Jev/LLM 판정)을 사용자에게 보여 주고 정답을 묻는다. 건너뛰어도 된다.

### 2. 문제집 (`~/.claude/jev/`, 이 서버 전용)

**저장 구조**
- 지금의 `samples.jsonl`과 `requests/`를 그대로 문제집으로 쓴다.
- 각 표본에 `split`을 붙인다. 요청 sha 기준으로 고정하며, 기준용(`calib`) 70%, 검증용(`holdout`) 30%다.
- 표본에 `status`(`labeled` / `disputed`)와 `project`를 둔다. `project`는 이미 있다.

**기준 계산 (`calibrate`)**
- 기준용 표본으로 선을 제안한다.
- 검증용 표본에서도 오판 PASS·오판 FAIL 비율이 목표(2%) 이하여야 `ok`가 된다. 아니면 `unsafe`다.
- 최소 수량은 기준용 기준으로 30개, 그중 PASS 5개·FAIL 5개 이상이다.
- 결과에 검증용 성적과 서로 다른 프로젝트 수를 함께 보여 준다.

**현황 보기 (`tc-jev-judge.js bank`)**
- 질문 × 모델 × 분할별로 PASS/FAIL 표본 수, 검토 대기 수, 프로젝트 수, 최근 재검사 엇갈림률, 기준 상태(적용/해제/부족)를 표로 보여 준다.
- 어디 표본이 모자란지 바로 보이게 한다.

**내보내기 (`bank --export <dir>`)**
- 표본·요청·기준·재검사 기록을 한 폴더(0700)로 복사한다.
- 다른 서버로 옮기거나, 다른 판정 모델·질문 문장을 비교할 때 쓴다.
- 공개 저장소 안 경로는 거부한다. git 작업 트리 안이면 `.gitignore`에 걸리는지 확인하고, 걸리지 않으면 거부한다.

**기존 `replay`**
- 문제집 전체(검토 대기 제외)를 새 모델로 다시 풀게 하는 용도로 그대로 쓴다.

### 3. API·DB·로그 실행기 — `tc-api-run.js` (cc-baseline에 하나, 모든 프로젝트 공용)

```
node ~/.claude/scripts/tc-api-run.js request --run <tc-run.json> --session <name> --method <M> --path </api/...> [--body <json file>]
node ~/.claude/scripts/tc-api-run.js read    --run <tc-run.json> --source <name> [--grep <text>] [--json-path <a.b[k=v].c>]
```

**`request`**
- 요청은 `tc-run.json`의 `base_url`과 같은 출처(scheme+host+port)로만 보낸다. 다른 출처, 리다이렉트로 다른 출처로 넘어가는 경우, 절대 URL 입력은 모두 거부한다.
- `base_url`이 루프백(127.0.0.1/localhost/::1)이 아니면 `tc-run.json`에 `"api_remote_ok": true`가 있어야 실행한다. 이 값은 플래닝 단계에서 사용자가 승인한다.
- 세션별 쿠키는 `.cc-audits/<slug>/api-sessions/<name>.json`(0600)에 보관하고, 같은 세션 요청에 자동으로 붙인다.
- 출력은 상태 코드, 응답 헤더, 본문(64KB 제한)이다. `Set-Cookie`·`Authorization`·토큰류 헤더와 본문 속 토큰은 가린다.

**`read`**
- 읽을 수 있는 파일은 `tc-run.json`의 `"readable": { "<name>": "<프로젝트 상대 경로>" }`에 적힌 것뿐이다.
- 실제 경로가 프로젝트 루트 밖이거나 심볼릭 링크로 바깥을 가리키면 거부한다.
- JSON 파일은 `--json-path`로 값만, 줄 단위 로그는 `--grep`으로 해당 줄만 출력한다. 출력은 64KB로 제한한다.

**실행 방식**
- API TC는 화면 TC가 끝난 뒤 테스터 하나가 **순서대로** 실행한다. 공용 데이터에 서로 간섭하지 않게 하기 위해서다.
- `skip: api-only`는 기본값에서 빠진다.

**판정**
- API·DB·로그 기대 결과는 이 스크립트 출력값으로 코드 판정(`judged_by: code`)한다.
- 테스터가 읽을 수 없는 채널(`artifact`, `env`, `readable`에 없는 파일)은 지금처럼 NOT_OBSERVABLE로 둔다.

### 4. 플랜 흐름 (문제 2·3)

**플랜 모드에서**
- 플랜 본문의 `## Test Cases (draft)`에 TC 요약 표와 TC 초안(JSON 코드 블록)을 둔다.
- `tc-lint.js`와 `tc-jev-check.js`에 표준 입력(`-`) 지원을 추가한다. 그러면 파일을 쓰지 않고도 플랜 모드에서 검사할 수 있다. 결과는 표준 출력으로만 낸다.

**승인 직전**
- `open_questions`가 있으면 AskUserQuestion으로 묻는다. 기본안을 첫 선택지로 둔다.
- 답은 `sources`에 `kind: decision`으로 남기고, 해당 TC를 `ready`로 바꾼다.
- 답하지 않은 TC는 `needs-decision`으로 남는다. e2e는 `ready` TC만 실행하고, 나머지는 `skip: needs-decision`으로 보고한다.

**승인 직후 첫 작업**
- 초안 그대로 `docs/tc/<feature>.tc.json`과 `.cc-audits/<slug>/tc-run.json`을 쓴다. `tc-run.json`에는 `base_url`, `readable`, 계정, 픽스처를 넣는다.
- 검사를 파일 기준으로 한 번 더 돌린다.

### 5. 바로 고칠 것 (문제 1·5·6·8·11)

- **문제 1:** `tc-jev-check.js`가 채널이 `api`/`db`/`log`/`artifact`/`env`인 기대 결과에는 `jev_hidden` 경고를 내지 않는다. 점수는 그대로 기록한다.
- **문제 5:** `open_questions[]`를 `{ id: "OQ.<feature>.<name>", question, default, affects: [TC ids], answer?, decided_at? }`로 정의하고 `tc-lint.js`가 검사한다. `surface: api|cli` TC의 `done_when.expect`는 "응답/종료 결과가 돌아온다" 수준의 문장을 허용한다고 계약 문서에 적는다.
- **문제 6:** `expected[].basis`(선택)를 허용한다. 값이 `proposal`이면 TC가 `needs-decision`이어야 한다고 lint한다.
- **문제 8:** 관찰 파일 경로를 `<obs_dir>/<tc-id>/<run_id>/<index>.json`로 바꾼다. `run_id`는 UTC 타임스탬프이고, `record` 줄에도 `run_id`를 남긴다(선택 필드로 검증).
- **문제 11:**
  - 설치기가 root 리눅스(`process.getuid() === 0`, `linux`)에서 `playwright-test-*` args에 `--no-sandbox`를 넣는다.
  - doctor는 root 리눅스에서 이 값이 빠지면 경고한다.
  - 리눅스에서 Chrome 채널 브라우저가 없으면 설치 안내(`npx playwright install chrome`)를 출력한다.

---

## Phase A — 바로 고칠 것
1. Read ~/.claude/memory/phase_start.md and execute
2. `tc-jev-check.js` 채널별 `jev_hidden` 제외 (문제 1)
3. `tc-lint.js`: `open_questions` 형식, `expected[].basis` 규칙 (문제 5·6)
4. `tc-jev-judge.js record`: `run_id` 허용. e2e-tester의 관찰 파일 경로 변경 (문제 8)
5. 설치기·doctor: `--no-sandbox`, 브라우저 안내 (문제 11). `templates/mcp-servers.json` 자체는 바꾸지 않고, 설치할 때 덧붙인다.
6. 테스트 추가, `npm test`
7. Read ~/.claude/memory/phase_end.md and execute

## Phase B — 플랜 흐름
1. Read ~/.claude/memory/phase_start.md and execute
2. `tc-lint.js`·`tc-jev-check.js`에 표준 입력 지원 (`-`, 출력 파일 없이)
3. `templates/commands/plan.md`, `reference_tc_authoring.md`, `doc_structure_rules.md`: 초안 → 결정 질문 → 승인 직후 파일 작성 순서. `open_questions` 형식, API `done_when`, `expected[].basis` 반영
4. 테스트, `npm test`
5. Read ~/.claude/memory/phase_end.md and execute

## Phase C — `tc-api-run.js`
1. Read ~/.claude/memory/phase_start.md and execute
2. 스크립트 작성 (설계 §3). 공통 함수는 `jev-client.js`의 `parseArgs`·`checkOutputName`·`redact` 패턴을 따르되, Jev 의존이 없으므로 필요한 부분만 가져온다.
3. e2e-tester 지침: API TC 실행 절차, 허용 명령은 `tc-api-run.js`만, 순서대로 실행, 판정 규칙
4. e2e 매니저 가이드: `tc-run.json`의 `readable`·`api_remote_ok`, API TC 배정(화면 TC 뒤, 테스터 1명), `skip: api-only` 기본값 삭제
5. 설치 매니페스트에 스크립트 추가. 테스트(출처 거부, 리다이렉트 거부, 경로 탈출 거부, 쿠키 가림, 출력 제한), `npm test`
6. Read ~/.claude/memory/phase_end.md and execute

## Phase D — Jev 판정 주체화 + 문제집
1. Read ~/.claude/memory/phase_start.md and execute
2. `tc-jev-judge.js`:
   - `split`·`status` 필드
   - `calibrate`의 검증용 확인
   - `audit` 선정과 `audit` 명령
   - 자동 해제와 `revoked[]`
   - `label` 명령
   - `bank`(현황·`--export`)
3. 기존 `samples.jsonl` 호환: `split`이 없는 표본은 sha로 계산한다. 기존 Q.holds 항목은 남겨 두고, Phase F 표본으로 다시 계산해서 갱신한다.
4. e2e-tester 지침: `audit: true` 처리, 엇갈림 기록. 매니저 가이드: 기준 정책 문단 교체(적용은 승인, 해제는 자동), 실행 뒤 검토 대기 질문
5. 테스트(재검사 선정 재현성, 엇갈림 2/20 해제, 해제 뒤 REVIEW 복귀, 검증용 실패 시 `unsafe`, export 경로 거부), `npm test`
6. Read ~/.claude/memory/phase_end.md and execute

## Phase E — 설치·문서
1. Read ~/.claude/memory/phase_start.md and execute
2. README / 문서의 TC·Jev 절, CHANGELOG, doctor 항목(`tc-api-run.js` 설치 확인)
3. 이 플랜을 `docs/plans/tc-jev-loop.md`로 저장하고, 구현에서 달라진 점은 메모로 남긴다.
4. `node bin/cli.js --yes`로 이 서버에 설치하고, `--doctor`를 실행한다.
5. Read ~/.claude/memory/phase_end.md and execute

## Phase F — 실제 검증과 표본 수집 (샘플 앱, 레포 밖)
1. Read ~/.claude/memory/phase_start.md and execute
2. 샘플 앱(`/home/workspace/tc-sample-app`, 로컬 전용)을 넓힌다.
   - 화면 유형을 추가한다: 폼 검증 오류, 빈 목록, 긴 표 페이지 이동, 수량 변경 같은 일부 갱신.
   - 기능별 결함 스위치를 넣는다.
   - 결함 조합을 차례로 켜며 서버를 재시작하는 `matrix` 실행 스크립트를 만든다.
3. 기능마다 새 세션에서 `/plan`을 실행해, 바뀐 흐름(초안 → 결정 질문 → 승인 직후 파일)을 확인한다.
4. **e2e-tester 에이전트**로 실행한다. 에이전트 지침이 실제로 지켜지는지 확인하는 것이 목적이다. 화면 TC는 병렬로, API TC는 `tc-api-run.js`로 순서대로 실행한다.
5. 결함 조합 실행으로 표본을 늘린다. 목표는 질문별 기준용 30개 이상(FAIL 5개 이상)이고, 대상은 Q.holds, Q.error_visible, Q.success_notice다.
6. `calibrate` → 사용자 승인 → `--apply`. 이어서 재검사가 실제로 돌고 엇갈림이 기록되는지 확인한다. 자동 해제는 테스트용 Jev 디렉터리(`CC_BASELINE_JEV_DIR`)에서 일부러 엇갈리게 해 확인한다.
7. Read ~/.claude/memory/phase_end.md and execute

이후 Meta에 따라 security-auditor와 code-reviewer를 병렬로 호출하고, 결과를 반영한 뒤 사용자 확인을 받아 푸시한다.

---

## Test Cases (draft)

cc-baseline 자체의 TC(`surface: cli`)다. 승인 직후 `docs/tc/tc-jev-loop.tc.json`으로 쓴다. 이 플랜이 도입하는 흐름을 이 플랜에 먼저 적용하는 것이다. 표준 입력 검사(Phase B) 전이라 작성 검사는 파일을 쓴 뒤 실행한다.

| TC ID | 제목 | surface | readiness | 기대 결과 수 |
|---|---|---|---|---|
| TC.tc-jev-loop.api-run-same-origin | 허용 출처로 요청하면 응답이 나온다 | cli | ready | 2 |
| TC.tc-jev-loop.api-run-other-origin-rejected | 다른 출처 요청은 거부된다 | cli | ready | 2 |
| TC.tc-jev-loop.api-run-cookie-masked | 로그인 응답의 쿠키가 출력에서 가려진다 | cli | ready | 1 |
| TC.tc-jev-loop.read-outside-rejected | `readable` 밖 파일 읽기는 거부된다 | cli | ready | 2 |
| TC.tc-jev-loop.audit-disagree-revokes | 재검사 엇갈림 2/20이면 기준이 해제된다 | cli | ready | 2 |
| TC.tc-jev-loop.holdout-unsafe | 검증용에서 오판이 나면 기준이 `unsafe`다 | cli | ready | 1 |
| TC.tc-jev-loop.hidden-not-on-api | api 채널 문장에는 `jev_hidden`이 없다 | cli | ready | 1 |
| TC.tc-jev-loop.root-no-sandbox | root 리눅스 설치 뒤 args에 `--no-sandbox`가 있다 | cli | ready | 1 |

기대 결과는 모두 종료 코드·출력 JSON 필드·파일 내용으로 확인한다(`artifact` 채널, 코드 판정). 열린 질문은 없다. 단, `audit_rate` 0.1과 해제 조건 2/20은 이 플랜이 정한 값이다.

## E2E

cc-baseline에는 화면이 없다. 위 TC는 `npm test`의 단위 테스트로 대응해서 확인한다. 실제 e2e는 Phase F에서 샘플 앱으로 한다.

## 검증

- `npm test` 전부 통과. 기존 145개에 새 테스트 추가
- `node bin/cli.js --doctor` 이상 없음 (root 리눅스 `--no-sandbox` 포함)
- Phase F:
  - e2e-tester 에이전트로 화면·API TC가 모두 실행되고, 기대 결과마다 판정자가 하나씩 기록된다.
  - 세 질문의 기준 상태가 `bank`에 보인다.
  - 재검사 기록이 `audits.jsonl`에 쌓인다.
- 문제집 파일이 cc-baseline 작업 트리에 없다 (`git status` 확인)

## ✅ Checklist

- [ ] 문제 1·5·6·8·11 수정과 테스트
- [ ] `tc-lint`/`tc-jev-check` 표준 입력 지원, `/plan` 흐름 문서 갱신
- [ ] `tc-api-run.js`: 출처·리다이렉트·경로 탈출 거부, 쿠키·토큰 가림, 출력 제한, 테스트
- [ ] e2e-tester·매니저 지침: API TC 순서 실행, `skip: api-only` 기본값 삭제, 재검사 처리
- [ ] `tc-jev-judge.js`: 분할, 검증용 확인, 재검사, 자동 해제, `label`, `bank`/`--export`
- [ ] 기준 적용은 여전히 사용자 승인, 해제만 자동
- [ ] 문제집·화면 텍스트가 cc-baseline 레포에 들어가지 않음
- [ ] `npm test`, `--doctor` 통과, 이 서버에 재설치
- [x] Phase F: e2e-tester 에이전트 실행, 세 질문 표본 수집과 기준 적용 (Q.success_notice는 R7까지 부족)
- [ ] security-auditor + code-reviewer 통과 후 사용자 확인을 받고 푸시

---

## 구현 메모 (2026-11-16, 플랜과 달라진 점)

- **재검사 선정:** 요청 sha의 앞 2바이트는 분할(`calib`/`holdout`)에 쓰므로, 재검사는 그다음 2바이트(바이트 4~8)로 고른다. 그래서 두 선정이 서로 독립이다.
- **자동 해제 창:** "최근 20건"은 그 보정이 적용된 뒤(`calibrated_at` 이후)의 재검사만 센다. 다시 적용하자마자 예전 엇갈림 때문에 곧바로 해제되는 일을 막는다.
- **검증용 최소 수량:** 검증용 분할에 PASS 2개, FAIL 2개 이상이 있어야 `ok`가 될 수 있다. 플랜에 숫자가 없던 부분이다.
- **기존 Q.holds 보정:** 새 규칙으로 계산하면 기준용 18개로 부족하다. 플랜대로 항목은 남겨 두고, Phase F 표본으로 다시 계산한다.
- **`tc-api-run.js` 프로젝트 루트:** `<root>/.cc-audits/<slug>/tc-run.json` 위치에서 루트를 계산한다. ~~다른 위치면 실행 설정에 절대 경로 `project_dir`가 있어야 한다.~~ 보안 감사(SEC-003) 뒤로는 이 위치의 실행 설정만 받는다.
- **`bank --export` 무시 여부 확인:** `git check-ignore`에 끝 `/`를 붙인 경로로 묻는다. 아직 없는 폴더도 `dir/` 형식의 무시 패턴에 걸리게 하기 위해서다.
- **`e2e-tester.md`:** API 실행 절차와 재검사 절차를 Phase A에서 미리 넣었다. 코드는 Phase C·D에서 들어왔다.

---

## Phase F 결과 (2026-11-17)

샘플 앱에서 결함 조합을 바꿔 가며 R1~R8을 돌렸다. R1은 e2e-tester 에이전트 5명, R2부터는 메인 세션이 Playwright 스크립트로 같은 절차(단계 → 코드 판정 → 관찰 파일 → 표본 → `record`)를 돌렸다.

| 항목 | 결과 |
|---|---|
| 새 지침 준수 (R1) | 0부터 세는 번호, `obs/<tc>/<run_id>/`와 `channel`, 화면 결과만 표본, `skipped (mutating)`, TC가 기대한 4xx 허용, curl·소스 읽기 없음 — 모두 지켜졌다 |
| 결함 검출 (R1~R8) | 심은 결함은 하나를 빼고 모두 잡았다. 놓친 하나(주문 후 재고 감소)는 잡을 화면 TC가 없다. 결함 없는 TC를 FAIL로 판정한 일은 없다 |
| 보정 | Q.holds(이전 적용, 다시 계산해도 `ok`), Q.error_visible(기준용 30 · 검증용 19, 오판 0, 사용자 승인 후 적용), Q.success_notice(R8 표본까지 기준용 30 · 검증용 10, 오판 0, 2026-11-18 승인 후 적용). 세 질문 모두 표본 출처가 이 샘플 앱 하나 |
| 적용 뒤 라운드 (R8, `--judge-mode jev`) | 화면 결과 46개 중 Jev가 35개를 결정(Q.holds 27, Q.error_visible 8)했고 코드 판정과 35개 모두 일치. 나머지 11개(기준 없는 Q.success_notice 6, 중간 점수 5)는 LLM이 판정했고 모두 코드와 일치 |
| 재검사 | Jev 결정 35개 중 5개(14%)가 `audit: true`, `audits.jsonl`에 5줄, 엇갈림 0 → 검토 대기 없음 |
| 자동 해제 | 실제 문제집 사본에서 재검사 2건을 일부러 엇갈리게 하자 Q.holds가 `revoked`로 옮겨졌다 |

### V11 — 판정 방식 비교 (R8, 결함 9개 조합)

| 방식 | 판정 주체 (화면 46개) | 코드 정답과 일치 | 잘못된 PASS / FAIL |
|---|---|---|---|
| ⓐ 코드 → Jev → LLM (기본) | 코드 46 | — | — |
| ⓑ Jev 먼저 (`--judge-mode jev`) | Jev 35 · LLM 11 | 46 / 46 | 0 / 0 |
| ⓒ LLM만 | 실행하지 않음 → R10에서 실행 (아래) | — | — |

**R10 (결함 8개 조합, 세 질문 모두 보정 적용 뒤, 같은 화면을 두 번):**

| 방식 | 판정 주체 (화면 46개) | 코드 정답과 일치 | 잘못된 PASS / FAIL | Jev 비용 |
|---|---|---|---|---|
| ⓑ Jev 먼저 | Jev 41 · LLM 5 | 46 / 46 | 0 / 0 | 호출 46회, 약 11.8초, 약 7.1만 토큰 (호출당 약 0.26초 · 1.5천 토큰) |
| ⓒ LLM만 | LLM 46 | 46 / 46 | 0 / 0 | LLM 쪽 토큰·시간은 이 도구로 재지 못함 |

- 이 샘플 앱에서는 세 방식의 정확도가 같다. 차이는 비용과 사람 개입이다: Jev 우선이면 LLM이 볼 결과가 46개에서 5개(+재검사 몇 개)로 준다.
- Jev가 망설인(중간 점수) 5개는 모두 주소(URL)나 "버튼이 없다"·"행이 1개다"처럼 화면 텍스트로 드러나지 않는 사실이었다. 이런 기대 결과는 코드 키로 두는 편이 맞다.
- 한계: 표본과 비교가 모두 샘플 앱 하나에서 나왔고, 라운드마다 화면 문구가 거의 같다. ⓒ와 토큰·시간 비교는 하지 않았다.

### 발견해 고친 것

- 지침: TC 하나가 실패해도 나머지 TC는 계속(H1), 실패 로그는 `tc-api-run.js`로만 읽고 판정에 쓰지 않음(H2·H5), 매니저가 준 `*_command` 단계(H3), `api.login_path`(H4), 결함이 있어도 확인되는 `done_when`(H6), 관찰 범위는 기대 결과가 가리키는 영역 + 대상이 있으면 `item` 필수(H9).
- 코드: `tc-api-run.js read`의 `--grep` 반복(모두 포함, H7), `tc-jev-judge.js`의 `--judge-mode jev`·`record`의 `judge_mode`/`code_verdict`·`compare`(H8, V11).
- order-cancel의 API 전용 TC 9개: 실행 설정(세션 · `login_path` · 주문)을 채워 R0·R10에서 모두 실행했다. 처음엔 이 TC들의 주문이 고객의 주문 목록을 2쪽으로 밀어 화면 TC가 대상 주문을 찾지 못했다 — 시드에서 API용 주문을 먼저 만들어 해결. 정정: 이 TC들로도 "주문 후 재고 감소" 결함은 잡히지 않는다(`restores-stock`은 취소 전후만 비교한다).
- 같은 화면은 같은 표본 ID가 되므로 이전 라운드에서 재검사한 화면이 다시 나온다. `audit`은 이때 이전 재검사를 돌려주고 다시 세지 않는다.
- R2 첫 실행은 관찰 범위가 좁아(배너 누락, `item` 없음) Jev와 코드 라벨이 엇갈리는 표본을 만들었다. 그 46개를 문제집에서 지우고 다시 돌렸다. H9가 이 문제를 지침에서 막는다.

---

## Audit History
- iter-1: 2026-11-17 / critical=0 high=0 medium=5 low=2 / next_action=user_interview → 사용자 결정(SEC-003 위치 고정, SEC-004 형식 제한, SEC-005 코드+지침, SEC-006 문서) 반영, auto 항목(SEC-001·002·007) 수정 → done
- iter-2: 2026-11-18 / critical=0 high=0 medium=0 low=0 / next_action=done (범위 cfecb8b..167f7fe)

## Code Review History
- code-review-iter-1: 2026-11-17 / critical=0 high=0 medium=1 low=4 / profile_status=cached / next_action=done → QA-001·002·003 수정, QA-004(jev 모드 표본도 보정에 포함, 문서 명시)·QA-005(테스트 추가) 사용자 결정대로 반영
- code-review-iter-2: 2026-11-18 / critical=0 high=0 medium=1 low=2 / profile_status=cached / next_action=done → QA-006(macOS `??` tty)·QA-008(화면 채널만 검사) 수정, QA-007(재검사 재호출의 `revoked: false`)은 의도대로 유지
