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
  project: args.includes('--project'),
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
  --project             Install into the current project (./.claude/ + ./.mcp.json)
                        instead of the global ~/.claude/ home. Use this in a repo
                        you want to share with your team.
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
  npx github:fffight88/cc-baseline --project --dry-run    # preview project install
  npx github:fffight88/cc-baseline --project --yes        # install into ./.claude/

Diagnostic examples:
  npx github:fffight88/cc-baseline --doctor
  npx github:fffight88/cc-baseline --project --doctor

Uninstall examples:
  npx github:fffight88/cc-baseline --uninstall --dry-run
  npx github:fffight88/cc-baseline --uninstall --yes
  npx github:fffight88/cc-baseline --uninstall --yes --purge --remove-scanners
  npx github:fffight88/cc-baseline --project --uninstall  # remove from ./.claude/
`);
  process.exit(0);
}

if (opts.doctor) {
  const { doctor } = require('../src/doctor');
  try {
    process.exit(doctor(opts));
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
