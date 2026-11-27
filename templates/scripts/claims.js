#!/usr/bin/env node
'use strict';

// Independent verification of the facts in a report (reference_claim_verification.md).
// The producer writes claims.jsonl + premises.jsonl in a run dir
// (.cc-audits/claims/<run>/). This script checks and freezes them, mixes in
// canaries (claims made false on purpose), and — after fact-auditor and, for
// screen items, e2e-tester have judged every item — scores the verdicts against
// the canary key, carries refuted premises over to the claims that rest on
// them, re-reads the evidence each verdict names (recheck), draws the human
// sample when one is asked for and writes the report. It judges nothing itself.
//
//   node claims.js lint <run dir>
//   node claims.js prepare <run dir> [--seed N] [--canary-rate 0.1] [--mode light|bulk]
//   node claims.js check-verifiers <run dir>
//   node claims.js screen-tc <run dir>
//   node claims.js import-results <run dir> --results <tc-results.jsonl> [--run-id <id>]
//   node claims.js score <run dir>
//   node claims.js recheck <run dir>
//   node claims.js sample <run dir> [--n 50] [--seed N]
//   node claims.js human <run dir> --answers <answers.json>
//   node claims.js report <run dir>
//   node claims.js open <run dir> [--seed N] [--mode light|bulk] [--draft <file>]   lint → prepare → coverage
//   node claims.js close <run dir>                                               score → recheck → report
//   node claims.js coverage <run dir> --draft <file>
//   node claims.js diff <old run dir> <new run dir>
//
// Exit 0 ok · 1 the check failed (lint errors, a forbidden verifier, missing
// verdicts, evidence that did not reproduce) · 2 usage or I/O error.
//
// recheck never runs a script an agent wrote: it reads the file or log line a
// verdict names itself, and sends a verdict's SELECT to the database only
// through the `db.connect` command the orchestrator wrote in claims-run.json.
// A url recipe is one GET to a public https host (default port, no credentials,
// every address and redirect hop checked, 2 MB and 15 s per request, 40 start
// URLs per run and none new after 120 s), only when claims-run.json has `web: true`.
//
// The canary key lives outside the project (~/.claude/claims-keys/<id>/key.json,
// dir 0700, file 0600; CC_BASELINE_CLAIMS_KEYS moves the root). fact-auditor is
// told never to read it; nothing stops a reader with file access — that limit is
// written down in the guide.

const crypto = require('crypto');
const dns = require('dns');
const fs = require('fs');
const https = require('https');
const net = require('net');
const os = require('os');
const path = require('path');
const { parseArgs } = require('./jev-client');
const { label: jevLabel, readSamples, jevDirDefault, canonical, maskSecrets, CLAIM_QUESTION } = require('./tc-jev-judge');
const { DENIED_READ_RE } = require('./tc-api-run');
const { COMMAND_ENV_DROP } = require('./tc-replay');

const CHANNELS = ['code', 'db', 'log', 'screen', 'doc', 'api', 'web'];
const TARGET_KINDS = ['screen', 'file', 'table', 'function', 'route', 'menu', 'web', 'other'];
const IMPACTS = ['decision', 'descriptive'];
const VERDICTS = ['SUPPORTED', 'REFUTED', 'UNVERIFIABLE'];
const GRADES = ['A', 'B', 'C', 'D'];
const MODES = ['light', 'bulk'];
const CLAIM_KEYS = ['id', 'text', 'target', 'channel', 'expected', 'premises', 'impact', 'source_refs', 'source_url', 'notes'];
const PREMISE_KEYS = ['id', 'text', 'target', 'channel', 'expected', 'source_refs', 'source_url', 'notes'];
const VERDICT_KEYS = ['id', 'verdict', 'grade', 'evidence', 'verifier', 'jev_sample', 'recheck', 'notes'];
const RECHECK_KEYS = ['file', 'log', 'sql', 'url', 'line', 'contains'];
const RECHECK_KINDS = ['file', 'log', 'sql', 'url'];
const CLAIM_ID_RE = /^C-\d{4,}$/;
const PREMISE_ID_RE = /^P-\d{3,}$/;
const AUDIT_ID_RE = /^A-\d{4,}$/;
const SHA_RE = /^[0-9a-f]{64}$/;
const TEXT_MAX = 500;
const BULK_MIN = 30;
const LIGHT_CANARIES = 2;
const BULK_CANARIES_PER_CHANNEL = 3;
const DEFAULT_RATE = 0.1;
const DEFAULT_SAMPLE = 50;
const FILE_MAX = 2 * 1024 * 1024;
// An expected value this long is a sentence, not the one value a claim asserts:
// a canary made from it may by chance still be true (Phase E: 9 of 21 caught).
const LONG_EXPECTED_CHARS = 40;
const LONG_EXPECTED_WORDS = 6;
const LOG_MAX = 50 * 1024 * 1024;
const RECHECK_LINE_SLACK = 3;
const CONTAINS_MAX = 300;
const FOUND_MAX = 200;
const SQL_TIMEOUT_MS = 30000;
// A url recipe: one GET per URL, to a public https host only.
const WEB_URL_MAX = 500;
const WEB_TIMEOUT_MS = 15000;
const WEB_MAX_URLS = 40;
const WEB_MAX_REDIRECTS = 3;
const WEB_RUN_BUDGET_MS = 120000;
const WEB_UA = 'cc-baseline-claims-recheck';
const UNVERIFIABLE_WARN_MIN = 4;
const UNVERIFIABLE_WARN_SHARE = 0.3;
const COVERAGE_MAX = 50;
const COVERAGE_TOKEN_MAX = 200;   // a longer token is never matched or printed whole
const COVERAGE_LINE_MAX = 4000;   // tokens are looked for in the first 4000 characters of a line
const RISK_MAX = 10;
const SQL_OUT_MAX = 1024 * 1024;
// Status codes a canary may use instead of a real one, so a changed status still looks like a status.
const HTTP_STATUSES = [200, 201, 204, 301, 302, 304, 400, 401, 403, 404, 405, 409, 422, 429, 500, 502, 503];
const STATUS_CONTEXT_RE = /\bHTTP\b|\bstatus\b|\banswered with\b|\brespond(?:s|ed)? with\b|\breturn(?:s|ed)?\b/i;
const DATE_RE = /\b(\d{4})-(\d{2})-(\d{2})\b/;
const YEAR_CONTEXT_RE = /\b(?:year|years|since|until|founded|created|released|published|launched|established|in|from|by)\s+\d{4}\b|\b\d{4}\s+(?:year|edition|release)\b/i;
// SELECTs recheck refuses on top of WRITE_SQL_RE: calls that read files, reach other
// servers, move sequences or lock rows.
const RECHECK_SQL_DENY_RE = /\b(?:pg_read_file|pg_read_binary_file|pg_ls_dir|pg_stat_file|lo_\w+|dblink\w*|nextval|setval|load_extension|load_file|openrowset|opendatasource|openquery|xp_\w+|sp_\w+|pg_sleep\w*|sleep|benchmark)\s*\(|\bINTO\s+(?:OUTFILE|DUMPFILE)\b|\bFOR\s+(?:UPDATE|SHARE|NO\s+KEY\s+UPDATE|KEY\s+SHARE)\b/i;
// How each database kind is put into read-only mode around one SELECT. Other kinds run
// only when claims-run.json says the connect command logs in read-only (db.readonly_login).
const READONLY_WRAP = {
  postgres: body => `BEGIN READ ONLY;\n${body};\nROLLBACK;\n`,
  mysql: body => `START TRANSACTION READ ONLY;\n${body};\nROLLBACK;\n`,
  mariadb: body => `START TRANSACTION READ ONLY;\n${body};\nROLLBACK;\n`,
  sqlite: body => `PRAGMA query_only = ON;\n${body};\n`,
};

// Warning heuristics for one claim sentence (they lean toward catching too much).
const CONJUNCTION_RE = /\b(and|as well as|also)\b|;|그리고|또한|\s및\s/i;
const SUBJECTIVE_RE = /적절|제대로|잘 된|깔끔|자연스럽|properly|correctly|nicely|\bwell\b|appropriate|looks? (?:good|fine)/i;
// Writes a db verifier must never contain.
// Matched on the whole file with line breaks folded, so a statement split over lines is seen.
const WRITE_SQL_RE = new RegExp([
  'INSERT\\s+INTO', 'UPDATE\\s+[\\w."`\\[\\]]+\\s+SET', 'DELETE\\s+FROM', 'MERGE\\s+INTO', 'REPLACE\\s+INTO', 'UPSERT\\b',
  'DROP\\s+(?:TABLE|DATABASE|SCHEMA|INDEX|VIEW|FUNCTION|PROCEDURE|ROLE|USER|TRIGGER)',
  'ALTER\\s+(?:TABLE|DATABASE|SCHEMA|ROLE|USER|SYSTEM)', 'CREATE\\s+(?:OR\\s+REPLACE\\s+)?(?:TEMP(?:ORARY)?\\s+)?(?:TABLE|INDEX|VIEW|FUNCTION|PROCEDURE|SCHEMA|DATABASE|ROLE|USER|TRIGGER|EXTENSION)',
  'TRUNCATE\\b', 'GRANT\\s+\\w', 'REVOKE\\s+\\w', 'COPY\\s+[\\w."]+\\s*(?:\\([^)]*\\)\\s*)?(?:FROM|TO)\\b',
  'CALL\\s+[\\w.]+\\s*\\(', 'EXEC(?:UTE)?\\s+(?:sp_|xp_|[\\w.]+\\s*\\()', 'DO\\s+\\$', 'SELECT\\b[^;]{0,500}?\\bINTO\\s+(?!@)[\\w."]+\\s+FROM\\b',
  'VACUUM\\b', 'LOCK\\s+TABLE', 'set_config\\s*\\(', 'pg_(?:terminate|cancel)_backend', 'pg_reload_conf',
].map(x => `\\b${x}`).join('|'), 'gi');
// Negations a canary may flip in the claim text: [negative, positive].
const NEGATIONS = [
  [' is not ', ' is '], [' are not ', ' are '], [' does not exist', ' exists'], [' has no ', ' has '], [' cannot ', ' can '],
  ['없습니다', '있습니다'], ['없다', '있다'], ['없음', '있음'], ['하지 않는다', '한다'], ['되지 않는다', '된다'],
];

class ClaimsError extends Error {}

function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function isStr(v) { return typeof v === 'string' && v.trim() !== ''; }

function readJsonl(file, { optional = false } = {}) {
  if (!fs.existsSync(file)) {
    if (optional) return [];
    throw new ClaimsError(`missing ${file}`);
  }
  const out = [];
  fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    try { out.push(JSON.parse(line)); } catch { throw new ClaimsError(`${path.basename(file)} line ${i + 1} is not JSON`); }
  });
  return out;
}

function readJson(file, { optional = false } = {}) {
  if (!fs.existsSync(file)) {
    if (optional) return null;
    throw new ClaimsError(`missing ${file}`);
  }
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new ClaimsError(`${file} is not JSON`); }
}

function writeJson(file, obj, mode = 0o600) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n', { mode });
}

function writeJsonl(file, rows) {
  fs.writeFileSync(file, rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''), { mode: 0o600 });
}

function runPaths(runDir) {
  let dir = path.resolve(runDir);
  // a bare run name, given from the project root, is that run of .cc-audits/claims
  if (!fs.existsSync(dir) && isStr(runDir) && !/[\\/]/.test(runDir) && !runDir.startsWith('.')) {
    const named = path.resolve('.cc-audits', 'claims', runDir);
    if (fs.existsSync(named)) dir = named;
  }
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new ClaimsError(`no run dir ${runDir}`);
  const p = f => path.join(dir, f);
  return {
    dir, name: path.basename(dir),
    claims: p('claims.jsonl'), premises: p('premises.jsonl'), run: p('claims-run.json'),
    input: p('audit-input.jsonl'), freeze: p('freeze.json'), verdicts: p('verdicts.jsonl'),
    verifiers: p('verifiers'), screenTc: p('screen.tc.json'), score: p('score.json'),
    sample: p('sample.json'), sampleMd: p('sample.md'), human: p('human.json'), recheck: p('recheck.json'),
    reportJson: p('report.json'), reportMd: p('report.md'), receipts: p('receipts.md'),
  };
}

