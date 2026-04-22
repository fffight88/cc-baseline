# cc-baseline

Claude Code 하네스 번들 인스톨러 — 행동 규칙·커스텀 스킬·E2E 에이전트·훅 설정을 새 머신에 한 줄로 설치합니다.

---

## 개요

`cc-baseline`은 아래 구성 요소를 `~/.claude/` 전역에 설치합니다. 기존 설정은 **덮어쓰지 않고 병합**하며, 설치 전 자동 백업을 생성합니다.

| 구성 요소 | 설명 |
|---|---|
| 행동 규칙 (`CLAUDE.md`, `memory/*.md`) | 응답 언어·불확실성 명시·병렬 읽기·최소 수정 등 8개 기본 규칙 |
| 커스텀 스킬 (`/plan`, `/clean`) | 플랜 모드 진입 스킬, 고아 프로세스 정리 스킬 |
| E2E 테스터 에이전트 (`e2e-tester`) | Playwright MCP 기반 브라우저 E2E 테스트 실행 에이전트 |
| 보안 감사 에이전트 (`security-auditor`) | 독립 감사자 관점의 SAST·SCA·시크릿 스캔 + 구조화 리포트 생성 |
| 훅 설정 (`settings.json hooks`) | SessionStart 메모리 로드, PreToolUse E2E 가이드 로드 · cc-baseline 경로 보호, SessionEnd 프로세스 정리 |
| MCP 서버 (`~/.claude.json`) | `playwright-test-1~5` 전역 MCP 서버 설정 |

---

## 요구사항

- **Node.js 18 이상**
- macOS 또는 Linux (Windows 네이티브 미지원 — WSL 환경에서는 사용 가능)
- `~/.claude/` 폴더에 쓰기 권한

---

## 보안 스캐너 자동 설치

설치 시 `semgrep`, `gitleaks`, `trivy` 세 가지 보안 스캐너를 자동으로 설치합니다:

- **macOS**: `brew install semgrep gitleaks trivy`
- **Linux/WSL**: pipx(semgrep) + GitHub 공식 바이너리(gitleaks, trivy)

스캐너가 이미 설치되어 있으면 건너뜁니다. 자동 설치에 실패해도 cc-baseline 설치 자체는 완료되며, 실패 메시지만 출력됩니다. 스캐너가 없을 때 `security-auditor` 에이전트는 수동 코드 리뷰로 자동 폴백합니다.

---

## 빠른 시작

```bash
npx github:fffight88/cc-baseline
```

변경 내용을 먼저 확인하고 싶다면:

```bash
npx github:fffight88/cc-baseline --dry-run
```

---

## 설치 항목 상세

### 파일 설치 방식

| 파일 | 타겟 경로 | 방식 |
|---|---|---|
| `CLAUDE.md` | `~/.claude/CLAUDE.md` | 마커 블록 머지 — 기존 내용 보존, `<!-- BEGIN cc-baseline -->` 블록만 추가/교체 |
| `memory/MEMORY.md` | `~/.claude/memory/MEMORY.md` | 마커 블록 머지 |
| `memory/all_session_basic_rules.md` | `~/.claude/memory/` 동명 | 덮어쓰기 (설치 전 백업) |
| `memory/doc_structure_rules.md` | 〃 | 덮어쓰기 |
| `memory/phase_start.md` | 〃 | 덮어쓰기 |
| `memory/phase_end.md` | 〃 | 덮어쓰기 |
| `memory/reference_e2e_manager_guide.md` | 〃 | 덮어쓰기 |
| `memory/reference_subagent_boundary.md` | 〃 | 덮어쓰기 |
| `memory/reference_doc_writing_style.md` | 〃 | 덮어쓰기 |
| `memory/feedback_skill_description_budget.md` | 〃 | 덮어쓰기 |
| `memory/reference_security_auditor_protocol.md` | 〃 | 덮어쓰기 |
| `agents/e2e-tester.md` | `~/.claude/agents/e2e-tester.md` | 덮어쓰기 |
| `agents/security-auditor.md` | `~/.claude/agents/security-auditor.md` | 덮어쓰기 |
| `commands/plan.md` | `~/.claude/commands/plan.md` | 덮어쓰기 |
| `commands/clean.md` | `~/.claude/commands/clean.md` | 덮어쓰기 |

