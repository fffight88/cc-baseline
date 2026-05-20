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

function checkClaudeDir(claudeDir) {
  if (!fs.existsSync(claudeDir)) {
    return fail('~/.claude/ directory', 'not found', 'run `npx --yes github:fffight88/cc-baseline --yes`');
  }
  return ok('~/.claude/ directory', 'present');
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

function checkHooks(claudeDir) {
  const settingsPath = path.join(claudeDir, 'settings.json');
  if (!fs.existsSync(settingsPath)) {
    return fail('Hooks (settings.json)', 'settings.json not found', 'run cc-baseline install');
  }
  const data = readJsonSafe(settingsPath);
  if (!data) {
    return fail('Hooks (settings.json)', 'settings.json could not be parsed', 'restore from ~/.claude/.cc-baseline-backup/');
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
  const missing = EXPECTED_HOOK_IDS.filter(id => !foundIds.has(id));
  if (missing.length === 0) {
    return ok('Hooks (settings.json)', `${EXPECTED_HOOK_IDS.length}/${EXPECTED_HOOK_IDS.length} managed hooks registered`);
  }
  return fail('Hooks (settings.json)',
    `${missing.length} missing: ${missing.join(', ')}`,
    'run cc-baseline install');
}

function checkMcpServers(mcpJsonPath) {
  const cjPath = mcpJsonPath;
  if (!fs.existsSync(cjPath)) {
    return fail('MCP servers (~/.claude.json)', 'file not found', 'run cc-baseline install');
  }
  const data = readJsonSafe(cjPath);
  if (!data) {
    return fail('MCP servers (~/.claude.json)', 'file could not be parsed', 'restore from backup');
  }
  const expected = [1, 2, 3, 4, 5].map(n => `playwright-test-${n}`);
  const mcp = data.mcpServers || {};
  const missing = expected.filter(k => !(k in mcp));
  if (missing.length === 0) {
    return ok('MCP servers (~/.claude.json)', `${expected.length}/${expected.length} playwright-test-* registered`);
  }
  return fail('MCP servers (~/.claude.json)',
    `missing: ${missing.join(', ')}`,
    'run cc-baseline install');
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
  return [
    checkClaudeDir(target.claudeDir),
    checkManifestIntegrity(),
    checkMarkerBlocks(target.claudeDir),
    checkInstalledFiles(target.claudeDir),
    checkHooks(target.claudeDir),
    checkMcpServers(target.mcpJsonPath),
    checkScanners(),
    checkPlaywrightMcp(),
    checkNotifier(),
  ];
}

function doctor(opts) {
  console.log('\n🩺 cc-baseline doctor\n');
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
