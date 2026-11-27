'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const { AXE_VENDOR_DIR, AXE_FILE } = require('../paths');
const { checkCmd } = require('./_util');

// One exact version, installed without package scripts: this file is later run inside pages.
const AXE_VERSION = '4.14.1';

// publisher's a11y runtime scan injects axe-core from this local copy
// (page.addScriptTag({ path })). It never loads axe from a CDN: an external
// script on a screen with real data is a way out for that data.
async function installAxe(dryRun) {
  if (fs.existsSync(AXE_FILE)) {
    console.log('\n♿ axe-core: ~/.claude/vendor copy detected, skipping install');
    return;
  }
  if (!checkCmd('npm')) {
    console.log('\n⚠️  axe-core: `npm` not found, skipping install — publisher will skip the a11y runtime scan. Install Node.js and re-run `cc-baseline --yes`.');
    return;
  }
  console.log('\n♿ Installing axe-core (~/.claude/vendor, for the publisher a11y scan)');
  if (dryRun) {
    console.log('[DRY RUN] Skipping axe-core installation.');
    return;
  }
  try {
    fs.mkdirSync(AXE_VENDOR_DIR, { recursive: true });
    execFileSync('npm', ['install', '--prefix', AXE_VENDOR_DIR, '--ignore-scripts', '--save-exact', '--no-audit', '--no-fund', `axe-core@${AXE_VERSION}`], { stdio: 'inherit' });
    if (fs.existsSync(AXE_FILE)) console.log('  ✅ axe-core installed');
    else console.log(`  ⚠️  npm succeeded but ${AXE_FILE} not found. Manual check required.`);
  } catch (e) {
    console.log(`  ⚠️  axe-core install failed (publisher will skip the a11y runtime scan): ${e.message}`);
    console.log(`     Manual: npm install --prefix "${AXE_VENDOR_DIR}" --ignore-scripts axe-core@${AXE_VERSION}`);
  }
}

module.exports = { installAxe, AXE_VERSION };
