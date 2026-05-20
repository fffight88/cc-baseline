'use strict';

const { execSync } = require('child_process');
const { checkCmd } = require('./_util');

async function installNotifier(dryRun) {
  if (process.platform !== 'darwin') return;
  if (checkCmd('terminal-notifier')) {
    console.log('\n🔔 Notifications: terminal-notifier detected, skipping install');
    return;
  }
  console.log('\n🔔 Installing terminal-notifier (improves notification reliability)');
  if (dryRun) {
    console.log('[DRY RUN] Skipping terminal-notifier installation.');
    return;
  }
  try {
    execSync('brew install terminal-notifier', { stdio: 'inherit' });
    console.log('  ✅ terminal-notifier installed');
  } catch (e) {
    console.log(`  ⚠️  terminal-notifier auto-install failed (falling back to osascript): ${e.message}`);
  }
}

module.exports = { installNotifier };
