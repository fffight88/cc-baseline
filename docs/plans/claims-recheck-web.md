# 사실 검증 보강 — 웹 증거 재확인, 검증 스크립트 점검을 `score`에, 권한이 좁은 실행

verify-before-report 행동 확인(외부용 3차)에서 드러난 두 가지를 고친다.

1. **권한이 좁은 실행에서 점검이 빠진 채 보고됨**
   - 검증 에이전트가 묶음 셸 명령 한 번이 거부되자 "셸이 막혔다"고 보고 `check-verifiers`와 Jev 샘플을 건너뛰었다.
   - 에이전트는 "점검 실패, 다시 돌려야 함"을 돌려줬는데, 본 세션은 그대로 집계하고 보고했다.
2. **웹 주장은 증거 재실행이 안 됨**
   - `claims.js recheck`는 파일 줄·로그 줄·SELECT만 다시 읽는다. 웹 항목 10개가 모두 "재실행 불가"였다.
   - 규칙 14로 의무가 된 비교 대상 조사는 거의 전부 웹 주장이라, 가장 자주 쓰일 경우에 이 단계가 비어 있다.

## ⚡ Key Rules Summary

| ✅ DO | ❌ DON'T |
|---|---|
| `score`가 검증 스크립트 점검을 직접 돌리고, 걸리면 exit 1로 멈춘다 | 점검을 에이전트의 자기 보고에만 맡기기 |
| 에이전트가 "다시 돌려야 함"이나 "못 돌린 것"을 돌려주면 한 번 다시 부르고, 그래도 안 되면 답에 무엇이 빠졌는지 적는다 | 그 반환을 무시하고 깨끗한 실행처럼 보고하기 |
| fact-auditor는 파일을 Write로 쓰고, 셸은 한 번에 명령 하나만 돌린다 | `cd … &&`, heredoc, 파이프로 묶은 명령. 한 번 거부됐다고 셸 전체를 포기하기 |
| 웹 재확인은 https 공개 주소로 GET만, 연결하는 IP를 검사하고, 크기·시간·개수 상한을 둔다 | http, 포트 지정, IP 주소, 내부망·로컬·메타데이터 주소, 검사 없는 리다이렉트 |
| 재확인은 "그 문구가 페이지에 있다"만 본다. 한계를 지침과 보고서에 적는다 | 재확인 통과를 "주장이 맞다"의 증명으로 쓰기 |
| `npm test`는 외부 네트워크 없이 돈다(가짜 fetcher 주입) | 테스트에서 실제 사이트 호출 |

## Meta
- Security Impact: Yes
- Code Quality Impact: Yes
- UI Impact: No
- Behavior Impact: Yes
- Claim Impact: No
- Audience: internal
- Reason: `claims.js`가 에이전트가 적은 URL로 외부 요청을 보내게 된다(내부망 접근·정보 유출 경로가 될 수 있어 보안 감사 필요). `score`의 종료 조건과 `recheck`의 결과, fact-auditor·`/verify-claims` 절차가 바뀐다.

---

## Context

- **요청(2026-11-27):** 두 문제의 영향과 해결 방향을 설명한 뒤 "진행해".
- **원인(하위 세션 기록 `~/.claude/projects/-tmp-vbr-scenarios-ext3`에서 확인):**
  - 에이전트의 셸 호출은 한 번뿐이었고 `cd … && mkdir … && cat > … <<EOF` 묶음이었다. 허용 목록(`Bash(node:*)`)이 이를 거부했다. 같은 실행에서 본 세션의 `node` 단독 명령은 모두 통과했다.
  - 에이전트 반환: `check-verifiers: fail (not run)`, `jev samples: 0`, `next_action: rerun`. `/verify-claims`에는 이 반환을 받았을 때의 지시가 없다.
  - `recheck`는 `v.recheck`가 없는 web 항목을 `not_rerunnable`로 둔다(`claims.js` 1015행). 웹용 방식(recipe)은 없다(`RECHECK_KINDS = ['file','log','sql']`).
- **이번 실행에 끼친 영향:** 판정은 바뀌지 않았다(근거는 에이전트가 직접 읽은 페이지, 집계는 `score`가 파일에서 계산). 빠진 것은 스크립트 점검 관문, Jev 샘플, 웹 증거의 독립 재확인이다.
- **환경 확인:** 이 서버의 Node는 v24.22.0이고 프록시 환경변수가 없다. `https://api.github.com/repos/svix/svix-webhooks/license`를 GET으로 받아 `"spdx_id": "MIT"`를 찾았다(200, JSON 2,390바이트).
- **방향:** 원인이 분명한 결함 수정과 그 연장이라 규칙 13은 쓰지 않는다. 모드는 내부용이다.

## Decisions (made without asking)

