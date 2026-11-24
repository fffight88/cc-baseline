# 사실 검증 Phase D 결함 수정 — 증거 재실행 기본, 사람 표본은 선택, 카나리아 개선

Phase D에서 나온 결함 D1~D8을 고친다. 그리고 사용자 의견("대량 검증마다 사람 표본은 부담이 크다")에 따라 대량 검증의 기본을 바꾼다.
- **기본:** `claims.js`가 검증기가 적은 증거(파일 줄, 로그 줄, SQL 결과)를 직접 다시 읽어 확인한다(증거 재실행). 카나리아는 같은 모양의 값끼리만 바꿔서 더 그럴듯하게 만든다.
- **사람 표본:** 정해진 조건(비싼 결정, 해석형 주장이 많음, 프로젝트 첫 대량 검증, 사용자 요청)일 때만 묻는다. 물을 때는 재실행한 원본을 붙인 확인표를 자동으로 만든다.

## ⚡ Key Rules Summary

| ✅ DO | ❌ DON'T |
|---|---|
| `fact-auditor`는 파일·로그·SQL로 정한 판정마다 `recheck`(어디서 무엇을 다시 읽을지)를 적는다 | 재실행할 수 없는 문장만 증거로 남기기 |
| `claims.js recheck`는 에이전트가 쓴 스크립트를 실행하지 않고, 지정된 파일·로그를 직접 읽고 SQL은 오케스트레이터가 적은 `db.connect`로 읽기 전용으로만 보낸다 | 검증기 스크립트를 에이전트 밖에서 다시 실행하기 |
| 재실행에서 증거가 안 나오면 그 주장은 `not_reproduced`로 보고하고 fact-auditor에게 돌려보낸다 | 재실행 결과를 보고서에서 빼기 |
| 사람 표본은 조건에 맞을 때만 묻고, 안 물었으면 보고서에 "요청 안 함"으로 적는다 | 대량 검증마다 사람에게 30개를 확인시키기, 또는 상한 없이 "검증됨"으로 쓰기 |
| 카나리아의 값 바꾸기는 같은 모양(숫자↔숫자, 버전↔버전, 식별자↔식별자 …)끼리만, HTTP 상태는 실제 상태 코드로, 날짜는 과거 쪽으로 바꾼다 | "password 0.3.0", "HTTP 411"처럼 증거 없이도 틀린 게 보이는 카나리아 |
| 코드 읽기는 C, 설정·시스템 기록은 B, 로그·DB·재실행은 A로 적는다(에이전트 지침에 표로) | 직접 읽었다는 이유로 소스 읽기를 A로 적기 |

## Meta
- Security Impact: Yes
- Code Quality Impact: Yes
- UI Impact: No
- Behavior Impact: Yes
- Claim Impact: No
- Reason: `claims.js recheck`가 새로 파일을 읽고 DB 명령(`db.connect`)을 실행한다(경로 제한·읽기 전용·비밀 마스킹 필요). 카나리아 생성, 보고서 상태, 사람 표본 규칙(세션 규칙 12)이 바뀐다.

---

## Context

- **요청(2026-11-24):** Phase D 결함 D1~D8을 고치고, 대량 검증의 사람 표본을 매번 하지 않도록 바꾼다. 사용자는 Phase D 사람 표본 30개에 모두 동의했다(상한 9.5%, 기록 완료).
- **근거:** 사람 표본 30개는 검증기가 10% 넘게 틀리는 큰 고장을 잡는 경보에 가깝다(실제 오답률 1%면 발견 확률 26%, 10%면 96%). 큰 고장은 증거 재실행과 그럴듯한 카나리아로도 잡힌다. 사람만 잡는 것은 "검증기와 생산자가 같은 식으로 잘못 해석하는 경우"이고, 이것은 해석형 주장에서 주로 생긴다.
- **오늘 손으로 한 것과의 차이:** 확인표를 만들 때는 제가(본체) 직접 쿼리를 다시 짰다. 그러나 보통은 본체가 곧 생산자라서, 본체가 다시 확인하면 규칙 12("자기 결과를 자기 도구로 검증하지 않는다")에 어긋난다. 그래서 재실행은 **판단을 하지 않는 스크립트(`claims.js`)가 검증기가 가리킨 원본을 그대로 다시 읽는 방식**으로 한다. 이것은 검증기가 증거를 지어내거나 잘못 옮기지 않았는지를 확인한다. 증거를 어떻게 해석했는지는 확인하지 않고, 그것은 사람 표본의 몫으로 남긴다.
- **Phase D에서 본 사실:** 검증기가 적은 줄 번호가 실제와 1줄 다른 경우가 있었다(`actions.py:33` 대 실제 32줄). 그래서 파일 재실행은 ±3줄을 허용하고, 찾은 실제 줄을 기록한다.
- **재사용할 것:**
  - `tc-jev-judge.js`의 `maskSecrets`: 재실행 출력의 비밀을 가린다.
  - `tc-api-run.js`의 `DENIED_READ_RE`: 비밀처럼 보이는 파일(`.env*`, `*.pem`, `id_*`, `.git/`, `.ssh/` …)을 거부한다. 지금은 내보내지 않으므로 `module.exports`에 추가한다.
  - `tc-replay.js`의 `COMMAND_ENV_DROP`: 명령 실행 전에 `BASH_ENV`, `PYTHONPATH`, `NODE_OPTIONS`, `LD_PRELOAD` 등을 뺀다. 지금은 내보내지 않으므로 export한다.
  - `claims.js`의 `replaceWhole` 경계 규칙: `contains`를 다른 숫자나 단어의 일부로 잘못 맞추지 않게 한다("4"가 "14"에 맞지 않게).
  - `WRITE_SQL_RE`, `checkFreeze`, `latestVerdicts`, `readKey`, `upperBound95`.
- **이 세션의 한계:** 에이전트 정의는 세션을 시작할 때 읽힌다. 바뀐 `fact-auditor`는 설치한 뒤 새 세션에서만 진짜로 시험할 수 있다(Phase D2).

### 범위 밖
- **D4(카나리아가 원래 주장 옆에 놓임):** 한계로 문서에만 적는다.
- **tc-lint의 `standard_question` 경고:** `screen-tc` 출력의 열 이름 "Error"에 반응하는 경고는 tc-lint 공통 규칙이라 손대지 않는다. 알려진 경고로 지침에 적는다.
- **화면·웹·api 채널의 재실행:** 화면은 `tc-replay`, 웹은 원문이 바뀌는 문제가 있어 이번에는 "재실행 불가"로 센다.
- **위험 가중 표본(⑨) 등:** 이전 플랜의 범위 밖 항목은 그대로 둔다.

