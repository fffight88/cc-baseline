// Renders a 360x225 thumbnail (top 1440x900 at 1/4 scale) of every page in
// templates/design-previews/<slug>/index.html into tools/design-previews/.thumbs/.
// Needs Playwright with a Chromium build: `npm i --no-save playwright && npx playwright install chromium`.
'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', '..', 'templates', 'design-previews');
const OUT = path.join(__dirname, '.thumbs');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const slugs = fs.readdirSync(ROOT).filter(s => fs.existsSync(path.join(ROOT, s, 'index.html')));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 0.25 });
  const page = await ctx.newPage();
  for (const s of slugs) {
    await page.goto('file://' + path.join(ROOT, s, 'index.html'), { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(OUT, s + '.jpg'), type: 'jpeg', quality: 72 });
  }
  await browser.close();
  console.log(`${slugs.length} thumbnails → ${OUT}`);
})();
