#!/usr/bin/env node

'use strict';

const { install } = require('../src/install');

const args = process.argv.slice(2);
const opts = {
  yes: args.includes('--yes') || args.includes('-y'),
  dryRun: args.includes('--dry-run'),
  help: args.includes('--help') || args.includes('-h'),
  uninstall: args.includes('--uninstall'),
  purge: args.includes('--purge'),
  removeScanners: args.includes('--remove-scanners'),
};

if (opts.help) {
  console.log(`
cc-baseline — Claude Code harness installer

Usage:
  cc-baseline [options]

Install options:
  --dry-run             Print planned changes without writing files
  --yes, -y             Auto-approve conflict warnings (non-interactive mode)
  --help, -h            Show this help

Uninstall options:
  --uninstall           Remove installed cc-baseline files
  --purge               With --uninstall: also delete backup directory
  --remove-scanners     With --uninstall: uninstall external scanners (semgrep/gitleaks/trivy)

Install examples:
  npx github:fffight88/cc-baseline
  npx github:fffight88/cc-baseline --dry-run
  npx github:fffight88/cc-baseline --yes

Uninstall examples:
  npx github:fffight88/cc-baseline --uninstall --dry-run
  npx github:fffight88/cc-baseline --uninstall --yes
  npx github:fffight88/cc-baseline --uninstall --yes --purge --remove-scanners
`);
  process.exit(0);
}

if (opts.uninstall) {
  const { uninstall } = require('../src/uninstall');
  uninstall(opts).catch(err => {
    console.error('\n❌ Uninstall failed:', err.message);
    process.exit(1);
  });
} else {
  install(opts).catch(err => {
    console.error('\n❌ Install failed:', err.message);
    process.exit(1);
  });
}
