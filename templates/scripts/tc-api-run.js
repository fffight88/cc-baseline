#!/usr/bin/env node
'use strict';

// API requests and project-data reads for TC runs (e2e-tester's only way to
// check api / db / log expected results). The limits are enforced here, in
// code, from the run add-on file written at plan approval:
//
//   node tc-api-run.js request --run <tc-run.json> --session <name> --method <M> --path </api/...> [--body <json file>]
//   node tc-api-run.js read    --run <tc-run.json> --source <name> (--grep <text> [--grep <text> …] | --json-path <a.b[k=v].c> [--count])
//       repeated --grep keeps only lines that contain every text (e.g. an event name and an order number).
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
const os = require('os');
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
// Project files `read` never opens, even when the run file lists them.
const DENIED_READ_RE = /(?:^|\/)(?:\.env[^/]*|[^/]*\.(?:pem|key|p12|pfx|kdbx)|id_[^/]*|[^/]*jev\.env)$|(?:^|\/)(?:\.git|\.ssh|api-sessions|replay-state|replay-pending|obs)(?:\/|$)/i;
// key=value / "key": value pairs whose key names a secret.
const SECRET_PAIR_RE = /("?[A-Za-z_]*(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key)[A-Za-z_]*"?\s*[:=]\s*)("[^"]*"|[^\s,;&}\]]+)/gi;

class Refused extends Error {}

function maskTokens(s, extra = []) {
  let out = String(s);
  for (const v of extra) if (typeof v === 'string' && v.length >= 4) out = out.split(v).join('<masked>');
  return out
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer <masked>')
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, '<masked>')
    .replace(/\b(?:sk|pk|api|apikey|key|token|secret)[_-][A-Za-z0-9_-]{8,}/gi, '<masked>')
    .replace(SECRET_PAIR_RE, (all, k, v) => `${k}${v.startsWith('"') ? '"<masked>"' : '<masked>'}`);
}

function loadRun(runFile) {
  projectRoot(runFile);
  let run;
  try { run = JSON.parse(fs.readFileSync(runFile, 'utf8')); } catch (e) { throw new Refused(`cannot read run file ${runFile}: ${e.message}`); }
  if (!run || typeof run !== 'object' || Array.isArray(run)) throw new Refused('run file must be a JSON object');
  return run;
}

// The project root. Only a run file at <root>/.cc-audits/<slug>/tc-run.json is
// accepted, so a run file written anywhere else cannot widen what is allowed.
function projectRoot(runFile) {
  const real = fs.realpathSync(path.resolve(runFile));
  const runDir = path.dirname(real);
  if (path.basename(real) !== 'tc-run.json' || path.basename(path.dirname(runDir)) !== '.cc-audits') {
    throw new Refused('run file must be <project>/.cc-audits/<slug>/tc-run.json');
  }
  return path.dirname(path.dirname(runDir));
}

// $NAME body values: only the names a TC in the run file declares in secret_env.
function allowedEnv(run) {
  const names = new Set(Array.isArray(run.secret_env) ? run.secret_env : []);
  for (const t of Object.values(run.tcs && typeof run.tcs === 'object' ? run.tcs : {})) {
    if (t && Array.isArray(t.secret_env)) for (const n of t.secret_env) names.add(n);
    if (t && t.api && Array.isArray(t.api.secret_env)) for (const n of t.api.secret_env) names.add(n);
  }
  return names;
}