| # | 결정 | 이유 | 근거 | 되돌리는 법 |
|---|---|---|---|---|
| D1 | 두 문제를 한 플랜에 넣고 1번(절차)을 먼저 한다 | 1번은 작고 2번의 행동 확인에도 필요하다(권한이 좁은 실행에서 recipe를 쓰게 하려면 에이전트가 끝까지 가야 한다) | 위 원인 | Phase A만 커밋 |
| D2 | 스크립트 점검은 문구가 아니라 `score` 안에서 강제한다 | 이번 결함은 "에이전트가 실패라고 했는데 그냥 넘어감"이다. 문구는 또 건너뛸 수 있다 | `checkVerifiers`는 순수 정적 검사(`claims.js` 567행) | `score`에서 호출 삭제 |
| D3 | 웹 recipe는 선택이다. 없으면 지금처럼 `not_rerunnable`, 있는데 문구가 없거나 페이지가 안 오면 기존 계약대로 "증거가 재현되지 않음" | 스크립트로 그려지는 페이지나 봇 차단 페이지에 recipe를 강제하면 맞는 주장이 계속 걸린다. recipe를 쓴 이상 안 돌아오면 숨기지 않는다 | 기존 file/log/sql 계약(`report`의 `not_reproduced`) | — |
| D4 | 전역 `fetch` 대신 `https.request`에 검사하는 `lookup`을 붙여 쓴다 | `fetch`는 실제 연결 IP를 고정·검사할 수 없다. DNS를 미리 한 번 보고 따로 연결하면 그 사이에 주소가 바뀔 수 있다 | Node `https`의 `lookup` 옵션, `net.BlockList` | — |
| D5 | `recheck`와 `main`을 async로 바꾸고 fetcher를 주입할 수 있게 한다 | 테스트가 외부 네트워크 없이 돌아야 한다. 호출부는 테스트 4곳뿐이다 | `grep "recheck(" test/run.js` → 4 | — |
| D6 | 행동 확인은 전체 외부용 시나리오가 아니라 "사실 4개를 `/verify-claims`로 검증"하는 좁은 문장으로 한다 | 확인할 것은 검증 절차뿐이다. 전체 시나리오는 한 번에 약 $1.4였다 | 지난 실행의 비용 기록 | 전체 시나리오로 다시 돌리기 |
| D7 | TC는 새 파일이 아니라 `docs/tc/claims.tc.json`에 덧붙인다 | 같은 기능의 후속 플랜은 같은 파일을 갱신한다(`reference_tc_authoring.md` §1) | 기존 31개 TC | — |

---

## 설계

### 1. 권한이 좁은 실행 (Phase A)

- **`claims.js score`:** `checkVerifiers(runDir)`를 직접 호출한다.
  - 걸린 파일이 있으면 `ok: false`로 돌려주고 CLI는 `ERROR verifier <파일>: <이유>`를 찍고 exit 1.
  - 깨끗하면 `score.json`에 `verifiers: { files, problems: 0 }`를 남긴다.
- **`templates/commands/verify-claims.md`:**
  - 7단계에 추가: fact-auditor의 반환이 `next_action: rerun`, `check-verifiers: fail`, 또는 못 돌린 명령을 적었으면 깨끗한 실행처럼 넘어가지 않는다. 거부된 셸 명령이 원인이면 "셸은 한 번에 명령 하나"를 붙여 한 번 다시 부른다(`iteration` + 1). 그래도 안 되면 계속하되 11단계 답에 무엇이 안 돌았는지 적는다.
  - 11단계에 추가: 에이전트가 못 돌린 것(실행 못 한 검증 스크립트, Jev 샘플 0)을 답에 적는다.
- **`templates/agents/fact-auditor.md`:**
  - 파일은 Write 도구로 쓴다. 셸은 한 번에 명령 하나(`node <파일>`, `bash <파일>`, `python3 <파일>`)만 돌린다. `cd … &&`, heredoc, 파이프, `;`는 쓰지 않는다.
  - 거부된 호출은 "그 명령이 거부된 것"이지 셸이 막힌 것이 아니다. 단독 명령으로 다시 시도하고, 그래도 거부되면 `note`에 그 명령을 적는다.
- **`reference_claim_verification.md` §8:** 무인 실행(`claude -p`)의 최소 허용 목록(`Bash(node:*)`, 다른 언어 검증 스크립트를 쓰면 그 인터프리터)을 한 줄로 적는다.

### 2. 웹 증거 재확인 (Phase B)

- **recipe:** `"recheck": { "url": "https://…", "contains": "<페이지에 있어야 할 문구>" }`. `RECHECK_KINDS`와 `RECHECK_KEYS`에 `url`을 넣고 `checkRecipe`의 문구를 고친다.
- **켜는 조건:** `claims-run.json`의 `web: true`. 아니면 `refused`. `lint`는 `web`이 있으면 boolean인지 본다.
- **URL 형식 검사(요청 전에, 어기면 `refused`):**
  - `https:`만, 포트 지정 없음, 사용자 정보 없음, 길이 500자 이하
  - 호스트가 IP 주소가 아님, 점이 있는 이름, `localhost`·`.local`·`.internal`로 끝나지 않음
- **연결 검사:** `https.request`의 `lookup`에서 이름을 풀고, 나온 주소 중 하나라도 공개 주소가 아니면 연결하지 않는다(`refused`). 검사한 그 주소로 연결한다. 막는 대역은 `net.BlockList`로 둔다.
  - 루프백, 사설(10/8, 172.16/12, 192.168/16), 링크로컬(169.254/16, 메타데이터 주소 포함), 100.64/10, 0/8, 멀티캐스트 이상
  - IPv6 `::1`, `fc00::/7`, `fe80::/10`, IPv4-매핑 주소
