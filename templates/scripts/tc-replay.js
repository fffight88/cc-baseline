#!/usr/bin/env node
'use strict';

// Replays TCs from recordings that e2e-tester wrote on its first run, so later
// fix-loop rounds need no LLM. A recording is data — a fixed list of ops — never code.
//
//   node tc-replay.js check  --run <tc-run.json> --tc <id>
//   node tc-replay.js run    --run <tc-run.json> --run-id <id> --tcs <id,…> [--verify]
//   node tc-replay.js finish --run <tc-run.json> --run-id <id> --verdicts <json file>
//   node tc-replay.js urls   --run <tc-run.json> [--tcs <id,…>]
//
// Recording: <project>/.cc-audits/<slug>/replay/<tc id>.json (see the manager guide §2-C
// for the format). `run` opens one browser context per TC (only base_url's origin),
// runs setup → login → steps → expected → teardown (setup / teardown / `command` run the
// TC's run-file data.<name>_command — <node|bash|sh|python3> <committed script> <plain args>, no shell;
// `new_tab` and `parallel` requests are actions too), sweeps the screens it visited (tc-sweep.js) and
// records one tc-results line (browser_tool "replay"). Per TC it prints:
//   recorded — a result line was written (code verdicts, failed_at_step when a step's
//              done_when did not hold — the same as a tester)
//   fallback — no line; run this TC with e2e-tester (stale, no_recording, not_accepted,
//              locator_missing:<step>, command_failed:<where>, no_browser, error, blocked_offsite:<origins> — a
//              failing replay that blocked requests outside base_url / browser_origins)
//   pending  — Jev returned REVIEW or asked for a re-check: judge the observation files
//              and run `finish`
// --verify writes no result line: it compares the replay with the tester's line of the
// same run id and records the recording as accepted (all verdicts equal, code results that
// both FAIL read the same value, and a failing replay blocked no off-site request) or
// rejected in replay-accepted.json — the only place acceptance is read from.
// Exit 0 = done, 1 = error, 2 = refused / usage.

const crypto = require('crypto');
const fs = require('fs');
const { execFile } = require('child_process');
const os = require('os');
const path = require('path');
const { parseArgs, loadConfig } = require('./jev-client');
const api = require('./tc-api-run');
const jj = require('./tc-jev-judge');
const sw = require('./tc-sweep');

const { Refused } = api;
const TC_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const RUN_ID_RE = /^[0-9A-Za-z][0-9A-Za-z._-]{0,39}$/;
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;
const ENV_REF_RE = /^\$([A-Z_][A-Z0-9_]*)$/;
const MAX_FILE = 256 * 1024;
const MAX_ACTIONS = 50;
const STEP_TIMEOUT = 5000;
const CHECK_TIMEOUT = 3000;

const ACTION_OPS = ['goto', 'click', 'fill', 'press', 'select', 'check_box', 'wait', 'capture', 'request', 'command', 'new_tab', 'parallel'];
const COMMAND_NAME_RE = /^[a-z0-9_]+_command$/;
const MAX_HOOKS = 5;
const COMMAND_TIMEOUT = 60000;
const SCREEN_CHECKS = ['text', 'count', 'visible', 'hidden', 'enabled', 'disabled', 'url_path', 'url', 'value'];
const DATA_CHECKS = { api: ['api'], db: ['db'], log: ['log_count'] };
const FORM_ROLES = ['combobox', 'listbox', 'textbox', 'searchbox', 'spinbutton', 'checkbox', 'radio', 'switch', 'slider'];
const LOCATOR_KEYS = ['role', 'label', 'text', 'selector', 'placeholder', 'test_id'];
const COMPARE_KEYS = ['equals', 'includes', 'starts', 'excludes', 'in', 'not_in', 'all_equals'];
const FIELD_RE = /^[A-Za-z_][A-Za-z0-9_]{0,39}$/;

// ── templates: {{data.x}}, {{name}}, {{a - b}} ───────────────────────────

const TEMPLATE_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;
const TERM_RE = /^(?:data\.[A-Za-z0-9_.]+|[A-Za-z_][A-Za-z0-9_]*|-?\d+)$/;

function checkTemplate(s, where) {
  if (typeof s !== 'string') return;
  for (const m of s.matchAll(TEMPLATE_RE)) {
    const parts = m[1].split(/\s*([+-])\s*/).filter(x => x !== '');
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 1) { if (!['+', '-'].includes(parts[i])) throw new Refused(`${where}: bad operator in {{${m[1]}}}`); continue; }
      if (!TERM_RE.test(parts[i])) throw new Refused(`${where}: {{${m[1]}}} — only data.x, capture names, integers, + and -`);
    }
  }
  const env = ENV_REF_RE.exec(s);
  if (s.includes('$') && !env && /\$[A-Z_]/.test(s)) throw new Refused(`${where}: an env value must be the whole string "$NAME"`);
}

function lookup(scope, term) {
  if (/^-?\d+$/.test(term)) return Number(term);
  if (term.startsWith('data.')) {
    let cur = scope.data;
    for (const k of term.slice(5).split('.')) cur = cur && typeof cur === 'object' && Object.prototype.hasOwnProperty.call(cur, k) ? cur[k] : undefined;
    if (cur === undefined) throw new Error(`no run data for {{${term}}}`);
    return cur;
  }
  if (!Object.prototype.hasOwnProperty.call(scope.cap, term)) throw new Error(`nothing captured as {{${term}}}`);
  return scope.cap[term];
}

function evalExpr(expr, scope) {
  const parts = expr.split(/\s*([+-])\s*/).filter(x => x !== '');
  let v = lookup(scope, parts[0]);
  for (let i = 1; i < parts.length; i += 2) {
    const b = Number(lookup(scope, parts[i + 1]));
    v = parts[i] === '+' ? Number(v) + b : Number(v) - b;
  }
  return v;
}

function resolve(value, scope) {
  if (typeof value !== 'string') return value;
  const env = ENV_REF_RE.exec(value);
  if (env) {
    if (!scope.allowedEnv.has(env[1])) throw new Error(`$${env[1]} is not listed in secret_env`);
    if (typeof scope.env[env[1]] !== 'string') throw new Error(`$${env[1]} is not set`);
    scope.secrets.push(scope.env[env[1]]);
    return scope.env[env[1]];
  }
  const whole = /^\{\{\s*([^{}]+?)\s*\}\}$/.exec(value);
  if (whole) return evalExpr(whole[1], scope);
  return value.replace(TEMPLATE_RE, (_, e) => String(evalExpr(e, scope)));
}

// ── recording files ──────────────────────────────────────────────────────

function recFile(rc, tc) {
  if (typeof tc !== 'string' || !TC_ID_RE.test(tc)) throw new Refused(`bad TC id ${tc}`);
  return path.join(rc.dir, 'replay', `${tc}.json`);
}

function readRecording(rc, tc) {
  const f = recFile(rc, tc);
  let st;
  try { st = fs.lstatSync(f); } catch { return null; }
  if (st.isSymbolicLink() || !st.isFile()) throw new Refused(`${f} must be a regular file`);
  if (st.size > MAX_FILE) throw new Refused(`${f} is larger than ${MAX_FILE} bytes`);
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { throw new Refused(`${f} is not JSON: ${e.message}`); }
}

// The part of a recording that a verify replay vouches for (everything but its status).
function contentDigest(rec) {
  const { status, ...body } = rec;
  return crypto.createHash('sha256').update(jj.canonical(body)).digest('hex');
}

// Acceptance lives outside the recordings, written only by `run --verify`:
// .cc-audits/<slug>/replay-accepted.json { "<tc>": { status, digest, run_id, mismatch?, unverified?, urls? } }.
// A recording's own "status" is never trusted.
function acceptFile(rc) { return path.join(rc.dir, 'replay-accepted.json'); }

