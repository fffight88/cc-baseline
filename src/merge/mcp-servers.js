'use strict';

// cc-baseline이 관리하는 MCP 서버 키는 항상 silent overwrite.
// 사용자 커스텀 키와 이름이 겹칠 가능성이 없도록 cc-baseline은 고유 키명(playwright-test-N)을 사용.
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
