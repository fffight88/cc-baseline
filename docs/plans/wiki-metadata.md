# 화면·기능 위키 메타데이터 (`docs/wiki/`)

cc-baseline을 쓰는 프로젝트에 **화면·기능 단위의 지도**를 둔다. 이미 구현된 화면이 어느 route에 있는지, 어떤 파일·컴포넌트·API·상태로 되어 있는지, 어떤 화면과 이어지는지를 `docs/wiki/`에 메타데이터로 남긴다. `/plan`과 publisher는 코드를 Grep으로 다시 훑기 전에 이 위키부터 읽는다. 해시 계산, stale 판정, index 생성, 검색은 새 스크립트 `wiki.js`가 코드로 하고, 본문은 오케스트레이터(메인 세션)가 쓴다.

## ⚡ Key Rules Summary

| ✅ DO | ❌ DON'T |
|---|---|
| 기존 구현을 찾을 때는 `wiki.js find`부터 쓰고, 부족할 때만 Grep한다 | 위키가 있는데 처음부터 코드 전체를 Grep하기 |
| stale 문서는 참고하기 **전에** 그 문서만 갱신하고 `stamp`한다 | stale 문서의 메타데이터를 그대로 믿기 |
| 본문과 메타데이터는 오케스트레이터가 쓴다(phase_end, `/wiki update`) | publisher·e2e-tester가 위키를 고치기 |
| 해시·index·상태 판정은 `wiki.js`에 맡긴다 | `source_hash`나 `index.md`를 손으로 쓰기 |
| 컴포넌트는 이름만 적는다. 정의는 `design-profile.md`에 둔다 | 위키에 컴포넌트 정의·토큰을 복사하기 |
| 위키는 `docs/wiki/`에 두고 커밋한다 | `.cc-audits/`(커밋 안 함)에 두기 |
| 위키가 없으면 `/plan`은 `/wiki init`을 한 줄로 제안만 한다 | 사용자 확인 없이 전체 스캔으로 위키 만들기 |
| `files`는 프로젝트 안 상대 경로만 받는다 | 루트 밖 경로·심볼릭 링크로 빠져나가는 경로 허용 |

## Meta
- Security Impact: Yes
- Code Quality Impact: Yes
- UI Impact: No
- Behavior Impact: Yes
- Reason: 새 스크립트가 프로젝트 파일을 읽어 해시하고 `docs/wiki/`에 쓴다(경로 검사 필요). `/plan`·phase_end·publisher의 참고 흐름과 새 `/wiki` 명령이 사용자가 보는 동작을 바꾼다.

---

## Context

- 지금 cc-baseline에는 프로젝트 전체 단위의 캐시만 있다.
  - `design-profile.md` (publisher): 토큰, 컴포넌트 목록
  - `project-patterns.md` (code-reviewer): 코딩 규칙
- **화면·기능 단위의 지도는 없다.** 그래서 publisher는 Step 2에서 참고 화면을 git log와 디렉터리 거리로 고르고, `/plan`은 기존 구현을 매번 Grep/Glob로 찾는다. 화면이 늘수록 탐색 비용이 커지고, 이미 만든 걸 놓쳐서 비슷한 화면을 새로 만들 위험도 커진다.
- 계기: 사용자가 inkeep/open-knowledge의 "LLM 위키"를 검토했다(2026-11-18). GPL-3.0(cc-baseline은 MIT)이고 Node 24 이상이 필요하며 에디터 앱이라서, 도구는 들이지 않고 방식만 가져오기로 했다. 위키는 그냥 마크다운 폴더라서, 원하는 사람은 그 에디터로 열어 볼 수 있다.
- 사용자 결정(2026-11-18):
  - 본문은 오케스트레이터가 쓴다.
  - 기존 프로젝트는 `/wiki init`을 수동으로 실행해 만든다. 위키가 없으면 `/plan`이 제안한다.
  - stale 문서는 참고하기 전에 갱신한다.

### 범위 밖

- 화면 목록 자동 추출(프레임워크별 router 파서). `/wiki init`은 LLM이 route와 페이지를 읽고 쓴다.
- 임베딩, 벡터 검색, MCP 서버. 검색은 frontmatter 필드 매칭과 Grep으로 한다.
- code-reviewer·security-auditor의 위키 검사.

---

## 설계

### 1. 파일 구조

