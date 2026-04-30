'use strict';

const { execSync } = require('child_process');

function checkCmd(cmd) {
  try { execSync(`which ${cmd}`, { stdio: 'ignore' }); return true; } catch { return false; }
}

const fs = require('fs');
const path = require('path');

const { HOME, NPM_GLOBAL_PREFIX, PLAYWRIGHT_MCP_BIN } = require('./paths');
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
    console.warn(`⚠️  Failed to parse ${filePath}: ${e.message}`);
    return { __parseError: true };
  }
}

function detectInstallation() {
  const signals = [];

  if (fs.existsSync(LOG_FILE)) signals.push('install.log');
  if (fs.existsSync(CLAUDE_MD_PATH) && hasMarkerBlock(fs.readFileSync(CLAUDE_MD_PATH, 'utf8'))) signals.push('CLAUDE.md marker');
  if (fs.existsSync(MEMORY_MD_PATH) && hasMarkerBlock(fs.readFileSync(MEMORY_MD_PATH, 'utf8'))) signals.push('MEMORY.md marker');
  if (fs.existsSync(HARNESS_FILES[0])) signals.push('memory files');

  const settingsRaw = readJson(SETTINGS_PATH);
  if (settingsRaw && !settingsRaw.__parseError && settingsRaw.hooks) {
    const { removedCount } = removeHarnessHooks(settingsRaw.hooks);
    if (removedCount > 0) signals.push(`settings.json hooks (${removedCount})`);
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
      lines.push(`  🗑️  ${p.replace(HOME, '~')} (marker block removed)`);
    }
  }

  const settingsRaw = readJson(SETTINGS_PATH);
  if (settingsRaw && !settingsRaw.__parseError && settingsRaw.hooks) {
    const { removedCount } = removeHarnessHooks(settingsRaw.hooks);
    if (removedCount > 0) lines.push(`  🗑️  ~/.claude/settings.json (${removedCount} hook(s) removed)`);
  }

  const claudeJsonRaw = readJson(CLAUDE_JSON_PATH);
  if (claudeJsonRaw && !claudeJsonRaw.__parseError) {
    const harnessKeys = Object.keys(require(path.join(TEMPLATES_DIR, 'mcp-servers.json')));
    const { removed } = removeHarnessMcpServers(claudeJsonRaw.mcpServers || {}, harnessKeys);
    if (removed.length > 0) lines.push(`  🗑️  ~/.claude.json (${removed.length} mcpServer(s) removed: ${removed.join(', ')})`);
  }

  if (fs.existsSync(LOG_FILE)) lines.push(`  🗑️  ~/.claude/.cc-baseline-install.log`);
  if (fs.existsSync(PLAYWRIGHT_MCP_BIN)) lines.push(`  🗑️  ~/.npm-global/bin/playwright-mcp (with --remove-scanners)`);

  return lines;
}

async function uninstallScanners(dryRun) {
  const scanners = ['semgrep', 'gitleaks', 'trivy'];
  const present = scanners.filter(s => checkCmd(s));
  const pwInstalled = fs.existsSync(PLAYWRIGHT_MCP_BIN);

  if (present.length === 0 && !pwInstalled) {
    console.log('\n🔍 External tools: nothing to remove, skipping.');
    return;
  }

  console.log(`\n🔍 Removing security scanners: ${present.join(', ')}`);
  if (dryRun) {
    console.log('[DRY RUN] Skipping scanner removal.');
    return;
  }

  const platform = process.platform;

  for (const s of present) {
    try {
      if (platform === 'darwin') {
        execSync(`brew uninstall --force ${s}`, { stdio: 'inherit' });
        console.log(`  ✅ ${s} removed`);
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
        console.log(`  ✅ ${s} removed`);
      }
    } catch (e) {
      console.log(`  ⚠️  ${s} removal failed (manual removal required): ${e.message}`);
    }
  }

  if (pwInstalled) {
    console.log('\n🎭 Removing Playwright MCP');
    if (dryRun) {
      console.log('[DRY RUN] Skipping Playwright MCP removal.');
    } else {
      try {
        execSync(`npm uninstall -g @playwright/mcp --prefix "${NPM_GLOBAL_PREFIX}"`, { stdio: 'inherit' });
        console.log('  ✅ @playwright/mcp removed');
      } catch (e) {
        console.log(`  ⚠️  @playwright/mcp removal failed (manual removal required): ${e.message}`);
      }
    }
  }
}

