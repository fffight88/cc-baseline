# 후속 일괄 — grimbang 남은 일과 cc-baseline 재생 보완

2026-11-28 요청("2,3,4번 전부 할 수 있는 것은 진행해")을 한 플랜으로 묶는다.
- **cc-baseline(4번):** 재생이 못 보던 것(콘솔, 헤더의 지시문 하나, 두 응답 비교)을 보게 한다. 같은 계정을 쓰는 TC를 경고하고, 단계별 시간을 잰다.
- **grimbang(2·3번):** 크레딧 소진(402)을 화면과 로그에서 구분한다. lint를 0건으로 만든다. 밀린 메이저를 하나씩 올린다. 스타일 CSP를 좁힌다.
- **순서:** cc-baseline을 먼저 고친다. 고친 재생으로 grimbang의 회귀 검사를 돌린다.

## ⚡ Key Rules Summary

| ✅ DO | ❌ DON'T |
|---|---|
| grimbang은 브랜치 `chore/followups-1128`, cc-baseline은 develop에서 작업한다 | 확인 없이 grimbang main 병합, 운영 재빌드·배포 |
| 메이저는 하나씩 커밋한다. 깨지고 고칠 것이 크면 그 하나만 되돌리고 이유를 적는다 | 여러 메이저를 한 커밋에 섞기 |
| 화면이 바뀔 수 있는 변경(lint의 `<img>`·`<a>`, `motion`, 스타일 CSP)은 스크린샷 비교로 확인한다 | 빌드 통과만 보고 넘어가기 |
| 결제(Polar)는 가짜 Polar 서버로 "요청이 그대로인지"를 확인하고, 확인되지 않으면 올리지 않는다 | 운영 Polar나 실제 결제 호출 |
| 테스트 계정·테스트 Supabase·가짜 Gemini만 쓴다. 비밀 값은 `.env*`에만 둔다 | 키를 출력·기록에 남기기 |
| 서버는 포트로 찾아 끄고, 끝나면 `/clean` | `pkill -f "<명령 문자열>"`(자기 셸도 죽는다) |

## Meta
- Security Impact: Yes
- Code Quality Impact: Yes
- UI Impact: Yes
- Behavior Impact: Yes
- Claim Impact: No
- Audience: internal
- Reason: grimbang은 오류 응답(503)과 문구, CSP의 스타일 지시문, 결제 SDK 버전이 바뀌고, lint 수정이 여러 화면 파일에 닿는다. cc-baseline은 재생 스크립트의 검사 종류가 늘어난다.

---

## Context

- **요청:** 앞선 보고의 남은 일 2(402 구분), 3(메이저·lint·스타일 CSP), 4(cc-baseline 재생 보완) 중 할 수 있는 것 전부. 1(Mac 설치, Jev 키)은 사용자 몫이라 제외한다.
- **grimbang 현재 상태(확인함):**
  - main `68049c8`(운영 배포됨), 작업 트리 깨끗함.
  - **생성 실패:** 모든 시도가 실패하면 크레딧을 돌려주고 502를 보낸다(`app/api/generate/route.ts:205-219`). 화면(`components/dashboard/PromptArea.tsx:322`)은 502를 모두 "Gemini가 바쁘다"로 보여 준다.
    - 2026-11-28 운영 로그를 보면, SDK가 `ApiError`(`status: 402`, `RESOURCE_EXHAUSTED`, "prepayment credits are depleted")를 던졌다. 그런데도 5초 쉬고 한 번 더 시도했다.
    - 402는 이미 앱에서 "사용자 크레딧 부족"으로 쓰인다(`route.ts:89`). 화면은 402를 받으면 결제 창을 연다(`PromptArea.tsx:318`).
  - **lint 33건(오류 15, 경고 18):**
    - `react-hooks/set-state-in-effect` 10건. 대부분 마운트 뒤 `localStorage`를 읽는 SSR 2단 렌더 패턴이다.
    - 안 쓰는 변수 7건, `<img>` 4건, 내부 링크에 `<a>` 2건, `any` 2건, `exhaustive-deps` 4건, `prefer-const` 1건, `location.href` 1건, 규칙 이름이 없는 경고 2건(`app/api/webhooks/polar/route.ts`).
  - **메이저가 쓰이는 곳:**
    - `lucide-react`는 `components/main/hero/ImageCarouselHero.tsx`에서만, `three`는 `components/main/ColorBends.tsx`에서만 쓴다. 두 파일 모두 어디서도 import하지 않는다.
    - `motion`은 `components/ui/border-beam.tsx`에서 쓰고, 이 컴포넌트는 Pricing·PromptArea·PricingModal에 나온다.
    - `@polar-sh/sdk`는 `lib/polar.ts`에서 쓰고, `app/api/checkout`·`app/api/portal`이 그것을 쓴다(웹훅은 `standardwebhooks`). 테스트 env에 Polar 값이 없다.
    - 운영 이미지는 `node:22-alpine`이다.
  - **style 속성:** `style={{…}}` 22곳(10개 파일)과 `<style>` 태그 1곳(`components/ui/quantum-pulse-loade.tsx`).
