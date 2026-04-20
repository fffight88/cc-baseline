'use strict';

async function mergeMcpServers(existing, incoming, confirmFn, autoYes) {
  const result = Object.assign({}, existing);
  const added = [];
  const overwritten = [];

  for (const [key, val] of Object.entries(incoming)) {
    if (result[key]) {
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

module.exports = { mergeMcpServers };
