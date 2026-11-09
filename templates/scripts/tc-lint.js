#!/usr/bin/env node
'use strict';

// Authoring checks for a TC file (docs/tc/<feature>.tc.json) — the code rules
// of reference_tc_authoring.md §5. Warns only: the orchestrator fixes the
// sentence or records why a warning stays.
//
//   node tc-lint.js <tc file>                 print warnings, exit 0
//   node tc-lint.js <tc file> --strict        exit 1 when there is any warning
//   node tc-lint.js <tc file> --json <out>    also write the `lint` block of
//                                             tc-check.json (other blocks kept)
//
// Exit 2 when the file cannot be read or is not a JSON object.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ENUMS = {
  sourceKind: ['source', 'requirement', 'decision'],
  level: ['functional', 'contract', 'integration'],
  surface: ['ui-web', 'api', 'cli'],
  channel: ['dom', 'ax-node', 'api', 'db', 'log', 'artifact', 'env', 'unknown'],
  basis: ['requirement', 'source-observation', 'proposal'],
  readiness: ['ready', 'needs-decision'],
};

const TOP_KEYS = ['schema_version', 'feature', 'title', 'plan', 'sources', 'actions', 'test_cases', 'open_questions'];
const TC_KEYS = ['id', 'title', 'action_refs', 'level', 'surface', 'preconditions', 'fixture', 'steps', 'expected', 'basis', 'readiness', 'notes'];
const SCREEN_CHANNELS = ['dom', 'ax-node'];

// Heuristics. They only raise warnings, so they lean toward catching too much.
const RE = {
  // Two facts joined in one sentence: "A and B", "A하고/되고/이며 B", "A 및 B".
  conjunction: /\b(and|as well as|also)\b|;|그리고|또한|\s및\s|[가-힣](?:고|며|면서)\s/gi,
  sequence: /\bthen\b|다음|이어서|[가-힣]\s후(?:에)?\s/i,
  quoted: /["“'‘][^"”'’]+["”'’]/g,
  hidden: /\bDB\b|database|데이터베이스|저장(?:된다|됨|되어|돼)|기록(?:된다|됨)|로그|\blogged\b|\bstored\b|persist|발송|\bsent to\b|webhook|\bqueue\b|서버/i,
  visible: /보인다|보임|표시|문구|나타난다|shown|visible|displayed|message|notice|toast/i,
  subjective: /보기 좋|자연스럽|깔끔|어색|예쁘|직관적|looks? (?:good|nice|clean|great)|\bnice\b|\bclean(?:ly)?\b|\bnatural\b|awkward|\bpretty\b|intuitive|beautiful/i,
  needsState: /로그인(?:한|된|\s?상태)|기존|등록된|저장된|logged in|signed in|existing|previously/i,
  failure: /오류|에러|실패|거절|거부|차단|잘못된|\berror\b|\bfail|reject|denied|invalid/i,
  negated: /없다|없음|않는다|않음|안 보인다|\bno\b|\bnot\b|never|without/i,
  standard: [
    ['Q.error_visible', /오류|에러|실패|\berror\b|\bfailed\b/i],
    ['Q.loading', /로딩|불러오는|loading/i],
    ['Q.dialog_open', /팝업|대화상자|모달|dialog|modal|popup/i],
    ['Q.success_notice', /성공|완료되었|success|succeeded/i],
    ['Q.item_added', /추가된|새 항목|\badded\b|new item/i],
  ],
};

function isStr(v) { return typeof v === 'string' && v.trim() !== ''; }
function arr(v) { return Array.isArray(v) ? v : []; }
function count(re, s) { return (String(s).match(re) || []).length; }