---

## 설계

### 1. 증거 재실행 — `claims.js recheck <run>`
- **verdict 줄의 새 필드 `recheck`**(선택. 파일·로그·SQL로 정한 판정이면 fact-auditor가 반드시 적는다). 아래 셋 중 하나에 `contains`를 붙인다.
  - `{ "file": "<code.root 기준 경로 또는 doc.paths 중 하나>", "line": 20, "contains": "algorithm=\"HS256\"" }`
  - `{ "log": "<log.paths 중 하나>", "contains": "GET /graphql HTTP/1.1\" 200" }`
  - `{ "sql": "SELECT count(*) FROM link_types", "contains": "27" }`
  - `contains`는 판정을 가르는 원문 그대로의 문자열이다(최대 300자, 비밀 금지).
  - `score`의 `checkVerdict`가 모양을 검사한다(셋 중 정확히 하나, `contains` 필수, `line`은 양의 정수). 틀리면 `score`가 exit 1로 돌려보낸다.
- **동작:** 모든 입력 항목(카나리아 포함)의 최신 verdict에서 `recheck`를 읽어 다시 확인한다. 결과는 `recheck.json`에 쓴다.
  - **file:** 실제 경로가 `code.root` 안이거나 `doc.paths` 중 하나여야 한다. `forbidden_paths`, 키 루트, `DENIED_READ_RE`에 걸리면 거부한다. 2MB가 넘으면 거부한다. `line`이 있으면 ±3줄 안에서, 없으면 파일 전체에서 `contains`를 찾는다.
  - **log:** 실제 경로가 `log.paths` 중 하나와 같아야 한다. `contains`가 있는 줄 수와 첫 줄을 기록한다.
  - **sql:**
    - `claims-run.json`의 `db.connect`(문자열 배열, 셸 없이 실행)와 `db.readonly: true`가 있어야 한다.
    - SQL은 주석과 공백을 뺀 뒤 `SELECT`나 `WITH`로 시작해야 하고, 끝이 아닌 곳에 `;`가 없어야 하며, `WRITE_SQL_RE`에 걸리지 않아야 한다.
    - `db.kind: postgres`이면 표준 입력으로 `BEGIN READ ONLY;\n<sql>;\nROLLBACK;`을 보낸다. 다른 종류는 SQL만 보내고, 읽기 전용 접속은 `connect`가 책임진다고 지침에 적는다.
    - 30초 제한, 출력 1MB 제한, 환경 변수는 `COMMAND_ENV_DROP`을 뺀 것을 쓴다.
  - **비교:** 공백을 하나로 접은 뒤, 경계가 있는 일치로 찾는다(`replaceWhole`과 같은 앞뒤 규칙).
  - **상태:**
    - `reproduced`: 찾았다
    - `differs`: 읽었지만 `contains`가 없다
    - `refused`: 경로나 SQL이 규칙에 어긋난다
    - `not_rerunnable`: `recheck`가 없거나, 화면·웹·api 채널이거나, D 등급이거나, UNVERIFIABLE이다
  - 기록하는 `found`(찾은 줄이나 출력 일부, 200자)에는 `maskSecrets`를 적용한다.
  - 한 번에 같은 SQL은 한 번만 실행한다.
- **보고서(`report`):**
  - `recheck.json`이 있으면 "Evidence re-run: reproduced X · differ Y · refused Z · not re-runnable W (of N claims)"를 적는다. 진짜 주장과 전제만 세고, 카나리아는 키로 걸러 숨긴다.
  - SUPPORTED·REFUTED 판정인데 재실행 상태가 `differs`나 `refused`인 주장은 상태를 `not_reproduced`("evidence did not reproduce")로 바꾸고 counts에 넣는다.
  - `recheck.json`이 없으면 "Evidence re-run: not run"이라고 적는다.
- **흐름:** `score` → `recheck` → (조건이 맞으면) `sample` → `human` → `report`. light와 bulk 모두에서 쓸 수 있다.

### 2. 사람 표본은 선택
- **물을 조건(하나라도 맞으면 묻는다):**
  - 결과로 비싸거나 되돌리기 어려운 결정을 한다(돈, 법, 운영 데이터, 공개 출시).
  - 해석형 판정이 많다. D 등급이거나 `impact: decision`인 주장이 전체의 20% 이상이다.
  - 그 프로젝트의 첫 대량 검증이다.
  - 사용자가 요청한다.
- **조건이 맞지 않으면** 묻지 않는다. 보고서에는 "Human check: not requested — no error bound on the verifier's interpretation; evidence re-run and canaries only"라고 적는다.
  - 지금은 `human.json`이 없으면 "not done"이라고만 나온다. 이 문구를 바꾸고, `report.json`에 `human.status: "not_requested"`를 넣는다.
  - 사용자가 표본을 건너뛰면 지금처럼 `answered: 0`이 되고, 문구는 "skipped by the user"가 된다.
- **확인표 자동 생성:** `sample`이 `sample.md`를 함께 쓴다.
  - 항목마다 주장, 판정·등급, 검증기 발췌, 재실행 결과(상태와 `found`), 확인 위치를 적는다.
  - 맨 위에는 "원본이 주장과 맞으면 agree"라는 판단 기준과 답 형식 `{ "<A-id>": "agree" }`를 적는다.
  - 오케스트레이터는 이 파일을 그대로 보여 주거나 페이지로 만들어 보여 준다.

### 3. 카나리아 개선 (D3) — `prepare`
- **값 바꾸기(`mutateSwap`):** 원래 값과 다른 주장의 값이 같은 모양일 때만 바꾼다. 모양 `shape(v)`는 다음 중 하나다.
  - 정수, 소수
  - 버전(`v?\d+(\.\d+){1,3}`)
  - URL
  - 날짜(`YYYY-MM-DD`)
  - 대문자 상수(`[A-Z0-9_]+`)
  - 소문자 식별자(`[a-z0-9_]+`)
  - 공백 없는 기타 단어
  - 공백 있는 문장
  - 배열은 바꾸지 않는다(지금도 그렇다).
