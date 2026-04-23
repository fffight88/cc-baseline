'use strict';

const { execSync } = require('child_process');

function checkCmd(cmd) {
  try { execSync(`which ${cmd}`, { stdio: 'ignore' }); return true; } catch { return false; }
}

const fs = require('fs');
const path = require('path');

const { HOME } = require('./paths');
const { createBackup } = require('./backup');
const { confirm } = require('./prompt');
const { removeMarkerBlock, hasMarkerBlock } = require('./merge/markdown');
const { removeHarnessHooks } = require('./merge/settings-hooks');
const { removeHarnessMcpServers } = require('./merge/mcp-servers');

const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');
const CLAUDE_DIR = path.join(HOME, '.claude');
const BACKUP_ROOT = path.join(CLAUDE_DIR, '.cc-baseline-backup');
const UNINSTALL_BACKUP_ROOT = path.join(CLAUDE_DIR, '.cc-baseline-uninstall-backup');
const LOG_FILE = path.join(CLAUDE_DIR, '.cc-baseline-install.log');

const MEMORY_FILES = [
  'all_session_basic_rules.md',
  'doc_structure_rules.md',
  'phase_start.md',
  'phase_end.md',
  'reference_e2e_manager_guide.md',
  'reference_subagent_boundary.md',
  'reference_doc_writing_style.md',
  'feedback_skill_description_budget.md',
  'reference_security_auditor_protocol.md',
];

const HARNESS_FILES = [
  ...MEMORY_FILES.map(f => path.join(CLAUDE_DIR, 'memory', f)),
  path.join(CLAUDE_DIR, 'agents', 'e2e-tester.md'),
  path.join(CLAUDE_DIR, 'agents', 'security-auditor.md'),
  path.join(CLAUDE_DIR, 'commands', 'plan.md'),
  path.join(CLAUDE_DIR, 'commands', 'clean.md'),
];

const CLAUDE_MD_PATH = path.join(CLAUDE_DIR, 'CLAUDE.md');
const MEMORY_MD_PATH = path.join(CLAUDE_DIR, 'memory', 'MEMORY.md');
const SETTINGS_PATH = path.join(CLAUDE_DIR, 'settings.json');
const CLAUDE_JSON_PATH = path.join(HOME, '.claude.json');

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    console.warn(`⚠️  ${filePath} 파싱 실패: ${e.message}`);
    return { __parseError: true };
  }
}

function detectInstallation() {
  const signals = [];

  if (fs.existsSync(LOG_FILE)) signals.push('install.log');
  if (fs.existsSync(CLAUDE_MD_PATH) && hasMarkerBlock(fs.readFileSync(CLAUDE_MD_PATH, 'utf8'))) signals.push('CLAUDE.md 마커');
  if (fs.existsSync(MEMORY_MD_PATH) && hasMarkerBlock(fs.readFileSync(MEMORY_MD_PATH, 'utf8'))) signals.push('MEMORY.md 마커');
  if (fs.existsSync(HARNESS_FILES[0])) signals.push('memory 파일');

  const settingsRaw = readJson(SETTINGS_PATH);
  if (settingsRaw && !settingsRaw.__parseError && settingsRaw.hooks) {
    const { removedCount } = removeHarnessHooks(settingsRaw.hooks);
    if (removedCount > 0) signals.push(`settings.json 훅 ${removedCount}개`);
  }

  const claudeJsonRaw = readJson(CLAUDE_JSON_PATH);
  if (claudeJsonRaw && !claudeJsonRaw.__parseError) {
    const mcp = claudeJsonRaw.mcpServers || {};
    if ('playwright-test-1' in mcp) signals.push('mcpServers');
  }

  return { detected: signals.length > 0, signals };
}

function buildSummary() {
  const lines = [];

  for (const f of HARNESS_FILES) {
    if (fs.existsSync(f)) {
      lines.push(`  🗑️  ${f.replace(HOME, '~')}`);
    }
  }

  for (const p of [CLAUDE_MD_PATH, MEMORY_MD_PATH]) {
    if (fs.existsSync(p) && hasMarkerBlock(fs.readFileSync(p, 'utf8'))) {
      lines.push(`  🗑️  ${p.replace(HOME, '~')} (마커 블록 제거)`);
    }
  }

  const settingsRaw = readJson(SETTINGS_PATH);
  if (settingsRaw && !settingsRaw.__parseError && settingsRaw.hooks) {
    const { removedCount } = removeHarnessHooks(settingsRaw.hooks);
    if (removedCount > 0) lines.push(`  🗑️  ~/.claude/settings.json (훅 ${removedCount}개 제거)`);
  }

  const claudeJsonRaw = readJson(CLAUDE_JSON_PATH);
  if (claudeJsonRaw && !claudeJsonRaw.__parseError) {
    const harnessKeys = Object.keys(require(path.join(TEMPLATES_DIR, 'mcp-servers.json')));
    const { removed } = removeHarnessMcpServers(claudeJsonRaw.mcpServers || {}, harnessKeys);
    if (removed.length > 0) lines.push(`  🗑️  ~/.claude.json (mcpServers ${removed.length}개: ${removed.join(', ')})`);
  }

  if (fs.existsSync(LOG_FILE)) lines.push(`  🗑️  ~/.claude/.cc-baseline-install.log`);

  return lines;
}