function readAccepted(rc) {
  const f = acceptFile(rc);
  try {
    if (fs.lstatSync(f).isSymbolicLink()) throw new Refused(`${f} must not be a symlink`);
    const doc = JSON.parse(fs.readFileSync(f, 'utf8'));
    return doc && typeof doc === 'object' && !Array.isArray(doc) ? Object.assign(Object.create(null), doc) : Object.create(null);
  } catch (e) {
    if (e instanceof Refused) throw e;
    return Object.create(null);
  }
}

function acceptance(rc, rec) {
  const a = readAccepted(rc)[rec.tc];
  if (!a || a.digest !== contentDigest(rec)) return { status: 'unverified' };
  return a;
}

function tcOf(rc, rec) {
  if (typeof rec.tc_file !== 'string' || !/^docs\/tc\/[A-Za-z0-9._-]+\.tc\.json$/.test(rec.tc_file)) throw new Refused('tc_file must be docs/tc/<feature>.tc.json');
  let real;
  try { real = fs.realpathSync(path.resolve(rc.root, rec.tc_file)); } catch (e) { throw new Refused(`tc_file ${rec.tc_file}: ${e.code || e.message}`); }
  if (!real.startsWith(rc.root + path.sep)) throw new Refused('tc_file must be inside the project');
  let doc;
  try { doc = JSON.parse(fs.readFileSync(real, 'utf8')); } catch { throw new Refused(`tc_file ${rec.tc_file} is not valid JSON`); }
  const tc = (Array.isArray(doc.test_cases) ? doc.test_cases : []).find(t => t && t.id === rec.tc);
  if (!tc) throw new Refused(`${rec.tc} is not in ${rec.tc_file}`);
  return { tc, tcFile: real, digest: crypto.createHash('sha256').update(jj.canonical(tc)).digest('hex') };
}

function allowedEnv(run) {
  const names = new Set(Array.isArray(run.secret_env) ? run.secret_env : []);
  for (const t of Object.values(run.tcs && typeof run.tcs === 'object' ? run.tcs : {})) {
    if (t && Array.isArray(t.secret_env)) for (const n of t.secret_env) names.add(n);
  }
  return names;
}

// ── format check (no browser) ────────────────────────────────────────────

function checkTarget(t, where) {
  if (!t || typeof t !== 'object' || Array.isArray(t)) throw new Refused(`${where}: target must be an object`);
  const keys = LOCATOR_KEYS.filter(k => t[k] !== undefined);
  if (keys.length !== 1) throw new Refused(`${where}: target needs exactly one of ${LOCATOR_KEYS.join(', ')}`);
  for (const k of Object.keys(t)) if (![...LOCATOR_KEYS, 'name', 'exact', 'nth'].includes(k)) throw new Refused(`${where}: unknown target key ${k}`);
  if (t.name !== undefined && keys[0] !== 'role') throw new Refused(`${where}: name goes with role`);
  if (t.nth !== undefined && !(Number.isInteger(t.nth) && t.nth >= 0 && t.nth < 1000)) throw new Refused(`${where}: nth must be a small integer`);
  for (const k of [...keys, 'name']) if (t[k] !== undefined) { if (typeof t[k] !== 'string' || !t[k]) throw new Refused(`${where}: ${k} must be text`); checkTemplate(t[k], where); }
}

function checkPath(p, where, rc) {
  if (typeof p !== 'string') throw new Refused(`${where}: path must be text`);
  checkTemplate(p, where);
  if (!p.startsWith('/') || p.startsWith('//') || p.includes('\\') || /^[a-z][a-z0-9+.-]*:/i.test(p)) throw new Refused(`${where}: path must start with a single "/" — absolute URLs are refused`);
  if (!p.includes('{{')) api.targetUrl(rc.base, p);
}

function checkCompare(c, where) {
  const keys = COMPARE_KEYS.filter(k => c[k] !== undefined);
  if (keys.length !== 1) throw new Refused(`${where}: needs exactly one of ${COMPARE_KEYS.join(', ')}`);
  checkTemplate(typeof c[keys[0]] === 'string' ? c[keys[0]] : '', where);
  if (['in', 'not_in'].includes(keys[0]) && !(typeof c[keys[0]] === 'string' && /^\{\{[^{}]+\}\}$/.test(c[keys[0]].trim())) && !Array.isArray(c[keys[0]])) {
    throw new Refused(`${where}: ${keys[0]} needs a list or a captured list ("{{name}}")`);
  }
  if (c.field !== undefined && (!FIELD_RE.test(c.field) || !['in', 'not_in', 'all_equals'].includes(keys[0]))) throw new Refused(`${where}: field (a key name) goes with in, not_in or all_equals`);
}

function checkCondition(c, where, rc, allowed) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) throw new Refused(`${where}: must be an object`);
  if (!allowed.includes(c.op)) throw new Refused(`${where}: op "${c.op}" is not allowed here (${allowed.join(', ')})`);
  if (['text', 'count', 'visible', 'hidden', 'enabled', 'disabled', 'value'].includes(c.op)) checkTarget(c.target, where);
  if (['text', 'url_path', 'url', 'value'].includes(c.op)) checkCompare(c, where);
  if (c.op === 'count' && !Number.isInteger(c.equals)) throw new Refused(`${where}: count needs an integer equals`);
  if (c.op === 'api') {
    if ((c.response === undefined) === (c.request === undefined)) throw new Refused(`${where}: api check needs either "response": "<save_as name>" or its own "request"`);
    if (c.response !== undefined && (typeof c.response !== 'string' || !NAME_RE.test(c.response))) throw new Refused(`${where}: response must be a save_as name`);
    if (c.request !== undefined) {
      const q = c.request;
      if (!q || !['GET', 'HEAD'].includes(q.method)) throw new Refused(`${where}: a check's own request is GET or HEAD only`);
      checkPath(q.path, where, rc);
      if (typeof q.session !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/.test(q.session)) throw new Refused(`${where}: request needs a session name`);
    }
    if (c.status === undefined && c.json_path === undefined && c.header === undefined) throw new Refused(`${where}: api check needs status, json_path or header`);
    if (c.header !== undefined) {
      if (typeof c.header !== 'string' || !/^[A-Za-z0-9-]{1,80}$/.test(c.header)) throw new Refused(`${where}: header must be a response header name`);
      if (c.json_path !== undefined) throw new Refused(`${where}: give either header or json_path, not both`);
      checkCompare(c, where);
    }
    if (c.status !== undefined && !Number.isInteger(c.status)) throw new Refused(`${where}: status must be an integer`);
    if (c.json_path !== undefined) { checkTemplate(c.json_path, where); checkCompare(c, where); }
  }
  if (c.op === 'db') {
    if (typeof c.json_path !== 'string') throw new Refused(`${where}: db check needs json_path`);
    checkTemplate(c.json_path, where);
    if (c.count !== undefined) {
      if (!Number.isInteger(c.count) && !(typeof c.count === 'string' && /^\{\{[^{}]+\}\}$/.test(c.count.trim()))) throw new Refused(`${where}: count must be an integer or "{{expression}}"`);
      checkTemplate(typeof c.count === 'string' ? c.count : '', where);
    } else checkCompare(c, where);
    if (c.source !== undefined && typeof c.source !== 'string') throw new Refused(`${where}: source must be a readable name`);
  }
  if (c.op === 'log_count') {
    if (!Array.isArray(c.grep) || !c.grep.length || c.grep.some(g => typeof g !== 'string' || !g)) throw new Refused(`${where}: log_count needs grep texts`);
    c.grep.forEach(g => checkTemplate(g, where));
    if (!Number.isInteger(c.equals)) throw new Refused(`${where}: log_count needs an integer equals`);
  }
}

// The run file's data.<name>_command for this TC, checked (never a command written in the recording).
function commandOf(rc, tcId, name, where) {
  if (typeof name !== 'string' || !COMMAND_NAME_RE.test(name)) throw new Refused(`${where}: command needs the name of a run-file data entry ending in _command`);
  const data = ((rc.run.tcs || {})[tcId] || {}).data || {};
  if (!Object.prototype.hasOwnProperty.call(data, name)) throw new Refused(`${where}: the run file has no data.${name} for ${tcId}`);
  try { return api.checkCommand(data[name], rc.root); } catch (e) { throw new Refused(`${where}: data.${name}: ${e.message}`); }
}

