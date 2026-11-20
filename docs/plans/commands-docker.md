# 명령 실행기 허용 확장 + 공개 Docker 포트 경고 (commands-docker)

## ⚡ Key Rules Summary

| ✅ DO | ❌ DON'T |
|---|---|
| 실행기는 `node`, `bash`, `sh`, `python3` 이름만 받는다(PATH에서 찾음) | `.venv/bin/python`처럼 커밋되지 않은 실행기 경로 받기 |
| 나머지 규칙(커밋된 스크립트, 셸 없는 실행, 평범한 인자)은 그대로 둔다 | 셸로 실행하거나 인자 규칙 완화 |
| Docker 포트 점검은 읽기만 하고 warn으로 둔다 | 컨테이너를 바꾸거나 fail로 실행을 막기 |
| 지침에 "테스트 리셋 ≠ 개발 리셋"을 적는다 | 볼륨을 지우는 개발용 리셋을 `reset_command`로 쓰기 |

## Meta
- Security Impact: Yes
- Code Quality Impact: Yes
- UI Impact: No
- Behavior Impact: Yes
- Reason: run 파일 명령이 bash, sh, python3 실행기로도 돈다(`reset_command`, `data.*_command`, 재생 `command`). `test-env-check.js`가 `docker ps`를 읽는다.

## Context

- **배경:** ontology-demo(일반화 검증)에서 나온 남은 2건이다.
  - **실행기 제한:** 명령이 `node <스크립트>`만 허용된다. 그래서 bash 리셋을 쓰려면 node 래퍼가 필요했다(`scripts/test-reset.mjs`).
  - **공개 포트:** 이 공개 서버에서 compose의 Postgres가 `0.0.0.0:5433`(알려진 비밀번호)으로 열렸다. 로컬 override로 `127.0.0.1`에 묶었지만, 이를 알려주는 지침이나 점검이 없다.
- **사용자 결정 (2026-11-20):** 실행기 허용 목록 확장, 그리고 지침 + 점검 경고.
- **고칠 곳:**
  - `templates/scripts/tc-api-run.js` `checkCommand`(공용): `reset_command`, `data.*_command`, 재생 `command`, `test-env-check`가 이 함수를 쓴다.
  - `templates/scripts/tc-replay.js` `runCommand`(`execFile(process.execPath, …)`) → 실행기별로 실행
  - `templates/scripts/test-env-check.js`: 새 `docker_ports` 검사
  - 문서: `reference_e2e_manager_guide.md`(103–104행, 207행), `e2e-tester.md`(command), `reference_test_env.md` §4, 새 절

## 변경

### 1. 명령 실행기 (`checkCommand`, `runCommand`)

- 첫 단어는 `node`, `bash`, `sh`, `python3` 중 하나여야 한다. 반환값은 `{ interpreter, script, args }`다.
- 스크립트, 인자, 커밋 여부 규칙은 그대로다.
- `runCommand`:
  - `node`면 지금처럼 `process.execPath`로 실행한다.
  - 나머지는 실행기 이름으로 `execFile`한다(셸 없음, cwd는 프로젝트 루트, 60초 제한).
- 오류 문구와 주석은 "`<node|bash|sh|python3> <committed project script> <plain args>`"로 바꾼다.

### 2. `test-env-check.js` `docker_ports` (warn만)

- `docker ps --format '{{.Label "com.docker.compose.project.working_dir"}}\t{{.Names}}\t{{.Ports}}'`를 읽는다(execFile, 5초).
- 작업 폴더가 프로젝트 루트(realpath) 안인 컨테이너 중 `0.0.0.0:`이나 `[::]:`로 포트를 연 것이 있으면 warn을 낸다. 이유: Docker는 방화벽을 우회하므로 `127.0.0.1`로 묶어야 하고, 커밋하지 않는 override를 쓰라는 안내다.
- docker가 없거나 실패하면 검사 항목을 내지 않는다. 대상 컨테이너가 없으면 ok다.
- 테스트할 수 있도록 파서를 분리한다(`dockerExposure(root, psText)`).

### 3. 지침

