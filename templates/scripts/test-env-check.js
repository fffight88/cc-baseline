#!/usr/bin/env node
'use strict';

// Checks a project's test environment before the first e2e round
// (memory/reference_test_env.md §8), so CSP, host and command problems show up
// before testers spend a round on them.
//
//   node test-env-check.js --run <…/.cc-audits/<slug>/tc-run.json> [--json]
//
// Checks (each ok / warn / fail with a reason):
//   base_url        — answers GET /; not loopback (with api_remote_ok) is a warning
//   host            — redirects of /, test_login_path and every start_path stay on
//                     base_url's host and port (cookies are per host: localhost and
//                     127.0.0.1 do not share them); a Set-Cookie Domain for another
//                     host is a warning
//   csp             — the page's Content-Security-Policy connect-src (else default-src)
//                     allows every browser_origins origin
//   browser_origins — well-formed (the rule replays and sweeps use)
//   reset_command   — `node <project script> <plain args>` and the script exists (never run)
//   test_login_path — when set, does not answer 404 (the test login is switched on);
//                     requested once, and only on a loopback base_url (it signs in)
//   external_stubs  — every fake external API server is on loopback and answers
// It writes nothing and requests only base_url and the external_stubs URLs, with GET,
// reading redirects instead of following them off the base origin. The CSP is read
// from / only.
// Prints one line per check, then one JSON line (--json: the JSON line only).
// Exit 0 = no fail, 1 = a check failed, 2 = refused / usage, 3 = unexpected error.

const fs = require('fs');
const path = require('path');
const { parseArgs } = require('./jev-client');
const api = require('./tc-api-run');
const sw = require('./tc-sweep');

const { Refused } = api;
const LOOPBACK = ['127.0.0.1', 'localhost', '[::1]', '::1'];
const TIMEOUT_MS = 10000;
const MAX_REDIRECTS = 5;
const ARG_RE = /^[A-Za-z0-9._=:,@/+-]+$/;
const ENV_NAME_RE = /^[A-Z_][A-Z0-9_]*$/;

async function get(url) {
  return fetch(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
}

function cut(s, n = 160) { return String(s).split('\n')[0].slice(0, n); }

// ── CSP ──────────────────────────────────────────────────────────────────

// Does one CSP source expression allow `origin` (a URL origin string)? 'self' is base.
function sourceAllows(src, origin, base) {
  const s = src.trim();
  if (!s) return false;
  if (s === "'self'") return origin === base.origin;
  if (s.startsWith("'")) return false;                     // 'none', nonces, hashes, 'unsafe-*'
  const o = new URL(origin);
  if (s === '*') return ['http:', 'https:', 'ws:', 'wss:'].includes(o.protocol);
  const scheme = /^([a-z][a-z0-9+.-]*):$/i.exec(s);
  if (scheme) return o.protocol === `${scheme[1].toLowerCase()}:`;
  const m = /^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*\.)?([^/:]+)(?::(\d+|\*))?(?:\/.*)?$/i.exec(s);
  if (!m) return false;
  const [, sch, wild, host, port] = m;
  if (sch && `${sch.toLowerCase()}:` !== o.protocol) return false;
  if (!sch && o.protocol !== base.protocol && !(base.protocol === 'http:' && o.protocol === 'https:')) return false;
  const h = host.toLowerCase();
  if (wild ? !o.hostname.endsWith(`.${h}`) : o.hostname !== h) return false;
  if (port === '*') return true;
  const want = port || (o.protocol === 'https:' ? '443' : '80');
  return (o.port || (o.protocol === 'https:' ? '443' : '80')) === want;
}

// Origins (of `origins`) that some policy in the header blocks for fetch / XHR.
function cspBlocked(header, origins, base) {
  const blocked = new Set();
  for (const policy of String(header).split(',')) {
    const dirs = new Map();
    for (const d of policy.split(';')) {
      const parts = d.trim().split(/\s+/).filter(Boolean);
      if (parts.length && !dirs.has(parts[0].toLowerCase())) dirs.set(parts[0].toLowerCase(), parts.slice(1));
    }
    const list = dirs.get('connect-src') || dirs.get('default-src');
    if (!list) continue;
    for (const o of origins) if (!list.some(s => sourceAllows(s, o, base))) blocked.add(o);
  }
  return [...blocked];
}

