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

- **11가지 행동 규칙** — 세션 시작 시 로드: 응답 언어, 불확실성 공개, 병렬 읽기, 최소 수정 등
- **Security Auditor 에이전트** — semgrep/gitleaks/trivy로 실제 SAST·SCA·시크릿 스캔 수행. 이슈별 `decision_type`(auto / design / business)이 포함된 구조화된 JSON+Markdown 리포트 생성; `claude-config` 타입에서 에이전트/커맨드 정의 파일의 **프롬프트 인젝션 패턴** 탐지; 스캐너 미설치 시 silent skip 대신 **HIGH/MEDIUM `scanner-gap` 이슈**로 명시적 보고
- **Code Reviewer 에이전트** — 보안 패스와 독립적으로 로직 오류, 엣지 케이스, 컨벤션 위반, CLAUDE.md 준수 여부 검사; **크로스파일 영향 분석**으로 export 변경이 의존 파일에 미치는 breaking change 탐지 (JS/TS/Python/Go); **async/Promise 패턴 오류** 탐지 (`await` 누락, unhandled rejection, `Promise.all` 오용); **테스트 커버리지 갭** 확인 (테스트 없는 새 export, 시그니처 변경 후 미업데이트 테스트); 매 로드 시 body hash로 **`project-patterns.md` 무결성 검증** — 변조 감지 시 `QA-PROFILE-TAMPER` 이슈 생성
- **HTML 리포트 생성기** (`audit-report.js`) — 감사 JSON을 색상 코딩된 심각도 정렬 웹 페이지로 변환. 스캔 루프 완료 시 자동으로 열림
- **안정적인 알림** — macOS에서 `terminal-notifier` 자동 설치. design/business 결정 인터뷰 프롬프트를 놓치지 않도록 보장
- **E2E 테스터 에이전트** — 5개 병렬 Playwright MCP 서버 기반. FAIL 시 브라우저 콘솔·네트워크 헤더/페이로드·서버 로그 자동 수집 → `e2e-results/fail-{N}-{timestamp}.md` 저장. PASS 시 로그 수집 없음
- **`/open-browser` 스킬** — 수동 테스트용 Playwright 브라우저(`playwright-test-1`) 오픈. 세션 상태를 저장해 `/check-log`가 동일한 MCP 서버를 참조할 수 있게 함
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
| 행동 규칙 (`CLAUDE.md`, `memory/*.md`) | 11가지 세션 규칙: 응답 언어, 불확실성, 병렬 읽기, 최소 수정, git 안전성 등 |
| 커스텀 스킬 (`/plan`, `/clean`, `/open-browser`, `/check-log`) | 플랜 모드 진입; 고아 프로세스 + e2e 아티팩트 정리; 수동 테스트용 Playwright 브라우저; Fail 진단 수집기 |
| E2E 테스터 에이전트 (`e2e-tester`) | 브라우저 기반 E2E 테스트 러너 — PASS: 로그 수집 없음; FAIL: 콘솔 + 네트워크 + 서버 로그 → `e2e-results/fail-{N}-{timestamp}.md` |
| Security Auditor 에이전트 (`security-auditor`) | SAST · SCA · 시크릿 스캔 · 프롬프트 인젝션 탐지; 이슈별 구조화된 리포트; 스캐너 미설치 gap 이슈 (HIGH/MEDIUM) |
| Code Reviewer 에이전트 (`code-reviewer`) | 로직 오류 · 엣지 케이스 · CLAUDE.md 위반 · 컨벤션 검사 · 크로스파일 영향 분석 · async/Promise 오류 · 테스트 커버리지 갭; 프로필 무결성 검증; 보안은 security-auditor에 위임 |
| HTML 리포트 생성기 (`scripts/audit-report.js`) | 감사/리뷰 JSON을 심각도 색상 코딩된 HTML로 변환. `node ~/.claude/scripts/audit-report.js <audit-dir>` |
| 훅 설정 (`settings.json hooks`) | SessionStart 메모리 로드, PreToolUse E2E 가이드 주입 · 경로 가드, SessionEnd 프로세스 정리 |
| MCP 서버 (`~/.claude.json`) | `playwright-test-1~5` 전역 MCP 서버 엔트리 (`playwright-test-1`은 `/open-browser` 수동 세션용 예약) |

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
| `--help`, `-h` | 도움말 표시 |

