'use strict';

// Minimal client for the TypeSafe System One API (Jev models), shared by
// tc-jev-check.js and tc-jev-judge.js. No dependencies.
//
// Key lookup: CC_BASELINE_JEV_KEY → TYPESAFE_API_KEY → ~/.config/cc-baseline/jev.env
// (one `CC_BASELINE_JEV_KEY=...` line, refused unless mode 600).
// The model must be an exact version (jev-X.Y.Z); aliases such as jev-latest
// move to a new model without notice and would mix calibration samples.
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
const TIMEOUT_MS = 30000;

function readKeyFile(home) {
  const file = path.join(home, KEY_FILE);
  let stat;
  try { stat = fs.statSync(file); } catch { return { key: null }; }
  if ((stat.mode & 0o077) !== 0) {
    return { key: null, error: `${file} must be mode 600 (chmod 600 ${file})` };
  }
  const line = fs.readFileSync(file, 'utf8').split('\n')
    .map(l => l.trim())
    .find(l => l.startsWith('CC_BASELINE_JEV_KEY=') || l.startsWith('TYPESAFE_API_KEY='));
  if (!line) return { key: null };
  const value = line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '');
  return { key: value || null };
}

function loadConfig({ env = process.env, home = os.homedir() } = {}) {
  const config = {
    key: null,
    keySource: null,
    model: env.CC_BASELINE_JEV_MODEL || DEFAULT_MODEL,
    baseUrl: (env.CC_BASELINE_JEV_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ''),
  };
  if (env.CC_BASELINE_JEV_KEY) {
    config.key = env.CC_BASELINE_JEV_KEY;
    config.keySource = 'CC_BASELINE_JEV_KEY';
  } else if (env.TYPESAFE_API_KEY) {
    config.key = env.TYPESAFE_API_KEY;
    config.keySource = 'TYPESAFE_API_KEY';
  } else {
    const fromFile = readKeyFile(home);
    if (fromFile.error) config.error = fromFile.error;
    if (fromFile.key) {
      config.key = fromFile.key;
      config.keySource = 'file';
    }
  }
  if (!/^jev-\d+\.\d+\.\d+$/.test(config.model)) {
    config.error = `CC_BASELINE_JEV_MODEL must be an exact version like ${DEFAULT_MODEL}, not "${config.model}"`;
  }
  let url;
  try { url = new URL(config.baseUrl); } catch { url = null; }
  const loopback = url && url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (!url || (url.protocol !== 'https:' && !loopback)) {
    config.error = `CC_BASELINE_JEV_BASE_URL must be an https URL, not "${config.baseUrl}"`;
  }
  return config;
}

function redact(text, key) {
  const s = String(text);
  return key ? s.split(key).join('<redacted>') : s;
}

const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// POST /v1/systemone. `body` is { state, questions, ... }; the configured model
// is filled in. Returns { ok: true, response, status, attempts, ms } or
// { ok: false, error, status?, attempts, ms }. Never throws for API errors.
async function systemOne(config, body, { sleep = defaultSleep, fetchImpl = fetch } = {}) {
  const started = Date.now();
  if (!config.key) return { ok: false, error: 'no Jev key configured', attempts: 0, ms: 0 };
  if (config.error) return { ok: false, error: redact(config.error, config.key), attempts: 0, ms: 0 };

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
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      text = await res.text();
    } catch (e) {
      return { ok: false, error: redact(`request failed: ${e.message}`, config.key), attempts, ms: Date.now() - started };
    }

    if (RETRY_STATUS.includes(res.status) && attempts <= MAX_RETRIES) {
      await sleep(1000 * 2 ** (attempts - 1));
      continue;
    }
    if (!res.ok) {
      return { ok: false, status: res.status, error: redact(`HTTP ${res.status}: ${text.slice(0, 300)}`, config.key), attempts, ms: Date.now() - started };
    }

    let response;
    try { response = JSON.parse(text); } catch {
      return { ok: false, status: res.status, error: 'response is not JSON', attempts, ms: Date.now() - started };
    }
    if (response.model !== config.model) {
      return { ok: false, status: res.status, error: `model mismatch: asked ${config.model}, answered ${response.model}`, attempts, ms: Date.now() - started };
    }
    return { ok: true, status: res.status, response, attempts, ms: Date.now() - started };
  }
}

module.exports = { loadConfig, systemOne, redact, DEFAULT_MODEL, DEFAULT_BASE_URL, KEY_FILE };