// ── checks ───────────────────────────────────────────────────────────────

function resetCheck(run, root) {
  const cmd = run.reset_command;
  if (cmd === undefined) return { status: 'warn', detail: 'no reset_command — replay rounds are not used (manager guide §2-C)' };
  if (typeof cmd !== 'string') return { status: 'fail', detail: 'reset_command must be a string' };
  const parts = cmd.trim().split(/\s+/);
  if (parts[0] !== 'node' || parts.length < 2) return { status: 'fail', detail: 'reset_command must be `node <project script> <plain args>`' };
  const bad = parts.slice(1).find(a => !ARG_RE.test(a));
  if (bad !== undefined) return { status: 'fail', detail: `reset_command has shell syntax or quoting: ${JSON.stringify(cut(bad, 40))}` };
  const script = parts[1];
  if (path.isAbsolute(script) || script.split('/').includes('..')) return { status: 'fail', detail: 'reset_command script must be a path inside the project' };
  const full = path.join(root, script);
  let real;
  try { real = fs.realpathSync(full); } catch { return { status: 'fail', detail: `reset_command script ${script} does not exist` }; }
  if (real !== root && !real.startsWith(root + path.sep)) return { status: 'fail', detail: 'reset_command script resolves outside the project' };
  return { status: 'ok', detail: cmd.trim() };
}

// Returns the check and the first status each path answered (so no path is requested twice).
async function hostCheck(run, base, { withLogin }) {
  const paths = ['/'];
  if (withLogin) paths.push(run.test_login_path);
  for (const t of Object.values(run.tcs && typeof run.tcs === 'object' ? run.tcs : {})) {
    if (t && typeof t.start_path === 'string') paths.push(t.start_path);
  }
  const fails = [];
  const warns = [];
  const first = {};
  for (const p of [...new Set(paths)]) {
    let url;
    try { url = api.targetUrl(base, p); } catch (e) { fails.push(`${p}: ${e.message}`); continue; }
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      let res;
      try { res = await get(url); } catch (e) { fails.push(`${p}: no answer from ${url.origin} (${cut(e.message, 60)})`); break; }
      if (hop === 0) first[p] = res.status;
      const cookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
      for (const c of cookies) {
        const d = /;\s*domain=([^;]+)/i.exec(c);
        if (d && d[1].trim().replace(/^\./, '').toLowerCase() !== base.hostname) warns.push(`${p}: a cookie is set for domain ${d[1].trim()}, not ${base.hostname}`);
      }
      const loc = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
      if (!loc) break;
      let next;
      try { next = new URL(loc, url); } catch { fails.push(`${p}: bad redirect ${cut(loc, 80)}`); break; }
      if (next.origin === base.origin) { url = next; continue; }
      if (LOOPBACK.includes(next.hostname)) fails.push(`${p} redirects to ${next.origin}, not ${base.origin} — cookies set on one host are not sent to the other; use one host everywhere`);
      break;   // an off-site redirect (an identity provider) is not followed
    }
  }
  const out = fails.length ? { status: 'fail', detail: fails.slice(0, 5).join('; ') }
    : warns.length ? { status: 'warn', detail: [...new Set(warns)].slice(0, 5).join('; ') }
      : { status: 'ok', detail: `${new Set(paths).size} path(s) stay on ${base.origin}` };
  return { check: out, first };
}

async function stubsCheck(run) {
  const list = run.external_stubs;
  if (list === undefined) return null;
  if (!Array.isArray(list) || !list.length || list.length > 10) return { status: 'fail', detail: 'external_stubs must be a list of 1–10 { name, url, env }' };
  const fails = [];
  const names = [];
  for (const s of list) {
    if (!s || typeof s.name !== 'string' || typeof s.url !== 'string') { fails.push('each entry needs name, url and env'); continue; }
    if (typeof s.env !== 'string' || !ENV_NAME_RE.test(s.env)) { fails.push(`${s.name}: env must name the env var that points the app at the fake server`); continue; }
    let u;
    try { u = new URL(s.url); } catch { fails.push(`${s.name}: url is not a URL`); continue; }
    if (!['http:', 'https:'].includes(u.protocol) || !LOOPBACK.includes(u.hostname)) { fails.push(`${s.name}: ${u.origin} is not on loopback — a fake server runs locally`); continue; }
    try { await get(u.toString()); names.push(s.name); } catch (e) { fails.push(`${s.name}: no answer from ${u.origin} (${cut(e.message, 60)})`); }
  }
  if (fails.length) return { status: 'fail', detail: fails.slice(0, 5).join('; ') };
  return { status: 'ok', detail: `faked external APIs (say so in the report): ${names.join(', ')}` };
}

