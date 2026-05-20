#!/usr/bin/env node

'use strict';

const args = process.argv.slice(2);
const opts = {
  yes: args.includes('--yes') || args.includes('-y'),
  dryRun: args.includes('--dry-run'),
  help: args.includes('--help') || args.includes('-h'),
  version: args.includes('--version') || args.includes('-v'),
  uninstall: args.includes('--uninstall'),
  doctor: args.includes('--doctor'),
  purge: args.includes('--purge'),
  removeScanners: args.includes('--remove-scanners'),
  skipScanners: args.includes('--skip-scanners'),
};

if (opts.version) {
  const pkg = require('../package.json');
  console.log(pkg.version);
  process.exit(0);
}

if (opts.help) {
  console.log(`
cc-baseline — Claude Code harness installer

Usage:
  cc-baseline [options]

Install options:
  --dry-run             Print planned changes without writing files
  --yes, -y             Auto-approve conflict warnings (non-interactive mode)
  --skip-scanners       Skip auto-install of semgrep/gitleaks/trivy + Playwright MCP
                        (useful in CI or restricted-network environments)
  --version, -v         Print version
  --help, -h            Show this help

Diagnostic options:
  --doctor              Verify installed state (files, hooks, MCP servers, tools)
                        Exit code 0 if all checks pass, 1 otherwise

Uninstall options:
  --uninstall           Remove installed cc-baseline files
  --purge               With --uninstall: also delete backup directory
  --remove-scanners     With --uninstall: uninstall external scanners (semgrep/gitleaks/trivy)

Install examples:
  npx github:fffight88/cc-baseline
  npx github:fffight88/cc-baseline --dry-run
  npx github:fffight88/cc-baseline --yes
  npx github:fffight88/cc-baseline --yes --skip-scanners

Diagnostic examples:
  npx github:fffight88/cc-baseline --doctor

Uninstall examples:
  npx github:fffight88/cc-baseline --uninstall --dry-run
  npx github:fffight88/cc-baseline --uninstall --yes
  npx github:fffight88/cc-baseline --uninstall --yes --purge --remove-scanners
`);
  process.exit(0);
}

if (opts.doctor) {
  const { doctor } = require('../src/doctor');
  try {
    process.exit(doctor());
  } catch (err) {
    console.error('\n❌ Doctor crashed:', err.message);
    process.exit(2);
  }
}

if (opts.uninstall) {
  const { uninstall } = require('../src/uninstall');
  uninstall(opts).catch(err => {
    console.error('\n❌ Uninstall failed:', err.message);
    process.exit(1);
  });
} else {
  const { install } = require('../src/install');
  install(opts).catch(err => {
    console.error('\n❌ Install failed:', err.message);
    process.exit(1);
  });
}
