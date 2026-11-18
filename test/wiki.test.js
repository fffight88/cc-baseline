'use strict';

// wiki.js — screen / feature wiki metadata (docs/tc/wiki.tc.json).
// Kept apart from test/run.js; `npm test` runs both.

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const WIKI = path.join(ROOT, 'templates', 'scripts', 'wiki.js');
const { parseFrontmatter, stampText } = require(WIKI);

const tests = [];
function t(name, fn) { tests.push({ name, fn }); }

const temps = [];
function tmp(prefix) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  temps.push(dir);
  return dir;
}
function project() {
  const dir = tmp('wiki-test-');
  fs.mkdirSync(path.join(dir, 'src'));
  fs.mkdirSync(path.join(dir, 'docs', 'wiki', 'screens'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'docs', 'wiki', 'features'), { recursive: true });
  return dir;
}
function write(root, rel, text) {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
}
function screen(root, slug, fields = {}, body = '## 역할\n- test page\n') {
  const f = { kind: 'screen', slug, title: `${slug} title`, route: `/${slug}`, files: `[src/${slug}.js]`, ...fields };
  const fm = Object.entries(f).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}: ${v}`).join('\n');
  write(root, `docs/wiki/screens/${slug}.md`, `---\n${fm}\n---\n\n${body}`);
}
function wiki(root, ...args) {
  const r = spawnSync(process.execPath, [WIKI, ...args, '--root', root], { encoding: 'utf8' });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch { /* text output */ }
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, json };
}
const statusOf = (root, slug) => wiki(root, 'check', '--json').json.pages[slug];
const frontmatterOf = (root, rel) => parseFrontmatter(fs.readFileSync(path.join(root, rel), 'utf8')).data;

// two stamped screens: order-list -> order-detail
function twoScreens() {
  const root = project();
  write(root, 'src/order-list.js', 'list v1\n');
  write(root, 'src/order-detail.js', 'detail v1\n');
  screen(root, 'order-list', { components: '[DataTable, Pager]', links_to: '[order-detail]', apis: '[GET /api/orders]' });
  screen(root, 'order-detail', { components: '[StatusBadge]', apis: '[POST /api/orders/:id/cancel]' }, '## 역할\nnote: keep this\n');
  assert.equal(wiki(root, 'stamp', '--all').code, 0);
  return root;
}

// ── TCs ─────────────────────────────────────────────────────────────────

t('TC.wiki.check-ok: a page right after stamp is ok', () => {
  const root = twoScreens();
  assert.equal(statusOf(root, 'order-detail').status, 'ok');
});

t('TC.wiki.check-stale: a page is stale after a listed file changes, the other stays ok', () => {
  const root = twoScreens();
  write(root, 'src/order-detail.js', 'detail v2\n');
  assert.equal(statusOf(root, 'order-detail').status, 'stale');
  assert.equal(statusOf(root, 'order-list').status, 'ok');
});

t('TC.wiki.check-missing-file: a page is broken when a listed file is missing', () => {
  const root = twoScreens();
  fs.unlinkSync(path.join(root, 'src/order-detail.js'));
  const p = statusOf(root, 'order-detail');
  assert.equal(p.status, 'broken');
  assert.ok(p.problems.some(x => x.includes('src/order-detail.js')), p.problems.join('; '));
});

t('TC.wiki.check-broken-link: a links_to entry with no page makes the page broken', () => {
  const root = twoScreens();
  screen(root, 'order-list', { components: '[DataTable, Pager]', links_to: '[order-detail, refund-history]' });
  assert.equal(wiki(root, 'stamp', 'order-list').code, 0);
  const p = statusOf(root, 'order-list');
  assert.equal(p.status, 'broken');
  assert.ok(p.problems.some(x => x.includes('refund-history')));
});

t('TC.wiki.check-invalid: a page with no kind is invalid', () => {
  const root = twoScreens();
  write(root, 'src/draft-screen.js', 'x\n');
  screen(root, 'draft-screen', { kind: undefined });
  assert.equal(statusOf(root, 'draft-screen').status, 'invalid');
});

t('TC.wiki.strict-exit: --strict exits 1 when a page is not ok (0 when all are ok)', () => {
  const root = twoScreens();
  assert.equal(wiki(root, 'check', '--strict').code, 0);
  write(root, 'src/order-list.js', 'list v2\n');
  assert.equal(wiki(root, 'check', '--strict').code, 1);
  assert.equal(wiki(root, 'check').code, 0, 'without --strict the check still exits 0');
});

t('TC.wiki.stamp-refreshes: after stamp a stale page is ok and its body is kept', () => {
  const root = twoScreens();
  write(root, 'src/order-detail.js', 'detail v2\n');
  assert.equal(statusOf(root, 'order-detail').status, 'stale');
  assert.equal(wiki(root, 'stamp', 'order-detail').code, 0);
  assert.equal(statusOf(root, 'order-detail').status, 'ok');
  const text = fs.readFileSync(path.join(root, 'docs/wiki/screens/order-detail.md'), 'utf8');
  assert.match(text, /^note: keep this$/m);
  assert.equal((text.match(/^source_hash:/mg) || []).length, 1, 'the hash line is replaced, not added twice');
});

t('TC.wiki.stamp-outside-root: stamping a page that lists a file outside the project is refused', () => {
  const root = twoScreens();
  const outside = tmp('wiki-outside-');
  write(outside, 'outside.js', 'outside\n');
  screen(root, 'evil', { files: `[../${path.basename(outside)}/outside.js]` });
  const r = wiki(root, 'stamp', 'evil');
  assert.equal(r.code, 2, r.stderr);
  assert.equal(frontmatterOf(root, 'docs/wiki/screens/evil.md').source_hash, undefined);
  // --all refuses before writing any page
  write(root, 'src/order-list.js', 'list v2\n');
  assert.equal(wiki(root, 'stamp', '--all').code, 2);
  assert.equal(statusOf(root, 'order-list').status, 'stale', 'a refused --all stamps nothing');
});

t('TC.wiki.index-lists-pages: index.md lists every screen with its status', () => {
  const root = twoScreens();
  write(root, 'src/order-detail.js', 'detail v2\n');
  assert.equal(wiki(root, 'index').code, 0);
  const idx = fs.readFileSync(path.join(root, 'docs/wiki/index.md'), 'utf8');
  assert.match(idx, /^\| \[order-list\]\(screens\/order-list\.md\) \|.*\| ok \|$/m);
  assert.match(idx, /^\| \[order-detail\]\(screens\/order-detail\.md\) \|.*\| stale \|$/m);
  assert.match(idx, /do not edit/);
});

t('TC.wiki.find-component: a component name finds only the screens that use it', () => {
  const root = twoScreens();
  const r = wiki(root, 'find', 'datatable', '--json');
  assert.equal(r.code, 0);
  assert.deepEqual(r.json.results.map(x => x.slug), ['order-list']);
  assert.ok(r.json.results[0].matched.includes('components'));
  assert.equal(r.json.results[0].status, 'ok');
  assert.deepEqual(wiki(root, 'find', 'POST /api/orders', '--json').json.results.map(x => x.slug), ['order-detail']);
});

t('TC.wiki.symlink-wiki-refused: index is refused when docs/wiki is a symlink', () => {
  const root = project();
  const target = tmp('wiki-target-');
  fs.rmSync(path.join(root, 'docs', 'wiki'), { recursive: true });
  fs.symlinkSync(target, path.join(root, 'docs', 'wiki'));
  const r = wiki(root, 'index');
  assert.equal(r.code, 2, r.stderr);
  assert.equal(fs.existsSync(path.join(target, 'index.md')), false);
});

// ── edges ───────────────────────────────────────────────────────────────

t('wiki frontmatter: quotes, empty list, comments; duplicate key and unclosed list are errors', () => {
  const a = parseFrontmatter('---\ntitle: "주문: 목록"\nfiles: []\n# comment\nstates: [\'loading\', empty]\n---\nbody');
  assert.deepEqual(a.errors, []);
  assert.equal(a.data.title, '주문: 목록');
  assert.deepEqual(a.data.files, []);
  assert.deepEqual(a.data.states, ['loading', 'empty']);
  assert.ok(parseFrontmatter('---\nslug: a\nslug: b\n---\n').errors.some(e => e.includes('duplicate')));
  assert.ok(parseFrontmatter('---\nfiles: [a, b\n---\n').errors.some(e => e.includes('not closed')));
  assert.ok(parseFrontmatter('no fence\n').errors.length);
  assert.ok(parseFrontmatter('---\nslug: a\n').errors.some(e => e.includes('not closed')));
});

t('wiki stampText: adds the two keys when missing, replaces them when present, keeps other lines', () => {
  const once = stampText('---\nkind: screen\n---\nbody\n', 'aaaa', 'T1');
  assert.equal(once, '---\nkind: screen\nsource_hash: aaaa\nstamped_at: T1\n---\nbody\n');
  assert.equal(stampText(once, 'bbbb', 'T2'), '---\nkind: screen\nsource_hash: bbbb\nstamped_at: T2\n---\nbody\n');
});

t('wiki check: unknown key, slug/file mismatch, wrong directory, duplicate slug are invalid; unstamped is reported', () => {
  const root = twoScreens();
  write(root, 'src/x.js', 'x\n');
  screen(root, 'typo', { componets: '[A]', files: '[src/x.js]' });
  screen(root, 'renamed', { slug: 'other', files: '[src/x.js]' });
  write(root, 'docs/wiki/features/order-list.md', '---\nkind: feature\nslug: order-list\ntitle: dup\nscreens: [order-detail]\n---\n');
  screen(root, 'fresh', { files: '[src/x.js]' });
  const pages = wiki(root, 'check', '--json').json.pages;
  assert.equal(pages.typo.status, 'invalid');
  assert.equal(pages.renamed.status, 'invalid');
  assert.equal(pages['order-list'].status, 'invalid', 'a slug used by a screen and a feature');
  assert.equal(pages.fresh.status, 'unstamped');
  write(root, 'docs/wiki/features/wrong.md', '---\nkind: screen\nslug: wrong\ntitle: t\nroute: /w\nfiles: [src/x.js]\n---\n');
  assert.equal(statusOf(root, 'wrong').status, 'invalid');
});

t('wiki feature page: screens must name screen pages; ok after stamp with no files', () => {
  const root = twoScreens();
  write(root, 'docs/wiki/features/order-cancel.md', '---\nkind: feature\nslug: order-cancel\ntitle: 주문 취소\nscreens: [order-list, order-detail]\napis: [POST /api/orders/:id/cancel]\n---\n');
  assert.equal(wiki(root, 'stamp', 'order-cancel').code, 0);
  assert.equal(statusOf(root, 'order-cancel').status, 'ok');
  write(root, 'docs/wiki/features/bad-feature.md', '---\nkind: feature\nslug: bad-feature\ntitle: t\nscreens: [order-cancel]\n---\n');
  assert.equal(statusOf(root, 'bad-feature').status, 'broken', 'screens may only name screen pages');
});

t('wiki: a symlinked page or file entry escaping the project is not trusted', () => {
  const root = twoScreens();
  const outside = tmp('wiki-out-');
  fs.writeFileSync(path.join(outside, 'secret.js'), 's\n');
  fs.symlinkSync(path.join(outside, 'secret.js'), path.join(root, 'src', 'link.js'));
  screen(root, 'linked', { files: '[src/link.js]' });
  assert.equal(wiki(root, 'stamp', 'linked').code, 2);
  assert.equal(statusOf(root, 'linked').status, 'broken');
  fs.writeFileSync(path.join(outside, 'page.md'), '---\nkind: screen\n---\n');
  fs.symlinkSync(path.join(outside, 'page.md'), path.join(root, 'docs/wiki/screens/sym.md'));
  assert.equal(statusOf(root, 'sym').status, 'invalid');
  assert.equal(wiki(root, 'stamp', 'sym').code, 2);
});

t('wiki: no docs/wiki — check and find report it, stamp and index are refused', () => {
  const root = tmp('wiki-none-');
  const c = wiki(root, 'check', '--json');
  assert.equal(c.code, 0);
  assert.equal(c.json.wiki, false);
  assert.equal(wiki(root, 'find', 'x', '--json').json.wiki, false);
  assert.equal(wiki(root, 'stamp', '--all').code, 2);
  assert.equal(wiki(root, 'index').code, 2);
  assert.equal(fs.existsSync(path.join(root, 'docs')), false, 'nothing is created');
});

t('wiki usage: unknown option, unknown command, empty find term exit 2', () => {
  const root = twoScreens();
  assert.equal(wiki(root, 'check', '--nope').code, 2);
  assert.equal(wiki(root, 'frobnicate').code, 2);
  assert.equal(wiki(root, 'find', ' ').code, 2);
  assert.equal(wiki(root, 'stamp', 'order-list', '--all').code, 2);
  assert.equal(wiki(root, 'stamp', 'no-such-page').code, 2);
});

t('wiki audit fixes: control characters / long entries invalid, non-file page invalid, CRLF kept, --all with no pages', () => {
  const root = twoScreens();
  write(root, 'src/x.js', 'x\n');
  screen(root, 'esc', { title: 'bad\u001b[31m', files: '[src/x.js]' });
  screen(root, 'long', { components: `[${'a'.repeat(301)}]`, files: '[src/x.js]' });
  fs.mkdirSync(path.join(root, 'docs/wiki/screens/dir.md'));
  const pages = wiki(root, 'check', '--json').json.pages;
  assert.equal(pages.esc.status, 'invalid');
  assert.equal(pages.long.status, 'invalid');
  assert.equal(pages.dir.status, 'invalid');
  const crlf = '---\r\nkind: screen\r\nslug: crlf\r\ntitle: t\r\nroute: /c\r\nfiles: [src/x.js]\r\n---\r\n\r\nbody\r\n';
  write(root, 'docs/wiki/screens/crlf.md', crlf);
  assert.equal(wiki(root, 'stamp', 'crlf').code, 0);
  const after = fs.readFileSync(path.join(root, 'docs/wiki/screens/crlf.md'), 'utf8');
  assert.equal(after.replace(/\r\n/g, '').includes('\n'), false, 'no bare LF after stamping a CRLF page');
  const empty = project();
  const r = wiki(empty, 'stamp', '--all');
  assert.equal(r.code, 2);
  assert.match(r.stderr, /no pages to stamp/);
});

t('wiki review fixes: a feature goes stale with its screens; missing tc is broken; features table; text output; quoted commas', () => {
  const root = twoScreens();
  write(root, 'docs/wiki/features/order-cancel.md', '---\nkind: feature\nslug: order-cancel\ntitle: 주문 취소\nscreens: [order-detail]\n---\n');
  assert.equal(wiki(root, 'stamp', 'order-cancel').code, 0);
  assert.equal(statusOf(root, 'order-cancel').status, 'ok');
  write(root, 'src/order-detail.js', 'detail v2\n');
  assert.equal(statusOf(root, 'order-cancel').status, 'stale', 'a change in a screen file makes its feature stale');
  assert.equal(statusOf(root, 'order-list').status, 'ok');
  // a tc file that does not exist
  screen(root, 'order-list', { components: '[DataTable, Pager]', links_to: '[order-detail]', tc: 'docs/tc/nope.tc.json' });
  const p = statusOf(root, 'order-list');
  assert.equal(p.status, 'broken');
  assert.ok(p.problems.some(x => x.includes('nope.tc.json')));
  // features table in index.md
  assert.equal(wiki(root, 'index').code, 0);
  const idx = fs.readFileSync(path.join(root, 'docs/wiki/index.md'), 'utf8');
  assert.match(idx, /^\| \[order-cancel\]\(features\/order-cancel\.md\) \| 주문 취소 \| order-detail \| stale \|$/m);
  // plain text output
  const c = wiki(root, 'check');
  assert.match(c.stdout, /^stale\s+feature\s+order-cancel/m);
  assert.match(c.stdout, /^wiki: 0 invalid, 1 broken, 0 unstamped, 2 stale, 0 ok$/m);
  assert.match(wiki(root, 'find', 'statusbadge').stdout, /^stale\s+screen\s+order-detail\s+docs\/wiki\/screens\/order-detail\.md\s+\(components\)$/m);
  assert.match(wiki(root, 'find', 'zzz').stdout, /nothing matches/);
  // quoted list items keep their commas; an open quote is an error
  const q = parseFrontmatter('---\napis: ["GET /a,b", \'POST /c\', d]\n---\n');
  assert.deepEqual(q.errors, []);
  assert.deepEqual(q.data.apis, ['GET /a,b', 'POST /c', 'd']);
  assert.ok(parseFrontmatter('---\napis: ["GET /a, b]\n---\n').errors.some(e => e.includes('unbalanced quote')));
});

// ── runner (same output as test/run.js) ──────────────────────────────────

(async () => {
  let pass = 0;
  const failures = [];
  console.log(`\nRunning ${tests.length} wiki tests:\n`);
  for (const { name, fn } of tests) {
    try { await fn(); process.stdout.write(`  ✅ ${name}\n`); pass++; }
    catch (e) { process.stdout.write(`  ❌ ${name}\n`); failures.push({ name, error: e }); }
  }
  console.log(`\n${pass} passed, ${failures.length} failed (${tests.length} total)`);
  for (const { name, error } of failures) console.log(`\n  ❌ ${name}\n     ${error.message}`);
  for (const d of temps) fs.rmSync(d, { recursive: true, force: true });
  if (failures.length) process.exit(1);
})();
