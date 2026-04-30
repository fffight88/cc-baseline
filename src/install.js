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
    console.log('\n🔍 보안 스캐너: semgrep/gitleaks/trivy 모두 설치됨');
    return;
  }
  console.log(`\n🔍 보안 스캐너 설치 중: ${missing.join(', ')}`);
  if (dryRun) {
    console.log('[DRY RUN] 스캐너 설치를 건너뜁니다.');
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
    console.log('  ✅ 스캐너 설치 완료');
  } catch (e) {
    console.log(`  ⚠️  brew 설치 실패: ${e.message}`);
    console.log(`     수동: brew install ${missing.join(' ')}`);
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
      console.log(`  ✅ ${s} 설치 완료`);
    } catch (e) {
      const errMsg = (e && e.message) ? e.message.split('\n')[0] : String(e);
      console.log(`  ⚠️  ${s} 설치 실패: ${errMsg}`);
      failures.push(s);
    }
  }

  warnPathIfMissing(localBin);
  if (failures.length > 0) printManualScannerCommands(failures, localBin);
}

function installSemgrepLinux(localBin) {
  if (!checkCmd('python3')) {
    throw new Error('python3 미설치 (sudo apt install python3 python3-venv 필요)');
  }
  if (checkCmd('pipx')) {
    execSync('pipx install semgrep', { stdio: 'inherit' });
    return;
  }
  // venv 격리 설치 — Ubuntu 24.04 PEP 668 우회, sudo 불필요
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
      throw new Error(`semgrep 심볼릭 링크 교체 실패 (기존 파일 삭제 불가): ${unlinkErr.message}`);
    }
  }
  fs.symlinkSync(path.join(venvDir, 'bin', 'semgrep'), target);
}

