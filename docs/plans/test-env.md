# 테스트 환경 준비 지침과 점검 스크립트 (test-env)

## ⚡ Key Rules Summary

| ✅ DO | ❌ DON'T |
|---|---|
| 테스트 전용 백엔드에 운영 스키마만 옮긴다 | 운영 DB나 운영 데이터(행, 개인정보)를 테스트에 쓰기 |
| 테스트 로그인은 3중 가드를 둬서 운영에서는 404가 되게 한다 | 환경 변수 하나로만 켜지는 인증 우회 만들기 |
| reset 스크립트는 테스트 프로젝트가 아니면 거부하게 만든다 | 대상 확인 없이 지우는 reset |
| 유료 외부 API는 승인을 받고 네트워크 수준 가짜 서버로 바꾸고, 보고에 표시한다 | JS 함수 가로채기, 표시 없는 가짜 결과를 PASS로 보고 |
| 첫 라운드 전에 `test-env-check.js`로 CSP, 호스트, 명령 형식을 점검한다 | 실행 중에야 CSP, 쿠키 문제를 발견하기 |

## Meta
- Security Impact: Yes
- Code Quality Impact: Yes
- UI Impact: No
- Behavior Impact: Yes
- Reason: 사용자 프로젝트에 인증 우회 라우트와 가짜 외부 API를 만드는 지침이다. No Mock 정책(§4)에 예외가 생긴다. 새 CLI가 `base_url`과 가짜 서버로 요청을 보낸다.

## Context

- **문제:** 인계 문서 할 일 3. grimbang 검증 시간의 절반 이상이 테스트 환경 준비에 들었다. 그때 만든 것은 이렇다.
  - 운영 스키마를 카탈로그에서 뽑은 마이그레이션(`supabase/migrations/20261118000000_initial_schema.sql`)
  - 3중 가드 테스트 로그인(`app/auth/test-login/route.ts`: production 아님, `E2E_TEST_LOGIN=1`, Supabase URL이 `SUPABASE_TEST_REF` 프로젝트)
  - 테스트 프로젝트가 아니면 거부하는 `scripts/test-reset.mjs`
  - CSP 호스트를 env에서 읽기(`next.config.ts`)
  - `localhost`와 `127.0.0.1` 쿠키 차이 정리
- **확인 못 한 점:** `chr(59)` 사용법은 인계 문서 메모("`;` 분리 문제 때문에 `chr(59)`")만 있다. 당시 쓴 쿼리 원문은 남아 있지 않다. 지침에는 원리(SQL 편집기가 함수 본문 안의 `;`에서 문장을 나눔 → 생성 쿼리에서 `;`를 `chr(59)`로 만들고 문장 단위로 실행)와 CLI 덤프 우선 원칙만 적는다.
- **사용자 결정 (2026-11-19):**
  - 유료 외부 API는 조건부 예외로 가짜 서버를 허용한다.
  - 범위는 지침과 점검 스크립트다.
- **재사용:**
  - `tc-api-run.js`의 `loadRun`, `baseOrigin`(loopback 규칙), `Refused`
  - `tc-sweep.js`의 `browserOrigins`, `runContext`
  - `jev-client.js`의 `parseArgs`
- docs/wiki: 화면이 없는 CLI라서 해당 없다.

## 변경

### 1. 새 지침 `templates/memory/reference_test_env.md` (영어, 문서 구조 규칙에 따름)

맨 위에 Key Rules 표, 맨 아래에 Checklist를 둔다.
1. **언제:** 실제 백엔드(DB, 인증, 외부 API)가 있는 프로젝트에서 첫 e2e 실행 전에 본다. 계획의 E2E 절에 준비 항목을 적는다.
2. **테스트 백엔드:** 별도 프로젝트를 쓴다.
   - 스키마만 옮기고 행은 옮기지 않는다.
   - CLI 덤프(`supabase db dump --schema-only`, `pg_dump -s`)를 우선한다.
   - DB에 직접 접속할 수 없으면 카탈로그 조회를 SQL 편집기에서 실행한다. 이때 `chr(59)`와 문장 단위 실행으로 `;` 분리 문제를 피한다.
   - 결과는 마이그레이션 파일로 커밋한다.
