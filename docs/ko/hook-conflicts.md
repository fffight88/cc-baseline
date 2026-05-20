# 훅 충돌 경고 가이드

[← README로 돌아가기](../../README_KO.md)

설치 프로그램이 기존 `~/.claude/settings.json` 훅을 4가지 규칙으로 검사합니다:

## `[WARN]` 기존 SessionStart 훅

cc-baseline도 SessionStart로 메모리 컨텍스트를 주입합니다. 충돌하는 지시사항은 예상치 못한 동작을 유발할 수 있습니다. **조치:** 설치 후 두 SessionStart 훅을 검토하고 병합하세요.

## `[WARN]` PreToolUse matcher 중복

`".*"` 같은 광범위한 matcher는 Playwright E2E 가이드 훅과 이중 실행되거나 MCP 호출을 차단할 수 있습니다. **조치:** matcher를 좁히거나 `mcp__playwright-test-.*`를 제외하세요.

## `[HIGH]` 차단 훅 감지

`decision: block` 또는 `decision: deny`를 반환하는 훅은 cc-baseline 부팅이나 MCP 호출을 방해할 수 있습니다. **조치:** 설치 전에 해당 훅을 제거하거나 수정하세요.

## `[INFO]` 기존 SessionEnd 훅

충돌 위험 낮음 — 두 훅이 함께 실행됩니다. 별도 조치 불필요.