```
docs/wiki/
  index.md               # wiki.js index가 생성 (직접 수정 금지 표시)
  screens/<slug>.md      # 화면 1개 = 문서 1개
  features/<slug>.md     # 여러 화면에 걸친 기능
```

**frontmatter**: YAML의 작은 부분집합만 쓴다. `key: value`와 `key: [a, b]` 형식이고, 의존성 없이 파싱한다.

| 키 | screen | feature | 내용 |
|---|---|---|---|
| `kind` | 필수 | 필수 | `screen` 또는 `feature` |
| `slug` | 필수 | 필수 | kebab-case, 파일 이름과 같음 |
| `title` | 필수 | 필수 | 한 줄 |
| `route` | 필수 | — | 예: `/admin/orders/:id`. 라우트가 없는 화면(모달 등)은 `none` |
| `files` | 필수 | 선택 | 프로젝트 루트 기준 상대 경로 |
| `components` | 선택 | — | `design-profile.md` 컴포넌트 목록의 이름 |
| `apis` | 선택 | 선택 | `METHOD /path` |
| `states` | 선택 | — | 예: `loading, empty, error` |
| `links_to` | 선택 | — | 이동할 수 있는 화면의 slug |
| `screens` | — | 필수 | 이 기능에 속한 화면의 slug |
| `tc` | 선택 | 선택 | `docs/tc/<feature>.tc.json` |
| `source_hash` | `stamp`가 씀 | `stamp`가 씀 | `files` 내용의 해시 |
| `stamped_at` | `stamp`가 씀 | `stamp`가 씀 | ISO8601 |

**본문**은 사람과 LLM이 읽는 메모다. 정해진 절은 `## 역할`, `## 구성`, `## 주의`이고 짧게 쓴다.

**해시**: `files`를 정렬한 뒤, 각 파일에 대해 `경로 \0 sha256(내용, CRLF→LF)` 줄을 만들고, 이 줄들을 다시 sha256해서 앞 16자를 쓴다.

### 2. `templates/scripts/wiki.js` (런타임 의존성 0)

공통 사항:
- `--root <dir>` 옵션을 받고, 없으면 cwd를 쓴다. 위키 경로는 `<root>/docs/wiki`로 고정한다.
- `jev-client.js`의 `parseArgs`를 재사용한다.
- 종료 코드: 0 = 성공, 1 = 오류, 2 = 거부/사용법 오류

| 명령 | 하는 일 | 거부(종료 코드 2) |
|---|---|---|
| `check [--json] [--strict]` | 문서마다 상태를 출력: `ok` · `stale`(해시 불일치) · `unstamped` · `broken`(없는 파일 또는 없는 `links_to`/`screens` slug) · `invalid`(필수 키 누락, slug와 파일 이름 불일치). `--strict`이면 `ok`가 아닌 문서가 하나라도 있을 때 종료 코드 1 | 위키 디렉터리가 심볼릭 링크 |
| `stamp <slug>…` | `source_hash`·`stamped_at`만 다시 쓴다. 본문과 다른 키는 그대로 둔다 | `files`가 루트 밖이거나 존재하지 않음, `invalid` 문서, 대상이 심볼릭 링크 |
| `index` | frontmatter로 `index.md`를 다시 만든다. 화면 표(slug · title · route · 상태)와 기능 표(slug · title · screens)를 쓴다 | 위키 디렉터리 또는 `index.md`가 심볼릭 링크 |
| `find <term> [--json]` | slug·title·route·files·components·apis·states를 대소문자 구분 없이 부분 일치로 찾는다. 결과마다 맞은 필드와 상태를 함께 낸다 | 검색어가 비어 있음 |

**쓰기 범위:**
- 쓰는 파일은 `docs/wiki/` 아래 `.md`뿐이다. 임시 파일에 쓰고 rename하는 방식(`wx`, 무작위 이름)을 쓴다.
- 경로 검사는 `realpath`로 루트 안인지 확인한다. `tc-fix-loop.js`·`tc-api-run.js`와 같은 방식이다.

### 3. `/wiki` 명령 — `templates/commands/wiki.md`

- **`/wiki init`**
  1. route 정의와 페이지 디렉터리를 읽어 화면 목록 초안을 사용자에게 보여 준다(문서 수와 예상 범위).
  2. 사용자가 확인하면 화면과 기능 문서를 쓴다. 컴포넌트 이름은 `design-profile.md`가 있으면 그 목록을 따른다.
  3. `wiki.js stamp`로 모든 문서를 stamp하고 `wiki.js index`를 실행한다.
  4. 마지막에 `check --strict`가 통과해야 한다.
