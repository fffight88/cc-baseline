'use strict';

const fs = require('fs');
const path = require('path');

const { HOME, applyHome, PLAYWRIGHT_MCP_BIN, resolveTarget } = require('./paths');
const manifest = require('./manifest');
const { harnessIdOf } = require('./merge/settings-hooks');
const { hasMarkerBlock } = require('./merge/markdown');
const { checkCmd } = require('./installers/_util');

const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');

const EXPECTED_HOOK_IDS = [
  'session-start-load-rules',
  'pre-tool-use-path-policy',
  'pre-tool-use-e2e-guide',
  'session-end-orphan-cleanup',
];

const PROJECT_EXPECTED_HOOK_IDS = [
  'project-session-start-load-rules',
  'project-pre-tool-use-path-policy',
];


function ok(name, detail) { return { name, status: 'ok', detail }; }
function warn(name, detail, fix) { return { name, status: 'warn', detail, fix }; }
function fail(name, detail, fix) { return { name, status: 'fail', detail, fix }; }

function readJsonSafe(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return null; }
}

function readTemplate(rel) {
  return applyHome(fs.readFileSync(path.join(TEMPLATES_DIR, rel), 'utf8'));
}

function checkClaudeDir(claudeDir, target) {
  const label = target && target.mode === 'project' ? './.claude/ directory' : '~/.claude/ directory';
  const fix = target && target.mode === 'project'
    ? 'run `npx --yes github:fffight88/cc-baseline --project --yes`'
    : 'run `npx --yes github:fffight88/cc-baseline --yes`';
  if (!fs.existsSync(claudeDir)) {
    return fail(label, 'not found', fix);
  }
  return ok(label, 'present');
}

function checkManifestIntegrity() {
  const files = manifest.allFiles();
  const missing = files.filter(rel => !fs.existsSync(path.join(TEMPLATES_DIR, rel)));
  if (missing.length === 0) {
    return ok('Package manifest', `${files.length} template files listed and present`);
  }
  return fail('Package manifest',
    `${missing.length} template file(s) missing from package: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? '...' : ''}`,
    'reinstall the cc-baseline package');
}

function checkMarkerBlocks(claudeDir) {
  const missing = [];
  for (const rel of manifest.markerBlockFiles()) {
    const dest = path.join(claudeDir, rel);
    if (!fs.existsSync(dest)) { missing.push(rel); continue; }
    if (!hasMarkerBlock(fs.readFileSync(dest, 'utf8'))) missing.push(rel);
  }
  if (missing.length === 0) {
    return ok('Marker blocks', `${manifest.markerBlockFiles().length}/${manifest.markerBlockFiles().length} present`);
  }
  return fail('Marker blocks',
    `missing or empty in: ${missing.join(', ')}`,
    'run `npx --yes github:fffight88/cc-baseline --yes`');
}

function checkInstalledFiles(claudeDir) {
  const overwriteFiles = manifest.overwriteFiles();
  const missing = [];
  const drift = [];
  for (const rel of overwriteFiles) {
    const dest = path.join(claudeDir, rel);
    if (!fs.existsSync(dest)) { missing.push(rel); continue; }
    // Overwrite files are byte-identical between modes — install applies the
    // same {{HOME}} substitution in both modes, so doctor uses readTemplate()
    // for both. (Only CLAUDE.md / settings.json / .mcp.json differ between
    // modes, and those are checked separately, not in this list.)
    const expected = readTemplate(rel);
    const actual = fs.readFileSync(dest, 'utf8');
    if (expected !== actual) drift.push(rel);
  }
  if (missing.length === 0 && drift.length === 0) {
    return ok('Installed files', `${overwriteFiles.length}/${overwriteFiles.length} present and match template`);
  }
  if (missing.length > 0) {
    return fail('Installed files',
      `${missing.length} missing: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? '...' : ''}` +
        (drift.length > 0 ? `; ${drift.length} diverge from template` : ''),
      'run `npx --yes github:fffight88/cc-baseline --yes`');
  }
  return warn('Installed files',
    `${drift.length}/${overwriteFiles.length} diverge from template: ${drift.slice(0, 3).join(', ')}${drift.length > 3 ? '...' : ''}`,
    're-run install to reset, or fork the repo to persist customizations');
}

