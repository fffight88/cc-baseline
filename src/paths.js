'use strict';

const os = require('os');
const path = require('path');

const HOME = os.homedir();
const PLACEHOLDER = '{{HOME}}';
const NPM_GLOBAL_PREFIX = path.join(HOME, '.npm-global');
const PLAYWRIGHT_MCP_BIN = path.join(NPM_GLOBAL_PREFIX, 'bin', 'playwright-mcp');

function applyHome(text) {
  return text.split(PLACEHOLDER).join(HOME);
}

function toPlaceholder(text) {
  return text.split(HOME).join(PLACEHOLDER);
}

// Resolves where cc-baseline writes its files for this invocation.
// Global mode (default) writes to ~/.claude/ and ~/.claude.json.
// Project mode (opts.project=true) writes to <cwd>/.claude/ and <cwd>/.mcp.json.
function resolveTarget(opts) {
  if (opts && opts.project) {
    const cwd = process.cwd();
    const claudeDir = path.join(cwd, '.claude');
    return {
      mode: 'project',
      basePath: cwd,
      claudeDir,
      mcpJsonPath: path.join(cwd, '.mcp.json'),
      backupRoot: path.join(claudeDir, '.cc-baseline-backup'),
      uninstallBackupRoot: path.join(claudeDir, '.cc-baseline-uninstall-backup'),
      installLog: path.join(claudeDir, '.cc-baseline-install.log'),
    };
  }
  const claudeDir = path.join(HOME, '.claude');
  return {
    mode: 'global',
    basePath: HOME,
    claudeDir,
    mcpJsonPath: path.join(HOME, '.claude.json'),
    backupRoot: path.join(claudeDir, '.cc-baseline-backup'),
    uninstallBackupRoot: path.join(claudeDir, '.cc-baseline-uninstall-backup'),
    installLog: path.join(claudeDir, '.cc-baseline-install.log'),
  };
}

module.exports = {
  HOME,
  PLACEHOLDER,
  applyHome,
  toPlaceholder,
  NPM_GLOBAL_PREFIX,
  PLAYWRIGHT_MCP_BIN,
  resolveTarget,
};
