#!/usr/bin/env node
'use strict';

// Stage-2 fix loop bookkeeping: which TCs to run, which failures still need a
// class or a fix, and when to stop. The e2e manager does what `next` says; the
// decisions are made here, in code, from the TC file, tc-results.jsonl and the
// loop file `.cc-audits/<slug>/findings.json` (next to the run file).
//
//   node tc-fix-loop.js start    --run <tc-run.json> --tc-file <tc file> [--results <…/tc-results.jsonl>] [--restart]
//   node tc-fix-loop.js next     --run <tc-run.json>
//   node tc-fix-loop.js round    --run <tc-run.json> --run-id <id>
//   node tc-fix-loop.js classify --run <tc-run.json> --tc <id> --class <product|env|fixture|runner|case|decision> --note <text>
//   node tc-fix-loop.js fix      --run <tc-run.json> --tc <id> --files <a,b> --test <path|none:<reason>> --summary <text> [--affected <id,…>]
//   node tc-fix-loop.js accept   --run <tc-run.json> --tc <id> --index <n> --reason <text>
//   node tc-fix-loop.js tc-change --run <tc-run.json> --tc <id> --reason <text>     (a TC removed from the file leaves the loop)
//   node tc-fix-loop.js no-result --run <tc-run.json> --tc <id> --reason <text>     (the runner left no result line in the open round)
//   node tc-fix-loop.js resume   --run <tc-run.json> --tc <id>
//   node tc-fix-loop.js report   --run <tc-run.json>
//
// `next` prints one JSON line: { action, tcs, ask_user, regressions, round, limits_left }.
// action (first match): tc_changed · run_round (first) · wait_results · classify · fix ·
// cap_reached · run_round (partial) · final_regression · ask_user · done.
//
// Only the TCs that are `ready` and not `skip`ped in the run file are in the loop.
// Only result lines of a round's run_id whose tc_digest matches the frozen TC
// text count. Only `product` failures may get a fix; the other classes go to the
// user (ask_user) while the rest of the loop goes on. A TC that fails again with
// the same fingerprint (failed step + failing expected indices) after a fix is
// stuck. Limits come from the run file's "loop" (defaults below).
// Exit 0 = done, 1 = error, 2 = refused / usage.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { parseArgs } = require('./jev-client');
const { canonical } = require('./tc-jev-judge');

const CLASSES = ['product', 'env', 'fixture', 'runner', 'case', 'decision'];
const DEFAULT_LIMITS = { max_fixes_per_tc: 3, max_rounds: 5, stuck_after: 2 };
const RUN_ID_RE = /^[0-9A-Za-z][0-9A-Za-z._-]{0,39}$/;
const TEXT_MAX = 2000;
const RESERVED_IDS = ['__proto__', 'constructor', 'prototype'];

class Refused extends Error {}

const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const tcDigest = tc => sha256(canonical(tc));
const now = () => new Date().toISOString();

// Only <project>/.cc-audits/<slug>/tc-run.json is accepted (same rule as tc-api-run.js);
// the loop file is written next to it and nowhere else.
function locate(runFile) {
  if (!runFile) throw new Refused('--run <project>/.cc-audits/<slug>/tc-run.json is required');
  let real;
  try { real = fs.realpathSync(path.resolve(runFile)); } catch (e) { throw new Refused(`run file ${runFile}: ${e.code || e.message}`); }
  const dir = path.dirname(real);
  if (path.basename(real) !== 'tc-run.json' || path.basename(path.dirname(dir)) !== '.cc-audits') {
    throw new Refused('run file must be <project>/.cc-audits/<slug>/tc-run.json');
  }
  let run;
  try { run = JSON.parse(fs.readFileSync(real, 'utf8')); } catch (e) { throw new Refused(`cannot read run file: ${e.message}`); }
  if (!run || typeof run !== 'object' || Array.isArray(run)) throw new Refused('run file must be a JSON object');
  return { root: path.dirname(path.dirname(dir)), dir, run, loopFile: path.join(dir, 'findings.json') };
}