// The nearest directory with .git above the run dir; else the dir that holds .cc-audits.
function projectRoot(dir) {
  let d = fs.realpathSync(dir);
  for (;;) {
    if (fs.existsSync(path.join(d, '.git'))) return d;
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  const real = fs.realpathSync(dir);
  const i = real.split(path.sep).lastIndexOf('.cc-audits');
  return i > 0 ? real.split(path.sep).slice(0, i).join(path.sep) : path.dirname(real);
}

function keyRootDefault(env = process.env) {
  const root = env.CC_BASELINE_CLAIMS_KEYS;
  if (root !== undefined && root !== '' && !path.isAbsolute(root)) throw new ClaimsError('CC_BASELINE_CLAIMS_KEYS must be an absolute path');
  return root || path.join(os.homedir(), '.claude', 'claims-keys');
}

// The real path of the nearest part of `p` that exists, with the rest appended.
function realish(p) {
  let head = path.resolve(p);
  const tail = [];
  while (!fs.existsSync(head)) {
    const up = path.dirname(head);
    if (up === head) break;
    tail.unshift(path.basename(head));
    head = up;
  }
  return path.join(fs.realpathSync(head), ...tail);
}

function keyFileFor(runDir, keyRoot) {
  const id = sha256(fs.realpathSync(runDir)).slice(0, 16);
  return path.join(path.resolve(keyRoot), id, 'key.json');
}

// ── lint ──────────────────────────────────────────────────────────────────

function isLongValue(v) {
  return typeof v === 'string' && (v.length > LONG_EXPECTED_CHARS || v.trim().split(/\s+/).length >= LONG_EXPECTED_WORDS);
}

function checkItem(x, kind, seen, problems) {
  const isClaim = kind === 'claim';
  const where = x && isStr(x.id) ? x.id : `${kind} line`;
  const err = m => problems.errors.push(`${where}: ${m}`);
  const warn = m => problems.warnings.push(`${where}: ${m}`);
  if (!x || typeof x !== 'object' || Array.isArray(x)) { err('must be a JSON object'); return; }
  for (const k of Object.keys(x)) if (!(isClaim ? CLAIM_KEYS : PREMISE_KEYS).includes(k)) err(`unknown field ${k}`);
  if (!isStr(x.id) || !(isClaim ? CLAIM_ID_RE : PREMISE_ID_RE).test(x.id)) err(`id must look like ${isClaim ? 'C-0001' : 'P-001'}`);
  else if (seen.has(x.id)) err('duplicate id');
  else seen.add(x.id);
  if (!isStr(x.text)) err('text is required');
  else if (x.text.length > TEXT_MAX) err(`text is longer than ${TEXT_MAX} characters — one fact per claim`);
  if (!CHANNELS.includes(x.channel)) err(`channel must be one of ${CHANNELS.join(' | ')}`);
  if (x.expected === undefined || x.expected === null || x.expected === '') err('expected is required (the value the claim asserts)');
  if (isClaim) {
    if (!x.target || !TARGET_KINDS.includes(x.target.kind) || !isStr(x.target.ref)) err(`target needs kind (${TARGET_KINDS.join(' | ')}) and ref`);
    if (!IMPACTS.includes(x.impact)) err(`impact must be one of ${IMPACTS.join(' | ')}`);
    if (x.premises !== undefined && !(Array.isArray(x.premises) && x.premises.every(isStr))) err('premises must be a list of premise ids');
  } else if (x.target !== undefined && !(x.target && TARGET_KINDS.includes(x.target.kind) && isStr(x.target.ref))) {
    err(`target needs kind (${TARGET_KINDS.join(' | ')}) and ref`);
  }
  if (x.source_refs !== undefined && !(Array.isArray(x.source_refs) && x.source_refs.every(isStr))) err('source_refs must be a list of strings');
  if (x.channel === 'web' && !(isStr(x.source_url) && /^https?:\/\/\S+$/i.test(x.source_url))) err('a web claim needs source_url (http or https)');
  if (x.source_url !== undefined && !(isStr(x.source_url) && /^https?:\/\/\S+$/i.test(x.source_url))) err('source_url must be an http or https URL');
  // A claim whose expected value is a list (the origins are A and B) is one fact about one list.
  if (isStr(x.text) && !Array.isArray(x.expected) && CONJUNCTION_RE.test(x.text)) warn('may state more than one fact — split it, or keep it if it is one fact');
  if (isStr(x.text) && SUBJECTIVE_RE.test(x.text)) warn('subjective word — say what can be checked');
  if (isLongValue(x.expected)) warn(`expected should be the one value the claim asserts (a number, a name, true/false) — a whole sentence (${x.expected.length} chars) can make a canary true by chance`);
}

// claims-run.json, when there is one: the db spec must give a read-only way in,
// and the screen spec must name a start path and persona per target.
function lintSpec(p, problems) {
  const err = m => problems.errors.push(`claims-run.json: ${m}`);
  let spec;
  try { spec = readJson(p.run, { optional: true }); } catch (e) { err(e.message); return; }
  if (spec === null) return;
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) { err('must be a JSON object'); return; }
  if (spec.project !== undefined && !isStr(spec.project)) err('project must be a non-empty string');
  if (spec.web !== undefined && typeof spec.web !== 'boolean') err('web must be true or false');
  if (spec.project === undefined) problems.warnings.push('claims-run.json: no project — Jev samples of this run cannot be told apart by project at calibration');
  const db = spec.db;
  if (db !== undefined) {
    if (!db || typeof db !== 'object' || Array.isArray(db)) err('db must be an object');
    else {
      if (db.readonly !== true) err('db.readonly must be true — verifiers only read');
      if (!isStr(db.dsn_env) && db.connect === undefined) err('db needs dsn_env or connect (the command that opens a read-only session)');
      if (db.connect !== undefined && !(Array.isArray(db.connect) && db.connect.length > 0 && db.connect.every(isStr))) {
        err('db.connect must be a list of non-empty strings (the command and its arguments, no shell)');
      }
      if (db.readonly_login !== undefined && typeof db.readonly_login !== 'boolean') err('db.readonly_login must be true or false');
    }
  }
  const screen = spec.screen;
  if (screen !== undefined) {
    if (!screen || typeof screen !== 'object' || Array.isArray(screen)) { err('screen must be an object'); return; }
    if (!isStr(screen.base_url)) err('screen.base_url is required');
    if (screen.targets !== undefined) {
      if (!screen.targets || typeof screen.targets !== 'object' || Array.isArray(screen.targets)) err('screen.targets must be an object keyed by target.ref');
      else {
        for (const [ref, t] of Object.entries(screen.targets)) {
          if (!t || typeof t !== 'object' || !isStr(t.start_path) || !t.start_path.startsWith('/') || !isStr(t.persona)) {
            err(`screen.targets[${JSON.stringify(ref)}] needs start_path (starting with /) and persona`);
          }
        }
      }
    }
  }
}

function lintRun(runDir) {
  const p = runPaths(runDir);
  const claims = readJsonl(p.claims);
  const premises = readJsonl(p.premises, { optional: true });
  const problems = { errors: [], warnings: [] };
  lintSpec(p, problems);
  const seen = new Set();
  for (const x of premises) checkItem(x, 'premise', seen, problems);
  for (const x of claims) checkItem(x, 'claim', seen, problems);
  const premiseIds = new Set(premises.map(x => x && x.id));
  for (const c of claims) {
    for (const ref of (c && Array.isArray(c.premises) ? c.premises : [])) {
      if (!premiseIds.has(ref)) problems.errors.push(`${c.id}: premise ${ref} is not in premises.jsonl`);
    }
  }
  if (claims.length === 0) problems.errors.push('claims.jsonl has no claim');
  return { ...problems, claims, premises };
}

// ── prepare (freeze + canaries) ───────────────────────────────────────────

// Small deterministic PRNG, so the same seed gives the same audit input.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(list, rng) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// A changed value must still look like the kind of value the claim is about: an HTTP
// status stays a real status code, a year moves into the past, a count changes size.
function bump(n, rng, { status = false, year = false } = {}) {
  if (Number.isInteger(n)) {
    let options;
    if (status && n >= 100 && n <= 599) options = HTTP_STATUSES.filter(v => v !== n);
    else if (year && n >= 1900 && n <= 2100) options = [n - 1, n - 2];
    else options = [n + 1, n - 1, n + 2, n * 2, n + 10].filter(v => v !== n && v >= 0);
    return options[Math.floor(rng() * options.length)];
  }
  const decimals = (String(n).split('.')[1] || '').length;
  const v = Number((n * 1.5).toFixed(decimals));
  return v === n ? n + 1 : v;
}

const NUM_RE = /-?\d+(?:\.\d+)?/;
// A number that stands alone (not part of an identifier like t1 or a longer number).
const WHOLE_NUM_RE = /(?<![\p{L}\p{N}_.])-?\d+(?:\.\d+)?(?!\p{N}|\.\p{N})/u;

function escapeRe(x) { return x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// A regex for one whole occurrence of `token` — never a piece of a longer number or word.
// `edges`: guard only the ends that are letters or digits, so a quoted piece of source
// (`="HS256"`) still matches where it sits right after a word.
function wholeRe(token, { edges = false } = {}) {
  if (/^-?\d+(?:\.\d+)?$/.test(token)) return new RegExp(`(?<![\\p{L}\\p{N}_.])${escapeRe(token)}(?!\\p{N}|\\.\\p{N})`, 'u');
  const head = !edges || /^[\p{L}\p{N}_]/u.test(token) ? '(?<![\\p{L}\\p{N}_])' : '';
  const tail = !edges || /[\p{L}\p{N}_]$/u.test(token) ? '(?![\\p{L}\\p{N}_])' : '';
  return new RegExp(`${head}${escapeRe(token)}${tail}`, 'u');
}

// Replaces one whole occurrence of `token`.
function replaceWhole(text, token, next) {
  const re = wholeRe(token);
  if (!re.test(text)) return null;
  return text.replace(re, () => next);
}

function datesOf(text) { return String(text).match(new RegExp(DATE_RE.source, 'g')) || []; }

// The first whole number of `text` that is not part of a date.
function numberOutsideDates(text) {
  const spans = [];
  for (const m of text.matchAll(new RegExp(DATE_RE.source, 'g'))) spans.push([m.index, m.index + m[0].length]);
  for (const m of text.matchAll(new RegExp(WHOLE_NUM_RE.source, 'gu'))) {
    if (!spans.some(([a, b]) => m.index >= a && m.index < b)) return m[0];
  }
  return null;
}

function mutateNumber(c, rng) {
  const text = c.text;
  const exp = c.expected;
  if (typeof exp === 'string' && DATE_RE.test(exp)) return null;   // a date moves by days (mutateDate)
  let token = null;
  if (typeof exp === 'number') token = String(exp);
  else if (typeof exp === 'string' && NUM_RE.test(exp)) token = exp.match(NUM_RE)[0];
  else if (exp === true) token = numberOutsideDates(text);
  if (token === null) return null;
  const next = String(bump(Number(token), rng, { status: STATUS_CONTEXT_RE.test(text), year: YEAR_CONTEXT_RE.test(text) }));
  if (next === token) return null;
  const newText = replaceWhole(text, token, next);
  if (newText === null) return null;
  // the number replaced must not have been a piece of a date in the sentence
  if (datesOf(newText).join() !== datesOf(text).join()) return null;
  let newExp = exp;
  if (typeof exp === 'number') newExp = Number(next);
  else if (typeof exp === 'string') newExp = replaceWhole(exp, token, next);
  if (newExp === null) return null;
  return { text: newText, expected: newExp };
}

// A date keeps its year and month and moves 1–3 days (back when it can), so it stays
// a plausible date — never one far in the future.
function mutateDate(c, rng) {
  const exp = c.expected;
  const source = typeof exp === 'string' && DATE_RE.test(exp) ? exp : exp === true ? c.text : null;
  const m = source && source.match(DATE_RE);
  if (!m) return null;
  const day = Number(m[3]);
  const shift = 1 + Math.floor(rng() * 3);
  const nd = day >= 4 ? day - shift : day + shift;
  const next = `${m[1]}-${m[2]}-${String(nd).padStart(2, '0')}`;
  const text = replaceWhole(c.text, m[0], next);
  if (text === null) return null;
  const expected = typeof exp === 'string' ? replaceWhole(exp, m[0], next) : exp;
  return expected === null ? null : { text, expected };
}

// The shape of an expected value: a canary that swaps values swaps only within a shape,
// so the changed sentence does not give itself away ("signs tokens with the 1440 algorithm").
function valueShape(v, text = '') {
  if (typeof v === 'number') {
    if (Number.isInteger(v) && v >= 100 && v <= 599 && STATUS_CONTEXT_RE.test(text)) return 'status';
    return Number.isInteger(v) ? 'int' : 'dec';
  }
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (/^-?\d+$/.test(s)) return valueShape(Number(s), text);
  if (/^v\d+(?:\.\d+)*$|^\d+(?:\.\d+){2,3}$/.test(s)) return 'version';
  if (/^-?\d+\.\d+$/.test(s)) return 'dec';
  if (DATE_RE.test(s) && /^\d{4}-\d{2}-\d{2}/.test(s)) return 'date';
  if (/^https?:\/\/\S+$/i.test(s)) return 'url';
  if (/^[A-Z0-9_]+$/.test(s) && /[A-Z]/.test(s)) return 'constant';
  if (/^[a-z0-9_]+$/.test(s) && /[a-z]/.test(s)) return 'identifier';
  if (/^\S+$/.test(s)) return 'word';
  return 'phrase';
}

function mutateNegation(c) {
  if (typeof c.expected !== 'boolean') return null;
  for (const [neg, pos] of NEGATIONS) {
    if (c.text.includes(neg)) return { text: c.text.replace(neg, pos), expected: !c.expected };
  }
  for (const [neg, pos] of NEGATIONS) {
    if (c.text.includes(pos)) return { text: c.text.replace(pos, neg), expected: !c.expected };
  }
  return null;
}

function mutateSwap(c, claims, rng) {
  if (!(typeof c.expected === 'string' || typeof c.expected === 'number')) return null;
  const own = String(c.expected);
  if (!own.trim() || isLongValue(c.expected)) return null;
  const shape = valueShape(c.expected, c.text);
  if (shape === 'date') return null;   // a date only moves by a few days (mutateDate)
  // Only from another target: a value of the same target (another column of the same table)
  // may by chance be true, and a correct verifier would then look like it missed a canary.
  // Only of the same shape: a version in place of a password is false on its face.
  const others = claims.filter(o => o.id !== c.id && o.channel === c.channel && o.target && c.target && o.target.kind === c.target.kind
    && o.target.ref !== c.target.ref
    && (typeof o.expected === 'string' || typeof o.expected === 'number') && String(o.expected) !== own && String(o.expected).trim()
    && !isLongValue(o.expected) && valueShape(o.expected, o.text) === shape);
  if (others.length === 0) return null;
  const o = others[Math.floor(rng() * others.length)];
  const text = replaceWhole(c.text, own, String(o.expected));
  return text === null ? null : { text, expected: o.expected };
}

function neutral(x, override = {}) {
  const item = { text: override.text !== undefined ? override.text : x.text };
  if (x.target) item.target = { kind: x.target.kind, ref: x.target.ref };
  item.channel = x.channel;
  item.expected = override.expected !== undefined ? override.expected : x.expected;
  if (x.channel === 'web' && isStr(x.source_url)) item.source_hint = x.source_url;
  return item;
}

function makeCanaries(claims, { mode, rate, rng }) {
  const texts = new Set(claims.map(c => c.text));
  const out = [];
  const tryMake = c => {
    for (const op of shuffle(['number', 'date', 'negate', 'swap'], rng)) {
      const m = op === 'number' ? mutateNumber(c, rng) : op === 'date' ? mutateDate(c, rng)
        : op === 'negate' ? mutateNegation(c) : mutateSwap(c, claims, rng);
      if (!m || m.text === c.text || texts.has(m.text)) continue;
      texts.add(m.text);
      return { of: c.id, op, item: neutral(c, m) };
    }
    return null;
  };
  if (mode === 'light') {
    const need = Math.max(LIGHT_CANARIES, Math.round(claims.length * rate));
    for (const c of shuffle(claims, rng)) {
      if (out.length >= need) break;
      const k = tryMake(c);
      if (k) out.push(k);
    }
    return out;
  }
  const byChannel = new Map();
  for (const c of claims) { if (!byChannel.has(c.channel)) byChannel.set(c.channel, []); byChannel.get(c.channel).push(c); }
  for (const ch of [...byChannel.keys()].sort()) {
    const list = byChannel.get(ch);
    const need = Math.max(BULK_CANARIES_PER_CHANNEL, Math.round(list.length * rate));
    let made = 0;
    // Two passes, so a channel with few claims can still reach its minimum with a second mutation.
    for (let pass = 0; pass < 2 && made < need; pass++) {
      for (const c of shuffle(list, rng)) {
        if (made >= need) break;
        const k = tryMake(c);
        if (k) { out.push(k); made++; }
      }
    }
  }
  return out;
}

function prepare(runDir, { seed = 1, rate = DEFAULT_RATE, mode, keyRoot = keyRootDefault() } = {}) {
  const p = runPaths(runDir);
  if (fs.existsSync(p.verdicts) && fs.readFileSync(p.verdicts, 'utf8').trim()) {
    throw new ClaimsError('verdicts.jsonl exists — a new prepare renumbers every item; move it away (and start the audit again) first');
  }
  const linted = lintRun(runDir);
  if (linted.errors.length) throw new ClaimsError(`lint found ${linted.errors.length} error(s) — run claims.js lint and fix them first`);
  const { claims, premises } = linted;
  const runMode = mode || (claims.length >= BULK_MIN ? 'bulk' : 'light');
  if (!MODES.includes(runMode)) throw new ClaimsError(`--mode must be one of ${MODES.join(' | ')}`);
  if (!(rate > 0 && rate < 1)) throw new ClaimsError('--canary-rate must be between 0 and 1');
  const rng = mulberry32(seed);
  const canaries = makeCanaries(claims, { mode: runMode, rate, rng });
  const realP = shuffle(premises.map(x => ({ orig: x.id, kind: 'premise', item: neutral(x) })), rng);
  const mix = shuffle([
    ...claims.map(x => ({ orig: x.id, kind: 'claim', item: neutral(x) })),
    ...canaries.map(k => ({ orig: k.of, kind: 'claim', canary: true, op: k.op, item: k.item })),
  ], rng);
  const ordered = [...realP, ...mix];
  const items = {};
  const lines = ordered.map((o, i) => {
    const id = `A-${String(i + 1).padStart(4, '0')}`;
    items[id] = o.canary ? { orig: o.orig, canary: true, op: o.op } : { orig: o.orig };
    return { id, kind: o.kind, ...o.item };
  });
  const inputText = lines.map(r => JSON.stringify(r)).join('\n') + '\n';
  const keyFile = keyFileFor(p.dir, keyRoot);
  const root = projectRoot(p.dir);
  if (realish(keyFile).startsWith(root + path.sep)) throw new ClaimsError(`the canary key root ${keyRoot} is inside the project ${root} — move it out`);
  fs.mkdirSync(path.dirname(keyFile), { recursive: true, mode: 0o700 });
  for (const d of [path.resolve(keyRoot), path.dirname(keyFile)]) fs.chmodSync(d, 0o700);
  let keyStat = null;
  try { keyStat = fs.lstatSync(keyFile); } catch { /* no key yet */ }
  if (keyStat && keyStat.isSymbolicLink()) throw new ClaimsError(`${keyFile} is a symlink — refusing to write the key through it`);
  const key = { run: fs.realpathSync(p.dir), audit_input_sha256: sha256(inputText), items };
  writeJson(keyFile, key);
  fs.chmodSync(keyFile, 0o600);
  fs.writeFileSync(p.input, inputText, { mode: 0o600 });
  const freeze = {
    mode: runMode, seed, canary_rate: rate, items: lines.length, claims: claims.length, premises: premises.length, canaries: canaries.length,
    claims_sha256: sha256(fs.readFileSync(p.claims)),
    premises_sha256: fs.existsSync(p.premises) ? sha256(fs.readFileSync(p.premises)) : null,
    audit_input_sha256: sha256(fs.readFileSync(p.input)),
    key_file: keyFile,
  };
  writeJson(p.freeze, freeze);
  return { mode: runMode, items: lines.length, canaries: canaries.length, audit_input: p.input, key_file: keyFile };
}

// ── check-verifiers ───────────────────────────────────────────────────────

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isSymbolicLink()) { out.push({ file: full, symlink: true }); continue; }
    if (e.isDirectory()) out.push(...walk(full));
    else if (e.isFile()) out.push({ file: full });
  }
  return out;
}