function lint(doc) {
  const warnings = [];
  const warn = (rule, where, message) => warnings.push({ rule, where, message });

  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    warn('format', 'file', 'TC file must be a JSON object');
    return warnings;
  }

  for (const k of Object.keys(doc)) {
    if (!TOP_KEYS.includes(k)) warn('unknown_field', 'file', `unknown top-level field "${k}" — run data and results do not belong in the TC file`);
  }
  if (doc.schema_version !== 1) warn('format', 'file', 'schema_version must be 1');
  const feature = doc.feature;
  if (!isStr(feature) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(feature)) warn('format', 'file', 'feature must be a kebab-case name');
  if (!isStr(doc.title)) warn('format', 'file', 'title is required');

  const sourceIds = new Set();
  for (const [i, s] of arr(doc.sources).entries()) {
    const where = `sources[${i}]`;
    if (!isStr(s && s.id)) { warn('format', where, 'source id is required'); continue; }
    if (sourceIds.has(s.id)) warn('format', where, `duplicate source id ${s.id}`);
    sourceIds.add(s.id);
    if (!ENUMS.sourceKind.includes(s.kind)) warn('format', s.id, `kind must be one of ${ENUMS.sourceKind.join(' | ')}`);
    if (!isStr(s.locator)) warn('format', s.id, 'locator is required');
  }

  const idRe = prefix => new RegExp(`^${prefix}\\.${String(feature).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.[a-z0-9]+(?:-[a-z0-9]+)*$`);
  const actionIds = new Set();
  for (const [i, a] of arr(doc.actions).entries()) {
    const where = (a && a.id) || `actions[${i}]`;
    if (!isStr(a && a.id) || !idRe('ACT').test(a.id)) warn('format', where, `action id must look like ACT.${feature}.<name>`);
    if (a && actionIds.has(a.id)) warn('format', where, `duplicate action id ${a.id}`);
    if (a && a.id) actionIds.add(a.id);
    for (const f of ['title', 'actor', 'trigger']) if (!isStr(a && a[f])) warn('format', where, `${f} is required`);
    for (const r of arr(a && a.evidence_refs)) if (!sourceIds.has(r)) warn('format', where, `evidence_refs points to unknown source ${r}`);
  }

  const tcs = arr(doc.test_cases);
  if (tcs.length === 0) warn('format', 'file', 'test_cases must not be empty');
  const tcIds = new Set();
  for (const [i, tc] of tcs.entries()) {
    if (!tc || typeof tc !== 'object') { warn('format', `test_cases[${i}]`, 'TC must be an object'); continue; }
    const id = isStr(tc.id) ? tc.id : `test_cases[${i}]`;
    if (!isStr(tc.id) || !idRe('TC').test(tc.id)) warn('format', id, `TC id must look like TC.${feature}.<name>`);
    if (tcIds.has(tc.id)) warn('format', id, `duplicate TC id ${tc.id}`);
    tcIds.add(tc.id);
    for (const k of Object.keys(tc)) {
      if (!TC_KEYS.includes(k)) warn('unknown_field', id, `unknown field "${k}" — URLs, results and thresholds go to tc-run.json / tc-results.jsonl`);
    }
    if (!isStr(tc.title)) warn('format', id, 'title is required');
    if (arr(tc.action_refs).length === 0) warn('format', id, 'action_refs must name at least one action');
    for (const r of arr(tc.action_refs)) if (!actionIds.has(r)) warn('format', id, `action_refs points to unknown action ${r}`);
    if (!ENUMS.level.includes(tc.level)) warn('format', id, `level must be one of ${ENUMS.level.join(' | ')}`);
    if (!ENUMS.surface.includes(tc.surface)) warn('format', id, `surface must be one of ${ENUMS.surface.join(' | ')}`);
    if (!ENUMS.readiness.includes(tc.readiness)) warn('format', id, `readiness must be one of ${ENUMS.readiness.join(' | ')}`);
    if (tc.preconditions !== undefined && !Array.isArray(tc.preconditions)) warn('format', id, 'preconditions must be a list');

    const basis = tc.basis || {};
    if (!ENUMS.basis.includes(basis.kind)) warn('format', id, `basis.kind must be one of ${ENUMS.basis.join(' | ')}`);
    for (const r of arr(basis.refs)) if (!sourceIds.has(r)) warn('format', id, `basis.refs points to unknown source ${r}`);
    if (basis.kind === 'proposal' && tc.readiness !== 'needs-decision') warn('basis', id, 'a proposal-based TC must be readiness: needs-decision');

    const steps = arr(tc.steps);
    if (steps.length === 0) warn('format', id, 'steps must not be empty');
    const stepText = [];
    for (const [s, step] of steps.entries()) {
      const where = `${id} steps[${s}]`;
      if (!isStr(step && step.goal)) { warn('format', where, 'goal is required'); continue; }
      stepText.push(step.goal);
      if (!isStr(step.done_when && step.done_when.expect)) warn('done_when', where, 'add done_when.expect — one sentence for what the screen looks like when the step is done');
      if (step.input_refs !== undefined && !(Array.isArray(step.input_refs) && step.input_refs.every(isStr))) {
        warn('format', where, 'input_refs must be a list of input names (values live in tc-run.json)');
      }
      if (count(RE.conjunction, step.goal) >= 2 || RE.sequence.test(step.goal)) {
        warn('step_size', where, 'this step holds several user intents — split it into one step per intent');
      }
    }

    const hasPre = arr(tc.preconditions).length > 0 || isStr(tc.fixture);
    if (!hasPre && stepText.some(g => RE.needsState.test(g))) {
      warn('preconditions', id, 'steps need a signed-in user or existing data — add preconditions or a fixture');
    }

    const expected = arr(tc.expected);
    if (expected.length === 0) warn('format', id, 'expected must not be empty');
    let failureLines = 0;
    for (const [e, exp] of expected.entries()) {
      const where = `${id} expected[${e}]`;
      if (!isStr(exp && exp.text)) { warn('format', where, 'text is required'); continue; }
      const text = exp.text;
      const obs = exp.observe;
      if (!obs || typeof obs !== 'object') {
        warn('observe', where, 'add observe.channel — where the fact is read (dom, api, db, log, …)');
      } else if (!ENUMS.channel.includes(obs.channel)) {
        warn('format', where, `observe.channel must be one of ${ENUMS.channel.join(' | ')}`);
      } else if (obs.channel === 'unknown') {
        warn('observe', where, 'observe.channel is unknown — name the channel once it is known (keep the sentence)');
      }
      const channel = obs && obs.channel;

      if (count(RE.conjunction, text) >= 1 || count(RE.quoted, text) >= 3) {
        warn('single_fact', where, 'one expected result should check one fact — split this line');
      }
      if (SCREEN_CHANNELS.includes(channel) && RE.hidden.test(text) && !RE.visible.test(text)) {
        warn('hidden_data', where, 'this fact lives off-screen — use an api / db / log channel instead of the screen');
      }
      if (RE.subjective.test(text)) {
        warn('subjective', where, 'subjective/visual judgment is not a TC — leave it to publisher visual review');
      }
      if (SCREEN_CHANNELS.includes(channel) && !isStr(obs.key) && !isStr(obs.question_id)) {
        const hit = RE.standard.find(([, re]) => re.test(text));
        if (hit) warn('standard_question', where, `use the standard question ${hit[0]} (observe.question_id) instead of a free sentence`);
      }
      if (RE.failure.test(text) && !RE.negated.test(text)) failureLines++;
    }
    if (failureLines > 0 && failureLines < expected.length) {
      warn('failure_mix', id, 'success and error expectations are mixed — put the error flow in its own TC');
    }
  }

  return warnings;
}