3. **테스트 로그인:** 소셜 로그인 대신 테스트 계정으로 로그인하는 라우트를 둔다.
   - 3중 가드: production 빌드가 아님, 명시적 플래그 env, 백엔드가 테스트 프로젝트.
   - 하나라도 아니면 404를 돌려준다. 운영에서 404인지 배포 후 확인한다.
   - grimbang 패턴을 일반화한 예시 코드를 넣는다.
   - 자격 증명은 `.env*`(600)에만 둔다.
4. **reset 스크립트:**
   - 테스트 프로젝트가 아니면 거부한다(호스트 비교).
   - 테스트 계정의 행과 파일만 지우고 되돌린다. 여러 번 실행해도 결과가 같아야 한다.
   - 형식은 `node scripts/<x>.mjs`이고 `reset_command`로 등록한다.
5. **출처와 CSP:**
   - 테스트 백엔드 출처를 `browser_origins`에 넣는다.
   - 앱 CSP(`connect-src`, `img-src`)는 운영 호스트를 하드코딩하지 말고 env에서 읽는다.
6. **호스트 하나만 쓰기:** 쿠키는 호스트별이다. `base_url`, 앱의 사이트 URL과 리다이렉트, 개발 서버 바인딩(`-H`)이 같은 호스트(`localhost`나 `127.0.0.1` 중 하나)를 써야 한다.
7. **유료 외부 API 가짜 서버(조건부 예외):**
   - **허용 조건:**
     - 앱 코드는 그대로 돈다.
     - 바꾸는 것은 네트워크 밖의 서드파티 호출 주소뿐이다(SDK base URL env, production에서는 무시).
     - 계획에서 사용자 승인을 받는다.
   - **가짜 서버:**
     - loopback에서 돈다.
     - 고정 성공 응답과 오류 응답(429, 500)을 선택할 수 있게 한다.
   - **기록과 보고:**
     - `tc-run.json`의 `external_stubs`에 적는다.
     - 결과 보고에 "가짜 외부 API: <name>"을 표시한다.
     - 외부 결과의 품질을 보는 expected는 `NOT_OBSERVABLE`로 둔다.
   - **금지:** JS 함수 가로채기는 여전히 금지다.
8. **점검:** 첫 라운드 전에 `test-env-check.js`를 실행한다(아래 2절). fail이 있으면 실행하지 않는다.

### 2. 새 스크립트 `templates/scripts/test-env-check.js`

```
node test-env-check.js --run <.cc-audits/<slug>/tc-run.json> [--json]
```

검사 항목마다 `ok`, `warn`, `fail` 중 하나와 이유를 낸다. 어디에도 쓰지 않고, 요청은 `base_url`과 `external_stubs` 주소로만 보낸다(리다이렉트는 따라가지 않고 읽기만 한다).

| 검사 | 내용 |
|---|---|
| `base_url` | loopback이 아니면 warn이다(`api_remote_ok` 없을 때는 `loadRun`/`baseOrigin` 규칙과 같다). GET `/`가 응답하지 않으면 fail이다. |
| `host` | `/`, `test_login_path`, 각 `start_path`의 리다이렉트를 최대 5번 수동으로 따라간다. 다른 loopback 이름(`localhost`↔`127.0.0.1`)이나 다른 포트로 가면 fail이다. `Set-Cookie`의 `Domain`이 다른 호스트면 warn이다. |
| `csp` | `/` 응답의 `Content-Security-Policy`에서 `connect-src`(없으면 `default-src`)를 읽는다. `browser_origins` 출처마다 허용되는지 본다(정확한 출처, `*.` 와일드카드, `https:` 스킴). 막히면 fail이고 이유에 출처를 적는다. CSP가 없으면 ok다. |
| `browser_origins` | `sw.browserOrigins` 검증을 그대로 쓴다. 형식이 틀리면 fail이다. |
| `reset_command` | `node <프로젝트 안 상대 경로> <평범한 인자>` 형식이고 파일이 있는지 본다. 형식이 틀리면 fail, 없으면 warn(재생 불가)이다. 실행하지는 않는다. |
| `test_login_path` | 있으면 GET(리다이렉트 안 따라감)이 404가 아닌지 본다. 404면 fail(테스트 환경에서 꺼져 있음)이다. 운영 404 확인은 사람이 하라는 안내를 출력한다. |
| `external_stubs` | `[{ name, url, env }]`의 각 `url`이 loopback이고 응답하는지 본다. loopback이 아니면 fail, 응답하지 않으면 fail이다. |