function checkAction(a, where, rc, tcId) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) throw new Refused(`${where}: action must be an object`);
  if (!ACTION_OPS.includes(a.op)) throw new Refused(`${where}: op "${a.op}" is not allowed (${ACTION_OPS.join(', ')})`);
  if (a.op === 'command') commandOf(rc, tcId, a.name, where);
  if (a.op === 'new_tab' && a.path !== undefined) checkPath(a.path, where, rc);
  if (a.op === 'parallel') {
    if (!Array.isArray(a.requests) || a.requests.length < 2 || a.requests.length > 4) throw new Refused(`${where}: parallel needs 2–4 requests`);
    const sessions = new Set();
    a.requests.forEach((r, k) => {
      if (!r || r.op !== 'request') throw new Refused(`${where}.requests[${k}]: only request actions run in parallel`);
      if (r.delay_ms !== undefined && !(Number.isInteger(r.delay_ms) && r.delay_ms >= 0 && r.delay_ms <= 10000)) throw new Refused(`${where}.requests[${k}]: delay_ms must be 0..10000`);
      checkAction(r, `${where}.requests[${k}]`, rc, tcId);
      if (sessions.has(r.session)) throw new Refused(`${where}: parallel requests need different sessions`);
      sessions.add(r.session);
    });
  }
  if (a.op === 'goto') checkPath(a.path, where, rc);
  if (['click', 'fill', 'select', 'check_box'].includes(a.op)) checkTarget(a.target, where);
  if (a.op === 'press') { if (a.target) checkTarget(a.target, where); if (typeof a.key !== 'string' || !/^[A-Za-z0-9+]{1,30}$/.test(a.key)) throw new Refused(`${where}: press needs a key name`); }
  if (['fill', 'select'].includes(a.op)) { if (typeof a.value !== 'string') throw new Refused(`${where}: ${a.op} needs a text value`); checkTemplate(a.value, where); }
  if (a.op === 'wait') {
    if (a.ms !== undefined) { if (!(Number.isInteger(a.ms) && a.ms >= 0 && a.ms <= 10000)) throw new Refused(`${where}: wait ms must be 0..10000`); } else checkCondition(a.until, `${where}.until`, rc, SCREEN_CHECKS);
  }
  if (a.await_response !== undefined) {
    if (a.op !== 'click' && a.op !== 'press') throw new Refused(`${where}: await_response goes with click or press`);
    const r = a.await_response;
    if (!r || typeof r.path !== 'string' || !r.path.startsWith('/')) throw new Refused(`${where}: await_response needs a path`);
    if (r.method !== undefined && !/^[A-Z]{3,7}$/.test(r.method)) throw new Refused(`${where}: await_response method`);
  }
  if (a.capture !== undefined && a.op !== 'capture') {
    if (!a.await_response && a.op !== 'request') throw new Refused(`${where}: capture needs await_response (or a request op)`);
    if (!a.capture || typeof a.capture !== 'object' || Array.isArray(a.capture)) throw new Refused(`${where}: capture must map names to json:<path>`);
    for (const [k, v] of Object.entries(a.capture)) {
      if (!NAME_RE.test(k) || typeof v !== 'string' || !/^json:[A-Za-z0-9_.[\]=,-]+$/.test(v)) throw new Refused(`${where}: capture ${k} must be json:<path>`);
    }
  }
  if (a.op === 'capture') {
    if (!NAME_RE.test(a.name || '')) throw new Refused(`${where}: capture needs a name`);
    const kinds = ['db', 'text', 'url_regex'].filter(k => a[k] !== undefined);
    if (kinds.length !== 1) throw new Refused(`${where}: capture needs one of db, text, url_regex`);
    if (a.db !== undefined) { if (typeof a.db !== 'string') throw new Refused(`${where}: db must be a json path`); checkTemplate(a.db, where); }
    if (a.text !== undefined) checkTarget(a.text, where);
    if (a.url_regex !== undefined) {
      if (typeof a.url_regex !== 'string' || a.url_regex.length > 100) throw new Refused(`${where}: url_regex must be a short pattern`);
      // no nested or stacked quantifiers, no backreferences (catastrophic backtracking)
      if (/\([^)]*[+*}][^)]*\)\s*[+*{]|[+*}]\s*[+*{]|\\[1-9]/.test(a.url_regex)) throw new Refused(`${where}: url_regex may not nest quantifiers or use backreferences`);
      try { new RegExp(a.url_regex); } catch { throw new Refused(`${where}: url_regex is not a regex`); }
    }
  }
  if (a.op === 'request') {
    if (!/^(GET|HEAD|POST|PUT|PATCH|DELETE)$/.test(a.method || '')) throw new Refused(`${where}: request method`);
    checkPath(a.path, where, rc);
    if (typeof a.session !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/.test(a.session)) throw new Refused(`${where}: request needs a session name`);
    if (a.body !== undefined && (typeof a.body !== 'object' || a.body === null)) throw new Refused(`${where}: body must be a JSON object`);
    if (a.body !== undefined) JSON.stringify(a.body).replace(/"((?:[^"\\]|\\.)*)"/g, (m, s) => { checkTemplate(s, where); return m; });
    if (a.save_as !== undefined && !NAME_RE.test(a.save_as)) throw new Refused(`${where}: save_as must be a name`);
  }
}

