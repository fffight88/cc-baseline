'use strict';

const { execSync } = require('child_process');

function checkCmd(cmd) {
  try { execSync(`which ${cmd}`, { stdio: 'ignore' }); return true; } catch { return false; }
}

const fs = require('fs');
const path = require('path');

const { HOME, NPM_GLOBAL_PREFIX, PLAYWRIGHT_MCP_BIN, resolveTarget } = require('./paths');
const { createBackup } = require('./backup');
const { confirm } = require('./prompt');
const { removeMarkerBlock, hasMarkerBlock } = require('./merge/markdown');
const { removeHarnessHooks } = require('./merge/settings-hooks');
const { removeHarnessMcpServers } = require('./merge/mcp-servers');
const manifest = require('./manifest');

const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');

function buildLayout(target) {
  return {
    target,
    CLAUDE_DIR: target.claudeDir,
    BACKUP_ROOT: target.backupRoot,
    UNINSTALL_BACKUP_ROOT: target.uninstallBackupRoot,
    LOG_FILE: target.installLog,
    HARNESS_FILES: manifest.overwriteFiles().map(f => path.join(target.claudeDir, f)),
    CLAUDE_MD_PATH: path.join(target.claudeDir, 'CLAUDE.md'),
    MEMORY_MD_PATH: path.join(target.claudeDir, 'memory', 'MEMORY.md'),
    SETTINGS_PATH: path.join(target.claudeDir, 'settings.json'),
    CLAUDE_JSON_PATH: target.mcpJsonPath,
  };
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

function detectInstallation(opts) {
  const layout = buildLayout(resolveTarget(opts || {}));
  const { LOG_FILE, CLAUDE_MD_PATH, MEMORY_MD_PATH, HARNESS_FILES, SETTINGS_PATH, CLAUDE_JSON_PATH } = layout;
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

function shortPath(p, target) {
  if (target.mode === 'global') return p.replace(HOME, '~');
  return path.relative(target.basePath, p);
}

function buildSummary(layout) {
  const { target, HARNESS_FILES, CLAUDE_MD_PATH, MEMORY_MD_PATH, SETTINGS_PATH, CLAUDE_JSON_PATH, LOG_FILE } = layout;
  const lines = [];

  for (const f of HARNESS_FILES) {
    if (fs.existsSync(f)) {
      lines.push(`  🗑️  ${shortPath(f, target)}`);
    }
  }

  for (const p of [CLAUDE_MD_PATH, MEMORY_MD_PATH]) {
    if (fs.existsSync(p) && hasMarkerBlock(fs.readFileSync(p, 'utf8'))) {
      lines.push(`  🗑️  ${shortPath(p, target)} (marker block removed)`);
    }
  }

  const settingsRaw = readJson(SETTINGS_PATH);
  if (settingsRaw && !settingsRaw.__parseError && settingsRaw.hooks) {
    const { removedCount } = removeHarnessHooks(settingsRaw.hooks);
    if (removedCount > 0) lines.push(`  🗑️  ${shortPath(SETTINGS_PATH, target)} (${removedCount} hook(s) removed)`);
  }

  const claudeJsonRaw = readJson(CLAUDE_JSON_PATH);
  if (claudeJsonRaw && !claudeJsonRaw.__parseError) {
    const harnessKeys = Object.keys(require(path.join(TEMPLATES_DIR, target.mode === 'project' ? 'mcp-servers.project.json' : 'mcp-servers.json')));
    const { removed } = removeHarnessMcpServers(claudeJsonRaw.mcpServers || {}, harnessKeys);
    if (removed.length > 0) lines.push(`  🗑️  ${shortPath(CLAUDE_JSON_PATH, target)} (${removed.length} mcpServer(s) removed: ${removed.join(', ')})`);
  }

  if (fs.existsSync(LOG_FILE)) lines.push(`  🗑️  ${shortPath(LOG_FILE, target)}`);
  if (target.mode === 'global' && fs.existsSync(PLAYWRIGHT_MCP_BIN)) {
    lines.push(`  🗑️  ~/.npm-global/bin/playwright-mcp (with --remove-scanners)`);
  }

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
  const target = resolveTarget(opts);
  const layout = buildLayout(target);
  const {
    CLAUDE_DIR, BACKUP_ROOT, UNINSTALL_BACKUP_ROOT, LOG_FILE,
    HARNESS_FILES, CLAUDE_MD_PATH, MEMORY_MD_PATH, SETTINGS_PATH, CLAUDE_JSON_PATH,
  } = layout;

  console.log('\n🔧 cc-baseline — Uninstall\n');
  if (dryRun) {
    console.log('📋 [DRY RUN] Printing planned removals only, no files will be modified.\n');
  }

  // ── 1. Detect installation ────────────────────────────────────────────────
  const { detected, signals } = detectInstallation(opts);
  if (!detected) {
    console.log('✅ No installed cc-baseline items detected. Nothing to remove.');
    return;
  }
  console.log(`📦 Detected install signals: ${signals.join(', ')}\n`);

  // ── 2. Removal summary ────────────────────────────────────────────────────
  const summaryLines = buildSummary(layout);
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

  // ── 4. Confirm scanner removal ──────────────────────────────────────────
  // Scanner removal affects other projects, so:
  //   - explicit --remove-scanners → yes
  //   - --yes (non-interactive) without --remove-scanners → no (safer default, won't hang CI)
  //   - interactive without --remove-scanners → ask
  let doRemoveScanners = removeScanners;
  if (!removeScanners && !autoYes) {
    doRemoveScanners = await confirm(
      'Also remove external scanners (semgrep/gitleaks/trivy)? This may affect other projects.',
      false
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
  const { backupDir, backed } = createBackup(filesToBackup, UNINSTALL_BACKUP_ROOT, target.basePath);
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
        console.log(`  ✅ Deleted: ${shortPath(f, target)}`);
        successCount++;
      } else {
        skipCount++;
      }
    } catch (e) {
      failures.push(`${shortPath(f, target)}: ${e.message}`);
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
        console.log(`  ✅ Deleted: ${shortPath(filePath, target)} (empty after removal)`);
      } else {
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`  ✅ Marker block removed: ${shortPath(filePath, target)}`);
      }
      successCount++;
    } catch (e) {
      failures.push(`${shortPath(filePath, target)}: ${e.message}`);
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

  // ── 10. Clean up mcpServers (global ~/.claude.json or project ./.mcp.json) ─
  try {
    const mcpLabel = shortPath(CLAUDE_JSON_PATH, target);
    const raw = readJson(CLAUDE_JSON_PATH);
    if (!raw || raw.__parseError) {
      console.log(`  ⏭️  ${mcpLabel} — missing or parse error, skipping`);
      skipCount++;
    } else {
      const harnessKeys = Object.keys(require(path.join(TEMPLATES_DIR, target.mode === 'project' ? 'mcp-servers.project.json' : 'mcp-servers.json')));
      const { result: newMcp, removed, isEmpty } = removeHarnessMcpServers(raw.mcpServers || {}, harnessKeys);
      if (removed.length === 0) {
        console.log(`  ⏭️  ${mcpLabel} — no harness mcpServers found`);
        skipCount++;
      } else {
        const next = Object.assign({}, raw);
        if (isEmpty) delete next.mcpServers;
        else next.mcpServers = newMcp;
        // Project install writes .mcp.json with a trailing newline so byte-equality
        // skips re-writes on idempotent installs; uninstall must match that shape.
        const writeSuffix = target.mode === 'project' ? '\n' : '';
        fs.writeFileSync(CLAUDE_JSON_PATH, JSON.stringify(next, null, 2) + writeSuffix, 'utf8');
        console.log(`  ✅ ${mcpLabel} — ${removed.length} mcpServer(s) removed (${removed.join(', ')})`);
        successCount++;
      }
    }
  } catch (e) {
    failures.push(`mcpServers cleanup: ${e.message}`);
  }

  // ── 11. Clean up meta files ────────────────────────────────────────────────
  try {
    if (fs.existsSync(LOG_FILE)) {
      fs.unlinkSync(LOG_FILE);
      console.log(`  ✅ Deleted: ${shortPath(LOG_FILE, target)}`);
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
        console.log(`  ✅ Deleted: ${shortPath(BACKUP_ROOT, target)} (--purge)`);
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
    console.log(`   Restore: cp -r ${backupDir}/. ${target.basePath}/`);
  }
  if (failures.length > 0) {
    console.log('\n⚠️  Failed items (manual action required):');
    for (const f of failures) console.log(`   - ${f}`);
  }
  console.log();
}

module.exports = { uninstall, detectInstallation };
