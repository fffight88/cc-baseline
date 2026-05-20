'use strict';

const { execSync } = require('child_process');
const fs = require('fs');
const { NPM_GLOBAL_PREFIX, PLAYWRIGHT_MCP_BIN } = require('../paths');
const { checkCmd } = require('./_util');

async function installPlaywrightMcp(dryRun) {
  if (fs.existsSync(PLAYWRIGHT_MCP_BIN)) {
    console.log('\n🎭 Playwright MCP: ~/.npm-global/bin/playwright-mcp detected, skipping install');
    return;
  }

  if (!checkCmd('npm')) {
    console.log('\n⚠️  Playwright MCP: `npm` not found, skipping install. Install Node.js and re-run `cc-baseline --yes`.');
    return;
  }

  console.log('\n🎭 Installing Playwright MCP (~/.npm-global local prefix)');
  if (dryRun) {
    console.log('[DRY RUN] Skipping Playwright MCP installation.');
    return;
  }

  try {
    fs.mkdirSync(NPM_GLOBAL_PREFIX, { recursive: true });
    execSync(`npm install -g @playwright/mcp --prefix "${NPM_GLOBAL_PREFIX}"`, { stdio: 'inherit' });
    if (fs.existsSync(PLAYWRIGHT_MCP_BIN)) {
      console.log('  ✅ Playwright MCP installed');
      console.log(`  ℹ️  PATH check: add ${NPM_GLOBAL_PREFIX}/bin to your shell rc if not already in PATH`);
    } else {
      console.log(`  ⚠️  npm succeeded but ${PLAYWRIGHT_MCP_BIN} binary not found. Manual check required.`);
    }
  } catch (e) {
    console.log(`  ⚠️  Playwright MCP auto-install failed (manual install required): ${e.message}`);
    console.log(`     Manual: npm install -g @playwright/mcp --prefix "${NPM_GLOBAL_PREFIX}"`);
  }
}

module.exports = { installPlaywrightMcp };
