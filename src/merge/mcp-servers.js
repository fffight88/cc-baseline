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

module.exports = { mergeMcpServers, removeHarnessMcpServers };
