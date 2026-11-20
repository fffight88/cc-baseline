#!/usr/bin/env node
'use strict';

// Dead-control sweep (e2e-tester §0-B, in code) and the browser helpers that
// tc-replay.js shares.
//
//   node tc-sweep.js --run <…/.cc-audits/<slug>/tc-run.json> --run-id <id> --urls </a,/b> [--session <name> | --login-from <TC id>]
//
// For every URL: collect the visible, enabled clickable elements, then open the
// URL fresh for each one, click it and look for one effect — navigation, popup,
// request started, DOM change, scroll, dialog or file picker. A control marked active
// (aria-pressed / -selected / -current) with no effect is skipped, not failed. Before each click the page is
// watched for BASELINE_MS: nodes, requests and scrollers that change on their own
// (animations, typing effects, polling) are noise and do not count. No effect, or a
// page error during the click, is a dead control (`fail`; on a noisy page the reason
// says so). A dialog that opens on load (a notice shown on every fresh tab) is
// dismissed first — Escape, else a close-like button in it — and reported as
// `startup_overlay`. Controls that appear after a click (toasts,
// dialogs) are clicked right away too. Requests other than GET / HEAD are aborted,
// so a sweep never changes data (starting the request still counts as an effect).
// Destructive-looking controls are not clicked (`skipped`). Only base_url's origin
// is opened. Login: the replay state `.cc-audits/<slug>/replay-state/<session>.json`
// if present, else the tc-api-run.js cookie jar of that session; --login-from <TC id> first
// runs that TC's recorded login steps and saves the state (works for localStorage tokens too).
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
const dbg = (...a) => { if (process.env.CC_SWEEP_DEBUG === '1') process.stderr.write(`[sweep ${new Date().toISOString().slice(11, 19)}] ${a.join(' ')}\n`); };
const SETTLE_MS = 500;
const BASELINE_MS = 600;             // watch before a click: what changes on its own is noise
const STEP_TIMEOUT_MS = 8000;        // any single in-page call
const URL_BUDGET_MS = 180000;        // one path: at least this long …
const PER_CONTROL_MS = 6000;         // … plus this per control (late ones too) …
const URL_BUDGET_MAX_MS = 600000;    // … but never more than this
const QUIET_MS = 500;                // no change on a new node for this long counts as "rendered"
const QUIET_MAX_MS = 3000;
const NETWORK_IDLE_MS = 1000;
const OVERLAY_WAIT_MS = 1500;        // how long a dialog that opens on load may take to appear
const OVERLAY_SEL = '[aria-modal="true"], dialog[open]';   // modal only: a cookie banner with role=dialog does not block the page
const CLOSE_RE = /^(?:close|dismiss|닫기|×|✕|✖|x|got it|ok|okay|확인|괜찮아요)$/i;

