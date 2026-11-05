# cc-baseline 하네스 버그 B1~B8 수정

harness-smoke 점검(`~/Desktop/coding/workspace/harness-smoke/RESULTS.md` §4)에서 찾은 하네스 버그 8건을 cc-baseline 템플릿과 설치 코드에서 고친다.

## ⚡ Key Rules Summary

| ✅ DO | ❌ DON'T |
|---|---|
| `~/Desktop/coding/workspace/cc-baseline/templates/`와 `src/`만 수정 → `node bin/cli.js --yes`로 전파 | `~/.claude/` 설치본을 직접 수정 (규칙 11, 다음 설치 때 덮어써짐) |
| 훅 수정 시 `_ccBaselineId`는 그대로 두고, `LEGACY_*` 식별자는 지우지 않음 | 기존 설치본이 "외부 훅"으로 보여 중복 설치되게 만들기 |
| 글로벌·프로젝트 훅 템플릿(`settings-hooks.json`, `settings-hooks.project.json`)을 함께 수정 | 한쪽만 고쳐 두 모드의 동작이 갈라지게 두기 |
| 버그마다 재현 명령으로 수정 전 FAIL → 수정 후 PASS 확인 | 템플릿 문구만 바꾸고 실제 동작 확인 없이 완료 처리 |
| 변경 내용은 `CHANGELOG.md`의 `[Unreleased]`에 기록 | 이 플랜에서 버전 번호를 올림 (릴리스는 별도) |
| `develop` 브랜치에서 작업, push는 사용자 확인 후 | `main`에 직접 커밋 또는 임의 push |

## Meta
- Security Impact: Yes
- Code Quality Impact: Yes
- UI Impact: No
- Reason: 프로세스를 종료하는 훅·커맨드(SessionEnd, /clean), 쓰기 차단 훅(H2), 민감 헤더 마스킹(/check-log), 보안 스캐너 실행(semgrep)을 수정함

---

## Context

- 2026-10-24 harness-smoke로 하네스 전체를 처음부터 끝까지 돌렸다. 심은 버그 7개는 모두 잡혔지만, 하네스 자체에서 버그 8건이 나왔다.
- 그중 3건(B4 semgrep, B6 /clean, B8 SessionEnd)은 부품이 **조용히 아무 일도 안 하는** 유형이라 doctor도 ok로 표시한다. 가장 위험한 유형이다.
- 결과물: B1~B8이 고쳐진 템플릿, 회귀 테스트, CHANGELOG 기록, 재설치 후 재현 명령으로 PASS 확인.

### 버그 목록과 수정 위치