종료 코드: fail이 없으면 0, 있으면 1, 거부나 사용법 오류는 2다. 마지막 줄은 JSON 한 줄이다(`{ checks: [{ name, status, detail }], fail: N, warn: N }`).

### 3. 기존 문서

- **`templates/memory/reference_e2e_manager_guide.md`:**
  - §2-A run add-on 목록에 `test_login_path`와 `external_stubs`를 추가하고, "첫 라운드 전에 `test-env-check.js`를 실행한다"를 넣는다.
  - §4 No Mock에 조건부 예외 한 줄을 넣고 `reference_test_env.md` §7로 연결한다.
  - §8 보고에 가짜 외부 API 표시를 넣는다.
- **`templates/memory/MEMORY.md`:** 색인에 `reference_test_env.md` 한 줄을 추가한다.
- **`README.md`와 `README_KO.md`, `docs/install-details.md`(en/ko):** 스크립트와 지침 목록에 추가한다.
- **`CHANGELOG.md` `[Unreleased]` Added:** 이번 변경을 기록한다.
- **`docs/plans/test-env.md`:** 이 계획 사본과 실행 기록을 둔다.

### 4. 테스트 — `test/run.js`

로컬 HTTP 서버 하나로 CSP, 리다이렉트, 404 응답을 바꿔 가며 아래 TC를 실행한다.

## Test Cases (draft)

새 파일 `docs/tc/test-env.tc.json`을 만든다.

| TC ID | 제목 | surface | readiness | 기대 결과 수 |
|---|---|---|---|---|
| TC.test-env.check-clean | 문제없는 환경은 exit 0 | cli | ready | 1 |
| TC.test-env.csp-blocks-origin | CSP가 `browser_origins`를 막으면 fail | cli | ready | 2 |
| TC.test-env.host-mismatch | 다른 loopback 이름으로 리다이렉트되면 fail | cli | ready | 1 |
| TC.test-env.reset-command-form | 형식이 틀린 `reset_command`는 fail | cli | ready | 1 |
| TC.test-env.test-login-off | `test_login_path`가 404면 fail | cli | ready | 1 |
| TC.test-env.stub-not-loopback | loopback이 아닌 가짜 서버 주소는 fail | cli | ready | 1 |

**검사 결과:**
- tc-lint: 6 TC, 경고 0개
- tc-jev-check: 7개 채점, 경고 0개
- 열린 질문: 없음. 두 정책은 2026-11-19에 사용자가 결정했다.

