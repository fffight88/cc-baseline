#!/usr/bin/env node
'use strict';

// API requests and project-data reads for TC runs (e2e-tester's only way to
// check api / db / log expected results). The limits are enforced here, in
// code, from the run add-on file written at plan approval:
//
//   node tc-api-run.js request --run <tc-run.json> --session <name> --method <M> --path </api/...> [--body <json file>]
//   node tc-api-run.js read    --run <tc-run.json> --source <name> (--grep <text> | --json-path <a.b[k=v].c>)
//
// request: only base_url's origin; a path, never an absolute URL; redirects are
//   reported, not followed; a non-loopback base_url needs "api_remote_ok": true.
//   Cookies are kept per --session in .cc-audits/<slug>/api-sessions/<name>.json
//   (0600). String values "$ENV_NAME" in the body file are filled from the
//   environment and masked in the output.
// read: only the files named in "readable" ({ name: project-relative path }),
//   resolved inside the project root (symlinks out are refused).
// Output: one JSON object on stdout; cookies, auth headers and tokens masked,
//   capped at 64 KB. Exit 0 = done, 1 = request failed, 2 = refused / usage.

const fs = require('fs');
const path = require('path');
const { parseArgs } = require('./jev-client');

const OUTPUT_CAP = 64 * 1024;
const GREP_MAX_LINES = 200;
const TIMEOUT_MS = 30000;
const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'];
const SESSION_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;
const LOOPBACK = ['127.0.0.1', 'localhost', '[::1]', '::1'];
const SECRET_HEADER_RE = /^(?:set-cookie|cookie|authorization|proxy-authorization)$|auth|token|secret|api[_-]?key/i;
const ENV_REF_RE = /^\$([A-Z_][A-Z0-9_]*)$/;

class Refused extends Error {}

function maskTokens(s, extra = []) {
  let out = String(s);
  for (const v of extra) if (typeof v === 'string' && v.length >= 4) out = out.split(v).join('<masked>');
  return out
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer <masked>')
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, '<masked>')
    .replace(/\b(?:sk|pk|api|apikey|key|token|secret)[_-][A-Za-z0-9_-]{8,}/gi, '<masked>');
}

function loadRun(runFile) {
  let run;
  try { run = JSON.parse(fs.readFileSync(runFile, 'utf8')); } catch (e) { throw new Refused(`cannot read run file ${runFile}: ${e.message}`); }
  if (!run || typeof run !== 'object' || Array.isArray(run)) throw new Refused('run file must be a JSON object');
  return run;
}

// The project root: <root>/.cc-audits/<slug>/tc-run.json, or an absolute
// "project_dir" in the run file.
function projectRoot(runFile, run) {
  const runDir = path.dirname(path.resolve(runFile));
  if (path.basename(path.dirname(runDir)) === '.cc-audits') return path.dirname(path.dirname(runDir));
  if (typeof run.project_dir === 'string' && path.isAbsolute(run.project_dir)) return run.project_dir;
  throw new Refused('run file is not under <project>/.cc-audits/<slug>/ and has no absolute project_dir');
}

function baseOrigin(run) {
  let base;
  try { base = new URL(run.base_url); } catch { throw new Refused('run file needs a valid base_url'); }
  if (!['http:', 'https:'].includes(base.protocol)) throw new Refused('base_url must be http or https');
  if (!LOOPBACK.includes(base.hostname) && run.api_remote_ok !== true) {
    throw new Refused(`base_url ${base.origin} is not loopback — requests need "api_remote_ok": true in the run file (approved at planning)`);
  }
  return base;
}

function targetUrl(base, p) {
  if (typeof p !== 'string' || !p.startsWith('/') || p.startsWith('//') || p.includes('\\') || /^[a-z][a-z0-9+.-]*:/i.test(p)) {
    throw new Refused('--path must be a path starting with a single "/" — absolute URLs are refused');
  }
  const url = new URL(p, base);
  if (url.origin !== base.origin) throw new Refused(`${url.origin} is not the allowed origin ${base.origin}`);
  return url;
}

function sessionFile(runFile, name) {
  if (typeof name !== 'string' || !SESSION_RE.test(name)) throw new Refused('--session must be a short name (letters, digits, _ -)');
  const dir = path.join(path.dirname(path.resolve(runFile)), 'api-sessions');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  return path.join(dir, `${name}.json`);
}