// A run-file command (`reset_command`, `data.<name>_command`): `<node|bash|sh|python3>
// <project script> <plain args>` — an interpreter by name (found on PATH, never a path), no
// shell syntax, no quoting, a script file committed to git inside the project (not under
// .cc-audits/ or node_modules/). The user saw it when approving the plan.
// Returns { interpreter, script (absolute), args }.
const COMMAND_ARG_RE = /^[A-Za-z0-9._=:,@/+-]+$/;
const INTERPRETERS = ['node', 'bash', 'sh', 'python3'];
function checkCommand(cmd, root) {
  if (typeof cmd !== 'string') throw new Refused('a command must be a string');
  const parts = cmd.trim().split(/\s+/);
  if (!INTERPRETERS.includes(parts[0]) || parts.length < 2) throw new Refused(`a command must be \`<${INTERPRETERS.join('|')}> <project script> <plain args>\``);
  const bad = parts.slice(1).find(a => !COMMAND_ARG_RE.test(a));
  if (bad !== undefined) throw new Refused(`a command has shell syntax or quoting: ${JSON.stringify(bad.slice(0, 40))}`);
  const script = parts[1];
  if (path.isAbsolute(script) || script.split('/').includes('..')) throw new Refused('a command script must be a path inside the project');
  let real;
  try { real = fs.realpathSync(path.join(root, script)); } catch { throw new Refused(`command script ${script} does not exist`); }
  if (!real.startsWith(root + path.sep) || !fs.statSync(real).isFile()) throw new Refused('a command script must be a file inside the project');
  const rel = path.relative(root, real);
  if (/^(?:\.cc-audits|node_modules)(?:\/|$)/.test(rel.split(path.sep).join('/'))) throw new Refused('a command script may not live under .cc-audits/ or node_modules/');
  // only a script committed to git runs: a file an agent wrote during the run never does
  try { require('child_process').execFileSync('git', ['-C', root, 'ls-files', '--error-unmatch', '--', rel], { stdio: 'ignore', timeout: 5000 }); } catch {
    throw new Refused(`command script ${script} is not tracked by git — commit it first`);
  }
  return { interpreter: parts[0], script: real, args: parts.slice(2) };
}

// A Bearer-token API (the login response carries the token, later requests send it in a
// header): "api_token": { "login_path": "/auth/login", "json_path": "token",
// "header": "Authorization", "scheme": "Bearer" }. The token is kept next to the session's
// cookie file (<session>.token, 0600), sent only to base_url, and masked in every output.
function apiToken(run) {
  const t = run.api_token;
  if (t === undefined) return null;
  if (!t || typeof t !== 'object' || Array.isArray(t)) throw new Refused('api_token must be an object');
  if (typeof t.login_path !== 'string' || !t.login_path.startsWith('/') || t.login_path.startsWith('//')) throw new Refused('api_token.login_path must be a path');
  if (typeof t.json_path !== 'string' || !t.json_path) throw new Refused('api_token.json_path is required');
  const header = t.header === undefined ? 'Authorization' : t.header;
  const scheme = t.scheme === undefined ? 'Bearer' : t.scheme;
  if (typeof header !== 'string' || !/^[A-Za-z0-9-]{1,60}$/.test(header)) throw new Refused('api_token.header must be a header name');
  if (/^(?:cookie|host|content-length|content-type|transfer-encoding|connection)$/i.test(header)) throw new Refused(`api_token.header may not be ${header}`);
  if (typeof scheme !== 'string' || !/^[A-Za-z]{0,20}$/.test(scheme)) throw new Refused('api_token.scheme must be a word (or empty)');
  return { login_path: new URL(t.login_path, 'http://x').pathname, json_path: t.json_path, header, scheme };
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
  fs.writeFileSync(tmp, typeof cookies === 'string' ? cookies : JSON.stringify(cookies), { mode: 0o600 });
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

function fillEnv(v, env, used, allowed) {
  if (typeof v === 'string') {
    const m = ENV_REF_RE.exec(v);
    if (!m) return v;
    if (!allowed.has(m[1])) throw new Refused(`body refers to $${m[1]}, which no TC in the run file lists in secret_env`);
    if (typeof env[m[1]] !== 'string') throw new Refused(`body refers to $${m[1]}, which is not set`);
    used.push(env[m[1]]);
    return env[m[1]];
  }
  if (Array.isArray(v)) return v.map(x => fillEnv(x, env, used, allowed));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fillEnv(x, env, used, allowed)]));
  return v;
}