function checkHooks(claudeDir, target) {
  const isProject = target && target.mode === 'project';
  const label = isProject ? 'Hooks (./.claude/settings.json)' : 'Hooks (settings.json)';
  const expectedIds = isProject ? PROJECT_EXPECTED_HOOK_IDS : EXPECTED_HOOK_IDS;
  const fixCmd = isProject
    ? 'run `npx --yes github:fffight88/cc-baseline --project --yes`'
    : 'run cc-baseline install';

  const settingsPath = path.join(claudeDir, 'settings.json');
  if (!fs.existsSync(settingsPath)) {
    return fail(label, 'settings.json not found', fixCmd);
  }
  const data = readJsonSafe(settingsPath);
  if (!data) {
    return fail(label, 'settings.json could not be parsed', 'restore from backup');
  }
  const hooks = data.hooks || {};
  const foundIds = new Set();
  for (const event of Object.keys(hooks)) {
    for (const entry of hooks[event] || []) {
      for (const h of (entry.hooks || [])) {
        const id = harnessIdOf(h, event);
        if (id) foundIds.add(id);
      }
    }
  }
  const missing = expectedIds.filter(id => !foundIds.has(id));
  if (missing.length === 0) {
    return ok(label, `${expectedIds.length}/${expectedIds.length} managed hooks registered`);
  }
  return fail(label, `${missing.length} missing: ${missing.join(', ')}`, fixCmd);
}

function checkMcpServers(mcpJsonPath, target) {
  const isProject = target && target.mode === 'project';
  const label = isProject ? 'MCP servers (./.mcp.json)' : 'MCP servers (~/.claude.json)';
  const fixCmd = isProject
    ? 'run `npx --yes github:fffight88/cc-baseline --project --yes`'
    : 'run cc-baseline install';
  if (!fs.existsSync(mcpJsonPath)) {
    return fail(label, 'file not found', fixCmd);
  }
  const data = readJsonSafe(mcpJsonPath);
  if (!data) {
    return fail(label, 'file could not be parsed', 'restore from backup');
  }
  const expected = [1, 2, 3, 4, 5].map(n => `playwright-test-${n}`);
  const mcp = data.mcpServers || {};
  const missing = expected.filter(k => !(k in mcp));
  if (missing.length === 0) {
    return ok(label, `${expected.length}/${expected.length} playwright-test-* registered`);
  }
  return fail(label, `missing: ${missing.join(', ')}`, fixCmd);
}

// Project-mode informational check: reports whether the user also has a
// global cc-baseline install. Never fails — purely advisory so the user
// knows whether project + global will both load (overlay) or only project.
function checkGlobalInstallReference() {
  const globalDir = path.join(HOME, '.claude');
  const globalSettings = path.join(globalDir, 'settings.json');
  if (!fs.existsSync(globalSettings)) {
    return ok('Global cc-baseline (informational)', 'not installed (project will run standalone)');
  }
  const data = readJsonSafe(globalSettings);
  if (!data || !data.hooks) {
    return ok('Global cc-baseline (informational)', 'global ~/.claude/ exists but no hooks detected');
  }
  let hasGlobal = false;
  for (const event of Object.keys(data.hooks)) {
    for (const entry of data.hooks[event] || []) {
      for (const h of (entry.hooks || [])) {
        const id = harnessIdOf(h, event);
        if (id && EXPECTED_HOOK_IDS.includes(id)) hasGlobal = true;
      }
    }
  }
  return ok('Global cc-baseline (informational)',
    hasGlobal ? 'installed (project hooks layer on top — overlay mode)' : 'not installed (project will run standalone)');
}

function checkProjectCLAUDE(claudeDir) {
  const filePath = path.join(claudeDir, 'CLAUDE.md');
  if (!fs.existsSync(filePath)) {
    return fail('Project CLAUDE.md', 'not found', 'run `npx --yes github:fffight88/cc-baseline --project --yes`');
  }
  if (!hasMarkerBlock(fs.readFileSync(filePath, 'utf8'))) {
    return fail('Project CLAUDE.md', 'marker block missing', 'run `npx --yes github:fffight88/cc-baseline --project --yes`');
  }
  return ok('Project CLAUDE.md', 'marker block present');
}

