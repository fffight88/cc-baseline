# 하네스 브라우저 계층 개편 — Aside 주 / Playwright 대체 + B9~B12 수정 (cc-baseline)

harness-smoke v2에서 나온 Playwright·E2E 버그 4건(B9~B12)을 고치고, 하네스의 브라우저 도구를 **Aside(주) → Playwright MCP(대체)** 구조로 바꾼다. 인스톨 시 Aside도 함께 설치·점검한다.

## ⚡ Key Rules Summary

| ✅ DO | ❌ DON'T |
|---|---|
| 모든 브라우저 작업(e2e-tester, publisher Step 6, `/open-browser`, `/check-log`)은 **Aside 먼저**, 실패·미설치 시 Playwright MCP | Playwright MCP 설정·에이전트 규칙 삭제 (대체 수단으로 그대로 유지) |
| Aside는 `aside repl` **CLI(Bash)** 로만 호출 | `aside mcp` 등록, `aside exec`(자율 에이전트)로 테스트 실행 |
| Aside는 **테스트 전용 프로필**(`--profile <id>`)에서만 사용 | 사용자의 기본 프로필(Profile 0)·로그인 세션에서 테스트 |
| 대체 전환 시 리포트에 `browser_tool: playwright` + `fallback_reason` 기록 | 조용히 대체 전환하고 Aside PASS처럼 기록 |
| Phase 0 스파이크로 `aside repl` 기능(콘솔·응답 헤더·세션 유지·병렬 탭·axe 주입)을 **실측 후** 규칙 작성 | 확인 안 된 Aside 기능을 전제로 에이전트 규칙 작성 |
| 수정은 `cc-baseline` `develop`에서, 템플릿 수정 → `node bin/cli.js --yes`로 전파 | `~/.claude/` 직접 수정, push (사용자 승인 전) |

## Meta
- Security Impact: Yes
- Code Quality Impact: Yes
- UI Impact: No
- Reason: 인스톨러가 외부 앱(brew cask) 설치·설정 파일 기록, 실제 브라우저 프로필 접근 경로 추가, 훅·에이전트·커맨드 템플릿과 doctor 로직 변경 (화면 UI 없음)

---

## Context

- harness-smoke v2(2026-10-26, `RESULTS.md` §4-v2)에서 B1~B8 수정은 확인됐지만 새 버그 4건이 나왔고, 모두 Playwright·E2E 계층이다.
- 사용자는 이미 Aside(`at.studio.AsideBrowser`, 앱 1.0.1022.1, CLI 1.26.1022.0, `~/.local/bin/aside`)를 쓰고 있고 로그인 상태다. `aside repl`은 실제 Aside 브라우저 탭에 붙어 Playwright 스타일 JS를 실행한다(실측: 탭 6개 조회 OK, 38ms).
- 결정(2026-10-26 인터뷰): 적용 범위 **전부 Aside 우선**, 연동 **CLI `aside repl`**, 프로필 **테스트 전용**. Playwright는 대체 수단으로 남긴다.
- 설치 경로: 앱은 Homebrew cask `aside`(macOS 13+)로 설치 가능. CLI(`~/.aside/cli/Aside CLI.app` → `~/.local/bin/aside`)를 앱이 어떻게 설치하는지는 **미확인** → Phase 0에서 확인. 로그인(`aside login`)은 앱에서 사용자 승인이 필요해 자동화 불가.
- 현재 Aside 프로필은 `Profile 0` 하나뿐 → 테스트 프로필은 사용자가 앱에서 생성.

### 버그 목록과 수정 위치

| # | 증상 | 수정 파일 | 수정 방향 |
|---|---|---|---|
| B9 | H3 가이드 1회 마커가 부모 세션 ID 기준 → 첫 Playwright 사용자(publisher)가 소비, e2e-tester는 0회 | `templates/settings-hooks.json`(e2e-guide 훅), `templates/agents/e2e-tester.md` | 훅 입력에 서브에이전트 식별자(`agent_id`/`agent_type` 등)가 있으면 마커 키에 포함(Phase 0에서 필드 실측). 보조: e2e-tester 정의에 §0 핵심 규칙을 직접 포함해 주입 여부와 무관하게 동작. 매처를 Aside 호출(`Bash` + `aside repl` 명령)까지 확장 |
| B10 | §0-B SWEEP이 로드 시점 컨트롤만 열거 → 토스트 닫기 같은 일시적 컨트롤 미검사 | `templates/agents/e2e-tester.md` §0-B, `templates/memory/reference_e2e_manager_guide.md` §0 | 로드 시 `MutationObserver`로 새로 생긴 컨트롤을 기록하고, 시나리오 단계마다 새 컨트롤을 즉시 클릭·검사. 매니저 가이드에 "토스트·모달 등 일시적 UI는 시나리오에 명시적 클릭 단계로" 추가 |
| B11 | 실패 스크린샷이 프로젝트 루트에 저장됨 | `templates/agents/e2e-tester.md`, 매니저 가이드 §6 | 저장 경로를 `<project>/e2e-results/fail-{N}-{ts}-<slug>.png` **절대 경로**로 고정, 종료 전 루트 `*.png` 0개 자가 점검 |
| B12 | `playwright-test-1`이 `--headless`라 `/open-browser`에서 사용자가 조작 불가 | `templates/mcp-servers.json`, `templates/mcp-servers.project.json`, `src/doctor.js` | test-1만 `--headless` 제거(창 표시), doctor가 test-1 args 점검. Aside 주 경로에서는 Aside 창을 사용자가 직접 조작 |

