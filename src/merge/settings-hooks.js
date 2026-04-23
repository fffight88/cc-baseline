'use strict';

const { isHarnessHook } = require('../conflict-checker');

const HARNESS_STATUS_MESSAGES_ALL = [
  '세션 기본 규칙 로딩 중...',
  'E2E 테스트 가이드 로딩 중...',
  'cc-baseline 경로 정책 적용 중...',
];
const HARNESS_SESSION_END_COMMAND_PREFIX = "pgrep -f '@anthropic-ai/claude-code'";

function removeHarnessHooks(existingHooks) {
  const result = JSON.parse(JSON.stringify(existingHooks || {}));
  let removedCount = 0;

  for (const event of Object.keys(result)) {
    result[event] = result[event].map(entry => {
      const filtered = (entry.hooks || []).filter(hook => {
        const isStatusMsg = hook.statusMessage && HARNESS_STATUS_MESSAGES_ALL.includes(hook.statusMessage);
        const isSessionEndCmd = event === 'SessionEnd' &&
          typeof hook.command === 'string' &&
          hook.command.startsWith(HARNESS_SESSION_END_COMMAND_PREFIX);
        if (isStatusMsg || isSessionEndCmd) {
          removedCount++;
          return false;
        }
        return true;
      });
      return { ...entry, hooks: filtered };
    }).filter(entry => entry.hooks.length > 0);

    if (result[event].length === 0) {
      delete result[event];
    }
  }

  return { hooks: result, removedCount };
}

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

module.exports = { mergeHooks, removeHarnessHooks };