- **`/wiki update [slug…]`**: slug가 없으면 `check`에서 `ok`가 아닌 문서를 대상으로 한다. 코드를 다시 읽어 메타데이터와 본문을 고치고, `stamp`와 `index`를 실행한다.
- **`/wiki check`**: `wiki.js check` 결과를 요약한다.

### 4. 지침과 연결

- **새 `templates/memory/reference_wiki.md`** (Key Rules, 형식, 누가 언제 쓰는지, stale 처리, Checklist)
  - 쓰는 주체: 오케스트레이터만
  - 쓰는 시점: phase_end, `/wiki update`
  - 참고 시점: `/plan` 시작, publisher 호출 전 브리핑
- **`commands/plan.md`**
  - 위키가 있으면 계획을 쓰기 전에 `wiki.js find`로 관련 화면을 찾는다.
  - stale이면 그 문서를 먼저 갱신한다.
  - 계획의 Context에 "재사용할 화면·컴포넌트"를 적는다.
  - 위키가 없고 화면이 이미 있으면 `/wiki init`을 한 줄로 제안한다.
- **`phase_end.md`**: `docs/wiki/`가 있고 이번 phase에서 화면이나 기능이 바뀌었으면, 해당 문서를 쓰거나 고친 뒤 `stamp`·`index`를 실행하고 `check --strict`로 확인한다. 이 한 단계를 루프 앞에 추가한다.
- **`reference_publisher_protocol.md` §2.1**: 브리핑할 때 `reference_screens`와 `reuse_anchors`를 위키에서 채운다(`find`로 비슷한 route나 컴포넌트를 쓰는 화면). stale이면 먼저 갱신한다.
- **`publisher.md` Step 2**: 자동 선택 순서에 "브리핑이 비었고 `docs/wiki/`가 있으면 `wiki.js find`로 고른다"를 git log 휴리스틱 앞에 넣는다. stale 문서는 메타데이터를 믿지 않고 해당 파일을 직접 읽는다. publisher는 위키에 쓰지 않는다.
- **`reference_agent_pipeline.md` §3 중복 방지 표**: "화면·기능 지도 = 오케스트레이터 / `docs/wiki/`, 컴포넌트 정의 = publisher / `design-profile.md`" 줄을 추가한다.
- **`manifest.json`**: `scripts/wiki.js`, `commands/wiki.md`, `memory/reference_wiki.md`를 추가한다. `templates/memory/MEMORY.md`에 index 한 줄을 추가한다.
- README(en/ko), CHANGELOG, `docs/install-details.md`(ko 포함)에 짧게 반영한다.

---

## Phase A — `wiki.js`

1. Read ~/.claude/memory/phase_start.md and execute
2. 승인 직후 할 일:
   - 아래 TC 초안을 `docs/tc/wiki.tc.json`으로 그대로 쓴다.
   - 플랜을 `docs/plans/wiki-metadata.md`로 복사한다.
   - `tc-lint.js --json`과 `tc-jev-check.js --out .cc-audits/wiki-metadata/tc-check.json`을 다시 돌린다.
3. `templates/scripts/wiki.js`를 작성한다. `parseArgs`를 재사용하고, 경로 검사와 임시 파일 쓰기는 `tc-fix-loop.js`의 방식을 따른다.
4. `test/run.js`에 단위 테스트를 추가한다. 아래 TC 11개에 대응하는 것과, frontmatter 파서 경계(따옴표, 빈 배열, 중복 키)를 다룬다.
5. `npm test`가 통과해야 한다.
6. Read ~/.claude/memory/phase_end.md and execute

## Phase B — 명령·지침·설치

1. Read ~/.claude/memory/phase_start.md and execute
2. `commands/wiki.md`와 `memory/reference_wiki.md`를 작성한다.
3. `plan.md`, `phase_end.md`, `reference_publisher_protocol.md`, `publisher.md` Step 2, `reference_agent_pipeline.md`에 위 §4 내용을 반영한다. 수정하기 전에 각 파일의 `git log -3`을 확인한다.
4. `manifest.json`, `MEMORY.md` 템플릿, README(en/ko), CHANGELOG, install-details(en/ko)를 갱신한다.
5. `node bin/cli.js --yes`로 이 서버에 설치하고, `--doctor`가 정상인지와 `~/.claude/scripts/wiki.js`, `~/.claude/commands/wiki.md`가 설치됐는지 확인한다.
6. Read ~/.claude/memory/phase_end.md and execute