### Aside 도입 범위

| 대상 | Aside 주 경로 | 대체(Playwright) |
|---|---|---|
| 인스톨러 | macOS: CLI·앱 없으면 `brew install --cask aside`, 로그인·테스트 프로필 안내, 프로필 ID를 하네스 설정에 기록 (`--skip-aside` 옵션) | Linux 등 비지원 OS는 건너뜀 → Playwright만 |
| doctor | `checkAside`(warn): CLI 존재·버전, `aside account status` 로그인, 테스트 프로필 연결 | 기존 MCP·바이너리 점검 유지 |
| e2e-tester | 테스터마다 테스트 프로필의 **별도 탭**, `aside repl`로 시나리오·§0 실행 | `mcp_server: playwright-test-N` |
| publisher Step 6 | 렌더 확인·스크린샷은 Aside, axe는 주입 가능 여부에 따라(Phase 0) | axe 주입 불가 시 axe만 Playwright |
| `/open-browser` `/check-log` | 테스트 프로필 탭을 사용자 화면에 열고 사용자가 직접 조작, 진단은 `aside repl` | headed `playwright-test-1` |
| `/clean` | 하네스가 연 테스트 탭만 닫기, Aside 앱·사용자 탭은 건드리지 않음 | 기존 동작 유지 |

**대체 전환 조건 (공통 규칙, `reference_browser_tools.md`):** CLI 없음 · 테스트 계정(`--account`)에 연결 안 됨 · 같은 명령 2회 연속 오류/120초 타임아웃 · 필요한 기능 미지원(Phase 0 결과표 기준). 전환 시 리포트에 이유 기록.

---

## 단계별 실행

### Phase 0 — 준비 + Aside 실측
1. Read `~/.claude/memory/phase_start.md` and execute
2. ✅ 이 플랜을 `cc-baseline/docs/plans/browser-aside-e2e-fixes.md`로 저장, harness-smoke 앱 플랜 `~/.claude/plans/indexed-stirring-koala.md` 원복 (2026-10-26)
3. cc-baseline `develop` 확인, 수정 대상 파일마다 `git log -3`, 기준선 `npm test`(72개)
4. 사용자에게 Aside 앱에서 **테스트 전용 프로필 생성** 요청 → `aside host profiles`로 ID 확인
5. 스파이크(테스트 프로필, `localhost` 정적 페이지 대상) — 결과표를 플랜에 기록:
   - CLI 설치 경로: brew cask 설치 후 `aside` CLI가 생기는 조건(앱 첫 실행/설정 메뉴 등)
   - `aside repl` 호출 간 상태 유지(변수·리스너·탭)와 동시 실행(탭 N개 병렬)
   - 콘솔 오류·`pageerror` 수집, 네트워크 요청·**응답 헤더** 수집(`page.on('response')`)
   - `page.screenshot({ path })` 절대 경로 저장, axe-core 주입(`fs`로 읽어 `addScriptTag`)
   - 훅 입력 JSON에 서브에이전트 식별 필드가 있는지(B9)
6. Read `~/.claude/memory/phase_end.md` and execute

#### Phase 0 결과 (2026-10-26, Aside CLI 1.26.1022.0 / daemon 1.26.1024.24)

