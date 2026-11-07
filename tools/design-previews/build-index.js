// Builds templates/design-previews/index.html: the gallery of every DESIGN.md
// preview page. Brands, one-liners, categories and lanes come from
// reference_design_md_index.md so the gallery never drifts from the catalog.
// Thumbnails from .thumbs/ (see thumbs.js) are embedded as data URIs, because
// the installer copies templates as UTF-8 text and cannot carry binary files.
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const CATALOG = path.join(REPO, 'templates', 'memory', 'reference_design_md_index.md');
const ROOT = path.join(REPO, 'templates', 'design-previews');
const THUMBS = path.join(__dirname, '.thumbs');
const RAW = slug => `https://raw.githubusercontent.com/VoltAgent/awesome-design-md/3b605329240ce735b510037cca322f1831fdd7f8/design-md/${slug}/DESIGN.md`;

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const rows = [];
let cat = null;
for (const line of fs.readFileSync(CATALOG, 'utf8').split('\n')) {
  if (line.startsWith('### ')) { cat = line.slice(4).trim(); continue; }
  const m = line.trim().match(/^\| `([^`]+)` \| ([^|]+) \| ([^|]+) \| (.+) \|$/);
  if (m && cat) rows.push({ slug: m[1], brand: m[2].trim(), desc: m[3].trim(), cat, ui: m[4].includes('product-ui') });
}

const missing = rows.filter(r => !fs.existsSync(path.join(ROOT, r.slug, 'index.html'))).map(r => r.slug);
const noThumb = rows.filter(r => !fs.existsSync(path.join(THUMBS, r.slug + '.jpg'))).map(r => r.slug);
if (missing.length) throw new Error(`missing pages: ${missing.join(', ')}`);
if (noThumb.length) throw new Error(`missing thumbnails (run thumbs.js): ${noThumb.join(', ')}`);

const thumb = slug => 'data:image/jpeg;base64,' + fs.readFileSync(path.join(THUMBS, slug + '.jpg')).toString('base64');
const cats = [...new Set(rows.map(r => r.cat))];
const nUi = rows.filter(r => r.ui).length;

const card = r => `<article class="card" data-cat="${esc(r.cat)}" data-ui="${r.ui ? 1 : 0}" data-q="${esc((r.brand + ' ' + r.slug).toLowerCase())}" id="${esc(r.slug)}">
  <a class="shot" href="${esc(r.slug)}/"><img src="${thumb(r.slug)}" alt="${esc(r.brand)} preview" width="360" height="225"></a>
  <div class="meta">
    <div class="row"><a class="brand" href="${esc(r.slug)}/">${esc(r.brand)}</a><code>${esc(r.slug)}</code></div>
    <p>${esc(r.desc)}</p>
    <div class="row foot">${r.ui ? '<span class="lane ui">product-ui</span>' : '<span class="lane">marketing only</span>'}<a class="raw" href="${RAW(r.slug)}" target="_blank" rel="noopener">DESIGN.md</a></div>
  </div>
