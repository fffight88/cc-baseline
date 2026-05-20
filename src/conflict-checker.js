'use strict';

const { isHarnessHook } = require('./merge/settings-hooks');

function checkConflicts(existingHooks) {
  const warnings = [];

  // Rule 1: Non-harness hook exists in SessionStart
  const sessionStarts = existingHooks?.SessionStart ?? [];
  for (const entry of sessionStarts) {
    for (const hook of (entry.hooks ?? [])) {
      if (!isHarnessHook(hook, 'SessionStart')) {
        warnings.push({
          severity: 'WARN',
          rule: 1,
          event: 'SessionStart',
          message: 'Existing hook detected in SessionStart event.',
          reason:
            'cc-baseline also injects memory context in SessionStart. ' +
            'Both hooks run simultaneously, so conflicting instructions may cause unexpected Claude behavior.',
          action:
            'After install, review SessionStart hooks in ~/.claude/settings.json and merge if needed.',
        });
        break;
      }
    }
  }

  // Rule 2: PreToolUse matcher overlaps with playwright-test or covers .*
  const preToolUses = existingHooks?.PreToolUse ?? [];
  for (const entry of preToolUses) {
    const matcher = entry.matcher ?? '';
    const isHarness = (entry.hooks ?? []).some(h => isHarnessHook(h, 'PreToolUse'));
    if (!isHarness && (matcher === '.*' || matcher.includes('playwright-test'))) {
      warnings.push({
        severity: 'WARN',
        rule: 2,
        event: 'PreToolUse',
        matcher,
        message: `PreToolUse matcher "${matcher}" overlaps with playwright-test MCP.`,
        reason:
          'May double-fire with the E2E guide injection hook, or block playwright MCP calls entirely.',
        action: 'Narrow the matcher or merge it with the cc-baseline hook.',
      });
    }
  }

  // Rule 3: Static detection of decision:block/deny (SessionStart, PreToolUse)
  const criticalEvents = [
    ...(existingHooks?.SessionStart ?? []).map(e => ({ entry: e, event: 'SessionStart' })),
    ...(existingHooks?.PreToolUse ?? []).map(e => ({ entry: e, event: 'PreToolUse' })),
  ];
  for (const { entry, event } of criticalEvents) {
    for (const hook of (entry.hooks ?? [])) {
      if (isHarnessHook(hook, event)) continue;
      const cmd = typeof hook.command === 'string' ? hook.command : '';
      if (
        cmd.includes('"decision":"block"') ||
        cmd.includes('"decision":"deny"') ||
        cmd.includes("'decision':'block'") ||
        cmd.includes("'decision':'deny'")
      ) {
        warnings.push({
          severity: 'HIGH',
          rule: 3,
          event,
          message: 'A hook that blocks session or tool execution detected.',
          reason:
            'This hook may prevent cc-baseline boot or block MCP calls entirely.',
          action:
            'Remove this hook or manually review it before installing cc-baseline.',
        });
      }
    }
  }

  // Rule 4: Existing SessionEnd hook (informational)
  const sessionEnds = existingHooks?.SessionEnd ?? [];
  for (const entry of sessionEnds) {
    for (const hook of (entry.hooks ?? [])) {
      if (!isHarnessHook(hook, 'SessionEnd')) {
        warnings.push({
          severity: 'INFO',
          rule: 4,
          event: 'SessionEnd',
          message: 'Existing hook detected in SessionEnd event.',
          reason:
            "Runs alongside cc-baseline's SessionEnd hook (orphan claude process cleanup). Low conflict risk.",
          action: 'No action required. Both hooks run together.',
        });
        break;
      }
    }
  }

  return warnings;
}

module.exports = { checkConflicts, isHarnessHook };
