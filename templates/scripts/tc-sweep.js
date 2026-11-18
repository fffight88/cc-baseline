#!/usr/bin/env node
'use strict';

// Dead-control sweep (e2e-tester §0-B, in code) and the browser helpers that
// tc-replay.js shares.
//
//   node tc-sweep.js --run <…/.cc-audits/<slug>/tc-run.json> --run-id <id> --urls </a,/b> [--session <name>]
//
// For every URL: collect the visible, enabled clickable elements, then open the
// URL fresh for each one, click it and look for one effect — navigation, popup,
// request started, DOM change or dialog. No effect, or a page error during the
// click, is a dead control (`fail`). Controls that appear after a click (toasts,
// dialogs) are clicked right away too. Requests other than GET / HEAD are aborted,
// so a sweep never changes data (starting the request still counts as an effect).
// Destructive-looking controls are not clicked (`skipped`). Only base_url's origin
// is opened. Login: the replay state `.cc-audits/<slug>/replay-state/<session>.json`
// if present, else the tc-api-run.js cookie jar of that session.
// Output: `.cc-audits/<slug>/sweep/<run_id>/<url>.json` (one file per URL, 0600) and one JSON line.
// Exit 0 = done, 1 = error, 2 = refused / usage.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { parseArgs } = require('./jev-client');
const api = require('./tc-api-run');

const { Refused } = api;
const RUN_ID_RE = /^[0-9A-Za-z][0-9A-Za-z._-]{0,39}$/;
const SESSION_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
const DESTRUCTIVE_RE = /\b(?:delete|remove|log\s*out|logout|sign\s*out|pay|pay\s*now|purchase|approve|buy|unsubscribe|deactivate|reset)\b|삭제|제거|로그아웃|결제|승인|탈퇴|구매|초기화/i;
const CLICKABLE = 'a[href], button, [role=button], [role=link], [role=tab], [role=menuitem], [role=checkbox], [role=switch], input[type=button], input[type=submit], input[type=checkbox], input[type=radio], summary, [onclick]';
const MAX_CONTROLS = 60;
const SETTLE_MS = 500;

// ── browser module and contexts (shared with tc-replay.js) ───────────────

function loadPlaywright(env = process.env) {
  const tries = [];
  if (env.CC_BASELINE_PLAYWRIGHT) tries.push(env.CC_BASELINE_PLAYWRIGHT);
  tries.push('playwright');
  const roots = [path.join(os.homedir(), '.npm-global', 'lib', 'node_modules')];
  try { roots.unshift(execFileSync('npm', ['root', '-g'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim()); } catch { /* npm missing */ }
  for (const r of roots) tries.push(path.join(r, '@playwright', 'mcp', 'node_modules', 'playwright'), path.join(r, 'playwright'));
  for (const t of tries) {
    try { const pw = require(t); if (pw && pw.chromium) return { pw, from: t }; } catch { /* next */ }
  }
  return null;
}

function runContext(runFile) {
  const run = api.loadRun(runFile);
  const root = fs.realpathSync(api.projectRoot(runFile));
  const dir = path.dirname(fs.realpathSync(path.resolve(runFile)));
  return { runFile, run, root, dir, base: api.baseOrigin(run) };
}

function privateDir(dir) {
  try { if (fs.lstatSync(dir).isSymbolicLink()) throw new Refused(`${dir} must not be a symlink`); } catch (e) { if (e instanceof Refused) throw e; }
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  return dir;
}

function writePrivate(file, text) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, text, { mode: 0o600, flag: 'wx' });
  fs.renameSync(tmp, file);
}

function stateFile(rc, session) {
  if (typeof session !== 'string' || !SESSION_RE.test(session)) throw new Refused('session must be a short name (letters, digits, _ -)');
  const f = path.join(privateDir(path.join(rc.dir, 'replay-state')), `${session}.json`);
  try { if (fs.lstatSync(f).isSymbolicLink()) throw new Refused(`${f} must not be a symlink`); } catch (e) { if (e instanceof Refused) throw e; }
  return f;
}