## Phase C — 샘플 앱 검증 (레포 밖)

1. Read ~/.claude/memory/phase_start.md and execute
2. `/home/workspace/tc-sample-app`에서 브랜치 `wiki-trial`을 만든다. main은 건드리지 않고, 커밋하지 않은 변경이 있으면 먼저 확인한다.
3. `/wiki init`을 실행한다. 화면 문서와 기능 문서(주문 취소·환불 등)를 만들고 `check --strict`가 통과하는지 확인한다.
4. 화면 파일 하나를 고친 뒤 다음을 확인한다.
   - `check`에서 그 문서만 `stale`이 된다.
   - `/plan`이 그 문서를 먼저 갱신한다.
5. **효과 측정.** 같은 질문("주문 상세 화면과 취소 API, 쓰는 컴포넌트, 연결된 화면을 찾아라")을 위키가 없는 상태와 있는 상태에서 Explore 에이전트로 한 번씩 돌린다. 도구 호출 수, 토큰, 시간, 답의 정확도를 비교한다.
   - 정답 기준은 사람이 코드를 보고 미리 적어 둔다.
   - 한 번씩 돌린 결과라서 통계적 의미는 없다. 이 점을 결과에 적는다.
6. 결과를 이 플랜 아래 "Phase C 결과"에 적는다. `/clean`을 실행한다.
7. Read ~/.claude/memory/phase_end.md and execute

## Phase D — 게이트·푸시

1. Read ~/.claude/memory/phase_start.md and execute
2. security-auditor와 code-reviewer를 병렬로 돌리고, 지적 사항을 반영한다.
3. 커밋한다(`.claude/` 제외 규칙). 푸시는 사용자 확인 뒤에 한다.
4. 프로젝트 메모리를 갱신한다.
5. Read ~/.claude/memory/phase_end.md and execute

---

## Test Cases (draft)

cc-baseline 자체의 TC(`surface: cli`)다. 승인 직후 `docs/tc/wiki.tc.json`으로 쓴다. 기대 결과는 모두 종료 코드, 출력 JSON, 파일 내용으로 확인한다(`artifact` 채널, 코드 판정).

| TC ID | 제목 | surface | readiness | 기대 결과 수 |
|---|---|---|---|---|
| TC.wiki.check-ok | stamp 직후 문서는 ok | cli | ready | 1 |
| TC.wiki.check-stale | 나열된 파일이 바뀌면 stale | cli | ready | 2 |
| TC.wiki.check-missing-file | 나열된 파일이 없으면 broken | cli | ready | 2 |
| TC.wiki.check-broken-link | 없는 slug로의 links_to는 broken | cli | ready | 1 |
| TC.wiki.check-invalid | kind가 없으면 invalid | cli | ready | 1 |
| TC.wiki.strict-exit | --strict는 ok가 아닌 문서가 있으면 1로 끝난다 | cli | ready | 1 |
| TC.wiki.stamp-refreshes | stamp 뒤 stale 문서가 ok로 돌아온다 | cli | ready | 2 |
| TC.wiki.stamp-outside-root | 루트 밖 파일을 나열한 문서의 stamp는 거부된다 | cli | ready | 2 |
| TC.wiki.index-lists-pages | index.md에 모든 화면이 상태와 함께 나온다 | cli | ready | 2 |
| TC.wiki.find-component | 컴포넌트 이름으로 그 컴포넌트를 쓰는 화면을 찾는다 | cli | ready | 2 |
| TC.wiki.symlink-wiki-refused | docs/wiki가 심볼릭 링크면 index는 거부된다 | cli | ready | 2 |

검사 요약 (표준 입력):
- `tc-lint`: 11 TC, 경고 0건.
- `tc-jev-check` (jev-1.14.0, 18개 문장): 경고 1건(`jev_screen`, `TC.wiki.check-missing-file` expected[1]). 그대로 둔다. 이 결과는 화면이 아니라 `artifact` 채널(stdout JSON의 `problems`)로 코드가 판정하므로, 화면만으로 판정할 수 없다는 경고는 해당하지 않는다.

