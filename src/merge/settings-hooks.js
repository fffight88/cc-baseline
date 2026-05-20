'use strict';

// Legacy identifiers — used so installs from older cc-baseline versions
// (which had no _ccBaselineId) can still be recognized and replaced cleanly.
const LEGACY_STATUS_MESSAGE_TO_ID = {
  'Loading session rules...': 'session-start-load-rules',
  'Applying cc-baseline path policy...': 'pre-tool-use-path-policy',
  'Loading E2E test guide...': 'pre-tool-use-e2e-guide',
};
const LEGACY_SESSION_END_COMMAND_PREFIX = "pgrep -f '@anthropic-ai/claude-code'";

// Returns the cc-baseline managed-hook ID for a hook entry, or null if it
// isn't one of ours. Recognizes both the new _ccBaselineId field and the
// legacy statusMessage / SessionEnd command signatures.
function harnessIdOf(hook, event) {
  if (!hook || typeof hook !== 'object') return null;
  if (typeof hook._ccBaselineId === 'string' && hook._ccBaselineId.length > 0) {
    return hook._ccBaselineId;
  }
  if (typeof hook.statusMessage === 'string' && LEGACY_STATUS_MESSAGE_TO_ID[hook.statusMessage]) {
    return LEGACY_STATUS_MESSAGE_TO_ID[hook.statusMessage];
  }
  if (event === 'SessionEnd' &&
      typeof hook.command === 'string' &&
      hook.command.startsWith(LEGACY_SESSION_END_COMMAND_PREFIX)) {
    return 'session-end-orphan-cleanup';
  }
  return null;
}

function isHarnessHook(hook, event) {
  return harnessIdOf(hook, event) !== null;
}

function removeHarnessHooks(existingHooks) {
  const result = JSON.parse(JSON.stringify(existingHooks || {}));
  let removedCount = 0;

  for (const event of Object.keys(result)) {
    result[event] = result[event].map(entry => {
      const filtered = (entry.hooks || []).filter(hook => {
        if (harnessIdOf(hook, event) !== null) {
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
      result[event] = JSON.parse(JSON.stringify(harnessEntries));
      continue;
    }

    for (const harnessEntry of harnessEntries) {
      for (const harnessHook of harnessEntry.hooks) {
        const harnessId = harnessIdOf(harnessHook, event);
        let replaced = false;

        // replace existing managed hook with the same ID (recognizes legacy
        // statusMessage-only installs so re-installing doesn't duplicate them)
        if (harnessId !== null) {
          for (const existingEntry of result[event]) {
            const idx = (existingEntry.hooks || []).findIndex(
              h => harnessIdOf(h, event) === harnessId
            );
            if (idx !== -1) {
              existingEntry.hooks[idx] = harnessHook;
              replaced = true;
              break;
            }
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

module.exports = { mergeHooks, removeHarnessHooks, isHarnessHook, harnessIdOf };