- **cc-baseline 현재 상태(확인함):**
  - develop `6a14a17`, 깨끗함.
  - **`tc-replay.js`:**
    - 콘솔 메시지는 불변식(`invariants`)에만 모으고, 기대 결과 검사로는 쓸 수 없다. `DATA_CHECKS`의 `log`는 `log_count`(파일)만 받는다.
    - api 검사는 헤더 전체 값만 비교한다. 두 응답을 비교하는 방법은 없다.
  - **grimbang B·D 결과:** 새 TC 6개 중 5개를 재생할 수 없었다(콘솔 2, 지시문 2, 비교 1). 같은 계정을 쓰는 TC는 순서에 따라 결과가 달라졌다. 한 라운드가 약 14분 걸렸다.
- **방향:** 표준 작업이라 규칙 13은 쓰지 않는다. 내부 모드다(남이 평가하는 결과물이 아니다).

## Decisions (made without asking)

| # | 결정 | 이유 | 근거 | 되돌리는 법 |
|---|---|---|---|---|
| D1 | Gemini가 402를 주면 재시도하지 않고 503 `{ code: 'provider_billing' }`로 답한다. 크레딧 환불은 지금처럼 한다 | 402로 답하면 화면이 결제 창을 연다. 재시도해도 결과가 같고 5초만 늦어진다 | `route.ts:89`, `PromptArea.tsx:318`, 운영 로그 | 커밋 되돌리기 |
| D2 | 화면 문구: en "Image generation is temporarily unavailable. No credit was used. Please try again later.", ko "이미지 생성을 잠시 쓸 수 없어요. 크레딧은 차감되지 않았어요. 잠시 후 다시 시도해주세요." "충전" 같은 운영 사정은 사용자에게 보이지 않는다 | 사용자가 할 일은 기다리는 것뿐이다. 크레딧이 남아 있다는 점이 가장 궁금할 것이다 | 기존 문구의 말투(`geminiUnavailable`) | 문구 수정 |
| D3 | 운영자 알림은 서버 로그 한 줄 `[ALERT] Gemini prepaid credits are depleted — top up in AI Studio`로 한다. 메일이나 외부 알림은 만들지 않는다 | 알림 인프라가 없다. 지금 운영자는 docker 로그를 본다 | 이번 장애를 로그로 찾음 | — |
| D4 | lint는 0건이 목표다. `set-state-in-effect` 중 SSR 2단 렌더(마운트 뒤 `localStorage` 읽기)는 줄 단위 비활성 주석에 이유를 단다. 나머지는 코드로 고친다. `<img>`는 같은 크기의 `next/image`, 내부 `<a>`는 `Link` | 2단 렌더는 하이드레이션 불일치를 막는 의도된 패턴이다. 바꾸면 화면이 깜빡이거나 어긋날 수 있다 | 해당 파일들 | 파일별 되돌리기 |
| D5 | 안 쓰는 컴포넌트(`ImageCarouselHero`, `AetherHero`, `ColorBends`)는 지우지 않고 lint만 고친다 | 삭제는 요청 범위 밖이다(규칙 4) | grep import 0건 | — |
| D6 | `@types/node`는 26이 아니라 `^22`로 올린다 | 운영 런타임이 Node 22다. 타입이 런타임보다 앞서면 없는 API를 써도 통과한다 | `Dockerfile` `node:22-alpine` | 버전 되돌리기 |
| D7 | `typescript` 7은 시도한다. Next 빌드의 타입 검사가 쓰지 못하면 되돌리고 이유를 적는다 | 7은 새 구현이라 Next와 맞는지 미리 알 수 없다 | Next peer 범위에 TS가 없음 | 커밋 되돌리기 |
| D8 | `@polar-sh/sdk` 1.x 판단 기준: 가짜 Polar 서버에서 checkout·portal 라우트가 보내는 요청(메서드·경로·본문)을 0.43과 1.x로 각각 기록하고 비교한다. 같고 응답 처리도 통과하면 올린다. 다르거나 가짜 응답을 만들 수 없으면 올리지 않는다 | 결제는 테스트 경로가 없다. 운영 Polar 호출은 돈과 외부 계정이 걸린다 | 테스트 env에 Polar 값 없음 | 커밋 되돌리기 |
| D9 | 스타일 CSP: 운영 빌드에 Report-Only 정책을 붙이고 페이지를 돌며 위반을 먼저 잰다. `style-src-elem`이 nonce로 끝나면 `style-src-elem 'self' 'nonce-…' fonts` + `style-src-attr 'unsafe-inline'`로 나눈다. 옛 브라우저용으로 `style-src`는 그대로 둔다. 라이브러리가 nonce 없이 `<style>`을 넣고 막을 방법이 없으면 지금 정책을 유지하고 이유를 적는다 | 위험한 CSS 주입(선택자로 값 빼내기)은 `<style>` 요소로 한다. style 속성 22곳과 `motion`의 SSR 속성까지 막으려면 화면 재작성이 필요한데 얻는 것이 적다 | CSP3 `style-src-elem`/`-attr`, grep 22건 | 커밋 되돌리기 |
| D10 | 화면 회귀는 grimbang에 `scripts/visual-check.mjs`를 두고 확인한다. Playwright로 주요 페이지를 찍고 브라우저 canvas로 픽셀 차이를 낸다. 애니메이션은 `reducedMotion`과 가림 영역으로 제외한다 | 이미지 비교 도구가 서버에 없다(ImageMagick 없음). 의존성을 늘리지 않는다 | `which compare` 없음 | 스크립트 삭제 |
| D11 | 재생 보완: 콘솔은 `log` 채널의 새 검사 `console_count`(grep + equals)로 본다. 헤더는 `part`(`;`로 나눈 지시문 이름)로 일부만 본다. 두 응답 비교는 `differs_from: "<save_as>"`로 한다. 같은 fixture를 쓰는데 setup 리셋이 없는 TC가 둘 이상이면 WARN을 낸다. TC 결과 줄에는 단계별 ms를 적는다 | grimbang B·D에서 막힌 다섯 가지를 그대로 메운다. 새 채널을 만들지 않으면 TC 스키마는 바뀌지 않는다 | HANDOFF "grimbang B·D 결과" 후보 1~4 | 커밋 되돌리기 |
| D12 | 재생 속도는 먼저 잰다(D11의 단계별 ms). cc-baseline이 고칠 몫(스윕 등)이 크면 이 플랜에서 고친다. 프로젝트의 리셋 대기(`--wait-rate-window`)가 크면 HANDOFF에 적기만 한다 | 재지 않고 고치면 엉뚱한 곳을 고친다 | "측정하지 않음" 메모 | — |
| D13 | 서버 끄는 법(포트 → pid → kill)을 `reference_test_env.md`에 한 절로 넣는다 | 이번에 `pkill -f`가 자기 셸을 죽였다 | 2026-11-27 exit 144 | 문서 되돌리기 |

