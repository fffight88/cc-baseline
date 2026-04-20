---
name: E2E 테스트 매니저 운용 가이드
description: 매니저(Claude 본체)가 e2e-tester 서브에이전트를 호출·운용할 때 참조 — MCP 서버 관리, 시나리오 작성, 병렬 실행, 결과 취합, 파일 정리
type: reference
---

## 요약

매니저는 E2E 테스트 전체를 총괄한다. 시나리오 설계, 서브에이전트 호출, 결과 취합, 파일 정리까지 모두 매니저 책임이다. 테스터 에이전트(`e2e-tester`)는 주어진 시나리오를 실행하고 결과만 보고한다.

---

## 1. MCP 서버

- `playwright-test-1` ~ `playwright-test-5` 최대 5개 사용 가능
- 병렬 테스트 시 서브에이전트 수만큼 1:1 배정

---

## 2. 시나리오 작성 원칙

- 매니저가 직접 시나리오를 작성하여 테스터에게 전달
- 테스터는 시나리오를 임의로 변경하지 않음
- 전달 형식:

```
mcp_server: playwright-test-{N}
base_url: <테스트 대상 URL>
scenario:
  name: <시나리오 이름>
  steps:
    - <스텝 1>
    - <스텝 2>
    ...
screenshot_mode: on_failure_only | always | on_request
```

---

## 3. 병렬 실행 방법

- 에이전트 정의 파일은 1개(`e2e-tester`), 인스턴스를 N개 병렬 호출
- 단일 메시지에서 Agent 도구를 여러 번 동시 호출하여 병렬 처리
- 각 인스턴스에 서로 다른 `mcp_server` 번호 할당

```
Agent(e2e-tester, { mcp_server: playwright-test-1, scenario: 로그인 })
Agent(e2e-tester, { mcp_server: playwright-test-2, scenario: 결제 })
Agent(e2e-tester, { mcp_server: playwright-test-3, scenario: 회원가입 })
```

---

## 4. 실패 처리 흐름

1. 테스터가 실패 보고 → 매니저가 원인 분석
2. 매니저 판단에 따라: 재시도 / 스텝 스킵 / 전체 중단 중 하나를 테스터에게 지시
3. 재시도 지시 시 동일 시나리오 재전달 또는 수정된 시나리오 전달

---

## 5. 스크린샷 정책

- 테스터는 아래 경우에 자동 캡처:
  - 테스트 실패 시
  - 예상치 못한 오류 발생 시
  - `screenshot_mode: always`로 지정된 경우
- 매니저가 필요하다고 판단할 때 `screenshot_mode: on_request`로 명시적 요청

---

## 6. 테스트 완료 후 파일 정리

커밋 완료 즉시 `.playwright-mcp/` 폴더 내 Claude가 생성한 파일 전부 삭제.

- ✅ 커밋 후 `.playwright-mcp/` 내 `.png`, `.yml`, `.log` 파일 즉시 삭제
- ❌ 해당 파일이 staged된 상태로 커밋 금지
- **검증:** 커밋 후 `ls .playwright-mcp/`로 잔존 파일 없는지 확인

---

## 7. 결과 취합 및 사용자 보고

- 테스터 보고는 영어로 수신
- 매니저가 한국어로 정리하여 사용자에게 전달
- 모든 테스트 완료 후 반드시 HTML 리포트 생성 → 웹 서버로 즉시 오픈 (아래 8번 참조)

---

## 8. HTML 리포트 생성 및 웹 오픈

모든 테스트가 완료되면 결과를 HTML 파일로 만들어 로컬 웹 서버로 띄운다.

### 리포트 파일 위치
- 저장 경로: `.playwright-mcp/report.html`
- 커밋하지 않음 (`.playwright-mcp/` 전체가 정리 대상)

### HTML 리포트 필수 포함 항목
- 테스트 실행 일시
- 전체 결과 요약 (PASS/FAIL 수, 소요 시간)
- 시나리오별 결과 테이블 (시나리오명, 결과, 실패 스텝, 원인)
- 실패 시 스크린샷 인라인 표시 (base64 임베드 또는 상대 경로)
- 색상 구분: PASS → 초록, FAIL → 빨강

### 웹 서버 실행
```bash
# Python 내장 서버 사용 (별도 설치 불필요)
cd .playwright-mcp && python3 -m http.server 7777
```
- 포트: `7777` 고정
- 실행 후 Playwright MCP로 `http://localhost:7777/report.html` 열어서 사용자에게 확인시킬 것

### 서버 종료
- 사용자가 확인 완료 후 `/clean` 실행하여 서버 종료

---

## 체크리스트

- [ ] 테스트 전 MCP 서버 활성화 수 확인
- [ ] 시나리오 작성 완료 후 테스터 호출
- [ ] 병렬 호출 시 MCP 서버 번호 중복 없는지 확인
- [ ] 테스트 완료 후 HTML 리포트 생성 (`.playwright-mcp/report.html`)
- [ ] 웹 서버 실행 후 브라우저로 리포트 오픈
- [ ] 사용자 확인 완료 후 `/clean` 으로 서버 종료
- [ ] 커밋 전 `.playwright-mcp/` 파일 정리 완료