- **HTTP 상태(`mutateNumber`):**
  - 조건: 정수가 100~599이고, 주장 문장에 `HTTP`, `status`, `answered with`, `respond(s) with`, `return(s)` 중 하나가 있다.
  - 동작: 바꿀 값을 실제 상태 코드 목록(200, 201, 204, 301, 302, 304, 400, 401, 403, 404, 405, 409, 422, 429, 500, 502, 503)에서 원래 값과 다른 것으로 고른다.
- **날짜:** 값이 `YYYY-MM-DD`이면 일(日)을 1~3일 바꾼다. 일이 4 이상이면 앞당기고, 아니면 뒤로 미룬다. 연도 숫자만 바꿔 먼 미래 날짜가 되는 일은 없앤다.
- **연도로 보이는 정수:** 1900~2100의 정수는 n−1이나 n−2로만 바꾼다.
- **그 밖의 숫자 바꾸기**(n±1, n+2, n×2, n+10)는 그대로 둔다.

### 4. `fact-auditor.md` (D1, D2, D5, D8, 재실행)
- **채널별 등급 표**를 직접 넣는다(D1).
  - 코드 읽기는 C다. 직접 읽어도 C다.
  - 설정 파일과 시스템 기록(배포 기록)은 B다.
  - 로그 줄, DB 값, 다시 실행한 명령은 A다.
  - 웹 1차 자료는 B, 2차 자료는 C다.
  - 모델 판단은 D다.
- **1단계:** `db.connect`가 있으면 그 명령으로 DB에 닿는다. SQL은 표준 입력으로 보내고, 읽기 전용 트랜잭션 안에서만 실행한다. `dsn_env`는 셸에 없을 수 있다는 점도 적는다(D5).
- **검증기 출력 규칙:** 항목마다 `== <A-id>` 머리줄을 하나씩 찍는다. 여러 항목을 한 머리줄로 묶지 않는다.
- **8단계:** 파일·로그·SQL로 정한 판정에는 `recheck`를 적는다. 비밀이 있는 줄이면 비밀이 아닌 부분을 `contains`로 고른다. 다시 쓸 때는 줄을 덧붙이고, id마다 마지막 줄이 유효하다(D8).
- **반환 형식에 두 줄을 추가한다(D2).**
  - `- jev samples: N`: 7단계에서 저장한 수. 0이면 이유를 적는다.
  - `- recheck recipes: N of M`: 파일·로그·SQL로 정한 판정 중 `recheck`를 적은 수.

### 5. `claims-run.json`과 화면 단계 (D5, D6)
- **`db.connect`를 공식 필드로 만든다.** 문자열 배열이고, 예시는 `["docker","exec","-i","ontology-postgres","psql","-U","ontology","-d","ontology_e2e","-At"]`다.
  - `lint`가 `claims-run.json`이 있을 때 다음을 검사한다(형식 오류는 exit 1).
    - `db`가 있으면 `readonly: true`여야 한다.
    - `dsn_env`나 `connect` 중 하나는 있어야 한다.
    - `connect`는 빈 칸 없는 문자열 배열이어야 한다.
  - 이 명령은 오케스트레이터가 쓰고, 사용자가 플랜이나 대화에서 본 것이어야 한다고 지침에 적는다.
- **`screen` 필드:** `{ "base_url", "reset_command"?, "fixtures"?, "targets": { "<target.ref>": { "start_path", "persona", "fixture"?, "notes"? } } }`.
  - `screen-tc`는 이 필드로 `<project>/.cc-audits/<run slug>/tc-run.json` 초안을 쓴다. 초안에는 `base_url`, `reset_command`, `fixtures`, TC마다 `start_path`·`persona`·`fixture`·`data: {}`·`secret_env: []`·`notes`가 들어간다.
  - 파일이 이미 있으면 덮어쓰지 않고 `kept`로 알린다.
  - `targets`에 없는 화면은 `missing_targets`로 출력한다. e2e에서는 `unmapped`가 된다.
  - 이렇게 하면 실행 폴더와 `tc-run.json` 폴더가 따로 노는 문제(D9)도 정해진 경로로 정리된다.

### 6. lint 경고 (D7)
- 한 문장에 사실이 여러 개라는 경고는 `expected`가 배열이면(목록 하나가 사실 하나) 내지 않는다.
- 경고 문구는 "may state more than one fact — split it, or keep it if it is one fact"로 바꾼다.

### 7. 규칙·문서
- **`all_session_basic_rules.md` 규칙 12의 대량 검증 문장:**
  - "adds a human sample of the verifier's verdicts and an error bound" → "adds an evidence re-run of every claim; a human sample and an error bound only when the stakes or the share of judgment calls call for it (`reference_claim_verification.md` §1)"
  - "quote the bulk error bound" → "quote the error bound when a human sample was taken, and the re-run result"
- **`reference_claim_verification.md`:**
  - 요약표, §1 표(bulk의 Human 칸 → "only on the §1 conditions"), 사람 표본 조건 절
  - §2 파일 표(`recheck.json`, `sample.md`, verdict의 `recheck`, `db.connect`, `screen.targets`)
  - §3 등급 표에 "코드는 직접 읽어도 C"
  - §4 흐름(recheck 단계 추가, 6단계는 조건부)
  - §5 카나리아 모양 규칙
  - §8 한계: D4 카나리아 위치, 재실행은 증거가 실제로 있는지만 보고 해석은 보지 않음, tc-lint "Error" 경고
  - 체크리스트
- **`commands/verify-claims.md`:** recheck 단계를 넣고, 8단계는 조건부로 바꾸고, `sample.md`를 보여 주게 하고, 최종 답에 재실행 결과를 넣는다.
- **`templates/memory/MEMORY.md`:** 지침 한 줄 설명의 "human audit of the auditor"를 "evidence re-run, optional human audit"로 바꾼다.
- **README / README_KO / install-details:** 사람 표본이나 `claims.js` 명령 목록을 말하는 곳이 있으면 맞춘다(grep으로 확인).
- **`CHANGELOG.md` [Unreleased]**에 항목을 추가한다.

---

## Phase A — `claims.js`와 테스트

1. Read ~/.claude/memory/phase_start.md and execute
2. 승인 직후:
   - 아래 TC 초안을 기존 `docs/tc/claims.tc.json`에 합친다(같은 기능이라 파일 하나).
   - 플랜을 `docs/plans/claim-verification-d-fixes.md`로 쓴다.
   - 두 검사를 파일에 다시 돌린다(`--json` / `--out .cc-audits/claim-verification-d-fixes/tc-check.json`).