function checkVerifiers(runDir, { keyRoot = keyRootDefault() } = {}) {
  const p = runPaths(runDir);
  const spec = readJson(p.run, { optional: true }) || {};
  const root = projectRoot(p.dir);
  const forbidden = (Array.isArray(spec.forbidden_paths) ? spec.forbidden_paths : []).filter(isStr);
  // A string heuristic: a path built at run time is not seen. The real boundary is
  // fact-auditor's instructions (reference_claim_verification.md §8).
  const needles = new Set();
  for (const f of forbidden) {
    const clean = f.replace(/\/+$/, '');
    needles.add(clean);
    needles.add(path.resolve(root, clean));
    const last = path.basename(clean);
    if (last.length >= 4) needles.add(last);
  }
  needles.add(path.resolve(keyRoot));
  needles.add('claims-k');
  const hits = [];
  let vstat = null;
  try { vstat = fs.lstatSync(p.verifiers); } catch { /* no verifiers dir */ }
  if (vstat && vstat.isSymbolicLink()) {
    return { files: 0, hits: [{ file: 'verifiers', line: 0, reason: 'the verifiers dir is a symlink' }] };
  }
  const files = walk(p.verifiers);
  for (const { file, symlink } of files) {
    const rel = path.relative(p.dir, file);
    if (symlink) { hits.push({ file: rel, line: 0, reason: 'symlink — verifier files must be plain files' }); continue; }
    if (fs.statSync(file).size > FILE_MAX) { hits.push({ file: rel, line: 0, reason: 'larger than 2 MB — not read' }); continue; }
    const buf = fs.readFileSync(file);
    if (buf.includes(0)) { hits.push({ file: rel, line: 0, reason: 'binary file — verifiers must be readable scripts' }); continue; }
    const text = buf.toString('utf8');
    text.split('\n').forEach((line, i) => {
      for (const n of needles) if (n && line.includes(n)) hits.push({ file: rel, line: i + 1, reason: `refers to a forbidden path (${n})` });
    });
    // Folded so a statement split over lines is still one match; the line is where it starts.
    const folded = text.replace(/\s/g, ' ');
    WRITE_SQL_RE.lastIndex = 0;
    for (let m; (m = WRITE_SQL_RE.exec(folded));) {
      hits.push({ file: rel, line: text.slice(0, m.index).split('\n').length, reason: `write SQL (${m[0].trim().slice(0, 30)}) — verifiers only read` });
    }
  }
  return { files: files.length, hits };
}

// ── screen-tc / import-results ────────────────────────────────────────────

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'run';
}

function screenTc(runDir) {
  const p = runPaths(runDir);
  const items = readJsonl(p.input).filter(x => x.channel === 'screen');
  if (items.length === 0) throw new ClaimsError('audit-input.jsonl has no screen item');
  const feature = `claims-${slug(p.name)}`;
  const byTarget = new Map();
  for (const x of items) {
    const ref = x.target && x.target.ref ? x.target.ref : 'unknown';
    if (!byTarget.has(ref)) byTarget.set(ref, []);
    byTarget.get(ref).push(x);
  }
  const doc = {
    schema_version: 1, feature, title: `View-only checks of the screen claims in run ${p.name}`, plan: slug(p.name),
    sources: [{ id: 'REQ.claims-run', kind: 'requirement', locator: `.cc-audits/claims/${p.name}/audit-input.jsonl` }],
    actions: [{ id: `ACT.${feature}.view`, title: 'Open a screen and read it', actor: 'user', trigger: 'opens the screen',
      preconditions: [], outputs: ['what the screen shows'], evidence_refs: ['REQ.claims-run'] }],
    test_cases: [...byTarget.entries()].map(([ref, list], i) => ({
      id: `TC.${feature}.s${i + 1}`, title: `Screen ${ref}`, action_refs: [`ACT.${feature}.view`], level: 'functional', surface: 'ui-web',
      preconditions: [], steps: [{ goal: `Open ${ref}`, done_when: { expect: 'The page has loaded' } }],
      expected: list.map(x => ({ text: x.text, observe: { channel: 'dom' }, notes: x.id })),
      basis: { kind: 'requirement', refs: ['REQ.claims-run'] }, readiness: 'ready',
      notes: 'view only — do not change data; judge each expected result as written',
    })),
    open_questions: [],
  };
  writeJson(p.screenTc, doc, 0o644);
  const refs = [...byTarget.keys()];
  return { file: p.screenTc, test_cases: doc.test_cases.length, expected: items.length,
    ...screenRunDraft(p, doc, refs) };
}

// The run add-on e2e-tester needs (`.cc-audits/<plan>/tc-run.json`, the only place the
// tools read it from), drafted from `screen` in claims-run.json. An existing file is
// the manager's and is never overwritten.
function screenRunDraft(p, doc, refs) {
  const spec = readJson(p.run, { optional: true }) || {};
  const screen = spec.screen && typeof spec.screen === 'object' && !Array.isArray(spec.screen) ? spec.screen : null;
  if (!screen || !isStr(screen.base_url)) return { run_file: null, run_file_status: 'no screen spec in claims-run.json' };
  const targets = screen.targets && typeof screen.targets === 'object' && !Array.isArray(screen.targets) ? screen.targets : {};
  const runFile = path.join(projectRoot(p.dir), '.cc-audits', doc.plan, 'tc-run.json');
  const tcs = {};
  const missing = [];
  doc.test_cases.forEach((tc, i) => {
    const t = Object.prototype.hasOwnProperty.call(targets, refs[i]) ? targets[refs[i]] : null;
    if (!(t && isStr(t.start_path) && isStr(t.persona))) { missing.push(refs[i]); return; }
    tcs[tc.id] = { start_path: t.start_path, persona: t.persona, ...(isStr(t.fixture) ? { fixture: t.fixture } : {}),
      data: {}, secret_env: [], ...(isStr(t.notes) ? { notes: t.notes } : {}) };
  });
  if (fs.existsSync(runFile)) return { run_file: runFile, run_file_status: 'kept', missing_targets: missing };
  const draft = { base_url: screen.base_url, ...(isStr(screen.reset_command) ? { reset_command: screen.reset_command } : {}),
    ...(screen.fixtures && typeof screen.fixtures === 'object' && !Array.isArray(screen.fixtures) ? { fixtures: screen.fixtures } : {}), tcs };
  fs.mkdirSync(path.dirname(runFile), { recursive: true, mode: 0o700 });
  writeJson(runFile, draft);
  return { run_file: runFile, run_file_status: 'written', missing_targets: missing };
}

// Only result lines recorded for this screen.tc.json (same TC digest, the one
// `tc-jev-judge.js record` writes) count; --run-id narrows them to one run.
function importResults(runDir, { results, runId } = {}) {
  const p = runPaths(runDir);
  const doc = readJson(p.screenTc);
  const lines = readJsonl(path.resolve(results));
  const map = new Map();
  const digest = new Map(doc.test_cases.map(tc => [tc.id, sha256(canonical(tc))]));
  for (const tc of doc.test_cases) tc.expected.forEach((e, i) => map.set(`${tc.id}#${i}`, e.notes));
  const latest = new Map();
  let skipped = 0;
  for (const l of lines) {
    if (!(l && digest.has(l.tc))) continue;
    if (l.tc_digest !== digest.get(l.tc) || (runId && l.run_id !== runId)) { skipped++; continue; }
    latest.set(l.tc, l);
  }
  const out = [];
  for (const [tcId, l] of latest) {
    for (const e of Array.isArray(l.expected) ? l.expected : []) {
      const id = map.get(`${tcId}#${e.index}`);
      if (!id) continue;
      const verdict = e.verdict === 'PASS' ? 'SUPPORTED' : e.verdict === 'FAIL' ? 'REFUTED' : 'UNVERIFIABLE';
      out.push({ id, verdict, grade: 'A', verifier: 'e2e',
        evidence: { source: 'screen', excerpt: String(e.observed == null ? '' : e.observed).slice(0, 300), how: `e2e-tester run ${l.run_id || ''}`.trim() } });
    }
  }
  fs.appendFileSync(p.verdicts, out.map(r => JSON.stringify(r)).join('\n') + (out.length ? '\n' : ''), { mode: 0o600 });
  return { imported: out.length, skipped_lines: skipped };
}

// ── score ─────────────────────────────────────────────────────────────────

