'use strict';

// Aside is the primary browser tool for the harness (Playwright MCP is the fallback).
// It has three parts:
//   1. Aside.app        — the browser (Homebrew cask `aside`)
//   2. background daemon — bundled inside Aside.app; copied to
//                          ~/Library/Application Support/Aside/AsideDaemon and started
//                          the first time the app is opened
//   3. `aside` CLI      — ~/.aside/cli/Aside CLI.app + ~/.local/bin/aside symlink.
//                          Same layout as https://releases.aside.com/install.sh, but we
//                          verify the code signature before putting it in place.

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  ASIDE_BIN, ASIDE_CLI_DIR, ASIDE_APP_PATHS, ASIDE_DAEMON_DIR,
} = require('../paths');
const { checkCmd } = require('./_util');

const ASIDE_TEAM_ID = '8CPD4K4TBB';
const CLI_BASE_URL = 'https://releases.aside.com/cli';
const BROWSER_CONFIG_NAME = 'cc-baseline-browser.json';

function cliArchiveName(arch) {
  const platform = arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
  return `AsideCLI-${platform}-latest.zip`;
}

// Reads "TeamIdentifier=XXXX" from `codesign -dv` output (it prints to stderr).
function parseTeamId(codesignOutput) {
  const m = /^TeamIdentifier=(\S+)$/m.exec(codesignOutput || '');
  return m ? m[1] : null;
}

// Keeps whatever the user already set; only fills in what is missing.
function mergeBrowserConfig(existing, account) {
  const base = existing && typeof existing === 'object' ? existing : {};
  const aside = base.aside && typeof base.aside === 'object' ? base.aside : {};
  return {
    primary: base.primary || 'aside',
    fallback: base.fallback || 'playwright',
    aside: { ...aside, account: account || aside.account || null },
  };
}

function isValidAccountId(id) {
  return /^u\d+$/.test(id || '');
}

function findAsideApp() {
  return ASIDE_APP_PATHS.find(p => fs.existsSync(p)) || null;
}

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', ...opts });
}

function verifyAsideSignature(appPath) {
  const verify = run('codesign', ['--verify', '--deep', '--strict', appPath]);
  if (verify.status !== 0) return `signature check failed: ${(verify.stderr || '').trim()}`;
  const team = parseTeamId(run('codesign', ['-dv', appPath]).stderr);
  if (team !== ASIDE_TEAM_ID) return `unexpected signer team ${team || '(none)'} (expected ${ASIDE_TEAM_ID})`;
  return null;
}

function installApp() {
  if (findAsideApp()) {
    console.log('  ✅ Aside.app detected');
    return true;
  }
  if (!checkCmd('brew')) {
    console.log('  ⚠️  Homebrew not found. Install Aside from https://aside.com, then re-run `cc-baseline --yes`.');
    return false;
  }
  const res = run('brew', ['install', '--cask', 'aside'], { stdio: 'inherit' });
  if (res.status !== 0 || !findAsideApp()) {
    console.log('  ⚠️  `brew install --cask aside` failed. Manual: brew install --cask aside');
    return false;
  }
  console.log('  ✅ Aside.app installed');
  return true;
}

// The daemon ships inside Aside.app and is set up on the app's first launch.
function startDaemon() {
  if (fs.existsSync(ASIDE_DAEMON_DIR)) {
    console.log('  ✅ Aside background daemon detected');
    return;
  }
  run('open', ['-a', 'Aside']);
  console.log('  ℹ️  Opened Aside once to set up its background daemon — finish the first-run screens in the app.');
}