### JSON 병합 방식

| 대상 | 방식 |
|---|---|
| `~/.claude/settings.json`의 `hooks` 키 | `statusMessage` 기준으로 하네스 훅만 교체. 사용자의 기존 훅은 유지 |
| `~/.claude.json`의 `mcpServers` 키 | `playwright-test-1~5`만 추가. 동명 키가 있으면 대화형 확인 후 덮어쓰기 |

> **건드리지 않는 것:** `settings.json`의 `env`, `model`, `effortLevel` 등 개인 선호 설정, `~/.claude.json`의 사용 통계·UI 상태 등

---

## 옵션 플래그

| 플래그 | 설명 |
|---|---|
| `--dry-run` | 파일 변경 없이 설치 예정 항목만 출력. 먼저 실행해서 확인 권장 |
| `--yes`, `-y` | 충돌 경고·대화형 확인을 모두 자동 승인. CI/자동화 환경에서 사용 |
| `--help`, `-h` | 도움말 출력 |

---

## 설치되는 훅 목록

| 이벤트 | matcher | 역할 |
|---|---|---|
| `SessionStart` | (없음) | 세션 시작 시 `~/.claude/memory/MEMORY.md`와 기본 규칙을 컨텍스트에 주입 |
| `PreToolUse` | `Write\|Edit` | `~/.claude/memory/`에 쓰기 시도를 차단하고 모델에게 올바른 경로(`~/.claude/projects/…/memory/`)를 피드백 |
| `PreToolUse` | `mcp__playwright-test-.*` | Playwright MCP 호출 시 E2E 매니저 가이드를 컨텍스트에 주입 (세션당 1회) |
| `SessionEnd` | (없음) | 세션 종료 시 고아 claude 프로세스 정리 |

### cc-baseline 경로 보호 훅 상세

`~/.claude/memory/`는 수동으로 관리하는 전용 경로입니다. Claude Code 내장 auto-memory 시스템이 자동으로 학습 내용을 저장하는 경로(`~/.claude/projects/…/memory/`)와 분리되어 있습니다.

이 훅은 모델이 실수로 `~/.claude/memory/`에 자동 저장하려 할 때 차단하고, 올바른 auto-memory 경로로 안내합니다. 사용자 UI에는 표시되지 않으며 모델에게만 피드백이 전달됩니다.

경로는 `os.path.expanduser('~/.claude/memory/')`로 런타임에 동적 결정되므로 사용자명이 하드코딩되지 않습니다.

---

## 훅 충돌 경고 해석 가이드

설치 시 기존 `~/.claude/settings.json`의 훅과 충돌 여부를 자동으로 검사합니다. 아래 4가지 규칙을 기준으로 경고가 출력됩니다.

### 규칙 1: `[WARN]` SessionStart 기존 훅 존재

```
[WARN] SessionStart 이벤트에 기존 훅이 있습니다.
이유: cc-baseline도 SessionStart에서 메모리 컨텍스트를 주입합니다.
     상충되는 지시가 있으면 Claude 동작이 예상과 달라질 수 있습니다.
조치: 설치 후 ~/.claude/settings.json의 SessionStart hooks를 검토하고 필요 시 통합하세요.
```

**대응법:** 기존 SessionStart 훅의 역할을 확인한 뒤 중복이라면 제거하고, cc-baseline 훅과 역할이 다르다면 하나의 python 스크립트로 통합하는 것을 권장합니다.

### 규칙 2: `[WARN]` PreToolUse matcher 겹침

```
[WARN] PreToolUse matcher ".*"가 playwright-test MCP와 겹칩니다.
이유: E2E 가이드 주입 훅과 이중 실행되거나, playwright MCP 호출 자체가 차단될 수 있습니다.
조치: 해당 훅의 matcher를 구체화하거나 cc-baseline 훅과 통합하세요.
```