function inside(root, file, what) {
  let real;
  try { real = fs.realpathSync(path.resolve(file)); } catch (e) { throw new Refused(`${what} ${file}: ${e.code || e.message}`); }
  if (!real.startsWith(root + path.sep)) throw new Refused(`${what} must be inside the project (${root})`);
  return real;
}

function limitsOf(run) {
  const loop = run.loop === undefined ? {} : run.loop;
  if (!loop || typeof loop !== 'object' || Array.isArray(loop)) throw new Refused('"loop" in the run file must be an object');
  const out = { ...DEFAULT_LIMITS };
  for (const [k, v] of Object.entries(loop)) {
    if (!(k in DEFAULT_LIMITS)) throw new Refused(`unknown "loop" key ${k} (${Object.keys(DEFAULT_LIMITS).join(', ')})`);
    if (!Number.isInteger(v) || v < 1 || v > 50) throw new Refused(`loop.${k} must be an integer 1..50`);
    out[k] = v;
  }
  return out;
}

function readTcs(file) {
  let doc;
  try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Refused(`cannot read TC file: ${e.message}`); }
  const list = Array.isArray(doc && doc.test_cases) ? doc.test_cases : [];
  return new Map(list.filter(t => t && typeof t.id === 'string' && !RESERVED_IDS.includes(t.id)).map(t => [t.id, t]));
}

function readJsonl(file) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

function loadLoop(loc) {
  if (!fs.existsSync(loc.loopFile)) throw new Refused(`no loop yet — run: tc-fix-loop.js start --run <tc-run.json> --tc-file <tc file>`);
  let st;
  try { st = JSON.parse(fs.readFileSync(loc.loopFile, 'utf8')); } catch (e) { throw new Refused(`loop file ${loc.loopFile} is unreadable (${e.message}) — start a new loop with start --restart`); }
  if (!st || typeof st !== 'object' || !st.frozen || !Array.isArray(st.rounds)) throw new Refused(`loop file ${loc.loopFile} is not a loop — start a new loop with start --restart`);
  for (const k of ['failures', 'fixes', 'accepted', 'tc_changes', 'resumed', 'no_results']) if (!Array.isArray(st[k])) st[k] = [];
  st.limits = limitsOf(loc.run);   // the run file stays the place to change limits
  // the paths in the loop file are checked again, so an edited loop file cannot point reads elsewhere
  st.tc_file = inside(loc.root, st.tc_file, 'loop tc_file');
  if (path.basename(st.results) !== 'tc-results.jsonl') throw new Refused('loop results file must be named tc-results.jsonl');
  let resDir = path.dirname(path.resolve(st.results));
  try { resDir = fs.realpathSync(resDir); } catch { /* not created yet */ }
  if (!resDir.startsWith(loc.root + path.sep)) throw new Refused('loop results file must be inside the project');
  st.results = path.join(resDir, 'tc-results.jsonl');
  st.frozen = Object.assign(Object.create(null), st.frozen);
  return st;
}