---

## 설계

### cc-baseline (`templates/scripts/tc-replay.js` 외)

- **`console_count`:** `DATA_CHECKS.log = ['log_count', 'console_count']`로 바꾼다.
  - 형식: `{ op: 'console_count', grep: [..], equals: n, types?: ['error','warning'] }`. `types`의 기본은 error와 warning이다.
  - 재생 중 모든 페이지의 콘솔 메시지를 `seen.consoleAll`에 모은다(최대 500개, 토큰은 가린다). 검사는 grep 문자열을 모두 포함하는 메시지 수를 센다. observed는 `n console message(s)`이고, 처음 하나는 200자까지 보인다.
  - 화면 TC에서만 쓸 수 있다(api TC면 거부).
- **헤더 `part`:** api 검사에서 `header`와 함께만 쓴다. 헤더 값을 `;`로 나누고, 첫 단어가 `part`와 같은(대소문자 무시) 조각을 고른다. 없으면 `no <part> in <header>`가 된다.
- **`differs_from`:** api 검사의 비교 방식 하나로 넣는다(`COMPARE_KEYS`와 배타). 값을 지금 응답과 `differs_from`이 가리키는 저장 응답에서 같은 방법(`header`·`part`·`json_path`)으로 꺼낸다. 둘 다 있고 다르면 PASS다.
- **fixture 공유 경고:** `run` 시작 때 `rc.run.tcs[id].fixture`(없으면 기록의 `session`)가 같은 TC를 묶는다. 둘 이상이고 그중 setup command가 없는 TC가 있으면 stderr에 WARN을 낸다. 실행 순서도 함께 적는다.
- **단계별 시간:** `replayTc`가 `times: { setup, login, steps, expected, settle, sweep, teardown }`(ms)를 재서 출력 줄과 결과 줄(`replay_ms`)에 싣는다.
- **기록 검사·문서:**
  - `checkCondition`·`checkRecording`에 새 키 검증을 넣는다.
  - 기록 형식을 `reference_e2e_manager_guide.md` §2-C와 `agents/e2e-tester.md`에 적는다.
  - `reference_test_env.md`에 "서버 끄기" 절을 넣는다.
  - CHANGELOG `[Unreleased]`를 갱신한다.
- **테스트:** `test/run.js`에 각 기능의 단위 테스트를 넣는다. 로컬 http 서버와 Playwright로 기존 tc-replay 테스트 패턴을 따른다. TC는 `docs/tc/tc-replay.tc.json`에 아래 초안을 더한다.

### grimbang

1. **402 구분(D1~D3):**
   - `route.ts`의 재시도 루프에서 `err.status === 402`면 즉시 멈추고 billing 표시를 남긴다. 루프 뒤에는 billing이면 로그 한 줄을 쓰고 503 `{ error, code: 'provider_billing' }`로 답한다. 환불은 그대로다.
   - `PromptArea.tsx`에서 503과 `code === 'provider_billing'`이면 `t.prompt.providerUnavailable`을 보인다. `en.ts`·`ko.ts`에 문구를 넣는다.
   - `scripts/fake-gemini.mjs`·`fake-gemini-mode.mjs`에 `billing` 모드를 넣는다. 응답은 실제 로그와 같은 402 `RESOURCE_EXHAUSTED` 본문이다.
