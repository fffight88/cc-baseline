'use strict';

const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const {
  mergeMarkerBlock,
  removeMarkerBlock,
  hasMarkerBlock,
  stripDuplicatePreamble,
} = require(path.join(ROOT, 'src', 'merge', 'markdown'));
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
const { applyHome, toPlaceholder, HOME, PLACEHOLDER, resolveTarget } = require(path.join(ROOT, 'src', 'paths'));
const manifest = require(path.join(ROOT, 'src', 'manifest'));
const { checkConflicts } = require(path.join(ROOT, 'src', 'conflict-checker'));
const { runChecks } = require(path.join(ROOT, 'src', 'doctor'));
const { install } = require(path.join(ROOT, 'src', 'install'));
const { uninstall } = require(path.join(ROOT, 'src', 'uninstall'));

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

t('harnessIdOf: recognizes pre-i18n Korean statusMessage values', () => {
  assert.equal(
    harnessIdOf({ statusMessage: '세션 기본 규칙 로딩 중...' }, 'SessionStart'),
    'session-start-load-rules');
  assert.equal(
    harnessIdOf({ statusMessage: 'cc-baseline 경로 정책 적용 중...' }, 'PreToolUse'),
    'pre-tool-use-path-policy');
  assert.equal(
    harnessIdOf({ statusMessage: 'E2E 테스트 가이드 로딩 중...' }, 'PreToolUse'),
    'pre-tool-use-e2e-guide');
});

t('mergeHooks: pre-i18n hook is replaced, not duplicated', () => {
  const existing = {
    SessionStart: [{ hooks: [{ type: 'command', command: 'OLD', statusMessage: '세션 기본 규칙 로딩 중...' }] }],
  };
  const harness = {
    SessionStart: [{ hooks: [{
      type: 'command', command: 'NEW',
      statusMessage: 'Loading session rules...',
      _ccBaselineId: 'session-start-load-rules',
    }] }],
  };
  const all = mergeHooks(existing, harness).SessionStart.flatMap(e => e.hooks);
  assert.equal(all.length, 1, `expected 1 hook, got ${all.length}`);
  assert.equal(all[0].command, 'NEW');
});

t('mergeHooks: collapses accumulated duplicates of the same managed hook', () => {
  const cmd = "pgrep -f '@anthropic-ai/claude-code' | while read pid; do :; done";
  const existing = {
    SessionEnd: [{ hooks: Array.from({ length: 23 }, () => ({ type: 'command', command: cmd })) }],
  };
  const harness = {
    SessionEnd: [{ hooks: [{ type: 'command', command: cmd, _ccBaselineId: 'session-end-orphan-cleanup' }] }],
  };
  const merged = mergeHooks(existing, harness);
  const all = merged.SessionEnd.flatMap(e => e.hooks);
  assert.equal(all.length, 1, `expected 1 hook after dedupe, got ${all.length}`);
  assert.equal(all[0]._ccBaselineId, 'session-end-orphan-cleanup');
});

t('mergeHooks: dedupe preserves unrelated user hooks in the same event', () => {
  const cmd = "pgrep -f '@anthropic-ai/claude-code' | while read pid; do :; done";
  const existing = {
    SessionEnd: [{
      hooks: [
        { type: 'command', command: cmd },
        { type: 'command', command: 'echo mine' },
        { type: 'command', command: cmd },
      ],
    }],
  };
  const harness = {
    SessionEnd: [{ hooks: [{ type: 'command', command: cmd, _ccBaselineId: 'session-end-orphan-cleanup' }] }],
  };
  const all = mergeHooks(existing, harness).SessionEnd.flatMap(e => e.hooks);
  assert.equal(all.length, 2);
  assert.ok(all.some(h => h.command === 'echo mine'));
  assert.equal(all.filter(h => h._ccBaselineId === 'session-end-orphan-cleanup').length, 1);
});

t('mergeHooks: dedupe is idempotent across repeated installs', () => {
  const cmd = "pgrep -f '@anthropic-ai/claude-code' | while read pid; do :; done";
  const harness = {
    SessionEnd: [{ hooks: [{ type: 'command', command: cmd, _ccBaselineId: 'session-end-orphan-cleanup' }] }],
  };
  const once = mergeHooks({ SessionEnd: [{ hooks: [{ type: 'command', command: cmd }] }] }, harness);
  const twice = mergeHooks(once, harness);
  assert.deepEqual(twice, once);
  assert.equal(twice.SessionEnd.flatMap(e => e.hooks).length, 1);
});

t('stripDuplicatePreamble: removes stale pre-marker copy sharing the block H1', () => {
  const block = '# Global Memory Index\n\n- [a.md](a.md) — current';
  const existing = mergeMarkerBlock('# Global Memory Index\n\n- [a.md](a.md) — stale\n', block);
  const { content, removed, changed } = stripDuplicatePreamble(existing, block);
  assert.equal(changed, true);
  assert.deepEqual(removed, ['Global Memory Index']);
  assert.ok(!content.includes('stale'));
  assert.match(content, /current/);
  assert.ok(content.startsWith('<!-- BEGIN cc-baseline -->'));
});

