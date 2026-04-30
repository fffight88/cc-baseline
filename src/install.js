'use strict';

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const { createHash } = require('crypto');
const path = require('path');
const { HOME, applyHome, NPM_GLOBAL_PREFIX, PLAYWRIGHT_MCP_BIN } = require('./paths');

function checkCmd(cmd) {
  return spawnSync('which', [cmd], { stdio: 'ignore' }).status === 0;
}

async function installScanners(dryRun) {
  const scanners = ['semgrep', 'gitleaks', 'trivy'];
  const missing = scanners.filter(s => !checkCmd(s));
  if (missing.length === 0) {
    console.log('\n🔍 Security scanners: semgrep/gitleaks/trivy all installed');
    return;
  }
  console.log(`\n🔍 Installing security scanners: ${missing.join(', ')}`);
  if (dryRun) {
    console.log('[DRY RUN] Skipping scanner installation.');
    return;
  }
  if (process.platform === 'darwin') {
    installScannersMac(missing);
  } else {
    installScannersLinux(missing);
  }
}

function installScannersMac(missing) {
  try {
    execSync(`brew install ${missing.join(' ')}`, { stdio: 'inherit' });
    console.log('  ✅ Scanner installation complete');
  } catch (e) {
    console.log(`  ⚠️  brew install failed: ${e.message}`);
    console.log(`     Manual: brew install ${missing.join(' ')}`);
  }
}

function installScannersLinux(missing) {
  const localBin = path.join(HOME, '.local', 'bin');
  fs.mkdirSync(localBin, { recursive: true });

  const failures = [];
  for (const s of missing) {
    try {
      if (s === 'semgrep') installSemgrepLinux(localBin);
      else if (s === 'gitleaks') installGitleaksLinux(localBin);
      else if (s === 'trivy') installTrivyLinux(localBin);
      console.log(`  ✅ ${s} installed`);
    } catch (e) {
      const errMsg = (e && e.message) ? e.message.split('\n')[0] : String(e);
      console.log(`  ⚠️  ${s} install failed: ${errMsg}`);
      failures.push(s);
    }
  }

  warnPathIfMissing(localBin);
  if (failures.length > 0) printManualScannerCommands(failures, localBin);
}

function installSemgrepLinux(localBin) {
  if (!checkCmd('python3')) {
    throw new Error('python3 not installed (run: sudo apt install python3 python3-venv)');
  }
  if (checkCmd('pipx')) {
    execSync('pipx install semgrep', { stdio: 'inherit' });
    return;
  }
  // isolated venv install — bypasses PEP 668 on Ubuntu 24.04, no sudo required
  const venvDir = path.join(HOME, '.local', 'share', 'cc-baseline', 'semgrep-venv');
  fs.mkdirSync(path.dirname(venvDir), { recursive: true });
  spawnSync('python3', ['-m', 'venv', venvDir], { stdio: 'inherit' });
  spawnSync(`${venvDir}/bin/pip`, ['install', '--quiet', '--upgrade', 'pip'], { stdio: 'inherit' });
  spawnSync(`${venvDir}/bin/pip`, ['install', '--quiet', 'semgrep'], { stdio: 'inherit' });
  const target = path.join(localBin, 'semgrep');
  try {
    fs.unlinkSync(target);
  } catch (unlinkErr) {
    if (unlinkErr.code !== 'ENOENT') {
      throw new Error(`failed to replace semgrep symlink (cannot remove existing file): ${unlinkErr.message}`);
    }
  }
  fs.symlinkSync(path.join(venvDir, 'bin', 'semgrep'), target);
}