3. `git log -3`으로 고칠 파일의 최근 변경을 확인한다(규칙 8): `claims.js`, `tc-api-run.js`, `tc-replay.js`, `fact-auditor.md`, `all_session_basic_rules.md`.
4. `claims.js`를 고친다: `recheck` 명령, `checkVerdict`, `report`, `sample.md`, `prepare`(모양, HTTP, 날짜, 연도), `lint`(`claims-run.json` 검사, 배열 경고), `screen-tc`(`tc-run.json` 초안). `tc-api-run.js`는 `DENIED_READ_RE`를, `tc-replay.js`는 `COMMAND_ENV_DROP`을 내보낸다.
5. `test/run.js`에 아래 TC마다 대응하는 테스트를 넣는다. SQL 재실행은 표준 입력을 기록하고 정해진 출력을 내는 가짜 `connect`(`node <tmp>/fake-db.js`)로 시험한다.
6. `npm test`, `node test/wiki.test.js`
7. **Phase D 실행 폴더로 건식 확인:** `ontology-demo/.cc-audits/claims/phase-d-bulk`의 장부 세 개를 새 폴더 `phase-d2-dry`에 복사한다. `prepare --seed 1`을 돌리고, 키 파일로 카나리아 목록을 뽑아 다른 모양끼리 바꾼 것이 없는지와 HTTP 값을 확인한다. 이 폴더는 확인 뒤 지운다. 카나리아 내용은 Phase D2 실행 폴더에 남기지 않는다.
8. Read ~/.claude/memory/phase_end.md and execute

## Phase B — 에이전트·규칙·문서

1. Read ~/.claude/memory/phase_start.md and execute
2. `fact-auditor.md`, `reference_claim_verification.md`, `verify-claims.md`, `all_session_basic_rules.md`(규칙 12), `MEMORY.md` 템플릿을 고친다.
3. README·install-details·CHANGELOG를 맞춘다.
4. `npm test`, `node bin/cli.js --doctor`
5. Read ~/.claude/memory/phase_end.md and execute

## Phase C — 게이트·설치·푸시

1. Read ~/.claude/memory/phase_start.md and execute
2. security-auditor와 code-reviewer를 병렬로 돌리고, 지적 사항을 반영한다. design·business 항목이 있으면 규칙 9 알림 뒤 인터뷰한다.
3. 커밋하고(`.claude/` 제외 규칙 6) develop에 푸시한 뒤 `node bin/cli.js --yes`로 이 서버에 설치한다.
4. `docs/plans/claim-verification.md` 끝에 이 플랜 링크를 남기고, `HANDOFF-next.md`와 프로젝트 메모리를 갱신한다.
5. Phase D2 세션을 연다(`create_session`, 이 서버 환경). 지시는 아래 "Phase D2"에 적는다.
6. Read ~/.claude/memory/phase_end.md and execute

## Phase D2 — 새 세션에서 실제 시험 (바뀐 에이전트 정의가 읽혀야 함)

1. Read ~/.claude/memory/phase_start.md and execute
2. ontology-demo bulk를 새 실행 `phase-d2-bulk`로 돌린다.
   - 장부는 Phase D 것을 복사하고, `claims-run.json`에는 `db.connect`와 `screen.targets`를 공식 필드로 쓴다.
   - 제품 코드와 DB는 바꾸지 않는다.
3. 확인할 것:
   - fact-auditor가 코드 읽기를 C로 적는가(D1)
   - 반환에 `jev samples`와 `recheck recipes` 줄이 있고, 파일·로그·SQL 판정에 `recheck`가 있는가(D2, 재실행)
   - `claims.js recheck`가 code·db·log 주장을 `reproduced`로 다시 확인하는가
   - 카나리아가 같은 모양이고 HTTP 값이 실제 코드인가. 그래도 모두 잡히는가(D3)
   - `screen-tc`가 쓴 `tc-run.json` 초안으로 e2e-tester가 화면 TC를 돌리는가(D6)
   - 사람 표본 조건: 이 실행은 "그 프로젝트의 첫 대량 검증"이 아니므로(Phase D가 첫 번째) 묻지 않고, 보고서에 "not requested"가 나오는가
4. 비용(토큰, 시간)을 Phase D와 비교해 기록한다.
5. 서버 정리: Phase D 세션이 켜 둔 uvicorn(:8000)과 Vite(:5173)를 끝나면 끈다. `/clean`을 돌리고, 포트가 비었는지 확인한다.
6. Read ~/.claude/memory/phase_end.md and execute

---

## Test Cases (draft)

cc-baseline 자체의 TC(`surface: cli`)다. 기존 `docs/tc/claims.tc.json`(17 TC)에 아래를 합친다. 기대 결과는 모두 종료 코드, 출력, 파일 내용으로 확인한다(`artifact` 채널, 코드 판정).

| TC ID | 제목 | surface | readiness | 기대 결과 수 |
|---|---|---|---|---|
| TC.claims.canary-same-shape | 값 바꾸기 카나리아는 같은 모양의 값만 쓴다 | cli | ready | 1 |
| TC.claims.canary-http-status | HTTP 상태 카나리아는 실제 상태 코드를 쓴다 | cli | ready | 1 |
| TC.claims.canary-date-past | 날짜 카나리아는 일만 며칠 바꾼다 | cli | ready | 3 |
| TC.claims.recheck-file-reproduced | 줄 번호가 하나 틀린 파일 재실행도 재현된다 | cli | ready | 2 |
| TC.claims.recheck-differs | 증거가 다시 안 나온 주장은 not_reproduced로 보고된다 | cli | ready | 2 |
| TC.claims.recheck-path-refused | 허용 경로 밖의 재실행은 거부된다 | cli | ready | 1 |
| TC.claims.recheck-sql-readonly | SQL 재실행은 읽기 전용으로 보내고 쓰기 SQL은 거부한다 | cli | ready | 3 |
| TC.claims.report-human-not-requested | 사람 표본이 없는 bulk 보고서는 "요청 안 함"이라고 적는다 | cli | ready | 2 |
| TC.claims.sample-sheet | 사람 표본에는 재실행 결과가 붙은 확인표가 함께 나온다 | cli | ready | 2 |
| TC.claims.score-bad-recheck | 모양이 틀린 재실행 레시피는 돌려보낸다 | cli | ready | 2 |
| TC.claims.screen-tc-run-draft | `claims-run.json`의 화면 대상이 `tc-run.json` 초안이 된다 | cli | ready | 2 |
| TC.claims.screen-tc-run-kept | 이미 있는 `tc-run.json`은 덮어쓰지 않는다 | cli | ready | 1 |
| TC.claims.lint-list-claim | 목록 하나에 대한 주장은 나누라는 경고를 받지 않는다 | cli | ready | 1 |
| TC.claims.lint-db-access | 접속 방법이 없는 db 명세는 lint에서 실패한다 | cli | ready | 2 |

