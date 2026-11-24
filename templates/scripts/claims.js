#!/usr/bin/env node
'use strict';

// Independent verification of the facts in a report (reference_claim_verification.md).
// The producer writes claims.jsonl + premises.jsonl in a run dir
// (.cc-audits/claims/<run>/). This script checks and freezes them, mixes in
// canaries (claims made false on purpose), and — after fact-auditor and, for
// screen items, e2e-tester have judged every item — scores the verdicts against
// the canary key, carries refuted premises over to the claims that rest on
// them, draws the human sample and writes the report. It judges nothing itself.
//
//   node claims.js lint <run dir>
//   node claims.js prepare <run dir> [--seed N] [--canary-rate 0.1] [--mode light|bulk]
//   node claims.js check-verifiers <run dir>
//   node claims.js screen-tc <run dir>
//   node claims.js import-results <run dir> --results <tc-results.jsonl> [--run-id <id>]
//   node claims.js score <run dir>
//   node claims.js sample <run dir> [--n 50] [--seed N]
//   node claims.js human <run dir> --answers <answers.json>
//   node claims.js report <run dir>
//
// Exit 0 ok · 1 the check failed (lint errors, a forbidden verifier, missing
// verdicts) · 2 usage or I/O error.
//
// The canary key lives outside the project (~/.claude/claims-keys/<id>/key.json,
// dir 0700, file 0600; CC_BASELINE_CLAIMS_KEYS moves the root). fact-auditor is
// told never to read it; nothing stops a reader with file access — that limit is
// written down in the guide.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseArgs } = require('./jev-client');
const { label: jevLabel, readSamples, jevDirDefault, canonical, CLAIM_QUESTION } = require('./tc-jev-judge');

const CHANNELS = ['code', 'db', 'log', 'screen', 'doc', 'api', 'web'];
const TARGET_KINDS = ['screen', 'file', 'table', 'function', 'route', 'menu', 'web', 'other'];
const IMPACTS = ['decision', 'descriptive'];
const VERDICTS = ['SUPPORTED', 'REFUTED', 'UNVERIFIABLE'];
const GRADES = ['A', 'B', 'C', 'D'];
const MODES = ['light', 'bulk'];
const CLAIM_KEYS = ['id', 'text', 'target', 'channel', 'expected', 'premises', 'impact', 'source_refs', 'source_url', 'notes'];
const PREMISE_KEYS = ['id', 'text', 'target', 'channel', 'expected', 'source_refs', 'source_url', 'notes'];
const VERDICT_KEYS = ['id', 'verdict', 'grade', 'evidence', 'verifier', 'jev_sample', 'notes'];
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
  const dir = path.resolve(runDir);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new ClaimsError(`no run dir ${runDir}`);
  const p = f => path.join(dir, f);
  return {
    dir, name: path.basename(dir),
    claims: p('claims.jsonl'), premises: p('premises.jsonl'), run: p('claims-run.json'),
    input: p('audit-input.jsonl'), freeze: p('freeze.json'), verdicts: p('verdicts.jsonl'),
    verifiers: p('verifiers'), screenTc: p('screen.tc.json'), score: p('score.json'),
    sample: p('sample.json'), human: p('human.json'), reportJson: p('report.json'), reportMd: p('report.md'),
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
  if (isStr(x.text) && CONJUNCTION_RE.test(x.text)) warn('one claim should state one fact — split this sentence');
  if (isStr(x.text) && SUBJECTIVE_RE.test(x.text)) warn('subjective word — say what can be checked');
}

