'use strict';

// Minimal client for the TypeSafe System One API (Jev models), shared by
// tc-jev-check.js and tc-jev-judge.js. No dependencies.
//
// Key lookup: CC_BASELINE_JEV_KEY → TYPESAFE_API_KEY → ~/.config/cc-baseline/jev.env
// (a `CC_BASELINE_JEV_KEY=...` or `TYPESAFE_API_KEY=...` line; the file must be
// a regular file owned by the current user with mode 600 — symlinks refused).
// The model must be an exact version (jev-X.Y.Z); aliases such as jev-latest
// move to a new model without notice and would mix calibration samples.
// The base URL must be https on *.typesafe.ai (http loopback for tests), and
// redirects are refused, so the key only ever goes to TypeSafe.
// The key is sent only in the Authorization header and is redacted from every
// message this module returns.

const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_MODEL = 'jev-1.14.0';
const DEFAULT_BASE_URL = 'https://api.typesafe.ai';
const KEY_FILE = path.join('.config', 'cc-baseline', 'jev.env');
const RETRY_STATUS = [429, 529];
const MAX_RETRIES = 3;
const MAX_RETRY_WAIT_MS = 30000;
const TIMEOUT_MS = 30000;

function readKeyFile(home) {
  const file = path.join(home, KEY_FILE);
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  } catch (e) {
    if (e.code === 'ENOENT') return { key: null };
    if (e.code === 'ELOOP') return { key: null, error: `${file} must not be a symlink` };
    return { key: null, error: `cannot read ${file}: ${e.code || e.message}` };
  }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) return { key: null, error: `${file} must be a regular file` };
    if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
      return { key: null, error: `${file} must be owned by the current user` };
    }
    if ((stat.mode & 0o077) !== 0) return { key: null, error: `${file} must be mode 600 (chmod 600 ${file})` };
    const lines = fs.readFileSync(fd, 'utf8').split('\n').map(l => l.trim());
    const pick = name => {
      const line = lines.find(l => l.startsWith(`${name}=`));
      return line ? line.slice(name.length + 1).trim().replace(/^["']|["']$/g, '') : '';
    };
    return { key: pick('CC_BASELINE_JEV_KEY') || pick('TYPESAFE_API_KEY') || null };
  } finally {
    fs.closeSync(fd);
  }
}

function loadConfig({ env = process.env, home = os.homedir() } = {}) {
  const config = {
    key: null,
    keySource: null,
    model: env.CC_BASELINE_JEV_MODEL || DEFAULT_MODEL,
    baseUrl: (env.CC_BASELINE_JEV_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ''),
  };
  const errors = [];
  if (env.CC_BASELINE_JEV_KEY) {
    config.key = env.CC_BASELINE_JEV_KEY;
    config.keySource = 'CC_BASELINE_JEV_KEY';
  } else if (env.TYPESAFE_API_KEY) {
    config.key = env.TYPESAFE_API_KEY;
    config.keySource = 'TYPESAFE_API_KEY';
  } else {
    const fromFile = readKeyFile(home);
    if (fromFile.error) errors.push(fromFile.error);
    if (fromFile.key) {
      config.key = fromFile.key;
      config.keySource = 'file';
    }
  }
  if (!/^jev-\d+\.\d+\.\d+$/.test(config.model)) {
    errors.push(`CC_BASELINE_JEV_MODEL must be an exact version like ${DEFAULT_MODEL}, not "${config.model}"`);
  }
  let url;
  try { url = new URL(config.baseUrl); } catch { url = null; }
  const loopback = url && url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  const typesafe = url && url.protocol === 'https:' && (url.hostname === 'typesafe.ai' || url.hostname.endsWith('.typesafe.ai'));
  if (!loopback && !typesafe) {
    errors.push(`CC_BASELINE_JEV_BASE_URL must be an https URL on typesafe.ai, not "${config.baseUrl}"`);
  }
  if (errors.length) config.error = errors.join('; ');
  return config;
}

function redact(text, key) {
  const s = String(text);
  return key ? s.split(key).join('<redacted>') : s;
}

const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function retryWait(res, attempt) {
  const header = res && res.headers && typeof res.headers.get === 'function' ? res.headers.get('retry-after') : null;
  const after = header !== null && header.trim() !== '' ? Number(header) : NaN;
  const ms = Number.isFinite(after) && after >= 0 ? after * 1000 : 1000 * 2 ** (attempt - 1);
  return Math.min(ms, MAX_RETRY_WAIT_MS);
}

// POST /v1/systemone. `body` is { state, questions, ... }; the configured model
// is filled in. Returns { ok: true, response, status, attempts, ms } or
// { ok: false, error, status?, attempts, ms }. Never throws for API errors.
// Retries 429 / 529 (honoring Retry-After) and network errors, at most 3 times.
async function systemOne(config, body, { sleep = defaultSleep, fetchImpl = fetch } = {}) {
  const started = Date.now();
  if (config.error) return { ok: false, error: redact(config.error, config.key), attempts: 0, ms: 0 };
  if (!config.key) return { ok: false, error: 'no Jev key configured', attempts: 0, ms: 0 };

  const payload = JSON.stringify({ ...body, model: config.model });
  let attempts = 0;
  for (;;) {
    attempts++;
    let res, text;
    try {
      res = await fetchImpl(`${config.baseUrl}/v1/systemone`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/json' },
        body: payload,
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      text = await res.text();
    } catch (e) {
      if (attempts <= MAX_RETRIES) {
        await sleep(retryWait(null, attempts));
        continue;
      }
      return { ok: false, error: redact(`request failed: ${e.message}`, config.key), attempts, ms: Date.now() - started };
    }

    if (RETRY_STATUS.includes(res.status) && attempts <= MAX_RETRIES) {
      await sleep(retryWait(res, attempts));
      continue;
    }
    if (!res.ok) {
      return { ok: false, status: res.status, error: redact(`HTTP ${res.status}: ${text.slice(0, 300)}`, config.key), attempts, ms: Date.now() - started };
    }

    let response;
    try { response = JSON.parse(text); } catch {
      return { ok: false, status: res.status, error: 'response is not JSON', attempts, ms: Date.now() - started };
    }
    if (!response || response.model !== config.model) {
      return { ok: false, status: res.status, error: `model mismatch: asked ${config.model}, answered ${response && response.model}`, attempts, ms: Date.now() - started };
    }
    return { ok: true, status: res.status, response, attempts, ms: Date.now() - started };
  }
}

// Strict option parser shared by the TC scripts: known flags only, a value
// flag must be followed by a value that is not itself a flag.
// `repeat` options may be given more than once and come back as an array.
function parseArgs(args, { values = [], flags = [], repeat = [] } = {}) {
  const opts = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) { positional.push(a); continue; }
    if (flags.includes(a)) { opts[a] = true; continue; }
    if (values.includes(a) || repeat.includes(a)) {
      const v = args[i + 1];
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`);
      opts[a] = repeat.includes(a) ? [...(opts[a] || []), v] : v;
      i++;
      continue;
    }
    throw new Error(`unknown option ${a}`);
  }
  return { opts, positional };
}

// Output files the TC scripts write must use their fixed names, so a stray
// argument cannot overwrite an unrelated file.
function checkOutputName(file, expected) {
  if (path.basename(file) !== expected) throw new Error(`output file must be named ${expected}, not ${path.basename(file)}`);
}

module.exports = { loadConfig, systemOne, redact, parseArgs, checkOutputName, DEFAULT_MODEL, DEFAULT_BASE_URL, KEY_FILE };
