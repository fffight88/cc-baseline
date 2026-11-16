'use strict';

// cc-baseline-managed MCP server keys are always silently overwritten.
// cc-baseline uses unique key names (playwright-test-N) to avoid collisions with user-defined keys.
function mergeMcpServers(existing, incoming) {
  const result = Object.assign({}, existing);
  const added = [];
  const overwritten = [];

  for (const [key, val] of Object.entries(incoming)) {
    if (result[key]) {
      result[key] = val;
      overwritten.push(key);
    } else {
      result[key] = val;
      added.push(key);
    }
  }

  return { result, added, overwritten };
}

function removeHarnessMcpServers(existing, harnessKeys) {
  const result = Object.assign({}, existing);
  const removed = [];

  for (const key of harnessKeys) {
    if (key in result) {
      delete result[key];
      removed.push(key);
    }
  }

  return { result, removed, isEmpty: Object.keys(result).length === 0 };
}

// Chromium cannot start its sandbox as root on Linux, so Playwright MCP fails
// to open a browser there unless it is told --no-sandbox.
function needsNoSandbox({ platform = process.platform, uid = typeof process.getuid === 'function' ? process.getuid() : null } = {}) {
  return platform === 'linux' && uid === 0;
}

function adaptMcpServers(servers, env = {}) {
  if (!needsNoSandbox(env)) return servers;
  const result = {};
  for (const [key, val] of Object.entries(servers)) {
    const args = Array.isArray(val && val.args) ? val.args : null;
    result[key] = key.startsWith('playwright-test-') && args && !args.includes('--no-sandbox')
      ? Object.assign({}, val, { args: [...args, '--no-sandbox'] })
      : val;
  }
  return result;
}

module.exports = { mergeMcpServers, removeHarnessMcpServers, adaptMcpServers, needsNoSandbox };
