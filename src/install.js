'use strict';

const fs = require('fs');
const path = require('path');

const { HOME, applyHome } = require('./paths');
const { createBackup } = require('./backup');
const { confirm } = require('./prompt');
const { checkConflicts } = require('./conflict-checker');
const { mergeMarkerBlock } = require('./merge/markdown');
const { mergeHooks } = require('./merge/settings-hooks');
const { mergeMcpServers } = require('./merge/mcp-servers');

const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');
const CLAUDE_DIR = path.join(HOME, '.claude');
const BACKUP_ROOT = path.join(CLAUDE_DIR, '.cc-baseline-backup');
const LOG_FILE = path.join(CLAUDE_DIR, '.cc-baseline-install.log');

function appendLog(msg) {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {}
}

function readTemplate(relPath) {
  const raw = fs.readFileSync(path.join(TEMPLATES_DIR, relPath), 'utf8');
  return applyHome(raw);
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeFile(filePath, content, dryRun) {
  if (dryRun) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

async function install(opts = {}) {
  const { dryRun = false, yes: autoYes = false } = opts;

  console.log('\n🔧 cc-baseline — Claude Code 하네스 인스톨러\n');
  if (dryRun) {
    console.log('📋 [DRY RUN] 실제 변경 없이 예정 항목만 출력합니다.\n');
  }

  // ── 1. 기존 settings.json 읽기 → 충돌 검사 ─────────────────────────────
  const settingsPath = path.join(CLAUDE_DIR, 'settings.json');
  const existingSettings = readJson(settingsPath) || {};
  const existingHooks = existingSettings.hooks || {};

  const warnings = checkConflicts(existingHooks);
  if (warnings.length > 0) {
    console.log('⚠️  훅 충돌 감지:\n');
    for (const w of warnings) {
      const icon = w.severity === 'HIGH' ? '🚨' : w.severity === 'WARN' ? '⚠️ ' : 'ℹ️ ';
      console.log(`${icon} [${w.severity}] ${w.message}`);
      console.log(`   이유: ${w.reason}`);
      console.log(`   조치: ${w.action}\n`);
    }
    const proceed = await confirm(
      '위 경고를 확인했습니다. 계속 진행하겠습니까?',
      autoYes
    );
    if (!proceed) {
      console.log('\n설치가 취소되었습니다.');
      return;
    }
    console.log();
  }

  // ── 2. 백업 ──────────────────────────────────────────────────────────────
  const filesToBackup = [
    path.join(CLAUDE_DIR, 'CLAUDE.md'),
    path.join(CLAUDE_DIR, 'memory', 'MEMORY.md'),
    ...[
      'all_session_basic_rules',
      'doc_structure_rules',
      'phase_start',
      'phase_end',
      'reference_e2e_manager_guide',
      'reference_subagent_boundary',
      'reference_doc_writing_style',
      'feedback_skill_description_budget',
    ].map(f => path.join(CLAUDE_DIR, 'memory', `${f}.md`)),
    path.join(CLAUDE_DIR, 'agents', 'e2e-tester.md'),
    path.join(CLAUDE_DIR, 'commands', 'plan.md'),
    path.join(CLAUDE_DIR, 'commands', 'clean.md'),
    settingsPath,
    path.join(HOME, '.claude.json'),
  ];

  if (!dryRun) {
    const { backupDir, backed } = createBackup(filesToBackup, BACKUP_ROOT);
    if (backupDir) {
      console.log(`💾 백업 완료: ${backupDir}\n   (${backed.length}개 파일)\n`);
      appendLog(`BACKUP: ${backupDir}`);
    }
  }

  const changes = [];

  // ── 3. CLAUDE.md — 마커 블록 머지 ───────────────────────────────────────
  const claudeMdPath = path.join(CLAUDE_DIR, 'CLAUDE.md');
  const claudeMdTpl = readTemplate('CLAUDE.md');
  const claudeMdExisting = fs.existsSync(claudeMdPath)
    ? fs.readFileSync(claudeMdPath, 'utf8')
    : '';
  const claudeMdNew = mergeMarkerBlock(claudeMdExisting, claudeMdTpl);
  if (claudeMdNew !== claudeMdExisting) {
    changes.push({ label: 'CLAUDE.md', path: claudeMdPath, content: claudeMdNew });
    console.log(`  ✅ CLAUDE.md — ${claudeMdExisting ? '마커 블록 머지' : '신규 생성'}`);
  } else {
    console.log(`  ⏭️  CLAUDE.md — 변경 없음 (이미 최신)`);
  }

  // ── 4. memory/MEMORY.md — 마커 블록 머지 ────────────────────────────────
  const memMdPath = path.join(CLAUDE_DIR, 'memory', 'MEMORY.md');
  const memMdTpl = readTemplate('memory/MEMORY.md');
  const memMdExisting = fs.existsSync(memMdPath)
    ? fs.readFileSync(memMdPath, 'utf8')
    : '';
  const memMdNew = mergeMarkerBlock(memMdExisting, memMdTpl);
  if (memMdNew !== memMdExisting) {
    changes.push({ label: 'memory/MEMORY.md', path: memMdPath, content: memMdNew });
    console.log(`  ✅ memory/MEMORY.md — ${memMdExisting ? '마커 블록 머지' : '신규 생성'}`);
  } else {
    console.log(`  ⏭️  memory/MEMORY.md — 변경 없음 (이미 최신)`);
  }

  // ── 5. 개별 memory 파일 덮어쓰기 ────────────────────────────────────────
  const memoryFiles = [
    'all_session_basic_rules.md',
    'doc_structure_rules.md',
    'phase_start.md',
    'phase_end.md',
    'reference_e2e_manager_guide.md',
    'reference_subagent_boundary.md',
    'reference_doc_writing_style.md',
    'feedback_skill_description_budget.md',
  ];
  for (const f of memoryFiles) {
    const dest = path.join(CLAUDE_DIR, 'memory', f);
    changes.push({ label: `memory/${f}`, path: dest, content: readTemplate(`memory/${f}`) });
    console.log(`  ✅ memory/${f} — 덮어쓰기`);
  }

  // ── 6. agents/e2e-tester.md ──────────────────────────────────────────────
  const agentPath = path.join(CLAUDE_DIR, 'agents', 'e2e-tester.md');
  changes.push({ label: 'agents/e2e-tester.md', path: agentPath, content: readTemplate('agents/e2e-tester.md') });
  console.log(`  ✅ agents/e2e-tester.md — 덮어쓰기`);

  // ── 7. commands/ ──────────────────────────────────────────────────────────
  for (const f of ['plan.md', 'clean.md']) {
    const dest = path.join(CLAUDE_DIR, 'commands', f);
    changes.push({ label: `commands/${f}`, path: dest, content: readTemplate(`commands/${f}`) });
    console.log(`  ✅ commands/${f} — 덮어쓰기`);
  }

  // ── 8. settings.json hooks 머지 ──────────────────────────────────────────
  const harnessHooks = JSON.parse(readTemplate('settings-hooks.json'));
  const mergedHooks = mergeHooks(existingHooks, harnessHooks);
  const newSettings = Object.assign({}, existingSettings, { hooks: mergedHooks });
  changes.push({
    label: 'settings.json (hooks 머지)',
    path: settingsPath,
    content: JSON.stringify(newSettings, null, 2),
  });
  console.log(`  ✅ settings.json — hooks 머지`);

  // ── 9. ~/.claude.json mcpServers 머지 ────────────────────────────────────
  const claudeJsonPath = path.join(HOME, '.claude.json');
  const existingClaudeJson = readJson(claudeJsonPath) || {};
  const incomingMcp = JSON.parse(readTemplate('mcp-servers.json'));
  const { result: mergedMcp, added, overwritten } = await mergeMcpServers(
    existingClaudeJson.mcpServers || {},
    incomingMcp,
    confirm,
    autoYes
  );
  if (added.length > 0 || overwritten.length > 0) {
    const newClaudeJson = Object.assign({}, existingClaudeJson, { mcpServers: mergedMcp });
    changes.push({
      label: `.claude.json (mcpServers 머지)`,
      path: claudeJsonPath,
      content: JSON.stringify(newClaudeJson, null, 2),
    });
    const summary = [
      added.length ? `추가: [${added.join(', ')}]` : '',
      overwritten.length ? `교체: [${overwritten.join(', ')}]` : '',
    ].filter(Boolean).join(' / ');
    console.log(`  ✅ .claude.json — mcpServers ${summary}`);
  } else {
    console.log(`  ⏭️  .claude.json — 변경 없음`);
  }

  // ── 10. 요약 & 실제 쓰기 ─────────────────────────────────────────────────
  console.log(`\n📊 총 ${changes.length}개 항목 변경 예정\n`);

  if (dryRun) {
    console.log('[DRY RUN] 실제 파일은 변경되지 않았습니다.');
    return;
  }

  for (const change of changes) {
    writeFile(change.path, change.content, false);
    appendLog(`WRITE: ${change.path}`);
  }

  // memory/ 디렉토리를 읽기 전용으로 잠금 (cc-baseline 경로 보호)
  // chmod 555: 새 파일 추가·수정 모두 차단. 수정 시엔 chmod 755 후 작업.
  try {
    fs.chmodSync(path.join(CLAUDE_DIR, 'memory'), 0o555);
    appendLog('CHMOD 555: memory/');
  } catch {}

  // bin/cli.js 실행 권한 보장
  try {
    fs.chmodSync(path.join(__dirname, '..', 'bin', 'cli.js'), 0o755);
  } catch {}

  console.log('✅ cc-baseline 설치 완료!\n');
  console.log(`📝 설치 로그: ${LOG_FILE}`);
  console.log(`💾 백업 위치: ${BACKUP_ROOT}\n`);
  appendLog('INSTALL COMPLETE');
}

module.exports = { install };