2. **lint 0건(D4·D5).**
3. **메이저, 하나씩 커밋:**
   - `lucide-react`, `three`·`@types/three`: 빌드만 확인. 안 쓰는 파일이다.
   - `motion` 14: `border-beam` 화면 비교.
   - `eslint` 10, `@types/node` ^22(D6), `typescript` 7(D7).
   - `@polar-sh/sdk` 1.x(D8): `scripts/fake-polar.mjs`(커밋하지 않음, `.cc-audits/followups-1128/`)로 요청을 기록해 비교한다.
4. **스타일 CSP(D9):** `lib/csp.ts`. 필요하면 `quantum-pulse-loade.tsx`의 `<style>`에 nonce를 준다(레이아웃에서 nonce를 내려받는 방식은 GA와 같다). `scripts/check-csp.mjs`에 새 지시문 검사를 더한다.
5. **csp-nonce TC 재녹화:** 새 재생 검사로 `home-runs-scripts`·`dashboard-runs-scripts`(콘솔), `header-has-nonce`(part), `nonce-per-request`(differs_from)를 다시 녹화하고 verify로 채택받는다. cc-baseline 보완을 실전에서 확인하는 단계다.

### 고칠 파일

- **cc-baseline:**
  - `templates/scripts/tc-replay.js`
  - `templates/memory/reference_e2e_manager_guide.md`, `templates/memory/reference_test_env.md`, `templates/agents/e2e-tester.md`
  - `test/run.js`, `docs/tc/tc-replay.tc.json`, `docs/plans/replay-observe.md`, `CHANGELOG.md`
- **grimbang:**
  - `app/api/generate/route.ts`, `components/dashboard/PromptArea.tsx`, `lib/i18n/locales/{en,ko}.ts`
  - `scripts/fake-gemini*.mjs`, `scripts/visual-check.mjs`(새 파일), `scripts/check-csp.mjs`, `lib/csp.ts`
  - lint 대상 파일(위 목록), `package.json`·`package-lock.json`
  - `docs/tc/provider-billing.tc.json`, `docs/plans/grimbang-followups.md`

---

## Phase A — cc-baseline 재생 보완

1. Read ~/.claude/memory/phase_start.md and execute
2. 플랜을 `cc-baseline/docs/plans/replay-observe.md`와 `grimbang-repo/docs/plans/grimbang-followups.md`로 쓴다. TC 초안 두 개를 파일로 쓰고 두 검사를 파일로 다시 돌린다.
3. `git log -3 -- templates/scripts/tc-replay.js`(규칙 8)
4. 설계의 다섯 기능, 기록 검사, 문서를 구현한다.
5. `npm test` 통과 → `node bin/cli.js --yes` → `--doctor`
6. security-auditor와 code-reviewer를 병렬로 돌려 반영한다(최대 3회).
7. 커밋하고 develop에 푸시한다(`.claude/` 제외).
8. Read ~/.claude/memory/phase_end.md and execute

## Phase B — grimbang 기준선과 402

1. Read ~/.claude/memory/phase_start.md and execute
2. 브랜치 `chore/followups-1128`을 만든다. 가짜 Gemini와 개발 서버(3200, 로그는 파일로)를 띄우고 `test-env-check.js`로 확인한다.
3. **기준선:**
   - csp-nonce TC 4개를 새 재생 검사로 녹화·verify한다(설계 grimbang 5).
   - 기존 TC 24개를 재생으로 한 라운드 돌리고 단계별 시간을 기록한다(D12).
   - `visual-check.mjs`를 쓰고 기준 스크린샷을 찍는다.
4. 402 구분을 구현한다. 빌드와 lint를 확인하고, 새 TC 5개를 별도 라운드(가짜 Gemini `billing` 모드)로 돌린다. 기존 생성 TC도 돌린다.
5. 커밋
6. Read ~/.claude/memory/phase_end.md and execute

## Phase C — lint와 메이저

1. Read ~/.claude/memory/phase_start.md and execute
2. lint 0건(D4·D5) → 빌드, 재생 라운드, 화면 비교 → 커밋
3. 메이저를 설계 3의 순서대로 하나씩 올린다. 매번 빌드, lint, 재생 라운드, 필요하면 화면 비교를 하고 커밋하거나 되돌린다.
4. Polar(D8): 가짜 Polar 서버로 0.43과 1.x의 요청을 기록하고 비교한다 → 올리거나 되돌린다.
5. `npm audit` 0건 유지를 확인한다.
6. Read ~/.claude/memory/phase_end.md and execute

## Phase D — 스타일 CSP, 감사, 정리