function checkRecording(rc, rec, { requireCurrent = true } = {}) {
  if (!rec || typeof rec !== 'object' || rec.schema !== 1) throw new Refused('recording must have "schema": 1');
  const { tc, digest, tcFile } = tcOf(rc, rec);
  if (requireCurrent && rec.tc_digest !== digest) throw new Refused(`${rec.tc}: recording is for other TC text (tc_digest) — record it again`);
  if (rec.status !== undefined && rec.status !== 'candidate') throw new Refused('a recording\'s status is "candidate" — acceptance is recorded only by tc-replay.js run --verify');
  if (rec.session !== undefined && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/.test(rec.session)) throw new Refused('session must be a short name');
  if (rec.start_path !== undefined) checkPath(rec.start_path, 'start_path', rc);
  const login = rec.login === undefined ? [] : rec.login;
  if (tc.surface === 'api') {
    const screenOps = ['goto', 'click', 'fill', 'press', 'select', 'check_box', 'wait', 'new_tab'];
    const acts = [...(Array.isArray(login) ? login : []), ...(Array.isArray(rec.steps) ? rec.steps.flatMap(x => (x && Array.isArray(x.actions) ? x.actions : [])) : [])];
    if (acts.some(a => a && screenOps.includes(a.op))) throw new Refused(`${rec.tc} is an api TC — use request actions, not screen actions`);
    if ((rec.expected || []).some(e => e && (e.judge || (e.check && SCREEN_CHECKS.includes(e.check.op))))) throw new Refused(`${rec.tc} is an api TC — no screen checks or Jev judging`);
  }
  if (!Array.isArray(login) || login.length > MAX_ACTIONS) throw new Refused('login must be a list of actions');
  login.forEach((a, i) => checkAction(a, `login[${i}]`, rc, rec.tc));
  for (const k of ['setup', 'teardown']) {
    if (rec[k] === undefined) continue;
    if (!Array.isArray(rec[k]) || rec[k].length > MAX_HOOKS) throw new Refused(`${k} must be a list of up to ${MAX_HOOKS} command actions`);
    rec[k].forEach((a, i) => { if (!a || a.op !== 'command') throw new Refused(`${k}[${i}]: only command actions`); checkAction(a, `${k}[${i}]`, rc, rec.tc); });
  }
  const steps = Array.isArray(tc.steps) ? tc.steps : [];
  if (!Array.isArray(rec.steps) || rec.steps.length !== steps.length) throw new Refused(`${rec.tc}: steps must have one entry per TC step (${steps.length})`);
  rec.steps.forEach((s, i) => {
    if (!s || s.step !== i) throw new Refused(`steps[${i}].step must be ${i}`);
    if (!Array.isArray(s.actions) || s.actions.length > MAX_ACTIONS) throw new Refused(`steps[${i}].actions must be a list (≤ ${MAX_ACTIONS})`);
    s.actions.forEach((a, j) => checkAction(a, `steps[${i}].actions[${j}]`, rc, rec.tc));
    if (s.done_when !== undefined) checkCondition(s.done_when, `steps[${i}].done_when`, rc, [...SCREEN_CHECKS, 'api']);
  });
  const exp = Array.isArray(tc.expected) ? tc.expected : [];
  if (!Array.isArray(rec.expected) || rec.expected.length !== exp.length) throw new Refused(`${rec.tc}: expected must have one entry per TC expected result (${exp.length})`);
  const seen = new Set();
  for (const e of rec.expected) {
    if (!e || !Number.isInteger(e.index) || e.index < 0 || e.index >= exp.length || seen.has(e.index)) throw new Refused(`${rec.tc}: expected index ${e && e.index} is missing, repeated or out of range`);
    seen.add(e.index);
    const where = `expected[${e.index}]`;
    const ch = exp[e.index].observe && exp[e.index].observe.channel;
    const kinds = ['check', 'judge', 'not_observable'].filter(k => e[k] !== undefined);
    if (kinds.length !== 1) throw new Refused(`${where}: give exactly one of check, judge, not_observable`);
    if (e.judge !== undefined) {
      if (e.judge !== 'jev') throw new Refused(`${where}: judge must be "jev"`);
      if (!['dom', 'ax-node'].includes(ch)) throw new Refused(`${where}: only a screen (dom / ax-node) result can be judged by Jev — channel is ${ch}`);
      if (e.region !== undefined && (typeof e.region !== 'string' || e.region.length > 200)) throw new Refused(`${where}: region must be a CSS selector`);
      if (e.item !== undefined) checkTemplate(e.item, where);
    } else if (e.not_observable !== undefined) {
      if (e.not_observable !== true) throw new Refused(`${where}: not_observable must be true`);
    } else {
      const allowed = ['dom', 'ax-node'].includes(ch) ? SCREEN_CHECKS : DATA_CHECKS[ch];
      if (!allowed) throw new Refused(`${where}: channel ${ch} cannot be checked by replay — use not_observable`);
      if (!allowed.includes(e.check && e.check.op)) throw new Refused(`${where}: channel ${ch} needs a ${allowed.join(' / ')} check, not ${e.check && e.check.op}`);
      checkCondition(e.check, where, rc, allowed);
    }
  }
  if (rec.urls !== undefined && (!Array.isArray(rec.urls) || rec.urls.some(u => typeof u !== 'string' || !u.startsWith('/')))) throw new Refused('urls must be a list of paths');
  const base = rec.invariants_baseline || {};
  for (const k of ['http', 'console']) if (base[k] !== undefined && (!Array.isArray(base[k]) || base[k].some(x => typeof x !== 'string'))) throw new Refused(`invariants_baseline.${k} must be a list of texts`);
  return { tc, digest, tcFile };
}

// ── replay ───────────────────────────────────────────────────────────────

class Blocked extends Error {}

function locator(page, t, scope) {
  const r = v => resolve(v, scope);
  let l;
  if (t.role) l = page.getByRole(t.role, t.name !== undefined ? { name: r(t.name), exact: t.exact !== false } : {});
  else if (t.label) {
    const name = String(r(t.label));
    l = page.getByLabel(name, { exact: t.exact !== false });
    // a <label> that wraps its control also carries the control's text ("StatusAllFailure"),
    // so an exact label match misses it; the browser's accessible name leaves that text out
    if (t.exact !== false) for (const role of FORM_ROLES) l = l.or(page.getByRole(role, { name, exact: true }));
  }
  else if (t.text) l = page.getByText(r(t.text), { exact: t.exact === true });
  else if (t.placeholder) l = page.getByPlaceholder(r(t.placeholder), { exact: t.exact !== false });
  else if (t.test_id) l = page.getByTestId(r(t.test_id));
  else l = page.locator(r(t.selector));
  return t.nth !== undefined ? l.nth(t.nth) : l;
}

function compare(c, actual, scope) {
  const k = COMPARE_KEYS.find(x => c[x] !== undefined);
  const want = Array.isArray(c[k]) ? c[k].map(v => resolve(v, scope)) : resolve(c[k], scope);
  const pick = list => (c.field ? list.map(x => (x && typeof x === 'object' ? x[c.field] : undefined)) : list);
  if (k === 'in' || k === 'not_in') {
    if (!Array.isArray(want)) throw new Error(`${k}: the captured value is not a list`);
    const hit = pick(want).some(v => String(v) === String(actual));
    return k === 'in' ? hit : !hit;
  }
  if (k === 'all_equals') return Array.isArray(actual) && actual.length > 0 && pick(actual).every(v => String(v) === String(want));
  if (k === 'excludes') return !String(actual).includes(String(want));
  if (k === 'equals') {
    if (typeof want === 'number' || typeof actual === 'number') return Number(actual) === Number(want);
    if (typeof want === 'object' || typeof actual === 'object') return JSON.stringify(actual) === JSON.stringify(want);
    return String(actual) === String(want);
  }
  if (k === 'includes') return String(actual).includes(String(want));
  return String(actual).startsWith(String(want));
}

async function screenOnce(page, c, scope) {
  if (c.op === 'url_path') { const p = new URL(page.url()).pathname; return { ok: compare(c, p, scope), observed: p }; }
  if (c.op === 'url') { const u = new URL(page.url()); const p = u.pathname + u.search; return { ok: compare(c, p, scope), observed: p }; }
  const first = () => locator(page, c.target, scope).first();
  if (c.op === 'count') { const n = await locator(page, c.target, scope).count(); return { ok: n === c.equals, observed: `${n}` }; }
  if (c.op === 'visible') { const v = await first().isVisible(); return { ok: v, observed: v ? 'visible' : 'not visible' }; }
  if (c.op === 'hidden') { const v = await first().isVisible(); return { ok: !v, observed: v ? 'visible' : 'hidden' }; }
  if (c.op === 'enabled' || c.op === 'disabled') {
    const n = await first().count();
    if (!n) return { ok: false, observed: 'not found' };
    const e = await first().isEnabled();
    return { ok: c.op === 'enabled' ? e : !e, observed: e ? 'enabled' : 'disabled' };
  }
  // "every matching cell reads X": all_equals compares the text of every match, not just the first
  if (c.op === 'text' && c.all_equals !== undefined) {
    const all = (await locator(page, c.target, scope).allInnerTexts()).map(x => x.trim().replace(/\s+/g, ' '));
    if (!all.length) return { ok: false, observed: 'not found' };
    return { ok: compare(c, all, scope), observed: JSON.stringify(all).slice(0, 300) };
  }
  const el = first();
  if (!(await el.count())) return { ok: false, observed: 'not found' };
  const v = c.op === 'value' ? await el.inputValue() : (await el.innerText()).trim().replace(/\s+/g, ' ');
  return { ok: compare(c, v, scope), observed: v.slice(0, 300) };
}

async function screenCheck(page, c, scope, timeout = CHECK_TIMEOUT) {
  const end = Date.now() + timeout;
  let last = { ok: false, observed: '' };
  for (;;) {
    try { last = await screenOnce(page, c, scope); } catch (e) { last = { ok: false, observed: `error: ${String(e.message).split('\n')[0].slice(0, 120)}` }; }
    if (last.ok || Date.now() > end) return last;
    await page.waitForTimeout(150);
  }
}