async function check({ runFile }) {
  const run = api.loadRun(runFile);
  const root = fs.realpathSync(api.projectRoot(runFile));
  const base = api.baseOrigin(run);   // refuses a non-loopback base_url without api_remote_ok
  const checks = [];
  const add = (name, r) => { if (r) checks.push({ name, ...r }); };

  let page = null;
  try {
    page = await get(api.targetUrl(base, '/'));
    add('base_url', LOOPBACK.includes(base.hostname)
      ? { status: 'ok', detail: `${base.origin} answered ${page.status}` }
      : { status: 'warn', detail: `${base.origin} is not loopback (api_remote_ok) — use a local test server where you can` });
  } catch (e) {
    add('base_url', { status: 'fail', detail: `no answer from ${base.origin} (${cut(e.message, 80)}) — start the app first` });
  }

  let origins = [];
  try { origins = sw.browserOrigins(run); add('browser_origins', { status: 'ok', detail: origins.length ? origins.join(', ') : 'none' }); } catch (e) { add('browser_origins', { status: 'fail', detail: e.message }); }

  if (page) {
    const csp = page.headers.get('content-security-policy');
    if (!csp) add('csp', { status: 'ok', detail: 'no Content-Security-Policy on /' });
    else {
      const blocked = cspBlocked(csp, origins, base);
      add('csp', blocked.length
        ? { status: 'fail', detail: `the app's CSP blocks ${blocked.join(', ')} — browser code cannot reach it; read the host from env in the CSP` }
        : { status: 'ok', detail: origins.length ? 'connect-src allows every browser origin' : 'no browser_origins to check' });
    }
  }
  const loginPath = typeof run.test_login_path === 'string' ? run.test_login_path : null;
  // requesting the test login signs in: only on a local test server
  const withLogin = !!loginPath && LOOPBACK.includes(base.hostname);
  let first = {};
  if (page) { const h = await hostCheck(run, base, { withLogin }); add('host', h.check); first = h.first; }

  add('reset_command', resetCheck(run, root));

  if (run.test_login_path !== undefined) {
    if (!loginPath) add('test_login_path', { status: 'fail', detail: 'test_login_path must be a path' });
    else if (!withLogin) add('test_login_path', { status: 'warn', detail: `not requested: ${base.origin} is not loopback and the test login signs in` });
    else if (first[loginPath] === undefined) add('test_login_path', { status: 'fail', detail: `${loginPath} gave no answer (see host)` });
    else {
      add('test_login_path', first[loginPath] === 404
        ? { status: 'fail', detail: `${loginPath} answers 404 — the test login is off here (flag env, test backend)` }
        : { status: 'ok', detail: `${loginPath} answered ${first[loginPath]}; check by hand that production answers 404` });
    }
  }

  add('external_stubs', await stubsCheck(run));

  return { checks, fail: checks.filter(c => c.status === 'fail').length, warn: checks.filter(c => c.status === 'warn').length };
}

const USAGE = 'usage: test-env-check.js --run <…/.cc-audits/<slug>/tc-run.json> [--json]';

async function main(argv) {
  let opts;
  try { ({ opts } = parseArgs(argv.slice(2), { values: ['--run'], flags: ['--json'] })); } catch (e) { console.error(`test-env-check: ${e.message}\n${USAGE}`); return 2; }
  if (!opts['--run']) { console.error(USAGE); return 2; }
  try {
    const out = await check({ runFile: opts['--run'] });
    if (!opts['--json']) for (const c of out.checks) console.log(`${c.status.padEnd(5)} ${c.name.padEnd(16)} ${c.detail}`);
    console.log(JSON.stringify(out));
    return out.fail ? 1 : 0;
  } catch (e) {
    console.error(`test-env-check: ${e.message}`);
    return e instanceof Refused ? 2 : 3;
  }
}

if (require.main === module) main(process.argv).then(c => { process.exitCode = c; });

module.exports = { check, cspBlocked, sourceAllows, resetCheck };
