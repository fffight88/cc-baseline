# TC 작성 점검 2종 + /clean 서버 누락 수정 (tc-authoring-clean)

## ⚡ Key Rules Summary

| ✅ DO | ❌ DON'T |
|---|---|
| 새 lint는 경고만 하고, 이유를 붙여 남길 수 있게 한다 | 작성 흐름을 막는 오류로 만들기 |
| 기대 결과는 마지막 단계 뒤 화면에서 판정한다는 규칙을 지침에 명시한다 | 단계를 추가하고 기대 결과를 다시 보지 않기 |
| `/clean`은 `ss`로도 리스너를 모은다(Linux) | `lsof` 하나에만 의존하기 |
| 다른 프로젝트 서버, 브라우저, claude는 지금처럼 건드리지 않는다 | 정리 범위 넓히기 |

## Meta
- Security Impact: Unknown
- Code Quality Impact: Yes
- UI Impact: No
- Behavior Impact: Yes
- Reason: `tc-lint.js`에 경고 규칙 2개가 생긴다. `/clean`이 죽이는 프로세스 목록이 바뀐다(`ss` 추가). 프로세스 종료 범위라 보안 감사를 돌린다.

## Context

- **grimbang C에서 나온 문제 3가지:**
  1. **판정 시점:** 오케스트레이터가 TC에 "새로고침하고 아바타 메뉴 열기" 단계를 추가했어요. 그러자 생성 직후에만 보이는 결과 이미지(expected[0])가 마지막 단계 뒤 판정에서 실패했어요. 기대 결과는 마지막 단계 뒤 화면에서 판정하는데, 이를 알려주는 점검이 없어요.
  2. **`done_when`:** "The 'Generate' button can be clicked again"은 성공하면 프롬프트가 비면서 버튼이 비활성이라 성립하지 않아요. 테스터가 임의로 해석했어요.
  3. **`/clean` 누락:** `/clean`이 grimbang 개발 서버를 끄지 못했어요. 원인을 재현해 확정했어요.
     - `next-server`는 프로세스 이름이 `next-server (v16.4.6)`처럼 괄호를 포함한다.
     - lsof 4.93.2는 이런 프로세스를 아예 나열하지 않는다(`/proc/<pid>/stat` 해석 문제로 보임).
     - 확인: 같은 node 서버를 `process.title='paren-srv (v1'`로 띄우면 lsof는 0개, `ss -ltnp`는 1개를 찾는다. 괄호 없는 이름은 둘 다 찾는다.
- **고칠 곳:**
  - `templates/scripts/tc-lint.js`: `RE` 표, 단계·기대 결과 루프. `redrawOnly` 경고와 같은 방식으로 추가한다.
  - `templates/memory/reference_tc_authoring.md` §2 필드 규칙, §3 작성 규칙
  - `templates/commands/clean.md`의 프로젝트 서버 단계
  - 기존 테스트: `test/run.js`의 tc-lint 묶음(1311행 근처), clean.md 문자열 검사(688행 근처)

## 변경

### 1. `tc-lint.js`: 경고 2개 (warn only)

- **`judged_after_last`:**
  - 마지막 단계 `goal`이 화면을 다시 여는 동작이고 기대 결과가 2개 이상이면 경고한다. 해당 동작은 새로고침(reload/refresh/새로고침), 새 탭(new tab/새 탭), 이동(navigate/go back/뒤로), 로그아웃(sign out/log out/로그아웃)이다.
  - 경고 문구: "기대 결과는 마지막 단계 뒤 화면에서 판정한다. 각 결과가 그때도 보이는지 확인하고, 아니면 TC를 나눠라."
- **`done_when`(기존 규칙 이름에 추가):**
  - `done_when.expect`가 버튼이 다시 눌린다는 표현이면 경고한다. 해당 표현은 `clicked again`, `enabled again`, `re-enabled`, `clickable again`, `다시 누를 수`, `다시 활성`이다.
  - 경고 문구: "성공 뒤에는 입력이 비어 버튼이 비활성으로 남을 수 있다. 성공과 실패 둘 다에서 성립하는 것을 적어라(결과나 오류 메시지가 나타난다)."
- **영향:** 기존 TC 파일에서 새 경고가 몇 개 나오는지 확인하고 기록한다. 다른 규칙과 마찬가지로 고치거나 이유를 붙여 남긴다.