| 항목 | 결과 | 반영 |
|---|---|---|
| 테스트 프로필 | `for-ai` = 브라우저 "Profile 2" = CLI 계정 `u2`(로컬, 로그인 없음), 프로필 ID `7f41cfeb-645f-41de-961a-e04a6618c368`. `--account u2`로 접근, 개인 탭 비노출 | 설정 파일에 `account: u2` 기록 (`--profile`이 아니라 `--account`) |
| 호출 간 상태 | `aside repl "<code>"`는 호출마다 새 세션(세션 폴더·탭 소멸) | 한 단계 = 한 호출로 자급, 또는 장기 세션 |
| 장기 세션 | `aside repl`에 stdin(FIFO)을 열어 두면 변수·탭 유지, 다른 호출에서 `listBrowserTabs`·`attachBrowserTab`으로 접근 가능, EOF/`exit` 시 탭 닫힘 | `/open-browser`·E2E 시나리오는 FIFO 세션 헬퍼 사용 |
| 병렬 | 동시 3개 호출이 각자 탭으로 정상 | 테스터당 탭 1개 |
| 콘솔·오류 이벤트 | `page.on('console'/'pageerror'/'response')` 이벤트 안 옴 | 페이지 진입마다 `window.__e2e` 기록기 주입(console.error 래핑 + error/unhandledrejection), 주입 전 오류는 미수집(한계 명시) |
| 응답 헤더 | `fetch()`(쿠키 포함)로 status·headers 조회 가능, **`Set-Cookie` 노출됨** | 실패 GET만 same-origin replay, 민감 헤더 `[REDACTED]` |
| 스크린샷 | `page.screenshot` 경로는 세션 폴더(`pwd`) 안만 허용, 프로젝트 경로 거부. `fs`는 promise API(readFile, writeFile, mkdir, stat, copyFile 등), 세션·Project 루트 밖 쓰기 거부 | 세션 폴더에 저장 → Bash `cp`로 `<project>/e2e-results/` 절대 경로 |
| axe-core | `<script src=cdn>` 주입 후 `axe.run()` 동작(위반 0, Playwright 결과와 일치). 코드에 `import(` 문자열이 있으면 REPL이 거부 | `<script>` 주입만 사용, CSP로 막히면 대체 |
| 사용자 화면 탭 | `aside <url>`은 로그인 계정 필요 → `u2`에서 실패 | `/open-browser`는 FIFO 장기 세션으로 탭 유지 |
| CLI 설치 | 공식: `curl -fsSL https://releases.aside.com/install.sh \| bash` 또는 앱 Settings → Developers(이 기기는 데몬 로그 `developers.installCli`로 확인). 스크립트는 `releases.aside.com/cli/AsideCLI-darwin-<arch>-latest.zip`을 받아 `~/.aside/cli/Aside CLI.app` + `~/.local/bin/aside` 링크, **체크섬·서명 검증 없음**. CLI는 Developer ID "At Inc. (8CPD4K4TBB)" 서명·공증 | 인스톨러가 같은 경로로 설치하되 `codesign --verify --deep --strict` + Team ID `8CPD4K4TBB` 확인 후 배치 |
| 데몬 | `Aside.app/.../Libraries/AsideDaemon`에 번들, 앱 첫 실행 때 `~/Library/Application Support/Aside/AsideDaemon/<arch>/<ver>`로 설치·실행, 업데이트는 앱이 담당 | 인스톨러: 데몬 폴더가 없으면 `open -a Aside`로 앱을 한 번 실행 |
| B9 훅 입력 | 서브에이전트 호출에는 `agent_id`·`agent_type` 포함, 메인 세션 호출에는 없음 | 마커 키 = `session_id` + (`agent_id` 또는 `main`) |

### Phase A — B9~B12 (Playwright 계층)
1. Read `~/.claude/memory/phase_start.md` and execute
2. B9: e2e-guide 훅 마커 키 변경 + e2e-tester에 §0 핵심 포함 + 매처에 Aside Bash 호출 추가
3. B10: e2e-tester §0-B 일시적 컨트롤 처리, 매니저 가이드 보강
4. B11: 스크린샷 절대 경로 규칙 + 루트 png 자가 점검
5. B12: test-1 headed(전역·프로젝트 템플릿), doctor args 점검
6. 각 버그 회귀 테스트 추가 (수정 전 코드에서 실패 확인)
7. Read `~/.claude/memory/phase_end.md` and execute

### Phase B — Aside 설치·점검
1. Read `~/.claude/memory/phase_start.md` and execute
2. `src/paths.js`에 `ASIDE_BIN`, `src/installers/aside.js` 신설(`_util.js` `checkCmd` 재사용, 실패 시 수동 안내 출력 — `scanners.js` 패턴 따름), `src/install.js`에 연결, `bin/cli.js`에 `--skip-aside`
3. 하네스 설정 파일(예: `~/.claude/cc-baseline-browser.json` — `primary`, `aside.profile`, `fallback`)을 인스톨러가 기록, 기존 값 보존
4. `src/doctor.js`에 `checkAside`(warn) 추가, 전역 점검 수 갱신
5. 테스트: 가짜 `aside` 바이너리로 설치 건너뜀·doctor warn/ok, 비 macOS 건너뜀, README 동기화
6. Read `~/.claude/memory/phase_end.md` and execute

