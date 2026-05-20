'use strict';

const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const { mergeMarkerBlock, removeMarkerBlock, hasMarkerBlock } = require(path.join(ROOT, 'src', 'merge', 'markdown'));
const {
  mergeHooks,
  removeHarnessHooks,
  isHarnessHook,
  harnessIdOf,
} = require(path.join(ROOT, 'src', 'merge', 'settings-hooks'));
const {
  mergeMcpServers,
  removeHarnessMcpServers,
} = require(path.join(ROOT, 'src', 'merge', 'mcp-servers'));
const { applyHome, toPlaceholder, HOME, PLACEHOLDER } = require(path.join(ROOT, 'src', 'paths'));
const manifest = require(path.join(ROOT, 'src', 'manifest'));
const { checkConflicts } = require(path.join(ROOT, 'src', 'conflict-checker'));
const { runChecks } = require(path.join(ROOT, 'src', 'doctor'));

const tests = [];
function t(name, fn) { tests.push({ name, fn }); }

// ──────────────────────────────────────────────────────────────────────────
// markdown.js — marker-block merge
// ──────────────────────────────────────────────────────────────────────────

t('mergeMarkerBlock: insert into empty file', () => {
  const result = mergeMarkerBlock('', 'hello');
  assert.match(result, /<!-- BEGIN cc-baseline -->/);
  assert.match(result, /<!-- END cc-baseline -->/);
  assert.match(result, /hello/);
});

t('mergeMarkerBlock: append to existing file without marker block', () => {
  const existing = '# My doc\n\nSome content.\n';
  const result = mergeMarkerBlock(existing, 'baseline');
  assert.ok(result.startsWith(existing.trimEnd()) || result.startsWith(existing));
  assert.match(result, /baseline/);
});

t('mergeMarkerBlock: replace existing marker block', () => {
  const existing = '# Doc\n\n<!-- BEGIN cc-baseline -->\nOLD\n<!-- END cc-baseline -->\n';
  const result = mergeMarkerBlock(existing, 'NEW');
  assert.match(result, /NEW/);
  assert.ok(!result.includes('OLD'));
});

t('mergeMarkerBlock: idempotent on second run', () => {
  const once = mergeMarkerBlock('# Doc\n', 'X');
  const twice = mergeMarkerBlock(once, 'X');
  assert.equal(once, twice);
});

t('removeMarkerBlock: strips block and reports removal', () => {
  const existing = '# Doc\n\n<!-- BEGIN cc-baseline -->\nX\n<!-- END cc-baseline -->\n';
  const { content, removed, isEmpty } = removeMarkerBlock(existing);
  assert.equal(removed, true);
  assert.equal(isEmpty, false);
  assert.ok(!content.includes('cc-baseline'));
  assert.match(content, /# Doc/);
});

t('removeMarkerBlock: no block → removed=false', () => {
  const { removed } = removeMarkerBlock('# Doc only\n');
  assert.equal(removed, false);
});

t('removeMarkerBlock: isEmpty true when only marker block existed', () => {
  const only = '<!-- BEGIN cc-baseline -->\nX\n<!-- END cc-baseline -->\n';
  const { isEmpty } = removeMarkerBlock(only);
  assert.equal(isEmpty, true);
});

t('hasMarkerBlock: true when both markers present', () => {
  assert.equal(hasMarkerBlock('x<!-- BEGIN cc-baseline -->y<!-- END cc-baseline -->z'), true);
  assert.equal(hasMarkerBlock('plain text'), false);
});

// ──────────────────────────────────────────────────────────────────────────
// settings-hooks.js — ID-based dedup + legacy fallback
// ──────────────────────────────────────────────────────────────────────────

const harnessTemplate = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'templates', 'settings-hooks.json'), 'utf8')
);

t('settings-hooks template: every harness hook has _ccBaselineId', () => {
  const ids = [];
  for (const event of Object.keys(harnessTemplate)) {
    for (const entry of harnessTemplate[event]) {
      for (const hook of entry.hooks) {
        assert.ok(hook._ccBaselineId, `missing _ccBaselineId in ${event} hook`);
        ids.push(hook._ccBaselineId);
      }
    }
  }
  assert.equal(new Set(ids).size, ids.length, 'duplicate IDs in template');
});

