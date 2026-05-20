# 문제 해결

[← README로 돌아가기](../../README_KO.md)

## Windows

cc-baseline 훅과 `/clean` 스킬은 bash, `pgrep` 등 Unix 명령어를 사용합니다. **Windows 네이티브(cmd, PowerShell)는 지원하지 않습니다.** WSL을 사용하세요:

```bash
npx github:fffight88/cc-baseline
```

## Node 버전 오류

```
error: The engine "node" is incompatible with this module.
```

Node.js 18+로 업그레이드하세요. `node --version`으로 확인.

## 권한 오류

```
EACCES: permission denied, open '~/.claude/settings.json'
```

소유권 수정: `sudo chown -R $(whoami) ~/.claude/`

## memory/ 권한 오류 (WSL2/Linux)

```
EACCES: permission denied, open '~/.claude/memory/MEMORY.md'
```

이전 설치의 `chmod 555` 잠금입니다. 새 설치 프로그램이 자동 복구하지만 실패 시 수동으로:

```bash
chmod 755 ~/.claude/memory
chmod 644 ~/.claude/memory/*.md
npx github:fffight88/cc-baseline --yes
```

## 스캐너 설치 실패 (Linux/WSL)

`semgrep`, `gitleaks`, `trivy` 자동 설치 실패 시 수동 명령어가 출력됩니다. 직접 실행:

```bash
# semgrep (Ubuntu 24.04+)
sudo apt install -y python3-venv pipx
pipx install semgrep

# gitleaks — 최신 linux 바이너리 다운로드:
# https://github.com/gitleaks/gitleaks/releases/latest
# 이후: mv gitleaks ~/.local/bin/ && chmod 755 ~/.local/bin/gitleaks

# trivy — 최신 linux 바이너리 다운로드:
# https://github.com/aquasecurity/trivy/releases/latest
# 이후: tar -xzf trivy_*_Linux-64bit.tar.gz trivy && mv trivy ~/.local/bin/ && chmod 755 ~/.local/bin/trivy
```

PATH에 `~/.local/bin` 추가:

```bash
export PATH="$HOME/.local/bin:$PATH"  # ~/.bashrc 또는 ~/.zshrc에 추가
```

## JSON 파싱 오류

```
SyntaxError: Unexpected token ...
```

`settings.json` 또는 `.claude.json`이 올바르지 않습니다. 백업에서 복원하거나 JSON 린터로 검증하세요.

## 오래된 npx 캐시

```bash
npx --yes github:fffight88/cc-baseline --yes
# 또는 특정 커밋/태그 고정:
npx github:fffight88/cc-baseline#v1.0.0
```

## Playwright MCP 연결 안 됨 ("Failed to reconnect")

**바이너리 존재 확인:**

```bash
ls ~/.npm-global/bin/playwright-mcp
```

없으면 수동 설치:

```bash
npm install -g @playwright/mcp --prefix ~/.npm-global
```

**`.claude.json`의 명령어 경로 확인:**

```bash
cat ~/.claude.json | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('mcpServers',{}).get('playwright-test-1',{}).get('command'))"
```

`~/.npm-global/bin/playwright-mcp`가 출력되어야 합니다. `npx`로 표시되면 `npx --yes github:fffight88/cc-baseline --yes` 재실행으로 자동 수정됩니다.

경로 확인 후 **Claude Code를 재시작**하세요.