검사 요약(기존 17개와 합친 31 TC를 표준 입력으로 검사):
- `tc-lint`: 31 TC, 경고 0건. 처음에 1건(`single_fact`, canary-date-past의 "연도와 월")이 있었고, 두 줄로 나눠 고쳤다.
- `tc-jev-check`(jev-1.14.0, 새 14 TC): `jev_screen` 경고 4건(recheck-file-reproduced[1], report-human-not-requested[0], screen-tc-run-draft[0][1]). 그대로 둔다. 모두 `artifact` 채널이라 코드가 파일로 판정하고, 화면으로 판정하지 않는다.

열린 질문은 없다. 방향(재실행 기본, 사람 표본 선택, D1~D8 수정 범위)은 2026-11-24 사용자 결정이다.

합칠 내용(`sources`, `actions`, `test_cases`에 덧붙인다. 파일의 `open_questions`는 비어 있는 그대로다):

```json
{
 "sources": [{"id": "REQ.claims-d-fixes", "kind": "requirement", "locator": "docs/plans/claim-verification-d-fixes.md (Phase D defects D1-D8)"},
  {"id": "DEC.claims-human-optional", "kind": "decision", "locator": "user decision 2026-11-24: a human sample on every bulk run is too much work; default to evidence re-run and better canaries, ask for a human sample only when needed"}],
 "actions": [{"id": "ACT.claims.recheck", "title": "Re-read the evidence the verifier named", "actor": "orchestrator", "trigger": "runs claims.js recheck <run dir>", "preconditions": ["verdicts.jsonl has verdict lines with a recheck recipe"], "outputs": ["recheck.json with a status per item"], "evidence_refs": ["DEC.claims-human-optional"]}],
 "test_cases": [
  {"id": "TC.claims.canary-same-shape", "title": "A value-swap canary only takes a value of the same shape", "action_refs": ["ACT.claims.prepare"], "level": "functional", "surface": "cli", "preconditions": ["the run has 40 code claims whose expected values are numbers, versions, identifiers and quoted phrases"], "steps": [{"goal": "Run claims.js prepare with --seed 3", "done_when": {"expect": "The command exits"}}], "expected": [{"text": "Every swap canary in the key file has an expected value of the same shape as its source claim", "observe": {"channel": "artifact", "key": "key.json items with op swap vs claims.jsonl"}}], "basis": {"kind": "requirement", "refs": ["REQ.claims-d-fixes"]}, "readiness": "ready"},
  {"id": "TC.claims.canary-http-status", "title": "An HTTP status canary uses a real status code", "action_refs": ["ACT.claims.prepare"], "level": "functional", "surface": "cli", "preconditions": ["the run has 30 log claims of the form 'GET /x answered with 200'"], "steps": [{"goal": "Run claims.js prepare with --seed 3", "done_when": {"expect": "The command exits"}}], "expected": [{"text": "Every number canary in the key file has a status code from the real status list", "observe": {"channel": "artifact", "key": "audit-input.jsonl expected of canary ids"}}], "basis": {"kind": "requirement", "refs": ["REQ.claims-d-fixes"]}, "readiness": "ready"},
  {"id": "TC.claims.canary-date-past", "title": "A date canary moves the day by a few days", "action_refs": ["ACT.claims.prepare-light"], "level": "functional", "surface": "cli", "preconditions": ["the run has 8 web claims whose expected values are dates like 2026-02-17"], "steps": [{"goal": "Run claims.js prepare with --seed 3", "done_when": {"expect": "The command exits"}}], "expected": [{"text": "Every date canary has the same year as its source date", "observe": {"channel": "artifact", "key": "audit-input.jsonl expected of canary ids"}}, {"text": "Every date canary has the same month as its source date", "observe": {"channel": "artifact", "key": "audit-input.jsonl expected of canary ids"}}, {"text": "Every date canary is at most 3 days from its source date", "observe": {"channel": "artifact", "key": "audit-input.jsonl expected of canary ids"}}], "basis": {"kind": "requirement", "refs": ["REQ.claims-d-fixes"]}, "readiness": "ready"},
  {"id": "TC.claims.recheck-file-reproduced", "title": "A file recipe one line off is still reproduced", "action_refs": ["ACT.claims.recheck"], "level": "functional", "surface": "cli", "preconditions": ["code.root holds app.py whose line 20 has algorithm=\"HS256\"", "the verdict of A-0001 has a file recipe for app.py line 21 containing algorithm=\"HS256\""], "steps": [{"goal": "Run claims.js recheck on the run dir", "done_when": {"expect": "The command exits"}}], "expected": [{"text": "recheck.json gives A-0001 the status reproduced", "observe": {"channel": "artifact", "key": "recheck.json .items[A-0001].status"}}, {"text": "recheck.json records line 20 as the line found for A-0001", "observe": {"channel": "artifact", "key": "recheck.json .items[A-0001].line"}}], "basis": {"kind": "requirement", "refs": ["DEC.claims-human-optional"]}, "readiness": "ready"},
  {"id": "TC.claims.recheck-differs", "title": "A supported claim whose evidence does not come back is reported as not reproduced", "action_refs": ["ACT.claims.recheck", "ACT.claims.report"], "level": "functional", "surface": "cli", "preconditions": ["the run was scored", "the verdict of claim C-0002 is SUPPORTED with a log recipe whose text is not in the log"], "steps": [{"goal": "Run claims.js recheck on the run dir", "done_when": {"expect": "The command exits"}}, {"goal": "Run claims.js report on the run dir", "done_when": {"expect": "The command exits"}}], "expected": [{"text": "recheck.json gives the item of C-0002 the status differs", "observe": {"channel": "artifact", "key": "recheck.json item status"}}, {"text": "report.json gives C-0002 the status not_reproduced", "observe": {"channel": "artifact", "key": "report.json .claims[C-0002].status"}}], "basis": {"kind": "requirement", "refs": ["DEC.claims-human-optional"]}, "readiness": "ready"},
  {"id": "TC.claims.recheck-path-refused", "title": "A recipe outside the allowed paths is refused", "action_refs": ["ACT.claims.recheck"], "level": "functional", "surface": "cli", "preconditions": ["one verdict has a file recipe for ../outside.txt", "one verdict has a file recipe for .env", "one verdict has a log recipe for a file not listed in log.paths"], "steps": [{"goal": "Run claims.js recheck on the run dir", "done_when": {"expect": "The command exits"}}], "expected": [{"text": "recheck.json gives all three items the status refused", "observe": {"channel": "artifact", "key": "recheck.json item statuses"}}], "basis": {"kind": "requirement", "refs": ["DEC.claims-human-optional"]}, "readiness": "ready"},
  {"id": "TC.claims.recheck-sql-readonly", "title": "SQL recipes are sent read-only and write SQL is refused", "action_refs": ["ACT.claims.recheck"], "level": "functional", "surface": "cli", "preconditions": ["claims-run.json has db kind postgres, readonly true and a connect command that records its standard input", "one verdict has the SQL recipe SELECT count(*) FROM t1", "one verdict has the SQL recipe DELETE FROM t1"], "steps": [{"goal": "Run claims.js recheck on the run dir", "done_when": {"expect": "The command exits"}}], "expected": [{"text": "The recorded standard input starts with BEGIN READ ONLY", "observe": {"channel": "artifact", "key": "fake connect stdin log"}}, {"text": "recheck.json gives the DELETE item the status refused", "observe": {"channel": "artifact", "key": "recheck.json item status"}}, {"text": "The recorded standard input has no DELETE", "observe": {"channel": "artifact", "key": "fake connect stdin log"}}], "basis": {"kind": "requirement", "refs": ["DEC.claims-human-optional"]}, "readiness": "ready"},
  {"id": "TC.claims.report-human-not-requested", "title": "A bulk report without a human sample says it was not requested", "action_refs": ["ACT.claims.report"], "level": "functional", "surface": "cli", "preconditions": ["a bulk run was scored and rechecked", "the run dir has no human.json"], "steps": [{"goal": "Run claims.js report on the run dir", "done_when": {"expect": "The command exits"}}], "expected": [{"text": "report.json has human status not_requested", "observe": {"channel": "artifact", "key": "report.json .human.status"}}, {"text": "report.json has no human upper bound", "observe": {"channel": "artifact", "key": "report.json .human.upper_bound_95"}}], "basis": {"kind": "requirement", "refs": ["DEC.claims-human-optional"]}, "readiness": "ready"},
  {"id": "TC.claims.sample-sheet", "title": "The human sample comes with a review sheet that shows the re-run evidence", "action_refs": ["ACT.claims.sample"], "level": "functional", "surface": "cli", "preconditions": ["a bulk run was scored and rechecked"], "steps": [{"goal": "Run claims.js sample with --n 30 --seed 3", "done_when": {"expect": "The command exits"}}], "expected": [{"text": "sample.md has one entry per sampled item", "observe": {"channel": "artifact", "key": "sample.md entry count"}}, {"text": "Each entry of sample.md shows the re-run status of its item", "observe": {"channel": "artifact", "key": "sample.md entries"}}], "basis": {"kind": "requirement", "refs": ["DEC.claims-human-optional"]}, "readiness": "ready"},
  {"id": "TC.claims.score-bad-recheck", "title": "A verdict with a malformed recipe is sent back", "action_refs": ["ACT.claims.score"], "level": "functional", "surface": "cli", "preconditions": ["the run was prepared", "one verdict has a recheck recipe with both file and sql"], "steps": [{"goal": "Run claims.js score on the run dir", "done_when": {"expect": "The command exits"}}], "expected": [{"text": "The exit code is 1", "observe": {"channel": "artifact", "key": "exit code"}}, {"text": "The error output names the item with the malformed recipe", "observe": {"channel": "artifact", "key": "stderr"}}], "basis": {"kind": "requirement", "refs": ["DEC.claims-human-optional"]}, "readiness": "ready"},
  {"id": "TC.claims.screen-tc-run-draft", "title": "Screen targets in claims-run.json become a tc-run.json draft", "action_refs": ["ACT.claims.screen-tc"], "level": "functional", "surface": "cli", "preconditions": ["claims-run.json has screen targets for /orders and /refunds with start_path and persona", "audit-input.jsonl has screen items on /orders and /refunds", "the project has no tc-run.json for this run yet"], "steps": [{"goal": "Run claims.js screen-tc on the run dir", "done_when": {"expect": "The command exits"}}], "expected": [{"text": "The project's .cc-audits/<run slug>/tc-run.json has an entry for each screen TC", "observe": {"channel": "artifact", "key": "tc-run.json .tcs keys"}}, {"text": "Each tc-run.json entry has the start_path given for its screen", "observe": {"channel": "artifact", "key": "tc-run.json .tcs[*].start_path"}}], "basis": {"kind": "requirement", "refs": ["REQ.claims-d-fixes"]}, "readiness": "ready"},
  {"id": "TC.claims.screen-tc-run-kept", "title": "An existing tc-run.json is not overwritten", "action_refs": ["ACT.claims.screen-tc"], "level": "functional", "surface": "cli", "preconditions": ["the project's .cc-audits/<run slug>/tc-run.json already exists"], "steps": [{"goal": "Run claims.js screen-tc on the run dir", "done_when": {"expect": "The command exits"}}], "expected": [{"text": "The SHA-256 of tc-run.json is the same as before the command", "observe": {"channel": "artifact", "key": "sha256 tc-run.json"}}], "basis": {"kind": "requirement", "refs": ["REQ.claims-d-fixes"]}, "readiness": "ready"},
  {"id": "TC.claims.lint-list-claim", "title": "A claim about one list gets no split warning", "action_refs": ["ACT.claims.lint"], "level": "functional", "surface": "cli", "preconditions": ["claim C-0001 says the origins are http://localhost:5173 and http://localhost:3000 and its expected value is a list of the two"], "steps": [{"goal": "Run claims.js lint on the run dir", "done_when": {"expect": "The command exits"}}], "expected": [{"text": "The output has no warning for C-0001", "observe": {"channel": "artifact", "key": "stdout"}}], "basis": {"kind": "requirement", "refs": ["REQ.claims-d-fixes"]}, "readiness": "ready"},
  {"id": "TC.claims.lint-db-access", "title": "A db spec without a way to connect fails lint", "action_refs": ["ACT.claims.lint"], "level": "functional", "surface": "cli", "preconditions": ["claims-run.json has a db entry with readonly true and neither dsn_env nor connect"], "steps": [{"goal": "Run claims.js lint on the run dir", "done_when": {"expect": "The command exits"}}], "expected": [{"text": "The exit code is 1", "observe": {"channel": "artifact", "key": "exit code"}}, {"text": "The error output names claims-run.json", "observe": {"channel": "artifact", "key": "stderr"}}], "basis": {"kind": "requirement", "refs": ["REQ.claims-d-fixes"]}, "readiness": "ready"}
 ]
}
```