- **`reference_test_env.md`:**
  - §4 reset 스크립트에 실행기 목록을 추가한다.
  - "테스트 리셋은 테스트 데이터만, 빠르게. 볼륨을 지우는 개발용 리셋을 쓰지 않는다. 필요하면 별도 테스트 DB를 쓴다(ontology-demo 사례)"를 추가한다.
  - 새 절 "Local ports on a shared or public machine": DB와 인프라는 `127.0.0.1:` 바인딩, 커밋하지 않는 `docker-compose.override.yml`(`ports: !override`, `.git/info/exclude`), 개발 서버는 `--host 127.0.0.1`. 체크리스트에도 한 줄 넣는다.
- **manager guide와 e2e-tester:** 명령 형식 문구를 실행기 목록으로 바꾼다.
- **CHANGELOG:** 지난번 "node 전용 한계" 기록을 고쳤다고 적는다.

### 4. 테스트 — `test/run.js`

- 기존 test-env-check 테스트에 추가한다.
  - `bash scripts/reset.sh`(커밋됨)는 ok다.
  - `.venv/bin/python scripts/x.py`와 `ruby scripts/x.rb`는 fail이다.
  - `dockerExposure` 파서 단위 검사: 프로젝트 안 `0.0.0.0` 포트는 warn, `127.0.0.1` 포트는 ok, 프로젝트 밖은 무시.
- 재생 명령 테스트에 bash 스크립트로 표식 파일을 쓰는 `command` op를 추가한다.

## Test Cases (draft)

| TC ID | 제목 | surface | readiness | 기대 결과 수 |
|---|---|---|---|---|
| TC.test-env.reset-command-bash | 커밋된 bash 리셋은 통과 | cli | ready | 1 |
| TC.test-env.reset-command-interpreter-path | 경로를 붙인 실행기는 fail | cli | ready | 1 |
| TC.test-env.docker-public-port-warns | 프로젝트 컨테이너의 공개 포트는 warn | cli | ready | 1 |
| TC.tc-replay.command-bash-runs | 재생 `command`가 bash 스크립트를 실행 | cli | ready | 1 |

**검사 결과:**
- tc-lint: 4 TC, 경고 0개
- tc-jev-check: 4개 채점, 경고 0개
- 열린 질문: 없음

```json
{
  "test-env": {
    "sources_add": [{ "id": "DEC.commands-docker", "kind": "decision", "locator": "user decision 2026-11-20: run-file commands accept node, bash, sh, python3; test-env-check warns on project containers publishing on 0.0.0.0" }],
    "test_cases_add": [
      { "id": "TC.test-env.reset-command-bash", "title": "A committed bash reset script passes the check", "action_refs": ["ACT.test-env.check"], "level": "functional", "surface": "cli",
        "preconditions": ["a run file whose reset_command is bash scripts/reset.sh", "scripts/reset.sh committed to git"],
        "steps": [{ "goal": "Run test-env-check.js on that run file", "done_when": { "expect": "The command exits" } }],
        "expected": [{ "text": "The reset_command check has status ok", "observe": { "channel": "artifact", "key": "stdout JSON .checks[name=reset_command].status" } }],
        "basis": { "kind": "requirement", "refs": ["DEC.commands-docker"] }, "readiness": "ready" },
      { "id": "TC.test-env.reset-command-interpreter-path", "title": "An interpreter given as a path fails the check", "action_refs": ["ACT.test-env.check"], "level": "functional", "surface": "cli",
        "preconditions": ["a run file whose reset_command starts with .venv/bin/python"],
        "steps": [{ "goal": "Run test-env-check.js on that run file", "done_when": { "expect": "The command exits" } }],
        "expected": [{ "text": "The reset_command check has status fail", "observe": { "channel": "artifact", "key": "stdout JSON .checks[name=reset_command].status" } }],
        "basis": { "kind": "requirement", "refs": ["DEC.commands-docker"] }, "readiness": "ready" },
      { "id": "TC.test-env.docker-public-port-warns", "title": "A project container publishing on all interfaces is warned", "action_refs": ["ACT.test-env.check"], "level": "functional", "surface": "cli",
        "preconditions": ["docker ps output listing a container whose compose working dir is the project and whose port is 0.0.0.0:5433->5432/tcp"],
        "steps": [{ "goal": "Evaluate the docker_ports check on that output", "done_when": { "expect": "A check result comes back" } }],
        "expected": [{ "text": "The docker_ports check has status warn", "observe": { "channel": "artifact", "key": "docker_ports status" } }],
        "basis": { "kind": "requirement", "refs": ["DEC.commands-docker"] }, "readiness": "ready" }
    ]
  },
  "tc-replay": {
    "sources_add": [{ "id": "DEC.commands-docker", "kind": "decision", "locator": "user decision 2026-11-20: run-file commands accept node, bash, sh, python3" }],
    "test_cases_add": [
      { "id": "TC.tc-replay.command-bash-runs", "title": "A command op runs an approved bash script", "action_refs": ["ACT.tc-replay.run"], "level": "functional", "surface": "cli",
        "preconditions": ["an accepted recording whose setup names data.before_command", "the run file gives before_command as bash <committed script> that writes a marker file"],
        "steps": [{ "goal": "Run tc-replay.js run for that TC", "done_when": { "expect": "The command exits" } }],
        "expected": [{ "text": "The marker file written by the bash script exists", "observe": { "channel": "artifact", "key": "marker file in the project" } }],
        "basis": { "kind": "requirement", "refs": ["DEC.commands-docker"] }, "readiness": "ready" }
    ]
  }
}
```

