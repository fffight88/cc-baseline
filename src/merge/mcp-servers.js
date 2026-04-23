'use strict';

async function mergeMcpServers(existing, incoming, confirmFn, autoYes) {
  const result = Object.assign({}, existing);
  const added = [];
  const overwritten = [];

  for (const [key, val] of Object.entries(incoming)) {
    if (result[key]) {
      const prev = result[key] || {};
      const isLegacyHarness =
        prev.command === 'npx' &&
        Array.isArray(prev.args) &&
        prev.args[0] === '@playwright/mcp';

      if (isLegacyHarness) {
        result[key] = val;
        overwritten.push(key);
        continue;
      }

      const ok = await confirmFn(
        `[mcpServers] "${key}"가 이미 존재합니다. 덮어쓰겠습니까?`,
        autoYes
      );
      if (ok) {
        result[key] = val;
        overwritten.push(key);
      }
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