</article>`;

const chips = cats.map(c => `<button class="chip" type="button" data-cat="${esc(c)}" aria-pressed="false">${esc(c)}</button>`).join('');
const sections = cats.map(c => `<section class="cat" data-cat="${esc(c)}"><h2>${esc(c)}</h2><div class="grid">${rows.filter(r => r.cat === c).map(card).join('\n')}</div></section>`).join('\n');

const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>DESIGN.md Catalog Previews</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap">
<style>
:root{--bg:#f4f4f2;--panel:#fff;--fg:#1b1c1e;--muted:#6b6d72;--line:#dddcd8;--accent:#2f5bd3;--ui:#1f7a4a;
--sans:'Schibsted Grotesk',system-ui,-apple-system,sans-serif;--mono:'JetBrains Mono',ui-monospace,Menlo,monospace}
@media (prefers-color-scheme:dark){:root{--bg:#141518;--panel:#1d1e22;--fg:#ececea;--muted:#9a9ca2;--line:#2e3036;--accent:#7d9bff;--ui:#4cc483;color-scheme:dark}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 var(--sans)}
.wrap{max-width:1440px;margin:0 auto;padding:0 16px}
header{padding:36px 0 18px}
h1{font-size:clamp(24px,3vw,34px);margin:0 0 8px;letter-spacing:-.02em}
header p{margin:0;color:var(--muted);max-width:76ch}
header code{font-family:var(--mono);font-size:.88em}
.rail{position:sticky;top:0;z-index:5;background:var(--bg);border-bottom:1px solid var(--line);padding:10px 0}
.rail .wrap{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.chip{font:inherit;font-size:13px;padding:5px 11px;border-radius:999px;border:1px solid var(--line);background:var(--panel);color:var(--fg);cursor:pointer}
.chip[aria-pressed="true"]{background:var(--fg);color:var(--bg);border-color:var(--fg)}
#q{font:inherit;font-size:14px;padding:6px 12px;border:1px solid var(--line);border-radius:8px;background:var(--panel);color:var(--fg);width:200px;max-width:100%}
#count{margin-left:auto;font:12px var(--mono);color:var(--muted)}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.cat{padding:28px 0 8px}
.cat h2{font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:0 0 12px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:18px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;overflow:hidden;display:flex;flex-direction:column;min-width:0}
.card:target{outline:3px solid var(--accent);outline-offset:2px}
.shot{display:block;aspect-ratio:16/10;background:var(--line)}
.shot img{display:block;width:100%;height:100%;object-fit:cover;object-position:top}
.meta{padding:12px 14px;display:flex;flex-direction:column;gap:6px;flex:1}
.row{display:flex;align-items:baseline;gap:8px;min-width:0}
.brand{font-weight:600;font-size:16px;color:var(--fg);text-decoration:none}
.brand:hover{color:var(--accent)}
.row code{font:12px var(--mono);color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.meta p{margin:0;font-size:13px;color:var(--muted)}
.foot{margin-top:auto;justify-content:space-between}
.lane{font:11px var(--mono);padding:1px 7px;border-radius:4px;border:1px solid var(--line);color:var(--muted)}
.lane.ui{color:var(--ui);border-color:var(--ui)}
.raw{font-size:12px;color:var(--accent)}
footer{padding:40px 0 60px;color:var(--muted);font-size:13px;max-width:80ch}
@media (max-width:560px){#count{margin-left:0}.grid{grid-template-columns:1fr}}
</style></head><body>
<header class="wrap">
  <h1>DESIGN.md Catalog Previews</h1>
  <p>One page per entry in cc-baseline's DESIGN.md catalog (${rows.length} brands, ${nUi} usable for <code>product-ui</code>). Each page follows that file's own components, layout rules and Do's/Don'ts, so it shows what design-director's recommendation would actually look like. Fonts are open-source substitutes and imagery is drawn, not photographed. Not affiliated with any brand.</p>
</header>
<div class="rail"><div class="wrap">
  <div class="chips" id="cats"><button class="chip" type="button" data-cat="" aria-pressed="true">All</button>${chips}</div>
  <button class="chip" type="button" id="ui" aria-pressed="false">product-ui only</button>
  <input id="q" type="search" placeholder="Search brand" aria-label="Search brand">
  <span id="count"></span>
</div></div>
<main class="wrap">${sections}</main>
<footer class="wrap">Built from VoltAgent/awesome-design-md at commit 3b60532 and served locally by cc-baseline. Brand names and marks belong to their owners; these pages are design references only.</footer>
<script>
const st={cat:'',ui:false,q:''};
const cards=[...document.querySelectorAll('.card')],secs=[...document.querySelectorAll('.cat')];
function render(){let n=0;cards.forEach(c=>{const ok=(!st.cat||c.dataset.cat===st.cat)&&(!st.ui||c.dataset.ui==='1')&&(!st.q||c.dataset.q.includes(st.q));c.hidden=!ok;n+=ok});
secs.forEach(s=>s.hidden=!s.querySelector('.card:not([hidden])'));document.getElementById('count').textContent=n+' / '+cards.length}
document.getElementById('cats').addEventListener('click',e=>{const b=e.target.closest('.chip');if(!b)return;st.cat=b.dataset.cat;document.querySelectorAll('#cats .chip').forEach(x=>x.setAttribute('aria-pressed',x===b));render()});
document.getElementById('ui').addEventListener('click',e=>{st.ui=!st.ui;e.currentTarget.setAttribute('aria-pressed',st.ui);render()});
document.getElementById('q').addEventListener('input',e=>{st.q=e.target.value.trim().toLowerCase();render()});
render();
</script>
</body></html>
`;

fs.writeFileSync(path.join(ROOT, 'index.html'), page, 'utf8');
console.log(`${rows.length} entries (${nUi} product-ui) → ${path.join(ROOT, 'index.html')}`);