- **요청:** GET만. 헤더는 `User-Agent: cc-baseline-claims-recheck`와 `Accept`뿐이다. 쿠키·인증·본문 없음. 환경 프록시를 쓰지 않는다.
- **리다이렉트:** 자동으로 따라가지 않는다. 최대 3번, 매번 같은 형식·연결 검사를 한다. 검사에 걸리면 `refused`.
- **상한:** 요청당 15초, 본문 2 MB(`FILE_MAX`), 실행당 서로 다른 URL 40개(넘으면 `refused`). 같은 URL은 한 번만 받는다.
- **본문 처리:** `text/*`, JSON, XML만 받는다(아니면 `failed`). HTML은 `<script>`·`<style>`·주석을 지우고 태그를 공백으로 바꾼 뒤 기본 엔티티를 풀고 공백을 접는다. 기존 `hasWhole`로 찾는다(온전한 토큰 일치).
- **결과:**

  | 상태 | 조건 |
  |---|---|
  | `reproduced` | 2xx이고 문구가 있음. 찾은 부분 200자를 `clip`으로 가려서 남김 |
  | `differs` | 2xx인데 문구가 없음. 페이지 내용은 남기지 않음 |
  | `failed` | 2xx 아님, 시간 초과, 이름 풀이 실패, 2 MB 초과, 텍스트 아님 |
  | `refused` | 형식·주소·리다이렉트 검사에 걸림, `web`이 꺼짐, 개수 상한 |

- **API:** `recheck(runDir, { keyRoot, fetchUrl })`가 async가 된다. `fetchUrl` 기본값이 위의 실제 구현이고 테스트는 가짜를 넣는다. `main`도 async가 되고 진입부는 `main(argv).then(code => { process.exitCode = code; })`.
- **`fact-auditor.md`:** 웹 항목에서 판정을 가른 문구가 원본 응답에 그대로 있으면(API JSON, raw 파일, 정적 HTML) `url` recipe를 쓴다. API·raw 주소를 우선한다. 스크립트로 그려지는 페이지는 recipe를 쓰지 않는다. 반환의 `recheck recipes: N of M`에서 M에 웹 판정을 포함한다.
- **`reference_claim_verification.md`:** Key Rules의 recheck 행, §2 표의 recipe 종류, §4 6단계, §8 한계를 고친다.
  - 한계: 페이지는 바뀐다, 봇 차단·로그인 벽은 `failed`, "문구가 있다"는 "주장을 뒷받침한다"가 아니다, URL은 에이전트가 적는다(길이·개수 상한, GET만).
- **문서:** README(영·한)의 fact-auditor 항목, CHANGELOG.

### 3. 고칠 파일

- `templates/scripts/claims.js`
- `templates/agents/fact-auditor.md`, `templates/commands/verify-claims.md`, `templates/memory/reference_claim_verification.md`
- `test/run.js`(새 검사, 기존 `recheck(` 호출 4곳에 `await`)
- `docs/tc/claims.tc.json`(TC 12개, 행동 3개, 소스 2개 추가), `docs/plans/claims-recheck-web.md`
- `README.md`, `README_KO.md`, `CHANGELOG.md`

---

## Phase A — 권한이 좁은 실행

1. Read ~/.claude/memory/phase_start.md and execute
2. 승인 직후:
   - 아래 TC 초안을 `docs/tc/claims.tc.json`에 덧붙이고, 이 플랜을 `docs/plans/claims-recheck-web.md`로 쓴다.
   - 두 검사를 파일로 다시 돌린다(`.cc-audits/claims-recheck-web/tc-check.json`).
   - plan mode 중에 만든 임시 파일 `/tmp/crw-draft.json`을 지운다.
3. `git log -3`으로 고칠 파일의 최근 변경을 확인한다(규칙 8).
4. 설계 1대로 고친다(`score`, `/verify-claims`, fact-auditor, 지침 §8).
5. 테스트: `score-verifier-refused`, `score-verifier-count`, `auditor-plain-commands`(셸 부분), `verify-claims-rerun`
6. Read ~/.claude/memory/phase_end.md and execute

## Phase B — 웹 증거 재확인

1. Read ~/.claude/memory/phase_start.md and execute
2. 설계 2대로 `claims.js`를 고친다(URL 검사, 주소 검사, fetcher, HTML 텍스트, async).
3. 테스트(가짜 fetcher 주입, 외부 요청 없음):
   - `recheck-url-*` 8개
   - 주소 검사 함수 단위 검사(대역별)
   - 실제 fetcher가 `https://localhost/`를 연결 전에 거절하는지
4. fact-auditor·지침·README·CHANGELOG를 고친다.
5. `npm test`(233 + 새 검사, wiki 21), `node bin/cli.js --doctor`
6. Read ~/.claude/memory/phase_end.md and execute

## Phase C — 감사·설치·행동 확인

