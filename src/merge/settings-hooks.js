'use strict';

const { isHarnessHook } = require('../conflict-checker');

function mergeHooks(existingHooks, harnessHooks) {
  const result = JSON.parse(JSON.stringify(existingHooks || {}));

  for (const [event, harnessEntries] of Object.entries(harnessHooks)) {
    if (!result[event]) {
      result[event] = harnessEntries;
      continue;
    }

    for (const harnessEntry of harnessEntries) {
      for (const harnessHook of harnessEntry.hooks) {
        let replaced = false;

        // 동일 statusMessage를 가진 기존 하네스 훅 교체
        for (const existingEntry of result[event]) {
          const idx = (existingEntry.hooks || []).findIndex(
            h => h.statusMessage && h.statusMessage === harnessHook.statusMessage
          );
          if (idx !== -1) {
            existingEntry.hooks[idx] = harnessHook;
            replaced = true;
            break;
          }
        }

        if (!replaced) {
          // 동일 matcher를 가진 entry에 추가, 없으면 새 entry 생성
          const matcherTarget = harnessEntry.matcher;
          const matchEntry = result[event].find(e => e.matcher === matcherTarget);
          if (matchEntry) {
            matchEntry.hooks.push(harnessHook);
          } else {
            const newEntry = { hooks: [harnessHook] };
            if (matcherTarget !== undefined) newEntry.matcher = matcherTarget;
            result[event].push(newEntry);
          }
        }
      }
    }
  }

  return result;
}

module.exports = { mergeHooks };