// The ledgers and the audit input must be the ones prepare froze; the key is
// bound to that input by its hash (so the run dir may move).
function checkFreeze(p, freeze) {
  const now = f => (fs.existsSync(f) ? sha256(fs.readFileSync(f)) : null);
  const changed = [];
  if (now(p.claims) !== freeze.claims_sha256) changed.push('claims.jsonl');
  if (now(p.premises) !== freeze.premises_sha256) changed.push('premises.jsonl');
  if (now(p.input) !== freeze.audit_input_sha256) changed.push('audit-input.jsonl');
  if (changed.length) throw new ClaimsError(`${changed.join(', ')} changed after prepare — run prepare again and audit again`);
}

function readKey(p, freeze, keyRoot) {
  const key = readJson(freeze.key_file || keyFileFor(p.dir, keyRoot));
  if (key.audit_input_sha256 !== freeze.audit_input_sha256) throw new ClaimsError('the canary key belongs to another audit input');
  return key;
}

function latestVerdicts(p) {
  const by = new Map();
  for (const v of readJsonl(p.verdicts, { optional: true })) if (v && isStr(v.id)) by.set(v.id, v);
  return by;
}

function checkVerdict(v) {
  const bad = [];
  for (const k of Object.keys(v)) if (!VERDICT_KEYS.includes(k)) bad.push(`unknown field ${k}`);
  if (!VERDICTS.includes(v.verdict)) bad.push(`verdict must be one of ${VERDICTS.join(' | ')}`);
  if (!GRADES.includes(v.grade)) bad.push(`grade must be one of ${GRADES.join(' | ')}`);
  if (v.verdict !== 'UNVERIFIABLE' && !(v.evidence && isStr(v.evidence.source) && (isStr(v.evidence.excerpt) || isStr(v.evidence.how)))) {
    bad.push('a SUPPORTED or REFUTED verdict needs evidence.source and evidence.excerpt or evidence.how');
  }
  if (v.jev_sample !== undefined && !SHA_RE.test(String(v.jev_sample))) bad.push('jev_sample must be a sample id (64 hex)');
  if (v.recheck !== undefined) bad.push(...checkRecipe(v.recheck));
  return bad;
}

// A recheck recipe: exactly one of file / log / sql / url, the text that decides the item, and
// for a file an optional line.
function checkRecipe(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) return ['recheck must be an object'];
  const bad = [];
  for (const k of Object.keys(r)) if (!RECHECK_KEYS.includes(k)) bad.push(`recheck: unknown field ${k}`);
  const kinds = RECHECK_KINDS.filter(k => r[k] !== undefined);
  if (kinds.length !== 1) bad.push('recheck needs exactly one of file, log, sql or url');
  else if (!isStr(r[kinds[0]])) bad.push(`recheck.${kinds[0]} must be a non-empty string`);
  if (!isStr(r.contains) || r.contains.length > CONTAINS_MAX) bad.push(`recheck.contains must be a non-empty string of at most ${CONTAINS_MAX} characters`);
  if (r.line !== undefined && !(kinds.length === 1 && kinds[0] === 'file' && Number.isInteger(r.line) && r.line > 0)) {
    bad.push('recheck.line must be a positive integer, on a file recipe only');
  }
  return bad;
}

// The stored sample for `sha` if it is Q.claim_supported asked for item `id` of run `run`.
function jevSampleOf(bank, sha, run, id) {
  const question = `${CLAIM_QUESTION.id}@${CLAIM_QUESTION.version}`;
  return bank.find(x => x.request_sha256 === sha && x.question === question && x.tc === `claims:${run}` && x.index === id) || null;
}

// Grade B on code means a structural fact read at a known place: a file recipe with its
// line, so recheck finds the deciding text there and not anywhere in the file.
function codeBCapped(x, v) {
  return x.channel === 'code' && v.grade === 'B' && !(v.recheck && isStr(v.recheck.file) && Number.isInteger(v.recheck.line));
}

// A value short enough to be looked for as it stands: a number, or a string of at most 40 characters.
function shortValue(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : null;
  // a word of one or two letters ("no", "on") is found in almost any passage — not checked
  return typeof v === 'string' && v.trim().length <= 40 && !/^\p{L}{0,2}$/u.test(v.trim()) ? v.trim() : null;
}

// A SUPPORTED verdict whose recipe re-reads text that does not show the claim's expected value:
// recheck can then say "reproduced" about a passage that does not decide the claim.
function weakRecipe(c, v) {
  if (v.verdict !== 'SUPPORTED' || !v.recheck || !isStr(v.recheck.contains)) return false;
  const want = shortValue(c.expected);
  if (want === null) return false;
  const fold = t => String(t).toLowerCase().replace(/(?<=\d),(?=\d{3}(?!\d))/g, '').replace(/(?<=\d)\s+(?=%)/g, '');
  return !hasWhole(fold(v.recheck.contains), fold(want));
}

function score(runDir, { keyRoot = keyRootDefault(), jevDir = jevDirDefault() } = {}) {
  const p = runPaths(runDir);
  const input = readJsonl(p.input);
  const freeze = readJson(p.freeze);
  checkFreeze(p, freeze);
  const key = readKey(p, freeze, keyRoot);
  const verdicts = latestVerdicts(p);
  const claims = new Map(readJsonl(p.claims).map(c => [c.id, c]));
  const missing = input.filter(x => !verdicts.has(x.id)).map(x => x.id);
  const invalid = [];
  for (const x of input) { const v = verdicts.get(x.id); if (v) for (const b of checkVerdict(v)) invalid.push(`${x.id}: ${b}`); }
  // The verifier check runs here too: the auditor's own "check-verifiers: pass" is a pointer, not the gate.
  const vcheck = checkVerifiers(runDir, { keyRoot });
  for (const h of vcheck.hits) invalid.push(`verifier ${h.file}${h.line ? `:${h.line}` : ''}: ${h.reason}`);
  if (missing.length || invalid.length) return { ok: false, missing, invalid };

  // A canary called SUPPORTED is a miss: the channel's SUPPORTED verdicts are not trusted.
  // UNVERIFIABLE is an honest abstention (counted, but it costs no trust).
  const channels = {};
  for (const x of input) {
    const ch = channels[x.channel] || (channels[x.channel] = { items: 0, canaries: 0, caught: 0, missed: [], abstained: 0, trusted: null });
    ch.items++;
    if (key.items[x.id] && key.items[x.id].canary) {
      ch.canaries++;
      const verdict = verdicts.get(x.id).verdict;
      if (verdict === 'REFUTED') ch.caught++;
      else if (verdict === 'SUPPORTED') ch.missed.push(x.id);
      else ch.abstained++;
    }
  }
  for (const ch of Object.values(channels)) ch.trusted = ch.caught + ch.missed.length === 0 ? null : ch.missed.length === 0;

  // A premise judged on an untrusted channel counts as unchecked.
  const premiseVerdict = {};
  for (const x of input) {
    if (x.kind !== 'premise') continue;
    premiseVerdict[key.items[x.id].orig] = channels[x.channel].trusted === false ? 'UNVERIFIABLE' : verdicts.get(x.id).verdict;
  }
  const items = {};
  const premisesOut = {};
  for (const x of input) {
    const k = key.items[x.id];
    if (k.canary) continue;
    const v = verdicts.get(x.id);
    // A structural fact read from code is grade B only with a recipe recheck can run again;
    // without one it counts as reading the source (C).
    const capped = codeBCapped(x, v);
    const grade = capped ? 'C' : v.grade;
    const row = { audit_id: x.id, channel: x.channel, verdict: v.verdict, grade, verifier: v.verifier || null,
      evidence: v.evidence || null, ...(v.jev_sample ? { jev_sample: v.jev_sample } : {}),
      ...(capped ? { grade_capped: 'B→C (no file recipe with a line)' } : {}) };
    if (x.kind === 'premise') { premisesOut[k.orig] = { ...row, status: channels[x.channel].trusted === false ? 'untrusted' : v.verdict.toLowerCase() }; continue; }
    const c = claims.get(k.orig) || {};
    const rested = Array.isArray(c.premises) ? c.premises : [];
    let status;
    if (v.verdict === 'REFUTED') status = 'refuted';
    else if (v.verdict === 'UNVERIFIABLE') status = 'unverifiable';
    else if (rested.some(id => premiseVerdict[id] === 'REFUTED')) status = 'stale';
    else if (rested.some(id => premiseVerdict[id] === 'UNVERIFIABLE')) status = 'premise_unverified';
    else if (channels[x.channel].trusted === false) status = 'untrusted';
    else if (c.impact === 'decision' && (grade === 'C' || grade === 'D')) status = 'not_established';
    else status = 'supported';
    items[k.orig] = { ...row, text: c.text, impact: c.impact, premises: rested, status, ...(weakRecipe(c, v) ? { weak_recipe: true } : {}) };
  }

  // A canary Jev was asked about is a sample whose answer is known: false. The
  // sample must be the claim question asked for this very item of this run —
  // verdicts.jsonl is written by an agent, so an id alone is not trusted.
  let jevLabeled = 0;
  const refused = [];
  const bank = readSamples(jevDir);
  const known = new Set(bank.filter(s => s.label_source === 'code' && s.label === 'FAIL').map(s => s.request_sha256));
  for (const x of input) {
    const k = key.items[x.id];
    const v = verdicts.get(x.id);
    if (!(k.canary && v.jev_sample) || known.has(v.jev_sample)) continue;
    if (!jevSampleOf(bank, v.jev_sample, p.name, x.id)) { refused.push(x.id); continue; }
    jevLabel(jevDir, { sample: v.jev_sample, value: 'FAIL', source: 'code' });
    jevLabeled++;
    known.add(v.jev_sample);
  }

  // fact-auditor must store calibration samples for items it decided at A or B (its step 5);
  // a run without any is flagged, so the bank does not silently stop growing.
  const question = `${CLAIM_QUESTION.id}@${CLAIM_QUESTION.version}`;
  const jevSamples = bank.filter(s => s.question === question && s.tc === `claims:${p.name}`).length;
  const decidedAB = input.filter(x => { const v = verdicts.get(x.id); return v.verdict !== 'UNVERIFIABLE' && ['A', 'B'].includes(v.grade) && !codeBCapped(x, v) && v.verifier !== 'e2e'; }).length;
  const warnings = [];
  if (decidedAB > 0 && jevSamples === 0) {
    warnings.push(`no Jev claim sample was stored for this run although ${decidedAB} item(s) were decided at A or B — ask fact-auditor for its calibration samples (step 5), unless Jev has no key`);
  }

  const weak = Object.entries(items).filter(([, r]) => r.weak_recipe).map(([id]) => id);
  if (weak.length) warnings.push(`${weak.length} supported claim(s) are re-read on text that does not show the expected value (weak recipe): ${weak.join(', ')}`);
  // How much of the run could not be checked at all — a run with few refutations may simply have checked little.
  const share = rows => (rows.length ? Number((rows.filter(r => r.status === 'unverifiable').length / rows.length).toFixed(2)) : 0);
  const all = Object.values(items);
  const unverifiableShare = { all: share(all), by_channel: Object.fromEntries([...new Set(all.map(r => r.channel))].sort().map(ch => [ch, share(all.filter(r => r.channel === ch))])) };
  const lost = all.filter(r => r.status === 'unverifiable').length;
  if (all.length >= UNVERIFIABLE_WARN_MIN && lost / all.length >= UNVERIFIABLE_WARN_SHARE) {
    warnings.push(`${lost} of ${all.length} claims could not be checked — the run verified little; fix the access in claims-run.json or say so in the answer`);
  }
  const count = s => Object.values(items).filter(r => r.status === s).length;
  const out = {
    ok: true, run: p.name, mode: freeze.mode, items: input.length, channels,
    verifiers: { files: vcheck.files, problems: 0 },
    premises: premisesOut, claims: items,
    counts: {
      supported: count('supported'), refuted: count('refuted'), unverifiable: count('unverifiable'), stale: count('stale'),
      premise_unverified: count('premise_unverified'), untrusted: count('untrusted'), not_established: count('not_established'),
    },
    canaries: {
      total: Object.values(channels).reduce((a, c) => a + c.canaries, 0),
      caught: Object.values(channels).reduce((a, c) => a + c.caught, 0),
      missed: Object.values(channels).reduce((a, c) => a + c.missed.length, 0),
      abstained: Object.values(channels).reduce((a, c) => a + c.abstained, 0),
    },
    unverifiable_share: unverifiableShare,
    weak_recipes: weak,
    jev_labeled: jevLabeled,
    jev_samples: jevSamples,
    ...(refused.length ? { jev_label_refused: refused } : {}),
    warnings,
  };
  writeJson(p.score, out);
  return out;
}

// ── recheck ───────────────────────────────────────────────────────────────

class Refusal extends Error {}

function norm(s) { return String(s).replace(/\s+/g, ' ').trim(); }

// Whole-token match after folding whitespace: "4" never matches inside "14".
function hasWhole(hay, needle) {
  const n = norm(needle);
  return n !== '' && wholeRe(n, { edges: true }).test(norm(hay));
}

function clip(s) { return maskSecrets(norm(s)).slice(0, FOUND_MAX); }

function within(real, dir) { return real === dir || real.startsWith(dir + path.sep); }

// The paths a recipe may never read: the forbidden paths, the key root, this run dir.
function deniedRoots(spec, p, keyRoot) {
  const root = projectRoot(p.dir);
  const list = (Array.isArray(spec.forbidden_paths) ? spec.forbidden_paths : []).filter(isStr).map(f => realish(path.resolve(root, f)));
  return [...list, realish(keyRoot), fs.realpathSync(p.dir)];
}