function countByRule(warnings) {
  const counts = {};
  for (const w of warnings) counts[w.rule] = (counts[w.rule] || 0) + 1;
  return counts;
}

function writeJson(out, block) {
  let data = {};
  try { data = JSON.parse(fs.readFileSync(out, 'utf8')); } catch { /* new or unreadable file */ }
  if (!data || typeof data !== 'object' || Array.isArray(data)) data = {};
  data.lint = block;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(data, null, 2) + '\n');
}

function main(argv) {
  const args = argv.slice(2);
  const strict = args.includes('--strict');
  const jsonAt = args.indexOf('--json');
  const out = jsonAt >= 0 ? args[jsonAt + 1] : null;
  const file = args.find((a, i) => !a.startsWith('--') && (jsonAt < 0 || i !== jsonAt + 1));
  if (!file || (jsonAt >= 0 && !out)) {
    console.error('usage: node tc-lint.js <tc file> [--strict] [--json <out>]');
    return 2;
  }

  let raw, doc;
  try {
    raw = fs.readFileSync(file, 'utf8');
    doc = JSON.parse(raw);
  } catch (e) {
    console.error(`tc-lint: cannot read ${file}: ${e.message}`);
    return 2;
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    console.error(`tc-lint: ${file} is not a JSON object`);
    return 2;
  }

  const warnings = lint(doc);
  for (const w of warnings) console.log(`WARN  ${w.rule.padEnd(17)} ${w.where}  ${w.message}`);
  const counts = countByRule(warnings);
  const summary = Object.entries(counts).map(([r, n]) => `${r} ${n}`).join(', ');
  console.log(`tc-lint: ${arr(doc.test_cases).length} TC, ${warnings.length} warning(s)${summary ? ` — ${summary}` : ''}`);

  if (out) {
    writeJson(out, {
      tool: 'tc-lint',
      version: 1,
      file,
      tc_digest: crypto.createHash('sha256').update(raw).digest('hex'),
      checked_at: new Date().toISOString(),
      warnings,
      counts,
    });
  }
  return strict && warnings.length > 0 ? 1 : 0;
}

if (require.main === module) {
  process.exitCode = main(process.argv);
}

module.exports = { lint, countByRule };