1. Read ~/.claude/memory/phase_start.md and execute
2. 운영 빌드(3201)에 Report-Only를 붙여 위반을 잰다 → D9대로 적용하거나 유지한다 → `check-csp.mjs --production`, 화면 비교, CSP 위반 0건
3. security-auditor와 code-reviewer를 grimbang 변경 전체에 병렬로 돌려 반영한다(최대 3회). 고쳤으면 TC를 다시 재생한다.
4. 마지막 전체 라운드: 모든 TC(기존 24 + 새 5)
5. 브랜치를 푸시한다. 포트로 서버를 끄고 `/clean`을 돌린다.
6. HANDOFF와 메모리를 갱신한다(결과, 측정한 시간, 남은 것).
7. Read ~/.claude/memory/phase_end.md and execute
8. 완료 보고에서 main 병합과 운영 배포를 사용자에게 확인받는다.

---

## Test Cases (draft)

### grimbang `docs/tc/provider-billing.tc.json`

| TC ID | 제목 | surface | readiness | 기대 결과 수 |
|---|---|---|---|---|
| TC.provider-billing.reason-shown | 바쁘다 문구 대신 사용 불가 문구 | ui-web | ready | 2 |
| TC.provider-billing.reason-shown-ko | 한국어 화면의 사용 불가 문구 | ui-web | ready | 1 |
| TC.provider-billing.api-503 | API가 503과 billing 코드로 답한다 | api | ready | 2 |
| TC.provider-billing.credit-kept | billing 실패는 크레딧을 쓰지 않는다 | ui-web | ready | 1 |
| TC.provider-billing.operator-alert | 서버 로그에 경보 줄이 남는다 | api | ready | 1 |

**검사 요약 (표준 입력, 이 플랜의 JSON):** `tc-lint` 5 TC 경고 0건, `tc-jev-check`(jev-1.14.0, 7문장) 경고 0건. 파일로 쓴 뒤 다시 돌린다. 열린 질문은 없다(문구는 D2).

```json
{
 "schema_version": 1,
 "feature": "provider-billing",
 "title": "Image generation tells a provider billing outage apart from a busy provider",
 "plan": "grimbang-followups",
 "sources": [
  {"id": "REQ.grimbang-followups", "kind": "requirement", "locator": "docs/plans/grimbang-followups.md"},
  {"id": "SRC.billing-outage", "kind": "source", "locator": "production log 2026-11-28: Gemini answered 402 RESOURCE_EXHAUSTED 'Your prepayment credits are depleted' and the screen showed the busy text"},
  {"id": "SRC.generate-route", "kind": "source", "locator": "app/api/generate/route.ts @ 68049c8: every failed attempt ends in 502 'Image generation failed', PromptArea maps 502 to geminiUnavailable"},
  {"id": "DEC.billing-texts", "kind": "decision", "locator": "decided by Claude under rule 15: 503 with code provider_billing; en 'Image generation is temporarily unavailable. No credit was used. Please try again later.' ko '이미지 생성을 잠시 쓸 수 없어요. 크레딧은 차감되지 않았어요. 잠시 후 다시 시도해주세요.'; log line '[ALERT] Gemini prepaid credits are depleted'"}
 ],
 "actions": [
  {"id": "ACT.provider-billing.generate", "title": "Generate while the provider's prepaid credit is used up", "actor": "signed-in user", "trigger": "types a prompt and clicks Generate", "preconditions": ["the image provider answers 402 RESOURCE_EXHAUSTED"], "outputs": ["an error panel with the unavailable text", "a 503 response with code provider_billing", "an alert line in the server log"], "evidence_refs": ["REQ.grimbang-followups", "SRC.billing-outage", "DEC.billing-texts"]}
 ],
 "test_cases": [
  {"id": "TC.provider-billing.reason-shown", "title": "The screen shows the unavailable text, not the busy text", "action_refs": ["ACT.provider-billing.generate"], "level": "functional", "surface": "ui-web", "preconditions": ["signed in as test account 1 with 10 credits", "the fake Gemini server answers every request with a 402 billing error"], "steps": [{"goal": "Open the dashboard", "done_when": {"expect": "The prompt box is visible"}}, {"goal": "Type a prompt and click 'Generate'", "done_when": {"expect": "The 'Generation Failed' panel is visible"}}], "expected": [{"text": "Under 'Generation Failed' the text \"Image generation is temporarily unavailable. No credit was used. Please try again later.\" is shown", "observe": {"channel": "dom", "key": "error panel text"}}, {"text": "The text \"Gemini seems really busy right now\" is not shown", "observe": {"channel": "dom", "key": "error panel text"}}], "basis": {"kind": "requirement", "refs": ["DEC.billing-texts", "SRC.billing-outage"]}, "readiness": "ready"},
  {"id": "TC.provider-billing.reason-shown-ko", "title": "The Korean screen shows the Korean unavailable text", "action_refs": ["ACT.provider-billing.generate"], "level": "functional", "surface": "ui-web", "preconditions": ["signed in as test account 1 with 10 credits", "language Korean", "the fake Gemini server answers every request with a 402 billing error"], "steps": [{"goal": "Open the dashboard", "done_when": {"expect": "The prompt box is visible"}}, {"goal": "Type a prompt and click the generate button", "done_when": {"expect": "The error panel is visible"}}], "expected": [{"text": "The error panel shows the text \"이미지 생성을 잠시 쓸 수 없어요. 크레딧은 차감되지 않았어요. 잠시 후 다시 시도해주세요.\"", "observe": {"channel": "dom", "key": "error panel text"}}], "basis": {"kind": "requirement", "refs": ["DEC.billing-texts"]}, "readiness": "ready"},
  {"id": "TC.provider-billing.api-503", "title": "The API answers 503 with a billing code", "action_refs": ["ACT.provider-billing.generate"], "level": "functional", "surface": "api", "preconditions": ["a session signed in as test account 2 with 10 credits", "the fake Gemini server answers every request with a 402 billing error"], "steps": [{"goal": "Send POST /api/generate with a prompt", "done_when": {"expect": "A response arrives"}}], "expected": [{"text": "The response status is 503", "observe": {"channel": "api", "key": "status"}}, {"text": "The response JSON field code is provider_billing", "observe": {"channel": "api", "key": "json.code"}}], "basis": {"kind": "requirement", "refs": ["DEC.billing-texts", "SRC.generate-route"]}, "readiness": "ready"},
  {"id": "TC.provider-billing.credit-kept", "title": "A billing failure uses no credit", "action_refs": ["ACT.provider-billing.generate"], "level": "functional", "surface": "ui-web", "preconditions": ["signed in as test account 1 with 10 credits", "the fake Gemini server answers every request with a 402 billing error"], "steps": [{"goal": "Open the dashboard", "done_when": {"expect": "The prompt box is visible"}}, {"goal": "Type a prompt and click 'Generate'", "done_when": {"expect": "The 'Generation Failed' panel is visible"}}, {"goal": "Reload the dashboard and open the account menu by clicking the avatar", "done_when": {"expect": "The account menu is visible"}}], "expected": [{"text": "The credit count next to the C icon in the account menu reads 10", "observe": {"channel": "dom", "key": "account menu credits number"}}], "basis": {"kind": "requirement", "refs": ["DEC.billing-texts", "SRC.generate-route"]}, "readiness": "ready"},
  {"id": "TC.provider-billing.operator-alert", "title": "The server log names the billing outage", "action_refs": ["ACT.provider-billing.generate"], "level": "functional", "surface": "api", "preconditions": ["a session signed in as test account 3", "the fake Gemini server answers every request with a 402 billing error", "the dev server log is written to a file"], "steps": [{"goal": "Send POST /api/generate with a prompt", "done_when": {"expect": "A response arrives"}}], "expected": [{"text": "The dev server log has a line containing '[ALERT] Gemini prepaid credits are depleted'", "observe": {"channel": "log", "key": "dev server log"}}], "basis": {"kind": "requirement", "refs": ["DEC.billing-texts"]}, "readiness": "ready"}
 ],
 "open_questions": []
}
```