// A page call that never returns (a navigation racing an evaluate, a stuck
// renderer) must not stall the whole run.
function withTimeout(promise, ms, label) {
  let t;
  return Promise.race([promise, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${label} timed out after ${ms} ms`)), ms); })]).finally(() => clearTimeout(t));
}

// Wait until no node changes for the first time for QUIET_MS (client rendering /
// hydration done), at most QUIET_MAX_MS. A node that keeps changing (an animation)
// does not hold the wait. Apps with live connections never reach networkidle.
function settleDom(page) {
  return withTimeout(page.evaluate(({ quiet, max }) => new Promise(resolve => {
    let last = Date.now();
    const seen = new Set();
    const obs = new MutationObserver(list => {
      for (const m of list) {
        const t = m.target.nodeType === 1 ? m.target : m.target.parentElement;
        if (t && !seen.has(t)) { seen.add(t); last = Date.now(); }
        for (const n of m.addedNodes || []) if (n.nodeType === 1 && !seen.has(n)) { seen.add(n); last = Date.now(); }   // children streamed into one parent
      }
    });
    obs.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    const start = Date.now();
    const tick = () => {
      if (Date.now() - last >= quiet || Date.now() - start >= max) { obs.disconnect(); resolve(); } else setTimeout(tick, 100);
    };
    tick();
  }), { quiet: QUIET_MS, max: QUIET_MAX_MS }), QUIET_MAX_MS + 3000, 'settle').catch(() => {});
}

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

// Extra origins the app's own browser code must reach (e.g. its Supabase project),
// approved at planning and listed in the run file as "browser_origins".
function browserOrigins(run) {
  const list = run.browser_origins === undefined ? [] : run.browser_origins;
  if (!Array.isArray(list) || list.length > 10) throw new Refused('"browser_origins" must be a list of up to 10 origins');
  return list.map(o => {
    let u;
    try { u = new URL(o); } catch { throw new Refused(`browser_origins: ${o} is not a URL`); }
    if (u.protocol !== 'https:' || u.origin !== o.replace(/\/$/, '')) throw new Refused(`browser_origins: ${o} must be a bare https origin (https://host)`);
    return u.origin;
  });
}

function runContext(runFile) {
  const run = api.loadRun(runFile);
  const root = fs.realpathSync(api.projectRoot(runFile));
  const dir = path.dirname(fs.realpathSync(path.resolve(runFile)));
  const base = api.baseOrigin(run);
  return { runFile, run, root, dir, base, origins: new Set([base.origin, ...browserOrigins(run)]) };
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
      const same = rc.origins.has((u.protocol === 'ws:' ? 'http:' : 'https:') + '//' + u.host);
      // off-origin sockets are closed; the app's own socket (e.g. a dev server's hot reload) stays,
      // or client code may never finish starting up
      if (!same) { if (blocked.offsite.length < 20) blocked.offsite.push(`ws ${u.host}`); return ws.close(); }
      const server = ws.connectToServer();
      // a sweep must not write: server → page messages pass, page → server messages are dropped
      if (blockMutations) ws.onMessage(() => { blocked.ws_dropped = (blocked.ws_dropped || 0) + 1; });
      return server;
    });
  }
  await ctx.route('**/*', route => {
    const req = route.request();
    let u;
    try { u = new URL(req.url()); } catch { return route.abort(); }
    if (!rc.origins.has(u.origin)) { if (blocked.offsite.length < 20) blocked.offsite.push(u.origin); return route.abort(); }
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

// In-page recorder: which nodes changed, which elements scrolled, which clickables
// were added. mark() turns what changed so far into noise; result() reports what
// changed since then outside the noise.
async function watch(page) {
  await page.evaluate(sel => {
    const S = window.__ccSweep = { added: [], seq: 0, targets: new Set(), scrolls: new Set(), noisy: new Set(), noisyScroll: new Set() };
    const obs = new MutationObserver(list => {
      for (const m of list) {
        if (m.type === 'attributes' && m.attributeName === 'data-cc-sweep') continue;
        const t = m.target.nodeType === 1 ? m.target : m.target.parentElement;
        if (t) S.targets.add(t);
        for (const n of m.addedNodes || []) {
          if (n.nodeType !== 1) continue;
          const found = n.matches(sel) ? [n] : [...n.querySelectorAll(sel)];
          for (const el of found) {
            const name = (el.getAttribute('aria-label') || el.innerText || el.value || el.title || '').trim().replace(/\s+/g, ' ').slice(0, 80);
            const href = el.tagName === 'A' ? el.getAttribute('href') || '' : '';
            const i = `late-${S.seq++}`;   // never reset: an id may still be in the DOM
            el.setAttribute('data-cc-sweep', i);
            S.added.push({ key: `${el.tagName.toLowerCase()}|${name}|${href}`, tag: el.tagName.toLowerCase(), name, id: i });
          }
        }
      }
    });
    obs.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    document.addEventListener('scroll', e => { S.scrolls.add(e.target === document ? document.scrollingElement : e.target); }, true);
    S.reset = () => { S.targets = new Set(); S.scrolls = new Set(); S.added = []; };
    S.mark = () => { S.noisy = S.targets; S.noisyScroll = S.scrolls; S.reset(); };
    S.result = ctlSel => {
      const ctl = ctlSel ? document.querySelector(ctlSel) : null;
      // a noisy element covers its subtree, except the page roots and anything around the clicked
      // control — those only count as noise themselves, so their other descendants can still show an effect
      const roots = [...S.noisy].filter(n => n.isConnected && n !== document.documentElement && n !== document.body && !(ctl && n.contains(ctl)));
      const noise = t => S.noisy.has(t) || roots.some(r => r === t || r.contains(t));
      return {
        changed: [...S.targets].filter(t => !noise(t)).length,
        scrolled: [...S.scrolls].filter(x => !S.noisyScroll.has(x)).length,
        noise: S.noisy.size + S.noisyScroll.size,
        added: S.added,
      };
    };
  }, CLICKABLE);
}

function requestKey(req) {
  try { const u = new URL(req.url()); return `${req.method()} ${u.origin}${u.pathname}`; } catch { return `${req.method()} ?`; }
}

// In-page: the name of a visible dialog, or null.
function findOverlay(page) {
  return withTimeout(page.evaluate(sel => {
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || st.visibility === 'hidden' || st.display === 'none') continue;
      if (el.tagName === 'DIALOG' && !el.matches(':modal')) continue;
      const h = el.querySelector('h1, h2, h3, [role=heading]');
      return (el.getAttribute('aria-label') || (h && h.innerText) || el.tagName.toLowerCase()).trim().replace(/\s+/g, ' ').slice(0, 80);
    }
    return null;
  }, OVERLAY_SEL), STEP_TIMEOUT_MS, 'find dialog').catch(() => null);
}

