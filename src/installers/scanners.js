'use strict';

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createHash } = require('crypto');
const { HOME } = require('../paths');
const { checkCmd } = require('./_util');

const SCANNERS = ['semgrep', 'gitleaks', 'trivy'];

async function installScanners(dryRun) {
  const missing = SCANNERS.filter(s => !checkCmd(s));
  if (missing.length === 0) {
    console.log('\n🔍 Security scanners: semgrep/gitleaks/trivy all installed');
    return;
  }
  console.log(`\n🔍 Installing security scanners: ${missing.join(', ')}`);
  if (dryRun) {
    console.log('[DRY RUN] Skipping scanner installation.');
    return;
  }
  if (process.platform === 'darwin') {
    installScannersMac(missing);
  } else {
    installScannersLinux(missing);
  }
}

function installScannersMac(missing) {
  try {
    execSync(`brew install ${missing.join(' ')}`, { stdio: 'inherit' });
    console.log('  ✅ Scanner installation complete');
  } catch (e) {
    console.log(`  ⚠️  brew install failed: ${e.message}`);
    console.log(`     Manual: brew install ${missing.join(' ')}`);
  }
}

function installScannersLinux(missing) {
  const localBin = path.join(HOME, '.local', 'bin');
  fs.mkdirSync(localBin, { recursive: true });

  const failures = [];
  for (const s of missing) {
    try {
      if (s === 'semgrep') installSemgrepLinux(localBin);
      else if (s === 'gitleaks') installGitleaksLinux(localBin);
      else if (s === 'trivy') installTrivyLinux(localBin);
      console.log(`  ✅ ${s} installed`);
    } catch (e) {
      const errMsg = (e && e.message) ? e.message.split('\n')[0] : String(e);
      console.log(`  ⚠️  ${s} install failed: ${errMsg}`);
      failures.push(s);
    }
  }

  warnPathIfMissing(localBin);
  if (failures.length > 0) printManualScannerCommands(failures, localBin);
}

function installSemgrepLinux(localBin) {
  if (!checkCmd('python3')) {
    throw new Error('python3 not installed (run: sudo apt install python3 python3-venv)');
  }
  if (checkCmd('pipx')) {
    execSync('pipx install semgrep', { stdio: 'inherit' });
    return;
  }
  // isolated venv install — bypasses PEP 668 on Ubuntu 24.04, no sudo required
  const venvDir = path.join(HOME, '.local', 'share', 'cc-baseline', 'semgrep-venv');
  fs.mkdirSync(path.dirname(venvDir), { recursive: true });
  spawnSync('python3', ['-m', 'venv', venvDir], { stdio: 'inherit' });
  spawnSync(`${venvDir}/bin/pip`, ['install', '--quiet', '--upgrade', 'pip'], { stdio: 'inherit' });
  spawnSync(`${venvDir}/bin/pip`, ['install', '--quiet', 'semgrep'], { stdio: 'inherit' });
  const target = path.join(localBin, 'semgrep');
  try {
    fs.unlinkSync(target);
  } catch (unlinkErr) {
    if (unlinkErr.code !== 'ENOENT') {
      throw new Error(`failed to replace semgrep symlink (cannot remove existing file): ${unlinkErr.message}`);
    }
  }
  fs.symlinkSync(path.join(venvDir, 'bin', 'semgrep'), target);
}