### Phase C — Aside 주 경로 + 대체 규칙
1. Read `~/.claude/memory/phase_start.md` and execute
2. `templates/memory/reference_browser_tools.md` 신설: 주/대체 순서, 전환 조건, `aside repl` 사용 규칙(snapshot·ref, 탭 관리, 절대 경로), 리포트 필드(`browser_tool`, `fallback_reason`)
3. `e2e-tester.md`, `publisher.md`: 입력에 `browser: aside|playwright`, `aside_profile`, 대체용 `mcp_server` 유지. 도구 규칙·§0·Step 6을 Aside 기준으로 작성, Playwright 절차는 대체 절로 유지
4. `open-browser.md`, `check-log.md`, `clean.md`: Aside 탭 기준 + 대체 경로, `browser-session.json`에 `browser`·`targetId` 기록
5. `reference_e2e_manager_guide.md`, `reference_publisher_protocol.md`, `reference_agent_pipeline.md`: 탭 배정·HTML 리포트를 Aside로 열기·대체 규칙 반영, `templates/manifest.json`에 새 파일 등록, CHANGELOG `[Unreleased]`
6. Read `~/.claude/memory/phase_end.md` and execute

### Phase D — 감사·전파
1. Read `~/.claude/memory/phase_start.md` and execute
2. `npm test` 전체 통과
3. security-auditor + code-reviewer 한 메시지 병렬 (`plan_paths`: 이 플랜), design/business → 알림 → 인터뷰, auto → self-fix → 재감사(최대 3회), `report.html` 1회
4. `node bin/cli.js --yes`로 설치(백업 확인) → `--doctor` 전부 ok(Aside 포함)
5. `develop`에 커밋 (push는 사용자 승인 후)
6. Read `~/.claude/memory/phase_end.md` and execute

### Phase E — 재검증 (harness-smoke, 새 세션)
1. Read `~/.claude/memory/phase_start.md` and execute
2. §E2E 시나리오를 Aside 경로로 병렬 실행 → `browser_tool: aside`, INVARIANTS·SWEEP 확인. 일시적 토스트 닫기 결함을 임시로 심어 SWEEP이 잡는지 확인(B10)
3. 가이드 주입: publisher 이후 e2e-tester도 가이드를 받는지(B9), 루트 png 0(B11)
4. `/open-browser`: 사용자가 Aside 테스트 탭을 **직접** 클릭 → `/check-log`로 콘솔·응답 헤더·`[REDACTED]` 확인
5. 대체 훈련: Aside 앱을 종료한 상태로 시나리오 1개 실행 → Playwright로 전환, `fallback_reason` 기록 확인. headed test-1로 `/open-browser` 사용자 조작(B12)
6. `/clean` → 테스트 탭만 닫힘, 사용자 탭·Aside 앱 유지, 서버 정지
7. 결과를 harness-smoke `RESULTS.md`에 3차 열로 기록
8. Read `~/.claude/memory/phase_end.md` and execute

---

## 검증

- `npm test` 전체 통과, 신규 회귀 테스트는 수정 전 코드에서 실패
- `node bin/cli.js --doctor`: Aside 로그인·테스트 프로필 ok, test-1 headed ok
- Phase E 체크 항목 전부 PASS, 대체 전환이 리포트에 기록됨
- `grep -rn "Profile 0\|defaultProfile" templates/` — 기본 프로필 사용 흔적 없음

## 범위 밖

- `aside exec`(Aside 자율 에이전트)·`aside mcp` 연동, Linux·Windows의 Aside 설치
- 1차·2차 관찰 사항(design-director `next_action`, publisher mismatch에서 `done`, 보안 2회차 trivy 미실행, 리포트 JSON 누락 필드) — 별도 플랜
- harness-smoke B8(SessionEnd) 최종 확인 — 이 플랜과 별개로 세션 종료 시 진행

---

## E2E 시나리오