t('stripDuplicatePreamble: keeps user sections under a different H1', () => {
  const block = '# Global Memory Index\n\n- managed';
  const existing = mergeMarkerBlock('# My Own Notes\n\nkeep me\n\n# Global Memory Index\n\ndrop me\n', block);
  const { content, removed, changed } = stripDuplicatePreamble(existing, block);
  assert.equal(changed, true);
  assert.deepEqual(removed, ['Global Memory Index']);
  assert.match(content, /# My Own Notes/);
  assert.match(content, /keep me/);
  assert.ok(!content.includes('drop me'));
});

t('stripDuplicatePreamble: no marker block → untouched', () => {
  const existing = '# Global Memory Index\n\nplain file\n';
  const { content, changed } = stripDuplicatePreamble(existing, '# Global Memory Index\n\nx');
  assert.equal(changed, false);
  assert.equal(content, existing);
});

t('stripDuplicatePreamble: unrelated preamble → untouched', () => {
  const block = '# Global Memory Index\n\n- managed';
  const existing = mergeMarkerBlock('# Unrelated Doc\n\nmine\n', block);
  const { content, changed } = stripDuplicatePreamble(existing, block);
  assert.equal(changed, false);
  assert.equal(content, existing);
});

t('stripDuplicatePreamble: ignores H1-looking lines inside fenced code', () => {
  const block = '# Real Title\n\nbody';
  const existing = mergeMarkerBlock('# Keep\n\n```sh\n# Real Title\n```\n', block);
  const { changed } = stripDuplicatePreamble(existing, block);
  assert.equal(changed, false);
});

t('stripDuplicatePreamble: idempotent — second pass is a no-op', () => {
  const block = '# Global Memory Index\n\n- current';
  const existing = mergeMarkerBlock('# Global Memory Index\n\n- stale\n', block);
  const once = stripDuplicatePreamble(existing, block).content;
  const twice = stripDuplicatePreamble(once, block);
  assert.equal(twice.changed, false);
  assert.equal(twice.content, once);
});

t('stripDuplicatePreamble: result survives a later marker-block merge', () => {
  const block = '# Global Memory Index\n\n- v1';
  const cleaned = stripDuplicatePreamble(
    mergeMarkerBlock('# Global Memory Index\n\n- stale\n', block),
    block
  ).content;
  const remerged = mergeMarkerBlock(cleaned, '# Global Memory Index\n\n- v2');
  assert.match(remerged, /v2/);
  assert.ok(!remerged.includes('stale'));
  assert.ok(!remerged.includes('v1'));
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

t('harnessIdOf: recognizes the native-binary SessionEnd command without _ccBaselineId', () => {
  const hook = { command: "{ pgrep -x claude; pgrep -f '@anthropic-ai/claude-code'; } 2>/dev/null | sort -u | while read pid; do :; done" };
  assert.equal(harnessIdOf(hook, 'SessionEnd'), 'session-end-orphan-cleanup');
});

// Regression tests for the harness-smoke findings (docs/plans/harness-smoke-fixes.md)
const projectHookTemplate = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'templates', 'settings-hooks.project.json'), 'utf8')
);
function templateHook(template, id) {
  for (const entries of Object.values(template)) {
    for (const entry of entries) {
      for (const hook of entry.hooks) if (hook._ccBaselineId === id) return hook;
    }
  }
  return null;
}

t('B7b: path-policy hooks deny with exit 0, not exit 2', () => {
  for (const [template, id] of [[harnessTemplate, 'pre-tool-use-path-policy'], [projectHookTemplate, 'project-pre-tool-use-path-policy']]) {
    const hook = templateHook(template, id);
    assert.ok(hook, `${id} missing`);
    assert.match(hook.command, /'permissionDecision': 'deny'/);
    assert.doesNotMatch(hook.command, /sys\.exit\(2\)/, `${id} still exits 2`);
  }
});

t('B3: e2e-guide hook uses a per-session marker instead of the "once" field', () => {
  const hook = templateHook(harnessTemplate, 'pre-tool-use-e2e-guide');
  assert.equal(hook.once, undefined, '"once" is not honored in settings.json hooks');
  assert.match(hook.command, /session_id/);
  assert.match(hook.command, /O_EXCL/, 'marker must be created exclusively');
  assert.match(hook.command, /O_NOFOLLOW/, 'marker must not follow symlinks');
  assert.match(hook.command, /cc-baseline-%d/, 'marker lives in a per-user directory');
});

