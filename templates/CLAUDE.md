# Global Claude Instructions

## 전역 메모리 로드

아래 상황에서 반드시 `{{HOME}}/.claude/memory/MEMORY.md`를 읽을 것:

- 새 세션 시작 시 (새 터미널에서 claude 실행, `/clear` 명령어)
- 컨텍스트 압축 후 (`/compact` 또는 자동 압축) — 압축으로 메모리 내용이 소실될 수 있으므로 재로드 필요

## 세션 기본 규칙 로드

매 세션 시작 시 (새 세션, `/clear`, `/compact` 직후) 반드시 아래 파일을 읽을 것:

- `{{HOME}}/.claude/memory/all_session_basic_rules.md`

## 문서 작성 시 규칙 로드

문서(CLAUDE.md, memory 파일, plan, 사용자 요청 문서 등) 작성·수정 시 반드시 아래 파일을 읽을 것:

- `{{HOME}}/.claude/memory/doc_structure_rules.md`