**대응법:** `".*"` 같은 포괄 matcher를 사용하는 기존 훅이 있다면 `mcp__playwright-test-.*`를 제외하는 정규식으로 변경하세요.

### 규칙 3: `[HIGH]` 차단 훅 감지 — 즉시 조치 필요

```
[HIGH] 세션 또는 도구를 차단하는 훅이 감지됩니다.
이유: 이 훅이 실행되면 cc-baseline 부트업 또는 MCP 호출 자체가 막힐 수 있습니다.
조치: 해당 훅을 제거하거나 cc-baseline 설치 전 수동으로 검토하세요.
```

**대응법:** `decision: block` 또는 `decision: deny`를 반환하는 훅이 있습니다. 이 훅이 의도적인 경우 cc-baseline 훅이 통과되도록 조건을 수정해야 합니다. 그렇지 않다면 불필요한 훅이므로 제거하세요.

### 규칙 4: `[INFO]` SessionEnd 기존 훅 존재

```
[INFO] SessionEnd에 기존 훅이 있습니다.
이유: cc-baseline의 SessionEnd 훅과 함께 실행됩니다. 충돌 위험은 낮습니다.
조치: 특별한 조치 없음.
```

**대응법:** 정보 제공용입니다. 두 훅이 함께 실행되며 일반적으로 문제없습니다.

---

## memory/ 파일 수정 방법

설치 후 `~/.claude/memory/` 디렉토리는 **읽기 전용(chmod 555)**으로 잠깁니다. cc-baseline 경로를 auto-memory가 오염시키는 것을 막기 위한 보호 장치입니다.

파일을 수정하려면 잠금을 임시 해제한 뒤 작업하고 다시 잠그세요:

```bash
# 1. 잠금 해제
chmod 755 ~/.claude/memory/

# 2. 원하는 파일 수정
#    예: MEMORY.md에 새 항목 추가, 규칙 파일 편집 등

# 3. 수정 완료 후 다시 잠금
chmod 555 ~/.claude/memory/
```

> **주의:** 잠금 해제 상태로 두면 Claude Code auto-memory가 이 경로에 자동 저장할 수 있습니다. 수정 후 반드시 `chmod 555`로 복구하세요.

---

## 백업 및 복구

### 백업 위치

설치 시 수정 대상 파일의 원본이 자동으로 아래 경로에 저장됩니다:

```
~/.claude/.cc-baseline-backup/<ISO-타임스탬프>/
```

예시:
```
~/.claude/.cc-baseline-backup/2026-04-20T12-00-00-000Z/
  .claude/
    CLAUDE.md
    settings.json
    memory/
      MEMORY.md
      all_session_basic_rules.md
      ...
```

### 복구 방법

특정 파일을 되돌리려면 백업 폴더에서 원본을 수동 복사합니다:

```bash
# 예시: CLAUDE.md 복구
cp ~/.claude/.cc-baseline-backup/<타임스탬프>/.claude/CLAUDE.md ~/.claude/CLAUDE.md

# 예시: settings.json 복구
cp ~/.claude/.cc-baseline-backup/<타임스탬프>/.claude/settings.json ~/.claude/settings.json
```

---

## 제거(Uninstall)

cc-baseline이 설치한 항목을 제거하려면 아래 절차를 수동으로 수행합니다.

### 1. CLAUDE.md에서 마커 블록 제거

```bash
# 마커 블록 확인
grep -n "cc-baseline" ~/.claude/CLAUDE.md

# 편집기에서 <!-- BEGIN cc-baseline --> ... <!-- END cc-baseline --> 블록 삭제
```

### 2. memory/ 파일 제거