열린 질문은 없다. 쓰는 주체, 첫 생성 방식, stale 처리는 사용자가 2026-11-18에 정했다.

```json
{
  "schema_version": 1,
  "feature": "wiki",
  "title": "Screen and feature wiki metadata",
  "plan": "wiki-metadata",
  "sources": [
    { "id": "REQ.wiki-plan", "kind": "requirement", "locator": "docs/plans/wiki-metadata.md (approved 2026-11-18)" },
    { "id": "REQ.wiki-purpose", "kind": "requirement", "locator": "user request 2026-11-18: wiki metadata so implemented screens and features are referenced faster and more accurately" },
    { "id": "DEC.wiki-owner", "kind": "decision", "locator": "user decision 2026-11-18: orchestrator writes pages, /wiki init is manual with a /plan suggestion, stale pages are refreshed before use" }
  ],
  "actions": [
    { "id": "ACT.wiki.check", "title": "Check wiki page status", "actor": "orchestrator", "trigger": "runs wiki.js check", "preconditions": ["docs/wiki exists"], "outputs": ["status per page"], "evidence_refs": ["REQ.wiki-plan", "DEC.wiki-owner"] },
    { "id": "ACT.wiki.stamp", "title": "Stamp a page after updating it", "actor": "orchestrator", "trigger": "runs wiki.js stamp <slug>", "preconditions": ["the page lists its source files"], "outputs": ["source_hash and stamped_at in the page frontmatter"], "evidence_refs": ["REQ.wiki-plan"] },
    { "id": "ACT.wiki.index", "title": "Rebuild the wiki index", "actor": "orchestrator", "trigger": "runs wiki.js index", "preconditions": ["docs/wiki exists"], "outputs": ["docs/wiki/index.md"], "evidence_refs": ["REQ.wiki-plan"] },
    { "id": "ACT.wiki.find", "title": "Find pages for a term", "actor": "orchestrator", "trigger": "runs wiki.js find <term>", "preconditions": ["docs/wiki exists"], "outputs": ["matching pages with matched fields and status"], "evidence_refs": ["REQ.wiki-purpose"] }
  ],
  "test_cases": [
    { "id": "TC.wiki.check-ok", "title": "A page right after stamp is ok", "action_refs": ["ACT.wiki.check"], "level": "functional", "surface": "cli",
      "preconditions": ["screen page order-detail lists src/order-detail.js", "wiki.js stamp order-detail was run"],
      "steps": [{ "goal": "Run wiki.js check --json", "done_when": { "expect": "The command exits" } }],
      "expected": [
        { "text": "The status of order-detail is ok", "observe": { "channel": "artifact", "key": "stdout JSON .pages[order-detail].status" } }
      ], "basis": { "kind": "requirement", "refs": ["REQ.wiki-plan"] }, "readiness": "ready" },
    { "id": "TC.wiki.check-stale", "title": "A page is stale after a listed file changes", "action_refs": ["ACT.wiki.check"], "level": "functional", "surface": "cli",
      "preconditions": ["pages order-detail and order-list were stamped", "src/order-detail.js was edited afterwards"],
      "steps": [{ "goal": "Run wiki.js check --json", "done_when": { "expect": "The command exits" } }],
      "expected": [
        { "text": "The status of order-detail is stale", "observe": { "channel": "artifact", "key": "stdout JSON .pages[order-detail].status" } },
        { "text": "The status of order-list is ok", "observe": { "channel": "artifact", "key": "stdout JSON .pages[order-list].status" } }
      ], "basis": { "kind": "requirement", "refs": ["REQ.wiki-plan"] }, "readiness": "ready" },
    { "id": "TC.wiki.check-missing-file", "title": "A page is broken when a listed file is missing", "action_refs": ["ACT.wiki.check"], "level": "functional", "surface": "cli",
      "preconditions": ["page order-detail was stamped", "src/order-detail.js was deleted afterwards"],
      "steps": [{ "goal": "Run wiki.js check --json", "done_when": { "expect": "The command exits" } }],
      "expected": [
        { "text": "The status of order-detail is broken", "observe": { "channel": "artifact", "key": "stdout JSON .pages[order-detail].status" } },
        { "text": "The problems of order-detail name src/order-detail.js", "observe": { "channel": "artifact", "key": "stdout JSON .pages[order-detail].problems" } }
      ], "basis": { "kind": "requirement", "refs": ["REQ.wiki-plan"] }, "readiness": "ready" },
    { "id": "TC.wiki.check-broken-link", "title": "A links_to entry with no matching page makes the page broken", "action_refs": ["ACT.wiki.check"], "level": "functional", "surface": "cli",
      "preconditions": ["page order-list was stamped and has links_to [order-detail, refund-history]", "no page refund-history exists"],
      "steps": [{ "goal": "Run wiki.js check --json", "done_when": { "expect": "The command exits" } }],
      "expected": [
        { "text": "The status of order-list is broken", "observe": { "channel": "artifact", "key": "stdout JSON .pages[order-list].status" } }
      ], "basis": { "kind": "requirement", "refs": ["REQ.wiki-plan"] }, "readiness": "ready" },
    { "id": "TC.wiki.check-invalid", "title": "A page with no kind is invalid", "action_refs": ["ACT.wiki.check"], "level": "functional", "surface": "cli",
      "preconditions": ["page draft-screen has a frontmatter with no kind key"],
      "steps": [{ "goal": "Run wiki.js check --json", "done_when": { "expect": "The command exits" } }],
      "expected": [
        { "text": "The status of draft-screen is invalid", "observe": { "channel": "artifact", "key": "stdout JSON .pages[draft-screen].status" } }
      ], "basis": { "kind": "requirement", "refs": ["REQ.wiki-plan"] }, "readiness": "ready" },
    { "id": "TC.wiki.strict-exit", "title": "With --strict the check exits 1 when a page is not ok", "action_refs": ["ACT.wiki.check"], "level": "functional", "surface": "cli",
      "preconditions": ["one page is stale and the others are ok"],
      "steps": [{ "goal": "Run wiki.js check --strict", "done_when": { "expect": "The command exits" } }],
      "expected": [
        { "text": "The exit code is 1", "observe": { "channel": "artifact", "key": "exit code" } }
      ], "basis": { "kind": "requirement", "refs": ["REQ.wiki-plan"] }, "readiness": "ready" },
    { "id": "TC.wiki.stamp-refreshes", "title": "After stamp a stale page is ok again", "action_refs": ["ACT.wiki.stamp"], "level": "functional", "surface": "cli",
      "preconditions": ["page order-detail is stale", "the page body has a line 'note: keep this'"],
      "steps": [
        { "goal": "Run wiki.js stamp order-detail", "done_when": { "expect": "The command exits" } },
        { "goal": "Run wiki.js check --json", "done_when": { "expect": "The command exits" } }
      ],
      "expected": [
        { "text": "The status of order-detail is ok", "observe": { "channel": "artifact", "key": "stdout JSON .pages[order-detail].status" } },
        { "text": "The page body still has the line 'note: keep this'", "observe": { "channel": "artifact", "key": "docs/wiki/screens/order-detail.md body" } }
      ], "basis": { "kind": "requirement", "refs": ["REQ.wiki-plan", "DEC.wiki-owner"] }, "readiness": "ready" },
    { "id": "TC.wiki.stamp-outside-root", "title": "Stamping a page that lists a file outside the project is refused", "action_refs": ["ACT.wiki.stamp"], "level": "functional", "surface": "cli",
      "preconditions": ["page evil lists ../outside.js in files", "page evil has no source_hash"],
      "steps": [{ "goal": "Run wiki.js stamp evil", "done_when": { "expect": "The command exits" } }],
      "expected": [
        { "text": "The exit code is 2", "observe": { "channel": "artifact", "key": "exit code" } },
        { "text": "Page evil still has no source_hash", "observe": { "channel": "artifact", "key": "docs/wiki/screens/evil.md frontmatter" } }
      ], "basis": { "kind": "requirement", "refs": ["REQ.wiki-plan"] }, "readiness": "ready" },
    { "id": "TC.wiki.index-lists-pages", "title": "index.md lists every screen with its status", "action_refs": ["ACT.wiki.index"], "level": "functional", "surface": "cli",
      "preconditions": ["screen pages order-list (ok) and order-detail (stale) exist"],
      "steps": [{ "goal": "Run wiki.js index", "done_when": { "expect": "The command exits" } }],
      "expected": [
        { "text": "docs/wiki/index.md has a row for order-list with status ok", "observe": { "channel": "artifact", "key": "docs/wiki/index.md screens table" } },
        { "text": "docs/wiki/index.md has a row for order-detail with status stale", "observe": { "channel": "artifact", "key": "docs/wiki/index.md screens table" } }
      ], "basis": { "kind": "requirement", "refs": ["REQ.wiki-plan"] }, "readiness": "ready" },
    { "id": "TC.wiki.find-component", "title": "Searching a component name finds the screens that use it", "action_refs": ["ACT.wiki.find"], "level": "functional", "surface": "cli",
      "preconditions": ["order-list has components [DataTable, Pager]", "order-detail has components [StatusBadge]"],
      "steps": [{ "goal": "Run wiki.js find datatable --json", "done_when": { "expect": "The command exits" } }],
      "expected": [
        { "text": "The output results list holds order-list with matched field components", "observe": { "channel": "artifact", "key": "stdout JSON .results" } },
        { "text": "order-detail is not in the output results list", "observe": { "channel": "artifact", "key": "stdout JSON .results" } }
      ], "basis": { "kind": "requirement", "refs": ["REQ.wiki-purpose"] }, "readiness": "ready" },
    { "id": "TC.wiki.symlink-wiki-refused", "title": "index is refused when docs/wiki is a symlink", "action_refs": ["ACT.wiki.index"], "level": "functional", "surface": "cli",
      "preconditions": ["docs/wiki is a symlink to a directory outside the project"],
      "steps": [{ "goal": "Run wiki.js index", "done_when": { "expect": "The command exits" } }],
      "expected": [
        { "text": "The exit code is 2", "observe": { "channel": "artifact", "key": "exit code" } },
        { "text": "No index.md is created in the symlink target", "observe": { "channel": "artifact", "key": "<symlink target>/index.md" } }
      ], "basis": { "kind": "requirement", "refs": ["REQ.wiki-plan"] }, "readiness": "ready" }
  ],
  "open_questions": []
}
```