### 2. `reference_tc_authoring.md`

- §2 `steps[].done_when.expect` 규칙에 "버튼이 다시 활성화된다는 문장은 피한다"를 추가한다.
- §3 Cases에 "기대 결과는 마지막 단계 뒤 화면에서 판정한다. 단계를 추가하거나 바꾸면 모든 기대 결과를 다시 확인하고, 다른 시점에만 보이는 결과는 TC를 나눈다"를 추가한다. `tc-change`로 TC를 나누는 경우를 포함한다.

### 3. `/clean`(`templates/commands/clean.md`) 프로젝트 서버 단계

- **PID 수집:** lsof 출력에 `ss -ltnpH`의 `pid=`를 합친다(`sort -u`). `ss`가 없으면 lsof만 쓴다(macOS).
- **cwd:** lsof가 비면 `readlink /proc/<pid>/cwd`로 보완한다.
- **포트:** lsof가 비면 `ss -ltnpH`에서 해당 pid 줄의 주소로 보완한다.
- 나머지 조건은 그대로 둔다. 프로젝트 루트 안의 cwd만 대상이고, claude, 브라우저, playwright-mcp는 건너뛰며, `/`와 `$HOME`이면 거부한다.

### 4. 테스트 — `test/run.js`

- tc-lint: 새 TC 3개를 메모리 안 TC 문서로 검사한다(기존 tc-lint 테스트 방식).
- **`/clean` 실제 동작(Linux에서만, `ss`가 없으면 skip):**
  - 임시 git 프로젝트 안에서 `process.title='srv (v1'` node 서버를 띄운다.
  - 같은 이름의 서버를 프로젝트 밖에서도 하나 띄운다.
  - `clean.md`의 프로젝트 서버 단계 한 줄을 그 프로젝트 cwd에서 `sh`로 실행한다.
  - 안의 서버만 꺼지고 밖의 서버는 남는지 확인한다.

## Test Cases (draft)

새 파일 두 개: `docs/tc/tc-lint.tc.json`, `docs/tc/clean.tc.json`.

| TC ID | 제목 | surface | readiness | 기대 결과 수 |
|---|---|---|---|---|
| TC.tc-lint.last-step-reload-warns | 마지막 단계가 새로고침이고 기대 결과가 여러 개면 경고 | cli | ready | 1 |
| TC.tc-lint.last-step-plain-quiet | 마지막 단계가 화면을 다시 열지 않으면 경고 없음 | cli | ready | 1 |
| TC.tc-lint.done-when-reenabled-warns | "다시 누를 수 있다" `done_when`은 경고 | cli | ready | 1 |
| TC.clean.paren-title-server-stopped | 이름에 괄호가 있는 프로젝트 서버도 꺼짐 | cli | ready | 1 |
| TC.clean.outside-server-kept | 프로젝트 밖 서버는 남음 | cli | ready | 1 |

**검사 결과:**
- tc-lint: 경고 0개(두 파일 모두)
- tc-jev-check: 5개 채점, 경고 1개(`jev_screen`, `clean.outside-server-kept` expected[0]). 그대로 둔다. 화면으로 판정하는 항목이 아니라 env 채널(열린 포트)을 코드로 읽는 항목이다.
- 열린 질문: 없음