async function uninstall(opts = {}) {
  const { dryRun = false, yes: autoYes = false, purge = false, removeScanners = false } = opts;

  console.log('\n🔧 cc-baseline — Uninstall\n');
  if (dryRun) {
    console.log('📋 [DRY RUN] Printing planned removals only, no files will be modified.\n');
  }

  // ── 1. Detect installation ────────────────────────────────────────────────
  const { detected, signals } = detectInstallation();
  if (!detected) {
    console.log('✅ No installed cc-baseline items detected. Nothing to remove.');
    return;
  }
  console.log(`📦 Detected install signals: ${signals.join(', ')}\n`);

  // ── 2. Removal summary ────────────────────────────────────────────────────
  const summaryLines = buildSummary();
  console.log(`📊 Items to be removed (${summaryLines.length}):`);
  for (const line of summaryLines) console.log(line);
  console.log();

  if (dryRun) {
    console.log('[DRY RUN] No files were modified.');
    return;
  }

  // ── 3. User confirmation ──────────────────────────────────────────────────
  const proceed = await confirm('Remove all cc-baseline items?', autoYes);
  if (!proceed) {
    console.log('\nUninstall cancelled.');
    return;
  }

  // ── 4. Confirm scanner removal (only interactive when --remove-scanners not passed) ─
  let doRemoveScanners = removeScanners;
  if (!removeScanners) {
    doRemoveScanners = await confirm(
      'Also remove external scanners (semgrep/gitleaks/trivy)? This may affect other projects.',
      false  // independent of --yes flag, requires explicit answer
    );
  }

  // ── 5. Pre-uninstall backup ───────────────────────────────────────────────
  const filesToBackup = [
    CLAUDE_MD_PATH,
    MEMORY_MD_PATH,
    ...HARNESS_FILES,
    SETTINGS_PATH,
    CLAUDE_JSON_PATH,
  ];
  const { backupDir, backed } = createBackup(filesToBackup, UNINSTALL_BACKUP_ROOT);
  if (backupDir) {
    console.log(`\n💾 Pre-uninstall backup saved: ${backupDir}\n   (${backed.length} files)\n`);
  }

  let successCount = 0;
  let skipCount = 0;
  const failures = [];

  // ── 6. Restore permissions (chmod 755) ───────────────────────────────────────
  // legacy: restore directory locked to chmod 555 by earlier cc-baseline versions. New versions no longer lock.
  try {
    const memoryDir = path.join(CLAUDE_DIR, 'memory');
    if (fs.existsSync(memoryDir)) {
      fs.chmodSync(memoryDir, 0o755);
      successCount++;
    }
  } catch (e) {
    failures.push(`memory/ permission restore: ${e.message}`);
  }

  // ── 7. Delete harness files ────────────────────────────────────────────────
  for (const f of HARNESS_FILES) {
    try {
      if (fs.existsSync(f)) {
        fs.unlinkSync(f);
        console.log(`  ✅ Deleted: ${f.replace(HOME, '~')}`);
        successCount++;
      } else {
        skipCount++;
      }
    } catch (e) {
      failures.push(`${f.replace(HOME, '~')}: ${e.message}`);
    }
  }

  // ── 8. Remove marker blocks (CLAUDE.md, MEMORY.md) ────────────────────────
  for (const filePath of [CLAUDE_MD_PATH, MEMORY_MD_PATH]) {
    try {
      if (!fs.existsSync(filePath)) { skipCount++; continue; }
      const existing = fs.readFileSync(filePath, 'utf8');
      const { content, removed, isEmpty } = removeMarkerBlock(existing);
      if (!removed) { skipCount++; continue; }
      if (isEmpty) {
        fs.unlinkSync(filePath);
        console.log(`  ✅ Deleted: ${filePath.replace(HOME, '~')} (empty after removal)`);
      } else {
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`  ✅ Marker block removed: ${filePath.replace(HOME, '~')}`);
      }
      successCount++;
    } catch (e) {
      failures.push(`${filePath.replace(HOME, '~')}: ${e.message}`);
    }
  }

  // ── 9. Clean up settings.json hooks ──────────────────────────────────────
  try {
    const raw = readJson(SETTINGS_PATH);
    if (!raw || raw.__parseError) {
      console.log(`  ⏭️  settings.json — missing or parse error, skipping`);
      skipCount++;
    } else {
      const { hooks: newHooks, removedCount } = removeHarnessHooks(raw.hooks || {});
      if (removedCount === 0) {
        console.log(`  ⏭️  settings.json — no harness hooks found`);
        skipCount++;
      } else {
        const next = Object.assign({}, raw);
        if (Object.keys(newHooks).length === 0) delete next.hooks;
        else next.hooks = newHooks;
        fs.writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2), 'utf8');
        console.log(`  ✅ settings.json — ${removedCount} hook(s) removed`);
        successCount++;
      }
    }
  } catch (e) {
    failures.push(`settings.json: ${e.message}`);
  }

  // ── 10. Clean up .claude.json mcpServers ──────────────────────────────────
  try {
    const raw = readJson(CLAUDE_JSON_PATH);
    if (!raw || raw.__parseError) {
      console.log(`  ⏭️  .claude.json — missing or parse error, skipping`);
      skipCount++;
    } else {
      const harnessKeys = Object.keys(require(path.join(TEMPLATES_DIR, 'mcp-servers.json')));
      const { result: newMcp, removed, isEmpty } = removeHarnessMcpServers(raw.mcpServers || {}, harnessKeys);
      if (removed.length === 0) {
        console.log(`  ⏭️  .claude.json — no harness mcpServers found`);
        skipCount++;
      } else {
        const next = Object.assign({}, raw);
        if (isEmpty) delete next.mcpServers;
        else next.mcpServers = newMcp;
        fs.writeFileSync(CLAUDE_JSON_PATH, JSON.stringify(next, null, 2), 'utf8');
        console.log(`  ✅ .claude.json — ${removed.length} mcpServer(s) removed (${removed.join(', ')})`);
        successCount++;
      }
    }
  } catch (e) {
    failures.push(`.claude.json: ${e.message}`);
  }

  // ── 11. Clean up meta files ────────────────────────────────────────────────
  try {
    if (fs.existsSync(LOG_FILE)) {
      fs.unlinkSync(LOG_FILE);
      console.log(`  ✅ Deleted: ~/.claude/.cc-baseline-install.log`);
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
        console.log(`  ✅ Deleted: ~/.claude/.cc-baseline-backup/ (--purge)`);
        successCount++;
      }
    } catch (e) {
      failures.push(`.cc-baseline-backup/: ${e.message}`);
    }
  }

  // ── 12. Remove external scanners ─────────────────────────────────────────
  if (doRemoveScanners) {
    await uninstallScanners(dryRun);
  }

  // ── 13. Summary ──────────────────────────────────────────────────────────
  console.log('\n─────────────────────────────────────');
  console.log(`✅ Uninstall complete — succeeded: ${successCount} / skipped: ${skipCount} / failed: ${failures.length}`);
  if (backupDir) {
    console.log(`💾 Pre-uninstall backup: ${backupDir}`);
    console.log(`   Restore: cp -r ${backupDir}/. ${HOME}/`);
  }
  if (failures.length > 0) {
    console.log('\n⚠️  Failed items (manual action required):');
    for (const f of failures) console.log(`   - ${f}`);
  }
  console.log();
}

module.exports = { uninstall, detectInstallation };