async function dataCheck(rc, c, scope) {
  if (c.op === 'api') {
    if (c.request) await syncSession(rc, scope, c.request.session);
    const r = c.request
      ? await api.request({ runFile: rc.runFile, session: c.request.session, method: c.request.method, p: String(resolve(c.request.path, scope)), env: scope.env })
      : scope.responses[c.response];
    if (!r) return { ok: false, observed: `no response saved as ${c.response}` };
    if (c.status !== undefined && r.status !== c.status) return { ok: false, observed: `status=${r.status}` };
    if (c.header !== undefined) {
      const v = (r.headers || {})[c.header.toLowerCase()];
      return { ok: v !== undefined && compare(c, v, scope), observed: v === undefined ? `no ${c.header} header` : `${c.header}: ${String(v).slice(0, 300)}` };
    }
    if (c.json_path === undefined) return { ok: true, observed: `status=${r.status}` };
    const v = api.jsonPath(r.json, resolve(c.json_path, scope));
    return { ok: v.found && compare(c, v.value, scope), observed: v.found ? JSON.stringify(v.value).slice(0, 300) : 'not found' };
  }
  if (c.op === 'db') {
    const out = api.readSource({ runFile: rc.runFile, source: c.source || 'db', jsonPathExpr: resolve(c.json_path, scope), count: c.count !== undefined });
    if (c.count !== undefined) { const want = Number(resolve(c.count, scope)); return { ok: out.count === want, observed: `count=${out.count} (want ${want})` }; }
    return { ok: out.found && compare(c, out.value, scope), observed: out.found ? JSON.stringify(out.value).slice(0, 300) : 'not found' };
  }
  const out = api.readSource({ runFile: rc.runFile, source: c.source || 'log', grep: c.grep.map(g => String(resolve(g, scope))) });
  const n = (out.lines || []).length;
  return { ok: n === c.equals, observed: `${n} line(s)` };
}

// Runs a run-file command without a shell: <node|bash|sh|python3> <project script> <plain args>,
// in the project root (node is this very Node binary; the others are found on PATH).
// Variables that make an interpreter run other code first are dropped.
const COMMAND_ENV_DROP = /^(?:BASH_ENV|ENV|PYTHONPATH|PYTHONSTARTUP|PYTHONHOME|PYTHONINSPECT|NODE_OPTIONS|NODE_PATH|PERL5OPT|LD_PRELOAD|LD_LIBRARY_PATH)$/;
function runCommand(rc, tcId, name, where) {
  const { interpreter, script, args } = commandOf(rc, tcId, name, where);
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !COMMAND_ENV_DROP.test(k)));
  const argv = interpreter === 'python3' ? ['-B', script, ...args] : [script, ...args];   // -B: no .pyc written into the project
  return new Promise((resolve, reject) => {
    execFile(interpreter === 'node' ? process.execPath : interpreter, argv, { cwd: rc.root, env, timeout: COMMAND_TIMEOUT, maxBuffer: 1 << 20 }, err => (err ? reject(new Blocked(`command_failed:${where}`)) : resolve()));
  });
}

// A request under the recording's own session uses the browser's login (cookies),
// so a reset server (sessions gone) does not leave the api session signed out.
async function syncSession(rc, scope, session) {
  if (!scope.ctx || session !== scope.session) return;
  const jar = {};
  for (const c of await scope.ctx.cookies(rc.base.origin)) jar[c.name] = c.value;
  sw.writePrivate(api.sessionFile(rc.runFile, session), JSON.stringify(jar));
}

async function doAction(page, rc, a, scope, where) {
  const loc = t => locator(page, t, scope).first();
  const need = async t => {
    const l = loc(t);
    try { await l.waitFor({ state: 'visible', timeout: STEP_TIMEOUT }); } catch { throw new Blocked(`locator_missing:${where}`); }
    return l;
  };
  if (a.op === 'goto') { await page.goto(api.targetUrl(rc.base, String(resolve(a.path, scope))).toString(), { waitUntil: 'load', timeout: 15000 }); return; }
  if (a.op === 'wait') { if (a.ms !== undefined) await page.waitForTimeout(a.ms); else { const r = await screenCheck(page, a.until, scope, STEP_TIMEOUT); if (!r.ok) throw new Blocked(`wait_failed:${where}`); } return; }
  if (a.op === 'capture') {
    if (a.db !== undefined) { const out = api.readSource({ runFile: rc.runFile, source: 'db', jsonPathExpr: resolve(a.db, scope) }); scope.cap[a.name] = out.found ? out.value : null; }
    else if (a.text !== undefined) scope.cap[a.name] = (await (await need(a.text)).innerText()).trim();
    else { const m = new RegExp(a.url_regex).exec(new URL(page.url()).pathname.slice(0, 2000)); scope.cap[a.name] = m ? (m[1] !== undefined ? m[1] : m[0]) : null; }
    return;
  }
  if (a.op === 'request') {
    let bodyFile;
    if (a.body !== undefined) {
      const fill = v => (typeof v === 'string' ? resolve(v, scope) : Array.isArray(v) ? v.map(fill) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)])) : v);
      bodyFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tc-replay-')), 'body.json');
      fs.writeFileSync(bodyFile, JSON.stringify(fill(a.body)), { mode: 0o600 });
    }
    try {
      await syncSession(rc, scope, a.session);
      const r = await api.request({ runFile: rc.runFile, session: a.session, method: a.method, p: String(resolve(a.path, scope)), bodyFile, env: scope.env });
      if (a.save_as) scope.responses[a.save_as] = r;
      for (const [k, v] of Object.entries(a.capture || {})) { const x = api.jsonPath(r.json, v.slice(5)); scope.cap[k] = x.found ? x.value : null; }
    } finally { if (bodyFile) fs.rmSync(path.dirname(bodyFile), { recursive: true, force: true }); }
    return;
  }
  const waitResp = a.await_response
    ? page.waitForResponse(r => new URL(r.url()).pathname.startsWith(a.await_response.path) && (!a.await_response.method || r.request().method() === a.await_response.method), { timeout: STEP_TIMEOUT }).catch(() => null)
    : null;
  if (a.op === 'click') await (await need(a.target)).click({ timeout: STEP_TIMEOUT });
  else if (a.op === 'fill') await (await need(a.target)).fill(String(resolve(a.value, scope)), { timeout: STEP_TIMEOUT });
  else if (a.op === 'select') await (await need(a.target)).selectOption(String(resolve(a.value, scope)), { timeout: STEP_TIMEOUT });
  else if (a.op === 'check_box') await (await need(a.target)).check({ timeout: STEP_TIMEOUT });
  else if (a.op === 'press') { if (a.target) await (await need(a.target)).press(a.key); else await page.keyboard.press(a.key); }
  if (waitResp) {
    const r = await waitResp;
    if (r && a.capture) {
      let json = null;
      try { json = await r.json(); } catch { /* not JSON */ }
      for (const [k, v] of Object.entries(a.capture)) { const x = api.jsonPath(json, v.slice(5)); scope.cap[k] = x.found ? x.value : null; }
    }
  }
}

async function observation(page, rc, rec, tc, e, scope) {
  const region = e.region || 'main';
  const loc = page.locator(region).first();
  const has = await loc.count().catch(() => 0);
  const target = has ? loc : page.locator('body');
  let ax = '';
  try { ax = await target.ariaSnapshot(); } catch { ax = ''; }
  const text = ((await target.innerText().catch(() => '')) || '').slice(0, 8000);
  const alerts = await page.locator('[role=alert], [role=status], #toast').allInnerTexts().catch(() => []);
  return {
    tc: rec.tc, index: e.index, channel: tc.expected[e.index].observe.channel, expected: tc.expected[e.index].text,
    ...(tc.expected[e.index].observe.question_id ? { question_id: tc.expected[e.index].observe.question_id } : {}),
    ...(e.item !== undefined ? { item: String(resolve(e.item, scope)) } : {}),
    observation: { url: page.url(), title: await page.title().catch(() => ''), last_effect: 'replayed steps',
      alerts: alerts.map(a => api.maskTokens(a.trim(), scope.secrets)).filter(Boolean).slice(0, 10), loading: false,
      ax: api.maskTokens(ax.slice(0, 8000), scope.secrets), text: api.maskTokens(text, scope.secrets) },
    secret_env: [...scope.allowedEnv], project: path.basename(rc.root), plan: path.basename(rc.dir),
  };
}