```bash
# 디렉토리 잠금 해제 후 삭제
chmod 755 ~/.claude/memory/
rm ~/.claude/memory/all_session_basic_rules.md
rm ~/.claude/memory/doc_structure_rules.md
rm ~/.claude/memory/phase_start.md
rm ~/.claude/memory/phase_end.md
rm ~/.claude/memory/reference_e2e_manager_guide.md
rm ~/.claude/memory/reference_subagent_boundary.md
rm ~/.claude/memory/reference_doc_writing_style.md
rm ~/.claude/memory/feedback_skill_description_budget.md
```

### 3. agents, commands 제거

```bash
rm ~/.claude/agents/e2e-tester.md
rm ~/.claude/commands/plan.md
rm ~/.claude/commands/clean.md
```

### 4. settings.json hooks 제거

`~/.claude/settings.json`을 열어 아래 statusMessage를 가진 훅 항목을 삭제합니다:
- `"statusMessage": "세션 기본 규칙 로딩 중..."`
- `"statusMessage": "cc-baseline 경로 보호 확인 중..."`
- `"statusMessage": "E2E 테스트 가이드 로딩 중..."`
- SessionEnd의 `pgrep -f 'claude'` 커맨드 항목

### 5. MCP 서버 제거 (선택)

`~/.claude.json`의 `mcpServers`에서 `playwright-test-1` ~ `playwright-test-5` 키를 삭제합니다.

---

## 템플릿 업데이트 워크플로우

본인 머신의 설정이 변경되어 번들을 갱신하려면:

```bash
# 1. 리포 클론 또는 이동
cd /path/to/cc-baseline

# 2. templates/ 내 해당 파일 직접 수정
#    (또는 ~/.claude/에서 복사 후 {{HOME}} 플레이스홀더 치환)

# 3. 민감 정보 스캔
grep -rE "$(whoami)|/Users/|/home/" templates/

# 4. 커밋 & 푸시
git add templates/ && git commit -m "feat: update harness templates"
git push
```

> ⚠️ 커밋 전 반드시 실제 사용자명·경로가 없는지 확인하세요.

---

## 트러블슈팅

### Windows에서 실행하려면

cc-baseline은 hooks와 `/clean` 커맨드가 bash·`pgrep` 등 Unix 명령어를 사용하므로 **Windows 네이티브 환경(cmd, PowerShell)에서는 동작하지 않습니다.**

WSL(Windows Subsystem for Linux)을 사용하면 정상 동작합니다:

```bash
# WSL 터미널에서 실행
npx github:fffight88/cc-baseline
```