t('harnessIdOf: prefers _ccBaselineId', () => {
  assert.equal(harnessIdOf({ _ccBaselineId: 'x', statusMessage: 'irrelevant' }), 'x');
});

t('harnessIdOf: falls back to legacy statusMessage', () => {
  assert.equal(harnessIdOf({ statusMessage: 'Loading session rules...' }), 'session-start-load-rules');
  assert.equal(harnessIdOf({ statusMessage: 'Applying cc-baseline path policy...' }), 'pre-tool-use-path-policy');
  assert.equal(harnessIdOf({ statusMessage: 'Loading E2E test guide...' }), 'pre-tool-use-e2e-guide');
});

t('harnessIdOf: matches SessionEnd legacy command prefix only when event=SessionEnd', () => {
  const hook = { command: "pgrep -f '@anthropic-ai/claude-code' | while read pid; do :; done" };
  assert.equal(harnessIdOf(hook, 'SessionEnd'), 'session-end-orphan-cleanup');
  assert.equal(harnessIdOf(hook, 'PreToolUse'), null);
});

t('harnessIdOf: unrelated hook returns null', () => {
  assert.equal(harnessIdOf({ command: 'echo hi' }), null);
  assert.equal(harnessIdOf(null), null);
});

t('isHarnessHook: returns boolean', () => {
  assert.equal(isHarnessHook({ _ccBaselineId: 'x' }), true);
  assert.equal(isHarnessHook({ command: 'echo hi' }), false);
});

t('mergeHooks: empty existing → harness installed verbatim', () => {
  const result = mergeHooks({}, harnessTemplate);
  assert.deepEqual(Object.keys(result).sort(), ['PreToolUse', 'SessionEnd', 'SessionStart']);
  const ids = result.SessionStart[0].hooks.map(h => h._ccBaselineId);
  assert.deepEqual(ids, ['session-start-load-rules']);
});

t('mergeHooks: running twice is idempotent (no duplicates)', () => {
  const once = mergeHooks({}, harnessTemplate);
  const twice = mergeHooks(once, harnessTemplate);
  // count total harness hooks in both runs — must match
  const count = (h) => Object.values(h).reduce((acc, entries) => acc + entries.reduce((s, e) => s + e.hooks.length, 0), 0);
  assert.equal(count(once), count(twice));
});

t('mergeHooks: legacy install (no _ccBaselineId, only statusMessage) → upgraded in place not duplicated', () => {
  const legacy = {
    SessionStart: [{
      hooks: [{
        type: 'command',
        command: 'old python script',
        statusMessage: 'Loading session rules...',
      }],
    }],
  };
  const result = mergeHooks(legacy, harnessTemplate);
  const startHooks = result.SessionStart.flatMap(e => e.hooks);
  // exactly one session-start hook present, and it has the new ID
  assert.equal(startHooks.length, 1);
  assert.equal(startHooks[0]._ccBaselineId, 'session-start-load-rules');
});

t('mergeHooks: legacy SessionEnd (command prefix only) → upgraded in place', () => {
  const legacy = {
    SessionEnd: [{
      hooks: [{
        type: 'command',
        command: "pgrep -f '@anthropic-ai/claude-code' | while read pid; do kill $pid; done",
      }],
    }],
  };
  const result = mergeHooks(legacy, harnessTemplate);
  const endHooks = result.SessionEnd.flatMap(e => e.hooks);
  assert.equal(endHooks.length, 1);
  assert.equal(endHooks[0]._ccBaselineId, 'session-end-orphan-cleanup');
});

t('mergeHooks: preserves unrelated user hooks', () => {
  const user = {
    SessionStart: [{
      hooks: [{ type: 'command', command: 'my-custom-script.sh', statusMessage: 'My custom hook' }],
    }],
  };
  const result = mergeHooks(user, harnessTemplate);
  const allCommands = result.SessionStart.flatMap(e => e.hooks).map(h => h.command);
  assert.ok(allCommands.includes('my-custom-script.sh'), 'user hook should be preserved');
  assert.ok(allCommands.some(c => c.includes('python3')), 'harness hook should be added');
});

