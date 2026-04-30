'use strict';

const { isHarnessHook } = require('../conflict-checker');

const HARNESS_STATUS_MESSAGES_ALL = [
  'Loading session rules...',
  'Loading E2E test guide...',
  'Applying cc-baseline path policy...',
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

        // replace existing harness hook with the same statusMessage
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
          // append to entry with the same matcher, or create new entry if none exists
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