function normConsole(s) {
  return String(s).replace(/https?:\/\/\S+/g, '<url>').replace(/\d+/g, '#').slice(0, 200);
}

async function replayTc(browser, rc, rec, tc, runId, opts) {
  const scope = { data: ((rc.run.tcs || {})[rec.tc] || {}).data || {}, cap: Object.create(null), responses: Object.create(null), env: opts.env, allowedEnv: allowedEnv(rc.run), secrets: [] };
  const surfaceScreen = tc.surface !== 'api';
  const seen = { http: new Set(), console: new Set(), pageErrors: [], visited: new Set() };
  let ctx = null;
  let page = null;
  let blocked = null;
  seen.inflight = 0;
  const watchPage = p => {
    p.on('request', () => { seen.inflight++; });
    p.on('requestfinished', () => { seen.inflight = Math.max(0, seen.inflight - 1); });
    p.on('requestfailed', () => { seen.inflight = Math.max(0, seen.inflight - 1); });
    p.on('response', r => { if (r.status() >= 400) { try { seen.http.add(`${r.request().method()} ${sw.normPath(new URL(r.url()).pathname)} ${r.status()}`); } catch { /* bad url */ } } });
    p.on('console', m => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) seen.console.add(normConsole(m.text())); });
    p.on('pageerror', e => seen.pageErrors.push(String(e.message).slice(0, 200)));
    p.on('framenavigated', f => { if (f === p.mainFrame()) { try { seen.visited.add(new URL(f.url()).pathname); } catch { /* about:blank */ } } });
  };
  if (surfaceScreen) {
    ({ ctx, blocked } = await sw.openContext(browser, rc, {}));
    scope.ctx = ctx;
    scope.session = rec.session;
    page = await ctx.newPage();
    watchPage(page);
  }
  // command / new_tab / parallel need the TC's run-file entry or the context; the rest is doAction
  const act = async (a, where) => {
    if (a.op === 'command') return runCommand(rc, rec.tc, a.name, where);
    if (a.op === 'new_tab') {
      page = await ctx.newPage();   // same cookies and localStorage, fresh sessionStorage
      watchPage(page);
      if (a.path !== undefined) await doAction(page, rc, { op: 'goto', path: a.path }, scope, where);
      return undefined;
    }
    if (a.op === 'parallel') {
      await Promise.all(a.requests.map(async r => {
        if (r.delay_ms) await new Promise(res => setTimeout(res, r.delay_ms));
        await doAction(page, rc, r, scope, where);
      }));
      return undefined;
    }
    return doAction(page, rc, a, scope, where);
  };
  let failedAt;
  let result = null;
  try {
    for (const [i, a] of (rec.setup || []).entries()) await act(a, `setup${i}`);
    for (const [i, a] of (rec.login || []).entries()) await act(a, `login${i}`);
    if (surfaceScreen && rec.session && (rec.login || []).length) await sw.saveState(ctx, rc, rec.session);
    if (surfaceScreen && rec.start_path) await doAction(page, rc, { op: 'goto', path: rec.start_path }, scope, 'start');
    for (const s of rec.steps) {
      for (const [j, a] of s.actions.entries()) await act(a, `${s.step}.${j}`);
      if (s.done_when) {
        const ok = s.done_when.op === 'api' ? (await dataCheck(rc, s.done_when, scope)).ok : (await screenCheck(page, s.done_when, scope, STEP_TIMEOUT)).ok;
        if (!ok) { failedAt = s.step; break; }
      }
    }
    const expected = [];
    const pending = [];
    for (const e of [...rec.expected].sort((x, y) => x.index - y.index)) {
      if (e.not_observable) { expected.push({ index: e.index, verdict: 'NOT_OBSERVABLE', judged_by: 'code', observed: 'not observable by replay' }); continue; }
      if (e.check) {
        let r;
        try { r = SCREEN_CHECKS.includes(e.check.op) ? await screenCheck(page, e.check, scope) : await dataCheck(rc, e.check, scope); } catch (err) { r = { ok: false, observed: `error: ${String(err.message).split('\n')[0].slice(0, 160)}` }; }
        expected.push({ index: e.index, verdict: r.ok ? 'PASS' : 'FAIL', judged_by: 'code', observed: api.maskTokens(String(r.observed), scope.secrets) });
        continue;
      }
      const obs = await observation(page, rc, rec, tc, e, scope);
      const dir = sw.privateDir(path.join(rc.dir, 'obs', rec.tc, runId));
      const obsFile = path.join(dir, `${e.index}.json`);
      sw.writePrivate(obsFile, JSON.stringify(obs, null, 2));
      const j = await jj.judge(obs, { config: opts.jevConfig, env: opts.env });
      const extra = { jev_ms: Number.isFinite(j.ms) ? j.ms : undefined, jev_tokens: j.usage ? (j.usage.input_tokens || 0) + (j.usage.output_tokens || 0) : undefined };
      if ((j.verdict === 'PASS' || j.verdict === 'FAIL') && j.judged_by === 'jev' && !j.audit) expected.push({ index: e.index, verdict: j.verdict, judged_by: 'jev', observed: `jev ${j.verdict}`, ...extra });
      else pending.push({ index: e.index, obs_file: obsFile, jev: { verdict: j.verdict, audit: !!j.audit, sample: j.sample, status: j.status }, ...extra });
    }
    // let requests the page already started finish, so their errors count (at most 3 s;
    // a live connection never "finishes", so it only delays up to the cap)
    if (page) {
      const end = Date.now() + 3000;
      let quietSince = Date.now();
      while (Date.now() < end) {
        if (seen.inflight > 0) quietSince = Date.now();
        else if (Date.now() - quietSince >= 500) break;
        await page.waitForTimeout(100);
      }
    }
    // invariants against what the tester accepted when recording
    const base = rec.invariants_baseline || {};
    const okHttp = new Set((base.http || []).map(h => { const [m, p, s] = h.split(' '); return `${m} ${sw.normPath(p || '')} ${s}`; }));
    const okConsole = new Set((base.console || []).map(normConsole));
    const newHttp = [...seen.http].filter(h => !okHttp.has(h));
    const bad = [...newHttp, ...[...seen.console].filter(c => !okConsole.has(c)).map(c => `console: ${c}`), ...seen.pageErrors.map(e => `pageerror: ${e}`)];
    // sweep the screens this TC visited, once per run
    let sweep;
    if (surfaceScreen && opts.sweep) {
      const done = sw.readSweep(rc, runId).urls || {};
      const todo = [...seen.visited].filter(u => !done[u]);
      if (todo.length) {
        const res = {};
        const { ctx: sctx } = await sw.openContext(browser, rc, { session: rec.session, blockMutations: true });
        try {
          await sctx.addCookies(await ctx.cookies());
          if (process.env.CC_SWEEP_DEBUG === '1') process.stderr.write(`[replay] sweep todo ${JSON.stringify(todo)}\n`);
          for (const u of todo) res[u] = await sw.sweepUrl(sctx, rc, u);
        } catch (e) {
          for (const u of todo) if (!res[u]) res[u] = { status: 'error', error: String(e.message).split('\n')[0].slice(0, 200), fail: [], skipped: [], clicked: 0 };
        } finally { await sctx.close().catch(() => {}); }
        sw.mergeSweep(rc, runId, res);
      }
      const all = sw.readSweep(rc, runId).urls || {};
      const failed = [...seen.visited].filter(u => all[u] && all[u].status !== 'clean');   // an errored sweep is not a clean one
      sweep = failed.length ? 'fail' : 'clean';
      if (failed.length) scope.sweepFail = failed;
    }
    result = {
      expected, pending, failedAt, visited: [...seen.visited],
      invariants: surfaceScreen ? (bad.length ? 'fail' : 'clean') : undefined, invariants_detail: bad.slice(0, 10),
      sweep, sweep_fail: scope.sweepFail,
      blocked_offsite: blocked ? [...new Set(blocked.offsite)] : [],
    };
    return result;
  } finally {
    // teardown runs whatever happened (it puts shared state back, e.g. a fake server's mode);
    // a failed one is reported on the result, never hidden
    const tdFailed = [];
    for (const [i, a] of (rec.teardown || []).entries()) {
      try { await runCommand(rc, rec.tc, a.name, `teardown${i}`); } catch { tdFailed.push(a.name); }
    }
    if (tdFailed.length && result) result.teardown_failed = tdFailed;
    if (ctx) await ctx.close().catch(() => {});
  }
}