async function uninstallScanners(dryRun) {
  const scanners = ['semgrep', 'gitleaks', 'trivy'];
  const present = scanners.filter(s => checkCmd(s));

  if (present.length === 0) {
    console.log('\n🔍 보안 스캐너: 설치된 항목 없음, 건너뜁니다.');
    return;
  }

  console.log(`\n🔍 보안 스캐너 제거 중: ${present.join(', ')}`);
  if (dryRun) {
    console.log('[DRY RUN] 스캐너 제거를 건너뜁니다.');
    return;
  }

  const platform = process.platform;

  for (const s of present) {
    try {
      if (platform === 'darwin') {
        execSync(`brew uninstall --force ${s}`, { stdio: 'inherit' });
        console.log(`  ✅ ${s} 제거 완료`);
      } else {
        if (s === 'semgrep') {
          execSync('pipx uninstall semgrep || pip uninstall -y semgrep', { stdio: 'inherit', shell: true });
        } else {
          const binPath = `/usr/local/bin/${s}`;
          if (fs.existsSync(binPath)) {
            try { fs.unlinkSync(binPath); }
            catch { execSync(`sudo rm -f ${binPath}`, { stdio: 'inherit' }); }
          }
        }
        console.log(`  ✅ ${s} 제거 완료`);
      }
    } catch (e) {
      console.log(`  ⚠️  ${s} 제거 실패 (수동 제거 필요): ${e.message}`);
    }
  }
}