// Opened without following a final symlink, and checked on the open file, so a link
// swapped in after the path checks is not read.
function readCapped(real, max) {
  let fd;
  try { fd = fs.openSync(real, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)); } catch (e) {
    throw new Refusal(e.code === 'ELOOP' ? 'a symlink' : `cannot open (${e.code || e.message})`);
  }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) throw new Refusal('not a file');
    if (st.size > max) throw new Refusal(`larger than ${Math.round(max / 1024 / 1024)} MB`);
    const buf = fs.readFileSync(fd);
    if (buf.includes(0)) throw new Refusal('binary file');
    return buf.toString('utf8');
  } finally { fs.closeSync(fd); }
}

function recheckFile(r, spec, p, denied) {
  const codeRoot = spec.code && isStr(spec.code.root) ? realish(path.resolve(projectRoot(p.dir), spec.code.root)) : null;
  const docs = (spec.doc && Array.isArray(spec.doc.paths) ? spec.doc.paths : []).filter(isStr).map(d => realish(path.resolve(projectRoot(p.dir), d)));
  if (!path.isAbsolute(r.file) && !codeRoot) throw new Refusal('a relative file needs code.root in claims-run.json');
  // real path of what exists, the rest appended: an outside path is refused even when it is missing
  const real = realish(path.isAbsolute(r.file) ? r.file : path.resolve(codeRoot, r.file));
  if (!((codeRoot && within(real, codeRoot)) || docs.includes(real))) throw new Refusal('outside code.root and doc.paths');
  if (!fs.existsSync(real)) return { status: 'differs', reason: 'file not found' };
  if (denied.some(d => within(real, d))) throw new Refusal('a forbidden path');
  const rel = codeRoot && within(real, codeRoot) ? path.relative(codeRoot, real) : path.basename(real);
  if (DENIED_READ_RE.test(rel.split(path.sep).join('/'))) throw new Refusal('a secret-looking file');
  const lines = readCapped(real, FILE_MAX).split('\n');
  let from = 0;
  let to = lines.length - 1;
  if (r.line) { from = Math.max(0, r.line - 1 - RECHECK_LINE_SLACK); to = Math.min(lines.length - 1, r.line - 1 + RECHECK_LINE_SLACK); }
  // nearest to the line the verifier named
  const order = [];
  for (let i = from; i <= to; i++) order.push(i);
  if (r.line) order.sort((a, b) => Math.abs(a - (r.line - 1)) - Math.abs(b - (r.line - 1)));
  for (const i of order) if (hasWhole(lines[i], r.contains)) return { status: 'reproduced', line: i + 1, found: clip(lines[i]) };
  return { status: 'differs', reason: r.line ? `not within ${RECHECK_LINE_SLACK} lines of line ${r.line}` : 'not in the file' };
}

function recheckLog(r, spec, p, denied) {
  const root = projectRoot(p.dir);
  const logs = (spec.log && Array.isArray(spec.log.paths) ? spec.log.paths : []).filter(isStr).map(l => realish(path.resolve(root, l)));
  const asked = realish(path.resolve(root, r.log));
  if (!logs.includes(asked)) throw new Refusal('not one of log.paths');
  if (denied.some(d => within(asked, d))) throw new Refusal('a forbidden path');
  if (DENIED_READ_RE.test(asked.split(path.sep).join('/'))) throw new Refusal('a secret-looking file');
  if (!fs.existsSync(asked)) return { status: 'differs', reason: 'log not found' };
  const hits = readCapped(asked, LOG_MAX).split('\n').filter(l => hasWhole(l, r.contains));
  return hits.length ? { status: 'reproduced', hits: hits.length, found: clip(hits[0]) } : { status: 'differs', reason: 'no matching line' };
}

// One read-only SELECT. The command is the orchestrator's (`db.connect`, argv, no shell);
// the SQL comes from an agent, so it is filtered here and, for postgres, wrapped in a
// read-only transaction.
function checkSql(sql) {
  if (sql.includes('\\')) throw new Refusal('a backslash (client command) in SQL');
  const body = sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').trim().replace(/;\s*$/, '').trim();
  if (!/^(?:SELECT|WITH)\b/i.test(body)) throw new Refusal('SQL must start with SELECT or WITH');
  if (body.includes(';')) throw new Refusal('one statement only');
  WRITE_SQL_RE.lastIndex = 0;
  if (WRITE_SQL_RE.test(body.replace(/\s/g, ' '))) throw new Refusal('write SQL');
  if (RECHECK_SQL_DENY_RE.test(body.replace(/\s/g, ' '))) throw new Refusal('a call that reads files, reaches other servers, moves sequences or locks rows');
  return body;
}

function runSql(body, db) {
  const { spawnSync } = require('child_process');
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !COMMAND_ENV_DROP.test(k)));
  const wrap = READONLY_WRAP[String(db.kind || '').toLowerCase()];
  const input = wrap ? wrap(body) : `${body}\n`;
  const r = spawnSync(db.connect[0], db.connect.slice(1), { input, encoding: 'utf8', timeout: SQL_TIMEOUT_MS, maxBuffer: SQL_OUT_MAX, env, shell: false });
  if (r.error) return { ok: false, reason: r.error.code === 'ETIMEDOUT' ? 'timed out' : `could not run db.connect (${r.error.code || r.error.message})` };
  if (r.status !== 0) return { ok: false, reason: `db.connect exited ${r.status}: ${clip(r.stderr || '')}` };
  return { ok: true, out: r.stdout || '' };
}

function recheckSql(r, spec, cache) {
  const db = spec.db;
  if (!(db && db.readonly === true && Array.isArray(db.connect) && db.connect.length && db.connect.every(isStr))) {
    throw new Refusal('needs db.connect and db.readonly: true in claims-run.json');
  }
  if (!READONLY_WRAP[String(db.kind || '').toLowerCase()] && db.readonly_login !== true) {
    throw new Refusal(`no read-only transaction for db.kind ${JSON.stringify(db.kind || '')} — set db.readonly_login: true only when db.connect logs in with a read-only account`);
  }
  const body = checkSql(r.sql);
  if (!cache.has(body)) cache.set(body, runSql(body, db));
  const res = cache.get(body);
  if (!res.ok) return { status: 'failed', reason: res.reason };
  const line = res.out.split('\n').find(l => hasWhole(l, r.contains));
  // only the matching row is kept; on a miss the output (other rows, maybe personal data) is not
  return line !== undefined ? { status: 'reproduced', found: clip(line) }
    : { status: 'differs', reason: `not in the query output (${res.out.split('\n').filter(l => l.trim()).length} line(s))` };
}

// ── recheck: a web page ────────────────────────────────────────────────────
// The URL comes from an agent that read web pages, so it is treated as hostile:
// https on the default port, a public host name, a public address at connect time,
// GET with no credentials, every redirect hop checked again, size / time / count caps.

const NON_PUBLIC = new net.BlockList();
for (const [a, n] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 3]]) NON_PUBLIC.addSubnet(a, n, 'ipv4');
// IPv4-mapped addresses are refused in publicAddress — as a BlockList subnet they would
// match every IPv4 address too.
// ::/96 (with :: and ::1), 6to4, Teredo and both NAT64 prefixes can embed an IPv4 address.
for (const [a, n] of [['::', 96], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64], ['2001::', 32], ['2001:db8::', 32],
  ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8]]) NON_PUBLIC.addSubnet(a, n, 'ipv6');

function ipv4Mapped(address) {
  try { return /^\[::ffff:/i.test(new URL(`http://[${address}]/`).hostname); } catch { return true; }
}

function publicAddress(address) {
  if (net.isIPv4(address)) return !NON_PUBLIC.check(address, 'ipv4');
  if (net.isIPv6(address)) return !ipv4Mapped(address) && !NON_PUBLIC.check(address, 'ipv6');
  return false;
}

function checkWebUrl(raw) {
  if (!isStr(raw) || raw.length > WEB_URL_MAX) throw new Refusal(`a URL longer than ${WEB_URL_MAX} characters`);
  let u;
  try { u = new URL(raw); } catch { throw new Refusal('not a URL'); }
  if (u.protocol !== 'https:') throw new Refusal('https only');
  if (u.username || u.password) throw new Refusal('user info in the URL');
  if (u.port) throw new Refusal('a port in the URL');
  const host = u.hostname.replace(/\.$/, '').toLowerCase();
  if (host.startsWith('[') || net.isIP(host)) throw new Refusal('an IP address as host');
  if (!host.includes('.') || /(?:^|\.)(?:localhost|local|localdomain|internal|intranet|lan|home|corp)$/.test(host)) throw new Refusal('not a public host name');
  return u;
}

// dns.lookup that fails unless every address of the name is public; the socket then
// connects to an address this function returned, so the name is not resolved twice.
function guardedLookup(dnsLookup) {
  return (hostname, options, cb) => {
    if (typeof options === 'function') { cb = options; options = {}; }
    dnsLookup(hostname, { all: true }, (err, list) => {
      if (err) return cb(err);
      const found = Array.isArray(list) ? list : [];
      if (!found.length || found.some(a => !publicAddress(a.address))) {
        return cb(Object.assign(new Error('the host resolves to a non-public address'), { code: 'ENOTPUBLIC' }));
      }
      if (options && options.all) return cb(null, found.map(a => ({ address: a.address, family: a.family })));
      return cb(null, found[0].address, found[0].family);
    });
  };
}

// One GET, no redirect followed. → { status, headers, body } | { error } | { refused }
function fetchUrlOnce(u, { dnsLookup = dns.lookup, request = https.request, timeoutMs = WEB_TIMEOUT_MS } = {}) {
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (!done) { done = true; clearTimeout(timer); resolve(v); } };
    const req = request({
      method: 'GET', hostname: u.hostname, port: 443, path: `${u.pathname}${u.search}`, agent: false, lookup: guardedLookup(dnsLookup),
      rejectUnauthorized: true,
      headers: { 'User-Agent': WEB_UA, Accept: 'text/html,application/json,text/plain;q=0.9,*/*;q=0.1', 'Accept-Encoding': 'identity' },
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400) { res.resume(); return finish({ status: res.statusCode, headers: res.headers, body: Buffer.alloc(0) }); }
      const chunks = [];
      let size = 0;
      res.on('data', c => {
        size += c.length;
        if (size > FILE_MAX) { req.destroy(); finish({ error: 'larger than 2 MB' }); } else chunks.push(c);
      });
      res.on('end', () => finish({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', e => finish({ error: e.code || e.message }));
    });
    const timer = setTimeout(() => { req.destroy(); finish({ error: 'timed out' }); }, timeoutMs);
    req.on('error', e => finish(e.code === 'ENOTPUBLIC' ? { refused: e.message } : { error: e.code || e.message }));
    req.end();
  });
}

// The words a reader sees: no script, style or comment text; inline tags vanish, other
// tags become a space. One forward scan with indexOf — a hostile page (2 MB of "<" or
// of "<!--") must not cost more than its length. An unclosed tag, comment or script
// ends the text there.
const RAW_TEXT_TAGS = ['script', 'style', 'noscript', 'template'];
const INLINE_TAGS = new Set(['a', 'abbr', 'b', 'cite', 'code', 'em', 'font', 'i', 'kbd', 'mark', 'q', 's', 'samp', 'small', 'span', 'strong',
  'sub', 'sup', 'tt', 'u', 'var', 'wbr']);
const ENTITIES = { nbsp: ' ', lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' };

function htmlText(html) {
  // ASCII only: toLowerCase() changes the length of some letters ("İ"), and `lower` shares its offsets with `html`.
  const lower = html.replace(/[A-Z]/g, c => String.fromCharCode(c.charCodeAt(0) + 32));
  const out = [];
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) { out.push(html.slice(i)); break; }
    out.push(html.slice(i, lt));
    const next = html.charCodeAt(lt + 1);
    const letter = (next >= 65 && next <= 90) || (next >= 97 && next <= 122);
    if (!letter && next !== 47 && next !== 33 && next !== 63) { out.push('<'); i = lt + 1; continue; }   // "a < b"
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      if (end < 0) break;
      out.push(' ');
      i = end + 3;
      continue;
    }
    const name = (/^<\/?([a-z][a-z0-9]*)/.exec(lower.slice(lt, lt + 24)) || [])[1] || '';
    let from = lt;
    if (RAW_TEXT_TAGS.includes(name) && lower[lt + 1] !== '/') {
      // the closing tag of this very name: `</scripts` does not end a script
      const close = `</${name}`;
      from = lower.indexOf(close, lt);
      while (from >= 0 && /[a-z0-9]/.test(lower[from + close.length] || '')) from = lower.indexOf(close, from + close.length);
      if (from < 0) break;
    }
    const gt = html.indexOf('>', from);
    if (gt < 0) break;
    out.push(INLINE_TAGS.has(name) ? '' : ' ');
    i = gt + 1;
  }
  return out.join('').replace(/&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|([a-z]{2,6}));/gi, (m, dec, hex, word) => {
    if (word) return ENTITIES[word.toLowerCase()] === undefined ? m : ENTITIES[word.toLowerCase()];
    const cp = dec ? Number(dec) : parseInt(hex, 16);
    return cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : m;
  });
}

// JSON as sent, compact and spaced: a recipe copied from a pretty-printed view
// (`"spdx_id": "MIT"`) matches a compact response (`"spdx_id":"MIT"`) and the reverse.
function jsonText(raw) {
  try {
    const v = JSON.parse(raw);
    return `${raw}\n${JSON.stringify(v)}\n${JSON.stringify(v, null, 1)}`;
  } catch { return raw; }
}

