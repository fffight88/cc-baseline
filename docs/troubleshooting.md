# Troubleshooting

[← Back to README](../README.md)

## Windows

cc-baseline hooks and the `/clean` skill use bash, `pgrep`, and other Unix commands. **Windows native (cmd, PowerShell) is not supported.** Use WSL:

```bash
npx github:fffight88/cc-baseline
```

## Node version error

```
error: The engine "node" is incompatible with this module.
```

Upgrade to Node.js 18+. Check with `node --version`.

## Permission error

```
EACCES: permission denied, open '~/.claude/settings.json'
```

Fix ownership: `sudo chown -R $(whoami) ~/.claude/`

## Permission error on memory/ (WSL2/Linux)

```
EACCES: permission denied, open '~/.claude/memory/MEMORY.md'
```

Legacy `chmod 555` lock from an older install. The new installer auto-recovers, but if it fails manually:

```bash
chmod 755 ~/.claude/memory
chmod 644 ~/.claude/memory/*.md
npx github:fffight88/cc-baseline --yes
```

## Scanner install failed (Linux/WSL)

If `semgrep`, `gitleaks`, or `trivy` failed to install automatically, cc-baseline prints the manual command. Or run these yourself:

```bash
# semgrep (Ubuntu 24.04+)
sudo apt install -y python3-venv pipx
pipx install semgrep

# gitleaks — download latest linux binary from:
# https://github.com/gitleaks/gitleaks/releases/latest
# then: mv gitleaks ~/.local/bin/ && chmod 755 ~/.local/bin/gitleaks

# trivy — download latest linux binary from:
# https://github.com/aquasecurity/trivy/releases/latest
# then: tar -xzf trivy_*_Linux-64bit.tar.gz trivy && mv trivy ~/.local/bin/ && chmod 755 ~/.local/bin/trivy
```

Add `~/.local/bin` to PATH if not already:

```bash
export PATH="$HOME/.local/bin:$PATH"  # add to ~/.bashrc or ~/.zshrc
```

## JSON parse error

```
SyntaxError: Unexpected token ...
```

Your `settings.json` or `.claude.json` is malformed. Restore from backup or validate with a JSON linter.

## Stale npx cache

```bash
npx --yes github:fffight88/cc-baseline --yes
# or pin a specific commit/tag:
npx github:fffight88/cc-baseline#v1.0.0
```

## Playwright MCP not connecting ("Failed to reconnect")

**Check the binary exists:**

```bash
ls ~/.npm-global/bin/playwright-mcp
```

If missing, install manually:

```bash
npm install -g @playwright/mcp --prefix ~/.npm-global
```

**Check the command path in `.claude.json`:**

```bash
cat ~/.claude.json | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('mcpServers',{}).get('playwright-test-1',{}).get('command'))"
```

Should print `~/.npm-global/bin/playwright-mcp`. If it shows `npx`, re-run `npx --yes github:fffight88/cc-baseline --yes` to fix it automatically.

**Restart Claude Code** after confirming the path is correct.
