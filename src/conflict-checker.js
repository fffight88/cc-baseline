'use strict';

const HARNESS_STATUS_MESSAGES = [
  '세션 기본 규칙 로딩 중...',
  'E2E 테스트 가이드 로딩 중...',
];

function isHarnessHook(hook) {
  return Boolean(hook.statusMessage && HARNESS_STATUS_MESSAGES.includes(hook.statusMessage));
}

function checkConflicts(existingHooks) {
  const warnings = [];

  // Rule 1: SessionStart에 하네스 이외의 훅 존재
  const sessionStarts = existingHooks?.SessionStart ?? [];
  for (const entry of sessionStarts) {
    for (const hook of (entry.hooks ?? [])) {
      if (!isHarnessHook(hook)) {
        warnings.push({
          severity: 'WARN',
          rule: 1,
          event: 'SessionStart',
          message: 'SessionStart 이벤트에 기존 훅이 있습니다.',
          reason:
            'cc-baseline도 SessionStart에서 메모리 컨텍스트를 주입합니다. ' +
            '기존 훅과 동시에 실행되므로 상충되는 지시가 있으면 Claude 동작이 예상과 달라질 수 있습니다.',
          action:
            '설치 후 ~/.claude/settings.json의 SessionStart hooks를 검토하고 필요 시 통합하세요.',
        });
        break;
      }
    }
  }

  // Rule 2: PreToolUse 매처가 playwright-test와 겹치거나 .* 포괄
  const preToolUses = existingHooks?.PreToolUse ?? [];
  for (const entry of preToolUses) {
    const matcher = entry.matcher ?? '';
    const isHarness = (entry.hooks ?? []).some(isHarnessHook);
    if (!isHarness && (matcher === '.*' || matcher.includes('playwright-test'))) {
      warnings.push({
        severity: 'WARN',
        rule: 2,
        event: 'PreToolUse',
        matcher,
        message: `PreToolUse matcher "${matcher}"가 playwright-test MCP와 겹칩니다.`,
        reason:
          'E2E 가이드 주입 훅과 이중 실행되거나, playwright MCP 호출 자체가 차단될 수 있습니다.',
        action: '해당 훅의 matcher를 구체화하거나 cc-baseline 훅과 통합하세요.',
      });
    }
  }

  // Rule 3: decision:block/deny 정적 감지 (SessionStart, PreToolUse)
  const criticalEvents = [
    ...(existingHooks?.SessionStart ?? []),
    ...(existingHooks?.PreToolUse ?? []),
  ];
  for (const entry of criticalEvents) {
    for (const hook of (entry.hooks ?? [])) {
      if (isHarnessHook(hook)) continue;
      const cmd = typeof hook.command === 'string' ? hook.command : '';
      if (
        cmd.includes('"decision":"block"') ||
        cmd.includes('"decision":"deny"') ||
        cmd.includes("'decision':'block'") ||
        cmd.includes("'decision':'deny'")
      ) {
        warnings.push({
          severity: 'HIGH',
          rule: 3,
          event: entry.matcher ? 'PreToolUse' : 'SessionStart',
          message: '세션 또는 도구를 차단하는 훅이 감지됩니다.',
          reason:
            '이 훅이 실행되면 cc-baseline 부트업 또는 MCP 호출 자체가 막힐 수 있습니다.',
          action:
            '해당 훅을 제거하거나 cc-baseline 설치 전 수동으로 검토하세요.',
        });
      }
    }
  }

  // Rule 4: SessionEnd 기존 훅 (정보성)
  const sessionEnds = existingHooks?.SessionEnd ?? [];
  for (const entry of sessionEnds) {
    for (const hook of (entry.hooks ?? [])) {
      if (!isHarnessHook(hook)) {
        warnings.push({
          severity: 'INFO',
          rule: 4,
          event: 'SessionEnd',
          message: 'SessionEnd에 기존 훅이 있습니다.',
          reason:
            'cc-baseline의 SessionEnd 훅(고아 claude 프로세스 정리)과 함께 실행됩니다. 충돌 위험은 낮습니다.',
          action: '특별한 조치 없음. 두 훅이 함께 실행됩니다.',
        });
        break;
      }
    }
  }

  return warnings;
}

module.exports = { checkConflicts, isHarnessHook };