| # | 증상 | 수정 파일 | 수정 방향 |
|---|---|---|---|
| B1 | `getdesign.md/<slug>/design-md`에 토큰 0개 → 모든 후보 `source_unavailable` | `templates/agents/design-director.md`(144, 264행), `templates/memory/reference_design_md_index.md`(11, 27, 52, 178행) | fetch URL을 `https://raw.githubusercontent.com/VoltAgent/awesome-design-md/main/design-md/<slug>/DESIGN.md`로 교체, WebFetch 허용 도메인 갱신. "usable tokens" 판정 기준 명시(hex 색상 1개 이상) |
| B2 | 같은 플랜에서 화면 2가 화면 1의 `publish-iter-1.*`를 덮어씀. 스크린샷이 프로젝트 루트에 저장됨 | `templates/agents/publisher.md`(74, 259, 280, 311행), `templates/memory/reference_publisher_protocol.md`(§3 예시, §7) | 리포트명을 `publish-<screen-slug>-iter-<n>.{md,json}`로 변경, 입력에 `screen_slug` 추가(없으면 target_file 이름에서 생성). 스크린샷은 `.cc-audits/<plan-slug>/screens/`에 저장하도록 명시 |
| B3 | H3 훅이 `"once": true`인데 Playwright 호출마다 16KB 주입 | `templates/settings-hooks.json` (`pre-tool-use-e2e-guide`) | `once` 필드에 의존하지 않고, stdin의 `session_id`로 `$TMPDIR/cc-baseline-e2e-guide-<session_id>` 마커 파일을 만들어 세션당 1회만 출력. `once` 필드 제거 |
| B4 | security-auditor가 semgrep을 `--config auto`로 실행 → "metrics off" 오류로 건너뜀 | `templates/agents/security-auditor.md` Step 2 이후 | 실행 명령 명시: `semgrep scan --config <ruleset> --metrics=off --json`. 프로젝트 타입별 ruleset 표(`web-*`·`library` → `p/javascript`, `python-*` → `p/python`, 기타 → `p/default`). 실행 실패 시 `scanners_skipped`에 **오류 메시지 그대로** 기록 |
| B5 | MCP `browser_network_requests`가 응답 헤더·본문을 주지 않고 현재 페이지 요청만 반환 → `Set-Cookie` 마스킹이 실제로 안 쓰임 | `templates/commands/check-log.md` Step 2 | (1) 실패가 난 페이지에서 이동하기 전에 실행하라고 안내 (2) 응답 헤더·본문은 **GET/HEAD 실패 요청만** `curl -s -D -`로 재요청해 수집, 리포트에 "replayed" 표시 (3) POST 등은 재요청 금지, "response headers unavailable" 기록 (4) 마스킹은 재요청 결과에도 동일 적용 |
| B6 | `/clean`이 서버(3100, 7777)를 정지하지 않음. `fail-*.png` 남음 | `templates/commands/clean.md` | 새 단계: 현재 프로젝트 디렉터리를 cwd로 가진 TCP LISTEN 프로세스만 정지(`lsof -nP -iTCP -sTCP:LISTEN` → `lsof -a -p <pid> -d cwd`로 cwd 확인). 다른 프로젝트·시스템 프로세스는 건드리지 않음. 정지한 PID와 포트 출력. `e2e-results/fail-*` 전체 확장자 삭제 |
| B7a | `.claude/`가 존재하고 gitignore에 있으면 규칙 6 명령이 exit 1 | `templates/memory/all_session_basic_rules.md` §6 | 실제 동작을 확인한 명령으로 교체(Phase C에서 후보 비교). 기본안: `git add --all -- . ':(exclude).claude'`. 후보 모두 실패하면 "ignored 경고로 exit 1이 나도 스테이징은 됨 → `git status`로 확인" 문구 추가 |
| B7b | H2가 deny JSON 출력 후 `exit 2` → "hook error"로 표시 | `templates/settings-hooks.json`, `templates/settings-hooks.project.json` (`*path-policy`) | deny JSON과 함께 `sys.exit(0)`. 차단은 `permissionDecision: deny`가 담당 |
| B8 | SessionEnd 훅 `pgrep -f '@anthropic-ai/claude-code'`가 0개 매칭 (현재 실행 이름은 `claude`) | `templates/settings-hooks.json` (`session-end-orphan-cleanup`), `src/merge/settings-hooks.js` | 명령을 `{ pgrep -x claude; pgrep -f '@anthropic-ai/claude-code'; } \| sort -u \| while read pid; …`로 변경(네이티브 + npm 설치 모두). `-x`는 대소문자 구분이라 데스크톱 앱 `Claude`는 제외됨. `LEGACY_SESSION_END_COMMAND_PREFIX`는 유지하고 새 명령 접두어도 legacy 식별 목록에 추가 |

---

## 단계별 실행

### Phase 0 — 준비
1. Read `~/.claude/memory/phase_start.md` and execute
2. 이 플랜을 `~/Desktop/coding/workspace/cc-baseline/docs/plans/harness-smoke-fixes.md`로 복사하고, `~/.claude/plans/cozy-prancing-pebble.md`는 harness-smoke 앱 플랜(원래 내용 + Publish/Audit/Code Review History)으로 복원
3. cc-baseline `git status` 깨끗한지, 브랜치 `develop` 확인. 수정할 파일마다 `git log -3 -- <file>` 확인(규칙 8)
4. 기준선: `npm test` 결과와 재현 명령(아래 §검증) 수정 전 결과 기록
5. Read `~/.claude/memory/phase_end.md` and execute

### Phase A — 에이전트·메모리 문서 (B1, B2, B4)
1. Read `~/.claude/memory/phase_start.md` and execute
2. B1: design-director.md, reference_design_md_index.md의 URL·허용 도메인·판정 기준 수정
3. B2: publisher.md, reference_publisher_protocol.md의 리포트명·`screen_slug`·스크린샷 경로 수정
4. B4: security-auditor.md에 semgrep 실행 명령과 ruleset 표 추가
5. `grep -rn 'getdesign.md/<slug>/design-md\|publish-iter-<n>' templates/`로 옛 문구 잔존 0 확인
6. Read `~/.claude/memory/phase_end.md` and execute