### cc-baseline `docs/tc/tc-replay.tc.json`에 더할 것

| TC ID | 제목 | surface | readiness | 기대 결과 수 |
|---|---|---|---|---|
| TC.tc-replay.console-count-pass | 맞는 콘솔 메시지가 없으면 통과 | cli | ready | 1 |
| TC.tc-replay.console-count-fail | 맞는 콘솔 메시지가 있으면 실패 | cli | ready | 1 |
| TC.tc-replay.header-part | 헤더의 지시문 하나만 읽는다 | cli | ready | 3 |
| TC.tc-replay.differs-from | 두 응답을 비교한다 | cli | ready | 2 |
| TC.tc-replay.shared-fixture-warning | fixture를 공유하면 경고한다 | cli | ready | 3 |
| TC.tc-replay.phase-times | 단계별 시간을 출력한다 | cli | ready | 3 |

**검사 요약 (표준 입력):** 첫 판에서 `single_fact` 경고 3건이 나와 줄을 나눴다. 나눈 판을 기존 파일과 합친 41 TC는 `tc-lint` 경고 0건이다. `tc-jev-check`는 파일로 쓴 뒤 돌린다. 파일로 쓴 뒤 다시 돌린다. 기존 파일의 `ACT.tc-replay.run`과 `sources`에 `REQ.replay-observe`·`SRC.grimbang-bd-gaps`를 더해 합친다.