function resultEntry(rec, runId, r) {
  return {
    tc: rec.tc, run_id: runId, expected: r.expected, browser_tool: 'replay', fallback_reason: 'recorded replay (tc-replay.js)',
    ...(Number.isInteger(r.failedAt) ? { failed_at_step: r.failedAt } : {}),
    ...(r.invariants ? { invariants: r.invariants } : {}), ...(r.invariants_detail && r.invariants_detail.length ? { invariants_detail: r.invariants_detail } : {}),
    ...(r.sweep ? { sweep: r.sweep } : {}), ...(r.sweep_fail ? { sweep_fail: r.sweep_fail } : {}),
    ...(r.teardown_failed ? { teardown_failed: r.teardown_failed } : {}),
  };
}

// A replay failed when an expected result is FAIL or a step's done_when did not hold
// (pending Jev results have no verdict yet).
function failed(r) {
  return Number.isInteger(r.failedAt) || r.expected.some(e => e.verdict === 'FAIL');
}

// Both sides FAILed one code check: the tester's observed value must start with the value
// the replay read; a note after it (space, "(", ";" or ",") is allowed. The replay cuts long
// values at 300 characters, so a cut value only has to be a prefix.
function observedMatches(tester, replay) {
  const norm = v => String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim();
  const t = norm(tester);
  const r = norm(replay);
  if (t === r) return true;
  if (!r || !t.startsWith(r)) return false;
  return String(replay).length >= 300 || /^[ (;,]/.test(t.slice(r.length));
}

// For a sweep before any replay round: run a recording's login steps once in a fresh context and
// keep the browser state (cookies and localStorage) as replay-state/<session>.json (replacing the
// state saved for that session).
async function saveLoginState(browser, rc, tcId, env = process.env) {
  const rec = readRecording(rc, tcId);
  if (!rec) throw new Refused(`--login-from: no recording for ${tcId}`);
  if (rec.tc !== tcId) throw new Refused(`--login-from: the recording for ${tcId} names another TC`);
  // not yet accepted is fine (the first round sweeps before any verify), but it must match the TC text
  checkRecording(rc, rec, { requireCurrent: true });
  if (typeof rec.session !== 'string' || !Array.isArray(rec.login) || !rec.login.length) throw new Refused(`--login-from: ${tcId} has no session and login steps`);
  const scope = { data: ((rc.run.tcs || {})[rec.tc] || {}).data || {}, cap: Object.create(null), responses: Object.create(null), env, allowedEnv: allowedEnv(rc.run), secrets: [] };
  const { ctx } = await sw.openContext(browser, rc, {});
  try {
    scope.ctx = ctx;
    scope.session = rec.session;
    const page = await ctx.newPage();
    for (const [i, a] of rec.login.entries()) {
      if (!['goto', 'click', 'fill', 'press', 'select', 'check_box', 'wait'].includes(a.op)) throw new Refused(`--login-from: login step ${i} (${a.op}) is not a screen action`);
      await doAction(page, rc, a, scope, `login${i}`);
    }
    await sw.saveState(ctx, rc, rec.session);
    return rec.session;
  } finally { await ctx.close().catch(() => {}); }
}

function pendingFile(rc, runId) {
  return path.join(sw.privateDir(path.join(rc.dir, 'replay-pending')), `${runId}.json`);
}

async function run({ runFile, runId, tcs, verify = false, retryRejected = false, env = process.env, sweep = true }) {
  const rc = sw.runContext(runFile);
  if (typeof runId !== 'string' || !RUN_ID_RE.test(runId)) throw new Refused('--run-id must look like 20261118T093000Z (letters, digits, . _ -)');
  if (!Array.isArray(tcs) || !tcs.length) throw new Refused('--tcs needs at least one TC id');
  const results = path.join(rc.dir, 'tc-results.jsonl');
  const out = [];
  const plan = [];
  for (const id of tcs) {
    let rec;
    try { rec = readRecording(rc, id); } catch (e) { out.push({ tc: id, outcome: 'fallback', reason: 'bad_recording', detail: e.message }); continue; }
    if (!rec) { out.push({ tc: id, outcome: 'fallback', reason: 'no_recording' }); continue; }
    if (rec.tc !== id) { out.push({ tc: id, outcome: 'fallback', reason: 'bad_recording', detail: 'the recording names another TC' }); continue; }
    let info;
    try { info = checkRecording(rc, rec, { requireCurrent: false }); } catch (e) { out.push({ tc: id, outcome: 'fallback', reason: 'bad_recording', detail: e.message }); continue; }
    if (rec.tc_digest !== info.digest) { out.push({ tc: id, outcome: 'fallback', reason: 'stale' }); continue; }
    const acc = acceptance(rc, rec);
    if (!verify && acc.status !== 'accepted') { out.push({ tc: id, outcome: 'fallback', reason: acc.status === 'rejected' ? 'rejected' : 'not_accepted' }); continue; }
    if (verify && !retryRejected && acc.status === 'rejected') { out.push({ tc: id, outcome: 'fallback', reason: 'rejected' }); continue; }
    plan.push({ rec, info });
  }
  if (!plan.length) return { run_id: runId, verify, tcs: out };
  const loaded = plan.some(p => p.info.tc.surface !== 'api') ? sw.loadPlaywright(env) : { pw: null };
  if (!loaded) { for (const p of plan) out.push({ tc: p.rec.tc, outcome: 'fallback', reason: 'no_browser' }); return { run_id: runId, verify, tcs: out }; }
  const browser = loaded.pw ? await loaded.pw.chromium.launch({ headless: true }) : null;
  const jevConfig = loadConfig({ env });
  const tester = verify ? jj_lines(results).filter(l => l.run_id === runId && l.browser_tool !== 'replay') : [];
  const pend = {};
  try {
    for (const { rec, info } of plan) {
      let r;
      try { r = await replayTc(browser, rc, rec, info.tc, verify ? `${runId}-verify` : runId, { env, jevConfig, sweep: sweep && !verify }); } catch (e) {
        out.push({ tc: rec.tc, outcome: 'fallback', reason: e instanceof Blocked ? e.message : 'error', detail: e instanceof Blocked ? undefined : String(e.message).split('\n')[0].slice(0, 200) });
        continue;
      }
      if (verify) {
        const t = tester.filter(l => l.tc === rec.tc).pop();
        const mismatch = [];
        if (!t) mismatch.push('no tester line for this run id');
        else {
          const te = new Map((t.expected || []).map(e => [e.index, e]));
          for (const e of r.expected) {
            const x = te.get(e.index) || {};
            if (x.verdict !== e.verdict) mismatch.push(`expected[${e.index}] tester ${x.verdict} replay ${e.verdict}`);
            else if (e.verdict === 'FAIL' && e.judged_by === 'code' && x.judged_by === 'code' && !observedMatches(x.observed, e.observed)) {
              mismatch.push(`expected[${e.index}] both FAIL, observed tester ${JSON.stringify(String(x.observed === undefined ? '' : x.observed).slice(0, 120))} replay ${JSON.stringify(String(e.observed).slice(0, 120))}`);
            }
          }
          if ((Number.isInteger(t.failed_at_step) ? t.failed_at_step : null) !== (Number.isInteger(r.failedAt) ? r.failedAt : null)) mismatch.push(`failed_at_step tester ${t.failed_at_step} replay ${r.failedAt}`);
          if (t.invariants && r.invariants && t.invariants !== r.invariants) mismatch.push(`invariants tester ${t.invariants} replay ${r.invariants}`);
        }
        if (r.blocked_offsite.length && failed(r)) mismatch.push(`replay blocked ${r.blocked_offsite.join(', ')} — add them to browser_origins or keep this TC with testers`);
        // Jev REVIEW results could not be compared: accepted on the code verdicts, listed as unverified
        const unverified = r.pending.map(q => q.index);
        const store = readAccepted(rc);
        store[rec.tc] = { status: mismatch.length ? 'rejected' : 'accepted', digest: contentDigest(rec), run_id: runId, at: new Date().toISOString(),
          ...(mismatch.length ? { mismatch } : {}), ...(unverified.length ? { unverified } : {}), urls: r.visited };
        sw.writePrivate(acceptFile(rc), JSON.stringify(store, null, 2) + '\n');
        out.push({ tc: rec.tc, outcome: store[rec.tc].status, ...(mismatch.length ? { mismatch } : {}), ...(unverified.length ? { unverified } : {}) });
        continue;
      }
      // a failure the replay itself may have caused: no line, a tester runs this TC
      if (r.blocked_offsite.length && failed(r)) { out.push({ tc: rec.tc, outcome: 'fallback', reason: `blocked_offsite:${r.blocked_offsite.join(',')}` }); continue; }
      const entry = resultEntry(rec, runId, r);
      if (r.pending.length) {
        pend[rec.tc] = { entry, tc_file: info.tcFile, pending: r.pending };
        out.push({ tc: rec.tc, outcome: 'pending', pending: r.pending.map(p => ({ index: p.index, obs_file: p.obs_file, jev: p.jev })) });
        continue;
      }
      jj.record({ results, tcFile: info.tcFile, entry });
      out.push({ tc: rec.tc, outcome: 'recorded', verdicts: r.expected.map(e => `${e.index}:${e.verdict}`).join(' '), ...(Number.isInteger(r.failedAt) ? { failed_at_step: r.failedAt } : {}), ...(r.invariants === 'fail' ? { invariants: 'fail' } : {}), ...(r.sweep === 'fail' ? { sweep: 'fail' } : {}), ...(r.teardown_failed ? { teardown_failed: r.teardown_failed } : {}) });
    }
  } finally {
    if (browser) await browser.close();
  }
  if (Object.keys(pend).length) {
    const f = pendingFile(rc, runId);
    let prev = {};
    try { prev = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* none */ }
    sw.writePrivate(f, JSON.stringify({ ...prev, ...pend }, null, 2));
  }
  return { run_id: runId, verify, tcs: out };
}

function jj_lines(file) {
  try { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; }
}

// verdicts file: { "<tc id>": { "<index>": { "verdict": "PASS|FAIL|NOT_OBSERVABLE", "judged_by": "llm|jev", "audit": "agree"?, "jev_disputed": true? } } }
function finish({ runFile, runId, verdictsFile }) {
  const rc = sw.runContext(runFile);
  if (typeof runId !== 'string' || !RUN_ID_RE.test(runId)) throw new Refused('--run-id must look like 20261118T093000Z');
  const f = pendingFile(rc, runId);
  let pend;
  try { pend = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { throw new Refused(`nothing pending for ${runId}`); }
  let given;
  try { given = JSON.parse(fs.readFileSync(verdictsFile, 'utf8')); } catch (e) { throw new Refused(`--verdicts must be a JSON file: ${e.message}`); }
  const results = path.join(rc.dir, 'tc-results.jsonl');
  const done = [];
  for (const [tc, p] of Object.entries(pend)) {
    const v = given[tc];
    if (!v) continue;
    const add = [];
    for (const q of p.pending) {
      const x = v[q.index];
      if (!x || !['PASS', 'FAIL', 'NOT_OBSERVABLE'].includes(x.verdict) || !['llm', 'jev'].includes(x.judged_by)) throw new Refused(`${tc} expected[${q.index}] needs { verdict, judged_by: llm|jev }`);
      add.push({ index: q.index, verdict: x.verdict, judged_by: x.judged_by, observed: `${x.judged_by} from ${path.relative(rc.root, q.obs_file)}`,
        ...(x.audit ? { audit: String(x.audit) } : {}), ...(x.jev_disputed ? { jev_disputed: true } : {}),
        ...(q.jev_ms !== undefined ? { jev_ms: q.jev_ms } : {}), ...(q.jev_tokens !== undefined ? { jev_tokens: q.jev_tokens } : {}) });
    }
    const entry = { ...p.entry, expected: [...p.entry.expected, ...add].sort((a, b) => a.index - b.index) };
    jj.record({ results, tcFile: p.tc_file, entry });
    delete pend[tc];
    done.push(tc);
  }
  sw.writePrivate(f, JSON.stringify(pend, null, 2));
  return { run_id: runId, recorded: done, still_pending: Object.keys(pend) };
}

function urls({ runFile, tcs }) {
  const rc = sw.runContext(runFile);
  const dir = path.join(rc.dir, 'replay');
  const ids = tcs && tcs.length ? tcs : (fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)) : []);
  const set = new Set();
  for (const id of ids) {
    const rec = readRecording(rc, id);
    if (!rec) continue;
    const a = acceptance(rc, rec);
    for (const u of [...(Array.isArray(rec.urls) ? rec.urls : []), ...(Array.isArray(a.urls) ? a.urls : [])]) if (typeof u === 'string' && u.startsWith('/') && !u.includes(':')) set.add(u);
  }
  return { urls: [...set] };
}