```json
{
  "tc-lint": {
    "schema_version": 1, "feature": "tc-lint", "title": "TC authoring lint", "plan": "tc-authoring-clean",
    "sources": [
      { "id": "REQ.tc-authoring", "kind": "requirement", "locator": "cc-baseline .cc-audits/HANDOFF-next.md grimbang C 결과, 다음 할 일 2–3 (2026-11-20)" },
      { "id": "SRC.tc-lint", "kind": "source", "locator": "templates/scripts/tc-lint.js steps / expected loop (commit d6ae49e)" }
    ],
    "actions": [
      { "id": "ACT.tc-lint.check", "title": "Check a TC file", "actor": "orchestrator", "trigger": "runs tc-lint.js on a TC file or a draft from stdin", "preconditions": ["a TC file or draft"], "outputs": ["warnings by rule", "exit code 0"], "evidence_refs": ["SRC.tc-lint", "REQ.tc-authoring"] }
    ],
    "test_cases": [
      { "id": "TC.tc-lint.last-step-reload-warns", "title": "A last step that reloads the page with several expected results is warned", "action_refs": ["ACT.tc-lint.check"], "level": "functional", "surface": "cli",
        "preconditions": ["a TC whose last step reloads the page", "two expected results"],
        "steps": [{ "goal": "Run tc-lint.js on that TC", "done_when": { "expect": "The command exits" } }],
        "expected": [{ "text": "The output has a judged_after_last warning for that TC", "observe": { "channel": "artifact", "key": "stdout warnings" } }],
        "basis": { "kind": "requirement", "refs": ["REQ.tc-authoring"] }, "readiness": "ready" },
      { "id": "TC.tc-lint.last-step-plain-quiet", "title": "A last step that does not reopen the page gives no judged_after_last warning", "action_refs": ["ACT.tc-lint.check"], "level": "functional", "surface": "cli",
        "preconditions": ["a TC whose last step types a prompt and submits it", "two expected results"],
        "steps": [{ "goal": "Run tc-lint.js on that TC", "done_when": { "expect": "The command exits" } }],
        "expected": [{ "text": "The output has no judged_after_last warning", "observe": { "channel": "artifact", "key": "stdout warnings" } }],
        "basis": { "kind": "requirement", "refs": ["REQ.tc-authoring"] }, "readiness": "ready" },
      { "id": "TC.tc-lint.done-when-reenabled-warns", "title": "A done_when that waits for a button to be clickable again is warned", "action_refs": ["ACT.tc-lint.check"], "level": "functional", "surface": "cli",
        "preconditions": ["a step whose done_when says the Generate button can be clicked again"],
        "steps": [{ "goal": "Run tc-lint.js on that TC", "done_when": { "expect": "The command exits" } }],
        "expected": [{ "text": "The output has a done_when warning for that step", "observe": { "channel": "artifact", "key": "stdout warnings" } }],
        "basis": { "kind": "requirement", "refs": ["REQ.tc-authoring"] }, "readiness": "ready" }
    ],
    "open_questions": []
  },
  "clean": {
    "schema_version": 1, "feature": "clean", "title": "/clean project server step", "plan": "tc-authoring-clean",
    "sources": [
      { "id": "REQ.clean-missed", "kind": "requirement", "locator": "cc-baseline .cc-audits/HANDOFF-next.md: /clean missed the grimbang next-server (2026-11-19)" },
      { "id": "SRC.clean-md", "kind": "source", "locator": "templates/commands/clean.md project server step (commit d6ae49e)" }
    ],
    "actions": [
      { "id": "ACT.clean.project-servers", "title": "Stop the project's dev servers", "actor": "orchestrator", "trigger": "runs the /clean project server step from inside a git project", "preconditions": ["servers listening on TCP"], "outputs": ["Stopping project server lines", "stopped processes"], "evidence_refs": ["SRC.clean-md", "REQ.clean-missed"] }
    ],
    "test_cases": [
      { "id": "TC.clean.paren-title-server-stopped", "title": "A project server whose process name has parentheses is stopped", "action_refs": ["ACT.clean.project-servers"], "level": "functional", "surface": "cli",
        "preconditions": ["a test git project", "a server started in it whose process title is 'srv (v1'"],
        "steps": [{ "goal": "Run the /clean project server step from the project", "done_when": { "expect": "The step prints that cleanup is complete" } }],
        "expected": [{ "text": "Nothing listens on that server's port any more", "observe": { "channel": "env", "key": "listening TCP ports" } }],
        "basis": { "kind": "requirement", "refs": ["REQ.clean-missed"] }, "readiness": "ready" },
      { "id": "TC.clean.outside-server-kept", "title": "A server started outside the project keeps running", "action_refs": ["ACT.clean.project-servers"], "level": "functional", "surface": "cli",
        "preconditions": ["a test git project", "a server started in another directory whose process title is 'srv (v1'"],
        "steps": [{ "goal": "Run the /clean project server step from the project", "done_when": { "expect": "The step prints that cleanup is complete" } }],
        "expected": [{ "text": "The outside server still listens on its port", "observe": { "channel": "env", "key": "listening TCP ports" } }],
        "basis": { "kind": "requirement", "refs": ["REQ.clean-missed"] }, "readiness": "ready" }
    ],
    "open_questions": []
  }
}
```