```json
{
 "sources_to_add": [
  {"id": "REQ.replay-observe", "kind": "requirement", "locator": "docs/plans/replay-observe.md"},
  {"id": "SRC.grimbang-bd-gaps", "kind": "source", "locator": ".cc-audits/HANDOFF-next.md grimbang B·D 결과: console, header directive, two-response comparison, shared-account order, 14 min round"}
 ],
 "test_cases_to_add": [
  {"id": "TC.tc-replay.console-count-pass", "title": "A console_count check passes when no message matches", "action_refs": ["ACT.tc-replay.run"], "level": "functional", "surface": "cli", "preconditions": ["an accepted recording whose expected result on channel log is console_count with grep 'Content Security Policy' and equals 0", "the page logs no such message"], "steps": [{"goal": "Run tc-replay.js run for that TC", "done_when": {"expect": "The command exits"}}], "expected": [{"text": "The result line has verdict PASS for that expected result with observed '0 console message(s)'", "observe": {"channel": "artifact", "key": "tc-results.jsonl"}}], "basis": {"kind": "requirement", "refs": ["REQ.replay-observe", "SRC.grimbang-bd-gaps"]}, "readiness": "ready"},
  {"id": "TC.tc-replay.console-count-fail", "title": "A console_count check fails when the page logs a matching message", "action_refs": ["ACT.tc-replay.run"], "level": "functional", "surface": "cli", "preconditions": ["the same recording", "the page logs one console error containing 'Content Security Policy'"], "steps": [{"goal": "Run tc-replay.js run for that TC", "done_when": {"expect": "The command exits"}}], "expected": [{"text": "The result line has verdict FAIL for that expected result with observed '1 console message(s)'", "observe": {"channel": "artifact", "key": "tc-results.jsonl"}}], "basis": {"kind": "requirement", "refs": ["REQ.replay-observe"]}, "readiness": "ready"},
  {"id": "TC.tc-replay.header-part", "title": "An api check reads one part of a header", "action_refs": ["ACT.tc-replay.run"], "level": "functional", "surface": "cli", "preconditions": ["an accepted api recording whose check reads header content-security-policy part script-src with includes 'nonce-'", "the server sends script-src with a nonce and style-src without one"], "steps": [{"goal": "Run tc-replay.js run for that TC", "done_when": {"expect": "The command exits"}}], "expected": [{"text": "The result line has verdict PASS for that check", "observe": {"channel": "artifact", "key": "tc-results.jsonl"}}, {"text": "The observed text of that check starts with 'script-src'", "observe": {"channel": "artifact", "key": "tc-results.jsonl"}}, {"text": "The observed text of that check does not contain 'style-src'", "observe": {"channel": "artifact", "key": "tc-results.jsonl"}}], "basis": {"kind": "requirement", "refs": ["REQ.replay-observe", "SRC.grimbang-bd-gaps"]}, "readiness": "ready"},
  {"id": "TC.tc-replay.differs-from", "title": "An api check compares two saved responses", "action_refs": ["ACT.tc-replay.run"], "level": "functional", "surface": "cli", "preconditions": ["an accepted api recording with two GET requests saved as first and second and a check on second with differs_from first on one header"], "steps": [{"goal": "Run it against a server that sends a new header value per request", "done_when": {"expect": "The command exits"}}, {"goal": "Run it against a server that sends the same value twice", "done_when": {"expect": "The command exits"}}], "expected": [{"text": "The first run's result line has verdict PASS for that check", "observe": {"channel": "artifact", "key": "tc-results.jsonl"}}, {"text": "The second run's result line has verdict FAIL for that check", "observe": {"channel": "artifact", "key": "tc-results.jsonl"}}], "basis": {"kind": "requirement", "refs": ["REQ.replay-observe", "SRC.grimbang-bd-gaps"]}, "readiness": "ready"},
  {"id": "TC.tc-replay.shared-fixture-warning", "title": "A run warns when TCs share a fixture without a reset", "action_refs": ["ACT.tc-replay.run"], "level": "functional", "surface": "cli", "preconditions": ["a run file where two TCs name the same fixture and neither recording has a setup command"], "steps": [{"goal": "Run tc-replay.js run for both TCs", "done_when": {"expect": "The command exits"}}], "expected": [{"text": "stderr has a WARN line that names the fixture", "observe": {"channel": "artifact", "key": "stderr"}}, {"text": "That WARN line names the first TC id", "observe": {"channel": "artifact", "key": "stderr"}}, {"text": "That WARN line names the second TC id", "observe": {"channel": "artifact", "key": "stderr"}}], "basis": {"kind": "requirement", "refs": ["REQ.replay-observe", "SRC.grimbang-bd-gaps"]}, "readiness": "ready"},
  {"id": "TC.tc-replay.phase-times", "title": "A run prints how long each phase took", "action_refs": ["ACT.tc-replay.run"], "level": "functional", "surface": "cli", "preconditions": ["an accepted screen recording"], "steps": [{"goal": "Run tc-replay.js run for that TC", "done_when": {"expect": "The command exits"}}], "expected": [{"text": "The TC's output line has a millisecond time for steps", "observe": {"channel": "artifact", "key": "stdout"}}, {"text": "The TC's output line has a millisecond time for expected", "observe": {"channel": "artifact", "key": "stdout"}}, {"text": "The TC's output line has a millisecond time for sweep", "observe": {"channel": "artifact", "key": "stdout"}}], "basis": {"kind": "requirement", "refs": ["REQ.replay-observe", "SRC.grimbang-bd-gaps"]}, "readiness": "ready"}
 ]
}
```

## E2E