function saveLoop(loc, st) {
  const tmp = `${loc.loopFile}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(st, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  fs.renameSync(tmp, loc.loopFile);
}

function text(v, name) {
  if (typeof v !== 'string' || !v.trim()) throw new Refused(`${name} is required`);
  if (v.length > TEXT_MAX) throw new Refused(`${name} is longer than ${TEXT_MAX} characters`);
  return v.trim();
}

function frozenTc(st, id) {
  if (typeof id !== 'string' || !Object.prototype.hasOwnProperty.call(st.frozen, id)) throw new Refused(`${id} is not in this loop`);
  return id;
}

// ── state ────────────────────────────────────────────────────────────────

function isAccepted(st, tc, index) {
  return st.accepted.some(a => a.tc === tc && a.index === index);
}

function outcomeOf(st, line) {
  const bad = (Array.isArray(line.expected) ? line.expected : [])
    .filter(e => e.verdict !== 'PASS' && !(e.verdict === 'NOT_OBSERVABLE' && isAccepted(st, line.tc, e.index)))
    .map(e => `${e.index}:${e.verdict}`).sort();
  // a TC passes only with its invariants held and its screens' sweep clean (e2e-tester §0 / tc-replay.js)
  if (line.invariants === 'fail') bad.push('invariants');
  if (line.sweep === 'fail') bad.push('sweep');
  const step = Number.isInteger(line.failed_at_step) ? line.failed_at_step : null;
  if (bad.length === 0 && step === null) return { pass: true };
  return { pass: false, fingerprint: sha256(JSON.stringify({ step, bad })).slice(0, 12), failing: bad, failed_at_step: step };
}

function computeState(st) {
  const lines = readJsonl(st.results);
  const ids = Object.keys(st.frozen);
  const tcs = Object.create(null);
  for (const id of ids) tcs[id] = { history: [] };
  st.rounds.forEach((r, i) => {
    const n = i + 1;
    for (const id of r.tcs) {
      if (!tcs[id]) continue;
      const mine = lines.filter(l => l.run_id === r.run_id && l.tc === id && l.tc_digest === st.frozen[id]);
      if (mine.length) tcs[id].history.push({ round: n, ...outcomeOf(st, mine[mine.length - 1]), line: mine[mine.length - 1] });
      else if (st.no_results.some(x => x.tc === id && x.round === n)) {
        // the runner left no result line: a failure of its own kind, classified like any other
        tcs[id].history.push({ round: n, pass: false, fingerprint: 'no-result', failing: ['no-result'], failed_at_step: null, no_result: true, line: { expected: [] } });
      }
    }
  });
  const R = st.rounds.length;
  for (const id of ids) {
    const s = tcs[id];
    // resets: an approved TC change or a user resume starts the TC's counters again
    const resetAt = Math.max(0, ...st.tc_changes.filter(c => c.tc === id).map(c => c.round), ...st.resumed.filter(c => c.tc === id).map(c => c.round));
    s.resetAt = resetAt;
    s.latest = s.history.length ? s.history[s.history.length - 1] : null;
    s.fixes = st.fixes.filter(f => f.tc === id && f.round > resetAt);
    if (s.latest && !s.latest.pass) {
      const cls = st.failures.filter(f => f.tc === id && f.round === s.latest.round);
      s.cls = cls.length ? cls[cls.length - 1] : null;
      s.fixedAfter = st.fixes.some(f => f.tc === id && f.round >= s.latest.round);
      // same fingerprint in a row, counted only after the last reset
      let streak = 0;
      for (let k = s.history.length - 1; k >= 0 && s.history[k].round > resetAt; k--) {
        if (!s.history[k].pass && s.history[k].fingerprint === s.latest.fingerprint) streak++; else break;
      }
      s.streak = streak;
      const resumedAfter = st.resumed.some(c => c.tc === id && c.round >= s.latest.round);
      if (!resumedAfter && !s.fixedAfter) {
        if (s.cls && s.cls.class !== 'product') s.parked = { tc: id, reason: 'class', class: s.cls.class, note: s.cls.note };
        else if (streak >= st.limits.stuck_after && s.history.length > 1) s.parked = { tc: id, reason: 'stuck', fingerprint: s.latest.fingerprint, failing: s.latest.failing };
        else if (s.fixes.length >= st.limits.max_fixes_per_tc) s.parked = { tc: id, reason: 'fix_cap', fixes: s.fixes.length };
      }
    }
    // anything recorded after the TC last ran means it has to run again
    const lastRun = s.latest ? s.latest.round : 0;
    s.needsRun = R > 0 && (!s.latest
      || st.fixes.some(f => f.round >= lastRun && (f.tc === id || (f.affected || []).includes(id)))
      || st.resumed.some(c => c.tc === id && c.round >= lastRun)
      || st.tc_changes.some(c => c.tc === id && c.round >= lastRun));
    s.passedBefore = s.history.slice(0, -1).some(h => h.pass);
  }
  return { tcs, R };
}

function changedTcs(st) {
  const current = readTcs(st.tc_file);
  return Object.keys(st.frozen).filter(id => !current.has(id) || tcDigest(current.get(id)) !== st.frozen[id]);
}

function next(st) {
  const { tcs, R } = computeState(st);
  const ids = Object.keys(st.frozen);
  const askUser = ids.map(id => tcs[id].parked).filter(Boolean);
  const parked = new Set(askUser.map(p => p.tc));
  const active = ids.filter(id => !parked.has(id));
  const regressions = ids.filter(id => tcs[id].latest && !tcs[id].latest.pass && tcs[id].passedBefore);
  const fullRounds = st.rounds.filter(r => r.kind === 'full' || r.kind === 'final').length;
  const base = { ask_user: askUser, regressions, round: R,
    limits_left: { rounds: Math.max(0, st.limits.max_rounds - R), final_regression_extra: fullRounds > 0 && R >= st.limits.max_rounds ? 1 : 0 } };
  const out = (action, list, extra = {}) => ({ action, tcs: list, ...base, ...extra });

  const changed = changedTcs(st);
  if (changed.length) return out('tc_changed', changed, { hint: 'TC text changed after the loop started — ask the user; record an approved change with tc-change' });
  if (R === 0) return out('run_round', active, { kind: 'full' });

  const last = st.rounds[R - 1];
  // a TC re-frozen by tc-change after this round opened runs again instead
  const missing = last.tcs.filter(id => tcs[id] && !tcs[id].history.some(h => h.round === R) && !parked.has(id)
    && !st.tc_changes.some(c => c.tc === id && c.round >= R));
  if (missing.length) return out('wait_results', missing, { run_id: last.run_id });

  const failing = active.filter(id => tcs[id].latest && !tcs[id].latest.pass && !tcs[id].fixedAfter
    && !st.resumed.some(c => c.tc === id && c.round >= tcs[id].latest.round));
  const unclassified = failing.filter(id => !tcs[id].cls);
  if (unclassified.length) return out('classify', unclassified, { classes: CLASSES });
  const toFix = failing.filter(id => tcs[id].cls && tcs[id].cls.class === 'product');
  if (toFix.length) return out('fix', toFix, { fingerprints: Object.fromEntries(toFix.map(id => [id, tcs[id].latest.fingerprint])) });

  const rerun = active.filter(id => tcs[id].needsRun);
  if (rerun.length) {
    if (R >= st.limits.max_rounds) return out('cap_reached', rerun, { hint: 'round limit reached — report to the user; raise loop.max_rounds in tc-run.json to go on' });
    return out('run_round', rerun, { kind: 'partial' });
  }
  if (active.length) {
    const lastFull = [...st.rounds.keys()].reverse().find(i => st.rounds[i].kind !== 'partial');
    const sinceFull = lastFull === undefined ? st.rounds : st.rounds.slice(lastFull + 1);
    const fullCovers = lastFull !== undefined && active.every(id => st.rounds[lastFull].tcs.includes(id));
    if (sinceFull.length > 0 || !fullCovers) {
      // the closing full round may go one past max_rounds: it only confirms
      if (R > st.limits.max_rounds) return out('cap_reached', active, { hint: 'round limit reached before the full regression round' });
      return out('final_regression', active, { kind: 'final' });
    }
  }
  if (askUser.length) return out('ask_user', askUser.map(p => p.tc));
  return out('done', []);
}

// ── commands ─────────────────────────────────────────────────────────────

function start(loc, { tcFile, results, restart }) {
  if (fs.existsSync(loc.loopFile) && !restart) throw new Refused(`a loop already exists (${loc.loopFile}) — use --restart to begin a new one`);
  const tcPath = inside(loc.root, tcFile, '--tc-file');
  const resPath = results ? path.resolve(results) : path.join(loc.dir, 'tc-results.jsonl');
  if (path.basename(resPath) !== 'tc-results.jsonl') throw new Refused('results file must be named tc-results.jsonl');
  let resDir = path.dirname(resPath);
  try { resDir = fs.realpathSync(resDir); } catch { /* not created yet: checked as given */ }
  if (!resDir.startsWith(loc.root + path.sep)) throw new Refused('results file must be inside the project');
  const limits = limitsOf(loc.run);
  const skips = loc.run.tcs && typeof loc.run.tcs === 'object' ? loc.run.tcs : {};
  const frozen = Object.create(null);
  const skipped = [];
  for (const [id, tc] of readTcs(tcPath)) {
    if (tc.readiness !== 'ready') continue;
    if (skips[id] && skips[id].skip) { skipped.push({ tc: id, skip: skips[id].skip }); continue; }
    frozen[id] = tcDigest(tc);
  }
  if (!Object.keys(frozen).length) throw new Refused('no ready TC to run (all are skipped or not ready)');
  const st = { version: 1, started_at: now(), tc_file: tcPath, results: resPath, limits, frozen, skipped,
    rounds: [], failures: [], fixes: [], accepted: [], tc_changes: [], resumed: [], no_results: [] };
  saveLoop(loc, st);
  return { started: Object.keys(frozen).length, skipped, limits, loop_file: loc.loopFile };
}

function openRound(loc, st, runId) {
  if (typeof runId !== 'string' || !RUN_ID_RE.test(runId)) throw new Refused('--run-id must look like 20261118T093000Z (letters, digits, . _ -)');
  if (st.rounds.some(r => r.run_id === runId)) throw new Refused(`run_id ${runId} is already a round of this loop`);
  const n = next(st);
  if (n.action === 'tc_changed') throw new Refused(`TC text changed without an approved tc-change: ${n.tcs.join(', ')}`);
  if (n.action === 'cap_reached') throw new Refused(`round limit reached (${st.limits.max_rounds}) — ${n.tcs.length} TC(s) still open`);
  if (n.action !== 'run_round' && n.action !== 'final_regression') throw new Refused(`next says ${n.action}${n.tcs.length ? ` (${n.tcs.join(', ')})` : ''} — not a round`);
  const r = { run_id: runId, kind: n.kind, tcs: n.tcs, opened_at: now() };
  st.rounds.push(r);
  saveLoop(loc, st);
  return { round: st.rounds.length, ...r };
}

function noResult(loc, st, { tc, reason }) {
  frozenTc(st, tc);
  const R = st.rounds.length;
  if (!R || !st.rounds[R - 1].tcs.includes(tc)) throw new Refused(`${tc} is not in the open round`);
  const { tcs } = computeState(st);
  if (tcs[tc].history.some(h => h.round === R)) throw new Refused(`${tc} already has a result in round ${R}`);
  const entry = { tc, round: R, reason: text(reason, '--reason'), at: now() };
  st.no_results.push(entry);
  saveLoop(loc, st);
  return entry;
}

function latestFail(st, id) {
  const { tcs } = computeState(st);
  const s = tcs[id];
  if (!s.latest || s.latest.pass) throw new Refused(`${id} has no failing result to act on`);
  return s;
}

function classify(loc, st, { tc, cls, note }) {
  frozenTc(st, tc);
  if (!CLASSES.includes(cls)) throw new Refused(`--class must be one of ${CLASSES.join(' | ')}`);
  const s = latestFail(st, tc);
  // the current round's failure, or — after the user's answer (resume) — the failure they looked at
  const resumed = st.resumed.some(c => c.tc === tc && c.round >= s.latest.round);
  if (s.latest.round !== st.rounds.length && !resumed) throw new Refused(`${tc} did not fail in the current round ${st.rounds.length}`);
  const entry = { tc, round: s.latest.round, class: cls, note: text(note, '--note'), fingerprint: s.latest.fingerprint, failing: s.latest.failing,
    failed_at_step: s.latest.failed_at_step, regression: s.passedBefore, at: now() };
  st.failures.push(entry);
  saveLoop(loc, st);
  return entry;
}

function fix(loc, st, { tc, files, test, summary, affected }) {
  frozenTc(st, tc);
  const s = latestFail(st, tc);
  if (!s.cls || s.cls.class !== 'product') throw new Refused(`${tc}: only a failure classified product gets a fix (now: ${s.cls ? s.cls.class : 'unclassified'})`);
  if (s.fixedAfter) throw new Refused(`${tc}: a fix is already recorded for this failure — run the TC again first`);
  if (s.fixes.length >= st.limits.max_fixes_per_tc) throw new Refused(`${tc}: fix limit reached (${st.limits.max_fixes_per_tc}) — ask the user`);
  const fileList = String(files || '').split(',').map(f => f.trim()).filter(Boolean);
  if (!fileList.length) throw new Refused('--files is required (the changed product files)');
  if (!test) throw new Refused('--test is required: the repro test that failed before the fix, or none:<reason> when the project has no test suite');
  let testRef;
  if (test.startsWith('none:')) testRef = { none: text(test.slice(5), '--test none:<reason>') };
  else testRef = { path: path.relative(loc.root, inside(loc.root, test, '--test')) };
  const aff = String(affected || '').split(',').map(a => a.trim()).filter(Boolean);
  for (const a of aff) frozenTc(st, a);
  const entry = { tc, round: st.rounds.length, failure_round: s.latest.round, fingerprint: s.latest.fingerprint, files: fileList, test: testRef,
    summary: text(summary, '--summary'), affected: aff, at: now() };
  st.fixes.push(entry);
  saveLoop(loc, st);
  return entry;
}

function accept(loc, st, { tc, index, reason }) {
  frozenTc(st, tc);
  const i = Number(index);
  const { tcs } = computeState(st);
  const latest = tcs[tc].latest;
  const e = latest && (latest.line.expected || []).find(x => x.index === i);
  if (!e || e.verdict !== 'NOT_OBSERVABLE') throw new Refused(`${tc} expected[${index}] is not NOT_OBSERVABLE in its latest result`);
  const entry = { tc, index: i, reason: text(reason, '--reason'), round: st.rounds.length, at: now() };
  st.accepted.push(entry);
  saveLoop(loc, st);
  return entry;
}

function tcChange(loc, st, { tc, reason }) {
  frozenTc(st, tc);
  const cur = readTcs(st.tc_file).get(tc);
  if (!cur) {
    // removed from the TC file with the user's OK: it leaves the loop, on record
    const entry = { tc, reason: text(reason, '--reason'), from: st.frozen[tc], to: null, removed: true, round: st.rounds.length, at: now() };
    delete st.frozen[tc];
    st.tc_changes.push(entry);
    saveLoop(loc, st);
    return entry;
  }
  const to = tcDigest(cur);
  if (to === st.frozen[tc]) throw new Refused(`${tc} is unchanged in the TC file — nothing to record`);
  const entry = { tc, reason: text(reason, '--reason'), from: st.frozen[tc], to, round: st.rounds.length, at: now() };
  st.frozen[tc] = to;
  st.tc_changes.push(entry);
  saveLoop(loc, st);
  return entry;
}

function resume(loc, st, { tc }) {
  frozenTc(st, tc);
  const n = next(st);
  if (!n.ask_user.some(p => p.tc === tc)) throw new Refused(`${tc} is not waiting on the user`);
  const entry = { tc, round: st.rounds.length, at: now() };
  st.resumed.push(entry);
  saveLoop(loc, st);
  return entry;
}

function report(st) {
  const lines = readJsonl(st.results);
  const n = next(st);
  const rounds = st.rounds.map((r, i) => {
    const mine = lines.filter(l => l.run_id === r.run_id && r.tcs.includes(l.tc) && l.tc_digest === st.frozen[l.tc]);
    const times = mine.map(l => Date.parse(l.run_at)).filter(Number.isFinite);
    const ex = mine.flatMap(l => (Array.isArray(l.expected) ? l.expected : []));
    return { round: i + 1, run_id: r.run_id, kind: r.kind, tcs: r.tcs.length, results: mine.length,
      pass: mine.filter(l => outcomeOf(st, l).pass).length,
      span_ms: times.length > 1 ? Math.max(...times) - Math.min(...times) : 0,
      jev: { calls: ex.filter(e => e.jev_ms !== undefined).length, ms: ex.reduce((a, e) => a + (e.jev_ms || 0), 0), tokens: ex.reduce((a, e) => a + (e.jev_tokens || 0), 0) } };
  });
  const byClass = {};
  for (const f of st.failures) byClass[f.class] = (byClass[f.class] || 0) + 1;
  return { status: n.action, rounds, fixes: st.fixes.length, failures_by_class: byClass,
    regressions: st.failures.filter(f => f.regression).map(f => ({ tc: f.tc, round: f.round })),
    ask_user: n.ask_user, tc_changes: st.tc_changes.length, removed: st.tc_changes.filter(c => c.removed).map(c => c.tc),
    no_results: st.no_results.length, accepted_not_observable: st.accepted.length,
    tests: { written: st.fixes.filter(f => f.test.path).length, none: st.fixes.filter(f => f.test.none).length } };
}

const USAGE = 'usage: tc-fix-loop.js start|next|round|classify|fix|accept|tc-change|no-result|resume|report --run <…/.cc-audits/<slug>/tc-run.json> … (see the header of this file)';

function main(argv) {
  const [cmd, ...rest] = argv.slice(2);
  const spec = {
    start: { values: ['--run', '--tc-file', '--results'], flags: ['--restart'] },
    next: { values: ['--run'] },
    round: { values: ['--run', '--run-id'] },
    classify: { values: ['--run', '--tc', '--class', '--note'] },
    fix: { values: ['--run', '--tc', '--files', '--test', '--summary', '--affected'] },
    accept: { values: ['--run', '--tc', '--index', '--reason'] },
    'tc-change': { values: ['--run', '--tc', '--reason'] },
    'no-result': { values: ['--run', '--tc', '--reason'] },
    resume: { values: ['--run', '--tc'] },
    report: { values: ['--run'] },
  }[cmd];
  if (!spec) { console.error(USAGE); return 2; }
  let opts;
  try { ({ opts } = parseArgs(rest, spec)); } catch (e) { console.error(`tc-fix-loop: ${e.message}\n${USAGE}`); return 2; }
  try {
    const loc = locate(opts['--run']);
    let result;
    if (cmd === 'start') {
      if (!opts['--tc-file']) throw new Refused('--tc-file is required');
      result = start(loc, { tcFile: opts['--tc-file'], results: opts['--results'], restart: !!opts['--restart'] });
    } else {
      const st = loadLoop(loc);
      if (cmd === 'next') result = next(st);
      else if (cmd === 'round') result = openRound(loc, st, opts['--run-id']);
      else if (cmd === 'classify') result = classify(loc, st, { tc: opts['--tc'], cls: opts['--class'], note: opts['--note'] });
      else if (cmd === 'fix') result = fix(loc, st, { tc: opts['--tc'], files: opts['--files'], test: opts['--test'], summary: opts['--summary'], affected: opts['--affected'] });
      else if (cmd === 'accept') result = accept(loc, st, { tc: opts['--tc'], index: opts['--index'], reason: opts['--reason'] });
      else if (cmd === 'tc-change') result = tcChange(loc, st, { tc: opts['--tc'], reason: opts['--reason'] });
      else if (cmd === 'no-result') result = noResult(loc, st, { tc: opts['--tc'], reason: opts['--reason'] });
      else if (cmd === 'resume') result = resume(loc, st, { tc: opts['--tc'] });
      else result = report(st);
    }
    console.log(JSON.stringify(result));
    return 0;
  } catch (e) {
    console.error(`tc-fix-loop: ${e.message}`);
    return e instanceof Refused ? 2 : 1;
  }
}

if (require.main === module) process.exitCode = main(process.argv);

module.exports = { next, computeState, outcomeOf, tcDigest, limitsOf, CLASSES, DEFAULT_LIMITS, Refused };