async function uninstall(opts = {}) {
  const { dryRun = false, yes: autoYes = false, purge = false, removeScanners = false } = opts;

  console.log('\n🔧 cc-baseline — 제거\n');
  if (dryRun) {
    console.log('📋 [DRY RUN] 실제 변경 없이 제거 예정 항목만 출력합니다.\n');
  }

  // ── 1. 설치 감지 ──────────────────────────────────────────────────────────
  const { detected, signals } = detectInstallation();
  if (!detected) {
    console.log('✅ 설치된 cc-baseline 항목이 감지되지 않았습니다. 제거할 내용이 없습니다.');
    return;
  }
  console.log(`📦 감지된 설치 신호: ${signals.join(', ')}\n`);

  // ── 2. 제거 예정 요약 ─────────────────────────────────────────────────────
  const summaryLines = buildSummary();
  console.log(`📊 제거 예정 항목 (${summaryLines.length}개):`);
  for (const line of summaryLines) console.log(line);
  console.log();

  if (dryRun) {
    console.log('[DRY RUN] 실제 파일은 변경되지 않았습니다.');
    return;
  }

  // ── 3. 사용자 확인 ────────────────────────────────────────────────────────
  const proceed = await confirm('cc-baseline 항목을 모두 제거하시겠습니까?', autoYes);
  if (!proceed) {
    console.log('\n제거가 취소되었습니다.');
    return;
  }

  // ── 4. 스캐너 제거 확인 (--remove-scanners 없을 때만 대화형 확인) ─────────
  let doRemoveScanners = removeScanners;
  if (!removeScanners) {
    doRemoveScanners = await confirm(
      '외부 스캐너(semgrep/gitleaks/trivy)도 제거할까요? 다른 프로젝트에 영향을 줄 수 있습니다.',
      false  // --yes 플래그와 무관, 명시적 응답 필요
    );
  }

  // ── 5. 사전 백업 ─────────────────────────────────────────────────────────
  const filesToBackup = [
    CLAUDE_MD_PATH,
    MEMORY_MD_PATH,
    ...HARNESS_FILES,
    SETTINGS_PATH,
    CLAUDE_JSON_PATH,
  ];
  const { backupDir, backed } = createBackup(filesToBackup, UNINSTALL_BACKUP_ROOT);
  if (backupDir) {
    console.log(`\n💾 사전 백업 완료: ${backupDir}\n   (${backed.length}개 파일)\n`);
  }

  let successCount = 0;
  let skipCount = 0;
  const failures = [];

  // ── 6. 권한 복구 (chmod 755) ──────────────────────────────────────────────
  try {
    const memoryDir = path.join(CLAUDE_DIR, 'memory');
    if (fs.existsSync(memoryDir)) {
      fs.chmodSync(memoryDir, 0o755);
      successCount++;
    }
  } catch (e) {
    failures.push(`memory/ 권한 복구: ${e.message}`);
  }

  // ── 7. 하네스 파일 삭제 ───────────────────────────────────────────────────
  for (const f of HARNESS_FILES) {
    try {
      if (fs.existsSync(f)) {
        fs.unlinkSync(f);
        console.log(`  ✅ 삭제: ${f.replace(HOME, '~')}`);
        successCount++;
      } else {
        skipCount++;
      }
    } catch (e) {
      failures.push(`${f.replace(HOME, '~')}: ${e.message}`);
    }
  }

  // ── 8. 마커 블록 제거 (CLAUDE.md, MEMORY.md) ─────────────────────────────
  for (const filePath of [CLAUDE_MD_PATH, MEMORY_MD_PATH]) {
    try {
      if (!fs.existsSync(filePath)) { skipCount++; continue; }
      const existing = fs.readFileSync(filePath, 'utf8');
      const { content, removed, isEmpty } = removeMarkerBlock(existing);
      if (!removed) { skipCount++; continue; }
      if (isEmpty) {
        fs.unlinkSync(filePath);
        console.log(`  ✅ 삭제: ${filePath.replace(HOME, '~')} (내용 없음)`);
      } else {
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`  ✅ 마커 블록 제거: ${filePath.replace(HOME, '~')}`);
      }
      successCount++;
    } catch (e) {
      failures.push(`${filePath.replace(HOME, '~')}: ${e.message}`);
    }
  }

  // ── 9. settings.json hooks 정리 ───────────────────────────────────────────
  try {
    const raw = readJson(SETTINGS_PATH);
    if (!raw || raw.__parseError) {
      console.log(`  ⏭️  settings.json — 없음/파싱 실패, 건너뜀`);
      skipCount++;
    } else {
      const { hooks: newHooks, removedCount } = removeHarnessHooks(raw.hooks || {});
      if (removedCount === 0) {
        console.log(`  ⏭️  settings.json — 하네스 훅 없음`);
        skipCount++;
      } else {
        const next = Object.assign({}, raw);
        if (Object.keys(newHooks).length === 0) delete next.hooks;
        else next.hooks = newHooks;
        fs.writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2), 'utf8');
        console.log(`  ✅ settings.json — 훅 ${removedCount}개 제거`);
        successCount++;
      }
    }
  } catch (e) {
    failures.push(`settings.json: ${e.message}`);
  }

  // ── 10. .claude.json mcpServers 정리 ─────────────────────────────────────
  try {
    const raw = readJson(CLAUDE_JSON_PATH);
    if (!raw || raw.__parseError) {
      console.log(`  ⏭️  .claude.json — 없음/파싱 실패, 건너뜀`);
      skipCount++;
    } else {
      const harnessKeys = Object.keys(require(path.join(TEMPLATES_DIR, 'mcp-servers.json')));
      const { result: newMcp, removed, isEmpty } = removeHarnessMcpServers(raw.mcpServers || {}, harnessKeys);
      if (removed.length === 0) {
        console.log(`  ⏭️  .claude.json — 하네스 mcpServers 없음`);
        skipCount++;
      } else {
        const next = Object.assign({}, raw);
        if (isEmpty) delete next.mcpServers;
        else next.mcpServers = newMcp;
        fs.writeFileSync(CLAUDE_JSON_PATH, JSON.stringify(next, null, 2), 'utf8');
        console.log(`  ✅ .claude.json — mcpServers ${removed.length}개 제거 (${removed.join(', ')})`);
        successCount++;
      }
    }
  } catch (e) {
    failures.push(`.claude.json: ${e.message}`);
  }

  // ── 11. 메타 파일 정리 ────────────────────────────────────────────────────
  try {
    if (fs.existsSync(LOG_FILE)) {
      fs.unlinkSync(LOG_FILE);
      console.log(`  ✅ 삭제: ~/.claude/.cc-baseline-install.log`);
      successCount++;
    } else {
      skipCount++;
    }
  } catch (e) {
    failures.push(`.cc-baseline-install.log: ${e.message}`);
  }

  if (purge) {
    try {
      if (fs.existsSync(BACKUP_ROOT)) {
        fs.rmSync(BACKUP_ROOT, { recursive: true, force: true });
        console.log(`  ✅ 삭제: ~/.claude/.cc-baseline-backup/ (--purge)`);
        successCount++;
      }
    } catch (e) {
      failures.push(`.cc-baseline-backup/: ${e.message}`);
    }
  }

  // ── 12. 외부 스캐너 제거 ─────────────────────────────────────────────────
  if (doRemoveScanners) {
    await uninstallScanners(dryRun);
  }

  // ── 13. 요약 ─────────────────────────────────────────────────────────────
  console.log('\n─────────────────────────────────────');
  console.log(`✅ 제거 완료 — 성공: ${successCount} / 스킵: ${skipCount} / 실패: ${failures.length}`);
  if (backupDir) {
    console.log(`💾 사전 백업: ${backupDir}`);
    console.log(`   복구 방법: cp -r ${backupDir}/. ${HOME}/`);
  }
  if (failures.length > 0) {
    console.log('\n⚠️  실패 항목 (수동 처리 필요):');
    for (const f of failures) console.log(`   - ${f}`);
  }
  console.log();
}

module.exports = { uninstall, detectInstallation };