// Opens a context limited to base_url's origin. `blockMutations` also aborts
// every request that is not GET / HEAD (the sweep). Returns the context and a
// record of what was blocked.
async function openContext(browser, rc, { session, blockMutations = false } = {}) {
  const opts = { baseURL: rc.base.origin, ignoreHTTPSErrors: false, serviceWorkers: 'block' };
  let useJar = false;
  if (session) {
    // the newer of the two logins wins: a replay's saved state, or the tc-api-run.js session
    const sf = stateFile(rc, session);
    const jf = api.sessionFile(rc.runFile, session);
    const mt = f => { try { return fs.statSync(f).mtimeMs; } catch { return -1; } };
    if (mt(sf) >= 0 && mt(sf) >= mt(jf)) opts.storageState = sf; else useJar = mt(jf) >= 0;
  }
  const ctx = await browser.newContext(opts);
  if (useJar) {
    const jar = api.readCookies(api.sessionFile(rc.runFile, session));
    const cookies = Object.entries(jar).map(([name, value]) => ({ name, value: String(value), url: rc.base.origin }));
    if (cookies.length) await ctx.addCookies(cookies);
  }
  const blocked = { offsite: [], mutations: 0 };
  if (typeof ctx.routeWebSocket === 'function') {
    await ctx.routeWebSocket(/.*/, ws => {
      let u;
      try { u = new URL(ws.url()); } catch { return ws.close(); }
      const same = (u.protocol === 'ws:' ? 'http:' : 'https:') + '//' + u.host === rc.base.origin;
      if (!same || blockMutations) { if (blocked.offsite.length < 20) blocked.offsite.push(`ws ${u.host}`); return ws.close(); }
      return ws.connectToServer();
    });
  }
  await ctx.route('**/*', route => {
    const req = route.request();
    let u;
    try { u = new URL(req.url()); } catch { return route.abort(); }
    if (u.origin !== rc.base.origin) { if (blocked.offsite.length < 20) blocked.offsite.push(u.origin); return route.abort(); }
    if (blockMutations && !['GET', 'HEAD'].includes(req.method())) { blocked.mutations++; return route.abort(); }
    return route.continue();
  });
  return { ctx, blocked };
}

async function saveState(ctx, rc, session) {
  const sf = stateFile(rc, session);
  const state = await ctx.storageState();
  writePrivate(sf, JSON.stringify(state));
  return sf;
}

// Path with id-like segments generalised, so /orders/ORD-1 and /orders/ORD-2 match.
function normPath(p) {
  return String(p).split('/').map(s => (/\d/.test(s) ? ':id' : s)).join('/');
}

// ── sweep ────────────────────────────────────────────────────────────────

// In-page: number the visible, enabled clickables and describe them.
function listControls(page) {
  return page.evaluate(({ sel, max }) => {
    const out = [];
    const els = [...document.querySelectorAll(sel)];
    for (const el of els) {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || st.visibility === 'hidden' || st.display === 'none') continue;
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
      const name = (el.getAttribute('aria-label') || el.innerText || el.value || el.title || '').trim().replace(/\s+/g, ' ').slice(0, 80);
      const href = el.tagName === 'A' ? el.getAttribute('href') || '' : '';
      el.setAttribute('data-cc-sweep', String(out.length));
      const base = `${el.tagName.toLowerCase()}|${name}|${href}`;
      const n = out.filter(o => o.base === base).length;   // same-looking controls (row buttons) each get swept
      out.push({ key: `${base}#${n}`, base, tag: el.tagName.toLowerCase(), name, href });
      if (out.length >= max) break;
    }
    return out;
  }, { sel: CLICKABLE, max: MAX_CONTROLS });
}

async function watch(page) {
  await page.evaluate(sel => {
    window.__ccSweep = { mutations: 0, added: [] };
    const obs = new MutationObserver(list => {
      for (const m of list) {
        if (m.type === 'attributes' && m.attributeName === 'data-cc-sweep') continue;
        window.__ccSweep.mutations++;
        for (const n of m.addedNodes || []) {
          if (n.nodeType !== 1) continue;
          const found = n.matches(sel) ? [n] : [...n.querySelectorAll(sel)];
          for (const el of found) {
            const name = (el.getAttribute('aria-label') || el.innerText || el.value || el.title || '').trim().replace(/\s+/g, ' ').slice(0, 80);
            const href = el.tagName === 'A' ? el.getAttribute('href') || '' : '';
            const i = `late-${window.__ccSweep.added.length}`;
            el.setAttribute('data-cc-sweep', i);
            window.__ccSweep.added.push({ key: `${el.tagName.toLowerCase()}|${name}|${href}`, tag: el.tagName.toLowerCase(), name, id: i });
          }
        }
      }
    });
    obs.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
  }, CLICKABLE);
}