1. Read ~/.claude/memory/phase_start.md and execute
2. security-auditor와 code-reviewer를 병렬로 돌리고 반영한다.
   - design/business 이슈는 규칙 15로 처리한다.
   - CRITICAL·HIGH를 고치지 않고 두는 것은 사용자에게 묻는다.
   - 최대 3회 반복한다.
3. 커밋(`.claude/` 제외), develop 푸시, 이 서버에 설치, doctor 확인
4. **행동 확인(`claude -p`, 임시 폴더, 신호일 뿐 증명은 아님):**
   - 문장: "다음 사실 4개를 `/verify-claims`로 검증해 줘: Svix 서버는 MIT 라이선스다, Svix 서버는 주로 Rust로 쓰였다, Hookdeck Outpost는 Apache-2.0이다, Lago는 AGPL-3.0이다"
   - 허용 도구: `Read Glob Grep WebSearch WebFetch Write Edit Agent Task Skill Bash(node:*)`(지난번과 같은 좁은 목록)
   - 기대:
     - fact-auditor 반환에 "셸 거부"가 없다. `score.json`에 `verifiers`가 있다.
     - `recheck.json`에서 웹 항목 1개 이상이 `reproduced`다(API 주소 recipe).
     - 답이 재실행 결과 줄을 인용한다.
   - 기대와 다르면 문구를 고치고 다시 돌린다(최대 2회). 비용은 실행당 $0.5~1로 예상한다(추정).
   - 결과는 하위 세션 기록의 도구 호출까지 요약해 플랜 끝에 적는다.
5. 메모리와 HANDOFF를 갱신하고 임시 폴더를 정리한다.
6. Read ~/.claude/memory/phase_end.md and execute

---

## Test Cases (draft)

cc-baseline 자체의 TC(`surface: cli`)다. 승인 직후 `docs/tc/claims.tc.json`에 덧붙인다. 아래 JSON은 추가분만 담은 것이다(기존 31개 TC·행동 11개·소스 6개는 그대로 둔다). 기대 결과는 `npm test`가 실행 결과 파일과 템플릿 내용으로 확인한다(`artifact` 채널).

| TC ID | 제목 | surface | readiness | 기대 결과 수 |
|---|---|---|---|---|
| TC.claims.recheck-url-reproduced | 문구가 있는 페이지의 url recipe는 재현된다 | cli | ready | 2 |
| TC.claims.recheck-url-html-text | HTML은 보이는 글자로 맞춘다(script 안은 제외) | cli | ready | 2 |
| TC.claims.recheck-url-differs | 문구가 없으면 differs, 보고서는 재현 안 됨으로 센다 | cli | ready | 2 |
| TC.claims.recheck-url-failed | 403이나 2 MB 초과는 failed | cli | ready | 2 |
| TC.claims.recheck-url-refused-form | http·포트·사용자 정보·IP 주소는 요청 없이 refused | cli | ready | 2 |
| TC.claims.recheck-url-private-host | 내부 주소로 풀리는 호스트는 refused | cli | ready | 1 |
| TC.claims.recheck-url-redirect | 리다이렉트는 매번 같은 검사를 받는다 | cli | ready | 2 |
| TC.claims.recheck-url-web-off | `web: true`가 없으면 refused | cli | ready | 1 |
| TC.claims.score-verifier-refused | 걸리는 검증 스크립트가 있으면 score가 exit 1 | cli | ready | 2 |
| TC.claims.score-verifier-count | score.json에 점검 결과가 남는다 | cli | ready | 2 |
| TC.claims.auditor-plain-commands | fact-auditor는 Write로 쓰고 셸은 명령 하나씩, url recipe 안내 | cli | ready | 3 |
| TC.claims.verify-claims-rerun | `/verify-claims`는 실패 반환을 넘기지 않는다 | cli | ready | 2 |

**검사 요약 (표준 입력):**
- `tc-lint`: 12 TC, 경고 0건.
- `tc-jev-check`(jev-1.14.0, 23문장): 경고 1건(`jev_screen`, auditor-plain-commands expected[1])을 남겼다. 채널이 `artifact`라 화면 판정이 아니다.
- 열린 질문은 없다.