```
browser: aside
aside_profile: <테스트 프로필 ID>
mcp_server: playwright-test-2        # 대체용
base_url: http://localhost:3100
server_log: server.log
scenario:
  name: (Aside) 목록 — 현황 카드, 탭, 반납, 일시적 토스트
  steps:
    - / 로 이동해 현황 카드 4개 숫자가 표의 행 수와 일치하는지 확인
    - "지연" 탭 클릭 → 모든 행이 지연 강조인지 확인
    - 대여중인 첫 행 "반납" 클릭 → POST /api/items/:id/return 200, 토스트 표시, 카드 숫자 갱신
    - 토스트가 떠 있는 동안 "알림 닫기" 클릭 → 토스트 사라짐, 콘솔 오류 0
    - 리포트에 browser_tool: aside 기록 확인
screenshot_mode: on_failure_only
```

```
browser: aside
aside_profile: <테스트 프로필 ID>
mcp_server: playwright-test-3        # 대체용
base_url: http://localhost:3100
server_log: server.log
scenario:
  name: (대체 훈련) 등록 + 대여 — Aside 앱 종료 상태
  steps:
    - (사전) Aside 앱 종료
    - /new.html 로 이동 → Aside 연결 실패로 Playwright 전환, fallback_reason 기록 확인
    - 이름 비운 채 등록 → 검증 오류, 네트워크 요청 없음
    - 이름 "대체 모니터", 분류 "모니터" 등록 → POST /api/items 201, 토스트
    - 스크린샷이 있다면 e2e-results/ 아래 절대 경로, 프로젝트 루트 png 0개
screenshot_mode: on_failure_only
```

---

## ✅ Checklist

- [x] 플랜을 cc-baseline `docs/plans/`로 옮기고 harness-smoke 앱 플랜 복원
- [x] Phase 0 스파이크 결과표 기록, 테스트 전용 프로필 생성·연결
- [x] B9~B12 수정 + 회귀 테스트 (수정 전 실패 확인) — 2026-10-26, 테스트 72 → 78
- [x] 인스톨러 Aside 설치(앱 brew cask + 데몬 첫 실행 + CLI 서명 검증 설치)·`--skip-aside`·`--aside-account`, 설정 파일 `cc-baseline-browser.json`, doctor `checkAside` — 테스트 84개
- [x] 모든 브라우저 작업이 Aside 우선, 대체 전환 조건·리포트 필드 적용 — 2026-10-26, 테스트 86개
- [x] 기본 프로필 사용 없음, Playwright 설정·규칙 유지
- [x] 감사 병렬(3회), `report.html`, `--yes --aside-account u2` 전파, doctor 11 ok, 커밋(push 보류)
- [ ] harness-smoke 3차 재검증(Aside 경로·대체 훈련·사용자 직접 클릭), `RESULTS.md` 기록

## Audit History
- iter-1: 2026-10-26 / critical=0 high=1 medium=2 low=1 / scanners=semgrep,gitleaks,npm / next_action=self_fix — SEC-001·002(ci.yml, 기존 문제)는 사용자 결정으로 이번에 별도 커밋 수정(액션 SHA 고정 v4.4.0 + `permissions: contents: read`). auto: SEC-003 URL 허용 문자 목록, SEC-004 상태 폴더 소유·권한·심볼릭 링크 확인
- iter-2: 2026-10-26 / critical=0 high=0 medium=0 low=0 / scanners=semgrep,gitleaks,npm audit / next_action=done
- iter-3: 2026-10-26 / critical=0 high=0 medium=0 low=0 / scanners=semgrep,gitleaks,npm audit / next_action=done (mergeHooks·doctor 변경 확인)

## Code Review History
- code-review-iter-1: 2026-10-26 / critical=0 high=0 medium=2 low=3 / profile_status=regenerated / next_action=self_fix — 인터뷰: QA-002 셸 사전 필터, QA-004 프로젝트별 세션 분리. auto: QA-001 aside-session.sh 매칭, QA-003 플래그 값 처리, QA-005 설정 백업 + EXDEV
- code-review-iter-2: 2026-10-26 / critical=0 high=0 medium=0 low=2 / profile_status=cached / next_action=done — LOW 2건도 수정: QA-006 테스트 계정을 프로젝트 루트에서 읽기, QA-007 디스크 간 복사를 `ditto`로
- 설치 중 발견: 재설치 시 관리 훅의 매처가 갱신되지 않는 `mergeHooks` 버그 + doctor가 이를 ok로 표시 → 수정·회귀 테스트 2개(90개). 3회차 감사로 확인
- code-review-iter-3: 2026-10-26 / critical=0 high=0 medium=0 low=1 / profile_status=cached / next_action=done — QA-008(중복 훅일 때 매처 비교가 마지막 값만 봄)은 미수정: 중복이면 앞 단계에서 이미 경고하고 끝나므로 영향은 경고 문구뿐. 감사 루프 3회 도달