function installGitleaksLinux(localBin) {
  const ARCH_MAP = { arm64: 'arm64', x64: 'x64' };
  const arch = ARCH_MAP[process.arch];
  if (!arch) throw new Error(`gitleaks: 지원되지 않는 아키텍처 ${process.arch} (지원: arm64, x64)`);
  const apiUrl = 'https://api.github.com/repos/gitleaks/gitleaks/releases/latest';
  const tagJson = execSync(`curl -sSfL "${apiUrl}"`, { encoding: 'utf8' });
  let parsed;
  try { parsed = JSON.parse(tagJson); } catch {
    throw new Error('GitHub API 응답 JSON 파싱 실패 (rate limit 또는 네트워크 오류일 수 있음)');
  }
  const tag = parsed.tag_name;
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) {
    throw new Error(`gitleaks 최신 tag 파싱 실패: ${tag}`);
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
    if (!checksumLine) throw new Error('checksums.txt에서 해당 파일 항목을 찾을 수 없음');
    const expected = checksumLine.split(/\s+/)[0];
    const actual = createHash('sha256').update(fs.readFileSync(tmpFile)).digest('hex');
    if (actual !== expected) throw new Error(`체크섬 불일치: expected=${expected} actual=${actual}`);
    execSync(`tar -xzf "${tmpFile}" -C "${localBin}" gitleaks`, { stdio: 'inherit' });
    fs.chmodSync(path.join(localBin, 'gitleaks'), 0o755);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function installTrivyLinux(localBin) {
  const ARCH_MAP = { arm64: 'ARM64', x64: '64bit' };
  const archSuffix = ARCH_MAP[process.arch];
  if (!archSuffix) throw new Error(`trivy: 지원되지 않는 아키텍처 ${process.arch} (지원: arm64, x64)`);
  const apiUrl = 'https://api.github.com/repos/aquasecurity/trivy/releases/latest';
  const tagJson = execSync(`curl -sSfL "${apiUrl}"`, { encoding: 'utf8' });
  let parsed;
  try { parsed = JSON.parse(tagJson); } catch {
    throw new Error('GitHub API 응답 JSON 파싱 실패 (rate limit 또는 네트워크 오류일 수 있음)');
  }
  const tag = parsed.tag_name;
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) {
    throw new Error(`trivy 최신 tag 파싱 실패: ${tag}`);
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
    if (!checksumLine) throw new Error('checksums.txt에서 해당 파일 항목을 찾을 수 없음');
    const expected = checksumLine.split(/\s+/)[0];
    const actual = createHash('sha256').update(fs.readFileSync(tmpFile)).digest('hex');
    if (actual !== expected) throw new Error(`체크섬 불일치: expected=${expected} actual=${actual}`);
    execSync(`tar -xzf "${tmpFile}" -C "${localBin}" trivy`, { stdio: 'inherit' });
    fs.chmodSync(path.join(localBin, 'trivy'), 0o755);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function warnPathIfMissing(localBin) {
  const pathEntries = (process.env.PATH || '').split(path.delimiter);
  if (!pathEntries.includes(localBin)) {
    console.log(`\n  ℹ️  PATH 확인: ${localBin} 이(가) PATH에 없습니다.`);
    console.log(`     셸 rc에 추가하세요: export PATH="$HOME/.local/bin:$PATH"`);
  }
}

function printManualScannerCommands(failures, localBin) {
  console.log('\n  ⚠️  자동 설치에 실패한 스캐너의 수동 설치 명령:');
  for (const s of failures) {
    if (s === 'semgrep') {
      console.log('     - semgrep: sudo apt install -y python3-venv pipx && pipx install semgrep');
    } else if (s === 'gitleaks') {
      console.log(`     - gitleaks: GitHub Releases에서 linux 바이너리 다운로드 → ${localBin}/`);
      console.log('               https://github.com/gitleaks/gitleaks/releases/latest');
    } else if (s === 'trivy') {
      console.log(`     - trivy: GitHub Releases에서 linux 바이너리 다운로드 → ${localBin}/`);
      console.log('               https://github.com/aquasecurity/trivy/releases/latest');
    }
  }
}

async function installNotifier(dryRun) {
  if (process.platform !== 'darwin') return;
  if (checkCmd('terminal-notifier')) {
    console.log('\n🔔 알림: terminal-notifier 감지됨, 설치 생략');
    return;
  }
  console.log('\n🔔 terminal-notifier 설치 중 (알림 신뢰성 강화)');
  if (dryRun) {
    console.log('[DRY RUN] terminal-notifier 설치를 건너뜁니다.');
    return;
  }
  try {
    execSync('brew install terminal-notifier', { stdio: 'inherit' });
    console.log('  ✅ terminal-notifier 설치 완료');
  } catch (e) {
    console.log(`  ⚠️  terminal-notifier 자동 설치 실패 (osascript로 폴백): ${e.message}`);
  }
}

async function installPlaywrightMcp(dryRun) {
  if (fs.existsSync(PLAYWRIGHT_MCP_BIN)) {
    console.log('\n🎭 Playwright MCP: ~/.npm-global/bin/playwright-mcp 감지됨, 설치 생략');
    return;
  }

  if (!checkCmd('npm')) {
    console.log('\n⚠️  Playwright MCP: `npm`을 찾을 수 없어 설치를 건너뜁니다. Node.js 설치 후 `cc-baseline --yes`를 재실행하세요.');
    return;
  }

  console.log('\n🎭 Playwright MCP 설치 중 (~/.npm-global 로컬 prefix)');
  if (dryRun) {
    console.log('[DRY RUN] Playwright MCP 설치를 건너뜁니다.');
    return;
  }

  try {
    fs.mkdirSync(NPM_GLOBAL_PREFIX, { recursive: true });
    execSync(`npm install -g @playwright/mcp --prefix "${NPM_GLOBAL_PREFIX}"`, { stdio: 'inherit' });
    if (fs.existsSync(PLAYWRIGHT_MCP_BIN)) {
      console.log('  ✅ Playwright MCP 설치 완료');
      console.log(`  ℹ️  PATH 확인: ${NPM_GLOBAL_PREFIX}/bin 이(가) PATH에 없으면 셸 rc에 추가하세요`);
    } else {
      console.log(`  ⚠️  npm 성공했으나 ${PLAYWRIGHT_MCP_BIN} 바이너리가 보이지 않음. 수동 확인 필요.`);
    }
  } catch (e) {
    console.log(`  ⚠️  Playwright MCP 자동 설치 실패 (수동 설치 필요): ${e.message}`);
    console.log(`     수동: npm install -g @playwright/mcp --prefix "${NPM_GLOBAL_PREFIX}"`);
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
    console.warn(`⚠️  ${filePath} 파싱 실패: ${e.message}`);
    return { __parseError: true };
  }
}

function writeFile(filePath, content, dryRun) {
  if (dryRun) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  // 이전 설치에서 read-only(444 등)로 남은 파일도 덮어쓸 수 있도록 권한 보정
  if (fs.existsSync(filePath)) {
    try { fs.chmodSync(filePath, 0o644); } catch {}
  }
  fs.writeFileSync(filePath, content, 'utf8');
}

async function install(opts = {}) {
  const { dryRun = false, yes: autoYes = false } = opts;

  console.log('\n🔧 cc-baseline — Claude Code 하네스 인스톨러\n');
  if (dryRun) {
    console.log('📋 [DRY RUN] 실제 변경 없이 예정 항목만 출력합니다.\n');
  }

  // ── 1. 기존 settings.json 읽기 → 충돌 검사 ─────────────────────────────
  const settingsPath = path.join(CLAUDE_DIR, 'settings.json');
  const existingSettingsRaw = readJson(settingsPath);
  if (existingSettingsRaw && existingSettingsRaw.__parseError) {
    const proceed = await confirm(
      `${settingsPath}이 손상되었습니다. 빈 객체로 덮어쓰면 기존 설정이 모두 소실됩니다. 계속하시겠습니까?`,
      autoYes
    );
    if (!proceed) { console.log('\n설치가 취소되었습니다.'); return; }
  }
  const existingSettings = (existingSettingsRaw && !existingSettingsRaw.__parseError) ? existingSettingsRaw : {};
  const existingHooks = existingSettings.hooks || {};

  const warnings = checkConflicts(existingHooks);
  if (warnings.length > 0) {
    console.log('⚠️  훅 충돌 감지:\n');
    for (const w of warnings) {
      const icon = w.severity === 'HIGH' ? '🚨' : w.severity === 'WARN' ? '⚠️ ' : 'ℹ️ ';
      console.log(`${icon} [${w.severity}] ${w.message}`);
      console.log(`   이유: ${w.reason}`);
      console.log(`   조치: ${w.action}\n`);
    }
    const proceed = await confirm(
      '위 경고를 확인했습니다. 계속 진행하겠습니까?',
      autoYes
    );
    if (!proceed) {
      console.log('\n설치가 취소되었습니다.');
      return;
    }
    console.log();
  }

  // ── 2. 백업 ──────────────────────────────────────────────────────────────
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
      console.log(`💾 백업 완료: ${backupDir}\n   (${backed.length}개 파일)\n`);
      appendLog(`BACKUP: ${backupDir}`);
    }
  }

  const changes = [];

  // ── 3. CLAUDE.md — 마커 블록 머지 ───────────────────────────────────────
  const claudeMdPath = path.join(CLAUDE_DIR, 'CLAUDE.md');
  const claudeMdTpl = readTemplate('CLAUDE.md');
  const claudeMdExisting = fs.existsSync(claudeMdPath)
    ? fs.readFileSync(claudeMdPath, 'utf8')
    : '';
  const claudeMdNew = mergeMarkerBlock(claudeMdExisting, claudeMdTpl);
  if (claudeMdNew !== claudeMdExisting) {
    changes.push({ label: 'CLAUDE.md', path: claudeMdPath, content: claudeMdNew });
    console.log(`  ✅ CLAUDE.md — ${claudeMdExisting ? '마커 블록 머지' : '신규 생성'}`);
  } else {
    console.log(`  ⏭️  CLAUDE.md — 변경 없음 (이미 최신)`);
  }

  // ── 4. memory/MEMORY.md — 마커 블록 머지 ────────────────────────────────
  const memMdPath = path.join(CLAUDE_DIR, 'memory', 'MEMORY.md');
  const memMdTpl = readTemplate('memory/MEMORY.md');
  const memMdExisting = fs.existsSync(memMdPath)
    ? fs.readFileSync(memMdPath, 'utf8')
    : '';
  const memMdNew = mergeMarkerBlock(memMdExisting, memMdTpl);
  if (memMdNew !== memMdExisting) {
    changes.push({ label: 'memory/MEMORY.md', path: memMdPath, content: memMdNew });
    console.log(`  ✅ memory/MEMORY.md — ${memMdExisting ? '마커 블록 머지' : '신규 생성'}`);
  } else {
    console.log(`  ⏭️  memory/MEMORY.md — 변경 없음 (이미 최신)`);
  }

  // ── 5. 개별 memory 파일 덮어쓰기 ────────────────────────────────────────
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
    console.log(`  ✅ memory/${f} — 덮어쓰기`);
  }

  // ── 5-1. scripts/audit-report.js ──────────────────────────────────────────
  const scriptPath = path.join(CLAUDE_DIR, 'scripts', 'audit-report.js');
  changes.push({ label: 'scripts/audit-report.js', path: scriptPath, content: readTemplate('scripts/audit-report.js') });
  console.log(`  ✅ scripts/audit-report.js — 덮어쓰기`);

  // ── 6. agents/e2e-tester.md ──────────────────────────────────────────────
  const agentPath = path.join(CLAUDE_DIR, 'agents', 'e2e-tester.md');
  changes.push({ label: 'agents/e2e-tester.md', path: agentPath, content: readTemplate('agents/e2e-tester.md') });
  console.log(`  ✅ agents/e2e-tester.md — 덮어쓰기`);

  // ── 6-1. agents/security-auditor.md ─────────────────────────────────────
  const auditorPath = path.join(CLAUDE_DIR, 'agents', 'security-auditor.md');
  changes.push({ label: 'agents/security-auditor.md', path: auditorPath, content: readTemplate('agents/security-auditor.md') });
  console.log(`  ✅ agents/security-auditor.md — 덮어쓰기`);

  // ── 6-2. agents/code-reviewer.md ─────────────────────────────────────────
  const codeReviewerPath = path.join(CLAUDE_DIR, 'agents', 'code-reviewer.md');
  changes.push({ label: 'agents/code-reviewer.md', path: codeReviewerPath, content: readTemplate('agents/code-reviewer.md') });
  console.log(`  ✅ agents/code-reviewer.md — 덮어쓰기`);

  // ── 7. commands/ ──────────────────────────────────────────────────────────
  for (const f of ['plan.md', 'clean.md']) {
    const dest = path.join(CLAUDE_DIR, 'commands', f);
    changes.push({ label: `commands/${f}`, path: dest, content: readTemplate(`commands/${f}`) });
    console.log(`  ✅ commands/${f} — 덮어쓰기`);
  }

  // ── 8. settings.json hooks 머지 ──────────────────────────────────────────
  const harnessHooks = JSON.parse(readTemplate('settings-hooks.json'));
  const mergedHooks = mergeHooks(existingHooks, harnessHooks);
  // permissions 키는 보안상 cc-baseline이 절대 추가/수정하지 않음. 사용자 기존 키는 그대로 보존.
  const newSettings = Object.assign({}, existingSettings, { hooks: mergedHooks });
  changes.push({
    label: 'settings.json (hooks 머지)',
    path: settingsPath,
    content: JSON.stringify(newSettings, null, 2),
  });
  console.log(`  ✅ settings.json — hooks 머지`);

  // ── 9. ~/.claude.json mcpServers 머지 ────────────────────────────────────
  const claudeJsonPath = path.join(HOME, '.claude.json');
  const existingClaudeJsonRaw = readJson(claudeJsonPath);
  if (existingClaudeJsonRaw && existingClaudeJsonRaw.__parseError) {
    const proceed = await confirm(
      `${claudeJsonPath}이 손상되었습니다. 빈 객체로 덮어쓰면 기존 설정이 모두 소실됩니다. 계속하시겠습니까?`,
      autoYes
    );
    if (!proceed) { console.log('\n설치가 취소되었습니다.'); return; }
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
      label: `.claude.json (mcpServers 머지)`,
      path: claudeJsonPath,
      content: JSON.stringify(newClaudeJson, null, 2),
    });
    const summary = [
      added.length ? `추가: [${added.join(', ')}]` : '',
      overwritten.length ? `교체: [${overwritten.join(', ')}]` : '',
    ].filter(Boolean).join(' / ');
    console.log(`  ✅ .claude.json — mcpServers ${summary}`);
  } else {
    console.log(`  ⏭️  .claude.json — 변경 없음`);
  }

  // ── 10. 요약 & 실제 쓰기 ─────────────────────────────────────────────────
  console.log(`\n📊 총 ${changes.length}개 항목 변경 예정\n`);

  if (dryRun) {
    console.log('[DRY RUN] 실제 파일은 변경되지 않았습니다.');
    return;
  }

  // 이전 설치 잠금(chmod 555) 마이그레이션: 레거시 잠금이 남아있을 수 있어 한 번 풀어줌
  // 신규 버전부터는 chmod 555 잠금 미적용 — 보호는 PreToolUse hook이 담당
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

  // bin/cli.js 실행 권한 보장
  try {
    fs.chmodSync(path.join(__dirname, '..', 'bin', 'cli.js'), 0o755);
  } catch {}

  // ── 11. 보안 스캐너 자동 설치 (semgrep, gitleaks, trivy) ──────────────────
  await installScanners(dryRun);

  // ── 11-1. terminal-notifier 자동 설치 (macOS 알림 신뢰성) ─────────────────
  await installNotifier(dryRun);

  // ── 12. Playwright MCP 바이너리 자동 설치 ─────────────────────────────────
  await installPlaywrightMcp(dryRun);

  console.log('✅ cc-baseline 설치 완료!\n');
  console.log(`📝 설치 로그: ${LOG_FILE}`);
  console.log(`💾 백업 위치: ${BACKUP_ROOT}\n`);
  appendLog('INSTALL COMPLETE');
}

module.exports = { install };
