# cc-baseline

명령어 하나로 Claude Code 하네스 전체를 설치합니다 — 행동 규칙, 커스텀 스킬, 자율 에이전트, 훅까지 어떤 머신에서도 동일하게.

---

## 목차

- [왜 cc-baseline인가?](#왜-cc-baseline인가)
- [요구사항](#요구사항)
- [빠른 시작](#빠른-시작)
- [프로젝트 로컬 설치](#프로젝트-로컬-설치)
- [설치 항목](#설치-항목)
- [자동 설치 도구](#자동-설치-도구)
- [옵션](#옵션)
- [설치되는 훅](#설치되는-훅)
- [훅 충돌 경고 가이드](#훅-충돌-경고-가이드)
- [설치 후 memory/ 파일 편집](#설치-후-memory-파일-편집)
- [백업 & 복구](#백업--복구)
- [언인스톨](#언인스톨)
- [템플릿 업데이트](#템플릿-업데이트)
- [Playwright 수동 테스트](#playwright-수동-테스트)
- [감사 리포트 저장 위치](#감사-리포트-저장-위치)
- [보안 정책: `permissions` 키 배포 금지](#보안-정책-permissions-키-배포-금지)
- [보안 & 프라이버시](#보안--프라이버시)
- [기술 스택 & 구조](#기술-스택--구조)
- [문제 해결](#문제-해결)

---

## 왜 cc-baseline인가?

머신마다 Claude Code를 일관되게 설정하는 건 번거롭습니다. cc-baseline은 단일 `npx` 명령어로 모든 것을 번들로 제공하며, 기존 `~/.claude/` 설정을 덮어쓰지 않고 깔끔하게 병합합니다.

**기본 제공 항목:**

- **13가지 행동 규칙** — 세션 시작 시 로드: 응답 언어, 불확실성 공개, 병렬 읽기, 최소 수정, 보고하는 사실의 독립 검증, 천재적 사고로 방향 정하기 등
- **Security Auditor 에이전트** — semgrep/gitleaks/trivy로 실제 SAST·SCA·시크릿 스캔 수행. 이슈별 `decision_type`(auto / design / business)이 포함된 구조화된 JSON+Markdown 리포트 생성; `claude-config` 타입에서 에이전트/커맨드 정의 파일의 **프롬프트 인젝션 패턴** 탐지; 스캐너 미설치 시 silent skip 대신 **HIGH/MEDIUM `scanner-gap` 이슈**로 명시적 보고
- **Code Reviewer 에이전트** — 보안 패스와 독립적으로 로직 오류, 엣지 케이스, 컨벤션 위반, CLAUDE.md 준수 여부 검사; **크로스파일 영향 분석**으로 export 변경이 의존 파일에 미치는 breaking change 탐지 (JS/TS/Python/Go); **async/Promise 패턴 오류** 탐지 (`await` 누락, unhandled rejection, `Promise.all` 오용); **테스트 커버리지 갭** 확인 (테스트 없는 새 export, 시그니처 변경 후 미업데이트 테스트); 매 로드 시 body hash로 **`project-patterns.md` 무결성 검증** — 변조 감지 시 `QA-PROFILE-TAMPER` 이슈 생성
- **Design Director 에이전트** — **그린필드** 프로젝트 전용. 기존 디자인 시스템이나 만들어진 화면이 없을 때 제품 레인(`product-ui` / `marketing-web`)을 분류하고, 68개 브랜드 `DESIGN.md` 카탈로그에서 방향 후보 3개를 로컬에서 띄운 미리보기 페이지 링크와 함께 제시. 인터뷰로 하나를 고르면 `.cc-audits/design-profile.md`를 시드해 publisher가 첫 화면부터 그 방향을 지키게 함. 화면은 직접 만들지 않으며, 기존 프로젝트(브라운필드)에서는 건너뜀
- **Publisher 에이전트** — 관리자페이지 같은 구조화·심플 디자인 프로젝트의 UI 퍼블리싱 전담. code-reviewer가 프로필을 캐싱하듯 **디자인 시스템 프로파일**(`design-profile.md`: 자동 감지된 스택·디자인 토큰·컴포넌트 인벤토리) 캐싱; 기획서(md/이미지/pdf/html) 분석, 기준 화면의 **톤앤매너** 반영, **재사용 우선**으로 마크업 + CSS + 정적 컴포넌트 작성(기존 매칭 실패 시에만 토큰/네이밍 준수 신규 생성), 모든 UI 상태 + **a11y 강제**; 버전 고정된 **Vercel Web Interface Guidelines**로 소스 자가점검 후, 브라우저(Aside 우선, 대체 Playwright MCP)에서 렌더 비교 + **axe-core 런타임 a11y 스캔**으로 검증. 범위는 마크업/CSS만 — 데이터 바인딩·API·상태·이벤트 로직 제외. `UI Impact` 플랜 메타 필드로 자동 트리거; **기능** 검증은 e2e-tester에 핸드오프
- **HTML 리포트 생성기** (`audit-report.js`) — 감사 JSON을 색상 코딩된 심각도 정렬 웹 페이지로 변환. 스캔 루프 완료 시 자동으로 열림
- **안정적인 알림** — macOS에서 `terminal-notifier` 자동 설치. design/business 결정 인터뷰 프롬프트를 놓치지 않도록 보장
- **E2E 테스터 에이전트** — **Aside** 우선(테스터마다 `aside repl` 세션 1개, 테스트 계정 전용), 실패 시 5개 병렬 Playwright MCP 서버로 대체. 토스트 같은 일시적 컨트롤도 검사하고 `BROWSER_TOOL` / `FALLBACK_REASON` 기록. FAIL 시 브라우저 콘솔·네트워크 헤더/페이로드·서버 로그 자동 수집 → `e2e-results/fail-{N}-{timestamp}.md` 저장. PASS 시 로그 수집 없음
- **플랜 작성 때 TC 함께 생성** — `Behavior Impact: Yes/Unknown`인 플랜은 사용자 행위와 TC를 `docs/tc/<feature>.tc.json`에 씁니다(기대 결과 한 줄에 확인 하나, 줄마다 관측 채널, 근거 `requirement` / `source-observation` / `proposal`). 작성 직후 `tc-lint.js`(코드 규칙)와, TypeSafe **Jev** 키가 있으면 `tc-jev-check.js`(`single` / `hidden` / `screen` 점수)로 검사합니다. e2e는 TC를 원문 그대로 실행하고 기대 결과마다 한 번만 판정합니다 — 코드 → Jev → LLM 순, `judged_by`를 `.cc-audits/<plan>/tc-results.jsonl`에 기록. TC는 플랜 본문에 초안으로 쓰고, 승인 직후 파일로 저장합니다. `api` / `db` / `log` 사실은 `tc-api-run.js`로 확인하며, 이 스크립트는 실행 설정의 `base_url`과 지정된 데이터 파일에만 접근합니다. 코드·사람 정답 표본으로 만들고 검증용 표본으로 확인한 보정을 사용자가 승인하면 그 질문은 Jev가 직접 판정합니다. LLM은 약 10%만 재검사하고, 최근 20건 중 2건이 엇갈리면 보정이 자동 해제됩니다. 실패한 TC는 **수정 루프**(`tc-fix-loop.js`)를 거칩니다. 실패마다 분류하고 제품 결함만 고칩니다. 같은 실패 지문이 반복되거나 라운드 상한에 닿으면 그 TC를 사용자에게 넘기고, 마지막에 전체 회귀 라운드를 한 번 돌고 끝냅니다. 테스터는 TC를 처음 돌릴 때 조작을 데이터로 기록합니다. 검증 재생에서 판정이 일치하면 이후 라운드는 LLM 없이 **재생**합니다(`tc-replay.js`). 죽은 버튼 점검은 데이터를 바꾸지 않는 스크립트로 합니다(`tc-sweep.js`)
- **화면·기능 위키** (`docs/wiki/`, `/wiki` + `wiki.js`) — 구현된 화면 하나, 여러 화면에 걸친 기능 하나마다 문서 한 장을 두고 route, 파일, 쓰는 컴포넌트, API, 상태, 연결된 화면을 적습니다. `/plan`과 publisher는 코드를 찾기 전에 여기서 기존 화면을 찾습니다(`wiki.js find`). 문서마다 나열한 파일의 해시를 기록해서, 코드가 바뀐 문서는 `stale`로 나오고 누가 참고하기 전에 갱신됩니다. 문서는 오케스트레이터가 씁니다(기존 프로젝트는 `/wiki init`, 이후 phase가 끝날 때마다). `wiki.js`는 상태, stamp, index, 검색을 맡습니다
- **사실 검증 에이전트** (`fact-auditor` + `claims.js`, `/verify-claims`) — 사용자가 판단에 쓸 보고(웹 조사, 분석 결론, 비교, 위키, 대량 수정)의 사실을 답하기 전에 검증합니다. `/plan` 안팎 모두 적용됩니다. 생산자는 주장 장부(주장 하나에 사실 하나)와 전제 장부(판단에 쓴 규칙)를 쓰고, `claims.js`가 이를 고정하고 **카나리아**(일부러 틀린 주장, 표시 없음)를 섞습니다. fact-auditor는 주장과 접근 명세만 받고 생산자의 도구·결과·추론은 보지 않은 채, 증거(로그, 읽기 전용 DB, 코드, 문서, 웹; 화면 항목은 e2e-tester)를 직접 모아 A~D 등급을 매깁니다. 카나리아를 통과시킨 채널은 믿지 않고, 반박된 전제에 기댄 주장은 `stale`, A·B 증거 없는 결정 주장은 `not_established`가 됩니다. 카나리아는 바꾼 값의 모양을 지킵니다(상태 코드는 실제 상태 코드로, 날짜는 며칠만). 그래서 증거 없이는 알아볼 수 없습니다. 이어서 `claims.js recheck`가 판정이 가리킨 파일, 로그 줄, SELECT를 다시 읽습니다. 에이전트가 쓴 스크립트는 실행하지 않고, 증거가 다시 나오지 않은 주장은 `not_reproduced`가 됩니다. 주장 30개 미만은 주장별 표시를 합니다. 30개 이상은 카나리아를 더 넣고, 결정이 비싸거나 해석형 판정이 많을 때만 사용자가 **검증기 판정**의 표본을 확인합니다. 이때 다시 읽은 증거가 붙은 확인표(`sample.md`)를 보여 주고, 보고서는 "다 맞음" 대신 단측 95% 오류율 상한을 냅니다. 모델 판단 항목은 먼저 Jev(`Q.claim_supported@1`)가 판정합니다
- **천재적 사고 기본 적용** (`memory/reference_genius_thinking.md`) — 방향이 정해지지 않은 아이디어·기획·설계·비효율 개선에서 두 사고법을 섞어 분석하고 아이디어 10개 이상을 낸 뒤, 가장 시의적절한 안을 Claude가 골라 적용합니다(플랜 승인과 확인 관문은 유지)
- **`/open-browser` 스킬** — 직접 조작할 탭을 엶: Aside 테스트 계정 창, 대체로 창이 뜨는 `playwright-test-1`. 세션 상태를 저장해 `/check-log`가 같은 브라우저를 읽게 함
- **`/check-log` 스킬** — 열린 브라우저에서 버그를 재현한 후 실행하면, 콘솔 에러·네트워크 요청/응답 상세·서버 로그를 e2e-tester 아티팩트와 동일한 수준으로 `e2e-results/fail-manual-{timestamp}.md`에 수집
- **안전한 병합 전략** — CLAUDE.md와 MEMORY.md는 마커 블록 병합. 훅은 statusMessage 중복 제거. 개인 설정은 절대 건드리지 않음
- **설치 전 자동 백업**; `--purge` / `--remove-scanners` 옵션이 포함된 원커맨드 언인스톨

---

## 요구사항

- **Node.js 18+**
- macOS 또는 Linux (Windows 네이티브 미지원 — WSL 사용 가능)
- `~/.claude/` 쓰기 권한

---

## 빠른 시작

```bash
npx github:fffight88/cc-baseline
```

비대화형 (CI / 재설치):

```bash
npx --yes github:fffight88/cc-baseline --yes
```

> `--yes` (패키지명 앞): npx 자체의 "Ok to proceed?" 프롬프트 건너뜀. `--yes` (패키지명 뒤): cc-baseline 내부 프롬프트 자동 승인.

변경사항 미리보기:

```bash
npx github:fffight88/cc-baseline --dry-run
```

### 버전 고정

`npx github:`는 레포의 기본 브랜치(`main`)에서 설치하며, `main`에는 **릴리즈된** 상태만 올라가므로 위의 미고정 명령은 항상 최신 릴리즈를 받습니다. 특정 릴리즈에 고정하거나 개발 중인 작업을 시험하려면 git ref를 뒤에 붙이세요:

```bash
# 특정 릴리즈 고정 (재현 가능한 설치 / CI에 권장)
npx github:fffight88/cc-baseline#v1.6.0

# 최신 개발본 — 통합 브랜치 (불안정할 수 있음)
npx github:fffight88/cc-baseline#develop
```

> 릴리즈는 `vX.Y.Z` 태그로 끊으며 [CHANGELOG.md](CHANGELOG.md)에 정리됩니다. `main` = 최신 릴리즈, `develop` = 미릴리즈 작업 진행 중.

---

## 프로젝트 로컬 설치

기본적으로 cc-baseline은 글로벌 `~/.claude/`에 설치됩니다. `--project` 플래그를 전달하면 **현재 디렉토리의 `./.claude/`와 `./.mcp.json`에** 설치합니다. 레포에 하네스를 함께 커밋하여 팀원이 클론만 해도 동일한 행동 규칙·에이전트·스킬을 자동으로 상속받도록 하고 싶을 때 사용하세요.

```bash
# 미리보기
npx github:fffight88/cc-baseline --project --dry-run

# ./.claude/ + ./.mcp.json에 설치
npx github:fffight88/cc-baseline --project --yes

# 검진
npx github:fffight88/cc-baseline --project --doctor

# 언인스톨 (프로젝트만 — 글로벌 설치는 건드리지 않음)
npx github:fffight88/cc-baseline --project --uninstall --yes
```

### 글로벌 모드와의 차이점

| | 글로벌 모드 | 프로젝트 모드 (`--project`) |
|---|---|---|
| 대상 디렉토리 | `~/.claude/` | `./.claude/` |
| MCP 설정 | `~/.claude.json` (병합) | `./.mcp.json` (Claude Code가 자동 감지) |
| `CLAUDE.md` 내용 | `{{HOME}}` 치환 절대경로 | 상대경로, 치환 없음 |
| Hook `_ccBaselineId` | `session-start-load-rules` 등 | `project-session-start-load-rules` 등 (prefix로 글로벌 ID와 공존) |
| Playwright MCP 명령어 | `~/.npm-global/bin/playwright-mcp` 절대경로 | `npx -y @playwright/mcp@latest` (휴대성) |
| 외부 바이너리 (semgrep/gitleaks/trivy 등) | 없으면 설치 | **동일** — 어차피 머신 글로벌 도구 |

### 오버레이 vs 단독 모드

글로벌 설치와 프로젝트 설치를 **동시에** 사용할 수 있습니다. Claude Code는 글로벌 + 프로젝트 settings.json을 머지하며, 프로젝트 hook ID의 `project-` prefix 덕분에 둘이 서로 dedup하지 않습니다. 프로젝트 doctor가 이를 명시적으로 보고합니다:

```
✅ Global cc-baseline (informational)
   installed (project hooks layer on top — overlay mode)
```

### 프로젝트 설치 커밋하기

`./.claude/`와 `./.mcp.json`은 커밋 가능합니다. 일반적인 gitignore 항목:

```
# 보통 커밋 (팀 공유):
.claude/CLAUDE.md
.claude/memory/
.claude/agents/
.claude/commands/
.claude/scripts/
.claude/settings.json
.mcp.json

# 보통 무시:
.claude/.cc-baseline-backup/
.claude/.cc-baseline-uninstall-backup/
.claude/.cc-baseline-install.log
.cc-audits/
```

> 첫 실행 신뢰 프롬프트: Claude Code는 프로젝트의 `.mcp.json`을 처음 감지할 때 사용자에게 승인을 요청합니다. 정상 동작이며, 승인하면 5개의 `playwright-test-*` 서버가 활성화됩니다.

### 보안 주의사항 (프로젝트 모드)

`./.claude/memory/`와 `./.mcp.json`은 커밋되어 모든 팀원의 머신에서 실행되므로 다른 실행 가능 산출물과 동일하게 다뤄야 합니다:

- **`.claude/memory/MEMORY.md`와 `.claude/memory/all_session_basic_rules.md`의 변경은 PR에서 리뷰하세요.** 프로젝트 SessionStart 훅은 각 파일이 cc-baseline 시그니처(MEMORY.md는 마커 블록, rules는 frontmatter `name:` 라인)를 포함하는지 검증하고 각각 64KB로 길이를 캡합니다. 검증 실패 시 컨텍스트 주입은 건너뛰고 경고가 표시됩니다.
- **`@playwright/mcp`은 버전 핀** (현재 `@0.0.75`) — `templates/mcp-servers.project.json`에서 `@latest`의 silent supply-chain pull 위험을 차단. 업그레이드: `npm view @playwright/mcp version` → 템플릿 편집 → `--project --yes` 재실행. bump 전 변경 사항과 패키지 changelog 확인.
- **`CLAUDE_PROJECT_DIR`은 무조건 신뢰하지 않음** — 프로젝트 PreToolUse 경로 정책 훅은 `realpath(CLAUDE_PROJECT_DIR) == realpath(cwd)`일 때만 사용하고, 다르면 cwd로 폴백. 환경변수 조작으로 보호 경계를 `./.claude/memory/` 밖으로 옮길 수 없음.

---

## 설치 항목

### 개요

| 컴포넌트 | 설명 |
|---|---|
| 행동 규칙 (`CLAUDE.md`, `memory/*.md`) | 13가지 세션 규칙: 응답 언어, 불확실성, 병렬 읽기, 최소 수정, git 안전성, 사실 독립 검증, 천재적 사고 등 |
| 커스텀 스킬 (`/plan`, `/clean`, `/open-browser`, `/check-log`, `/wiki`, `/verify-claims`) | 플랜 모드 진입; 고아 프로세스 + 프로젝트 개발 서버 + e2e 아티팩트 정리; 수동 테스트용 브라우저 탭(Aside, 대체 Playwright); Fail 진단 수집기; 화면·기능 위키 생성·갱신·점검; 보고 사실의 독립 검증 |
| E2E 테스터 에이전트 (`e2e-tester`) | 브라우저 기반 E2E 테스트 러너 — 매니저 시나리오에 더해 모든 화면에서 런타임 불변식 + 데드컨트롤 스윕을 내장 실행(화이트라벨/콘솔에러 없음; 모든 클릭요소가 효과를 내야 함, 파괴적 컨트롤은 스킵); PASS: 로그 수집 없음; FAIL: 콘솔 + 네트워크 + 서버 로그 → `e2e-results/fail-{N}-{timestamp}.md` |
| Security Auditor 에이전트 (`security-auditor`) | SAST · SCA · 시크릿 스캔 · 프롬프트 인젝션 탐지; 이슈별 구조화된 리포트; 스캐너 미설치 gap 이슈 (HIGH/MEDIUM) |
| Code Reviewer 에이전트 (`code-reviewer`) | 로직 오류 · 엣지 케이스 · CLAUDE.md 위반 · 컨벤션 검사 · 크로스파일 영향 분석 · async/Promise 오류 · 테스트 커버리지 갭; 프로필 무결성 검증; 보안은 security-auditor에 위임 |
| Design Director 에이전트 (`design-director`) | 그린필드 전용 — 레인 분류 · `DESIGN.md` 카탈로그에서 방향 후보 3개와 각 로컬 미리보기 링크 · 사용자 인터뷰 · publisher용 `.cc-audits/design-profile.md` 시드; 화면 작성 안 함 |
| Publisher 에이전트 (`publisher`) | 관리자형 프로젝트 UI 퍼블리싱 — 디자인 프로파일 캐싱(스택/토큰/컴포넌트) · 기획서 분석(md/이미지/pdf/html) · 톤앤매너 반영 · 재사용 우선 마크업 + CSS + 정적 컴포넌트 · 모든 UI 상태 + a11y · 망라 렌더 비교(thead+tbody, 전 상태) + 런타임 불변식 단언 + axe-core 스캔(Aside, 대체 Playwright) · Vercel Web Interface Guidelines 자가점검; 마크업/CSS만(로직/바인딩 제외); 기능 검증은 e2e-tester에 핸드오프 |
| HTML 리포트 생성기 (`scripts/audit-report.js`) | 감사/리뷰 JSON을 심각도 색상 코딩된 HTML로 변환. `node ~/.claude/scripts/audit-report.js <audit-dir>` |
| TC 도구 (`scripts/tc-lint.js`, `tc-jev-check.js`, `tc-jev-judge.js`, `tc-api-run.js`, `tc-fix-loop.js`, `tc-replay.js`, `tc-sweep.js`, `jev-client.js`) | `docs/tc/*.tc.json` 작성 검사(경고만, `--strict`면 실패, `-`면 초안을 표준 입력으로), 기대 결과별 Jev 판정과 문제집(`judge` / `calibrate` / `audit` / `label` / `bank` / `replay` / `record` / `compare`), 실행 설정의 출처·파일로 제한된 API 요청·데이터 읽기(`tc-api-run.js`), 수정 루프 상태(`tc-fix-loop.js`: `start` / `next` / `round` / `classify` / `fix` / `accept` / `tc-change` / `no-result` / `resume` / `report`), 기록 재생(`tc-replay.js`: `check` / `run [--verify]` / `finish` / `urls`), 죽은 버튼 점검(`tc-sweep.js`). Jev는 선택: 키는 `CC_BASELINE_JEV_KEY`, `TYPESAFE_API_KEY`, `~/.config/cc-baseline/jev.env`(권한 600) 순으로 찾음. 모델은 정확한 판본만(기본 `jev-1.14.0`) |
| Aside 세션 헬퍼 (`scripts/aside-session.sh`) | 세션 이름별로 `aside repl` 하나를 유지해 브라우저 단계끼리 탭·변수를 공유 (`start` / `send` / `stop` / `list`) |
| DESIGN.md 미리보기 (`design-previews/` + `scripts/design-preview.js`) | 카탈로그 브랜드마다 하나씩 만든 페이지와 필터 가능한 목록. 각 DESIGN.md의 고유 컴포넌트와 레이아웃으로 만듦. Design Director 인터뷰 동안 `127.0.0.1`에서 띄움 (`start` / `status` / `stop`). 원격 머신이면 `ssh -L <포트>:127.0.0.1:<포트>`로 접속 |
| 훅 설정 (`settings.json hooks`) | SessionStart 메모리 로드, UserPromptSubmit 답 언어 알림(질문마다 그 질문의 언어를 알려, 긴 세션이 파일·도구의 언어로 쏠리지 않게 함), PreToolUse E2E 가이드 주입 · 경로 가드, SessionEnd 프로세스 정리 |
| 테스트 환경 점검 (`scripts/test-env-check.js`, 지침 `memory/reference_test_env.md`) | 첫 e2e 라운드 전에 `base_url` 응답, 리다이렉트가 한 호스트에 머무는지(쿠키), 앱 CSP가 `browser_origins`를 허용하는지, `reset_command` 형식, `test_login_path`가 404가 아닌지, 가짜 외부 API 서버(`external_stubs`)가 loopback인지 점검. `base_url`과 가짜 서버에만 GET, 아무것도 쓰지 않음. 지침은 스키마만 옮긴 테스트 백엔드, 3중 가드 테스트 로그인, 테스트 대상이 아니면 거부하는 reset, 유료 API를 가짜로 바꿔도 되는 조건을 다룸 |
| 위키 도구 (`scripts/wiki.js`) | `docs/wiki/` 문서 상태(`ok` / `stale` / `unstamped` / `broken` / `invalid`, `--strict`면 실패), `stamp`(나열한 파일의 해시 기록, 프로젝트 밖 경로 거부), `index`, route·컴포넌트·API로 `find`. `docs/wiki/` 안의 `.md` 파일만 씀 |
| 사실 검증 에이전트 (`fact-auditor`) + 주장 도구 (`scripts/claims.js`, 가이드 `memory/reference_claim_verification.md`) | 보고 사실의 깨끗한 방 검증: `lint` / `prepare`(고정, 카나리아, 프로젝트 밖 키) / `check-verifiers` / `screen-tc`(+ `tc-run.json` 초안) + `import-results`(화면 항목은 e2e-tester) / `score`(카나리아 탐지, 전제 stale, 증거 등급) / `recheck`(판정이 가리킨 파일 줄, 로그 줄, 읽기 전용 SELECT를 다시 읽음) / `sample`(+ `sample.md`) + `human`(대량, 필요할 때만) / `report`(주장별 표시, 재실행 결과, 사람 표본이 있으면 오류율 상한). fact-auditor가 읽기 전용 검증기를 직접 작성·실행하고, 판단 항목은 Jev `Q.claim_supported@1`(`tc-jev-judge.js claim`)에 묻습니다 |
| MCP 서버 (`~/.claude.json`) | `playwright-test-1~5` 전역 MCP 서버 엔트리 — Playwright 대체 경로 (`playwright-test-1`은 창이 뜨는 `/open-browser` 전용, 2–5는 headless) |

### 파일 설치 상세

템플릿 → 대상 경로 매핑 (마커 블록 병합 / 덮어쓰기 방식), `settings.json`의 `hooks` 및 `.claude.json`의 `mcpServers` JSON 병합 동작.

**자세히 → [docs/ko/install-details.md](docs/ko/install-details.md)**

---

## 자동 설치 도구

### 보안 스캐너

`semgrep`, `gitleaks`, `trivy` 자동 설치:

- **macOS**: `brew install semgrep gitleaks trivy`
- **Linux/WSL**: `~/.local/bin`에 설치 (sudo 불필요)
  - `semgrep` → `~/.local/share/cc-baseline/semgrep-venv`에 격리된 venv, `~/.local/bin`으로 심링크 (Ubuntu 24.04+ PEP 668 우회)
  - `gitleaks` → 최신 GitHub 릴리즈 바이너리, 아키텍처 자동 감지 (x64/arm64)
  - `trivy` → 최신 GitHub 릴리즈 바이너리, SHA256 검증 (x64/arm64)

> **PATH:** `~/.local/bin`이 `$PATH`에 있어야 합니다. 없으면 cc-baseline이 경고를 출력합니다. shell rc에 추가:
> ```bash
> export PATH="$HOME/.local/bin:$PATH"
> ```

이미 설치된 경우 조용히 건너뜁니다. 자동 설치 실패 시 수동 명령어를 출력하고 계속 진행 — 스캐너 없을 때 `security-auditor`는 수동 코드 리뷰로 폴백합니다.

### terminal-notifier (macOS)

macOS에서 `brew install terminal-notifier`로 자동 설치. Notification Center에 직접 등록해 감사 인터뷰 알림을 `osascript`보다 안정적으로 제공합니다. Linux에서는 `notify-send`를 폴백으로 사용합니다.

### Playwright MCP

`@playwright/mcp`를 `~/.npm-global`에 설치:

```bash
npm install -g @playwright/mcp --prefix ~/.npm-global
```

`~/.claude.json`의 5개 `playwright-test-*` MCP 서버 엔트리는 절대 바이너리 경로를 가리키므로 Claude Code 자체에는 PATH 변경이 필요 없습니다.

> **선택 — 터미널에서 사용 시 PATH 추가:**
> ```bash
> export PATH="$HOME/.npm-global/bin:$PATH"
> ```

---

## 옵션

| 플래그 | 설명 |
|---|---|
| `--dry-run` | 파일을 쓰지 않고 예정된 변경사항만 출력 |
| `--yes`, `-y` | cc-baseline 프롬프트 전체 자동 승인. 완전 비대화형 설치는 npx에도 `--yes` 추가: `npx --yes github:fffight88/cc-baseline --yes` |
| `--skip-scanners` | `semgrep`/`gitleaks`/`trivy`, Playwright MCP, Aside 자동 설치 건너뜀. CI나 제한된 네트워크 환경에 유용 |
| `--skip-aside` | Aside 설치 건너뜀(Homebrew cask 앱, 백그라운드 데몬, 서명 검증한 `aside` CLI). 브라우저 작업은 Playwright MCP만 사용 |
| `--aside-account <id>` | 자동 테스트 전용 프로필의 Aside 계정(`aside account list`, 예: `u2`). `~/.claude/cc-baseline-browser.json`에 기록 |
| `--dedupe-legacy` | 마커 블록 도입 이전 설치가 남긴 `CLAUDE.md` / `MEMORY.md`의 오래된 중복 사본 제거. 제거 전 백업됨 |
| `--doctor` | 설치 상태 검증(파일·훅·MCP 서버·스캐너·드리프트). 모든 검사 통과 시 0, 아니면 1로 종료 |
| `--version`, `-v` | 버전 출력 |
| `--help`, `-h` | 도움말 표시 |

### axe-core (로컬)

`npm install --prefix ~/.claude/vendor axe-core@4` — publisher의 a11y 런타임 검사는 이 로컬 사본을 `page.addScriptTag({ path })`로 넣습니다. 화면에 실데이터가 있을 수 있고 외부 스크립트는 그 데이터가 나가는 통로가 될 수 있어서, CDN에서는 절대 불러오지 않습니다. 없으면 검사를 건너뛰고 `--doctor`가 경고합니다. `--skip-scanners`면 설치하지 않고, `--uninstall --remove-scanners`로 지웁니다.

### 설치 확인

```bash
npx github:fffight88/cc-baseline --doctor
```

13개 검사 수행: `~/.claude/` 존재, manifest 무결성, 마커 블록, 마커 이전 중복 내용, 파일 드리프트, 관리되는 훅 4개 전부, MCP 서버(`playwright-test-1`이 headless면 경고), 보안 스캐너, Playwright MCP 바이너리, Replay browser(`tc-replay.js` / `tc-sweep.js`용 Playwright 모듈), Aside(CLI를 실제 실행해 테스트 계정 확인 — Playwright가 대체하므로 경고만), notifier, Jev 키(선택).

---

## 설치되는 훅

| 이벤트 | Matcher | 역할 |
|---|---|---|
| `SessionStart` | (없음) | `~/.claude/memory/MEMORY.md`와 세션 규칙을 컨텍스트에 주입 |
| `PreToolUse` | `Write\|Edit` | `/.cc-audits/`에 대한 쓰기 자동 승인; `~/.claude/memory/` 쓰기 차단 후 프로젝트 메모리 경로로 리디렉션 |
| `PreToolUse` | `mcp__playwright-test-.*\|Bash` | 에이전트마다(메인 세션·각 서브에이전트) 첫 Playwright MCP 호출 또는 `aside repl` 명령에서 E2E 매니저 가이드를 1회 주입. 다른 Bash 호출은 무시 |
| `SessionEnd` | (없음) | 고아 claude 프로세스 정리 |

### 경로 정책 훅 상세

모든 Write/Edit 시도에 순서대로 적용:

1. **차단 (deny):** `~/.claude/memory/`는 cc-baseline 전용 관리 경로. 모델이 직접 쓰려 하면 차단 후 `~/.claude/projects/…/memory/`를 제안.
2. **자동 승인 (allow):** `/.cc-audits/`가 포함된 경로는 자동 승인 — `security-auditor`와 `code-reviewer`가 리포트를 쓰는 곳.

두 검사 모두 `os.path.realpath()`로 경로를 정규화해 심링크 또는 `../` 트래버설 우회를 방지합니다.

---

## 훅 충돌 경고 가이드

설치 프로그램이 기존 `~/.claude/settings.json` 훅을 4가지 규칙으로 검사합니다 — SessionStart 중복, 광범위한 PreToolUse matcher, 차단 훅, 기존 SessionEnd 항목에 대한 경고를 출력합니다.

**자세히 → [docs/ko/hook-conflicts.md](docs/ko/hook-conflicts.md)**

---

## 설치 후 memory/ 파일 편집

`~/.claude/memory/`는 `PreToolUse` 훅이 Claude의 `Write`/`Edit` 도구를 **차단**합니다 (자동 메모리 쓰기가 `~/.claude/projects/...`로 가도록). 디렉토리 자체는 일반 권한(755)이므로 **어떤 에디터로든 수동 편집 가능**합니다.

> **참고:** 수동 편집은 다음 `cc-baseline` 설치 시 덮어씌워집니다. 커스터마이징하려면 레포를 포크하고 `templates/memory/`를 수정하세요.

> **이전 버전(≤ v1.0.x) 마이그레이션:** 이전 릴리즈는 이 디렉토리를 `chmod 555`로 잠갔습니다. 설치 프로그램 재실행 시 자동으로 권한이 복원됩니다.

---

## 백업 & 복구

### 백업 위치

수정되는 파일은 설치 전마다 스냅샷됩니다:

```
~/.claude/.cc-baseline-backup/<ISO-timestamp>/
```

### 복구

```bash
# 예시: CLAUDE.md 복원
cp ~/.claude/.cc-baseline-backup/<timestamp>/.claude/CLAUDE.md ~/.claude/CLAUDE.md
```

---

## 언인스톨

### 자동 (권장)

```bash
npx github:fffight88/cc-baseline --uninstall
```

```bash
# 미리보기
npx github:fffight88/cc-baseline --uninstall --dry-run

# 비대화형
npx github:fffight88/cc-baseline --uninstall --yes

# 백업과 스캐너까지 모두 제거
npx github:fffight88/cc-baseline --uninstall --yes --purge --remove-scanners
```

언인스톨 전 스냅샷이 `~/.claude/.cc-baseline-uninstall-backup/<timestamp>/`에 저장됩니다.

| 옵션 | 효과 |
|---|---|
| `--uninstall` | 하네스 파일 제거 (백업과 외부 스캐너 보존) |
| `--dry-run` | 미리보기만 |
| `--yes` | 비대화형; 외부 스캐너 건드리지 않음 |
| `--purge` | `~/.claude/.cc-baseline-backup/`도 삭제 |
| `--remove-scanners` | semgrep/gitleaks/trivy + @playwright/mcp 언인스톨 |

### 수동 제거

자동 언인스톨러를 사용할 수 없는 경우, [docs/ko/uninstall-manual.md](docs/ko/uninstall-manual.md)의 단계별 절차(마커 블록, memory 파일, 에이전트, 커맨드, 스크립트, 훅, MCP 서버)를 참고하세요.

---

## 템플릿 업데이트

커스터마이즈해서 재배포하려면: 레포를 포크하고, `templates/`를 편집하고, `{{HOME}}`을 `$HOME` 플레이스홀더로 사용하고, 커밋 전 민감 정보를 스캔하세요.

**자세히 → [docs/ko/updating-templates.md](docs/ko/updating-templates.md)**

---

## Playwright 수동 테스트

`/open-browser`와 `/check-log`를 사용하면 브라우저 탭(Aside 테스트 계정 창, 대체로 창이 뜨는 `playwright-test-1`)에서 직접 테스트하고, Claude가 진단 정보를 수집하게 할 수 있습니다.

### 워크플로우

> **`/check-log`는 반드시 `/open-browser`로 브라우저를 먼저 열어야 사용할 수 있습니다.** `/check-log`는 `/open-browser`가 저장한 `.claude/browser-session.json`을 읽어 어떤 브라우저(Aside 세션 또는 Playwright MCP 서버)를 읽을지 파악합니다. 활성 브라우저 세션 없이 실행하면 먼저 `/open-browser <url>`을 실행하라는 안내가 표시됩니다.

```
1.  개발 서버 시작:  npm run dev 2>&1 | tee server.log
2.  /open-browser http://localhost:3000   →  탭 열림 (Aside 테스트 계정, 또는 playwright-test-1)
3.  브라우저에서 직접 버그 재현
4.  /check-log server.log                →  콘솔 + 네트워크 + 서버 로그 수집
5.  e2e-results/fail-manual-{timestamp}.md  자동 생성
6.  Claude가 분석 후 디버깅 진행 여부 확인
7.  /clean                               →  프로젝트 개발 서버 + Aside 세션 정지, fail-* + 브라우저 세션 상태 삭제
```

### Fail 아티팩트 내용 (에러 발생 시)

| 섹션 | 출처 |
|---|---|
| 콘솔 에러 | Aside: `__e2e` 페이지 기록기 · Playwright: `browser_console_messages` |
| 네트워크 요청 | Aside: 기록기의 실패한 fetch/XHR · Playwright: `browser_network_requests` (메서드 · URL · 상태코드) |
| 실패 요청 (4xx/5xx) | 헤더 · 요청 파라미터 · 응답 본문 |
| 서버 로그 — 에러 & 경고 | `grep -E "ERROR\|WARN"` |
| 서버 로그 — 최근 200줄 | `tail -n 200` |

> **에러가 감지되지 않으면 파일을 생성하지 않습니다** — "No issues detected"를 보고하고 종료합니다.

### E2E 에이전트 Fail 아티팩트

`e2e-tester` 에이전트도 동일한 정책을 자동으로 따릅니다:
- **PASS** → 파일 생성 없음
- **FAIL** → `e2e-results/fail-{N}-{timestamp}.md` 생성 (N = 테스터 번호), 경로를 리포트에 포함

`playwright-test-1`과 Aside 세션 `manual`은 `/open-browser` 전용입니다. 매니저는 e2e-tester마다 N = 2–5를 배정합니다: Aside 세션 `e2e-{N}` 우선, 대체는 `playwright-test-{N}`. `reference_browser_tools.md` 참고.

---

## 감사 리포트 저장 위치

`security-auditor`, `code-reviewer`, `publisher`는 리포트를 여기에 씁니다:

```
<project-root>/.cc-audits/<plan-slug>/iter-<n>.{md,json}
<project-root>/.cc-audits/<plan-slug>/code-review-iter-<n>.{md,json}
<project-root>/.cc-audits/<plan-slug>/publish-<screen-slug>-iter-<n>.{md,json}
<project-root>/.cc-audits/design-profile.md   # 공유 디자인 시스템 프로파일 (publisher)
```

- `~/.claude/` 외부 — Claude Code 경로 보호 프롬프트 없음
- PreToolUse 훅이 `/.cc-audits/` 경로의 Write/Edit을 자동 승인
- 스캔 루프 완료 시 HTML 리포트 생성: `node ~/.claude/scripts/audit-report.js <audit-dir>`

**권장:** 프로젝트 `.gitignore`에 `.cc-audits/` 추가.

---

## 보안 정책: `permissions` 키 배포 금지

cc-baseline은 `~/.claude/settings.json`의 `permissions` 키를 절대 읽거나 쓰지 않습니다:

- `permissions.allow` 규칙은 Claude Code의 사용자 동의 프롬프트를 우회합니다 (예: `Bash(*)`는 모든 셸 명령을 조용히 허용)
- 퍼미션 규칙을 베이스라인의 일부로 배포하는 것은 공급망 위험입니다
- `Edit(~/.claude/**)` 같은 규칙은 Claude Code의 내장 `.claude/` 경로 보호도 우회합니다

**원칙:** 퍼미션 규칙은 각 사용자가 자신의 환경에 맞게 직접 추가해야 합니다. 설치 프로그램은 이를 생성하거나 수정하지 않습니다.

---

## 보안 & 프라이버시

- `templates/`에는 사용자명, 비밀번호, API 키, 연결 문자열이 없습니다
- 훅 명령어의 모든 경로는 `{{HOME}}`으로 저장되고 설치 시 치환됩니다
- 설치 로그(`~/.claude/.cc-baseline-install.log`), 백업, 감사 리포트(`.cc-audits/`)는 `.gitignore`에 등록됩니다
- `~/.claude.json`에서는 `playwright-test-1~5`만 읽고 씁니다; 다른 키는 건드리지 않습니다
- Jev 키가 설정되면 `tc-jev-check.js`는 TC 기대 결과 문장을, `tc-jev-judge.js`는 관측한 화면 텍스트(URL·제목·보이는 글·접근성 요약)를 이메일·전화/카드/주민번호·토큰과 테스터가 지정한 비밀 입력값을 가린 뒤 TypeSafe API로 보냅니다 — 테스트 계정·테스트 데이터를 쓰세요. 키가 없으면 아무것도 보내지 않습니다. 판정 표본·재검사·보정은 지우기 전까지 `~/.claude/jev/`(권한 700)에 남습니다(`rm -r ~/.claude/jev`로 전부 삭제, `~/.claude/jev/requests/`에는 가린 화면 텍스트가 있습니다). `bank --export`는 무시되지 않은 git 작업 트리 안으로는 복사하지 않습니다. 키는 결과·표본·로그 어디에도 쓰지 않습니다. `tc-api-run.js`는 세션 쿠키를 `.cc-audits/<plan>/api-sessions/`(권한 600)에 두고, 출력에서 쿠키·인증 헤더·토큰을 가립니다. 재생·스윕 파일은 `.cc-audits/<plan>/` 아래(권한 600)에 둡니다.
  - `replay/<tc>.json`: 기록. 비밀은 `$ENV` 이름만 남깁니다
  - `replay-accepted.json`
  - `replay-state/<session>.json`: 브라우저 로그인(쿠키·로컬 스토리지)
  - `obs/`: 비밀 입력값을 가린 화면 텍스트
  - `sweep/`
  - `findings.json`: 수정 루프 상태

---

## 기술 스택 & 구조

- **런타임:** Node.js 18+ (외부 의존성 없음 — 내장 모듈만 사용)
- **배포:** 공개 GitHub 레포 → `npx github:fffight88/cc-baseline`

```
cc-baseline/
├── bin/cli.js              # CLI 진입점 (shebang + 인수 파싱)
├── src/
│   ├── install.js          # 설치 오케스트레이션
│   ├── paths.js            # {{HOME}} ↔ $HOME 치환
│   ├── backup.js           # 타임스탬프 백업
│   ├── prompt.js           # readline Y/n 프롬프트
│   ├── conflict-checker.js # 훅 충돌 감지 (4가지 규칙)
│   └── merge/
│       ├── markdown.js        # 마커 블록 병합
│       ├── settings-hooks.js  # hooks statusMessage 중복 제거 병합
│       └── mcp-servers.js     # mcpServers 키 병합
└── templates/              # 번들 파일 ({{HOME}} 플레이스홀더)
    ├── CLAUDE.md
    ├── memory/             # MEMORY.md + 21개 규칙·참조 파일
    ├── agents/             # e2e-tester.md, security-auditor.md, code-reviewer.md, design-director.md, publisher.md, fact-auditor.md
    ├── commands/           # plan.md, clean.md, open-browser.md, check-log.md, wiki.md, verify-claims.md
    ├── scripts/            # audit-report.js, aside-session.sh, design-preview.js, tc-lint.js, jev-client.js, tc-jev-check.js, tc-jev-judge.js, tc-api-run.js, tc-fix-loop.js, tc-replay.js, tc-sweep.js, test-env-check.js, wiki.js, claims.js
    ├── design-previews/    # DESIGN.md 카탈로그 브랜드별 미리보기 페이지 + 목록
    ├── settings-hooks.json # hooks 섹션만
    └── mcp-servers.json    # playwright-test-1~5만
```

---

## 문제 해결

자주 발생하는 이슈 — Windows/WSL, Node 버전, `~/.claude/` 권한, 스캐너 설치 실패, JSON 파싱 오류, 오래된 npx 캐시, Playwright MCP 연결 문제 — 는 별도 문서로 분리되어 있습니다.

**자세히 → [docs/ko/troubleshooting.md](docs/ko/troubleshooting.md)**