function installGitleaksLinux(localBin) {
  const ARCH_MAP = { arm64: 'arm64', x64: 'x64' };
  const arch = ARCH_MAP[process.arch];
  if (!arch) throw new Error(`gitleaks: unsupported architecture ${process.arch} (supported: arm64, x64)`);
  const apiUrl = 'https://api.github.com/repos/gitleaks/gitleaks/releases/latest';
  const tagJson = execSync(`curl -sSfL "${apiUrl}"`, { encoding: 'utf8' });
  let parsed;
  try { parsed = JSON.parse(tagJson); } catch {
    throw new Error('Failed to parse GitHub API response (possible rate limit or network error)');
  }
  const tag = parsed.tag_name;
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) {
    throw new Error(`Failed to parse latest gitleaks tag: ${tag}`);
  }
  const ver = tag.slice(1);
  const tarName = `gitleaks_${ver}_linux_${arch}.tar.gz`;
  const url = `https://github.com/gitleaks/gitleaks/releases/download/${tag}/${tarName}`;
  const checksumUrl = `https://github.com/gitleaks/gitleaks/releases/download/${tag}/checksums.txt`;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitleaks-'));
  try {
    const tmpFile = path.join(tmpDir, 'gitleaks.tar.gz');
    const tmpChecksums = path.join(tmpDir, 'checksums.txt');
    execSync(`curl -sSfL "${checksumUrl}" -o "${tmpChecksums}"`, { stdio: 'inherit' });
    execSync(`curl -sSfL "${url}" -o "${tmpFile}"`, { stdio: 'inherit' });
    const checksumLine = fs.readFileSync(tmpChecksums, 'utf8')
      .split('\n').find(l => l.includes(tarName));
    if (!checksumLine) throw new Error('Entry not found in checksums.txt for this file');
    const expected = checksumLine.split(/\s+/)[0];
    const actual = createHash('sha256').update(fs.readFileSync(tmpFile)).digest('hex');
    if (actual !== expected) throw new Error(`Checksum mismatch: expected=${expected} actual=${actual}`);
    execSync(`tar -xzf "${tmpFile}" -C "${localBin}" gitleaks`, { stdio: 'inherit' });
    fs.chmodSync(path.join(localBin, 'gitleaks'), 0o755);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function installTrivyLinux(localBin) {
  const ARCH_MAP = { arm64: 'ARM64', x64: '64bit' };
  const archSuffix = ARCH_MAP[process.arch];
  if (!archSuffix) throw new Error(`trivy: unsupported architecture ${process.arch} (supported: arm64, x64)`);
  const apiUrl = 'https://api.github.com/repos/aquasecurity/trivy/releases/latest';
  const tagJson = execSync(`curl -sSfL "${apiUrl}"`, { encoding: 'utf8' });
  let parsed;
  try { parsed = JSON.parse(tagJson); } catch {
    throw new Error('Failed to parse GitHub API response (possible rate limit or network error)');
  }
  const tag = parsed.tag_name;
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) {
    throw new Error(`Failed to parse latest trivy tag: ${tag}`);
  }
  const ver = tag.slice(1);
  const tarName = `trivy_${ver}_Linux-${archSuffix}.tar.gz`;
  const url = `https://github.com/aquasecurity/trivy/releases/download/${tag}/${tarName}`;
  const checksumUrl = `https://github.com/aquasecurity/trivy/releases/download/${tag}/trivy_${ver}_checksums.txt`;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trivy-'));
  try {
    const tmpFile = path.join(tmpDir, 'trivy.tar.gz');
    const tmpChecksums = path.join(tmpDir, 'checksums.txt');
    execSync(`curl -sSfL "${checksumUrl}" -o "${tmpChecksums}"`, { stdio: 'inherit' });
    execSync(`curl -sSfL "${url}" -o "${tmpFile}"`, { stdio: 'inherit' });
    const checksumLine = fs.readFileSync(tmpChecksums, 'utf8')
      .split('\n').find(l => l.includes(tarName));
    if (!checksumLine) throw new Error('Entry not found in checksums.txt for this file');
    const expected = checksumLine.split(/\s+/)[0];
    const actual = createHash('sha256').update(fs.readFileSync(tmpFile)).digest('hex');
    if (actual !== expected) throw new Error(`Checksum mismatch: expected=${expected} actual=${actual}`);
    execSync(`tar -xzf "${tmpFile}" -C "${localBin}" trivy`, { stdio: 'inherit' });
    fs.chmodSync(path.join(localBin, 'trivy'), 0o755);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function warnPathIfMissing(localBin) {
  const pathEntries = (process.env.PATH || '').split(path.delimiter);
  if (!pathEntries.includes(localBin)) {
    console.log(`\n  ℹ️  PATH check: ${localBin} is not in PATH.`);
    console.log(`     Add to your shell rc: export PATH="$HOME/.local/bin:$PATH"`);
  }
}

function printManualScannerCommands(failures, localBin) {
  console.log('\n  ⚠️  Manual install commands for failed scanners:');
  for (const s of failures) {
    if (s === 'semgrep') {
      console.log('     - semgrep: sudo apt install -y python3-venv pipx && pipx install semgrep');
    } else if (s === 'gitleaks') {
      console.log(`     - gitleaks: download linux binary from GitHub Releases → ${localBin}/`);
      console.log('               https://github.com/gitleaks/gitleaks/releases/latest');
    } else if (s === 'trivy') {
      console.log(`     - trivy: download linux binary from GitHub Releases → ${localBin}/`);
      console.log('               https://github.com/aquasecurity/trivy/releases/latest');
    }
  }
}

async function installNotifier(dryRun) {
  if (process.platform !== 'darwin') return;
  if (checkCmd('terminal-notifier')) {
    console.log('\n🔔 Notifications: terminal-notifier detected, skipping install');
    return;
  }
  console.log('\n🔔 Installing terminal-notifier (improves notification reliability)');
  if (dryRun) {
    console.log('[DRY RUN] Skipping terminal-notifier installation.');
    return;
  }
  try {
    execSync('brew install terminal-notifier', { stdio: 'inherit' });
    console.log('  ✅ terminal-notifier installed');
  } catch (e) {
    console.log(`  ⚠️  terminal-notifier auto-install failed (falling back to osascript): ${e.message}`);
  }
}

async function installPlaywrightMcp(dryRun) {
  if (fs.existsSync(PLAYWRIGHT_MCP_BIN)) {
    console.log('\n🎭 Playwright MCP: ~/.npm-global/bin/playwright-mcp detected, skipping install');
    return;
  }

  if (!checkCmd('npm')) {
    console.log('\n⚠️  Playwright MCP: `npm` not found, skipping install. Install Node.js and re-run `cc-baseline --yes`.');
    return;
  }

  console.log('\n🎭 Installing Playwright MCP (~/.npm-global local prefix)');
  if (dryRun) {
    console.log('[DRY RUN] Skipping Playwright MCP installation.');
    return;
  }

  try {
    fs.mkdirSync(NPM_GLOBAL_PREFIX, { recursive: true });
    execSync(`npm install -g @playwright/mcp --prefix "${NPM_GLOBAL_PREFIX}"`, { stdio: 'inherit' });
    if (fs.existsSync(PLAYWRIGHT_MCP_BIN)) {
      console.log('  ✅ Playwright MCP installed');
      console.log(`  ℹ️  PATH check: add ${NPM_GLOBAL_PREFIX}/bin to your shell rc if not already in PATH`);
    } else {
      console.log(`  ⚠️  npm succeeded but ${PLAYWRIGHT_MCP_BIN} binary not found. Manual check required.`);
    }
  } catch (e) {
    console.log(`  ⚠️  Playwright MCP auto-install failed (manual install required): ${e.message}`);
    console.log(`     Manual: npm install -g @playwright/mcp --prefix "${NPM_GLOBAL_PREFIX}"`);
  }
}

const { createBackup } = require('./backup');
const { confirm } = require('./prompt');
const { checkConflicts } = require('./conflict-checker');
const { mergeMarkerBlock } = require('./merge/markdown');
const { mergeHooks } = require('./merge/settings-hooks');
const { mergeMcpServers } = require('./merge/mcp-servers');

const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');
const CLAUDE_DIR = path.join(HOME, '.claude');
const BACKUP_ROOT = path.join(CLAUDE_DIR, '.cc-baseline-backup');
const LOG_FILE = path.join(CLAUDE_DIR, '.cc-baseline-install.log');

function appendLog(msg) {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    const isNew = !fs.existsSync(LOG_FILE);
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`);
    if (isNew) fs.chmodSync(LOG_FILE, 0o600);
  } catch {}
}

function readTemplate(relPath) {
  const raw = fs.readFileSync(path.join(TEMPLATES_DIR, relPath), 'utf8');
  return applyHome(raw);
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    console.warn(`⚠️  Failed to parse ${filePath}: ${e.message}`);
    return { __parseError: true };
  }
}

function writeFile(filePath, content, dryRun) {
  if (dryRun) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  // correct permissions so files left read-only (444, etc.) from previous installs can be overwritten
  if (fs.existsSync(filePath)) {
    try { fs.chmodSync(filePath, 0o644); } catch {}
  }
  fs.writeFileSync(filePath, content, 'utf8');
}

async function install(opts = {}) {
  const { dryRun = false, yes: autoYes = false } = opts;

  console.log('\n🔧 cc-baseline — Claude Code harness installer\n');
  if (dryRun) {
    console.log('📋 [DRY RUN] Printing planned changes only, no files will be modified.\n');
  }

  // ── 1. Read existing settings.json → check for conflicts ─────────────────
  const settingsPath = path.join(CLAUDE_DIR, 'settings.json');
  const existingSettingsRaw = readJson(settingsPath);
  if (existingSettingsRaw && existingSettingsRaw.__parseError) {
    const proceed = await confirm(
      `${settingsPath} is corrupted. Overwriting with an empty object will erase all existing settings. Continue?`,
      autoYes
    );
    if (!proceed) { console.log('\nInstall cancelled.'); return; }
  }
  const existingSettings = (existingSettingsRaw && !existingSettingsRaw.__parseError) ? existingSettingsRaw : {};
  const existingHooks = existingSettings.hooks || {};

  const warnings = checkConflicts(existingHooks);
  if (warnings.length > 0) {
    console.log('⚠️  Hook conflicts detected:\n');
    for (const w of warnings) {
      const icon = w.severity === 'HIGH' ? '🚨' : w.severity === 'WARN' ? '⚠️ ' : 'ℹ️ ';
      console.log(`${icon} [${w.severity}] ${w.message}`);
      console.log(`   Reason: ${w.reason}`);
      console.log(`   Action: ${w.action}\n`);
    }
    const proceed = await confirm(
      'Warnings acknowledged. Continue with installation?',
      autoYes
    );
    if (!proceed) {
      console.log('\nInstall cancelled.');
      return;
    }
    console.log();
  }

  // ── 2. Backup ─────────────────────────────────────────────────────────────
  const filesToBackup = [
    path.join(CLAUDE_DIR, 'CLAUDE.md'),
    path.join(CLAUDE_DIR, 'memory', 'MEMORY.md'),
    ...[
      'all_session_basic_rules',
      'doc_structure_rules',
      'phase_start',
      'phase_end',
      'reference_e2e_manager_guide',
      'reference_subagent_boundary',
      'reference_doc_writing_style',
      'feedback_skill_description_budget',
      'reference_security_auditor_protocol',
      'reference_code_reviewer_protocol',
    ].map(f => path.join(CLAUDE_DIR, 'memory', `${f}.md`)),
    path.join(CLAUDE_DIR, 'agents', 'e2e-tester.md'),
    path.join(CLAUDE_DIR, 'agents', 'security-auditor.md'),
    path.join(CLAUDE_DIR, 'agents', 'code-reviewer.md'),
    path.join(CLAUDE_DIR, 'commands', 'plan.md'),
    path.join(CLAUDE_DIR, 'commands', 'clean.md'),
    path.join(CLAUDE_DIR, 'scripts', 'audit-report.js'),
    settingsPath,
    path.join(HOME, '.claude.json'),
  ];

  if (!dryRun) {
    const { backupDir, backed } = createBackup(filesToBackup, BACKUP_ROOT);
    if (backupDir) {
      console.log(`💾 Backup saved: ${backupDir}\n   (${backed.length} files)\n`);
      appendLog(`BACKUP: ${backupDir}`);
    }
  }

  const changes = [];

  // ── 3. CLAUDE.md — marker-block merge ────────────────────────────────────
  const claudeMdPath = path.join(CLAUDE_DIR, 'CLAUDE.md');
  const claudeMdTpl = readTemplate('CLAUDE.md');
  const claudeMdExisting = fs.existsSync(claudeMdPath)
    ? fs.readFileSync(claudeMdPath, 'utf8')
    : '';
  const claudeMdNew = mergeMarkerBlock(claudeMdExisting, claudeMdTpl);
  if (claudeMdNew !== claudeMdExisting) {
    changes.push({ label: 'CLAUDE.md', path: claudeMdPath, content: claudeMdNew });
    console.log(`  ✅ CLAUDE.md — ${claudeMdExisting ? 'marker-block merged' : 'created'}`);
  } else {
    console.log(`  ⏭️  CLAUDE.md — no changes (already up to date)`);
  }

  // ── 4. memory/MEMORY.md — marker-block merge ──────────────────────────────
  const memMdPath = path.join(CLAUDE_DIR, 'memory', 'MEMORY.md');
  const memMdTpl = readTemplate('memory/MEMORY.md');
  const memMdExisting = fs.existsSync(memMdPath)
    ? fs.readFileSync(memMdPath, 'utf8')
    : '';
  const memMdNew = mergeMarkerBlock(memMdExisting, memMdTpl);
  if (memMdNew !== memMdExisting) {
    changes.push({ label: 'memory/MEMORY.md', path: memMdPath, content: memMdNew });
    console.log(`  ✅ memory/MEMORY.md — ${memMdExisting ? 'marker-block merged' : 'created'}`);
  } else {
    console.log(`  ⏭️  memory/MEMORY.md — no changes (already up to date)`);
  }

  // ── 5. Overwrite individual memory files ──────────────────────────────────
  const memoryFiles = [
    'all_session_basic_rules.md',
    'doc_structure_rules.md',
    'phase_start.md',
    'phase_end.md',
    'reference_e2e_manager_guide.md',
    'reference_subagent_boundary.md',
    'reference_doc_writing_style.md',
    'feedback_skill_description_budget.md',
    'reference_security_auditor_protocol.md',
    'reference_code_reviewer_protocol.md',
  ];
  for (const f of memoryFiles) {
    const dest = path.join(CLAUDE_DIR, 'memory', f);
    changes.push({ label: `memory/${f}`, path: dest, content: readTemplate(`memory/${f}`) });
    console.log(`  ✅ memory/${f} — overwritten`);
  }

  // ── 5-1. scripts/audit-report.js ─────────────────────────────────────────
  const scriptPath = path.join(CLAUDE_DIR, 'scripts', 'audit-report.js');
  changes.push({ label: 'scripts/audit-report.js', path: scriptPath, content: readTemplate('scripts/audit-report.js') });
  console.log(`  ✅ scripts/audit-report.js — overwritten`);

  // ── 6. agents/e2e-tester.md ──────────────────────────────────────────────
  const agentPath = path.join(CLAUDE_DIR, 'agents', 'e2e-tester.md');
  changes.push({ label: 'agents/e2e-tester.md', path: agentPath, content: readTemplate('agents/e2e-tester.md') });
  console.log(`  ✅ agents/e2e-tester.md — overwritten`);

  // ── 6-1. agents/security-auditor.md ──────────────────────────────────────
  const auditorPath = path.join(CLAUDE_DIR, 'agents', 'security-auditor.md');
  changes.push({ label: 'agents/security-auditor.md', path: auditorPath, content: readTemplate('agents/security-auditor.md') });
  console.log(`  ✅ agents/security-auditor.md — overwritten`);

  // ── 6-2. agents/code-reviewer.md ─────────────────────────────────────────
  const codeReviewerPath = path.join(CLAUDE_DIR, 'agents', 'code-reviewer.md');
  changes.push({ label: 'agents/code-reviewer.md', path: codeReviewerPath, content: readTemplate('agents/code-reviewer.md') });
  console.log(`  ✅ agents/code-reviewer.md — overwritten`);

  // ── 7. commands/ ─────────────────────────────────────────────────────────
  for (const f of ['plan.md', 'clean.md']) {
    const dest = path.join(CLAUDE_DIR, 'commands', f);
    changes.push({ label: `commands/${f}`, path: dest, content: readTemplate(`commands/${f}`) });
    console.log(`  ✅ commands/${f} — overwritten`);
  }

  // ── 8. settings.json hooks merge ─────────────────────────────────────────
  const harnessHooks = JSON.parse(readTemplate('settings-hooks.json'));
  const mergedHooks = mergeHooks(existingHooks, harnessHooks);
  // cc-baseline never adds or modifies the permissions key for security reasons; user-set keys are preserved as-is.
  const newSettings = Object.assign({}, existingSettings, { hooks: mergedHooks });
  changes.push({
    label: 'settings.json (hooks merge)',
    path: settingsPath,
    content: JSON.stringify(newSettings, null, 2),
  });
  console.log(`  ✅ settings.json — hooks merged`);

  // ── 9. Merge ~/.claude.json mcpServers ────────────────────────────────────
  const claudeJsonPath = path.join(HOME, '.claude.json');
  const existingClaudeJsonRaw = readJson(claudeJsonPath);
  if (existingClaudeJsonRaw && existingClaudeJsonRaw.__parseError) {
    const proceed = await confirm(
      `${claudeJsonPath} is corrupted. Overwriting with an empty object will erase all existing settings. Continue?`,
      autoYes
    );
    if (!proceed) { console.log('\nInstall cancelled.'); return; }
  }
  const existingClaudeJson = (existingClaudeJsonRaw && !existingClaudeJsonRaw.__parseError) ? existingClaudeJsonRaw : {};
  const incomingMcp = JSON.parse(readTemplate('mcp-servers.json'));
  const { result: mergedMcp, added, overwritten } = mergeMcpServers(
    existingClaudeJson.mcpServers || {},
    incomingMcp
  );
  if (added.length > 0 || overwritten.length > 0) {
    const newClaudeJson = Object.assign({}, existingClaudeJson, { mcpServers: mergedMcp });
    changes.push({
      label: `.claude.json (mcpServers merge)`,
      path: claudeJsonPath,
      content: JSON.stringify(newClaudeJson, null, 2),
    });
    const summary = [
      added.length ? `added: [${added.join(', ')}]` : '',
      overwritten.length ? `replaced: [${overwritten.join(', ')}]` : '',
    ].filter(Boolean).join(' / ');
    console.log(`  ✅ .claude.json — mcpServers ${summary}`);
  } else {
    console.log(`  ⏭️  .claude.json — no changes`);
  }

  // ── 10. Summary & write ───────────────────────────────────────────────────
  console.log(`\n📊 ${changes.length} items to be changed\n`);

  if (dryRun) {
    console.log('[DRY RUN] No files were modified.');
    return;
  }

  // migration for legacy chmod 555 lock from previous installs: unlock once if still present
  // new versions no longer apply chmod 555 — protection is handled by the PreToolUse hook
  const memoryDir = path.join(CLAUDE_DIR, 'memory');
  if (fs.existsSync(memoryDir)) {
    try {
      fs.chmodSync(memoryDir, 0o755);
      appendLog('MIGRATE CHMOD 755: memory/ (legacy lock removal)');
    } catch {}
  }

  for (const change of changes) {
    writeFile(change.path, change.content, false);
    appendLog(`WRITE: ${change.path}`);
  }

  // ensure bin/cli.js is executable
  try {
    fs.chmodSync(path.join(__dirname, '..', 'bin', 'cli.js'), 0o755);
  } catch {}

  // ── 11. Auto-install security scanners (semgrep, gitleaks, trivy) ─────────
  await installScanners(dryRun);

  // ── 11-1. Auto-install terminal-notifier (macOS notification reliability) ──
  await installNotifier(dryRun);

  // ── 12. Auto-install Playwright MCP binary ────────────────────────────────
  await installPlaywrightMcp(dryRun);

  console.log('✅ cc-baseline install complete!\n');
  console.log(`📝 Install log: ${LOG_FILE}`);
  console.log(`💾 Backup location: ${BACKUP_ROOT}\n`);
  appendLog('INSTALL COMPLETE');
}

module.exports = { install };