// A dialog that opens on load: wait up to `waitMs` for it, then Escape, else one
// close-like (never destructive-looking) button inside it. Returns null when none.
async function dismissStartupOverlay(page, waitMs) {
  const end = Date.now() + waitMs;
  let name = await findOverlay(page);
  while (name === null && Date.now() < end) { await page.waitForTimeout(250); name = await findOverlay(page); }
  if (name === null) return null;
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(300);
  if (await findOverlay(page) === null) return { name, dismissed: true, by: 'escape' };
  const btn = await withTimeout(page.evaluate(({ sel, close, destructive }) => {
    const closeRe = new RegExp(close, 'i');
    const destRe = new RegExp(destructive, 'i');
    for (const d of document.querySelectorAll(sel)) {
      const r = d.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (d.tagName === 'DIALOG' && !d.matches(':modal')) continue;
      for (const el of d.querySelectorAll('button, [role=button], input[type=button]')) {
        const n = (el.getAttribute('aria-label') || el.innerText || el.value || el.title || '').trim().replace(/\s+/g, ' ');
        if (closeRe.test(n) && !destRe.test(n)) { el.setAttribute('data-cc-close', '1'); return n.slice(0, 80); }
      }
    }
    return null;
  }, { sel: OVERLAY_SEL, close: CLOSE_RE.source, destructive: DESTRUCTIVE_RE.source }), STEP_TIMEOUT_MS, 'find close').catch(() => null);
  if (btn !== null) {
    await page.click('[data-cc-close="1"]', { timeout: 2000, noWaitAfter: true }).catch(() => {});
    await page.waitForTimeout(300);
    if (await findOverlay(page) === null) return { name, dismissed: true, by: `button:${btn}` };
  }
  return { name, dismissed: false };
}

