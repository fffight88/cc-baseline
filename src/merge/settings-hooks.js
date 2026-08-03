'use strict';

// Legacy identifiers — used so installs from older cc-baseline versions
// (which had no _ccBaselineId) can still be recognized and replaced cleanly.
//
// statusMessage doubles as a matching key against already-installed hooks, so
// every value cc-baseline has ever shipped must stay listed here. The pre-i18n
// Korean strings are the ones installed before fad22c6 (2026-04-30) translated
// the templates; without them those hooks look foreign and get duplicated on
// the next install instead of replaced.
const LEGACY_STATUS_MESSAGE_TO_ID = {
  'Loading session rules...': 'session-start-load-rules',
  'Applying cc-baseline path policy...': 'pre-tool-use-path-policy',
  'Loading E2E test guide...': 'pre-tool-use-e2e-guide',
  '세션 기본 규칙 로딩 중...': 'session-start-load-rules',
  'cc-baseline 경로 정책 적용 중...': 'pre-tool-use-path-policy',
  'E2E 테스트 가이드 로딩 중...': 'pre-tool-use-e2e-guide',
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

          // Installs predating _ccBaselineId appended a fresh copy on every run,
          // so the same managed hook can sit in the file many times over.
          // Replacing the first match leaves the rest behind — they would keep
          // firing, and doctor would still report the hook as correctly
          // registered. Collapse every remaining copy of this ID.
          if (replaced) {
            let kept = false;
            for (const existingEntry of result[event]) {
              existingEntry.hooks = (existingEntry.hooks || []).filter(h => {
                if (harnessIdOf(h, event) !== harnessId) return true;
                if (!kept) { kept = true; return true; }
                return false;
              });
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

    // dedupe above can empty an entry out
    result[event] = result[event].filter(e => (e.hooks || []).length > 0);
  }

  return result;
}

module.exports = { mergeHooks, removeHarnessHooks, isHarnessHook, harnessIdOf };