t('mergeHooks: same-matcher PreToolUse hooks share an entry', () => {
  const existing = {
    PreToolUse: [{
      matcher: 'Write|Edit',
      hooks: [{ type: 'command', command: 'user-prehook.sh' }],
    }],
  };
  const result = mergeHooks(existing, harnessTemplate);
  const entries = result.PreToolUse.filter(e => e.matcher === 'Write|Edit');
  // exactly one entry with this matcher (merged), containing both hooks
  assert.equal(entries.length, 1);
  const ids = entries[0].hooks.map(h => h.command);
  assert.ok(ids.some(c => c === 'user-prehook.sh'));
  assert.ok(ids.some(c => c.includes('cc-baseline path protection')));
});

t('removeHarnessHooks: removes by ID', () => {
  const installed = mergeHooks({}, harnessTemplate);
  const { hooks, removedCount } = removeHarnessHooks(installed);
  assert.equal(removedCount, 4); // session-start + 2 pre-tool + session-end
  assert.deepEqual(hooks, {});
});

t('removeHarnessHooks: removes legacy (no _ccBaselineId) hooks too', () => {
  const legacy = {
    SessionStart: [{
      hooks: [{ statusMessage: 'Loading session rules...', command: 'old' }],
    }],
    SessionEnd: [{
      hooks: [{ command: "pgrep -f '@anthropic-ai/claude-code' | xargs kill" }],
    }],
  };
  const { removedCount } = removeHarnessHooks(legacy);
  assert.equal(removedCount, 2);
});

t('removeHarnessHooks: preserves non-harness hooks', () => {
  const mixed = {
    SessionStart: [{
      hooks: [
        { _ccBaselineId: 'session-start-load-rules', command: 'a' },
        { command: 'user-hook.sh' },
      ],
    }],
  };
  const { hooks, removedCount } = removeHarnessHooks(mixed);
  assert.equal(removedCount, 1);
  assert.equal(hooks.SessionStart[0].hooks.length, 1);
  assert.equal(hooks.SessionStart[0].hooks[0].command, 'user-hook.sh');
});

// ──────────────────────────────────────────────────────────────────────────
// mcp-servers.js
// ──────────────────────────────────────────────────────────────────────────

t('mergeMcpServers: adds new keys, classifies as added', () => {
  const { result, added, overwritten } = mergeMcpServers({}, { foo: { command: 'x' } });
  assert.deepEqual(added, ['foo']);
  assert.deepEqual(overwritten, []);
  assert.deepEqual(result, { foo: { command: 'x' } });
});

t('mergeMcpServers: replaces existing keys, classifies as overwritten', () => {
  const { added, overwritten } = mergeMcpServers({ foo: { command: 'old' } }, { foo: { command: 'new' } });
  assert.deepEqual(added, []);
  assert.deepEqual(overwritten, ['foo']);
});

t('removeHarnessMcpServers: removes only listed keys', () => {
  const { result, removed, isEmpty } = removeHarnessMcpServers(
    { 'playwright-test-1': {}, 'user-server': {} },
    ['playwright-test-1']
  );
  assert.deepEqual(removed, ['playwright-test-1']);
  assert.deepEqual(Object.keys(result), ['user-server']);
  assert.equal(isEmpty, false);
});

t('removeHarnessMcpServers: isEmpty true when all keys removed', () => {
  const { isEmpty } = removeHarnessMcpServers({ a: {}, b: {} }, ['a', 'b']);
  assert.equal(isEmpty, true);
});

// ──────────────────────────────────────────────────────────────────────────
// paths.js
// ──────────────────────────────────────────────────────────────────────────

t('applyHome: substitutes {{HOME}}', () => {
  assert.equal(applyHome('{{HOME}}/.claude/x'), `${HOME}/.claude/x`);
});

t('toPlaceholder: substitutes HOME back to placeholder', () => {
  assert.equal(toPlaceholder(`${HOME}/foo`), `${PLACEHOLDER}/foo`);
});

// ──────────────────────────────────────────────────────────────────────────
// manifest.js
// ──────────────────────────────────────────────────────────────────────────

t('manifest: load returns markerBlock + overwrite arrays', () => {
  const m = manifest.load();
  assert.ok(Array.isArray(m.markerBlock));
  assert.ok(Array.isArray(m.overwrite));
  assert.ok(m.markerBlock.length > 0);
  assert.ok(m.overwrite.length > 0);
});

