# ontology-demo Action Log 필터 + cc-baseline Bearer 토큰 세션 (action-log-filter)

## ⚡ Key Rules Summary

| ✅ DO | ❌ DON'T |
|---|---|
| 필터는 항상 테넌트 조건과 함께 건다(count와 목록 모두) | 다른 테넌트의 로그가 필터 결과에 섞이게 하기 |
| `status`는 `SUCCESS`/`FAILURE`만 받고 나머지는 422로 돌려준다 | 잘못된 값을 조용히 무시하기 |
| 필터는 URL에 남기고, 바꾸면 1페이지로 돌아간다 | 필터를 바꿨는데 빈 페이지 번호가 남기 |
| 토큰은 세션 파일(0600)에만 두고 출력에서 가린다 | 토큰을 화면, 로그, 결과 파일에 남기기 |
| 테스트는 이 서버의 로컬 DB(127.0.0.1)로만 한다 | ontology-demo를 외부에 열기 |

## Meta
- Security Impact: Yes
- Code Quality Impact: Yes
- UI Impact: Yes
- Behavior Impact: Yes
- Reason: ontology-demo의 `/actions/log` 필터(테넌트 격리)와 Action Log 화면이 바뀐다. cc-baseline `tc-api-run.js`가 Bearer 토큰을 저장하고 전송한다.

## Context

- **목적:** cc-baseline 일반화 검증이다. grimbang(Next.js + Supabase)과 성격이 다른 ontology-demo에 새 기능 흐름을 끝까지 돌린다.
  - 백엔드: FastAPI + strawberry, Postgres(Docker), pytest
  - 프론트: React + Vite SPA, JWT를 localStorage에 둠
- **현재 코드:**
  - `backend/app/routers/actions.py` `list_action_logs(limit, offset)` → `ActionService.list_logs`(`backend/app/services/action_service.py:96`). 테넌트 조건으로 count와 목록을 가져온다.
  - `frontend/src/pages/ActionLog.tsx`: 20개씩 Prev/Next. `frontend/src/api.ts` `actions.listLogs`, `ontology.listActionTypes`
  - 로그인: 테넌트 카드 클릭(`admin@{slug}.demo` / `demo1234`) → `POST /auth/login` → `{ token }` → `Authorization: Bearer`
- **시드:** 마이그레이션 015.
  - skyline: 4건, 모두 SUCCESS(book_flight 2, cancel_booking 1, link_patient_to_flight 1)
  - medcore: 3건(admit_patient FAILURE 1, schedule_appointment SUCCESS 2)
- **환경(사용자 승인 후 준비 완료):**
  - uv Python 3.12 venv, npm install
  - Postgres 컨테이너는 로컬 override로 127.0.0.1에만 열었다. MinIO는 `minio/mc` 이미지를 받을 수 없어서 쓰지 않는다(기본 저장소는 postgres).
  - 테스트 DB `ontology_test`를 만들었다.
- **기존 pytest:** 통과 82, 실패 40, 오류 12, 수집 오류 2. 원인은 테스트가 없어진 `POST /objects/{type}`과 `app.storage.postgres_backend`를 쓰는 것이다. 이번 범위 밖이고, 결과에 그대로 적는다.
- **cc-baseline 일반화 결함:**
  - `tc-api-run.js`가 쿠키 세션만 지원한다. 그래서 Bearer API는 TC로 확인할 수 없다(사용자 결정: 토큰 세션 추가).
  - `reset_command`가 `node` 스크립트만 허용한다. 그래서 프로젝트의 bash 리셋을 그대로 쓸 수 없고 node 래퍼가 필요하다(이번에는 래퍼로 진행하고, 결과에 기록).
- **사용자 결정 (2026-11-20):** Bearer 토큰 세션을 cc-baseline에 추가한다. 필터는 URL에 유지한다.
- docs/wiki: ontology-demo에는 없다. 화면이 있으니 `/wiki init`을 제안한다(범위 밖).

## 변경 1 — cc-baseline (먼저)

- **`tc-api-run.js`:**
  - run 파일 최상위 `api_token: { login_path, json_path, header?: "Authorization", scheme?: "Bearer" }`를 추가한다.
  - `request`가 `login_path`로 보낸 요청이 2xx이고 JSON의 `json_path`에 문자열이 있으면, 그 값을 세션 파일(0600)에 `__token`으로 저장한다.
  - 같은 세션의 다음 요청에는 `<header>: <scheme> <token>`을 붙인다. 출력에서는 기존 마스킹(Authorization 헤더, JWT 패턴)과 `secrets`에 넣어 가린다.
  - `__token`은 쿠키로 보내지 않는다.
- **`tc-replay.js`의 `request` op:** `api.request`를 쓰므로 그대로 동작한다. 테스트로 확인한다.
- **문서:** manager guide §2-A run add-on에 `api_token`을, e2e-tester의 API 절에 "Bearer API는 `login_path`로 로그인하면 토큰이 세션에 붙는다"를 적는다.
- **CHANGELOG에 기록할 것:** `reset_command`가 node만 받는 한계를 기록한다(이번에 고치지 않음).
- **TC:** `docs/tc/tc-jev-loop.tc.json`에 2개 추가(아래)
- `npm test`, 설치, 감사를 거쳐 커밋한다(ontology-demo 작업 전에).

## 변경 2 — ontology-demo

## Audit History
- iter-1: 2026-11-20 / critical=0 high=0 medium=0 low=2 / next_action=done
  - SEC-001: `Cookie`, `Host`, `Content-*`, `Transfer-Encoding`, `Connection`은 `api_token.header`로 거부한다.
  - SEC-002: 토큰을 쿠키 파일과 분리했다(`<session>.token`). 서버 쿠키 이름이 토큰과 부딪히지 않는다.

## Code Review History
- code-review-iter-1: 2026-11-20 / critical=0 high=0 medium=0 low=4 / profile_status=cached / next_action=done
  - QA-001: SEC-002와 같은 문제로, 함께 반영했다.
  - QA-002: 실패한 재로그인은 예전 토큰을 지운다(테스트 추가).
  - QA-003: TC 파일 원래 형식을 유지했다.
  - QA-004: 거부된 header, 실패한 재로그인, 쿠키 파일에 토큰이 없는지를 테스트에 추가했다.