```json
{
  "schema_version": 1,
  "feature": "test-env",
  "title": "Test environment check",
  "plan": "test-env",
  "sources": [
    { "id": "REQ.test-env", "kind": "requirement", "locator": ".cc-audits/HANDOFF-next.md 할 일 3 (2026-11-19)" },
    { "id": "DEC.test-env-scope", "kind": "decision", "locator": "user decision 2026-11-19: a guide plus a check script" },
    { "id": "DEC.external-stubs", "kind": "decision", "locator": "user decision 2026-11-19: paid third-party APIs may be replaced by a loopback fake server when approved, recorded and reported" }
  ],
  "actions": [
    {
      "id": "ACT.test-env.check",
      "title": "Check a project's test environment",
      "actor": "e2e manager",
      "trigger": "runs test-env-check.js --run <tc-run.json> before the first round",
      "preconditions": ["a tc-run.json", "the app runs at base_url"],
      "outputs": ["one result per check", "exit code"],
      "evidence_refs": ["REQ.test-env", "DEC.test-env-scope"]
    }
  ],
  "test_cases": [
    {
      "id": "TC.test-env.check-clean",
      "title": "A test environment with no problem passes",
      "action_refs": ["ACT.test-env.check"],
      "level": "functional",
      "surface": "cli",
      "preconditions": ["a test server whose CSP allows the run file's browser_origins", "no redirect to another host", "a valid reset_command whose script exists"],
      "steps": [{ "goal": "Run test-env-check.js on that run file", "done_when": { "expect": "The command exits" } }],
      "expected": [
        { "text": "The exit code is 0", "observe": { "channel": "artifact", "key": "exit code" } }
      ],
      "basis": { "kind": "requirement", "refs": ["REQ.test-env"] },
      "readiness": "ready"
    },
    {
      "id": "TC.test-env.csp-blocks-origin",
      "title": "A CSP that blocks a browser origin fails the check",
      "action_refs": ["ACT.test-env.check"],
      "level": "functional",
      "surface": "cli",
      "preconditions": ["a test server whose CSP connect-src is 'self' only", "a run file whose browser_origins lists another https origin"],
      "steps": [{ "goal": "Run test-env-check.js on that run file", "done_when": { "expect": "The command exits" } }],
      "expected": [
        { "text": "The csp check has status fail", "observe": { "channel": "artifact", "key": "stdout JSON .checks[name=csp].status" } },
        { "text": "The csp check detail names the blocked origin", "observe": { "channel": "artifact", "key": "stdout JSON .checks[name=csp].detail" } }
      ],
      "basis": { "kind": "requirement", "refs": ["REQ.test-env"] },
      "readiness": "ready"
    },
    {
      "id": "TC.test-env.host-mismatch",
      "title": "A redirect to the other loopback name fails the check",
      "action_refs": ["ACT.test-env.check"],
      "level": "functional",
      "surface": "cli",
      "preconditions": ["a run file whose base_url uses 127.0.0.1", "a test server that redirects / to the same port on localhost"],
      "steps": [{ "goal": "Run test-env-check.js on that run file", "done_when": { "expect": "The command exits" } }],
      "expected": [
        { "text": "The host check has status fail", "observe": { "channel": "artifact", "key": "stdout JSON .checks[name=host].status" } }
      ],
      "basis": { "kind": "requirement", "refs": ["REQ.test-env"] },
      "readiness": "ready"
    },
    {
      "id": "TC.test-env.reset-command-form",
      "title": "A reset_command with shell syntax fails the check",
      "action_refs": ["ACT.test-env.check"],
      "level": "functional",
      "surface": "cli",
      "preconditions": ["a run file whose reset_command contains a semicolon"],
      "steps": [{ "goal": "Run test-env-check.js on that run file", "done_when": { "expect": "The command exits" } }],
      "expected": [
        { "text": "The reset_command check has status fail", "observe": { "channel": "artifact", "key": "stdout JSON .checks[name=reset_command].status" } }
      ],
      "basis": { "kind": "requirement", "refs": ["REQ.test-env"] },
      "readiness": "ready"
    },
    {
      "id": "TC.test-env.test-login-off",
      "title": "A test login path that answers 404 fails the check",
      "action_refs": ["ACT.test-env.check"],
      "level": "functional",
      "surface": "cli",
      "preconditions": ["a run file with test_login_path", "a test server that answers 404 on that path"],
      "steps": [{ "goal": "Run test-env-check.js on that run file", "done_when": { "expect": "The command exits" } }],
      "expected": [
        { "text": "The test_login_path check has status fail", "observe": { "channel": "artifact", "key": "stdout JSON .checks[name=test_login_path].status" } }
      ],
      "basis": { "kind": "requirement", "refs": ["REQ.test-env"] },
      "readiness": "ready"
    },
    {
      "id": "TC.test-env.stub-not-loopback",
      "title": "A fake external API server outside loopback fails the check",
      "action_refs": ["ACT.test-env.check"],
      "level": "functional",
      "surface": "cli",
      "preconditions": ["a run file whose external_stubs entry has a url on a public host"],
      "steps": [{ "goal": "Run test-env-check.js on that run file", "done_when": { "expect": "The command exits" } }],
      "expected": [
        { "text": "The external_stubs check has status fail", "observe": { "channel": "artifact", "key": "stdout JSON .checks[name=external_stubs].status" } }
      ],
      "basis": { "kind": "requirement", "refs": ["REQ.test-env", "DEC.external-stubs"] },
      "readiness": "ready"
    }
  ],
  "open_questions": []
}
```

## 실행 순서

1. `Read ~/.claude/memory/phase_start.md and execute`
2. TC 파일과 `.cc-audits/test-env/tc-run.json`을 쓰고 검사를 실행한다. 대상 파일의 `git log -3`도 확인한다.
3. `test-env-check.js`를 작성한다(변경 2). 비슷한 스크립트인 `tc-sweep.js`, `tc-api-run.js`의 구조와 오류 처리를 따른다.
4. 테스트를 추가하고 `npm test`를 실행한다. 전부 통과해야 한다.
5. **grimbang 실측:** grimbang `tc-run.json`으로 실행해 결과를 기록한다.
   - 개발 서버는 `localhost:3200`으로 띄우고, 끝나면 `/clean`을 실행한다. `/clean`이 놓치면 직접 끈다.
   - 운영은 건드리지 않는다.