function readCookies(file) {
  try {
    if (fs.lstatSync(file).isSymbolicLink()) throw new Refused(`${file} must not be a symlink`);
    const c = JSON.parse(fs.readFileSync(file, 'utf8'));
    return c && typeof c === 'object' && !Array.isArray(c) ? c : {};
  } catch (e) {
    if (e instanceof Refused) throw e;
    return {};
  }
}

function writeCookies(file, cookies) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cookies), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

// Applies Set-Cookie lines to the jar; returns the names set and the values
// (to mask them in the output).
function applySetCookie(jar, lines) {
  const set = [];
  const values = [];
  for (const line of lines) {
    const [pair, ...attrs] = String(line).split(';');
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    const expired = attrs.some(a => /^\s*max-age\s*=\s*(?:0|-\d+)\s*$/i.test(a))
      || attrs.some(a => { const m = /^\s*expires\s*=(.*)$/i.exec(a); return m && Date.parse(m[1]) < Date.now(); });
    if (expired || value === '') delete jar[name];
    else jar[name] = value;
    set.push(name);
    values.push(value);
  }
  return { set, values };
}

function fillEnv(v, env, used) {
  if (typeof v === 'string') {
    const m = ENV_REF_RE.exec(v);
    if (!m) return v;
    if (typeof env[m[1]] !== 'string') throw new Refused(`body refers to $${m[1]}, which is not set`);
    used.push(env[m[1]]);
    return env[m[1]];
  }
  if (Array.isArray(v)) return v.map(x => fillEnv(x, env, used));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fillEnv(x, env, used)]));
  return v;
}

function capped(text) {
  const s = String(text);
  return s.length > OUTPUT_CAP ? { text: s.slice(0, OUTPUT_CAP), truncated: true } : { text: s, truncated: false };
}

async function request({ runFile, session, method, p, bodyFile, env = process.env, fetchImpl = fetch }) {
  const run = loadRun(runFile);
  const base = baseOrigin(run);
  const url = targetUrl(base, p);
  const m = String(method || '').toUpperCase();
  if (!METHODS.includes(m)) throw new Refused(`--method must be one of ${METHODS.join(' ')}`);
  const jarFile = sessionFile(runFile, session);
  const jar = readCookies(jarFile);

  const secrets = [];
  let body;
  if (bodyFile) {
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(bodyFile, 'utf8')); } catch (e) { throw new Refused(`--body must be a JSON file: ${e.message}`); }
    body = JSON.stringify(fillEnv(parsed, env, secrets));
  }
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const cookieHeader = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
  if (cookieHeader) headers.Cookie = cookieHeader;

  const res = await fetchImpl(url, { method: m, headers, body, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
  const setCookie = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  const { set, values } = applySetCookie(jar, setCookie);
  writeCookies(jarFile, jar);
  const mask = [...secrets, ...values, ...Object.values(jar)];

  const outHeaders = {};
  for (const [k, v] of res.headers) outHeaders[k] = SECRET_HEADER_RE.test(k) ? '[REDACTED]' : maskTokens(v, mask);
  const text = m === 'HEAD' ? '' : await res.text();
  const c = capped(maskTokens(text, mask));
  let json;
  try { json = c.truncated || c.text === '' ? undefined : JSON.parse(c.text); } catch { json = undefined; }
  const out = { method: m, path: url.pathname + url.search, status: res.status, headers: outHeaders, session, cookies_set: set };
  if (res.status >= 300 && res.status < 400) out.redirect_not_followed = outHeaders.location || null;
  if (json !== undefined) out.json = json; else out.body = c.text;
  if (c.truncated) out.truncated = true;
  return out;
}

// a.b[k=v].c[0] → value, or { found: false }.
function jsonPath(doc, expr) {
  const segs = String(expr).split('.').filter(Boolean);
  if (segs.length === 0) throw new Refused('--json-path is empty');
  let cur = doc;
  for (const seg of segs) {
    const m = /^([^[\]]*)(?:\[([^\]=]+)(?:=([^\]]*))?\])?$/.exec(seg);
    if (!m) throw new Refused(`bad --json-path segment "${seg}"`);
    const [, name, a, b] = m;
    if (name) {
      if (!cur || typeof cur !== 'object' || !Object.prototype.hasOwnProperty.call(cur, name)) return { found: false };
      cur = cur[name];
    }
    if (a !== undefined) {
      if (!Array.isArray(cur)) return { found: false };
      if (b === undefined) {
        if (!/^\d+$/.test(a)) throw new Refused(`bad index in "${seg}"`);
        cur = cur[Number(a)];
      } else {
        cur = cur.find(x => x && typeof x === 'object' && String(x[a]) === b);
      }
      if (cur === undefined) return { found: false };
    }
  }
  return { found: true, value: cur };
}