function installGitleaksLinux(localBin) {
  const ARCH_MAP = { arm64: 'arm64', x64: 'x64' };
  const arch = ARCH_MAP[process.arch];
  if (!arch) throw new Error(`gitleaks: unsupported architecture ${process.arch} (supported: arm64, x64)`);
  const apiUrl = 'https://api.github.com/repos/gitleaks/gitleaks/releases/latest';
  const tagJson = execSync(`curl -sSfL "${apiUrl}"`, { encoding: 'utf8' });
  let parsed;
  try { parsed = JSON.parse(tagJson); } catch {
    throw new Error('Failed to parse GitHub API response (possible rate limit or network error)');
  }
  const tag = parsed.tag_name;
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) {
    throw new Error(`Failed to parse latest gitleaks tag: ${tag}`);
  }
  const ver = tag.slice(1);
  const tarName = `gitleaks_${ver}_linux_${arch}.tar.gz`;
  const url = `https://github.com/gitleaks/gitleaks/releases/download/${tag}/${tarName}`;
  const checksumUrl = `https://github.com/gitleaks/gitleaks/releases/download/${tag}/checksums.txt`;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitleaks-'));
  try {
    const tmpFile = path.join(tmpDir, 'gitleaks.tar.gz');
    const tmpChecksums = path.join(tmpDir, 'checksums.txt');
    execSync(`curl -sSfL "${checksumUrl}" -o "${tmpChecksums}"`, { stdio: 'inherit' });
    execSync(`curl -sSfL "${url}" -o "${tmpFile}"`, { stdio: 'inherit' });
    const checksumLine = fs.readFileSync(tmpChecksums, 'utf8')
      .split('\n').find(l => l.includes(tarName));
    if (!checksumLine) throw new Error('Entry not found in checksums.txt for this file');
    const expected = checksumLine.split(/\s+/)[0];
    const actual = createHash('sha256').update(fs.readFileSync(tmpFile)).digest('hex');
    if (actual !== expected) throw new Error(`Checksum mismatch: expected=${expected} actual=${actual}`);
    execSync(`tar -xzf "${tmpFile}" -C "${localBin}" gitleaks`, { stdio: 'inherit' });
    fs.chmodSync(path.join(localBin, 'gitleaks'), 0o755);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function installTrivyLinux(localBin) {
  const ARCH_MAP = { arm64: 'ARM64', x64: '64bit' };
  const archSuffix = ARCH_MAP[process.arch];
  if (!archSuffix) throw new Error(`trivy: unsupported architecture ${process.arch} (supported: arm64, x64)`);
  const apiUrl = 'https://api.github.com/repos/aquasecurity/trivy/releases/latest';
  const tagJson = execSync(`curl -sSfL "${apiUrl}"`, { encoding: 'utf8' });
  let parsed;
  try { parsed = JSON.parse(tagJson); } catch {
    throw new Error('Failed to parse GitHub API response (possible rate limit or network error)');
  }
  const tag = parsed.tag_name;
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) {
    throw new Error(`Failed to parse latest trivy tag: ${tag}`);
  }
  const ver = tag.slice(1);
  const tarName = `trivy_${ver}_Linux-${archSuffix}.tar.gz`;
  const url = `https://github.com/aquasecurity/trivy/releases/download/${tag}/${tarName}`;
  const checksumUrl = `https://github.com/aquasecurity/trivy/releases/download/${tag}/trivy_${ver}_checksums.txt`;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trivy-'));
  try {
    const tmpFile = path.join(tmpDir, 'trivy.tar.gz');
    const tmpChecksums = path.join(tmpDir, 'checksums.txt');
    execSync(`curl -sSfL "${checksumUrl}" -o "${tmpChecksums}"`, { stdio: 'inherit' });
    execSync(`curl -sSfL "${url}" -o "${tmpFile}"`, { stdio: 'inherit' });
    const checksumLine = fs.readFileSync(tmpChecksums, 'utf8')
      .split('\n').find(l => l.includes(tarName));
    if (!checksumLine) throw new Error('Entry not found in checksums.txt for this file');
    const expected = checksumLine.split(/\s+/)[0];
    const actual = createHash('sha256').update(fs.readFileSync(tmpFile)).digest('hex');
    if (actual !== expected) throw new Error(`Checksum mismatch: expected=${expected} actual=${actual}`);
    execSync(`tar -xzf "${tmpFile}" -C "${localBin}" trivy`, { stdio: 'inherit' });
    fs.chmodSync(path.join(localBin, 'trivy'), 0o755);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function warnPathIfMissing(localBin) {
  const pathEntries = (process.env.PATH || '').split(path.delimiter);
  if (!pathEntries.includes(localBin)) {
    console.log(`\n  ℹ️  PATH check: ${localBin} is not in PATH.`);
    console.log(`     Add to your shell rc: export PATH="$HOME/.local/bin:$PATH"`);
  }
}

function printManualScannerCommands(failures, localBin) {
  console.log('\n  ⚠️  Manual install commands for failed scanners:');
  for (const s of failures) {
    if (s === 'semgrep') {
      console.log('     - semgrep: sudo apt install -y python3-venv pipx && pipx install semgrep');
    } else if (s === 'gitleaks') {
      console.log(`     - gitleaks: download linux binary from GitHub Releases → ${localBin}/`);
      console.log('               https://github.com/gitleaks/gitleaks/releases/latest');
    } else if (s === 'trivy') {
      console.log(`     - trivy: download linux binary from GitHub Releases → ${localBin}/`);
      console.log('               https://github.com/aquasecurity/trivy/releases/latest');
    }
  }
}

module.exports = { installScanners, SCANNERS };