function lintRun(runDir) {
  const p = runPaths(runDir);
  const claims = readJsonl(p.claims);
  const premises = readJsonl(p.premises, { optional: true });
  const problems = { errors: [], warnings: [] };
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

function bump(n, rng) {
  if (Number.isInteger(n)) {
    const options = [n + 1, n - 1, n + 2, n * 2, n + 10].filter(v => v !== n && v >= 0);
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

// Replaces one whole occurrence of `token` — never a piece of a longer number or word.
function replaceWhole(text, token, next) {
  const re = /^-?\d+(?:\.\d+)?$/.test(token)
    ? new RegExp(`(?<![\\p{L}\\p{N}_.])${escapeRe(token)}(?!\\p{N}|\\.\\p{N})`, 'u')
    : new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRe(token)}(?![\\p{L}\\p{N}_])`, 'u');
  if (!re.test(text)) return null;
  return text.replace(re, () => next);
}

function mutateNumber(c, rng) {
  const text = c.text;
  const exp = c.expected;
  let token = null;
  if (typeof exp === 'number') token = String(exp);
  else if (typeof exp === 'string' && NUM_RE.test(exp)) token = exp.match(NUM_RE)[0];
  else if (exp === true) { const m = text.match(WHOLE_NUM_RE); token = m ? m[0] : null; }
  if (token === null) return null;
  const next = String(bump(Number(token), rng));
  if (next === token) return null;
  const newText = replaceWhole(text, token, next);
  if (newText === null) return null;
  let newExp = exp;
  if (typeof exp === 'number') newExp = Number(next);
  else if (typeof exp === 'string') newExp = replaceWhole(exp, token, next);
  if (newExp === null) return null;
  return { text: newText, expected: newExp };
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
  if (!own.trim()) return null;
  // Only from another target: a value of the same target (another column of the same table)
  // may by chance be true, and a correct verifier would then look like it missed a canary.
  const others = claims.filter(o => o.id !== c.id && o.channel === c.channel && o.target && c.target && o.target.kind === c.target.kind
    && o.target.ref !== c.target.ref
    && (typeof o.expected === 'string' || typeof o.expected === 'number') && String(o.expected) !== own && String(o.expected).trim());
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
    for (const op of shuffle(['number', 'negate', 'swap'], rng)) {
      const m = op === 'number' ? mutateNumber(c, rng) : op === 'negate' ? mutateNegation(c) : mutateSwap(c, claims, rng);
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
  return { file: p.screenTc, test_cases: doc.test_cases.length, expected: items.length };
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
  return bad;
}

// The stored sample for `sha` if it is Q.claim_supported asked for item `id` of run `run`.
function jevSampleOf(bank, sha, run, id) {
  const question = `${CLAIM_QUESTION.id}@${CLAIM_QUESTION.version}`;
  return bank.find(x => x.request_sha256 === sha && x.question === question && x.tc === `claims:${run}` && x.index === id) || null;
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
    const row = { audit_id: x.id, channel: x.channel, verdict: v.verdict, grade: v.grade, verifier: v.verifier || null,
      evidence: v.evidence || null, ...(v.jev_sample ? { jev_sample: v.jev_sample } : {}) };
    if (x.kind === 'premise') { premisesOut[k.orig] = { ...row, status: channels[x.channel].trusted === false ? 'untrusted' : v.verdict.toLowerCase() }; continue; }
    const c = claims.get(k.orig) || {};
    const rested = Array.isArray(c.premises) ? c.premises : [];
    let status;
    if (v.verdict === 'REFUTED') status = 'refuted';
    else if (v.verdict === 'UNVERIFIABLE') status = 'unverifiable';
    else if (rested.some(id => premiseVerdict[id] === 'REFUTED')) status = 'stale';
    else if (rested.some(id => premiseVerdict[id] === 'UNVERIFIABLE')) status = 'premise_unverified';
    else if (channels[x.channel].trusted === false) status = 'untrusted';
    else if (c.impact === 'decision' && (v.grade === 'C' || v.grade === 'D')) status = 'not_established';
    else status = 'supported';
    items[k.orig] = { ...row, text: c.text, impact: c.impact, premises: rested, status };
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

  const count = s => Object.values(items).filter(r => r.status === s).length;
  const out = {
    ok: true, run: p.name, mode: freeze.mode, items: input.length, channels,
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
    jev_labeled: jevLabeled,
    ...(refused.length ? { jev_label_refused: refused } : {}),
  };
  writeJson(p.score, out);
  return out;
}

// ── sample / human ────────────────────────────────────────────────────────

// A simple random sample of n real verdicts (canaries never) — the error bound is
// computed on these only. Verdict × channel groups the random draw missed get one
// extra `coverage` item each, shown to the person but kept out of the bound.
function sample(runDir, { n = DEFAULT_SAMPLE, seed = 1, coverageMax = 10 } = {}) {
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
  const out = { run: p.name, n: picked.length, seed, items: picked.map(view), coverage: coverage.map(view) };
  writeJson(p.sample, out);
  return out;
}

function human(runDir, { answers, jevDir = jevDirDefault() } = {}) {
  const p = runPaths(runDir);
  const smp = readJson(p.sample);
  const raw = readJson(path.resolve(answers));
  const given = raw && typeof raw === 'object' && raw.answers && typeof raw.answers === 'object' ? raw.answers : raw;
  const scored = readJson(p.score).claims;
  const bank = readSamples(jevDir);
  let labeled = 0;
  const record = (list, inBound) => list.map(it => {
    const a = given && given[it.audit_id];
    const answer = ['agree', 'disagree', 'skip'].includes(a) ? a : 'skip';
    const sc = scored[it.claim_id] || {};
    // A person's answer on a Jev-judged item is a label: is the claim true?
    if (sc.jev_sample && answer !== 'skip' && it.verdict !== 'UNVERIFIABLE' && jevSampleOf(bank, sc.jev_sample, p.name, it.audit_id)) {
      const claimTrue = (it.verdict === 'SUPPORTED') === (answer === 'agree');
      jevLabel(jevDir, { sample: sc.jev_sample, value: claimTrue ? 'PASS' : 'FAIL', source: 'human' });
      labeled++;
    }
    return { audit_id: it.audit_id, verdict: it.verdict, answer, in_bound: inBound };
  });
  const rows = [...record(smp.items, true), ...record(smp.coverage || [], false)];
  const bound = rows.filter(r => r.in_bound);
  const out = {
    run: p.name, sampled: bound.length,
    answered: bound.filter(r => r.answer !== 'skip').length,
    agree: bound.filter(r => r.answer === 'agree').length,
    disagree: bound.filter(r => r.answer === 'disagree').length,
    skip: bound.filter(r => r.answer === 'skip').length,
    coverage: { answered: rows.filter(r => !r.in_bound && r.answer !== 'skip').length, disagree: rows.filter(r => !r.in_bound && r.answer === 'disagree').length },
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
  not_established: 'decision claim without A/B evidence' };

function report(runDir) {
  const p = runPaths(runDir);
  checkFreeze(p, readJson(p.freeze));
  const sc = readJson(p.score);
  const claimsList = Object.entries(sc.claims).map(([id, r]) => ({ id, text: r.text, verdict: r.verdict, grade: r.grade, status: r.status,
    mark: MARK[r.status], evidence: r.evidence ? [r.evidence.source, r.evidence.excerpt || r.evidence.how].filter(Boolean).join(' — ').slice(0, 300) : null }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const premises = Object.entries(sc.premises).map(([id, r]) => ({ id, verdict: r.verdict, grade: r.grade }));
  const channels = Object.fromEntries(Object.entries(sc.channels).map(([k, c]) => [k, { trusted: c.trusted, canaries: c.canaries, caught: c.caught, missed: c.missed.length }]));
  const out = { run: p.name, mode: sc.mode, counts: sc.counts, channels, premises, claims: claimsList };
  if (sc.mode === 'bulk') {
    out.canaries = sc.canaries;
    out.premises_refuted = premises.filter(x => x.verdict === 'REFUTED').map(x => x.id);
    const h = readJson(p.human, { optional: true });
    if (h && h.answered > 0) {
      const ub = upperBound95(h.disagree, h.answered);
      out.human = { n: h.answered, disagree: h.disagree, upper_bound_95: Number(ub.toFixed(3)),
        statement: `verifier verdicts wrong at most ${(ub * 100).toFixed(1)}% (one-sided 95%), from ${h.disagree} disagreement(s) in ${h.answered} randomly sampled`,
        ...(h.coverage && h.coverage.answered ? { coverage: h.coverage } : {}) };
    } else {
      out.human = { n: 0, status: 'not done — no error bound can be given' };
    }
  }
  writeJson(p.reportJson, out);
  const md = [`# Claim verification — ${p.name} (${sc.mode})`, ''];
  md.push(`- Claims: ${claimsList.length} · supported ${sc.counts.supported} · refuted ${sc.counts.refuted} · could not be checked ${sc.counts.unverifiable} · stale ${sc.counts.stale} · premise unchecked ${sc.counts.premise_unverified} · not established ${sc.counts.not_established} · untrusted ${sc.counts.untrusted}`);
  md.push(`- Channels: ${Object.entries(channels).map(([k, c]) => `${k} ${c.trusted === null ? 'untested' : c.trusted ? 'trusted' : 'NOT trusted'} (${c.caught}/${c.canaries} canaries)`).join(' · ')}`);
  if (out.human) md.push(`- Human check: ${out.human.statement || out.human.status}${out.human.coverage ? ` · coverage items: ${out.human.coverage.disagree} disagreement(s) in ${out.human.coverage.answered} (not in the bound)` : ''}`);
  md.push('', '| Claim | Status | Grade | Evidence |', '|---|---|---|---|');
  for (const c of claimsList) md.push(`| ${c.id} ${String(c.text || '').replace(/\|/g, '\\|')} | ${c.mark} | ${c.grade} | ${String(c.evidence || '').replace(/\|/g, '\\|')} |`);
  fs.writeFileSync(p.reportMd, md.join('\n') + '\n', { mode: 0o600 });
  return out;
}

// ── CLI ───────────────────────────────────────────────────────────────────

const USAGE = 'usage: claims.js lint <run dir>\n' +
  '       claims.js prepare <run dir> [--seed N] [--canary-rate 0.1] [--mode light|bulk]\n' +
  '       claims.js check-verifiers <run dir>\n' +
  '       claims.js screen-tc <run dir>\n' +
  '       claims.js import-results <run dir> --results <tc-results.jsonl> [--run-id <id>]\n' +
  '       claims.js score <run dir>\n' +
  '       claims.js sample <run dir> [--n 50] [--seed N]\n' +
  '       claims.js human <run dir> --answers <answers.json>\n' +
  '       claims.js report <run dir>';

function intOpt(v, name, def) {
  if (v === undefined) return def;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new ClaimsError(`${name} must be a non-negative integer`);
  return n;
}

function main(argv) {
  const [cmd, ...rest] = argv.slice(2);
  const spec = {
    lint: {}, 'check-verifiers': {}, 'screen-tc': {}, score: {}, report: {},
    prepare: { values: ['--seed', '--canary-rate', '--mode'] },
    'import-results': { values: ['--results', '--run-id'] },
    sample: { values: ['--n', '--seed'] },
    human: { values: ['--answers'] },
  }[cmd];
  if (!spec) { console.error(USAGE); return 2; }
  let opts, positional;
  try { ({ opts, positional } = parseArgs(rest, spec)); } catch (e) { console.error(`claims: ${e.message}\n${USAGE}`); return 2; }
  if (positional.length !== 1) { console.error(USAGE); return 2; }
  const run = positional[0];
  try {
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
      console.log(JSON.stringify({ mode: r.mode, counts: r.counts, canaries: r.canaries,
        untrusted_channels: Object.entries(r.channels).filter(([, c]) => c.trusted === false).map(([k]) => k), jev_labeled: r.jev_labeled }));
      return 0;
    }
    if (cmd === 'sample') {
      const r = sample(run, { n: intOpt(opts['--n'], '--n', DEFAULT_SAMPLE), seed: intOpt(opts['--seed'], '--seed', 1) });
      console.log(JSON.stringify({ n: r.n, file: runPaths(run).sample }));
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
    console.error(`claims: ${e.message}`);
    return 2;
  }
}

if (require.main === module) process.exitCode = main(process.argv);

module.exports = {
  lintRun, prepare, checkVerifiers, screenTc, importResults, score, sample, human, report, upperBound95,
  keyFileFor, projectRoot, mulberry32, main, ClaimsError, CHANNELS, VERDICTS, GRADES,
};