function readSource({ runFile, source, grep, jsonPathExpr }) {
  const run = loadRun(runFile);
  const readable = run.readable && typeof run.readable === 'object' && !Array.isArray(run.readable) ? run.readable : {};
  if (!Object.prototype.hasOwnProperty.call(readable, source)) {
    throw new Refused(`source "${source}" is not in the run file's readable (${Object.keys(readable).join(', ') || 'none'})`);
  }
  const rel = readable[source];
  if (typeof rel !== 'string' || rel === '' || path.isAbsolute(rel)) throw new Refused(`readable.${source} must be a project-relative path`);
  if ((grep === undefined) === (jsonPathExpr === undefined)) throw new Refused('give exactly one of --grep or --json-path');
  const root = fs.realpathSync(projectRoot(runFile, run));
  let real;
  try { real = fs.realpathSync(path.resolve(root, rel)); } catch (e) { throw new Refused(`cannot open readable.${source}: ${e.code || e.message}`); }
  if (!real.startsWith(root + path.sep)) throw new Refused(`readable.${source} resolves outside the project root`);
  if (!fs.statSync(real).isFile()) throw new Refused(`readable.${source} is not a file`);
  const text = fs.readFileSync(real, 'utf8');

  if (jsonPathExpr !== undefined) {
    let doc;
    try { doc = JSON.parse(text); } catch { throw new Refused(`readable.${source} is not JSON — use --grep`); }
    const r = jsonPath(doc, jsonPathExpr);
    const out = { source, json_path: jsonPathExpr, found: r.found };
    if (r.found) {
      const c = capped(maskTokens(JSON.stringify(r.value)));
      if (c.truncated) { out.value_text = c.text; out.truncated = true; } else out.value = JSON.parse(c.text);
    }
    return out;
  }
  const lines = text.split('\n').filter(l => l.includes(grep));
  const shown = [];
  let size = 0;
  for (const l of lines.slice(0, GREP_MAX_LINES)) {
    const masked = maskTokens(l);
    if (size + masked.length > OUTPUT_CAP) break;
    shown.push(masked);
    size += masked.length;
  }
  return { source, grep, count: lines.length, lines: shown, truncated: shown.length < lines.length };
}

const USAGE = 'usage: tc-api-run.js request --run <tc-run.json> --session <name> --method <M> --path </...> [--body <json file>]\n' +
  '       tc-api-run.js read --run <tc-run.json> --source <name> (--grep <text> | --json-path <a.b[k=v].c>)';

async function main(argv) {
  const [cmd, ...rest] = argv.slice(2);
  const spec = {
    request: { values: ['--run', '--session', '--method', '--path', '--body'] },
    read: { values: ['--run', '--source', '--grep', '--json-path'] },
  }[cmd];
  if (!spec) { console.error(USAGE); return 2; }
  let opts, positional;
  try { ({ opts, positional } = parseArgs(rest, spec)); } catch (e) { console.error(`tc-api-run: ${e.message}\n${USAGE}`); return 2; }
  if (positional.length || !opts['--run']) { console.error(USAGE); return 2; }
  try {
    const out = cmd === 'request'
      ? await request({ runFile: opts['--run'], session: opts['--session'], method: opts['--method'], p: opts['--path'], bodyFile: opts['--body'] })
      : readSource({ runFile: opts['--run'], source: opts['--source'], grep: opts['--grep'], jsonPathExpr: opts['--json-path'] });
    console.log(JSON.stringify(out));
    return 0;
  } catch (e) {
    if (e instanceof Refused) { console.error(`tc-api-run: refused — ${e.message}`); return 2; }
    console.error(`tc-api-run: request failed — ${maskTokens(e.message)}`);
    return 1;
  }
}

if (require.main === module) {
  main(process.argv).then(code => { process.exitCode = code; }, e => {
    console.error(`tc-api-run: ${maskTokens(e.message)}`);
    process.exitCode = 2;
  });
}

module.exports = { request, readSource, jsonPath, applySetCookie, targetUrl, Refused };
