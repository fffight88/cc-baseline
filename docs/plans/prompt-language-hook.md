# 질문마다 답 언어 알림 — `UserPromptSubmit` 훅

사용자 언어로 답하라는 규칙(규칙 1)은 세션을 시작할 때 한 번만 읽힌다. 긴 세션에서는 그 규칙이 맥락 앞쪽으로 밀려나고, 최근 맥락(영어 템플릿, 코드, 에이전트 보고)에 끌려 답이 영어로 쏠린다. 2026-11-27 이 세션에서 실제로 두 번 일어났다. 이 플랜은 질문이 들어올 때마다 "이 질문의 언어로 답한다"는 한 줄을 맥락 바로 앞에 넣는 훅을 추가한다.

## ⚡ Key Rules Summary

| ✅ DO | ❌ DON'T |
|---|---|
| 질문 글자에서 언어를 정한다: 한글이 하나라도 있으면 한국어, 그다음 일본어 가나, 한자, 라틴 문자 순 | 질문 내용을 해석하거나 저장하기 |
| 언어를 정할 수 없거나 입력이 깨졌으면 "사용자가 쓰는 언어로 답한다"는 일반 문장을 넣는다 | 훅이 실패해서 질문이 막히거나 늦어지기 |
| 항상 exit 0, 출력은 `additionalContext` 한 줄뿐이다 | 파일·네트워크 접근, 질문을 셸에 넘기기 |
| 전역 템플릿과 프로젝트 템플릿에 같은 동작으로 넣는다 | 한쪽 설치 방식에만 넣기 |

## Meta
- Security Impact: No
- Code Quality Impact: Yes
- UI Impact: No
- Behavior Impact: Yes
- Claim Impact: No
- Reason: 질문마다 도는 훅 하나가 추가된다(stdin JSON만 읽고 문장 하나를 출력, 파일·네트워크·셸 전달 없음). 모든 세션의 답 언어 동작이 바뀐다.

---

## Context

- **문제:** 세션 시작 훅(`session-start-load-rules`)이 규칙을 넣지만, 질문마다 도는 훅은 없다. 설치된 훅은 SessionStart, PreToolUse 두 개, SessionEnd뿐이다.
- **방향:** 사용자가 정했다(질문마다 언어 규칙을 다시 넣는 훅). 그래서 규칙 13(천재적 사고)은 적용하지 않는다.
- **재사용:**
  - `src/merge/settings-hooks.js`의 `mergeHooks`는 이벤트 이름과 관계없이 `_ccBaselineId`로 병합하고 중복을 정리한다.
  - `src/doctor.js`는 템플릿에 있는 ID를 기준으로 등록 여부를 확인하므로 새 ID가 자동으로 포함된다.
  - 기존 훅과 같은 방식(`python3 -c` 인라인)을 쓴다.

---

## 설계

### 1. 훅 — `templates/settings-hooks.json` (`UserPromptSubmit`, `_ccBaselineId: user-prompt-submit-language`)
```python
import json, sys, re
try:
    data = json.load(sys.stdin)
except Exception:
    data = {}
p = str((data or {}).get('prompt') or '') if isinstance(data, dict) else ''
lang = None
if re.search('[가-힣ㄱ-ㆎ]', p): lang = 'Korean'
elif re.search('[぀-ヿ]', p): lang = 'Japanese'
elif re.search('[一-鿿]', p): lang = 'Chinese'
elif re.search('[A-Za-z]', p): lang = 'English'
msg = (f'cc-baseline rule 1: write your whole reply in {lang}, the language of the user message above, '
       'even when the files, tools and agent reports around it are in another language. '
       'Code, identifiers and quoted text may stay as they are.') if lang else \
      'cc-baseline rule 1: reply in the language the user writes in.'
print(json.dumps({'hookSpecificOutput': {'hookEventName': 'UserPromptSubmit', 'additionalContext': msg}}))
```
- 한글을 가장 먼저 본다. 영어 로그를 붙여 넣고 한국어로 한 줄 물어도 한국어가 된다.
- `statusMessage`는 두지 않는다. 질문마다 상태 문구가 깜빡이지 않게 하기 위해서다.