## 실행 순서

1. `Read ~/.claude/memory/phase_start.md and execute`
2. TC를 추가하고 검사한다. 대상 파일의 `git log -3`을 확인한다.
3. 변경 1과 2를 구현하고 테스트를 추가한다. `npm test`는 전부 통과, skip 0이어야 한다.
4. 지침과 CHANGELOG를 고치고 `node bin/cli.js --yes`를 실행한다.
5. security-auditor와 code-reviewer를 병렬로 실행하고 반영한다.
6. **실측:** ontology-demo에서 `test-env-check`를 돌려 `docker_ports`가 ok(127.0.0.1)인지 본다. 임시로 `reset_command`를 `bash`로 바꾼 사본 run 파일에서 형식 검사가 통과하는지도 본다(실행은 하지 않음).
7. 커밋하고 develop에 푸시한다. 인계 문서를 갱신한다.
8. `Read ~/.claude/memory/phase_end.md and execute`

## E2E

- 새 TC 4개(cli, ready)는 `test/run.js`가 실행한다. Docker 검사는 파서 단위로 확인하고, 실제 `docker ps`는 6단계에서 확인한다.

## 위험

- **실행기 확장:** 셸 스크립트가 무엇을 하든 막지 않는다(node 스크립트도 마찬가지). 보호는 계획 승인과 커밋된 파일이라는 조건이다. 보안 감사 대상이다.
- **`docker ps`:** 다른 프로젝트의 컨테이너는 이름만 읽고 무시한다. 출력에는 프로젝트 소속만 남긴다.

## ✅ Checklist

- [ ] TC 4개, 검사
- [ ] `checkCommand` 실행기 목록, `runCommand` 실행기별 실행, `docker_ports` warn
- [ ] 테스트, 지침(테스트 리셋 ≠ 개발 리셋, 127.0.0.1), CHANGELOG, 설치, 감사
- [ ] ontology-demo 실측, 커밋, 푸시, 인계 문서

## 실행 기록 (2026-11-20)
- **ontology-demo 실측:** `docker_ports`가 ok였다(override로 127.0.0.1). `bash scripts/reset-db.sh`도 형식 검사를 통과했다(볼륨을 지우는 개발용이라 지침상 `reset_command`로 쓰지 않음).

## Audit History
- iter-1: 2026-11-20 / critical=0 high=0 medium=0 low=2 / next_action=done
  - SEC-001: python3는 `-B`로 실행한다(.pyc를 쓰지 않음). `-I`는 같은 폴더 모듈 import를 깨므로 쓰지 않았다. 커밋되지 않은 형제 모듈을 import할 수 있다는 한계는 남는다.
  - SEC-002: 실행 전에 `BASH_ENV`, `ENV`, `PYTHON*`, `NODE_OPTIONS`, `NODE_PATH`, `LD_PRELOAD` 등을 환경에서 뺀다. 실행기는 PATH에서 찾는다(nvm, pyenv 환경 호환).

## Code Review History
- code-review-iter-1: 2026-11-20 / critical=0 high=0 medium=1 low=2 / profile_status=cached / next_action=self_fix → 반영
  - QA-001: `e2e-tester.md`의 `*_command` 형식 문구를 실행기 목록으로 고쳤다.
  - QA-002: `docker_ports`가 포트 범위(`0.0.0.0:21000-21010->…`)도 잡는다.
  - QA-003: `sh`와 `python3` 형식 통과 테스트를 추가했다.