function installCli() {
  if (fs.existsSync(ASIDE_BIN)) {
    console.log('  ✅ aside CLI detected');
    return true;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccb-aside-'));
  try {
    const archive = path.join(tmp, cliArchiveName(os.arch()));
    const dl = run('curl', ['-fsSL', '--max-time', '300', '-o', archive, `${CLI_BASE_URL}/${path.basename(archive)}`]);
    if (dl.status !== 0) throw new Error(`download failed: ${(dl.stderr || '').trim()}`);
    const unzip = run('ditto', ['-x', '-k', archive, tmp]);
    if (unzip.status !== 0) throw new Error(`unzip failed: ${(unzip.stderr || '').trim()}`);
    const staged = path.join(tmp, 'Aside CLI.app');
    if (!fs.existsSync(path.join(staged, 'Contents', 'MacOS', 'aside'))) {
      throw new Error('archive did not contain Aside CLI.app');
    }
    const badSignature = verifyAsideSignature(staged);
    if (badSignature) throw new Error(badSignature);

    const appDir = path.join(ASIDE_CLI_DIR, 'Aside CLI.app');
    fs.mkdirSync(ASIDE_CLI_DIR, { recursive: true });
    fs.mkdirSync(path.dirname(ASIDE_BIN), { recursive: true });
    fs.rmSync(appDir, { recursive: true, force: true });
    try {
      fs.renameSync(staged, appDir);
    } catch (e) {
      if (e.code !== 'EXDEV') throw e;
      // temp dir on another volume: ditto keeps the bundle's symlinks and signature intact
      const copy = run('ditto', [staged, appDir]);
      if (copy.status !== 0) throw new Error(`copy failed: ${(copy.stderr || '').trim()}`);
    }
    fs.rmSync(ASIDE_BIN, { force: true });
    fs.symlinkSync(path.join(appDir, 'Contents', 'MacOS', 'aside'), ASIDE_BIN);

    const version = run(ASIDE_BIN, ['--version']);
    console.log(`  ✅ aside CLI installed (${(version.stdout || '').trim() || 'version unknown'})`);
    const binDir = path.dirname(ASIDE_BIN);
    if (!(process.env.PATH || '').split(':').includes(binDir)) {
      console.log(`  ℹ️  PATH check: add ${binDir} to your shell rc`);
    }
    return true;
  } catch (e) {
    console.log(`  ⚠️  aside CLI install failed: ${e.message}`);
    console.log('     Manual: Aside → Settings → Developers → Install CLI');
    return false;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function writeBrowserConfig(claudeDir, account) {
  const file = path.join(claudeDir, BROWSER_CONFIG_NAME);
  let existing = null;
  if (fs.existsSync(file)) {
    try {
      existing = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      // keep the user's unreadable file instead of silently replacing it
      const backup = `${file}.bak-${Date.now()}`;
      fs.copyFileSync(file, backup);
      console.log(`  ⚠️  ${BROWSER_CONFIG_NAME} could not be parsed — backed up to ${backup}`);
    }
  }
  const merged = mergeBrowserConfig(existing, account);
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(merged, null, 2) + '\n');
  return merged;
}

async function installAside(dryRun, { claudeDir, account } = {}) {
  if (process.platform !== 'darwin') {
    console.log('\n🧭 Aside: macOS only — skipping (browser work uses Playwright MCP)');
    return;
  }
  if (account && !isValidAccountId(account)) {
    console.log(`\n⚠️  Aside: --aside-account must look like u2 (got "${account}"), ignoring it`);
    account = null;
  }
  console.log('\n🧭 Setting up Aside (primary browser tool; Playwright MCP is the fallback)');
  if (dryRun) {
    console.log('[DRY RUN] Skipping Aside app / daemon / CLI installation and browser config.');
    return;
  }
  if (installApp()) startDaemon();
  installCli();
  const config = writeBrowserConfig(claudeDir, account);
  if (!config.aside.account) {
    console.log('  ℹ️  No Aside test account set. In Aside, create a profile only for automated tests,');
    console.log('     find its id with `aside account list` (e.g. u2), then run `cc-baseline --yes --aside-account u2`.');
  } else {
    console.log(`  ✅ Browser config: Aside account ${config.aside.account} (${path.join(claudeDir, BROWSER_CONFIG_NAME)})`);
  }
}

module.exports = {
  installAside,
  cliArchiveName,
  parseTeamId,
  mergeBrowserConfig,
  isValidAccountId,
  verifyAsideSignature,
  writeBrowserConfig,
  ASIDE_TEAM_ID,
  BROWSER_CONFIG_NAME,
};