### 2. 프로젝트 템플릿 — `templates/settings-hooks.project.json`
- 같은 명령을 `_ccBaselineId: project-user-prompt-submit-language`로 넣는다.

### 3. 문서
- `templates/memory/all_session_basic_rules.md` 규칙 1에 한 줄: "질문마다 `UserPromptSubmit` 훅이 이 규칙과 질문 언어를 다시 넣는다. 답 전체를 그 언어로 쓴다."
- `README.md`·`README_KO.md`의 Hook config 행, `docs/install-details.md`의 hooks 설명, `CHANGELOG.md [Unreleased]`.

---

## Phase A — 훅·테스트·문서

1. Read ~/.claude/memory/phase_start.md and execute
2. 승인 직후: 아래 TC 초안을 `docs/tc/prompt-language.tc.json`으로, 플랜을 `docs/plans/prompt-language-hook.md`로 쓴다. 검사 두 개를 다시 돌린다(`.cc-audits/prompt-language-hook/tc-check.json`).
3. `git log -3`으로 두 훅 템플릿과 규칙 파일의 최근 변경을 확인한다(규칙 8).
4. 두 템플릿에 훅을 넣는다.
5. `test/run.js`: 템플릿에서 명령을 꺼내 stdin을 주고 실행하는 테스트(한국어, 영어, 섞인 입력, 깨진 입력, 프로젝트 템플릿), 그리고 임시 HOME에 두 번 설치해 하나만 등록되고 doctor가 통과하는 테스트.
6. 문서를 고친다.
7. `npm test`
8. Read ~/.claude/memory/phase_end.md and execute

## Phase B — 리뷰·설치·푸시

1. Read ~/.claude/memory/phase_start.md and execute
2. code-reviewer를 돌리고(Security Impact: No라 security-auditor는 건너뜀) 지적 사항을 반영한다.
3. 커밋(`.claude/` 제외), develop 푸시, `node bin/cli.js --yes`로 이 서버에 설치, doctor 확인.
4. 새 질문에서 훅이 실제로 도는지 확인한다(설치 뒤 세션의 다음 질문에 알림 문장이 들어오는지).
5. 메모리와 HANDOFF를 갱신한다.
6. Read ~/.claude/memory/phase_end.md and execute

---

## Test Cases (draft)

cc-baseline 자체의 TC(`surface: cli`)다. 승인 직후 `docs/tc/prompt-language.tc.json`으로 쓴다. 기대 결과는 모두 종료 코드·출력 JSON·파일 내용으로 확인한다(`artifact` 채널, 코드 판정).

| TC ID | 제목 | surface | readiness | 기대 결과 수 |
|---|---|---|---|---|
| TC.prompt-language.korean | 한국어 질문이면 한국어로 답하라고 넣는다 | cli | ready | 1 |
| TC.prompt-language.english | 영어 질문이면 영어로 답하라고 넣는다 | cli | ready | 1 |
| TC.prompt-language.mixed | 영어를 붙여 넣고 한국어로 물으면 한국어다 | cli | ready | 1 |
| TC.prompt-language.bad-input | 깨진 입력에도 질문을 막지 않는다 | cli | ready | 2 |
| TC.prompt-language.install | 두 번 설치해도 훅은 하나이고 doctor가 통과한다 | cli | ready | 2 |
| TC.prompt-language.project | 프로젝트 템플릿도 같은 훅을 가진다 | cli | ready | 1 |

검사 요약 (표준 입력): `tc-lint` 6 TC 경고 0건, `tc-jev-check`(jev-1.14.0, 8문장) 경고 0건. 열린 질문은 없다(방향은 사용자가 2026-11-27에 정함).