```json
{
 "schema_version": 1,
 "feature": "claims",
 "title": "Claim verification: web evidence re-read, verifier check inside score, narrow-permission runs",
 "plan": "claims-recheck-web",
 "sources": [
  {"id": "REQ.claims-recheck-web", "kind": "requirement", "locator": "docs/plans/claims-recheck-web.md"},
  {"id": "SRC.claims-ext3-run", "kind": "source", "locator": "verify-before-report behavior check 2026-11-27, external run 3: recheck gave not_rerunnable for all 10 web items; fact-auditor returned check-verifiers fail (one compound Bash call refused) and next_action rerun, and the orchestrator scored and reported anyway"}
 ],
 "actions": [
  {"id": "ACT.claims.recheck-url", "title": "Re-read a web page the verifier named", "actor": "orchestrator", "trigger": "runs claims.js recheck <run dir> on a run whose verdicts carry url recipes", "preconditions": ["claims-run.json has web: true", "verdicts.jsonl has verdict lines with a url recipe"], "outputs": ["recheck.json with a status per item"], "evidence_refs": ["REQ.claims-recheck-web"]},
  {"id": "ACT.claims.score-verifiers", "title": "Score checks the verifier files itself", "actor": "orchestrator", "trigger": "runs claims.js score <run dir>", "preconditions": ["the run was prepared", "verdicts.jsonl has a verdict for every item"], "outputs": ["score.json with the verifier check result", "exit code 1 when a verifier file is refused"], "evidence_refs": ["REQ.claims-recheck-web"]},
  {"id": "ACT.claims.install-guides", "title": "Install the agent and the command", "actor": "user", "trigger": "runs node bin/cli.js --yes", "preconditions": ["cc-baseline templates"], "outputs": ["agents/fact-auditor.md", "commands/verify-claims.md", "reference_claim_verification.md"], "evidence_refs": ["REQ.claims-recheck-web"]}
 ],
 "test_cases": [
  {"id": "TC.claims.recheck-url-reproduced", "title": "A url recipe whose page holds the text is reproduced", "action_refs": ["ACT.claims.recheck-url"], "level": "functional", "surface": "cli", "preconditions": ["claims-run.json has web: true", "the verdict of A-0001 has a url recipe for https://api.example.org/license containing MIT", "the page answers 200 with a body that has \"spdx_id\": \"MIT\""], "steps": [{"goal": "Run claims.js recheck on the run dir", "done_when": {"expect": "The command exits"}}], "expected": [{"text": "recheck.json gives A-0001 the status reproduced", "observe": {"channel": "artifact", "key": "recheck.json .items[A-0001].status"}}, {"text": "recheck.json records the kind url for A-0001", "observe": {"channel": "artifact", "key": "recheck.json .items[A-0001].kind"}}], "basis": {"kind": "requirement", "refs": ["REQ.claims-recheck-web", "SRC.claims-ext3-run"]}, "readiness": "ready"},
  {"id": "TC.claims.recheck-url-html-text", "title": "A url recipe matches the visible text of an HTML page", "action_refs": ["ACT.claims.recheck-url"], "level": "functional", "surface": "cli", "preconditions": ["claims-run.json has web: true", "the verdict of A-0001 has a url recipe containing Apache License 2.0", "the page answers 200 with HTML whose paragraph reads Apache <b>License</b> 2.0", "the verdict of A-0002 has a url recipe containing hidden-token", "the same page has hidden-token only inside a script element"], "steps": [{"goal": "Run claims.js recheck on the run dir", "done_when": {"expect": "The command exits"}}], "expected": [{"text": "recheck.json gives A-0001 the status reproduced", "observe": {"channel": "artifact", "key": "recheck.json .items[A-0001].status"}}, {"text": "recheck.json gives A-0002 the status differs", "observe": {"channel": "artifact", "key": "recheck.json .items[A-0002].status"}}], "basis": {"kind": "requirement", "refs": ["REQ.claims-recheck-web"]}, "readiness": "ready"},
  {"id": "TC.claims.recheck-url-differs", "title": "A url recipe whose page lacks the text differs", "action_refs": ["ACT.claims.recheck-url"], "level": "functional", "surface": "cli", "preconditions": ["claims-run.json has web: true", "the verdict of A-0001 has a url recipe containing MIT", "the page answers 200 with a body that has \"spdx_id\": \"Apache-2.0\""], "steps": [{"goal": "Run claims.js recheck on the run dir", "done_when": {"expect": "The command exits"}}], "expected": [{"text": "recheck.json gives A-0001 the status differs", "observe": {"channel": "artifact", "key": "recheck.json .items[A-0001].status"}}, {"text": "The report counts the claim of A-0001 under evidence did not reproduce", "observe": {"channel": "artifact", "key": "report.json .counts.not_reproduced"}}], "basis": {"kind": "requirement", "refs": ["REQ.claims-recheck-web"]}, "readiness": "ready"},
  {"id": "TC.claims.recheck-url-failed", "title": "A page that does not come back is failed", "action_refs": ["ACT.claims.recheck-url"], "level": "functional", "surface": "cli", "preconditions": ["claims-run.json has web: true", "the verdict of A-0001 has a url recipe whose page answers 403", "the verdict of A-0002 has a url recipe whose page body is larger than 2 MB"], "steps": [{"goal": "Run claims.js recheck on the run dir", "done_when": {"expect": "The command exits"}}], "expected": [{"text": "recheck.json gives A-0001 the status failed", "observe": {"channel": "artifact", "key": "recheck.json .items[A-0001].status"}}, {"text": "recheck.json gives A-0002 the status failed", "observe": {"channel": "artifact", "key": "recheck.json .items[A-0002].status"}}], "basis": {"kind": "requirement", "refs": ["REQ.claims-recheck-web"]}, "readiness": "ready"},
  {"id": "TC.claims.recheck-url-refused-form", "title": "A url recipe outside the allowed form is refused without a request", "action_refs": ["ACT.claims.recheck-url"], "level": "functional", "surface": "cli", "preconditions": ["claims-run.json has web: true", "one verdict has a url recipe for http://example.org/a", "one verdict has a url recipe for https://example.org:8443/a", "one verdict has a url recipe for https://user:pw@example.org/a", "one verdict has a url recipe for https://10.0.0.5/a"], "steps": [{"goal": "Run claims.js recheck on the run dir", "done_when": {"expect": "The command exits"}}], "expected": [{"text": "recheck.json gives all four items the status refused", "observe": {"channel": "artifact", "key": "recheck.json item statuses"}}, {"text": "No request was sent for any of the four items", "observe": {"channel": "artifact", "key": "requests seen by the test fetcher"}}], "basis": {"kind": "requirement", "refs": ["REQ.claims-recheck-web"]}, "readiness": "ready"},
  {"id": "TC.claims.recheck-url-private-host", "title": "A host that resolves to a private address is refused", "action_refs": ["ACT.claims.recheck-url"], "level": "functional", "surface": "cli", "preconditions": ["claims-run.json has web: true", "one verdict has a url recipe for https://localhost/a", "one verdict has a url recipe whose host resolves to 169.254.169.254"], "steps": [{"goal": "Run claims.js recheck on the run dir", "done_when": {"expect": "The command exits"}}], "expected": [{"text": "recheck.json gives both items the status refused", "observe": {"channel": "artifact", "key": "recheck.json item statuses"}}], "basis": {"kind": "requirement", "refs": ["REQ.claims-recheck-web"]}, "readiness": "ready"},
  {"id": "TC.claims.recheck-url-redirect", "title": "Every redirect hop is checked like the first URL", "action_refs": ["ACT.claims.recheck-url"], "level": "functional", "surface": "cli", "preconditions": ["claims-run.json has web: true", "the verdict of A-0001 has a url recipe whose page redirects to http://internal.example/a", "the verdict of A-0002 has a url recipe whose page redirects to another public https page that holds the text"], "steps": [{"goal": "Run claims.js recheck on the run dir", "done_when": {"expect": "The command exits"}}], "expected": [{"text": "recheck.json gives A-0001 the status refused", "observe": {"channel": "artifact", "key": "recheck.json .items[A-0001].status"}}, {"text": "recheck.json gives A-0002 the status reproduced", "observe": {"channel": "artifact", "key": "recheck.json .items[A-0002].status"}}], "basis": {"kind": "requirement", "refs": ["REQ.claims-recheck-web"]}, "readiness": "ready"},
  {"id": "TC.claims.recheck-url-web-off", "title": "A url recipe needs web access in the run file", "action_refs": ["ACT.claims.recheck-url"], "level": "functional", "surface": "cli", "preconditions": ["claims-run.json has no web field", "the verdict of A-0001 has a url recipe for a public https page"], "steps": [{"goal": "Run claims.js recheck on the run dir", "done_when": {"expect": "The command exits"}}], "expected": [{"text": "recheck.json gives A-0001 the status refused", "observe": {"channel": "artifact", "key": "recheck.json .items[A-0001].status"}}], "basis": {"kind": "requirement", "refs": ["REQ.claims-recheck-web"]}, "readiness": "ready"},
  {"id": "TC.claims.score-verifier-refused", "title": "Score fails when a verifier file is refused", "action_refs": ["ACT.claims.score-verifiers"], "level": "functional", "surface": "cli", "preconditions": ["the run was prepared and every item has a verdict", "claims-run.json lists tools/wiki-audit as a forbidden path", "verifiers/verify-code.py opens tools/wiki-audit/audit.py"], "steps": [{"goal": "Run claims.js score on the run dir", "done_when": {"expect": "The command exits"}}], "expected": [{"text": "The exit code is 1", "observe": {"channel": "artifact", "key": "exit code"}}, {"text": "The error output names verifiers/verify-code.py", "observe": {"channel": "artifact", "key": "stderr"}}], "basis": {"kind": "requirement", "refs": ["REQ.claims-recheck-web", "SRC.claims-ext3-run"]}, "readiness": "ready"},
  {"id": "TC.claims.score-verifier-count", "title": "Score records the verifier check", "action_refs": ["ACT.claims.score-verifiers"], "level": "functional", "surface": "cli", "preconditions": ["the run was prepared and every item has a verdict", "verifiers/ holds one clean script"], "steps": [{"goal": "Run claims.js score on the run dir", "done_when": {"expect": "The command exits"}}], "expected": [{"text": "score.json records 1 verifier file checked", "observe": {"channel": "artifact", "key": "score.json .verifiers.files"}}, {"text": "score.json records 0 verifier problems", "observe": {"channel": "artifact", "key": "score.json .verifiers.problems"}}], "basis": {"kind": "requirement", "refs": ["REQ.claims-recheck-web"]}, "readiness": "ready"},
  {"id": "TC.claims.auditor-plain-commands", "title": "fact-auditor runs one plain command per shell call", "action_refs": ["ACT.claims.install-guides"], "level": "functional", "surface": "cli", "preconditions": ["templates/agents/fact-auditor.md"], "steps": [{"goal": "Read the agent's rules", "done_when": {"expect": "The file is read"}}], "expected": [{"text": "The agent file says to write files with the Write tool", "observe": {"channel": "artifact", "key": "fact-auditor.md rules"}}, {"text": "The agent file says to run one plain command per Bash call", "observe": {"channel": "artifact", "key": "fact-auditor.md rules"}}, {"text": "The agent file describes the url recipe for web items", "observe": {"channel": "artifact", "key": "fact-auditor.md recheck recipes"}}], "basis": {"kind": "requirement", "refs": ["REQ.claims-recheck-web", "SRC.claims-ext3-run"]}, "readiness": "ready"},
  {"id": "TC.claims.verify-claims-rerun", "title": "/verify-claims does not report past a failed auditor return", "action_refs": ["ACT.claims.install-guides"], "level": "functional", "surface": "cli", "preconditions": ["templates/commands/verify-claims.md"], "steps": [{"goal": "Read the steps after the fact-auditor call", "done_when": {"expect": "The steps are read"}}], "expected": [{"text": "The command says what to do when fact-auditor returns next_action rerun", "observe": {"channel": "artifact", "key": "verify-claims.md steps"}}, {"text": "The command says the final answer names what the auditor could not run", "observe": {"channel": "artifact", "key": "verify-claims.md steps"}}], "basis": {"kind": "requirement", "refs": ["REQ.claims-recheck-web", "SRC.claims-ext3-run"]}, "readiness": "ready"}
 ],
 "open_questions": []
}
```