### Phase B — 훅 (B3, B7b, B8)
1. Read `~/.claude/memory/phase_start.md` and execute
2. `settings-hooks.json`, `settings-hooks.project.json` 수정 (B3 마커, B7b exit 0, B8 pgrep)
3. `src/merge/settings-hooks.js`: 새 SessionEnd 명령도 legacy 식별되도록 보강
4. `test/run.js`에 회귀 테스트 추가:
   - path-policy 훅 명령에 `sys.exit(2)` 없음
   - e2e-guide 훅에 `once` 없음, `session_id` 마커 로직 있음
   - SessionEnd 명령이 `pgrep -x claude` 포함
   - 옛 SessionEnd 명령(`pgrep -f '@anthropic-ai/claude-code' …`)이 여전히 `session-end-orphan-cleanup`으로 식별됨
5. `npm test` 전부 통과
6. Read `~/.claude/memory/phase_end.md` and execute

### Phase C — 커맨드·규칙 (B5, B6, B7a)
1. Read `~/.claude/memory/phase_start.md` and execute
2. B5: check-log.md에 재요청 절차, 비멱등 요청 금지, "replayed" 표시 추가
3. B6: clean.md에 프로젝트 cwd 기준 서버 정지 단계와 `fail-*` 전체 삭제 추가. zsh·bash 양쪽에서 dry run(1.5.0 때와 같은 방식)
4. B7a: 스크래치 레포에서 후보 명령 비교(`.claude/` 존재 + gitignore 상태) → exit 0이고 `.claude/`가 스테이징되지 않는 명령으로 규칙 6 갱신
5. Read `~/.claude/memory/phase_end.md` and execute

### Phase D — 전파, 감사, 재검증
1. Read `~/.claude/memory/phase_start.md` and execute
2. `CHANGELOG.md` `[Unreleased]`에 B1~B8 기록
3. security-auditor + code-reviewer를 한 메시지에서 병렬 호출 (`plan_paths`: 이 플랜, `target_dir`: cc-baseline)
4. `node bin/cli.js --yes`로 `~/.claude/`에 전파 → `node bin/cli.js --doctor` fail 0
5. 새 Claude 세션에서 §검증의 재현 명령 실행, 결과를 harness-smoke `RESULTS.md`에 "수정 후" 열로 추가
6. 커밋(develop). push는 사용자 확인 후
7. Read `~/.claude/memory/phase_end.md` and execute

---

## 검증 (버그별 재현 명령)

| # | 수정 전 (FAIL) | 수정 후 기대값 |
|---|---|---|
| B1 | `curl -sL https://getdesign.md/airtable/design-md \| grep -c '#[0-9a-fA-F]\{6\}'` → 0 | 새 URL로 같은 명령 → 1 이상. design-director 2회차가 `spec_assets` 없이 `done` |
| B2 | 화면 2개 publish 후 `ls .cc-audits/<slug>/publish-*` → 1쌍 | 화면별 2쌍, 프로젝트 루트에 `*.png` 없음 |
| B3 | Playwright 도구 2회 호출 → 매번 "Loading E2E test guide" 16KB | 첫 호출만 주입, 두 번째부터 없음 |
| B4 | iter 리포트 `scanners_skipped`에 semgrep | `scanners_used`에 semgrep, 명령에 `--metrics=off` |
| B5 | `Set-Cookie` 응답이 있는 400 GET 후 `/check-log` → 응답 헤더 없음 | 리포트에 `Set-Cookie: [REDACTED]` + "replayed", 비밀값 0회 |
| B6 | `node server.js &`, `python3 -m http.server 7777 &` 후 `/clean` → 둘 다 LISTEN | 둘 다 정지, 다른 프로젝트 서버는 유지, 현재 세션 MCP 생존 |
| B7a | `.claude/` 존재 상태에서 규칙 6 명령 → exit 1 | exit 0, `git diff --cached --name-only`에 `.claude/` 없음 |
| B7b | 보호 경로 Write → "hook error" | 정상 deny 메시지, 파일 미생성 |
| B8 | 세션 중 `pgrep -f '@anthropic-ai/claude-code' \| wc -l` → 0 | 새 명령의 pgrep 부분이 현재 세션 PID를 찾음. 부모가 1인 더미 `claude` 프로세스는 SessionEnd 후 종료됨 |