```json
{
 "schema_version": 1,
 "feature": "prompt-language",
 "title": "Reply-language reminder on every prompt (UserPromptSubmit hook)",
 "plan": "prompt-language-hook",
 "sources": [
  {"id": "REQ.prompt-language-plan", "kind": "requirement", "locator": "docs/plans/prompt-language-hook.md (approved 2026-11-27)"},
  {"id": "REQ.reply-in-korean", "kind": "requirement", "locator": "user report 2026-11-27: replies drifted to English twice in a long session although CLAUDE.md and the session-start hook say to answer in the user's language"}
 ],
 "actions": [
  {"id": "ACT.prompt-language.hook", "title": "The hook runs on a submitted prompt", "actor": "Claude Code", "trigger": "the user submits a prompt", "preconditions": ["cc-baseline is installed"], "outputs": ["one additionalContext line naming the reply language"], "evidence_refs": ["REQ.prompt-language-plan", "REQ.reply-in-korean"]},
  {"id": "ACT.prompt-language.install", "title": "Install registers the hook", "actor": "user", "trigger": "runs node bin/cli.js --yes", "preconditions": ["a settings.json with or without hooks"], "outputs": ["UserPromptSubmit entry in settings.json", "doctor result"], "evidence_refs": ["REQ.prompt-language-plan"]}
 ],
 "test_cases": [
  {"id": "TC.prompt-language.korean", "title": "A Korean prompt asks for a Korean reply", "action_refs": ["ACT.prompt-language.hook"], "level": "functional", "surface": "cli", "preconditions": ["stdin is {\"prompt\": \"진행해\"}"], "steps": [{"goal": "Run the hook command of templates/settings-hooks.json with that stdin", "done_when": {"expect": "The command exits"}}], "expected": [{"text": "The additionalContext names Korean as the reply language", "observe": {"channel": "artifact", "key": "stdout JSON .hookSpecificOutput.additionalContext"}}], "basis": {"kind": "requirement", "refs": ["REQ.reply-in-korean"]}, "readiness": "ready"},
  {"id": "TC.prompt-language.english", "title": "An English prompt asks for an English reply", "action_refs": ["ACT.prompt-language.hook"], "level": "functional", "surface": "cli", "preconditions": ["stdin is {\"prompt\": \"Run the tests again\"}"], "steps": [{"goal": "Run the hook command with that stdin", "done_when": {"expect": "The command exits"}}], "expected": [{"text": "The additionalContext names English as the reply language", "observe": {"channel": "artifact", "key": "stdout JSON .hookSpecificOutput.additionalContext"}}], "basis": {"kind": "requirement", "refs": ["REQ.prompt-language-plan"]}, "readiness": "ready"},
  {"id": "TC.prompt-language.mixed", "title": "Pasted English with a Korean request asks for Korean", "action_refs": ["ACT.prompt-language.hook"], "level": "functional", "surface": "cli", "preconditions": ["stdin prompt is a long English log followed by the line '이거 왜 실패했어?'"], "steps": [{"goal": "Run the hook command with that stdin", "done_when": {"expect": "The command exits"}}], "expected": [{"text": "The additionalContext names Korean as the reply language", "observe": {"channel": "artifact", "key": "stdout JSON .hookSpecificOutput.additionalContext"}}], "basis": {"kind": "requirement", "refs": ["REQ.reply-in-korean"]}, "readiness": "ready"},
  {"id": "TC.prompt-language.bad-input", "title": "Unreadable input never blocks the prompt", "action_refs": ["ACT.prompt-language.hook"], "level": "functional", "surface": "cli", "preconditions": ["stdin is the text 'not json'"], "steps": [{"goal": "Run the hook command with that stdin", "done_when": {"expect": "The command exits"}}], "expected": [{"text": "The exit code is 0", "observe": {"channel": "artifact", "key": "exit code"}}, {"text": "The additionalContext says to reply in the language the user writes in", "observe": {"channel": "artifact", "key": "stdout JSON .hookSpecificOutput.additionalContext"}}], "basis": {"kind": "requirement", "refs": ["REQ.prompt-language-plan"]}, "readiness": "ready"},
  {"id": "TC.prompt-language.install", "title": "Install registers the hook once", "action_refs": ["ACT.prompt-language.install"], "level": "functional", "surface": "cli", "preconditions": ["a temporary HOME with an empty settings.json"], "steps": [{"goal": "Run the installer twice into that HOME", "done_when": {"expect": "Both runs exit"}}], "expected": [{"text": "settings.json has exactly one hook with _ccBaselineId user-prompt-submit-language", "observe": {"channel": "artifact", "key": "settings.json .hooks.UserPromptSubmit"}}, {"text": "doctor reports every managed hook as registered", "observe": {"channel": "artifact", "key": "runChecks result for hooks"}}], "basis": {"kind": "requirement", "refs": ["REQ.prompt-language-plan"]}, "readiness": "ready"},
  {"id": "TC.prompt-language.project", "title": "The project template carries the same hook", "action_refs": ["ACT.prompt-language.install"], "level": "functional", "surface": "cli", "preconditions": ["templates/settings-hooks.project.json"], "steps": [{"goal": "Run the project template's UserPromptSubmit command with a Korean prompt", "done_when": {"expect": "The command exits"}}], "expected": [{"text": "The additionalContext names Korean as the reply language", "observe": {"channel": "artifact", "key": "stdout JSON .hookSpecificOutput.additionalContext"}}], "basis": {"kind": "requirement", "refs": ["REQ.prompt-language-plan"]}, "readiness": "ready"}
 ],
 "open_questions": []
}
```