function checkProjectMemoryMd(claudeDir) {
  const filePath = path.join(claudeDir, 'memory', 'MEMORY.md');
  if (!fs.existsSync(filePath)) {
    return fail('Project MEMORY.md', 'not found', 'run `npx --yes github:fffight88/cc-baseline --project --yes`');
  }
  if (!hasMarkerBlock(fs.readFileSync(filePath, 'utf8'))) {
    return fail('Project MEMORY.md', 'marker block missing', 'run `npx --yes github:fffight88/cc-baseline --project --yes`');
  }
  return ok('Project MEMORY.md', 'marker block present');
}

function checkScanners() {
  const scanners = ['semgrep', 'gitleaks', 'trivy'];
  const present = scanners.filter(s => checkCmd(s));
  if (present.length === scanners.length) {
    return ok('Security scanners', present.join(', '));
  }
  const missing = scanners.filter(s => !present.includes(s));
  return warn('Security scanners',
    `missing: ${missing.join(', ')}`,
    'security-auditor falls back to manual code review when scanners are absent; re-run install to retry');
}

function checkPlaywrightMcp() {
  if (fs.existsSync(PLAYWRIGHT_MCP_BIN)) {
    return ok('Playwright MCP binary', PLAYWRIGHT_MCP_BIN.replace(HOME, '~'));
  }
  return warn('Playwright MCP binary',
    `not found at ${PLAYWRIGHT_MCP_BIN.replace(HOME, '~')}`,
    'npm install -g @playwright/mcp --prefix ~/.npm-global');
}

function checkNotifier() {
  if (process.platform === 'darwin') {
    if (checkCmd('terminal-notifier')) {
      return ok('Notifier (terminal-notifier)', 'installed');
    }
    return warn('Notifier (terminal-notifier)', 'not found',
      'brew install terminal-notifier (falls back to osascript without it)');
  }
  if (checkCmd('notify-send')) return ok('Notifier (notify-send)', 'installed');
  return warn('Notifier (notify-send)', 'not found',
    'apt install libnotify-bin (notifications will be silent without it)');
}

function runChecks(opts) {
  const target = resolveTarget(opts || {});

  if (target.mode === 'project') {
    // Project mode: skip scanners/notifier/Playwright MCP binary — those are
    // machine-global and belong to the global doctor. Add an informational
    // check that reports whether the global install is also present, so the
    // user understands overlay vs. standalone behavior.
    return [
      checkClaudeDir(target.claudeDir, target),
      checkManifestIntegrity(),
      checkProjectCLAUDE(target.claudeDir),
      checkProjectMemoryMd(target.claudeDir),
      checkInstalledFiles(target.claudeDir),
      checkHooks(target.claudeDir, target),
      checkMcpServers(target.mcpJsonPath, target),
      checkGlobalInstallReference(),
    ];
  }

  return [
    checkClaudeDir(target.claudeDir, target),
    checkManifestIntegrity(),
    checkMarkerBlocks(target.claudeDir),
    checkInstalledFiles(target.claudeDir),
    checkHooks(target.claudeDir, target),
    checkMcpServers(target.mcpJsonPath, target),
    checkScanners(),
    checkPlaywrightMcp(),
    checkNotifier(),
  ];
}

function doctor(opts) {
  const target = resolveTarget(opts || {});
  const header = target.mode === 'project'
    ? `\n🩺 cc-baseline doctor (project mode — ${target.basePath})\n`
    : '\n🩺 cc-baseline doctor\n';
  console.log(header);
  const results = runChecks(opts);
  let okCount = 0, warnCount = 0, failCount = 0;
  for (const r of results) {
    const icon = r.status === 'ok' ? '✅' : r.status === 'warn' ? '⚠️ ' : '❌';
    console.log(`${icon} ${r.name}`);
    console.log(`   ${r.detail}`);
    if (r.fix && r.status !== 'ok') console.log(`   Fix: ${r.fix}`);
    console.log();
    if (r.status === 'ok') okCount++;
    else if (r.status === 'warn') warnCount++;
    else failCount++;
  }
  console.log('─────────────────────────────────────');
  console.log(`${okCount} ok · ${warnCount} warn · ${failCount} fail`);
  return failCount === 0 ? 0 : 1;
}

module.exports = { doctor, runChecks };
