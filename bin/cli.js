#!/usr/bin/env node

'use strict';

const { install } = require('../src/install');

const args = process.argv.slice(2);
const opts = {
  yes: args.includes('--yes') || args.includes('-y'),
  dryRun: args.includes('--dry-run'),
  help: args.includes('--help') || args.includes('-h'),
};

if (opts.help) {
  console.log(`
cc-baseline — Claude Code 하네스 인스톨러

사용법:
  cc-baseline [옵션]

옵션:
  --dry-run    변경 없이 설치 예정 항목만 출력
  --yes, -y    충돌 경고 자동 승인 (비대화형 모드)
  --help, -h   이 도움말 출력

예시:
  npx github:<계정>/cc-baseline
  npx github:<계정>/cc-baseline --dry-run
  npx github:<계정>/cc-baseline --yes
`);
  process.exit(0);
}

install(opts).catch(err => {
  console.error('\n❌ 설치 실패:', err.message);
  process.exit(1);
});