// A body file is a temp file the tester wrote, or a file inside the project.
function checkBodyFile(bodyFile, runFile) {
  let real;
  try { real = fs.realpathSync(bodyFile); } catch (e) { throw new Refused(`--body ${bodyFile}: ${e.code || e.message}`); }
  const roots = [projectRoot(runFile), fs.realpathSync(os.tmpdir())];
  if (!roots.some(r => real.startsWith(r + path.sep))) throw new Refused('--body must be a file in the temp dir or inside the project');
  if (DENIED_READ_RE.test(real)) throw new Refused('--body names a secret-looking file');
  return real;
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
    const real = checkBodyFile(bodyFile, runFile);
    try { parsed = JSON.parse(fs.readFileSync(real, 'utf8')); } catch (e) { throw new Refused(`--body must be a JSON file: ${e.message}`); }
    body = JSON.stringify(fillEnv(parsed, env, secrets, allowedEnv(run)));
  }
  const tok = apiToken(run);
  const tokenFile = `${jarFile.replace(/\.json$/, '')}.token`;
  let token = null;
  if (tok) { try { if (!fs.lstatSync(tokenFile).isSymbolicLink()) token = fs.readFileSync(tokenFile, 'utf8') || null; } catch { /* none yet */ } }
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const cookieHeader = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
  if (cookieHeader) headers.Cookie = cookieHeader;
  if (token) headers[tok.header] = tok.scheme ? `${tok.scheme} ${token}` : token;

  const res = await fetchImpl(url, { method: m, headers, body, redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
  const setCookie = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  const { set, values } = applySetCookie(jar, setCookie);
  const text = m === 'HEAD' ? '' : await res.text();
  // a login on the token API keeps the returned token for this session; a failed one drops the old token
  const mask = [...secrets, ...values, ...Object.values(jar)];
  if (token) mask.push(token);
  if (tok && url.pathname === tok.login_path) {
    let parsed;
    try { parsed = res.ok ? JSON.parse(text) : undefined; } catch { parsed = undefined; }
    const v = parsed === undefined ? { found: false } : jsonPath(parsed, tok.json_path);
    if (v.found && typeof v.value === 'string' && v.value) {
      writeCookies(tokenFile, v.value);
      mask.push(v.value);
      set.push('(api token)');
    } else fs.rmSync(tokenFile, { force: true });
  }
  writeCookies(jarFile, jar);

  const outHeaders = {};
  for (const [k, v] of res.headers) outHeaders[k] = SECRET_HEADER_RE.test(k) ? '[REDACTED]' : maskTokens(v, mask);
  const c = capped(maskTokens(text, mask));
  let json;
  try { json = c.truncated || c.text === '' ? undefined : JSON.parse(c.text); } catch { json = undefined; }
  const out = { method: m, path: url.pathname + url.search, status: res.status, headers: outHeaders, session, cookies_set: set };
  if (res.status >= 300 && res.status < 400) out.redirect_not_followed = outHeaders.location || null;
  if (json !== undefined) out.json = json; else out.body = c.text;
  if (c.truncated) out.truncated = true;
  return out;
}

// a.b[k=v].c[0] → value, or { found: false }. [k=v,k2=v2] needs every
// condition; with `all` the last filter keeps every match (for --count).
function jsonPath(doc, expr, { all = false } = {}) {
  // split on dots outside [...], so a value like [email=a.b@c.d] stays whole
  const segs = [];
  let part = '';
  let depth = 0;
  for (const ch of String(expr)) {
    if (ch === '[') depth++;
    else if (ch === ']') depth = Math.max(0, depth - 1);
    if (ch === '.' && depth === 0) { if (part) segs.push(part); part = ''; } else part += ch;
  }
  if (part) segs.push(part);
  if (segs.length === 0) throw new Refused('--json-path is empty');
  let cur = doc;
  for (const [i, seg] of segs.entries()) {
    const m = /^([^[\]]*)(?:\[([^\]]+)\])?$/.exec(seg);
    if (!m) throw new Refused(`bad --json-path segment "${seg}"`);
    const [, name, cond] = m;
    if (name) {
      if (!cur || typeof cur !== 'object' || !Object.prototype.hasOwnProperty.call(cur, name)) return { found: false };
      cur = cur[name];
    }
    if (cond === undefined) continue;
    if (!Array.isArray(cur)) return { found: false };
    if (/^\d+$/.test(cond)) {
      cur = cur[Number(cond)];
    } else {
      const pairs = cond.split(',').map(c => {
        const eq = c.indexOf('=');
        if (eq <= 0) throw new Refused(`bad condition "${c}" in "${seg}" — use [key=value] or [key=value,key2=value2]`);
        return [c.slice(0, eq).trim(), c.slice(eq + 1).trim()];
      });
      const hits = cur.filter(x => x && typeof x === 'object' && pairs.every(([k, v]) => String(x[k]) === v));
      if (all && i === segs.length - 1) return { found: true, value: hits };
      cur = hits[0];
    }
    if (cur === undefined) return { found: false };
  }
  return { found: true, value: cur };
}