## E2E

- cc-baseline에는 화면이 없다. 위 TC는 `npm test`(단위 테스트, 임시 디렉터리, 가짜 DB 명령)로 대응해서 확인한다.
- 실제 흐름은 Phase D2(새 세션, ontology-demo bulk)에서 확인한다. 그 세션의 화면 TC는 `screen-tc`가 쓴 `tc-run.json` 초안으로 e2e-tester가 기존 프로토콜대로 돌린다(`base_url` `http://localhost:5173`, loopback).

## 검증

- `npm test` 전부 통과(기존 211 + 새 테스트), `node test/wiki.test.js` 21 통과, `node bin/cli.js --doctor` 정상.
- 건식 확인(Phase A 7): 카나리아에 다른 모양끼리 바꾼 것이 0개이고, HTTP 카나리아 값이 모두 실제 상태 코드 목록 안에 있다.
- Phase D2: 위 3번 확인 항목.

## ✅ Checklist

- [ ] TC 초안을 승인 직후 `claims.tc.json`에 합치고 다시 검사했다
- [ ] `recheck`는 에이전트 스크립트를 실행하지 않고, 파일·로그는 허용 경로만, SQL은 `db.connect`로 읽기 전용 SELECT만 보낸다
- [ ] 재실행에서 안 나온 주장은 `not_reproduced`로 보고된다
- [ ] 사람 표본은 조건부이고, 안 물었으면 보고서에 "not requested"가 나온다. 물을 때는 `sample.md`에 재실행 원본이 붙는다
- [ ] 카나리아는 같은 모양끼리만 바꾸고, HTTP는 실제 코드, 날짜는 과거 쪽이다
- [ ] `fact-auditor.md`에 채널별 등급 표, `db.connect`, `recheck`, `== <A-id>` 머리줄, 반환 두 줄이 있다
- [ ] `screen-tc`가 `tc-run.json` 초안을 정해진 자리에 쓰고, 있으면 덮어쓰지 않는다
- [ ] 규칙 12·지침·스킬·MEMORY·CHANGELOG를 맞췄다
- [ ] 보안 감사와 코드 리뷰를 반영했다
- [ ] Phase D2 결과와 비용을 기록했다
- [ ] 서버를 정지했다(`/clean`, 포트 확인)

