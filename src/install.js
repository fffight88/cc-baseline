'use strict';

const fs = require('fs');
const path = require('path');
const { applyHome, resolveTarget } = require('./paths');

const manifest = require('./manifest');
const { createBackup } = require('./backup');
const { confirm } = require('./prompt');
const { checkConflicts } = require('./conflict-checker');
const { mergeMarkerBlock, stripDuplicatePreamble } = require('./merge/markdown');
const { mergeHooks } = require('./merge/settings-hooks');
const { mergeMcpServers } = require('./merge/mcp-servers');
const { installScanners } = require('./installers/scanners');
const { installNotifier } = require('./installers/notifier');
const { installPlaywrightMcp } = require('./installers/playwright-mcp');

const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');

function appendLog(logFile, msg) {
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    const isNew = !fs.existsSync(logFile);
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`);
    if (isNew) fs.chmodSync(logFile, 0o600);
  } catch {}
}

function readTemplate(relPath) {
  const raw = fs.readFileSync(path.join(TEMPLATES_DIR, relPath), 'utf8');
  return applyHome(raw);
}

// Project mode swaps three templates that need different content from
// global mode: CLAUDE.md (relative paths, no {{HOME}}), settings-hooks
// (project- prefixed IDs + cwd-relative hooks), mcp-servers (npx-based
// command for portability across machines). All other 22 manifest files
// are byte-identical between modes.
const PROJECT_TEMPLATE_OVERRIDES = {
  'CLAUDE.md': 'project-CLAUDE.md',
  'settings-hooks.json': 'settings-hooks.project.json',
  'mcp-servers.json': 'mcp-servers.project.json',
};

function templateNameFor(relPath, target) {
  if (target.mode === 'project' && PROJECT_TEMPLATE_OVERRIDES[relPath]) {
    return PROJECT_TEMPLATE_OVERRIDES[relPath];
  }
  return relPath;
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

// Returns 'created' (file did not exist), 'overwritten' (existed, differs), or 'unchanged'.
function diffAction(filePath, content) {
  if (!fs.existsSync(filePath)) return 'created';
  let existing;
  try {
    existing = fs.readFileSync(filePath, 'utf8');
  } catch {
    return 'overwritten';
  }
  return existing === content ? 'unchanged' : 'overwritten';
}

async function install(opts = {}) {
  const {
    dryRun = false,
    yes: autoYes = false,
    skipScanners = false,
    dedupeLegacy = false,
  } = opts;
  const target = resolveTarget(opts);
  const CLAUDE_DIR = target.claudeDir;
  const BACKUP_ROOT = target.backupRoot;
  const LOG_FILE = target.installLog;

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

  const changes = [];

  // ── 2. CLAUDE.md / MEMORY.md — marker-block merge ─────────────────────────
  const legacyDupes = [];
  for (const relPath of manifest.markerBlockFiles()) {
    const filePath = path.join(CLAUDE_DIR, relPath);
    const tpl = readTemplate(templateNameFor(relPath, target));
    const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
    let merged = mergeMarkerBlock(existing, tpl);

    // An install predating the marker block appended instead of replacing, so a
    // stale copy of these same instructions can sit above the markers and never
    // update. Removing it is opt-in — it is still the user's file.
    const dup = stripDuplicatePreamble(merged, tpl);
    if (dup.changed) {
      if (dedupeLegacy) {
        merged = dup.content;
        console.log(`  🧹 ${relPath} — removed stale pre-marker section(s): ${dup.removed.join(', ')}`);
      } else {
        legacyDupes.push({ relPath, titles: dup.removed });
      }
    }

    if (merged === existing) {
      console.log(`  ⏭️  ${relPath} — no changes (already up to date)`);
      continue;
    }
    changes.push({ label: relPath, path: filePath, content: merged });
    console.log(`  ✅ ${relPath} — ${existing ? 'marker-block merged' : 'created'}`);
  }

  if (legacyDupes.length > 0) {
    const flag = target.mode === 'project' ? '--project --dedupe-legacy' : '--dedupe-legacy';
    console.log('\n⚠️  Duplicate pre-marker content detected:\n');
    for (const d of legacyDupes) {
      console.log(`   ${d.relPath} — "${d.titles.join('", "')}" appears both above and inside the cc-baseline block`);
    }
    console.log('   Reason: the first install found no marker block to replace, so it appended one.');
    console.log(`   Action: re-run with \`${flag}\` to remove the stale copy (a backup is written first).\n`);
  }

  // ── 3. Overwrite files (memory, scripts, agents, commands) ───────────────
  for (const relPath of manifest.overwriteFiles()) {
    const filePath = path.join(CLAUDE_DIR, relPath);
    const content = readTemplate(relPath);
    const action = diffAction(filePath, content);
    if (action === 'unchanged') {
      console.log(`  ⏭️  ${relPath} — no changes (already up to date)`);
      continue;
    }
    changes.push({ label: relPath, path: filePath, content });
    console.log(`  ✅ ${relPath} — ${action}`);
  }

  // ── 4. settings.json hooks merge ─────────────────────────────────────────
  const harnessHooks = JSON.parse(readTemplate(templateNameFor('settings-hooks.json', target)));
  const mergedHooks = mergeHooks(existingHooks, harnessHooks);
  // cc-baseline never adds or modifies the permissions key for security reasons; user-set keys are preserved as-is.
  const newSettings = Object.assign({}, existingSettings, { hooks: mergedHooks });
  const newSettingsStr = JSON.stringify(newSettings, null, 2);
  const existingSettingsStr = fs.existsSync(settingsPath) ? fs.readFileSync(settingsPath, 'utf8') : '';
  if (newSettingsStr === existingSettingsStr) {
    console.log(`  ⏭️  settings.json — no changes (hooks already up to date)`);
  } else {
    changes.push({
      label: 'settings.json (hooks merge)',
      path: settingsPath,
      content: newSettingsStr,
    });
    console.log(`  ✅ settings.json — hooks merged`);
  }

  // ── 5. MCP server registration ────────────────────────────────────────────
  //   Global mode: merge mcpServers key in ~/.claude.json
  //   Project mode: write whole-file .mcp.json (Claude Code auto-detects this
  //     file at project root and prompts the user for trust on first run)
  const claudeJsonPath = target.mcpJsonPath;
  const existingClaudeJsonRaw = readJson(claudeJsonPath);
  if (existingClaudeJsonRaw && existingClaudeJsonRaw.__parseError) {
    const proceed = await confirm(
      `${claudeJsonPath} is corrupted. Overwriting with an empty object will erase all existing settings. Continue?`,
      autoYes
    );
    if (!proceed) { console.log('\nInstall cancelled.'); return; }
  }
  const existingClaudeJson = (existingClaudeJsonRaw && !existingClaudeJsonRaw.__parseError) ? existingClaudeJsonRaw : {};
  const incomingMcp = JSON.parse(readTemplate(templateNameFor('mcp-servers.json', target)));

  if (target.mode === 'project') {
    // .mcp.json's top-level shape is { mcpServers: {...} } — the only Claude
    // Code-recognized format. Bare-format files (mcpServers as the root object
    // itself, no wrapper) are not supported by Claude Code, so we don't try to
    // preserve them; user-added entries inside the wrapped shape are merged.
    const existingMcpServers = (existingClaudeJson && existingClaudeJson.mcpServers) || {};
    const { result: mergedMcp, added, overwritten } = mergeMcpServers(existingMcpServers, incomingMcp);
    const newMcpJson = { mcpServers: mergedMcp };
    const newMcpJsonStr = JSON.stringify(newMcpJson, null, 2) + '\n';
    const existingMcpStr = fs.existsSync(claudeJsonPath) ? fs.readFileSync(claudeJsonPath, 'utf8') : '';
    if (newMcpJsonStr === existingMcpStr) {
      console.log(`  ⏭️  .mcp.json — no changes`);
    } else {
      changes.push({
        label: '.mcp.json (project MCP servers)',
        path: claudeJsonPath,
        content: newMcpJsonStr,
      });
      const summary = [
        added.length ? `added: [${added.join(', ')}]` : '',
        overwritten.length ? `replaced: [${overwritten.join(', ')}]` : '',
      ].filter(Boolean).join(' / ');
      const tail = summary || 'json reformatted';
      console.log(`  ✅ .mcp.json — mcpServers ${tail}`);
    }
  } else {
    const { result: mergedMcp, added, overwritten } = mergeMcpServers(
      existingClaudeJson.mcpServers || {},
      incomingMcp
    );
    const newClaudeJson = Object.assign({}, existingClaudeJson, { mcpServers: mergedMcp });
    const newClaudeJsonStr = JSON.stringify(newClaudeJson, null, 2);
    const existingClaudeJsonStr = fs.existsSync(claudeJsonPath) ? fs.readFileSync(claudeJsonPath, 'utf8') : '';
    if (newClaudeJsonStr === existingClaudeJsonStr) {
      console.log(`  ⏭️  .claude.json — no changes`);
    } else {
      changes.push({
        label: `.claude.json (mcpServers merge)`,
        path: claudeJsonPath,
        content: newClaudeJsonStr,
      });
      const summary = [
        added.length ? `added: [${added.join(', ')}]` : '',
        overwritten.length ? `replaced: [${overwritten.join(', ')}]` : '',
      ].filter(Boolean).join(' / ');
      const tail = summary || 'json reformatted';
      console.log(`  ✅ .claude.json — mcpServers ${tail}`);
    }
  }

  // ── 6. Summary & write ────────────────────────────────────────────────────
  console.log(`\n📊 ${changes.length} item(s) to be changed\n`);

  if (dryRun) {
    console.log('[DRY RUN] No files were modified.');
    return;
  }

  // ── 7. Backup only files that will actually change ────────────────────────
  if (changes.length > 0) {
    const filesToBackup = changes.map(c => c.path);
    const { backupDir, backed } = createBackup(filesToBackup, BACKUP_ROOT, target.basePath);
    if (backupDir) {
      console.log(`💾 Backup saved: ${backupDir}\n   (${backed.length} files)\n`);
      appendLog(LOG_FILE, `BACKUP: ${backupDir}`);
    }
  }

  // migration for legacy chmod 555 lock from previous installs: unlock once if still present
  // new versions no longer apply chmod 555 — protection is handled by the PreToolUse hook
  const memoryDir = path.join(CLAUDE_DIR, 'memory');
  if (fs.existsSync(memoryDir)) {
    try {
      fs.chmodSync(memoryDir, 0o755);
      appendLog(LOG_FILE, 'MIGRATE CHMOD 755: memory/ (legacy lock removal)');
    } catch {}
  }

  for (const change of changes) {
    writeFile(change.path, change.content, false);
    appendLog(LOG_FILE, `WRITE: ${change.path}`);
  }

  // ensure bin/cli.js is executable
  try {
    fs.chmodSync(path.join(__dirname, '..', 'bin', 'cli.js'), 0o755);
  } catch {}

  // ── 8. External tools (skippable via --skip-scanners) ─────────────────────
  if (skipScanners) {
    console.log('\n⏭️  Skipping security scanners + Playwright MCP install (--skip-scanners)');
  } else {
    await installScanners(dryRun);
    await installNotifier(dryRun);
    await installPlaywrightMcp(dryRun);
  }

  console.log('✅ cc-baseline install complete!\n');
  console.log(`📝 Install log: ${LOG_FILE}`);
  console.log(`💾 Backup location: ${BACKUP_ROOT}\n`);
  appendLog(LOG_FILE, 'INSTALL COMPLETE');
}

module.exports = { install };