// Click one control and report whether anything happened.
async function clickAndSee(page, ctx, selector, startUrl) {
  const events = { requests: 0, popup: false, dialog: false, errors: [] };
  // baseline: what changes on its own right now is noise, not an effect of the click
  const quietReq = new Set();
  const onBase = r => quietReq.add(requestKey(r));
  page.on('request', onBase);
  try { await withTimeout(page.evaluate(() => window.__ccSweep && window.__ccSweep.reset()), STEP_TIMEOUT_MS, 'reset'); } catch { /* page gone */ }
  await page.waitForTimeout(BASELINE_MS);
  page.off('request', onBase);
  try { await withTimeout(page.evaluate(() => window.__ccSweep && window.__ccSweep.mark()), STEP_TIMEOUT_MS, 'mark'); } catch { /* page gone */ }
  const onReq = r => { if (!quietReq.has(requestKey(r))) events.requests++; };
  const onPopup = p => { events.popup = true; p.close().catch(() => {}); };
  const onDialog = d => { events.dialog = true; d.dismiss().catch(() => {}); };
  const onChooser = () => { events.dialog = true; };   // a file picker opened (nothing is chosen)
  const onErr = e => { events.errors.push(String(e && e.message || e).slice(0, 200)); };
  page.on('request', onReq);
  ctx.on('page', onPopup);
  page.on('dialog', onDialog);
  page.on('filechooser', onChooser);
  page.on('pageerror', onErr);
  let clickError = null;
  try {
    await page.click(selector, { timeout: 2000, noWaitAfter: true });
  } catch (e) { clickError = String(e.message || e).split('\n')[0].slice(0, 160); }
  await page.waitForTimeout(SETTLE_MS);
  page.off('request', onReq);
  ctx.off('page', onPopup);
  page.off('dialog', onDialog);
  page.off('filechooser', onChooser);
  page.off('pageerror', onErr);
  let seen = { changed: 0, scrolled: 0, noise: 0, added: [] };
  try { seen = await withTimeout(page.evaluate(sel => (window.__ccSweep ? window.__ccSweep.result(sel) : null), selector), STEP_TIMEOUT_MS, 'read effects') || seen; } catch { /* navigated away */ }
  const navigated = page.url() !== startUrl;
  const effect = navigated || events.popup || events.dialog || events.requests > 0 || seen.changed > 0 || seen.scrolled > 0;
  return { effect, navigated, clickError, errors: events.errors, added: seen.added, noise: seen.noise };
}