- **grimbang 실행 설정 `.cc-audits/followups-1128/tc-run.json`:**
  - `csp-nonce-deps`의 설정(`base_url` `http://localhost:3200`, `reset_command`, `test_login_path`, `browser_origins`, 가짜 Gemini `external_stubs`, 계정 fixture 1~5)을 재사용한다.
  - `readable.log`에 개발 서버 로그 파일을 넣는다.
  - provider-billing TC는 setup에서 `fake-gemini-mode.mjs billing`, teardown에서 `ok`를 돌린다. 가짜 서버의 모드가 전역이라 다른 TC와 섞이지 않게 별도 라운드로 돌린다.
- **돌릴 TC:**
  - 새 `ready` TC 5개: ui-web 3개는 브라우저, api 2개는 `tc-api-run.js`.
  - 기존 24개: 녹화가 있으면 재생하고, 없거나 거절되면 테스터가 돌린다.
- **cc-baseline:** cli TC는 `test/run.js`의 단위 테스트로 확인한다. 실전 확인은 Phase B의 csp-nonce 재녹화다.
- 새 단계나 기대 결과는 e2e에서 만들지 않는다. 실패하면 수정 루프(`tc-fix-loop.js`)를 거친다. TC 문장이 틀렸으면 사용자에게 확인받는다.

## 검증

- **cc-baseline:** `npm test` 통과, doctor 14 ok.
- **grimbang 빌드:** `npm run build`가 통과하고 `npm run lint`는 0건이다.
- **재생:** csp-nonce TC 4개가 새 검사로 재생 채택(accepted)된다.
- **TC:** 마지막 전체 라운드에서 TC 29개가 모두 통과한다. `production-no-eval`은 운영 빌드에서 확인한다.
- **화면 비교:** 주요 페이지의 차이가 기준선 대비 허용치 안이다. 차이가 나면 스크린샷을 보고 원인을 적는다.
- **CSP:** 운영 빌드의 `check-csp.mjs --production`이 통과하고, `/`·`/?login=true`·`/dashboard`·`/about`에서 CSP 위반이 0건이다.
- **메이저:** 올린 것과 되돌린 것을 각각 이유와 함께 적는다. `npm audit`은 0건이다.
- **정리:** `/clean` 뒤 3200·3201·4010과 가짜 Polar 포트에 남은 프로세스가 없다.

## ✅ Checklist

- [ ] 플랜·TC 파일을 쓰고 두 검사를 다시 돌렸다
- [ ] cc-baseline: `console_count`, `part`, `differs_from`, fixture 경고, 단계별 시간, 문서, 테스트, 감사, 푸시, 설치
- [ ] grimbang 기준선: csp-nonce 재녹화와 채택, 기존 24개 라운드와 시간 측정, 기준 스크린샷
- [ ] 402 구분 구현과 새 TC 5개 통과
- [ ] lint 0건
- [ ] 메이저: lucide, three, motion, eslint, @types/node, typescript, Polar(각각 커밋 또는 되돌림 기록)
- [ ] 스타일 CSP 측정과 적용(또는 유지 이유)
- [ ] 보안 감사·코드 리뷰 반영, 마지막 전체 라운드 통과
- [ ] 브랜치 푸시, `/clean`, HANDOFF·메모리 갱신
- [ ] main 병합·운영 배포는 사용자 확인을 받는다

## Results (Phase A)

- **D12 측정(grimbang 기준선 라운드, generation-guard 10개):** 397초 중 스윕 296초(75%), 단계 실행 약 86초. 리셋(`--wait-rate-window`)은 라운드마다 72초. → 스윕은 cc-baseline 몫이라 이 플랜에서 고쳤다. 한 경로의 컨트롤을 브라우저 컨텍스트 3개에 나눠 동시에 누른다(`CC_SWEEP_LANES`). `/`와 `/dashboard`의 스윕이 296초에서 188초로 줄었고 두 화면 모두 clean이다.
- 리뷰 에이전트가 비교하려고 작업 트리를 `git stash`했다가 되돌렸다. 그동안 돌던 테스트와 재생 1회(next16 기준선)는 원래 코드로 돌았다. 테스트는 다시 돌렸다.

## Audit History

- iter-1: 2026-11-28 / critical=0 high=0 medium=0 low=1 (SEC-001 콘솔 메시지 마스킹 범위 → 가이드에 적음) / next_action=done
- iter-2: 2026-11-28 / critical=0 high=0 medium=0 low=2 (스윕 병렬화만 대상. 도중 실패 시 컨텍스트 닫기 → 고침, 추가 컨텍스트의 외부 차단 기록 → 스윕 결과에 원래 싣지 않아 그대로) / next_action=done

## Code Review History

- code-review-iter-1: 2026-11-28 / critical=0 high=0 medium=2 low=3 / profile_status=cached / next_action=self_fix → 5건 모두 반영(스윕 컨텍스트의 차단 수 합산, 콘솔 500개 상한 표시와 FAIL, 안 쓰는 변수, no_browser의 warnings, 테스트 2개). `npm test` 250 + 21 통과.