## E2E

- 화면이 없다. 위 TC 12개는 `npm test`로 확인한다(가짜 fetcher, 외부 요청 없음).
- 실제 동작은 Phase C 4단계의 `claude -p` 한 문장으로 신호를 본다.

## 검증

- `npm test` 전부 통과(233 + 새 검사), wiki 테스트 21 통과
- `node bin/cli.js --doctor` 14 ok
- 수동 확인 1회: 임시 실행 폴더에서 `claims.js recheck`가 실제 `api.github.com` 주소의 recipe를 `reproduced`로 돌려주는지 본다(Phase B 5단계 뒤).
- Phase C 4단계의 기대 세 가지(신호)

## ✅ Checklist

- [x] TC를 `claims.tc.json`에 덧붙이고 다시 검사했다. 임시 파일을 지웠다
- [x] `score`가 검증 스크립트 점검을 돌리고 걸리면 exit 1, `score.json`에 결과가 남는다
- [x] `/verify-claims` 7·11단계와 fact-auditor의 셸 규칙을 고쳤다
- [x] url recipe: 형식 검사, 연결 주소 검사, 리다이렉트 검사, 상한, HTML 텍스트, 네 가지 상태
- [x] `recheck`·`main` async, 기존 호출부 4곳 수정, 테스트는 외부 요청 없음
- [x] 지침(Key Rules, §2, §4, §8)·README·CHANGELOG
- [x] 보안 감사와 코드 리뷰 반영, 커밋·푸시·설치
- [x] 행동 확인 결과 기록, 메모리·HANDOFF 갱신