---

## Audit History
- iter-1: 2026-11-24 / critical=0 high=0 medium=2 low=1 / 전부 auto / next_action=done (지적 사항은 반영함)
  - SEC-001 SQL 거부 목록을 넓혔다(`pg_read_file`·`lo_*`·`dblink`·`nextval`·`setval`·`load_extension`·`INTO OUTFILE`·`FOR UPDATE` 등). DB 종류별 읽기 전용 트랜잭션(postgres, mysql/mariadb, sqlite)을 쓰고, 그 밖의 종류는 `db.readonly_login: true`가 있어야 실행한다.
  - SEC-002 SQL이 불일치일 때 쿼리 출력을 남기지 않고 줄 수만 적는다.
  - SEC-003 로그에도 비밀처럼 보이는 파일 이름 검사를 적용했다. 파일은 마지막 심볼릭 링크를 따라가지 않고 열고(`O_NOFOLLOW`), 연 파일에서 크기와 종류를 확인한다.

## Code Review History
- code-review-iter-1: 2026-11-24 / critical=0 high=0 medium=1 low=5 / design 3, business 1 → 사용자 인터뷰 / next_action=done (반영함)
  - QA-001 (사용자 결정: 감쌀 수 있으면 감싸고, 나머지는 읽기 전용 로그인 선언) SEC-001과 같은 방식으로 고쳤다.
  - QA-002 키에 없는 항목 id는 `ClaimsError`로 알린다.
  - QA-003 SEC-002와 같은 수정.
  - QA-004 (사용자 결정: 연도 맥락이 있을 때만) 연도 규칙은 "founded in 2019", "since 2020" 같은 문장에만 적용한다.
  - QA-005 (사용자 결정: 한계로 문서에) 문자열 리터럴 안의 `;`·`--` 처리는 지침 §8과 fact-auditor 지침에 적었다.
  - QA-006 (사용자 결정: 둘 다 추가) DB 명령 실패 → `failed`, 표본 전부 skip → `skipped` 테스트를 넣었다. DB 종류별 감싸기, `readonly_login`, 새 거부 목록, 연도 규칙 테스트도 함께 넣었다.
- 반영 뒤 `npm test` 216 + 21 통과.

## Phase D2 결과 (2026-11-24)

- **실행:** `ontology-demo/.cc-audits/claims/phase-d2-bulk`, seed 2, bulk. Phase D 장부(주장 42, 전제 2)를 복사했고, 카나리아는 12개(채널마다 3개)다. `claims-run.json`에는 `db.connect`(목록)와 `screen.targets`(4개)를 공식 필드로 썼다. 제품 코드와 DB는 바꾸지 않았다.
- **결과:** supported 38, stale 3(C-0015~17. 틀린 전제 P-002가 `action_service.py`의 삽입으로 반박됐다), not_established 1(C-0010, decision·C 등급), refuted 0. 결과가 Phase D와 같다.

### 확인 항목