function readSource({ runFile, source, grep, jsonPathExpr, count = false }) {
  const run = loadRun(runFile);
  const readable = run.readable && typeof run.readable === 'object' && !Array.isArray(run.readable) ? run.readable : {};
  if (!Object.prototype.hasOwnProperty.call(readable, source)) {
    throw new Refused(`source "${source}" is not in the run file's readable (${Object.keys(readable).join(', ') || 'none'})`);
  }
  const rel = readable[source];
  if (typeof rel !== 'string' || rel === '' || path.isAbsolute(rel)) throw new Refused(`readable.${source} must be a project-relative path`);
  if (DENIED_READ_RE.test(rel.split(path.sep).join('/'))) throw new Refused(`readable.${source} names a secret-looking file (${rel}) — not readable`);
  if ((grep === undefined) === (jsonPathExpr === undefined)) throw new Refused('give exactly one of --grep or --json-path');
  const root = fs.realpathSync(projectRoot(runFile));
  let real;
  try { real = fs.realpathSync(path.resolve(root, rel)); } catch (e) { throw new Refused(`cannot open readable.${source}: ${e.code || e.message}`); }
  if (!real.startsWith(root + path.sep)) throw new Refused(`readable.${source} resolves outside the project root`);
  if (DENIED_READ_RE.test(path.relative(root, real).split(path.sep).join('/'))) throw new Refused(`readable.${source} resolves to a secret-looking file — not readable`);
  if (!fs.statSync(real).isFile()) throw new Refused(`readable.${source} is not a file`);
  const text = fs.readFileSync(real, 'utf8');

  if (jsonPathExpr !== undefined) {
    let doc;
    try { doc = JSON.parse(text); } catch { throw new Refused(`readable.${source} is not JSON — use --grep`); }
    const r = jsonPath(doc, jsonPathExpr, { all: count });
    if (count) {
      const n = !r.found ? 0 : Array.isArray(r.value) ? r.value.length : 1;
      return { source, json_path: jsonPathExpr, count: n };
    }
    const out = { source, json_path: jsonPathExpr, found: r.found };
    if (r.found) {
      const c = capped(maskTokens(JSON.stringify(r.value)));
      if (c.truncated) { out.value_text = c.text; out.truncated = true; } else out.value = JSON.parse(c.text);
    }
    return out;
  }
  const greps = Array.isArray(grep) ? grep : [grep];
  if (greps.some(g => typeof g !== 'string' || g === '')) throw new Refused('--grep needs a non-empty text');
  const lines = text.split('\n').filter(l => greps.every(g => l.includes(g)));
  const shown = [];
  let size = 0;
  for (const l of lines.slice(0, GREP_MAX_LINES)) {
    const masked = maskTokens(l);
    if (size + masked.length > OUTPUT_CAP) break;
    shown.push(masked);
    size += masked.length;
  }
  return { source, grep: greps.length === 1 ? greps[0] : greps, count: lines.length, lines: shown, truncated: shown.length < lines.length };
}

const USAGE = 'usage: tc-api-run.js request --run <tc-run.json> --session <name> --method <M> --path </...> [--body <json file>]\n' +
  '       tc-api-run.js read --run <tc-run.json> --source <name> (--grep <text> [--grep <text> …] | --json-path <a.b[k=v,k2=v2].c> [--count])';

async function main(argv) {
  const [cmd, ...rest] = argv.slice(2);
  const spec = {
    request: { values: ['--run', '--session', '--method', '--path', '--body'] },
    read: { values: ['--run', '--source', '--json-path'], repeat: ['--grep'], flags: ['--count'] },
  }[cmd];
  if (!spec) { console.error(USAGE); return 2; }
  let opts, positional;
  try { ({ opts, positional } = parseArgs(rest, spec)); } catch (e) { console.error(`tc-api-run: ${e.message}\n${USAGE}`); return 2; }
  if (positional.length || !opts['--run']) { console.error(USAGE); return 2; }
  try {
    const out = cmd === 'request'
      ? await request({ runFile: opts['--run'], session: opts['--session'], method: opts['--method'], p: opts['--path'], bodyFile: opts['--body'] })
      : readSource({ runFile: opts['--run'], source: opts['--source'], grep: opts['--grep'], jsonPathExpr: opts['--json-path'], count: opts['--count'] === true });
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

module.exports = { request, readSource, jsonPath, applySetCookie, targetUrl, Refused, loadRun, projectRoot, baseOrigin, sessionFile, readCookies, maskTokens, checkCommand, DENIED_READ_RE };