---

## 범위 밖 (기록만)

- Playwright MCP test-4/5 "Connection closed" 크래시 — 원인 미확인, 재현되면 별도 조사
- e2e-tester가 sweep 실패 시 시나리오를 멈추는 동작, 오래된 콘솔 로그 인용, 스크린샷 저장 실패
- code-reviewer의 C2 decision_type(auto vs business) 분류 기준
- 각 에이전트 리포트의 `00:00:00Z` 타임스탬프 자리표시자, design-director `one_line` 필드 누락

---

## E2E 시나리오

하네스 변경 후 E2E 경로(H3 훅 1회 주입, MCP 병렬, §0 sweep)가 그대로 동작하는지 harness-smoke 앱으로 회귀 확인한다. 실행 전 harness-smoke에서 `node server.js > server.log 2>&1 &`.

```
mcp_server: playwright-test-2
base_url: http://localhost:3100
server_log: server.log
scenario:
  name: 회귀 — 비품 목록 필터와 반납
  steps:
    - / 로 이동해 표에 비품이 1개 이상 렌더링됐는지 확인
    - 상태 필터를 "대여중"으로 바꾸고 모든 행의 상태 배지가 "대여중"인지 확인
    - 대여중인 첫 행의 "반납" 클릭 → 상태가 "보관중"으로 바뀌고 POST /api/items/:id/return 이 200인지 확인
screenshot_mode: on_failure_only
```

```
mcp_server: playwright-test-3
base_url: http://localhost:3100
server_log: server.log
scenario:
  name: 회귀 — 비품 등록
  steps:
    - /new.html 로 이동
    - 이름을 비운 채 등록 → 검증 오류 메시지 표시, 네트워크 요청 없음 확인
    - 이름 "회귀 테스트", 분류 "기타" 입력 후 등록 → POST /api/items 201 확인
screenshot_mode: on_failure_only
```

- 매니저 확인: 두 리포트의 `INVARIANTS` held / `SWEEP` clean, 오케스트레이터 컨텍스트에 E2E 가이드가 **1회만** 주입됐는지
- 종료 후 `/clean` → 3100 서버가 정지되는지(B6 동시 확인), harness-smoke `data/items.json`은 `git checkout`으로 복구

---

## ✅ Checklist

- [ ] 이 플랜을 cc-baseline `docs/plans/`에 저장, `cozy-prancing-pebble.md`는 앱 플랜으로 복원
- [ ] B1~B8 각각 수정 전 FAIL / 수정 후 PASS를 재현 명령으로 확인
- [ ] 글로벌·프로젝트 훅 템플릿 양쪽 수정, `_ccBaselineId`·legacy 식별자 유지
- [ ] `test/run.js` 회귀 테스트 추가, `npm test` 통과
- [ ] `CHANGELOG.md` `[Unreleased]` 기록
- [ ] security-auditor + code-reviewer 병렬 감사 통과
- [ ] `node bin/cli.js --yes` 전파 후 `--doctor` fail 0
- [ ] E2E 회귀 2개 PASS, H3 1회 주입 확인
- [ ] develop 커밋, `.claude/` 미커밋, push는 사용자 확인 후

## Audit History
- iter-1: 2026-10-24 / critical=0 high=1 medium=2 low=3 / next_action=self_fix — SEC-001(check-log 재요청 URL 주입) auto 수정. 인터뷰: SEC-002 /clean git 루트 + 가드, SEC-003 SessionEnd 본인 소유 + headless 제외, SEC-006 DESIGN.md 커밋 SHA 고정. SEC-004/005 auto 수정
- iter-2: 2026-10-24 / critical=0 high=0 medium=0 low=2 / next_action=done — SEC-008(마커 생성 순서) 수정, SEC-007(같은 프로젝트의 다른 터미널 서버도 정지) 위험 수용

## Code Review History
- code-review-iter-1: 2026-10-24 / critical=0 high=0 medium=1 low=2 / profile_status=cached / next_action=done — 인터뷰: QA-001 /clean 제외를 실행 파일 이름으로. QA-002/003 auto 수정
- code-review-iter-2: 2026-10-24 / critical=0 high=0 medium=0 low=0 / profile_status=cached / next_action=done