## Decisions (made without asking) — 실행 중 추가

| # | 결정 | 이유 | 근거 | 되돌리는 법 |
|---|---|---|---|---|
| D8 | JSON 응답은 받은 그대로, 공백 없는 형태, 공백 있는 형태 셋 모두로 맞춘다 | 실제 주소 수동 확인에서 GitHub API의 `"spdx_id":"MIT"`가 recipe `"spdx_id": "MIT"`와 불일치로 나왔다. 에이전트는 보기 좋게 풀린 형태를 보고 recipe를 쓴다 | 수동 확인 결과(3개 중 맞는 recipe 1개가 differs) | `jsonText` 삭제 |
| D9 | (QA-001, design) 실제 전송 함수는 `request`와 `timeoutMs`를 주입할 수 있게 하고 가짜 소켓으로 시험한다 | 주소 검사가 루프백을 막아서 로컬 HTTPS 서버로는 시험할 수 없다. 크기 중단·시간 초과·3xx 경로가 시험 없이 남으면 멈춤 회귀를 못 잡는다 | 코드 리뷰 QA-001 | 옵션 두 개 삭제 |
| D10 | (QA-004, business) 인라인 태그는 지우고 나머지 태그는 공백으로 바꾼다. 숫자 엔티티도 푼다 | 브라우저에서 보이는 글자와 같게 하려는 것이다. `Lic<b>ense</b>`가 `Lic ense`로 읽혀 맞는 recipe가 불일치로 나오는 것을 줄인다 | 코드 리뷰 QA-004 | `INLINE_TAGS` 비우기 |
| D11 | (QA-005, business) 실패한 페이지도 실행 동안 캐시에 둔다(URL당 요청 한 번) | 같은 URL을 항목마다 다시 받으면 시간 예산을 쓰고 상대 서버에 요청이 늘어난다. 다시 돌리면 풀린다. 지침에 적었다 | 코드 리뷰 QA-005 | `failed`는 캐시하지 않기 |
| D12 | (SEC-003) URL의 호스트가 주장의 `source_url`과 다를 때 경고하지 않고, `recheck.json`에 요청한 호스트와 최종 호스트만 남긴다 | 정상 recipe가 대개 다른 호스트를 쓴다(`github.com` 주장에 `api.github.com` recipe). 경고는 늘 뜨게 된다 | 수동 확인의 recipe들 | 경고 추가 |
| D13 | (SEC-004) `NODE_USE_ENV_PROXY`가 있으면 url recipe를 거절하고, 실행 전체에 120초 예산을 둔다. 인증서 검사는 옵션으로 켠다 | 프록시가 이름을 풀면 주소 검사가 실제 연결을 보지 못한다. 요청당 15초만으로는 최악의 경우 40 × 4 × 15초가 된다 | 보안 감사 SEC-004 | 해당 줄 삭제 |