async function sweepUrl(ctx, rc, urlPath) {
  const target = api.targetUrl(rc.base, urlPath).toString();
  const page = await ctx.newPage();
  const result = { status: 'clean', fail: [], skipped: [], clicked: 0 };
  let overlayWait = OVERLAY_WAIT_MS;   // after the first open: wait only if a dialog opened then
  let saved = null;                    // cookies + localStorage as the first open left them
  try {
    const open = async () => {
      // a click may have saved state (language, theme, filters): start every open from the first one's
      if (saved) {
        await ctx.clearCookies().catch(() => {});
        if (saved.cookies.length) await ctx.addCookies(saved.cookies).catch(() => {});
        let here = null;
        try { here = new URL(page.url()).origin; } catch { /* about:blank */ }
        if (here === rc.base.origin && saved.origin === rc.base.origin) {
          await withTimeout(page.evaluate(items => { localStorage.clear(); for (const [k, v] of items) localStorage.setItem(k, v); }, saved.local), STEP_TIMEOUT_MS, 'restore').catch(() => {});
        }
      }
      dbg(urlPath, 'goto');
      await page.goto(target, { waitUntil: 'load', timeout: 15000 });
      dbg(urlPath, 'loaded', page.url());
      await page.waitForLoadState('networkidle', { timeout: NETWORK_IDLE_MS }).catch(() => {});
      await settleDom(page);
      const ov = await dismissStartupOverlay(page, overlayWait);
      if (!('startup_overlay' in result)) { result.startup_overlay = ov; overlayWait = ov ? OVERLAY_WAIT_MS : 0; } else if (!ov) overlayWait = 0;   // dismissed for good (stored state)
      if (ov) { dbg(urlPath, 'startup dialog', JSON.stringify(ov)); if (ov.dismissed) await settleDom(page); }
      if (!saved) {
        const local = await withTimeout(page.evaluate(() => Object.entries(localStorage)), STEP_TIMEOUT_MS, 'save').catch(() => []);
        let origin = null;
        try { origin = new URL(page.url()).origin; } catch { /* about:blank */ }
        saved = { cookies: await ctx.cookies().catch(() => []), local, origin };
      }
      dbg(urlPath, 'list');
      const list = await withTimeout(listControls(page), STEP_TIMEOUT_MS, 'list controls');
      await withTimeout(watch(page), STEP_TIMEOUT_MS, 'watch');
      dbg(urlPath, 'watching');
      return list;
    };
    const started = Date.now();
    const first = await open();
    dbg(urlPath, 'controls', first.length);
    // a page with many controls gets more time; a late control adds its share when it is queued
    let budget = Math.min(URL_BUDGET_MAX_MS, Math.max(URL_BUDGET_MS, PER_CONTROL_MS * first.length));
    let deadline = started + budget;
    const grow = () => { budget = Math.min(URL_BUDGET_MAX_MS, budget + PER_CONTROL_MS); deadline = started + budget; };
    const seen = new Set();
    const known = new Set(first.map(c => c.base));   // a re-render of these is not a new control
    const judgeOne = async (c, selector, retry) => {
      // a control that is disabled or covered right now is not judged (not a dead control)
      const state = await withTimeout(page.$eval(selector, el => {
        el.scrollIntoView({ block: 'center', inline: 'center' });
        const r = el.getBoundingClientRect();
        const x = Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1), y = Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1);
        const root = el.getRootNode && el.getRootNode().elementFromPoint ? el.getRootNode() : document;
        const top = root.elementFromPoint(x, y);
        // something else (a modal backdrop, an overlay) sits on top of the control
        const covered = !!top && top !== el && !el.contains(top) && !top.contains(el) && r.top < innerHeight && r.bottom > 0;
        // the current tab / pressed segment / current page link: clicking it again may change nothing
        const active = ['aria-pressed', 'aria-selected', 'aria-current'].some(a => { const v = el.getAttribute(a); return v !== null && v !== 'false'; });
        return { disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true', covered, active };
      }), STEP_TIMEOUT_MS, 'state').catch(() => null);
      if (!state) { result.skipped.push({ control: c.name || c.tag, reason: 'gone (re-rendered)' }); return { added: [] }; }
      if (state.disabled) { result.skipped.push({ control: c.name || c.tag, reason: 'disabled' }); return { added: [] }; }
      dbg('state', JSON.stringify(c.name).slice(0, 30), JSON.stringify(state));
      if (state.covered) { result.skipped.push({ control: c.name || c.tag, reason: 'covered (e.g. by an open dialog)' }); return { added: [] }; }
      let r = await clickAndSee(page, ctx, selector, page.url());
      // a click that did not go through judges nothing, whatever else changed on the page meanwhile
      if (r.clickError) { result.skipped.push({ control: c.name || c.tag, reason: `not clickable: ${r.clickError}` }); return r; }
      result.clicked++;
      // "no effect" may only mean the handler was not attached yet (client rendering):
      // open the page again, give it more time, and click once more before calling it dead
      if (!r.effect && !r.errors.length && retry && Date.now() < deadline) {
        const again = await retry();
        if (again) {
          await page.waitForTimeout(2000);
          r = await clickAndSee(page, ctx, again, page.url());
          result.retried = (result.retried || 0) + 1;
          if (r.clickError) { result.skipped.push({ control: c.name || c.tag, reason: `not clickable on retry: ${r.clickError}` }); return r; }
        }
      }
      dbg('effect', JSON.stringify(c.name).slice(0, 30), JSON.stringify({ effect: r.effect, nav: r.navigated, err: r.clickError, errors: r.errors.length }));
      if (!r.effect && !r.errors.length && state.active) { result.skipped.push({ control: c.name || c.tag, reason: 'already active (aria-pressed / selected / current), no change expected' }); return r; }
      const dead = r.errors.some(e => /ReferenceError|TypeError/.test(e)) || !r.effect;
      if (dead) result.fail.push({ control: c.name || c.tag, tag: c.tag, reason: r.errors.length ? r.errors[0] : r.noise ? `no effect (page changes on its own: ${r.noise} nodes)` : 'no effect' });
      return r;
    };
    for (let i = 0; i < first.length; i++) {
      if (Date.now() > deadline) { result.status = 'error'; result.error = `time budget (${Math.round(budget / 1000)} s) used up after ${i} of ${first.length} controls`; break; }
      const c = first[i];
      if (seen.has(c.key)) continue;
      seen.add(c.key);
      if (DESTRUCTIVE_RE.test(c.name) || DESTRUCTIVE_RE.test(c.href)) { result.skipped.push({ control: c.name || c.tag, reason: 'destructive' }); continue; }
      dbg(urlPath, `#${i}`, c.tag, JSON.stringify(c.name).slice(0, 40), 'open');
      const list = await open();
      dbg(urlPath, `#${i}`, 'click');
      const same = list[i] && list[i].key === c.key ? i : list.findIndex(x => x.key === c.key);
      if (same < 0) { result.skipped.push({ control: c.name || c.tag, reason: 'gone after reopening (the page differs from the first open)' }); continue; }
      const reopen = async () => {
        const l2 = await open();
        const k = l2[i] && l2[i].key === c.key ? i : l2.findIndex(x => x.key === c.key);
        return k < 0 ? null : `[data-cc-sweep="${k}"]`;
      };
      const r = await judgeOne(c, `[data-cc-sweep="${same}"]`, reopen);
      // controls that appeared after the click (toast buttons, dialogs): click them now —
      // unless the click moved to another view, whose controls belong to that page's sweep
      for (const a of r.navigated ? [] : r.added || []) {
        if (seen.has(a.key) || known.has(a.key)) continue;   // late controls are keyed without an occurrence index
        seen.add(a.key);
        if (DESTRUCTIVE_RE.test(a.name)) { result.skipped.push({ control: a.name || a.tag, reason: 'destructive' }); continue; }
        if (Date.now() > deadline) { result.skipped.push({ control: a.name || a.tag, reason: 'time budget used up' }); continue; }
        const exists = await withTimeout(page.$(`[data-cc-sweep="${a.id}"]`), STEP_TIMEOUT_MS, 'find').catch(() => null);
        if (!exists) { result.skipped.push({ control: a.name || a.tag, reason: 'transient-missed' }); continue; }
        grow();   // a late control that will be clicked adds its share
        try { await withTimeout(watch(page), STEP_TIMEOUT_MS, 'watch'); } catch { /* page gone */ }
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
  if (result.status === 'error' && result.fail.length) result.status = 'fail';
  result.covered = result.skipped.filter(x => /^covered/.test(x.reason)).length;   // many covered = an overlay hid the page
  if (result.covered && result.covered * 2 > result.clicked + result.skipped.length) result.hint = 'a dialog that opens on load covers the page';
  if (result.startup_overlay === null) delete result.startup_overlay;
  dbg(urlPath, 'done', result.status, `clicked=${result.clicked}`);
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

async function sweep({ runFile, runId, urls, session, loginFrom, env = process.env }) {
  if (loginFrom !== undefined && session !== undefined) throw new Refused('give either --session or --login-from, not both');
  const rc = runContext(runFile);
  sweepDir(rc, runId);
  if (!Array.isArray(urls) || !urls.length) throw new Refused('--urls needs at least one path');
  for (const u of urls) api.targetUrl(rc.base, u);
  const loaded = loadPlaywright(env);
  if (!loaded) throw new Refused('no Playwright module found — install @playwright/mcp (cc-baseline doctor) or set CC_BASELINE_PLAYWRIGHT');
  const browser = await loaded.pw.chromium.launch({ headless: true });
  try {
    // signed-in screens before any replay: run the recording's login once (cookies or localStorage)
    if (loginFrom !== undefined) session = await require('./tc-replay').saveLoginState(browser, rc, loginFrom, env);
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

const USAGE = 'usage: tc-sweep.js --run <…/.cc-audits/<slug>/tc-run.json> --run-id <id> --urls </a,/b> [--session <name> | --login-from <TC id>]';

async function main(argv) {
  let opts;
  try { ({ opts } = parseArgs(argv.slice(2), { values: ['--run', '--run-id', '--urls', '--session', '--login-from'] })); } catch (e) { console.error(`tc-sweep: ${e.message}\n${USAGE}`); return 2; }
  if (!opts['--run'] || !opts['--run-id'] || !opts['--urls']) { console.error(USAGE); return 2; }
  try {
    const out = await sweep({ runFile: opts['--run'], runId: opts['--run-id'], urls: opts['--urls'].split(',').map(s => s.trim()).filter(Boolean), session: opts['--session'], loginFrom: opts['--login-from'] });
    console.log(JSON.stringify(out));
    return 0;
  } catch (e) {
    console.error(`tc-sweep: ${e.message}`);
    return e instanceof Refused ? 2 : 1;
  }
}

if (require.main === module) main(process.argv).then(c => { process.exitCode = c; });

module.exports = { loadPlaywright, runContext, browserOrigins, openContext, saveState, stateFile, sweepUrl, sweep, readSweep, mergeSweep, normPath, writePrivate, privateDir, DESTRUCTIVE_RE };