// Click one control and report whether anything happened.
async function clickAndSee(page, ctx, selector, startUrl) {
  const events = { requests: 0, popup: false, dialog: false, errors: [] };
  const onReq = () => { events.requests++; };
  const onPopup = p => { events.popup = true; p.close().catch(() => {}); };
  const onDialog = d => { events.dialog = true; d.dismiss().catch(() => {}); };
  const onErr = e => { events.errors.push(String(e && e.message || e).slice(0, 200)); };
  page.on('request', onReq);
  ctx.on('page', onPopup);
  page.on('dialog', onDialog);
  page.on('pageerror', onErr);
  let clickError = null;
  try {
    await page.click(selector, { timeout: 2000, noWaitAfter: true });
  } catch (e) { clickError = String(e.message || e).split('\n')[0].slice(0, 160); }
  await page.waitForTimeout(SETTLE_MS);
  page.off('request', onReq);
  ctx.off('page', onPopup);
  page.off('dialog', onDialog);
  page.off('pageerror', onErr);
  let mutations = 0;
  let added = [];
  try { ({ mutations, added } = await page.evaluate(() => window.__ccSweep || { mutations: 0, added: [] })); } catch { /* navigated away */ }
  const navigated = page.url() !== startUrl;
  const effect = navigated || events.popup || events.dialog || events.requests > 0 || mutations > 0;
  return { effect, navigated, clickError, errors: events.errors, added };
}