6. 지침(변경 1)과 기존 문서(변경 3)를 쓰고 `node bin/cli.js --yes`를 실행한다.
7. security-auditor와 code-reviewer를 병렬로 실행하고 지적을 반영한다(Security와 Code Quality가 모두 Yes).
8. 커밋하고 develop에 푸시한다.
9. `Read ~/.claude/memory/phase_end.md and execute`

## E2E

- 새 TC 6개(cli, ready)는 `test/run.js`가 로컬 HTTP 서버로 실행한다. 실행: `npm test`.
- `tc-run.json`: 적을 `base_url`, 계정, skip이 없다.
- 실제 프로젝트 확인은 5단계의 grimbang 실행이다.

## 위험

- **CSP 파싱:** nonce, hash, `'strict-dynamic'`는 판단하지 않고 출처 허용만 본다. 그런 CSP에서는 warn 대신 ok가 나올 수 있다.
- **3중 가드 예시 코드:** 프로젝트 구조가 다르면 그대로 쓸 수 없다. 원칙과 함께 grimbang(Next.js + Supabase) 예시로만 제시한다.
- **가짜 서버 예외:** 남용하면 외부 연동 결함을 놓친다. 그래서 승인, 기록, 보고 표시를 필수로 둔다.

## ✅ Checklist

- [ ] TC 6개를 `docs/tc/test-env.tc.json`에 쓰고 검사
- [ ] `test-env-check.js` 7개 검사, 쓰기 없음, `base_url`과 가짜 서버에만 요청
- [ ] `npm test` 전부 통과, grimbang 실측 기록, `/clean`
- [ ] `reference_test_env.md`, manager guide(§2-A, §4, §8), MEMORY 색인, README, install-details, CHANGELOG
- [ ] security-auditor와 code-reviewer 반영, 커밋, 푸시

## 실행 기록 (2026-11-19)

- `test-env-check.js`(검사 7종)와 `reference_test_env.md`를 추가했다. 테스트 197개와 wiki 21개가 통과했다.
- 출력에 `--json`(JSON 한 줄만) 옵션을 더했다. 테스트 도우미가 stdout 전체를 JSON으로 읽기 때문이다.
- **grimbang 실측(테스트 환경, 개발 서버 `localhost:3200`):**
  - 현재 `tc-run.json`: 7종 중 해당되는 5종이 모두 ok, exit 0.
  - `base_url`을 `127.0.0.1`로 바꾸고 `test_login_path=/auth/test-login`을 넣으면 `host`가 fail이다(`/auth/test-login redirects to http://localhost:3200`). grimbang 1라운드에서 한 라운드를 잃게 한 쿠키 문제를 실행 전에 잡는다.
  - `test_login_path`를 GET하면 테스트 백엔드에서 테스트 계정이 로그인된다. 운영은 건드리지 않았다.

## Audit History

- iter-1: 2026-11-19 / critical=0 high=0 medium=0 low=2 / next_action=done
  - SEC-001: `test_login_path`는 loopback `base_url`에서만 요청한다(로그인이 일어나므로). 아니면 warn으로 남긴다.
  - SEC-002: 지침에 "GET으로 로그인되므로 공유되거나 배포된 호스트에서는 절대 열리면 안 된다"를 추가했다.

## Code Review History

- code-review-iter-1: 2026-11-19 / critical=0 high=0 medium=0 low=5 / profile_status=cached / next_action=done
  - QA-001: `test_login_path`는 한 실행에 한 번만 요청한다(host 검사의 첫 응답을 재사용).
  - QA-002: `external_stubs`의 `env` 이름을 검증한다.
  - QA-003: 예기치 못한 오류는 exit 3이다(검사 실패 1과 구분).
  - QA-004: `sourceAllows`와 `cspBlocked` 직접 테스트를 추가했다.
  - QA-005: CSP는 `/`에서만 읽는다. 한계로 주석과 지침에 적었다.