## 실행 순서

1. `Read ~/.claude/memory/phase_start.md and execute`
2. TC 파일 두 개와 `.cc-audits/tc-authoring-clean/tc-run.json`을 쓰고 검사한다. 대상 파일의 `git log -3`도 확인한다.
3. `tc-lint.js` 규칙과 테스트를 추가한다. 기존 TC 파일 전체에 돌려 새 경고 수를 기록한다.
4. `clean.md`를 고치고 실제 동작 테스트를 추가한다. 이 서버에서 grimbang 개발 서버를 띄운 뒤 고친 단계로 꺼지는지도 확인한다.
5. 지침을 고치고, `npm test` 전부 통과, `node bin/cli.js --yes`
6. security-auditor와 code-reviewer를 병렬로 실행하고 반영한다(Security Unknown, Code Quality Yes).
7. CHANGELOG와 인계 문서를 갱신한다. 커밋하고 develop에 푸시한다.
8. `Read ~/.claude/memory/phase_end.md and execute`

## E2E

- 새 TC 5개(cli, ready)는 `test/run.js`가 실행한다.
  - tc-lint: CLI 출력
  - clean: 실제 프로세스와 포트, Linux에서만, `ss` 필요
- 실제 확인은 4단계(grimbang 개발 서버를 고친 `/clean`으로 정리)다.
- `tc-run.json`: 적을 `base_url`과 계정이 없다.

## 위험

- **lint 휴리스틱:** 새 탭으로 같은 화면을 다시 확인하는 정상 TC(예: `beta-label-ko`)도 경고가 난다. 경고일 뿐이라 이유를 붙여 남긴다.
- **`/clean` 범위:** `ss`로 PID가 늘어나도 cwd와 이름 조건은 그대로라 더 많은 종류를 죽이지는 않는다. 그동안 lsof가 놓치던 프로젝트 서버만 새로 잡힌다.

## ✅ Checklist

- [ ] TC 5개, 검사
- [ ] `judged_after_last`와 `done_when` 재활성 경고, 기존 TC 파일 영향 기록
- [ ] `/clean`에 `ss` 보완, 실제 동작 테스트, grimbang 확인
- [ ] 지침, `npm test`, 설치, 감사 두 가지, CHANGELOG, 커밋, 푸시

## 실행 기록 (2026-11-20)
- **/clean 원인:** lsof 4.93.2는 이름에 괄호가 있는 프로세스(`next-server (v16.4.6)`)를 나열하지 않는다. `ss -ltnpH`로 PID를 보완하고, cwd는 `/proc/<pid>/cwd`로 보완했다. grimbang 개발 서버로 실제 확인했다(운영 컨테이너 `/app`은 그대로).
- **lint 영향:**
  - grimbang `generation-guard`에서 경고 4개가 새로 나온다(`done_when` 3, `judged_after_last` 1). `beta-label-ko`는 새 탭 뒤 화면 확인이 의도라 경고를 그대로 둔다.
  - 샘플 앱에서 처음 나온 오탐 4건(오류 흐름의 "버튼 다시 활성")은 오류 흐름을 빼는 것으로 없앴다.
  - 남은 한계: 기대 결과에 "No …"가 들어간 오류 흐름(`fail-reason-shown`)은 부정어로 읽혀 경고가 남는다.

## Audit History
- iter-1: 2026-11-20 / critical=0 high=0 medium=1 low=2 / next_action=self_fix → 반영
  - SEC-001: 프로젝트 서버 단계도 실행 중인 셸의 조상은 건너뛴다(고아 단계와 같은 `ANC`).
  - SEC-002: 같은 uid가 소유한 프로세스만 대상으로 한다.
  - SEC-003: 프로젝트 안 cwd의 리스너를 정리하는 것은 규칙 7의 의도라 그대로 둔다.

## Code Review History
- code-review-iter-1: 2026-11-20 / critical=0 high=0 medium=0 low=2 / profile_status=cached / next_action=done
  - QA-001(business): 범위를 좁혀 결정할 것이 남지 않게 했다. "Refresh 버튼 클릭"은 새로고침으로 보지 않고, 새로고침은 "the page/screen"을 함께 쓸 때만 본다.
  - QA-002: "버튼"이 들어간 문장에서만 재활성 표현을 본다.