## E2E

- cc-baseline에는 화면이 없다. 위 TC 11개는 `npm test`의 단위 테스트로 대응해 확인한다(이전 플랜 `tc-fix-loop`, `tc-replay`와 같은 방식).
- 실제 흐름 검증은 Phase C에서 샘플 앱으로 한다.
  - `/wiki init`
  - stale 감지, 그리고 `/plan`이 참고하기 전에 갱신하는지
  - 효과 측정
- 브라우저 TC와 `tc-run.json`은 없다.
- 실패한 TC는 수정 루프(§2-B)로 보내지 않고 단위 테스트를 고치는 범위에서 처리한다.

## 검증

- `npm test`가 모두 통과한다(기존 테스트 + 새 테스트).
- `node bin/cli.js --doctor`가 정상이고, `wiki.js`, `wiki.md`, `reference_wiki.md`가 설치돼 있다.
- Phase C에서 다음을 확인한다.
  - `/wiki init` 뒤 `check --strict`가 통과한다.
  - 파일을 고치면 해당 문서만 stale이 된다.
  - `/plan`이 stale 문서를 먼저 갱신한다.
  - 위키가 있을 때와 없을 때의 측정 수치를 기록한다.
- `docs/wiki/` 밖에 파일이 생기지 않는다.

## ✅ Checklist

- [ ] TC 초안을 승인 직후 파일로 썼고 다시 검사했다
- [ ] `check`의 상태 5종(ok·stale·unstamped·broken·invalid)과 `--strict` 종료 코드가 테스트로 고정됐다
- [ ] `stamp`는 frontmatter의 두 키만 바꾸고 본문은 보존한다
- [ ] 루트 밖 경로와 심볼릭 링크 위키는 거부된다
- [ ] 위키에 컴포넌트 정의를 복사하지 않는다(이름만 쓰고 정의는 `design-profile.md`)
- [ ] plan·phase_end·publisher 프로토콜·publisher Step 2·pipeline 표·manifest·MEMORY 템플릿에 반영했다
- [ ] README, CHANGELOG, install-details(en/ko)를 갱신했다
- [ ] 샘플 앱에서 init, stale, 참고 전 갱신, 효과 측정을 기록했다(1회 측정이라는 한계도 적었다)
- [ ] 보안 감사와 코드 리뷰를 반영했다. 푸시는 사용자 확인 뒤에 한다
- [ ] `/clean`을 실행했다