t('B3: e2e-guide hook prints the guide once per session id', () => {
  const { execFileSync } = require('child_process');
  const os = require('os');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ccb-home-'));
  fs.mkdirSync(path.join(home, '.claude', 'memory'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'memory', 'reference_subagent_boundary.md'), 'BOUNDARY\nline2');
  fs.writeFileSync(path.join(home, '.claude', 'memory', 'reference_e2e_manager_guide.md'), 'GUIDE');
  const command = templateHook(harnessTemplate, 'pre-tool-use-e2e-guide').command.split(PLACEHOLDER).join(home);
  const sid = `ccb-test-${process.pid}-${Date.now()}`;
  const marker = path.join(os.tmpdir(), `cc-baseline-${process.getuid()}`, `e2e-guide-${sid}`);
  const run = (input) => execFileSync('/bin/sh', ['-c', command], { input, encoding: 'utf8', env: { ...process.env, TMPDIR: os.tmpdir() } });
  try {
    const pw = { tool_name: 'mcp__playwright-test-2__browser_navigate' };
    const first = JSON.parse(run(JSON.stringify({ ...pw, session_id: sid })));
    const context = first.hookSpecificOutput.additionalContext;
    assert.match(context, /# reference_subagent_boundary\.md\nBOUNDARY\nline2/);
    assert.match(context, /# reference_e2e_manager_guide\.md\nGUIDE/);
    assert.equal(run(JSON.stringify({ ...pw, session_id: sid })), '', 'second call in the same session must print nothing');
    assert.notEqual(run(JSON.stringify(pw)), '', 'without a session id the guide is still printed');
  } finally {
    fs.rmSync(marker, { force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

t('B8: SessionEnd hook matches the native claude binary and the npm install', () => {
  const hook = templateHook(harnessTemplate, 'session-end-orphan-cleanup');
  assert.match(hook.command, /pgrep -u "\$\(id -u\)" -x claude/);
  assert.match(hook.command, /pgrep -u "\$\(id -u\)" -f '@anthropic-ai\/claude-code'/);
  assert.match(hook.command, /' -p '\*\|\*' --print '/, 'headless claude -p / --print must be skipped');
  assert.doesNotMatch(hook.command, /\[\[/, 'use POSIX [ ] so /bin/sh can run it');
});

t('mergeHooks: a managed hook whose template matcher changed moves to the new matcher', () => {
  const managed = { type: 'command', command: 'old', _ccBaselineId: 'pre-tool-use-e2e-guide' };
  const userHook = { type: 'command', command: 'mine' };
  const existing = {
    PreToolUse: [
      { matcher: 'mcp__playwright-test-.*', hooks: [managed] },
      { matcher: 'Bash', hooks: [userHook, { ...managed }] }, // stray legacy copy
    ],
  };
  const harness = { PreToolUse: [{ matcher: 'mcp__playwright-test-.*|Bash', hooks: [{ ...managed, command: 'new' }] }] };
  const { PreToolUse } = mergeHooks(existing, harness);
  const copies = PreToolUse.flatMap(e => e.hooks.filter(h => h._ccBaselineId === 'pre-tool-use-e2e-guide').map(h => [e.matcher, h.command]));
  assert.deepEqual(copies, [['mcp__playwright-test-.*|Bash', 'new']], 'exactly one copy, under the new matcher');
  assert.ok(PreToolUse.some(e => e.matcher === 'Bash' && e.hooks.includes(userHook) || e.hooks.some(h => h.command === 'mine')), 'user hook kept');
  assert.ok(!PreToolUse.some(e => e.matcher === 'mcp__playwright-test-.*'), 'emptied old entry removed');
  const again = mergeHooks({ PreToolUse }, harness).PreToolUse;
  assert.deepEqual(again, PreToolUse, 'idempotent');
});

t('doctor: warns when a managed hook is registered under an outdated matcher', () => {
  const os = require('os');
  const { checkHooks } = require(path.join(ROOT, 'src', 'doctor'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccb-hooks-'));
  try {
    const current = JSON.parse(JSON.stringify(harnessTemplate));
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ hooks: current }));
    assert.equal(checkHooks(dir).status, 'ok');
    const entry = current.PreToolUse.find(e => e.hooks.some(h => h._ccBaselineId === 'pre-tool-use-e2e-guide'));
    entry.matcher = 'mcp__playwright-test-.*';
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ hooks: current }));
    const res = checkHooks(dir);
    assert.equal(res.status, 'warn');
    assert.match(res.detail, /pre-tool-use-e2e-guide/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Regression tests for the harness-smoke v2 findings (docs/plans/browser-aside-e2e-fixes.md)
function runE2eGuideHook(inputs) {
  const { execFileSync } = require('child_process');
  const os = require('os');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ccb-home-'));
  fs.mkdirSync(path.join(home, '.claude', 'memory'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'memory', 'reference_subagent_boundary.md'), 'BOUNDARY');
  fs.writeFileSync(path.join(home, '.claude', 'memory', 'reference_e2e_manager_guide.md'), 'GUIDE');
  const command = templateHook(harnessTemplate, 'pre-tool-use-e2e-guide').command.split(PLACEHOLDER).join(home);
  const base = path.join(os.tmpdir(), `cc-baseline-${process.getuid()}`);
  const before = new Set(fs.existsSync(base) ? fs.readdirSync(base) : []);
  try {
    return inputs.map(input => execFileSync('/bin/sh', ['-c', command], {
      input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, TMPDIR: os.tmpdir() },
    }));
  } finally {
    for (const f of (fs.existsSync(base) ? fs.readdirSync(base) : [])) {
      if (!before.has(f)) fs.rmSync(path.join(base, f), { force: true });
    }
    fs.rmSync(home, { recursive: true, force: true });
  }
}

t('B9: e2e-guide marker is per agent, so a later subagent still gets the guide', () => {
  const sid = `ccb-b9-${process.pid}-${Date.now()}`;
  const pw = { tool_name: 'mcp__playwright-test-2__browser_navigate' };
  const out = runE2eGuideHook([
    { ...pw, session_id: sid, agent_id: 'publisher1', agent_type: 'publisher' },
    { ...pw, session_id: sid, agent_id: 'publisher1', agent_type: 'publisher' },
    { ...pw, session_id: sid, agent_id: 'tester1', agent_type: 'e2e-tester' },
    { ...pw, session_id: sid },
  ]);
  assert.notEqual(out[0], '', 'first agent gets the guide');
  assert.equal(out[1], '', 'same agent does not get it twice');
  assert.notEqual(out[2], '', 'a different subagent in the same session still gets the guide');
  assert.notEqual(out[3], '', 'the main session (no agent_id) has its own marker');
});

t('B9: e2e-guide hook also fires for Aside repl Bash calls, not other Bash calls', () => {
  const hookEntry = harnessTemplate.PreToolUse.find(e => e.hooks.some(h => h._ccBaselineId === 'pre-tool-use-e2e-guide'));
  assert.match('Bash', new RegExp(`^(${hookEntry.matcher})$`), 'matcher must include Bash');
  assert.match('mcp__playwright-test-3__browser_click', new RegExp(`^(${hookEntry.matcher})$`));
  const sid = `ccb-b9b-${process.pid}-${Date.now()}`;
  const out = runE2eGuideHook([
    { session_id: sid, agent_id: 'a1', tool_name: 'Bash', tool_input: { command: 'ls -la' } },
    { session_id: sid, agent_id: 'a1', tool_name: 'Bash', tool_input: { command: 'aside repl --account u2 "await openTab(1)"' } },
    { session_id: sid, agent_id: 'a2', tool_name: 'Bash', tool_input: { command: '~/.claude/scripts/aside-session.sh send e2e-2 "x"' } },
    { session_id: sid, agent_id: 'a3', tool_name: 'Bash', tool_input: { command: 'echo aside' } },
  ]);
  assert.equal(out[0], '', 'plain Bash calls get nothing');
  assert.notEqual(out[1], '', 'aside repl calls get the guide');
  assert.notEqual(out[2], '', 'aside-session.sh calls get the guide');
  assert.equal(out[3], '', 'mentioning aside is not enough');
  const hook = templateHook(harnessTemplate, 'pre-tool-use-e2e-guide');
  assert.match(hook.command, /^in=\$\(cat\); case "\$in" in \*mcp__playwright-test-\*\|\*aside\*\) ;; \*\) exit 0 ;; esac;/, 'shell pre-filter skips python for unrelated Bash calls');
});

t('B12: playwright-test-1 (manual sessions) is headed, the others stay headless', () => {
  for (const file of ['mcp-servers.json', 'mcp-servers.project.json']) {
    const servers = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', file), 'utf8'));
    assert.ok(!servers['playwright-test-1'].args.includes('--headless'), `${file}: test-1 must not be headless`);
    for (const n of [2, 3, 4, 5]) {
      assert.ok(servers[`playwright-test-${n}`].args.includes('--headless'), `${file}: test-${n} stays headless`);
    }
  }
});

t('B12: doctor warns when playwright-test-1 is still headless', () => {
  const os = require('os');
  const { checkMcpServers } = require(path.join(ROOT, 'src', 'doctor'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccb-mcp-'));
  const file = path.join(dir, 'claude.json');
  const servers = n => Object.fromEntries([1, 2, 3, 4, 5].map(i => [`playwright-test-${i}`, { args: i === 1 && !n ? ['--headless', '--isolated'] : (i === 1 ? ['--isolated'] : ['--headless', '--isolated']) }]));
  try {
    fs.writeFileSync(file, JSON.stringify({ mcpServers: servers(false) }));
    assert.equal(checkMcpServers(file).status, 'warn');
    fs.writeFileSync(file, JSON.stringify({ mcpServers: servers(true) }));
    assert.equal(checkMcpServers(file).status, 'ok');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

t('B10: e2e sweep covers transient controls added after load', () => {
  const tester = fs.readFileSync(path.join(ROOT, 'templates', 'agents', 'e2e-tester.md'), 'utf8');
  const guide = fs.readFileSync(path.join(ROOT, 'templates', 'memory', 'reference_e2e_manager_guide.md'), 'utf8');
  assert.match(tester, /MutationObserver/, 'tester records controls added after load');
  assert.match(tester, /transient-missed/, 'a vanished control must be reported, not counted clean');
  assert.match(guide, /Transient controls/, 'manager guide asks for explicit steps for transient UI');
});

t('B11: e2e screenshots use an absolute path under e2e-results/', () => {
  const tester = fs.readFileSync(path.join(ROOT, 'templates', 'agents', 'e2e-tester.md'), 'utf8');
  const guide = fs.readFileSync(path.join(ROOT, 'templates', 'memory', 'reference_e2e_manager_guide.md'), 'utf8');
  assert.match(tester, /project_dir:/, 'tester input carries the project root');
  assert.match(tester, /<project_dir>\/e2e-results\/fail-\{N\}-\{YYYYMMDD-HHmmss\}-<slug>\.png/);
  assert.match(guide, /project_dir:/, 'manager passes project_dir');
});

// Aside (primary browser tool) installer + doctor
const asideInstaller = require(path.join(ROOT, 'src', 'installers', 'aside'));

t('aside: CLI archive name follows the official installer per arch', () => {
  assert.equal(asideInstaller.cliArchiveName('arm64'), 'AsideCLI-darwin-arm64-latest.zip');
  assert.equal(asideInstaller.cliArchiveName('x64'), 'AsideCLI-darwin-x64-latest.zip');
});

t('aside: parseTeamId reads the signer team from codesign output', () => {
  const out = 'Executable=/x\nIdentifier=at.studio.AsideBrowser.cli\nTeamIdentifier=8CPD4K4TBB\n';
  assert.equal(asideInstaller.parseTeamId(out), asideInstaller.ASIDE_TEAM_ID);
  assert.equal(asideInstaller.parseTeamId('TeamIdentifier=not set\n'), null, 'unsigned code has no team');
  assert.equal(asideInstaller.parseTeamId(''), null);
});

t('aside: browser config keeps user values and only fills gaps', () => {
  assert.deepEqual(asideInstaller.mergeBrowserConfig(null, null),
    { primary: 'aside', fallback: 'playwright', aside: { account: null } });
  assert.deepEqual(asideInstaller.mergeBrowserConfig({ primary: 'playwright', aside: { account: 'u3', note: 'x' } }, null),
    { primary: 'playwright', fallback: 'playwright', aside: { account: 'u3', note: 'x' } });
  assert.equal(asideInstaller.mergeBrowserConfig({ aside: { account: 'u3' } }, 'u2').aside.account, 'u2');
});

t('aside: account ids are validated before use', () => {
  assert.ok(asideInstaller.isValidAccountId('u2'));
  for (const bad of ['', 'u', '2', 'u2; rm -rf ~', '--profile', 'U2']) {
    assert.ok(!asideInstaller.isValidAccountId(bad), `accepted ${bad}`);
  }
});

t('aside: doctor checkAside warns on gaps and passes with CLI + known test account', () => {
  const os = require('os');
  const { checkAside } = require(path.join(ROOT, 'src', 'doctor'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccb-aside-'));
  const bin = path.join(dir, 'aside');
  const configPath = path.join(dir, 'cc-baseline-browser.json');
  fs.writeFileSync(bin, '#!/bin/sh\nif [ "$1" = "--version" ]; then echo 9.9.9; else printf "* u0  me  signed in\\n  u2  Local Account  signed out\\n"; fi\n', { mode: 0o755 });
  try {
    assert.equal(checkAside({ platform: 'linux', bin, configPath }).status, 'ok', 'non-macOS is fine');
    assert.equal(checkAside({ platform: 'darwin', bin: path.join(dir, 'missing'), configPath }).status, 'warn');
    assert.equal(checkAside({ platform: 'darwin', bin, configPath }).status, 'warn', 'no config yet');
    fs.writeFileSync(configPath, JSON.stringify({ aside: { account: 'u7' } }));
    assert.equal(checkAside({ platform: 'darwin', bin, configPath }).status, 'warn', 'unknown account');
    fs.writeFileSync(configPath, JSON.stringify({ aside: { account: 'u2' } }));
    const good = checkAside({ platform: 'darwin', bin, configPath });
    assert.equal(good.status, 'ok', good.detail);
    assert.match(good.detail, /9\.9\.9.*u2/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

t('aside: signature check accepts the real CLI and rejects an unsigned copy (macOS, when installed)', () => {
  const os = require('os');
  const real = path.join(os.homedir(), '.aside', 'cli', 'Aside CLI.app');
  if (process.platform !== 'darwin' || !fs.existsSync(real)) return;
  assert.equal(asideInstaller.verifyAsideSignature(real), null);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccb-unsigned-'));
  try {
    const fake = path.join(dir, 'Aside CLI.app', 'Contents', 'MacOS');
    fs.mkdirSync(fake, { recursive: true });
    fs.writeFileSync(path.join(fake, 'aside'), '#!/bin/sh\n', { mode: 0o755 });
    assert.notEqual(asideInstaller.verifyAsideSignature(path.join(dir, 'Aside CLI.app')), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

t('aside-session.sh: start/send/stop with a fake aside REPL, exit codes, stop-under', () => {
  const os = require('os');
  const { execFileSync, spawnSync } = require('child_process');
  const script = path.join(ROOT, 'templates', 'scripts', 'aside-session.sh');
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccb-as-')));
  const proj = path.join(tmp, 'proj');
  fs.mkdirSync(path.join(proj, '.claude'), { recursive: true });
  const fake = path.join(tmp, 'aside');
  fs.writeFileSync(fake, '#!/bin/sh\n[ "$1" = repl ] || exit 9\n[ "$2" = --account ] && [ "$3" = u5 ] || { echo "bad account $3"; exit 8; }\nwhile IFS= read -r line; do\n  [ "$line" = exit ] && exit 0\n  if [ "$line" = boom ]; then echo "Error: boom"; echo "[error | 1ms]"; else echo "out:$line"; echo "[ok | 1ms]"; fi\ndone\n', { mode: 0o755 });
  const env = { ...process.env, ASIDE_BIN: fake, TMPDIR: tmp, HOME: tmp };
  const run = (...args) => spawnSync('bash', [script, ...args], { cwd: proj, env, encoding: 'utf8' });
  try {
    assert.equal(run('start', 's1').status, 2, 'no test account configured → exit 2 (use fallback)');
    fs.writeFileSync(path.join(proj, '.claude', 'cc-baseline-browser.json'), JSON.stringify({ aside: { account: 'u5' } }));
    assert.equal(run('account').stdout.trim(), 'u5');
    assert.equal(run('start', 'Bad Name').status, 1, 'session names are validated');
    const started = run('start', 's1');
    assert.equal(started.status, 0, started.stderr);
    const ok = run('send', 's1', "console.log('hi')");
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /out:console\.log\('hi'\)/);
    assert.equal(run('send', 's1', 'boom').status, 3, 'a failing step exits 3');
    assert.equal(run('send', 's1', 'a\nb').status, 1, 'multi-line code is refused');
    assert.match(run('list').stdout, /s1 running \(account u5\)/);
    assert.equal(run('stop-under', tmp).status, 1, 'refuses $HOME (HOME is tmp here)');
    assert.equal(run('stop-under', proj).status, 0);
    assert.equal(run('list').stdout.trim(), '', 'stop-under stopped the project session');
    assert.equal(run('send', 's1', 'x').status, 2, 'stopped session → exit 2');
    assert.equal(run('start', 's2').status, 0);
    const base = path.join(tmp, `cc-baseline-${process.getuid()}`, 'aside');
    const [projKey] = fs.readdirSync(base);
    assert.equal(fs.readFileSync(path.join(base, projKey, 'project'), 'utf8').trim(), proj);
    const replPid = Number(fs.readFileSync(path.join(base, projKey, 's2', 'repl.pid'), 'utf8'));
    process.kill(replPid);
    const stopDead = spawnSync('bash', [script, 'stop', 's2'], { cwd: proj, env, encoding: 'utf8', timeout: 10000 });
    assert.equal(stopDead.status, 0, 'stop returns even when the REPL already exited');
  } finally {
    for (const n of ['s1', 's2']) spawnSync('bash', [script, 'stop', n], { cwd: proj, env, timeout: 10000 });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

t('aside-session.sh: sessions are per project and state dirs must not be symlinks', () => {
  const os = require('os');
  const { spawnSync } = require('child_process');
  const script = path.join(ROOT, 'templates', 'scripts', 'aside-session.sh');
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ccb-as2-')));
  const fake = path.join(tmp, 'aside');
  fs.writeFileSync(fake, '#!/bin/sh\nwhile IFS= read -r line; do [ "$line" = exit ] && exit 0; echo "[ok | 1ms]"; done\n', { mode: 0o755 });
  const projects = ['a', 'b'].map(n => {
    const dir = path.join(tmp, n);
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude', 'cc-baseline-browser.json'), JSON.stringify({ aside: { account: 'u5' } }));
    return dir;
  });
  const env = { ...process.env, ASIDE_BIN: fake, TMPDIR: path.join(tmp, 't'), HOME: tmp };
  fs.mkdirSync(env.TMPDIR);
  const run = (cwd, ...args) => spawnSync('bash', [script, ...args], { cwd, env, encoding: 'utf8', timeout: 10000 });
  try {
    assert.equal(run(projects[0], 'start', 'e2e-2').status, 0);
    assert.equal(run(projects[1], 'start', 'e2e-2').status, 0, 'same name in another project does not collide');
    assert.match(run(projects[0], 'list').stdout, /e2e-2 running/);
    assert.equal(run(projects[0], 'stop-under', projects[0]).status, 0);
    assert.equal(run(projects[0], 'list').stdout.trim(), '', 'project a stopped');
    assert.match(run(projects[1], 'list').stdout, /e2e-2 running/, 'project b untouched');
    run(projects[1], 'stop', 'e2e-2');
    // a planted symlink in place of the state dir is refused
    const tmp2 = path.join(tmp, 't2');
    fs.mkdirSync(tmp2);
    fs.mkdirSync(path.join(tmp, 'attacker'));
    fs.symlinkSync(path.join(tmp, 'attacker'), path.join(tmp2, `cc-baseline-${process.getuid()}`));
    const res = spawnSync('bash', [script, 'start', 'x'], { cwd: projects[0], env: { ...env, TMPDIR: tmp2 }, encoding: 'utf8', timeout: 10000 });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /symlinked state dir/);
  } finally {
    for (const dir of projects) spawnSync('bash', [script, 'stop', 'e2e-2'], { cwd: dir, env, timeout: 10000 });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

t('aside: an unreadable browser config is backed up, not silently replaced', () => {
  const os = require('os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccb-cfg-'));
  const origLog = console.log;
  console.log = () => {};
  try {
    fs.writeFileSync(path.join(dir, 'cc-baseline-browser.json'), '{ broken');
    const merged = asideInstaller.writeBrowserConfig(dir, 'u2');
    assert.equal(merged.aside.account, 'u2');
    assert.ok(fs.readdirSync(dir).some(f => f.startsWith('cc-baseline-browser.json.bak-')), 'backup written');
  } finally {
    console.log = origLog;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

t('browser layer: agents and commands are Aside-first with a Playwright fallback', () => {
  const read = (...p) => fs.readFileSync(path.join(ROOT, 'templates', ...p), 'utf8');
  const tester = read('agents', 'e2e-tester.md');
  const publisher = read('agents', 'publisher.md');
  const openBrowser = read('commands', 'open-browser.md');
  const checkLog = read('commands', 'check-log.md');
  for (const [name, text] of [['e2e-tester', tester], ['publisher', publisher], ['open-browser', openBrowser]]) {
    assert.match(text, /reference_browser_tools\.md/, `${name} points to the browser guide`);
    assert.match(text, /aside-session\.sh/, `${name} drives Aside through the session helper`);
    assert.match(text, /playwright-test-/, `${name} keeps the Playwright fallback`);
  }
  assert.match(tester, /BROWSER_TOOL:/);
  assert.match(tester, /FALLBACK_REASON:/);
  assert.doesNotMatch(publisher, /await import\(/, 'the Aside REPL rejects code containing import(');
  assert.match(publisher, /"browser_tool"/);
  assert.match(checkLog, /\[REDACTED\]/);
  assert.match(checkLog, /2a\. \*\*Aside\*\*/);
  assert.match(read('commands', 'clean.md'), /aside-session\.sh" stop-under "\$PROJ"/);
  assert.doesNotMatch(publisher, /default playwright-test-1/, 'test-1 is reserved for /open-browser');
  assert.match(openBrowser, /\^https\?:\/\/\[A-Za-z0-9\._~:\/\?#@!\*\+,;=%&-\]\+\$/, 'URL allowlist excludes $ and backticks');
});

t('harnessIdOf: recognizes the user-scoped SessionEnd command without _ccBaselineId', () => {
  const hook = { command: templateHook(harnessTemplate, 'session-end-orphan-cleanup').command };
  assert.equal(harnessIdOf(hook, 'SessionEnd'), 'session-end-orphan-cleanup');
});

t('harness-smoke fixes: retired strings stay out of templates', () => {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
  const files = walk(path.join(ROOT, 'templates')).filter(f => /\.(md|json)$/.test(f));
  const text = files.map(f => fs.readFileSync(f, 'utf8')).join('\n');
  // B1: only the "do not fetch" warnings may name the getdesign page
  assert.doesNotMatch(text, /WebFetch https:\/\/getdesign\.md/);
  assert.doesNotMatch(text, /awesome-design-md\/main\//, 'DESIGN.md source must be pinned to a commit');
  // B2: per-screen publish reports
  assert.doesNotMatch(text, /publish-iter-<n>/);
  // B4: semgrep must never be told to use auto config
  assert.doesNotMatch(text.replace(/Never run `semgrep --config auto`/g, ''), /semgrep[^\n]*--config auto/);
  // B7a: the pathspec form that exits 1 when .claude/ is gitignored
  assert.doesNotMatch(text, /✅ DO: `git add --all -- ':!\.claude'`/);
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
// paths.js — resolveTarget (Phase 2A)
// ──────────────────────────────────────────────────────────────────────────

t('resolveTarget: default (no opts) → global mode targeting $HOME', () => {
  const t1 = resolveTarget({});
  assert.equal(t1.mode, 'global');
  assert.equal(t1.basePath, HOME);
  assert.ok(t1.claudeDir.startsWith(HOME));
  assert.ok(t1.claudeDir.endsWith('/.claude'));
  assert.equal(t1.mcpJsonPath, path.join(HOME, '.claude.json'));
});

t('resolveTarget: opts.project=true → project mode targeting cwd', () => {
  const cwd = process.cwd();
  const t2 = resolveTarget({ project: true });
  assert.equal(t2.mode, 'project');
  assert.equal(t2.basePath, cwd);
  assert.equal(t2.claudeDir, path.join(cwd, '.claude'));
  assert.equal(t2.mcpJsonPath, path.join(cwd, '.mcp.json'));
  assert.ok(t2.backupRoot.includes('.cc-baseline-backup'));
});

// ──────────────────────────────────────────────────────────────────────────
// Project-mode templates exist (Phase 2B)
// ──────────────────────────────────────────────────────────────────────────

t('project templates: project-CLAUDE.md, settings-hooks.project.json, mcp-servers.project.json all present', () => {
  for (const name of ['project-CLAUDE.md', 'settings-hooks.project.json', 'mcp-servers.project.json']) {
    assert.ok(fs.existsSync(path.join(ROOT, 'templates', name)), `missing template: ${name}`);
  }
});

t('project settings-hooks.json: every hook has _ccBaselineId with project- prefix', () => {
  const tpl = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', 'settings-hooks.project.json'), 'utf8'));
  const ids = [];
  for (const event of Object.keys(tpl)) {
    for (const entry of tpl[event]) {
      for (const h of entry.hooks) {
        assert.ok(h._ccBaselineId, `${event} hook missing _ccBaselineId`);
        assert.ok(h._ccBaselineId.startsWith('project-'),
          `${event} hook _ccBaselineId "${h._ccBaselineId}" must start with project-`);
        ids.push(h._ccBaselineId);
      }
    }
  }
  // no duplicates
  assert.equal(new Set(ids).size, ids.length);
});

t('project mcp-servers.json: uses npx with a pinned @playwright/mcp version (no @latest)', () => {
  const tpl = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', 'mcp-servers.project.json'), 'utf8'));
  const pinPattern = /^@playwright\/mcp@\d+\.\d+\.\d+$/;
  for (const [name, server] of Object.entries(tpl)) {
    assert.equal(server.command, 'npx', `${name} should use npx, got ${server.command}`);
    assert.ok(Array.isArray(server.args), `${name} args missing`);
    const pkgArg = server.args.find(a => typeof a === 'string' && a.startsWith('@playwright/mcp@'));
    assert.ok(pkgArg, `${name} args missing @playwright/mcp reference`);
    assert.ok(pinPattern.test(pkgArg),
      `${name} package arg must be pinned to a specific version (got "${pkgArg}"); @latest is forbidden`);
  }
});

t('project SessionStart hook: validates MEMORY.md marker block + applies length cap', () => {
  const tpl = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', 'settings-hooks.project.json'), 'utf8'));
  const cmd = tpl.SessionStart[0].hooks[0].command;
  assert.ok(cmd.includes('<!-- BEGIN cc-baseline -->'),
    'SessionStart hook must check for cc-baseline marker block in MEMORY.md');
  assert.ok(cmd.includes('Core Rules for Every Session'),
    'SessionStart hook must check for the rules-file signature');
  assert.ok(cmd.includes('64 * 1024') || cmd.includes('65536'),
    'SessionStart hook must apply a 64KB length cap');
});

t('project PreToolUse hook: validates CLAUDE_PROJECT_DIR against realpath(cwd)', () => {
  const tpl = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates', 'settings-hooks.project.json'), 'utf8'));
  const cmd = tpl.PreToolUse[0].hooks[0].command;
  assert.ok(cmd.includes('realpath(env_proj) == cwd_real') || cmd.includes('realpath(env_proj) == os.path.realpath'),
    'PreToolUse hook must compare realpath(CLAUDE_PROJECT_DIR) against realpath(cwd) to defeat env poisoning');
});

t('project CLAUDE.md template: uses relative paths, no {{HOME}}', () => {
  const raw = fs.readFileSync(path.join(ROOT, 'templates', 'project-CLAUDE.md'), 'utf8');
  assert.ok(!raw.includes('{{HOME}}'), 'project-CLAUDE.md should not contain {{HOME}} placeholder');
  assert.ok(raw.includes('./.claude/memory/'), 'project-CLAUDE.md should reference ./.claude/memory/');
});

// ──────────────────────────────────────────────────────────────────────────
// Project install/uninstall round-trip (integration, Phase 2B)
// ──────────────────────────────────────────────────────────────────────────

async function withTempProject(fn) {
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'cc-baseline-test-'));
  const prevCwd = process.cwd();
  process.chdir(tmp);
  try {
    await fn(tmp);
  } finally {
    process.chdir(prevCwd);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
}

t('project install: creates ./.claude/ tree and ./.mcp.json in cwd', async () => {
  await withTempProject(async (tmp) => {
    // silence install output
    const origLog = console.log;
    console.log = () => {};
    try {
      await install({ project: true, yes: true, skipScanners: true });
    } finally {
      console.log = origLog;
    }
    assert.ok(fs.existsSync(path.join(tmp, '.claude', 'CLAUDE.md')), '.claude/CLAUDE.md missing');
    assert.ok(fs.existsSync(path.join(tmp, '.claude', 'memory', 'MEMORY.md')), 'memory/MEMORY.md missing');
    assert.ok(fs.existsSync(path.join(tmp, '.claude', 'settings.json')), '.claude/settings.json missing');
    assert.ok(fs.existsSync(path.join(tmp, '.mcp.json')), '.mcp.json missing');
    assert.ok(fs.existsSync(path.join(tmp, '.claude', 'agents', 'e2e-tester.md')), 'agents/e2e-tester.md missing');
    const helper = path.join(tmp, '.claude', 'scripts', 'aside-session.sh');
    assert.ok(fs.existsSync(helper), 'scripts/aside-session.sh missing');
    assert.ok(fs.statSync(helper).mode & 0o100, 'aside-session.sh must be executable');
  });
});

t('project install: hook IDs in ./.claude/settings.json have project- prefix', async () => {
  await withTempProject(async (tmp) => {
    const origLog = console.log;
    console.log = () => {};
    try {
      await install({ project: true, yes: true, skipScanners: true });
    } finally {
      console.log = origLog;
    }
    const settings = JSON.parse(fs.readFileSync(path.join(tmp, '.claude', 'settings.json'), 'utf8'));
    const allHooks = [];
    for (const event of Object.keys(settings.hooks)) {
      for (const entry of settings.hooks[event]) {
        for (const h of entry.hooks) allHooks.push(h);
      }
    }
    assert.ok(allHooks.length > 0, 'expected at least one hook installed');
    for (const h of allHooks) {
      assert.ok(h._ccBaselineId && h._ccBaselineId.startsWith('project-'),
        `project hook missing project- prefix: ${h._ccBaselineId}`);
    }
  });
});

t('project install: .mcp.json is { mcpServers: {...} } with all 5 playwright servers using npx', async () => {
  await withTempProject(async (tmp) => {
    const origLog = console.log;
    console.log = () => {};
    try {
      await install({ project: true, yes: true, skipScanners: true });
    } finally {
      console.log = origLog;
    }
    const mcp = JSON.parse(fs.readFileSync(path.join(tmp, '.mcp.json'), 'utf8'));
    assert.ok(mcp.mcpServers, '.mcp.json top-level should have mcpServers key');
    for (let n = 1; n <= 5; n++) {
      const key = `playwright-test-${n}`;
      assert.ok(mcp.mcpServers[key], `${key} missing from .mcp.json`);
      assert.equal(mcp.mcpServers[key].command, 'npx');
    }
  });
});

t('project doctor: runChecks returns 9 results with project labels', async () => {
  await withTempProject(async (tmp) => {
    const origLog = console.log;
    console.log = () => {};
    try {
      await install({ project: true, yes: true, skipScanners: true });
    } finally {
      console.log = origLog;
    }
    const results = runChecks({ project: true });
    assert.equal(results.length, 9, `expected 9 project-doctor checks, got ${results.length}`);
    const names = results.map(r => r.name);
    assert.ok(names.includes('./.claude/ directory'));
    assert.ok(names.includes('Project CLAUDE.md'));
    assert.ok(names.includes('Project MEMORY.md'));
    assert.ok(names.includes('Duplicate pre-marker content'));
    assert.ok(names.includes('Hooks (./.claude/settings.json)'));
    assert.ok(names.includes('MCP servers (./.mcp.json)'));
    assert.ok(names.includes('Global cc-baseline (informational)'));
    // scanners/notifier/playwright-mcp must be excluded from project mode
    assert.ok(!names.includes('Security scanners'));
    assert.ok(!names.includes('Playwright MCP binary'));
    // every check should pass on a freshly installed project
    const failed = results.filter(r => r.status === 'fail');
    assert.equal(failed.length, 0, `unexpected failures: ${failed.map(f => f.name + ':' + f.detail).join('; ')}`);
  });
});

t('project install + uninstall round-trip: removes everything installed', async () => {
  await withTempProject(async (tmp) => {
    const origLog = console.log;
    console.log = () => {};
    try {
      await install({ project: true, yes: true, skipScanners: true });
      await uninstall({ project: true, yes: true });
    } finally {
      console.log = origLog;
    }
    // harness files gone
    assert.ok(!fs.existsSync(path.join(tmp, '.claude', 'agents', 'e2e-tester.md')));
    assert.ok(!fs.existsSync(path.join(tmp, '.claude', 'memory', 'all_session_basic_rules.md')));
    // CLAUDE.md / MEMORY.md were "empty after removal" → deleted
    assert.ok(!fs.existsSync(path.join(tmp, '.claude', 'CLAUDE.md')));
    // .mcp.json still exists (we don't delete it, just clear mcpServers — preserves user entries)
    if (fs.existsSync(path.join(tmp, '.mcp.json'))) {
      const mcp = JSON.parse(fs.readFileSync(path.join(tmp, '.mcp.json'), 'utf8'));
      // playwright keys removed
      assert.ok(!mcp.mcpServers || !mcp.mcpServers['playwright-test-1']);
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Runner
// ──────────────────────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────────────────────
// README.md / README_KO.md — section structure stays in sync
// ──────────────────────────────────────────────────────────────────────────

function headerLevels(file) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const levels = [];
  let inFence = false;
  for (const line of src.split('\n')) {
    if (/^\s*```/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = line.match(/^(#{1,6}) \S/);
    if (m) levels.push(m[1].length);
  }
  return levels;
}

t('README.md and README_KO.md have identical section structure', () => {
  const en = headerLevels('README.md');
  const ko = headerLevels('README_KO.md');
  assert.ok(en.length > 0, 'README.md has no headers — header parser may be broken');
  assert.deepEqual(
    ko,
    en,
    `README header structure drifted: README.md has ${en.length} headers, README_KO.md has ${ko.length}. ` +
    'Keep both READMEs structurally in sync — same heading levels in the same order (translate, do not drop sections).'
  );
});

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