async function sweepUrl(ctx, rc, urlPath) {
  const target = api.targetUrl(rc.base, urlPath).toString();
  const page = await ctx.newPage();
  const result = { status: 'clean', fail: [], skipped: [], clicked: 0 };
  try {
    const open = async () => {
      await page.goto(target, { waitUntil: 'load', timeout: 15000 });
      await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(200);
      const list = await listControls(page);
      await watch(page);
      return list;
    };
    const first = await open();
    const seen = new Set();
    const known = new Set(first.map(c => c.base));   // a re-render of these is not a new control
    const judgeOne = async (c, selector) => {
      // a control that is disabled or covered right now is not judged (not a dead control)
      const state = await page.$eval(selector, el => ({ disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true' })).catch(() => null);
      if (!state) { result.skipped.push({ control: c.name || c.tag, reason: 'gone (re-rendered)' }); return { added: [] }; }
      if (state.disabled) { result.skipped.push({ control: c.name || c.tag, reason: 'disabled' }); return { added: [] }; }
      const r = await clickAndSee(page, ctx, selector, page.url());
      if (r.clickError && !r.effect) { result.skipped.push({ control: c.name || c.tag, reason: `not clickable: ${r.clickError}` }); return r; }
      result.clicked++;
      const dead = r.errors.some(e => /ReferenceError|TypeError/.test(e)) || !r.effect;
      if (dead) result.fail.push({ control: c.name || c.tag, tag: c.tag, reason: r.errors.length ? r.errors[0] : 'no effect' });
      return r;
    };
    for (let i = 0; i < first.length; i++) {
      const c = first[i];
      if (seen.has(c.key)) continue;
      seen.add(c.key);
      if (DESTRUCTIVE_RE.test(c.name) || DESTRUCTIVE_RE.test(c.href)) { result.skipped.push({ control: c.name || c.tag, reason: 'destructive' }); continue; }
      const list = await open();
      const same = list[i] && list[i].key === c.key ? i : list.findIndex(x => x.key === c.key);
      if (same < 0) continue;
      const r = await judgeOne(c, `[data-cc-sweep="${same}"]`);
      // controls that appeared after the click (toast buttons, dialogs): click them now —
      // unless the click moved to another view, whose controls belong to that page's sweep
      for (const a of r.navigated ? [] : r.added || []) {
        if (seen.has(a.key) || known.has(a.key)) continue;   // late controls are keyed without an occurrence index
        seen.add(a.key);
        if (DESTRUCTIVE_RE.test(a.name)) { result.skipped.push({ control: a.name || a.tag, reason: 'destructive' }); continue; }
        const exists = await page.$(`[data-cc-sweep="${a.id}"]`).catch(() => null);
        if (!exists) { result.skipped.push({ control: a.name || a.tag, reason: 'transient-missed' }); continue; }
        try { await watch(page); } catch { /* page gone */ }
        await judgeOne(a, `[data-cc-sweep="${a.id}"]`);
      }
    }
  } catch (e) {
    result.status = 'error';
    result.error = String(e.message || e).split('\n')[0].slice(0, 200);
  } finally {
    await page.close().catch(() => {});
  }
  if (result.status !== 'error' && result.fail.length) result.status = 'fail';
  return result;
}

// One file per URL (sweep/<run_id>/<base64url of the path>.json), so testers sweeping
// in parallel never overwrite each other's results.
function sweepDir(rc, runId) {
  if (typeof runId !== 'string' || !RUN_ID_RE.test(runId)) throw new Refused('--run-id must look like 20261118T093000Z (letters, digits, . _ -)');
  return path.join(privateDir(path.join(rc.dir, 'sweep')), runId);
}

function readSweep(rc, runId) {
  const dir = sweepDir(rc, runId);
  const urls = {};
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.json')); } catch { /* none yet */ }
  for (const f of files) {
    try { const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); if (r && typeof r.url === 'string') urls[r.url] = r; } catch { /* partial write */ }
  }
  return { run_id: runId, urls };
}

function mergeSweep(rc, runId, results) {
  const dir = privateDir(sweepDir(rc, runId));
  for (const [u, r] of Object.entries(results)) {
    writePrivate(path.join(dir, `${Buffer.from(u).toString('base64url')}.json`), JSON.stringify({ url: u, ...r, at: new Date().toISOString() }, null, 2) + '\n');
  }
  return readSweep(rc, runId);
}

async function sweep({ runFile, runId, urls, session, env = process.env }) {
  const rc = runContext(runFile);
  sweepDir(rc, runId);
  if (!Array.isArray(urls) || !urls.length) throw new Refused('--urls needs at least one path');
  for (const u of urls) api.targetUrl(rc.base, u);
  const loaded = loadPlaywright(env);
  if (!loaded) throw new Refused('no Playwright module found — install @playwright/mcp (cc-baseline doctor) or set CC_BASELINE_PLAYWRIGHT');
  const browser = await loaded.pw.chromium.launch({ headless: true });
  try {
    const { ctx, blocked } = await openContext(browser, rc, { session, blockMutations: true });
    const results = {};
    for (const u of urls) results[u] = await sweepUrl(ctx, rc, u);
    await ctx.close();
    mergeSweep(rc, runId, results);
    const fail = Object.entries(results).filter(([, r]) => r.status !== 'clean').map(([u]) => u);
    return { run_id: runId, urls: urls.length, fail, blocked_mutations: blocked.mutations, results };
  } finally {
    await browser.close();
  }
}

const USAGE = 'usage: tc-sweep.js --run <…/.cc-audits/<slug>/tc-run.json> --run-id <id> --urls </a,/b> [--session <name>]';

async function main(argv) {
  let opts;
  try { ({ opts } = parseArgs(argv.slice(2), { values: ['--run', '--run-id', '--urls', '--session'] })); } catch (e) { console.error(`tc-sweep: ${e.message}\n${USAGE}`); return 2; }
  if (!opts['--run'] || !opts['--run-id'] || !opts['--urls']) { console.error(USAGE); return 2; }
  try {
    const out = await sweep({ runFile: opts['--run'], runId: opts['--run-id'], urls: opts['--urls'].split(',').map(s => s.trim()).filter(Boolean), session: opts['--session'] });
    console.log(JSON.stringify(out));
    return 0;
  } catch (e) {
    console.error(`tc-sweep: ${e.message}`);
    return e instanceof Refused ? 2 : 1;
  }
}

if (require.main === module) main(process.argv).then(c => { process.exitCode = c; });

module.exports = { loadPlaywright, runContext, openContext, saveState, stateFile, sweepUrl, sweep, readSweep, mergeSweep, normPath, writePrivate, privateDir, DESTRUCTIVE_RE };