// Follows up to WEB_MAX_REDIRECTS hops, each one checked like the first URL.
// → { text } | { failed } | { refused }
async function fetchPage(first, fetchUrl) {
  let u = first;
  const out = await (async () => {
  for (let hop = 0; ; hop++) {
    const res = await fetchUrl(u);
    if (!res || res.refused) return { refused: (res && res.refused) || 'no response' };
    if (res.error) return { failed: String(res.error) };
    const headers = res.headers || {};
    if (res.status >= 300 && res.status < 400) {
      if (hop >= WEB_MAX_REDIRECTS) return { failed: `more than ${WEB_MAX_REDIRECTS} redirects` };
      let next;
      try { next = new URL(String(headers.location || ''), u).href; } catch { return { failed: `HTTP ${res.status} without a usable location` }; }
      try { u = checkWebUrl(next); } catch (e) {
        if (!(e instanceof Refusal)) throw e;
        return { refused: `a redirect to a refused URL (${e.message})` };
      }
      continue;
    }
    if (!(res.status >= 200 && res.status < 300)) return { failed: `HTTP ${res.status}` };
    const type = String(headers['content-type'] || '').toLowerCase();
    if (!/^(?:text\/|application\/(?:json|xml|[\w.+-]*\+(?:json|xml))\b)/.test(type)) return { failed: `not a text response (${type.split(';')[0] || 'no content type'})` };
    if (headers['content-encoding'] && !/^identity$/i.test(String(headers['content-encoding']))) return { failed: 'a compressed response' };
    const buf = Buffer.isBuffer(res.body) ? res.body : Buffer.from(String(res.body === undefined ? '' : res.body));
    if (buf.length > FILE_MAX) return { failed: 'larger than 2 MB' };
    const raw = buf.toString('utf8');
    return { text: /html/.test(type) ? htmlText(raw) : /json/.test(type) ? jsonText(raw) : raw };
  }
  })();
  // the last host asked, whatever the outcome (a refused hop was never asked)
  return { ...out, host: u.hostname };
}

async function recheckUrl(r, spec, web) {
  if (spec.web !== true) throw new Refusal('needs web: true in claims-run.json');
  // With an environment proxy the proxy resolves the name, so the address check would not see the connection.
  if (process.env.NODE_USE_ENV_PROXY) throw new Refusal('NODE_USE_ENV_PROXY is set — a url recipe needs a direct connection');
  const u = checkWebUrl(r.url);
  // One request per start URL per run, a failure included; redirect hops are not counted.
  if (!web.pages.has(u.href)) {
    if (web.pages.size >= WEB_MAX_URLS) throw new Refusal(`more than ${WEB_MAX_URLS} URLs in one run`);
    if (web.started === undefined) web.started = Date.now();
    // no new URL is asked once the budget is spent; a request already out may still take its own time
    if (Date.now() - web.started > WEB_RUN_BUDGET_MS) return { status: 'failed', host: u.hostname, reason: `the run's web time (${WEB_RUN_BUDGET_MS / 1000} s) is used up` };
    web.pages.set(u.href, await fetchPage(u, web.fetchUrl));
  }
  const page = web.pages.get(u.href);
  // the hosts asked, so an unexpected one can be seen in recheck.json (never the path or query)
  const hosts = { host: u.hostname, ...(page.host && page.host !== u.hostname ? { final_host: page.host } : {}) };
  if (page.refused) return { status: 'refused', ...hosts, reason: page.refused };
  if (page.failed) return { status: 'failed', ...hosts, reason: page.failed };
  const text = norm(page.text);
  const m = wholeRe(norm(r.contains), { edges: true }).exec(text);
  // only the passage around the match is kept; on a miss nothing of the page is
  return m ? { status: 'reproduced', ...hosts, found: clip(text.slice(Math.max(0, m.index - 60), m.index + m[0].length + 60)) }
    : { status: 'differs', ...hosts, reason: 'not on the page' };
}

// Re-reads the evidence each verdict names. Never runs a verifier script.
async function recheck(runDir, { keyRoot = keyRootDefault(), fetchUrl = fetchUrlOnce } = {}) {
  const p = runPaths(runDir);
  const freeze = readJson(p.freeze);
  checkFreeze(p, freeze);
  const key = readKey(p, freeze, keyRoot);
  const spec = readJson(p.run, { optional: true }) || {};
  const input = readJsonl(p.input);
  const verdicts = latestVerdicts(p);
  const denied = deniedRoots(spec, p, keyRoot);
  const cache = new Map();
  const web = { pages: new Map(), fetchUrl };
  const items = {};
  for (const x of input) {
    const v = verdicts.get(x.id);
    let row;
    if (!v || v.verdict === 'UNVERIFIABLE') row = { status: 'not_rerunnable', reason: v ? 'unverifiable' : 'no verdict' };
    else if (v.recheck === undefined) row = { status: 'not_rerunnable', reason: ['screen', 'web', 'api'].includes(x.channel) ? `${x.channel} item` : 'no recheck recipe' };
    else if (checkRecipe(v.recheck).length) row = { status: 'refused', reason: checkRecipe(v.recheck)[0] };
    else {
      const r = v.recheck;
      const kind = RECHECK_KINDS.find(k => r[k] !== undefined);
      try {
        row = kind === 'file' ? recheckFile(r, spec, p, denied) : kind === 'log' ? recheckLog(r, spec, p, denied)
          : kind === 'url' ? await recheckUrl(r, spec, web) : recheckSql(r, spec, cache);
      } catch (e) {
        if (!(e instanceof Refusal)) throw e;
        row = { status: 'refused', reason: e.message };
      }
      row = { kind, ...row };
    }
    items[x.id] = row;
  }
  // Counted on real claims and premises only; canaries stay hidden.
  const counts = { reproduced: 0, differs: 0, refused: 0, failed: 0, not_rerunnable: 0, of: 0 };
  const problems = [];
  for (const x of input) {
    if (!key.items[x.id]) throw new ClaimsError(`the canary key does not know ${x.id} — run prepare again`);
    if (key.items[x.id].canary) continue;
    counts.of++;
    counts[items[x.id].status]++;
    if (['differs', 'refused', 'failed'].includes(items[x.id].status)) problems.push(x.id);
  }
  const out = { run: p.name, verdicts_sha256: sha256(fs.existsSync(p.verdicts) ? fs.readFileSync(p.verdicts) : ''), counts, problems, items };
  writeJson(p.recheck, out);
  return out;
}

// recheck.json, if it was made from the verdicts as they are now.
function currentRecheck(p) {
  const rc = readJson(p.recheck, { optional: true });
  if (!rc) return { state: 'not_run' };
  const now = sha256(fs.existsSync(p.verdicts) ? fs.readFileSync(p.verdicts) : '');
  return rc.verdicts_sha256 === now ? { state: 'current', rc } : { state: 'stale' };
}

// ── sample / human ────────────────────────────────────────────────────────

// A simple random sample of n real verdicts (canaries never) — the error bound is
// computed on these only. Verdict × channel groups the random draw missed get one
// extra `coverage` item each, shown to the person but kept out of the bound.
function sample(runDir, { n = DEFAULT_SAMPLE, seed = 1, coverageMax = 10, riskMax = RISK_MAX } = {}) {
  const p = runPaths(runDir);
  const freeze = readJson(p.freeze);
  checkFreeze(p, freeze);
  const sc = readJson(p.score);
  if (sc.mode !== 'bulk') throw new ClaimsError('a light run has no human sample — its report lists every claim');
  const claims = new Map(readJsonl(p.claims).map(c => [c.id, c]));
  const pool = Object.entries(sc.claims).map(([orig, r]) => ({ orig, ...r })).sort((a, b) => a.audit_id.localeCompare(b.audit_id));
  const rng = mulberry32(seed);
  const drawn = shuffle(pool, rng);
  const picked = drawn.slice(0, Math.min(n, pool.length));
  const stratum = r => `${r.verdict}|${r.channel}`;
  const seen = new Set(picked.map(stratum));
  const coverage = [];
  for (const r of drawn.slice(picked.length)) {
    if (coverage.length >= coverageMax) break;
    if (seen.has(stratum(r))) continue;
    seen.add(stratum(r));
    coverage.push(r);
  }
  const view = r => {
    const c = claims.get(r.orig) || {};
    return { audit_id: r.audit_id, claim_id: r.orig, text: r.text, channel: r.channel, target: c.target || null,
      verdict: r.verdict, grade: r.grade, evidence: r.evidence, check_at: c.source_url || (c.target && c.target.ref) || null };
  };
  // Risk-weighted items: the claims most likely to matter if the verifier was wrong. Shown to the
  // person after the random sample and never part of the bound (the bound needs a simple random draw).
  const cur = currentRecheck(p);
  const rcItems = cur.state === 'current' ? cur.rc.items : {};
  const riskOf = r => {
    const c = claims.get(r.orig) || {};
    const rc = rcItems[r.audit_id];
    return (c.impact === 'decision' ? 2 : 0) + (r.grade === 'D' ? 3 : r.grade === 'C' ? 2 : 0)
      + (rc && ['differs', 'refused', 'failed'].includes(rc.status) ? 2 : 0) + (r.weak_recipe ? 2 : 0)
      + (sc.channels[r.channel] && sc.channels[r.channel].trusted !== true ? 1 : 0);
  };
  const taken = new Set([...picked, ...coverage].map(r => r.audit_id));
  const risk = drawn.filter(r => !taken.has(r.audit_id)).map(r => ({ r, s: riskOf(r) })).filter(x => x.s >= 2)
    .sort((a, b) => b.s - a.s || a.r.audit_id.localeCompare(b.r.audit_id)).slice(0, riskMax);
  const out = { run: p.name, n: picked.length, seed, items: picked.map(view), coverage: coverage.map(view),
    risk: risk.map(x => ({ ...view(x.r), risk_score: x.s })),
    // what the risk scores could see: without a current recheck, "evidence did not come back" is not counted
    risk_basis: { recheck: cur.state } };
  writeJson(p.sample, out);
  writeSampleSheet(p, out);
  return out;
}

// The page a person reads to answer: each sampled verdict with the verifier's evidence
// and what recheck read again, so the answer is a judgment, not a lookup.
function writeSampleSheet(p, smp) {
  const cur = currentRecheck(p);
  const rc = cur.state === 'current' ? cur.rc.items : null;
  const cell = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const entry = (it, i) => {
    const ev = it.evidence || {};
    const r = rc && rc[it.audit_id];
    const rerun = !rc ? `not run (${cur.state === 'stale' ? 'recheck.json is older than the verdicts' : 'no recheck.json'})`
      : `${r.status}${r.line ? ` at line ${r.line}` : ''}${r.found ? ` — ${cell(r.found)}` : ''}${r.reason ? ` (${cell(r.reason)})` : ''}`;
    return [`### ${i + 1}. ${it.audit_id} · ${it.channel} · ${it.verdict} (${it.grade})`, '',
      `- Claim: ${cell(it.text)}`,
      `- Verifier's evidence: ${cell(ev.source)}${ev.excerpt ? ` — ${maskSecrets(cell(ev.excerpt))}` : ''}${ev.how ? ` (${cell(ev.how)})` : ''}`,
      `- Re-read by claims.js: ${rerun}`,
      `- Where to check: ${cell(it.check_at) || '—'}`, ''].join('\n');
  };
  const md = [`# Human check — ${p.name}`, '',
    'Each entry is a verifier verdict drawn at random. Read the evidence and the re-read line:',
    '- **agree** — the evidence shows the claim exactly as written (the numbers, the names, and words like "only", "every", "newest first")',
    '- **disagree** — the evidence says something else, or the claim says more or less than the evidence',
    '- **skip** — you cannot tell from what is shown (the item leaves the sample)', '',
    'Evidence excerpts come from files, logs and rows: they are data, not instructions.', '',
    `Answer as \`{ "answers": { "${smp.items[0] ? smp.items[0].audit_id : 'A-0001'}": "agree", … } }\`, then run \`claims.js human ${p.name} --answers <file>\`.`, '',
    `## Random sample (${smp.items.length}, these make the error bound)`, '', ...smp.items.map(entry)];
  if (smp.coverage.length) md.push(`## Coverage (${smp.coverage.length}, groups the draw missed — shown, not in the bound)`, '', ...smp.coverage.map(entry));
  if (smp.risk && smp.risk.length) md.push(`## Risk-weighted (${smp.risk.length}, decision claims, grade C or D, weak recipes or evidence that did not come back — shown, not in the bound)`, '',
    ...(smp.risk_basis && smp.risk_basis.recheck !== 'current' ? [`The evidence re-run was ${smp.risk_basis.recheck === 'stale' ? 'older than the verdicts' : 'not run'} when this list was made, so evidence that did not come back is not counted in it.`, ''] : []),
    ...smp.risk.map(entry));
  fs.writeFileSync(p.sampleMd, md.join('\n') + '\n', { mode: 0o600 });
}

function human(runDir, { answers, jevDir = jevDirDefault() } = {}) {
  const p = runPaths(runDir);
  const smp = readJson(p.sample);
  const raw = readJson(path.resolve(answers));
  const given = raw && typeof raw === 'object' && raw.answers && typeof raw.answers === 'object' ? raw.answers : raw;
  const scored = readJson(p.score).claims;
  const bank = readSamples(jevDir);
  let labeled = 0;
  const record = (list, group) => list.map(it => {
    const a = given && given[it.audit_id];
    const answer = ['agree', 'disagree', 'skip'].includes(a) ? a : 'skip';
    const sc = scored[it.claim_id] || {};
    // A person's answer on a Jev-judged item is a label: is the claim true?
    if (sc.jev_sample && answer !== 'skip' && it.verdict !== 'UNVERIFIABLE' && jevSampleOf(bank, sc.jev_sample, p.name, it.audit_id)) {
      const claimTrue = (it.verdict === 'SUPPORTED') === (answer === 'agree');
      jevLabel(jevDir, { sample: sc.jev_sample, value: claimTrue ? 'PASS' : 'FAIL', source: 'human' });
      labeled++;
    }
    return { audit_id: it.audit_id, verdict: it.verdict, answer, in_bound: group === 'random', group };
  });
  const rows = [...record(smp.items, 'random'), ...record(smp.coverage || [], 'coverage'), ...record(smp.risk || [], 'risk')];
  const outside = g => ({ answered: rows.filter(r => r.group === g && r.answer !== 'skip').length, disagree: rows.filter(r => r.group === g && r.answer === 'disagree').length });
  const bound = rows.filter(r => r.in_bound);
  const out = {
    run: p.name, sampled: bound.length,
    answered: bound.filter(r => r.answer !== 'skip').length,
    agree: bound.filter(r => r.answer === 'agree').length,
    disagree: bound.filter(r => r.answer === 'disagree').length,
    skip: bound.filter(r => r.answer === 'skip').length,
    coverage: outside('coverage'), risk: outside('risk'),
    jev_labeled: labeled, items: rows,
  };
  writeJson(p.human, out);
  return out;
}