WSL 설치: [Microsoft 공식 가이드](https://learn.microsoft.com/ko-kr/windows/wsl/install)

---

### Node 버전 오류

```
error: The engine "node" is incompatible with this module.
```

→ Node.js 18 이상으로 업그레이드하세요. `node --version`으로 현재 버전 확인.

### 권한 오류

```
EACCES: permission denied, open '~/.claude/settings.json'
```

→ `~/.claude/` 폴더 소유자 확인: `ls -la ~/.claude/`. `sudo chown -R $(whoami) ~/.claude/`로 복구.

### JSON 파싱 에러

```
SyntaxError: Unexpected token ...
```

→ 기존 `settings.json` 또는 `.claude.json`이 손상되었습니다. 백업 파일로 복구하거나 해당 파일을 JSON 검증기로 확인하세요.

### `npx github:` 실행 시 캐시 문제 (오래된 버전 실행)

```bash
# npx 캐시 삭제 후 재실행
npx --yes github:fffight88/cc-baseline
```

또는 특정 커밋/태그를 지정:

```bash
npx github:fffight88/cc-baseline#v1.0.0
```

### playwright-test MCP가 동작하지 않음

`~/.claude.json`에 mcpServers가 추가되었는지 확인:

```bash
cat ~/.claude.json | python3 -c "import json,sys; d=json.load(sys.stdin); print(list(d.get('mcpServers',{}).keys()))"
```

`@playwright/mcp` 패키지가 설치되어 있는지 확인:

```bash
npx @playwright/mcp --version
```

---

## 보안감사 리포트 저장 경로

`security-auditor` 에이전트는 감사 리포트를 `<프로젝트 루트>/.cc-audits/<플랜 슬러그>/iter-<n>.{md,json}`에 저장합니다.

- `.claude/` 밖에 저장하므로 Claude Code 내장 보호 프롬프트가 발생하지 않습니다
- cc-baseline이 설치한 PreToolUse hook이 `/.cc-audits/` 경로 Write/Edit를 자동 승인합니다 (settings.json `permissions` 키 사용 안 함)
- 자동 승인 범위: `Write|Edit` 도구 + `/.cc-audits/`를 포함하는 file_path만

**권장:** 각 프로젝트의 `.gitignore`에 `.cc-audits/` 한 줄을 추가하세요. 리포트는 로컬에서만 보관하는 것이 일반적입니다.

---

## 보안 정책: settings.json `permissions` 키 배포 금지

cc-baseline은 사용자 `~/.claude/settings.json`의 `permissions` 키를 **읽지도 쓰지도 않습니다**. 이유:

- `permissions.allow` 룰은 Claude Code의 사용자 동의 프롬프트를 우회합니다 (예: `Bash(*)` 자동 허용 → 모든 셸 명령 무프롬프트 실행)
- 베이스라인 배포로 사용자가 명시 동의하지 않은 권한이 부여되는 것은 supply-chain 리스크입니다
- `Edit(~/.claude/**)` 같은 허용 룰을 배포하면 Claude Code 내장 `.claude/` 경로 보호도 우회됩니다

**원칙:** 권한 룰은 각 사용자가 자신의 환경에서 직접 추가해야 하며, 베이스라인 인스톨러는 절대 자동으로 생성·수정하지 않습니다.

**`.claude/` 수정 시 매번 뜨는 퍼미션 프롬프트는 Claude Code 런타임 내장 보호입니다.** `settings.json`의 `permissions` 키와 무관하며, 우회보다는 cc-baseline `templates/` → installer 워크플로우를 사용하는 것이 정상 패턴입니다.

---

## 보안·프라이버시 노트

- 이 리포지토리의 `templates/` 폴더에는 **사용자명·비밀번호·API 키·DB 접속 정보가 포함되지 않습니다**.
- `settings.json`의 훅 커맨드 내 경로는 `{{HOME}}` 플레이스홀더로 저장되며, 설치 시점에 해당 머신의 `$HOME` 경로로 치환됩니다.
- 설치 로그(`~/.claude/.cc-baseline-install.log`)와 백업 폴더(`~/.claude/.cc-baseline-backup/`)는 `.gitignore`에 포함되어 Git에 커밋되지 않습니다.
- `~/.claude.json`에서는 MCP 서버 설정(`playwright-test-1~5`)만 읽고 씁니다. 개인 사용 통계·UI 상태 등 다른 키는 일절 수정하지 않습니다.

---

## 기술 스택 & 구조

- **런타임:** Node.js 18+ (외부 의존성 0 — 내장 모듈만 사용)
- **배포:** 공개 GitHub 레포 → `npx github:fffight88/cc-baseline`

```
cc-baseline/
├── bin/cli.js              # CLI 진입점 (shebang + arg parsing)
├── src/
│   ├── install.js          # 설치 오케스트레이션
│   ├── paths.js            # {{HOME}} ↔ $HOME 치환
│   ├── backup.js           # 타임스탬프 백업
│   ├── prompt.js           # readline 대화형 Y/n
│   ├── conflict-checker.js # 훅 충돌 감지 (4개 규칙)
│   └── merge/
│       ├── markdown.js     # 마커 블록 머지
│       ├── settings-hooks.js  # hooks statusMessage 기준 머지
│       └── mcp-servers.js  # mcpServers 키 머지
└── templates/              # 번들 파일 ({{HOME}} 플레이스홀더 포함)
    ├── CLAUDE.md
    ├── memory/             # 11개 memory 파일
    ├── agents/             # e2e-tester.md, security-auditor.md
    ├── commands/           # plan.md, clean.md
    ├── settings-hooks.json # hooks 섹션만
    └── mcp-servers.json    # playwright-test-1~5만
```
