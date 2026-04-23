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
cc-baseline — Claude Code 하네스 인스톨러

사용법:
  cc-baseline [옵션]

설치 옵션:
  --dry-run             변경 없이 설치 예정 항목만 출력
  --yes, -y             충돌 경고 자동 승인 (비대화형 모드)
  --help, -h            이 도움말 출력

제거 옵션:
  --uninstall           설치된 cc-baseline 항목 제거
  --purge               --uninstall과 함께: 백업 디렉토리까지 제거
  --remove-scanners     --uninstall과 함께: 외부 스캐너(semgrep/gitleaks/trivy) 제거

설치 예시:
  npx github:fffight88/cc-baseline
  npx github:fffight88/cc-baseline --dry-run
  npx github:fffight88/cc-baseline --yes

제거 예시:
  npx github:fffight88/cc-baseline --uninstall --dry-run
  npx github:fffight88/cc-baseline --uninstall --yes
  npx github:fffight88/cc-baseline --uninstall --yes --purge --remove-scanners
`);
  process.exit(0);
}

if (opts.uninstall) {
  const { uninstall } = require('../src/uninstall');
  uninstall(opts).catch(err => {
    console.error('\n❌ 제거 실패:', err.message);
    process.exit(1);
  });
} else {
  install(opts).catch(err => {
    console.error('\n❌ 설치 실패:', err.message);
    process.exit(1);
  });
}