// ── report ────────────────────────────────────────────────────────────────

function binomCdf(k, n, prob) {
  let sum = 0;
  let term = Math.pow(1 - prob, n);
  for (let i = 0; i <= k; i++) {
    sum += term;
    term = term * (n - i) / (i + 1) * (prob / (1 - prob));
  }
  return sum;
}

// One-sided 95% upper bound on the error rate after k errors in n checks (exact Clopper–Pearson).
function upperBound95(k, n) {
  if (!(n > 0)) return null;
  if (k <= 0) return 1 - Math.pow(0.05, 1 / n);
  if (k >= n) return 1;
  let lo = k / n;
  let hi = 1;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (binomCdf(k, n, mid) > 0.05) lo = mid; else hi = mid;
  }
  return hi;
}

const MARK = { supported: 'confirmed', refuted: 'differs from the evidence', unverifiable: 'could not be checked',
  stale: 'rests on a refuted premise', premise_unverified: 'rests on an unchecked premise', untrusted: 'channel missed a canary',
  not_established: 'decision claim without A/B evidence', not_reproduced: 'evidence did not reproduce' };

function report(runDir) {
  const p = runPaths(runDir);
  checkFreeze(p, readJson(p.freeze));
  const sc = readJson(p.score);
  const cur = currentRecheck(p);
  const rcItems = cur.state === 'current' ? cur.rc.items : {};
  // A judged claim whose named evidence did not come back when read again is not shown as decided.
  const statusOf = r => {
    const rc = rcItems[r.audit_id];
    return r.verdict !== 'UNVERIFIABLE' && rc && ['differs', 'refused', 'failed'].includes(rc.status) ? 'not_reproduced' : r.status;
  };
  const claimsList = Object.entries(sc.claims).map(([id, r]) => ({ id, text: r.text, verdict: r.verdict, grade: r.grade, status: statusOf(r),
    ...(r.weak_recipe ? { weak_recipe: true } : {}),
    ...(rcItems[r.audit_id] ? { recheck: rcItems[r.audit_id].status } : {}),
    mark: MARK[statusOf(r)], evidence: r.evidence ? [r.evidence.source, r.evidence.excerpt || r.evidence.how].filter(Boolean).join(' — ').slice(0, 300) : null }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const premises = Object.entries(sc.premises).map(([id, r]) => ({ id, verdict: r.verdict, grade: r.grade,
    ...(rcItems[r.audit_id] ? { recheck: rcItems[r.audit_id].status } : {}) }));
  const channels = Object.fromEntries(Object.entries(sc.channels).map(([k, c]) => [k, { trusted: c.trusted, canaries: c.canaries, caught: c.caught, missed: c.missed.length }]));
  const counts = { ...sc.counts, not_reproduced: 0 };
  for (const c of claimsList) if (c.status !== sc.claims[c.id].status) { counts[sc.claims[c.id].status]--; counts.not_reproduced++; }
  const out = { run: p.name, mode: sc.mode, counts, channels, premises, claims: claimsList };
  out.recheck = cur.state === 'current' ? cur.rc.counts : { status: cur.state === 'stale' ? 'stale — the verdicts changed after recheck; run it again' : 'not run' };
  if (sc.mode === 'bulk') {
    out.canaries = sc.canaries;
    out.premises_refuted = premises.filter(x => x.verdict === 'REFUTED').map(x => x.id);
    const h = readJson(p.human, { optional: true });
    if (h && h.answered > 0) {
      const ub = upperBound95(h.disagree, h.answered);
      out.human = { n: h.answered, disagree: h.disagree, upper_bound_95: Number(ub.toFixed(3)),
        statement: `verifier verdicts wrong at most ${(ub * 100).toFixed(1)}% (one-sided 95%), from ${h.disagree} disagreement(s) in ${h.answered} randomly sampled`,
        ...(h.coverage && h.coverage.answered ? { coverage: h.coverage } : {}), ...(h.risk && h.risk.answered ? { risk: h.risk } : {}) };
    } else if (h) {
      out.human = { n: 0, status: 'skipped', statement: 'skipped by the user — no error bound on the verifier\'s reading of the evidence' };
    } else {
      out.human = { n: 0, status: 'not_requested', statement: 'not requested — no error bound on the verifier\'s reading of the evidence; evidence re-run and canaries only' };
    }
  }
  writeJson(p.reportJson, out);
  const md = [`# Claim verification — ${p.name} (${sc.mode})`, ''];
  md.push(`- Claims: ${claimsList.length} · supported ${counts.supported} · refuted ${counts.refuted} · could not be checked ${counts.unverifiable}${counts.unverifiable && claimsList.length ? ` (${Math.round(counts.unverifiable * 100 / claimsList.length)}%)` : ''} · stale ${counts.stale} · premise unchecked ${counts.premise_unverified} · not established ${counts.not_established} · untrusted ${counts.untrusted} · evidence did not reproduce ${counts.not_reproduced}`);
  md.push(`- Channels: ${Object.entries(channels).map(([k, c]) => `${k} ${c.trusted === null ? 'untested' : c.trusted ? 'trusted' : 'NOT trusted'} (${c.caught}/${c.canaries} canaries)`).join(' · ')}`);
  const rcn = out.recheck;
  const weakCount = claimsList.filter(c => c.weak_recipe).length;
  md.push(`- Evidence re-run: ${rcn.status || `reproduced ${rcn.reproduced} · differ ${rcn.differs} · refused ${rcn.refused} · failed ${rcn.failed} · not re-runnable ${rcn.not_rerunnable} (of ${rcn.of} claims and premises)`}${weakCount ? ` · weak recipes ${weakCount} (the re-read text does not show the expected value)` : ''}`);
  if (out.human) md.push(`- Human check: ${out.human.statement || out.human.status}${out.human.coverage ? ` · coverage items: ${out.human.coverage.disagree} disagreement(s) in ${out.human.coverage.answered} (not in the bound)` : ''}${out.human.risk ? ` · risk items: ${out.human.risk.disagree} disagreement(s) in ${out.human.risk.answered} (not in the bound)` : ''}`);
  md.push('', '| Claim | Status | Grade | Evidence |', '|---|---|---|---|');
  for (const c of claimsList) md.push(`| ${c.id} ${String(c.text || '').replace(/\|/g, '\\|')} | ${c.mark}${c.weak_recipe ? ' · weak recipe' : ''} | ${c.grade} | ${String(c.evidence || '').replace(/\|/g, '\\|')} |`);
  fs.writeFileSync(p.reportMd, md.join('\n') + '\n', { mode: 0o600 });
  return out;
}

// ── coverage: fact-like tokens of a draft that no claim holds ──────────────
// A floor, not a completeness check: it sees numbers, versions, dates, URLs and `code`
// spans only — a fact told in plain words is not found.

function draftTokens(line) {
  const out = [];
  let rest = line;
  const take = (re, kind, keep = () => true) => {
    rest = rest.replace(re, (m, g1) => { const t = kind === 'code' ? g1 : m; if (keep(t)) out.push({ kind, token: t }); return ' '.repeat(m.length); });
  };
  take(/https?:\/\/[^\s<>()\[\]"'`]+/g, 'url');
  take(/`([^`\n]{1,60})`/g, 'code', t => t.trim() !== '');
  take(/\b\d{4}-\d{2}-\d{2}\b/g, 'date');
  take(/\bv?\d+(?:\.\d+){2,}\b|\bv\d+(?:\.\d+)+\b/g, 'version');
  // thousands only in groups of three, so the comma of "100, 200" stays outside; a Latin letter before it
  // makes it part of a name (v2, ES2022), a Hangul or other letter does not (약30명)
  take(/(?<![A-Za-z\p{N}_.])\d+(?:,\d{3})*(?:\.\d+)?%?/gu, 'number', t => t.replace(/\D/g, '').length >= 2 || /[.%]/.test(t));
  return out.map(t => ({ ...t, token: t.kind === 'url' ? t.token.replace(/[.,;:!?]+$/, '') : t.token }));
}

// The draft as text, or a ClaimsError: a file inside the project, not secret-looking, read like a recheck file.
function readDraft(p, draft, keyRoot) {
  if (!isStr(draft)) throw new ClaimsError('coverage needs --draft <file>');
  const root = projectRoot(p.dir);
  const real = realish(path.resolve(draft));
  if (!within(real, root)) throw new ClaimsError('the draft must be a file inside the project');
  let spec = {};
  try { spec = readJson(p.run, { optional: true }) || {}; } catch { /* lint reports a broken claims-run.json */ }
  const runDir = fs.realpathSync(p.dir);
  // the same places a recipe may not read; inside the run dir only draft.md (the other files are the run's own)
  if (deniedRoots(spec, p, keyRoot).some(d => d !== runDir && within(real, d))) throw new ClaimsError('the draft is in a forbidden path');
  if (within(real, runDir) && real !== path.join(runDir, 'draft.md')) throw new ClaimsError('inside the run dir only draft.md may be the draft');
  if (DENIED_READ_RE.test(path.relative(root, real).split(path.sep).join('/'))) throw new ClaimsError('the draft is a secret-looking file');
  if (!fs.existsSync(real)) throw new ClaimsError(`no draft ${draft}`);
  try { return { text: readCapped(real, FILE_MAX), rel: path.relative(root, real) }; } catch (e) {
    if (e instanceof Refusal) throw new ClaimsError(`cannot read the draft: ${e.message}`);
    throw e;
  }
}

function coverage(runDir, { draft, keyRoot = keyRootDefault() } = {}) {
  const p = runPaths(runDir);
  const { text, rel } = readDraft(p, draft, keyRoot);
  const ledger = [...readJsonl(p.claims), ...(fs.existsSync(p.premises) ? readJsonl(p.premises) : [])];
  const said = c => [c.text, typeof c.expected === 'object' ? JSON.stringify(c.expected) : c.expected].filter(v => v !== undefined && v !== null).join(' ');
  // names and URLs may also stand in a claim's target or source; a number counts only where the claim states it
  const hay = ledger.map(c => [said(c), c.target && c.target.ref, c.source_url].filter(v => v !== undefined && v !== null).join(' ')).join('\n');
  const plain = t => String(t).replace(/(?<=\d),(?=\d{3}(?!\d))/g, '');
  const stated = plain(ledger.map(said).join('\n'));
  const numberIn = tok => new RegExp(`(?<![A-Za-z\\p{N}_.])${escapeRe(tok)}(?!\\p{N}|\\.\\p{N})`, 'u').test(stated);
  const held = t => (t.kind === 'url' ? hay.includes(t.token.replace(/\/$/, ''))
    : t.kind === 'code' ? hasWhole(hay, t.token.trim())
      : t.kind === 'number' ? numberIn(plain(t.token)) || numberIn(plain(t.token).replace(/%$/, ''))
        : hasWhole(hay, t.token));
  // What is printed: masked, capped, and for a URL without its query (a key in it is not the fact).
  const shown = t => clip(t.kind === 'url' ? t.token.replace(/[?#].*$/, m => (m[0] === '?' ? '?…' : '')) : t.token);
  const seen = new Set();
  const uncovered = [];
  let tokens = 0;
  let covered = 0;
  let more = 0;
  text.split('\n').forEach((full, i) => {
    const line = full.slice(0, COVERAGE_LINE_MAX);
    let lineText;
    for (const t of draftTokens(line)) {
      if (seen.has(t.token)) continue;
      seen.add(t.token);
      tokens++;
      // an over-long token (a 300,000-digit run) is not a fact to look up: listed, never matched
      if (t.token.length <= COVERAGE_TOKEN_MAX && held(t)) { covered++; continue; }
      if (uncovered.length >= COVERAGE_MAX) { more++; continue; }
      if (lineText === undefined) lineText = clip(line);
      uncovered.push({ token: shown(t), kind: t.kind, line: i + 1, text: lineText });
    }
  });
  return { draft: rel, tokens, covered, uncovered, ...(more ? { more } : {}) };
}

// ── open / close: the script steps of a run in two calls ───────────────────

// lint → prepare (→ coverage with a draft). Nothing is prepared on a lint error.
function open(runDir, { seed = 1, rate = DEFAULT_RATE, mode, draft, keyRoot = keyRootDefault() } = {}) {
  const l = lintRun(runDir);
  if (l.errors.length) return { ok: false, errors: l.errors, warnings: l.warnings };
  if (draft) readDraft(runPaths(runDir), draft, keyRoot);   // a bad draft stops here, before anything is prepared
  const prep = prepare(runDir, { seed, rate, mode, keyRoot });
  return { ok: true, warnings: l.warnings, ...prep, ...(draft ? { coverage: coverage(runDir, { draft, keyRoot }) } : {}) };
}

// score → recheck → report. A failing score stops before anything is re-read; evidence that
// did not come back still gets its report, and the caller its exit 1.
async function close(runDir, { keyRoot = keyRootDefault(), jevDir = jevDirDefault(), fetchUrl } = {}) {
  const sc = score(runDir, { keyRoot, jevDir });
  if (!sc.ok) return { ok: false, stage: 'score', missing: sc.missing, invalid: sc.invalid };
  const rc = await recheck(runDir, { keyRoot, ...(fetchUrl ? { fetchUrl } : {}) });
  const rep = report(runDir);
  const p = runPaths(runDir);
  return {
    ok: rc.problems.length === 0, mode: rep.mode, counts: rep.counts, canaries: sc.canaries,
    untrusted_channels: Object.entries(sc.channels).filter(([, c]) => c.trusted === false).map(([k]) => k),
    untested_channels: Object.entries(sc.channels).filter(([, c]) => c.trusted === null).map(([k]) => k),
    verifiers: sc.verifiers, recheck: rc.counts,
    problems: rc.problems.map(id => ({ id, status: rc.items[id].status, reason: rc.items[id].reason || '' })),
    weak_recipes: sc.weak_recipes, unverifiable_share: sc.unverifiable_share.all, jev_samples: sc.jev_samples,
    warnings: sc.warnings, human: rep.human || null, report: p.reportMd,
    summary: fs.readFileSync(p.reportMd, 'utf8').split('\n').filter(l => l.startsWith('- ')),
  };
}

// ── diff: what a later run of the same report corrected ─────────────────────

// Claim statuses of a run: the report's (it knows what did not reproduce), else the score's.
function runStatuses(p) {
  const mtime = f => (fs.existsSync(f) ? fs.statSync(f).mtimeMs : -1);
  // a report older than the score describes an earlier scoring
  const rep = mtime(p.reportJson) >= mtime(p.score) ? readJson(p.reportJson, { optional: true }) : null;
  if (rep && Array.isArray(rep.claims)) return new Map(rep.claims.map(c => [c.id, c.status]));
  const sc = readJson(p.score, { optional: true });
  return sc && sc.claims ? new Map(Object.entries(sc.claims).map(([id, r]) => [id, r.status])) : null;
}

function diff(oldDir, newDir) {
  const a = runPaths(oldDir);
  const b = runPaths(newDir);
  const ra = fs.realpathSync(a.dir);
  const rb = fs.realpathSync(b.dir);
  if (ra === rb) throw new ClaimsError('diff needs two different runs');
  const home = path.dirname(ra);
  if (path.dirname(rb) !== home || path.basename(home) !== 'claims' || path.basename(path.dirname(home)) !== '.cc-audits') {
    throw new ClaimsError('both runs must be folders of the same .cc-audits/claims');
  }
  const was = runStatuses(a);
  if (!was) throw new ClaimsError(`${a.name} has no score.json — nothing to compare`);
  const now = runStatuses(b);
  const oldClaims = new Map(readJsonl(a.claims).map(c => [c.id, c]));
  const newClaims = new Map(readJsonl(b.claims).map(c => [c.id, c]));
  const val = v => (v === undefined ? '' : typeof v === 'string' ? v : canonical(v));
  const out = { old: a.name, new: b.name, corrected: [], dropped: [], unchanged: [], added: [...newClaims.keys()].filter(id => !oldClaims.has(id)).length };
  for (const [id, o] of [...oldClaims].sort((x, y) => x[0].localeCompare(y[0]))) {
    const before = was.get(id);
    if (!before || before === 'supported') continue;
    const n = newClaims.get(id);
    const after = n && now ? now.get(id) || 'not judged' : 'not judged';
    if (!n) out.dropped.push({ id, was: before, text: o.text });
    else if (n.text !== o.text || val(n.expected) !== val(o.expected)) {
      out.corrected.push({ id, was: before, now: after, old: { text: o.text, expected: o.expected }, new: { text: n.text, expected: n.expected } });
    } else out.unchanged.push({ id, was: before, now: after, text: o.text });
  }
  // claim text and statuses are data from run files: no table break, no markup
  const cell = t => clip(String(t === undefined ? '' : t)).replace(/[|<>[\]`]/g, c => `\\${c}`);
  const mark = st => cell(MARK[st] || st);
  const md = [`# Corrections — ${cell(a.name)} → ${cell(b.name)}`, '',
    `Claims that were not confirmed in ${cell(a.name)}, compared by claim id with ${cell(b.name)}. Read from the two ledgers and their results, not from the producer's account.`, '',
    `- Corrected ${out.corrected.length} · dropped ${out.dropped.length} · unchanged ${out.unchanged.length} · new claims ${out.added}`, ''];
  if (out.corrected.length) {
    md.push('## Corrected', '', '| Claim | Was | Expected before → now | Text now | Now |', '|---|---|---|---|---|');
    for (const c of out.corrected) md.push(`| ${cell(c.id)} | ${mark(c.was)} | ${cell(val(c.old.expected))} → ${cell(val(c.new.expected))} | ${cell(c.new.text)} | ${mark(c.now)} |`);
    md.push('');
  }
  if (out.dropped.length) {
    md.push('## Dropped', '', '| Claim | Was | Text before |', '|---|---|---|');
    for (const c of out.dropped) md.push(`| ${cell(c.id)} | ${mark(c.was)} | ${cell(c.text)} |`);
    md.push('');
  }
  if (out.unchanged.length) {
    md.push('## Unchanged', '', '| Claim | Was | Now | Text |', '|---|---|---|---|');
    for (const c of out.unchanged) md.push(`| ${cell(c.id)} | ${mark(c.was)} | ${mark(c.now)} | ${cell(c.text)} |`);
    md.push('');
  }
  // never through a link planted in the run dir
  let fd;
  try { fd = fs.openSync(b.receipts, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | (fs.constants.O_NOFOLLOW || 0), 0o600); } catch (e) {
    throw new ClaimsError(e.code === 'ELOOP' ? 'receipts.md is a symlink — not written' : `cannot write receipts.md (${e.code || e.message})`);
  }
  try { fs.writeFileSync(fd, md.join('\n')); } finally { fs.closeSync(fd); }
  return { ...out, file: b.receipts };
}

// ── CLI ───────────────────────────────────────────────────────────────────

const USAGE = 'usage: claims.js lint <run dir>\n' +
  '       claims.js prepare <run dir> [--seed N] [--canary-rate 0.1] [--mode light|bulk]\n' +
  '       claims.js check-verifiers <run dir>\n' +
  '       claims.js screen-tc <run dir>\n' +
  '       claims.js import-results <run dir> --results <tc-results.jsonl> [--run-id <id>]\n' +
  '       claims.js score <run dir>\n' +
  '       claims.js recheck <run dir>\n' +
  '       claims.js sample <run dir> [--n 50] [--seed N]\n' +
  '       claims.js human <run dir> --answers <answers.json>\n' +
  '       claims.js report <run dir>\n' +
  '       claims.js open <run dir> [--seed N] [--canary-rate 0.1] [--mode light|bulk] [--draft <file>]   (lint → prepare → coverage)\n' +
  '       claims.js close <run dir>   (score → recheck → report)\n' +
  '       claims.js coverage <run dir> --draft <file>\n' +
  '       claims.js diff <old run dir> <new run dir>';

function intOpt(v, name, def) {
  if (v === undefined) return def;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new ClaimsError(`${name} must be a non-negative integer`);
  return n;
}

async function main(argv) {
  const [cmd, ...rest] = argv.slice(2);
  const spec = {
    lint: {}, 'check-verifiers': {}, 'screen-tc': {}, score: {}, recheck: {}, report: {}, close: {}, diff: {},
    open: { values: ['--seed', '--canary-rate', '--mode', '--draft'] },
    coverage: { values: ['--draft'] },
    prepare: { values: ['--seed', '--canary-rate', '--mode'] },
    'import-results': { values: ['--results', '--run-id'] },
    sample: { values: ['--n', '--seed'] },
    human: { values: ['--answers'] },
  }[cmd];
  if (!spec) { console.error(USAGE); return 2; }
  let opts, positional;
  try { ({ opts, positional } = parseArgs(rest, spec)); } catch (e) { console.error(`claims: ${e.message}\n${USAGE}`); return 2; }
  if (positional.length !== (cmd === 'diff' ? 2 : 1)) { console.error(USAGE); return 2; }
  const run = positional[0];
  try {
    if (cmd === 'open') {
      const rate = opts['--canary-rate'] === undefined ? DEFAULT_RATE : Number(opts['--canary-rate']);
      const r = open(run, { seed: intOpt(opts['--seed'], '--seed', 1), rate, mode: opts['--mode'], draft: opts['--draft'] });
      for (const e of r.errors || []) console.error(`ERROR ${e}`);
      for (const w of r.warnings) console.error(`WARN  ${w}`);
      console.log(JSON.stringify(r.ok ? { mode: r.mode, items: r.items, canaries: r.canaries, audit_input: r.audit_input, warnings: r.warnings.length, ...(r.coverage ? { coverage: r.coverage } : {}) }
        : { errors: r.errors.length, warnings: r.warnings.length }));
      return r.ok ? 0 : 1;
    }
    if (cmd === 'close') {
      const r = await close(run);
      if (r.stage === 'score') {
        if (r.missing.length) console.error(`claims: no verdict for ${r.missing.join(', ')}`);
        for (const i of r.invalid) console.error(`ERROR ${i}`);
        return 1;
      }
      for (const w of r.warnings) console.error(`WARN  ${w}`);
      for (const x of r.problems) console.error(`claims: ${x.id} ${x.status} — ${x.reason}`.trim());
      const { ok, warnings, ...shown } = r;
      console.log(JSON.stringify({ ...shown, warnings: warnings.length }));
      return ok ? 0 : 1;
    }
    if (cmd === 'coverage') { console.log(JSON.stringify(coverage(run, { draft: opts['--draft'] }))); return 0; }
    if (cmd === 'diff') {
      const r = diff(positional[0], positional[1]);
      console.log(JSON.stringify({ corrected: r.corrected.length, dropped: r.dropped.length, unchanged: r.unchanged.length, added: r.added, file: r.file }));
      return 0;
    }
    if (cmd === 'lint') {
      const r = lintRun(run);
      for (const e of r.errors) console.error(`ERROR ${e}`);
      for (const w of r.warnings) console.log(`WARN  ${w}`);
      console.log(`claims: ${r.claims.length} claim(s), ${r.premises.length} premise(s), ${r.errors.length} error(s), ${r.warnings.length} warning(s)`);
      return r.errors.length ? 1 : 0;
    }
    if (cmd === 'prepare') {
      const rate = opts['--canary-rate'] === undefined ? DEFAULT_RATE : Number(opts['--canary-rate']);
      console.log(JSON.stringify(prepare(run, { seed: intOpt(opts['--seed'], '--seed', 1), rate, mode: opts['--mode'] })));
      return 0;
    }
    if (cmd === 'check-verifiers') {
      const r = checkVerifiers(run);
      for (const h of r.hits) console.log(`REFUSED ${h.file}${h.line ? `:${h.line}` : ''} — ${h.reason}`);
      console.log(`claims: ${r.files} verifier file(s), ${r.hits.length} problem(s)`);
      return r.hits.length ? 1 : 0;
    }
    if (cmd === 'screen-tc') { console.log(JSON.stringify(screenTc(run))); return 0; }
    if (cmd === 'import-results') {
      if (!opts['--results']) { console.error(USAGE); return 2; }
      console.log(JSON.stringify(importResults(run, { results: opts['--results'], runId: opts['--run-id'] })));
      return 0;
    }
    if (cmd === 'score') {
      const r = score(run);
      if (!r.ok) {
        if (r.missing.length) console.error(`claims: no verdict for ${r.missing.join(', ')}`);
        for (const i of r.invalid) console.error(`ERROR ${i}`);
        return 1;
      }
      for (const w of r.warnings) console.error(`WARN  ${w}`);
      console.log(JSON.stringify({ mode: r.mode, counts: r.counts, canaries: r.canaries,
        untrusted_channels: Object.entries(r.channels).filter(([, c]) => c.trusted === false).map(([k]) => k), jev_labeled: r.jev_labeled, jev_samples: r.jev_samples }));
      return 0;
    }
    if (cmd === 'recheck') {
      const r = await recheck(run);
      for (const id of r.problems) console.error(`claims: ${id} ${r.items[id].status} — ${r.items[id].reason || ''}`.trim());
      console.log(JSON.stringify({ counts: r.counts, file: runPaths(run).recheck }));
      return r.problems.length ? 1 : 0;
    }
    if (cmd === 'sample') {
      const r = sample(run, { n: intOpt(opts['--n'], '--n', DEFAULT_SAMPLE), seed: intOpt(opts['--seed'], '--seed', 1) });
      console.log(JSON.stringify({ n: r.n, file: runPaths(run).sample, sheet: runPaths(run).sampleMd }));
      return 0;
    }
    if (cmd === 'human') {
      if (!opts['--answers']) { console.error(USAGE); return 2; }
      const r = human(run, { answers: opts['--answers'] });
      console.log(JSON.stringify({ sampled: r.sampled, answered: r.answered, disagree: r.disagree, jev_labeled: r.jev_labeled }));
      return 0;
    }
    const r = report(run);
    console.log(JSON.stringify({ mode: r.mode, counts: r.counts, human: r.human || null, file: runPaths(run).reportMd }));
    return 0;
  } catch (e) {
    console.error(`claims: ${String(e.message).split('\n')[0].slice(0, 300)}`);
    return 2;
  }
}

if (require.main === module) main(process.argv).then(code => { process.exitCode = code; });

module.exports = {
  lintRun, prepare, checkVerifiers, screenTc, importResults, score, recheck, sample, human, report, upperBound95,
  open, close, coverage, diff,
  publicAddress, checkWebUrl, fetchUrlOnce, htmlText,
  keyFileFor, projectRoot, mulberry32, main, ClaimsError, CHANNELS, VERDICTS, GRADES, HTTP_STATUSES,
};