## Audit History
- iter-1: 2026-11-27 / critical=0 high=1 medium=0 low=3 / next_action=self_fix → 모두 반영.
  - SEC-001(HIGH): `htmlText`의 정규식 체인이 악성 HTML에서 제곱 시간이 걸렸다(200 KB의 `<`에 67초). `indexOf` 기반 선형 스캔으로 바꿨다. 2 MB 악성 입력 6종이 모두 0.6초 안에 끝난다(테스트는 5초 상한).
  - SEC-002: 6to4, Teredo, `::/96`, `fec0::/10`, `64:ff9b:1::/48`를 막는 대역에 넣었다.
  - SEC-003 → D12, SEC-004 → D13.
- iter-2: 2026-11-27 / critical=0 high=0 medium=0 low=1 / next_action=done → iter-1 4건 해결 확인, 2 MB 악성 입력에서 `htmlText`·`jsonText`·`norm`·엔티티 정규식이 선형임을 확인. 낮음 1건(120초 예산을 리다이렉트 사이에는 보지 않음)은 문서를 "120초 뒤에는 새 URL을 요청하지 않는다"로 고쳐 맞췄다. 이 회차는 아래 QA-006 수정 전의 `htmlText`를 봤다. 수정 뒤 선형성은 직접 다시 쟀다(2 MB 입력 7종, 최대 0.43초).

## Code Review History
- code-review-iter-1: 2026-11-27 / critical=0 high=0 medium=1 low=4 / profile_status=cached / next_action=self_fix → 모두 반영. QA-001 → D9, QA-002 문서의 한도를 "요청당 15초·2 MB, 실행당 시작 URL 40개·120초"로 고침, QA-003 = SEC-002, QA-004 → D10, QA-005 → D11. `npm test` 240 + 21 통과.
- code-review-iter-2: 2026-11-27 / critical=0 high=0 medium=1 low=2 / profile_status=cached / next_action=self_fix → 모두 반영. QA-006(MEDIUM): `toLowerCase()`가 "İ"의 길이를 바꿔 위치가 밀리고 script 본문이 보이는 글자로 새던 것을 ASCII만 소문자로 바꿔 고침(테스트 추가). QA-007: 거절된 페이지에도 요청한 호스트를 남기고 예산 문구를 고침. QA-008: `</scripts`가 script를 닫지 않게 함. CRITICAL·HIGH 0이라 종료. `npm test` 240 + 21 통과.

## Phase C 4단계 — 행동 확인 결과 (2026-11-27, `claude -p` 1회, 신호이지 증명은 아님)

플랜의 문장과 좁은 허용 목록(`… Skill Bash(node:*)`)으로 한 번 돌렸고, 첫 실행에서 기대 세 가지가 모두 맞아 다시 돌리지 않았다.

| 기대 | 결과 |
|---|---|
| fact-auditor가 셸 거부로 멈추지 않는다, `score.json`에 `verifiers`가 있다 | 에이전트의 `curl` 두 번이 거부되자 검증 스크립트를 Write로 쓰고 `node <파일>` 단독 명령으로 돌렸다. `tc-jev-judge.js claim` 3회(Jev 샘플 3개)와 `check-verifiers`(파일 4개, 문제 0)도 단독 명령으로 통과했다. `score.json`: `verifiers: { files: 4, problems: 0 }` |
| `recheck.json`에서 웹 항목 1개 이상이 `reproduced` | 주장 4개와 전제 1개 모두 `reproduced`(5/5), `not_rerunnable` 0. 요청한 호스트는 `api.github.com`과 `raw.githubusercontent.com`뿐이다 |
| 답이 재실행 결과 줄을 인용한다 | "증거 재실행: 5건 중 재현 5 · 불일치 0 · 거부 0 · 실패 0" |

- 카나리아 2개를 모두 잡았다(web 채널 trusted). 주장 4개는 모두 supported(B 등급)다.
- **관찰:**
  - "Svix는 주로 Rust"의 recipe는 `server/Cargo.toml`의 워크스페이스 줄이었다. 판정 근거였던 언어 API의 바이트 수가 아니다. 재확인은 "그 문구가 페이지에 있다"만 본다는 한계가 그대로 드러났고, 답이 이 점을 스스로 밝혔다.
  - 본 세션의 묶음 명령 두 번(`ls …; date`, `node … lint; echo`)이 거부됐고, 단독 명령으로 다시 실행했다.
  - 비용은 약 $1.31(API 요금 환산), 105초다. 사실 4개 검증만으로 지난 전체 외부용 시나리오($1.41)와 비슷했다. D6의 "$0.5~1" 예상은 틀렸다.