const USAGE = 'usage: tc-replay.js check --run <tc-run.json> --tc <id>\n' +
  '       tc-replay.js run --run <tc-run.json> --run-id <id> --tcs <id,…> [--verify [--retry-rejected]] [--no-sweep]\n' +
  '       tc-replay.js finish --run <tc-run.json> --run-id <id> --verdicts <json file>\n' +
  '       tc-replay.js urls --run <tc-run.json> [--tcs <id,…>]';

async function main(argv) {
  const [cmd, ...rest] = argv.slice(2);
  const spec = {
    check: { values: ['--run', '--tc'] },
    run: { values: ['--run', '--run-id', '--tcs'], flags: ['--verify', '--retry-rejected', '--no-sweep'] },
    finish: { values: ['--run', '--run-id', '--verdicts'] },
    urls: { values: ['--run', '--tcs'] },
  }[cmd];
  if (!spec) { console.error(USAGE); return 2; }
  let opts;
  try { ({ opts } = parseArgs(rest, spec)); } catch (e) { console.error(`tc-replay: ${e.message}\n${USAGE}`); return 2; }
  if (!opts['--run']) { console.error(USAGE); return 2; }
  const list = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
  try {
    let out;
    if (cmd === 'check') {
      const rc = sw.runContext(opts['--run']);
      const rec = readRecording(rc, opts['--tc']);
      if (!rec) throw new Refused(`no recording for ${opts['--tc']}`);
      if (rec.tc !== opts['--tc']) throw new Refused('the recording names another TC than its file name');
      const { tc } = checkRecording(rc, rec);
      out = { tc: rec.tc, ok: true, steps: rec.steps.length, expected: rec.expected.length, surface: tc.surface, acceptance: acceptance(rc, rec).status };
    } else if (cmd === 'run') {
      out = await run({ runFile: opts['--run'], runId: opts['--run-id'], tcs: list(opts['--tcs']), verify: !!opts['--verify'], retryRejected: !!opts['--retry-rejected'], sweep: !opts['--no-sweep'] });
    } else if (cmd === 'finish') {
      if (!opts['--verdicts']) throw new Refused('--verdicts is required');
      out = finish({ runFile: opts['--run'], runId: opts['--run-id'], verdictsFile: opts['--verdicts'] });
    } else out = urls({ runFile: opts['--run'], tcs: list(opts['--tcs']) });
    console.log(JSON.stringify(out));
    return 0;
  } catch (e) {
    console.error(`tc-replay: ${e.message}`);
    return e instanceof Refused ? 2 : 1;
  }
}

if (require.main === module) main(process.argv).then(c => { process.exitCode = c; });

module.exports = { checkRecording, contentDigest, readAccepted, run, finish, urls, resolve, checkTemplate, saveLoginState, ACTION_OPS, COMMAND_ENV_DROP };