t('manifest: every listed file exists in templates/', () => {
  const missing = [];
  for (const rel of manifest.allFiles()) {
    const p = path.join(ROOT, 'templates', rel);
    if (!fs.existsSync(p)) missing.push(rel);
  }
  assert.deepEqual(missing, [], `missing template files: ${missing.join(', ')}`);
});

t('manifest: includes critical recently-added files (regression for f63e378)', () => {
  const overwrite = manifest.overwriteFiles();
  for (const f of [
    'commands/check-log.md',
    'commands/open-browser.md',
    'agents/code-reviewer.md',
    'memory/reference_code_reviewer_protocol.md',
    'scripts/audit-report.js',
  ]) {
    assert.ok(overwrite.includes(f), `manifest missing ${f}`);
  }
});

// ──────────────────────────────────────────────────────────────────────────
// conflict-checker.js
// ──────────────────────────────────────────────────────────────────────────

t('checkConflicts: clean install (no existing hooks) → no warnings', () => {
  const warnings = checkConflicts({});
  assert.deepEqual(warnings, []);
});

t('checkConflicts: existing managed hooks (re-install) → no warnings', () => {
  const installed = mergeHooks({}, harnessTemplate);
  const warnings = checkConflicts(installed);
  assert.deepEqual(warnings, []);
});

t('checkConflicts: user SessionStart hook → WARN rule 1', () => {
  const warnings = checkConflicts({
    SessionStart: [{
      hooks: [{ command: 'user-hook.sh', statusMessage: 'My custom' }],
    }],
  });
  assert.ok(warnings.some(w => w.rule === 1 && w.severity === 'WARN'));
});

t('checkConflicts: broad PreToolUse matcher .* → WARN rule 2', () => {
  const warnings = checkConflicts({
    PreToolUse: [{
      matcher: '.*',
      hooks: [{ command: 'broad.sh' }],
    }],
  });
  assert.ok(warnings.some(w => w.rule === 2));
});

t('checkConflicts: hook with decision:block → HIGH rule 3', () => {
  const warnings = checkConflicts({
    PreToolUse: [{
      matcher: 'Bash',
      hooks: [{ command: 'echo \'{"decision":"block"}\'' }],
    }],
  });
  assert.ok(warnings.some(w => w.rule === 3 && w.severity === 'HIGH'));
});

// ──────────────────────────────────────────────────────────────────────────
// doctor.js — structural smoke tests
// ──────────────────────────────────────────────────────────────────────────

t('doctor.runChecks: returns an array of result objects with status field', () => {
  const results = runChecks();
  assert.ok(Array.isArray(results));
  assert.ok(results.length >= 7, `expected ≥7 checks, got ${results.length}`);
  for (const r of results) {
    assert.ok(typeof r.name === 'string' && r.name.length > 0);
    assert.ok(['ok', 'warn', 'fail'].includes(r.status), `bad status: ${r.status}`);
    assert.ok(typeof r.detail === 'string');
  }
});

t('doctor.runChecks: package manifest check passes (template files all exist)', () => {
  const results = runChecks();
  const manifestCheck = results.find(r => r.name === 'Package manifest');
  assert.ok(manifestCheck, 'Package manifest check not found');
  assert.equal(manifestCheck.status, 'ok',
    `manifest integrity failed: ${manifestCheck.detail}`);
});

// ──────────────────────────────────────────────────────────────────────────
// Runner
// ──────────────────────────────────────────────────────────────────────────

async function run() {
  let pass = 0, fail = 0;
  const failures = [];
  console.log(`\nRunning ${tests.length} tests:\n`);
  for (const { name, fn } of tests) {
    try {
      await fn();
      process.stdout.write(`  ✅ ${name}\n`);
      pass++;
    } catch (e) {
      process.stdout.write(`  ❌ ${name}\n`);
      failures.push({ name, error: e });
      fail++;
    }
  }
  console.log(`\n${pass} passed, ${fail} failed (${tests.length} total)`);
  if (fail > 0) {
    console.log('\nFailures:');
    for (const { name, error } of failures) {
      console.log(`\n  ❌ ${name}`);
      console.log(`     ${error.message}`);
      if (error.stack) {
        const stack = error.stack.split('\n').slice(1, 4).map(l => `     ${l.trim()}`).join('\n');
        console.log(stack);
      }
    }
    process.exit(1);
  }
}

run().catch(e => {
  console.error('Test runner crashed:', e);
  process.exit(2);
});