## E2E

- 화면이 없다. 위 TC 6개는 `npm test`(템플릿 명령 실행, 임시 HOME 설치)로 대응해서 확인한다.
- 실제 동작은 Phase B 4단계에서 확인한다. 설치 뒤 새 질문을 보냈을 때 알림 문장이 맥락에 들어오는지 본다.

## 검증

- `npm test` 전부 통과(기존 217 + 새 테스트), wiki 테스트 21 통과.
- `node bin/cli.js --doctor`에서 관리 훅이 모두 등록됐다고 나온다(새 ID 포함).
- 훅 실행 시간이 짧다(python3 시작 한 번, 파일·네트워크 없음).

## ✅ Checklist

- [ ] TC 초안을 승인 직후 파일로 쓰고 다시 검사했다
- [ ] 전역·프로젝트 템플릿 모두에 훅이 있고 `_ccBaselineId`가 붙었다
- [ ] 한국어·영어·섞인 입력·깨진 입력이 기대대로 나오고, 항상 exit 0이다
- [ ] 두 번 설치해도 훅은 하나이고 doctor가 통과한다
- [ ] 규칙 1·README·install-details·CHANGELOG를 고쳤다
- [ ] 코드 리뷰를 반영했다
- [ ] 설치 뒤 실제 질문에서 알림이 들어오는 것을 확인했다

## 구현 중 바뀐 것
- 플랜의 "doctor는 템플릿 ID로 자동 확인" 가정이 틀렸다. `src/doctor.js`에 기대 ID 목록(`EXPECTED_HOOK_IDS`, `PROJECT_EXPECTED_HOOK_IDS`)이 고정돼 있어서 두 목록에 새 ID를 넣었다.
- 훅 이벤트 목록과 개수를 고정한 기존 테스트 두 개(`mergeHooks: empty existing`, `removeHarnessHooks: removes by ID`)를 새 훅에 맞게 고쳤다.
- 코드 리뷰 iter-1(2026-11-27): critical·high·medium 0, low 3.
  - QA-001 한자만 있는 일본어 질문은 중국어로 본다. 가나가 한 글자라도 있으면 일본어다. 한계로 둔다.
  - QA-002 프로젝트 설치를 두 번 하고 doctor와 제거까지 확인하는 테스트를 추가했다.
  - QA-003 실제 명령은 설계의 코드와 같은 동작이지만 형태가 조금 다르다(f-string 대신 문자열 더하기, 셸 큰따옴표 안이라 `"` 없음). 기준은 `templates/settings-hooks.json`이다.
