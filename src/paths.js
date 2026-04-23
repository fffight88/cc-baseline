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

module.exports = { HOME, PLACEHOLDER, applyHome, toPlaceholder, NPM_GLOBAL_PREFIX, PLAYWRIGHT_MCP_BIN };