---

## 설치되는 훅

| 이벤트 | Matcher | 역할 |
|---|---|---|
| `SessionStart` | (없음) | `~/.claude/memory/MEMORY.md`와 세션 규칙을 컨텍스트에 주입 |
| `PreToolUse` | `Write\|Edit` | `/.cc-audits/`에 대한 쓰기 자동 승인; `~/.claude/memory/` 쓰기 차단 후 프로젝트 메모리 경로로 리디렉션 |
| `PreToolUse` | `mcp__playwright-test-.*` | 세션당 첫 Playwright MCP 호출 시 E2E 매니저 가이드를 컨텍스트에 주입 |
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

`/open-browser`와 `/check-log`를 사용하면 Playwright가 제어하는 브라우저에서 직접 테스트하고, Claude가 진단 정보를 수집하게 할 수 있습니다.

### 워크플로우

> **`/check-log`는 반드시 `/open-browser`로 브라우저를 먼저 열어야 사용할 수 있습니다.** `/check-log`는 `/open-browser`가 저장한 `.claude/browser-session.json`을 읽어 어떤 Playwright MCP 서버를 쿼리할지 파악합니다. 활성 브라우저 세션 없이 실행하면 먼저 `/open-browser <url>`을 실행하라는 안내가 표시됩니다.

```
1.  개발 서버 시작:  npm run dev 2>&1 | tee server.log
2.  /open-browser http://localhost:3000   →  브라우저 열림 (playwright-test-1)
3.  브라우저에서 직접 버그 재현
4.  /check-log server.log                →  콘솔 + 네트워크 + 서버 로그 수집
5.  e2e-results/fail-manual-{timestamp}.md  자동 생성
6.  Claude가 분석 후 디버깅 진행 여부 확인
7.  /clean                               →  fail-*.md + 브라우저 세션 상태 삭제
```

### Fail 아티팩트 내용 (에러 발생 시)

| 섹션 | 출처 |
|---|---|
| 콘솔 에러 | `browser_console_messages` |
| 네트워크 요청 | `browser_network_requests` (메서드 · URL · 상태코드) |
| 실패 요청 (4xx/5xx) | 헤더 · 요청 파라미터 · 응답 본문 |
| 서버 로그 — 에러 & 경고 | `grep -E "ERROR\|WARN"` |
| 서버 로그 — 최근 200줄 | `tail -n 200` |

> **에러가 감지되지 않으면 파일을 생성하지 않습니다** — "No issues detected"를 보고하고 종료합니다.

### E2E 에이전트 Fail 아티팩트

`e2e-tester` 에이전트도 동일한 정책을 자동으로 따릅니다:
- **PASS** → 파일 생성 없음
- **FAIL** → `e2e-results/fail-{N}-{timestamp}.md` 생성 (N = MCP 서버 번호), 경로를 리포트에 포함

`playwright-test-1`은 `/open-browser` 수동 세션용으로 예약됩니다. 매니저는 자동화 실행 시 `playwright-test-2` ~ `playwright-test-5`를 e2e-tester 에이전트에 할당합니다.

---

## 감사 리포트 저장 위치

`security-auditor`와 `code-reviewer`는 리포트를 여기에 씁니다:

```
<project-root>/.cc-audits/<plan-slug>/iter-<n>.{md,json}
<project-root>/.cc-audits/<plan-slug>/code-review-iter-<n>.{md,json}
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
    ├── memory/             # MEMORY.md + 10개 규칙 파일
    ├── agents/             # e2e-tester.md, security-auditor.md, code-reviewer.md
    ├── commands/           # plan.md, clean.md, open-browser.md, check-log.md
    ├── scripts/            # audit-report.js
    ├── settings-hooks.json # hooks 섹션만
    └── mcp-servers.json    # playwright-test-1~5만
```

---

## 문제 해결

자주 발생하는 이슈 — Windows/WSL, Node 버전, `~/.claude/` 권한, 스캐너 설치 실패, JSON 파싱 오류, 오래된 npx 캐시, Playwright MCP 연결 문제 — 는 별도 문서로 분리되어 있습니다.

**자세히 → [docs/ko/troubleshooting.md](docs/ko/troubleshooting.md)**
