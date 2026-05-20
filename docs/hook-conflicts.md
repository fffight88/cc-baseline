# Hook Conflict Warning Guide

[← Back to README](../README.md)

The installer checks your existing `~/.claude/settings.json` hooks against four rules:

## `[WARN]` Existing SessionStart hook

cc-baseline also uses SessionStart to inject memory context. Conflicting instructions may produce unexpected behavior. **Action:** review and merge the two SessionStart hooks after installation.

## `[WARN]` PreToolUse matcher overlap

A broad matcher like `".*"` may double-fire with the Playwright E2E guide hook or block MCP calls. **Action:** narrow the matcher or exclude `mcp__playwright-test-.*`.

## `[HIGH]` Blocking hook detected

A hook returning `decision: block` or `decision: deny` may prevent cc-baseline from booting or MCP calls from completing. **Action:** remove or adjust the hook before installing.

## `[INFO]` Existing SessionEnd hook

Low conflict risk — both hooks run together. No action required.