| 항목 | 결과 | 근거 |
|---|---|---|
| 코드 읽기가 C 등급인가(D1) | ✅ | 코드 주장 18개(카나리아 포함)가 모두 C이고, A는 db 16·log 11이다. 처음부터 맞아서 다시 요청하지 않았다. 다만 설정 파일(`config.py`, `vite.config.ts`)도 B가 아니라 C로 적었다(아래 N3) |
| 반환에 `jev samples`·`recheck recipes` 줄이 있는가(D2) | ✅ / ⚠️ | 두 줄 모두 있다. 레시피는 45/45(file 18, sql 16, log 11)다. 하지만 `jev samples: 0 (Jev not run)`이었다. 지침 7단계는 이 샘플이 필수인데, 사유가 유효하지 않다(N1) |
| `recheck`가 code·db·log를 `reproduced`로 확인하는가 | ✅ | reproduced 36, differ·refused·failed 0, not re-runnable 8(화면) / 44. 실제 주장 36개가 전부 재현됐다 |
| 카나리아가 같은 모양이고, 모두 잡히는가(D3) | ✅ | 바꾸기 5개는 수↔수 2개, 문구↔문구 3개이고, 모두 다른 대상끼리 바꿨다. 수 바꾸기 7개 중 HTTP 값은 502·500·201로 실제 상태 코드다. 12/12 잡혔다(code·db·log는 fact-auditor, screen은 e2e-tester) |
| `tc-run.json` 초안으로 e2e가 도는가(D6) | ✅ | `screen-tc`가 `written`을 냈고 `missing_targets`는 없다. 초안을 그대로 써서 테스터가 TC 4개, 기대 결과 11개를 code로 판정했다. 불변 조건은 깨끗했고, 스윕은 `skipped`로 기록됐다. `import-results`가 11개를 가져왔다 |
| 사람 표본이 "not requested"인가 | ✅ | 보고서에는 "Human check: not requested — …"가 적혔고, `report.json`의 `human.status`는 `not_requested`다 |

- `check-verifiers` 통과(파일 3개). 결과 정리 단계(`report`)는 불일치 0으로 끝났다.

### 비용 (Phase D와 비교)

| 단계 | Phase D | Phase D2 |
|---|---|---|
| bulk `fact-auditor` | 31.6천 토큰 · 55초 · 도구 16 | 34.6천 · 51초 · 14 |
| `fact-auditor` 후속(등급 재확인 + Jev 샘플) | 36.6천 · 27초 · 4 | 없음(등급이 처음부터 맞음. Jev 샘플은 빠짐, N1) |
| e2e-tester(화면 TC 4개, Playwright, 스윕 생략) | 87.0천 · 132초 · 27 | 86.3천 · 112초 · 28 |
| 검증 에이전트 합계 | 155.2천 · 214초 | 120.9천 · 163초(−22% 토큰) |
| 전체 경과(Phase D: prepare→report, 사람 표본 제외 / D2: lint→report) | 236초 | 299초 |

- D2의 전체 경과에는 오케스트레이터가 직접 한 확인이 들어 있다. 키로 카나리아 모양을 확인했고, verdicts를 점검했고, TC 블록을 만들었다. Phase D와 재는 범위가 같지 않다.
- 사람 표본은 0개다(Phase D에서는 30개를 확인하는 데 사용자 시간이 몇 분 들었다).
- 오케스트레이터 토큰은 따로 잴 수 없다.

### Phase D2에서 찾은 결함

| # | 결함 | 영향 | 수정 범위(안) |
|---|---|---|---|
| N1 | `fact-auditor`가 필수인 7단계(A/B 항목 최대 10개의 `--label code:` Jev 샘플)를 건너뛰었다. 사유는 "Jev not run; no excerpt files written"이다. Jev 키가 있고 A 등급 항목도 27개 있어서 유효한 사유가 아니다. Phase D에서도 후속 요청을 한 번 더 해야 했다 | `Q.claim_supported@1` 뱅크가 늘지 않아 보정이 늦어진다 | `fact-auditor.md` 7단계를 6단계 앞(판정 쓰기 전)으로 옮기고 "0이면 안 되는 사유"를 예시로 적는다. 그리고/또는 `score`가 A/B 판정이 있는데 이 실행의 `run`으로 저장된 샘플이 0이면 경고한다 |
| N2 | `fact-auditor`가 `claims.js recheck`를 직접 돌렸다(`recheck.json`을 auditor가 썼다). 지침에는 금지가 없다. 오케스트레이터가 다시 돌린 결과도 같았다 | auditor가 재실행이 통과할 때까지 레시피를 다듬을 수 있다. 그래도 재실행은 레시피가 가리키는 원본을 다시 읽으므로 해는 작다. 반환에 형식 밖 `note` 줄도 붙었다. 또 `Counts`의 등급 수(A=26, C=19)가 verdicts.jsonl의 실제 수(A=27, C=18)와 하나씩 다르다 | `fact-auditor.md`에 "`recheck`는 오케스트레이터가 돌린다. 직접 돌리지 않는다"를 넣는다(또는 허용하고 지침에 그렇게 적는다) |
| N3 | 설정 파일(`backend/app/config.py`의 기본값, `frontend/vite.config.ts`)을 C로 적었다. 등급 표는 설정 파일을 B로 둔다 | 보수적인 쪽이라 해는 작다. 다만 decision 주장이라면 `not_established`가 과하게 나올 수 있다 | 등급 표에 "설정 파일 = 배포에 쓰이는 값 파일(.env 예시, yaml, toml, `*.config.*`). 소스 안의 기본값 상수는 C"라고 예를 넣는다. 아니면 그대로 둔다 |

### Phase D2 결함 수정 (2026-11-24, 사용자 지시: 결함 보고 수정)

- **N1:** `fact-auditor.md`의 보정 샘플 단계를 판정 쓰기 전(5단계)으로 옮겼다. 0개를 허용하는 사유는 둘뿐이다(Jev가 `unconfigured`로 답함, A·B 판정이 없음). "Jev not run"은 사유가 아니라고 적었다. `score`는 A·B 판정이 있는데 이 실행의 `Q.claim_supported@1` 샘플이 0이면 `warnings`에 넣고 `WARN`을 출력한다(exit 0). `score.json`에 `jev_samples`를 넣었다.
- **N2:** `fact-auditor.md`에 "`recheck`·`score`·`sample`·`report`는 돌리지 않는다(오케스트레이터 몫)"와 "반환의 수는 `verdicts.jsonl`에서 스크립트로 센다"를 넣었다.
- **N3:** 등급 표에 설정 파일의 예를 넣었다. 설정만 담는 파일(`*.config.*`, YAML·TOML·INI, `.env.example`, compose)은 B이고, 코드 안의 설정 기본값(`config.py`의 `Settings` 클래스, 상수)은 C다.
- 테스트 1개를 추가했다. `npm test` 217 + 21 통과.
