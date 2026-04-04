<h1 align="center">tistory-autoposter</h1>

<p align="center">
  GitHub 이슈 기반 티스토리 자동 포스팅
  <br />
  AI가 포스팅 가치를 판단하고, 글을 작성하고, 발행까지 자동으로
  <br />
  <sub>서버리스: GitHub Actions에서 실행 — 별도 서버 불필요</sub>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-20-339933?logo=nodedotjs" alt="Node.js" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/AI-Anthropic-blueviolet?logo=anthropic" alt="AI" />
  <img src="https://img.shields.io/badge/Blog-Tistory-orange" alt="Tistory" />
  <img src="https://img.shields.io/badge/CI-GitHub_Actions-2088ff?logo=githubactions" alt="GitHub Actions" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License" />
</p>

---

## 이게 뭔가요?

**서버리스 GitHub Actions 파이프라인**입니다. 봇도, 서버도 없습니다.

소스 레포(예: cryptobot)에서 이슈가 닫히면, GitHub Actions가 자동으로:
1. 이슈 내용을 분석해 블로그에 올릴 가치가 있는지 **AI가 판단**하고
2. 가치 있다면 한국어 기술 블로그 글을 **AI가 작성**하고
3. 티스토리에 **자동 발행**합니다

`.autoposter.yml` 하나로 프로젝트별 규칙을 커스터마이징할 수 있습니다.

---

## 아키텍처

```
소스 레포 (cryptobot 등)
│  이슈 Close / 'blog-worthy' 라벨
│  .autoposter.yml → base64 인코딩
│
▼  repository_dispatch (config 포함)
┌─ tistory-autoposter (GitHub Actions) ─────────────────────┐
│                                                            │
│  0. Config       3-tier 설정 리졸브                         │
│       ↓          (프로젝트 → default.yml → Zod 기본값)     │
│  1. Prefilter    본문 길이, 라벨, 봇, 작성자 체크            │
│       ↓ pass                                               │
│  2. AI Judge     포스팅 가치 판단 (worthy/skip)              │
│       ↓ worthy                                             │
│  3. AI Writer    한국어 HTML 블로그 글 생성                   │
│       ↓                                                    │
│  4. Publisher    티스토리 발행                                │
│       HTTP POST (우선) → Puppeteer (폴백)                   │
│                                                            │
└────────────────────────────────────────────────────────────┘
       ↓
  티스토리 블로그 글 발행 완료
```

---

## 빠른 시작

### 사전 요구사항

- Node.js 20+
- Anthropic API Key
- 티스토리 블로그 (카카오 로그인)

### 1. 설치

```bash
git clone https://github.com/SeungMinK/tistory-autoposter.git
cd tistory-autoposter
npm install
npm run build
```

### 2. 쿠키 캡처 (최초 1회)

```bash
npm run setup-cookies
# 브라우저가 열리면 카카오 계정으로 로그인
# 출력된 Base64 문자열 → GitHub Secret TISTORY_COOKIES에 저장
```

### 3. GitHub Secrets 설정

**autoposter 레포**에 설정:

| Secret | 설명 |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API 키 |
| `TISTORY_COOKIES` | Base64 인코딩된 쿠키 JSON |
| `TISTORY_BLOG_NAME` | 블로그 이름 (예: `seung-min`) |
| `GITHUB_PAT` | batch 모드용: 소스 레포 이슈 라벨링 PAT (repo 스코프) |

선택 (Repository Variables):

| Variable | 설명 |
|---|---|
| `LLM_MODEL` | AI 모델 (기본: `claude-haiku-4-5`) |

### 4. 첫 테스트

```bash
DRY_RUN=true \
TEST_PAYLOAD='{"action":"closed","issue":{"number":1,"title":"테스트 이슈","body":"이슈 본문 내용이 충분히 길어야 프리필터를 통과합니다.","html_url":"https://github.com/test/repo/issues/1","labels":[],"user":{"login":"testuser"}},"repository":{"full_name":"test/repo","html_url":"https://github.com/test/repo"}}' \
node dist/index.js
```

---

## 설정 가이드 (`.autoposter.yml`)

### 설정 해상도 (3-tier)

```
.autoposter.yml (소스 레포)  →  config/default.yml (autoposter 레포)  →  Zod 하드코딩 기본값
      프로젝트 오버라이드              중앙 기본 설정                      최종 폴백
```

- 배열은 병합이 아닌 **교체** (예: `skipLabels`를 프로젝트에서 지정하면 기본값 대체)
- 설정 없는 레포는 기본값으로 정상 동작 (하위호환)

### 전체 설정 레퍼런스

| 섹션 | 키 | 타입 | 기본값 | 설명 |
|---|---|---|---|---|
| (root) | `mode` | `per-issue` \| `batch` | `per-issue` | 발행 모드 |
| `trigger` | `on` | `close` \| `label` | `close` | 트리거 이벤트 |
| | `requireLabels` | `string[]` | `[]` | 필수 라벨 (하나라도 있어야 통과) |
| | `ignoreAuthors` | `string[]` | `[]` | 무시할 작성자 |
| `prefilter` | `skipLabels` | `string[]` | `[no-blog, duplicate, invalid, wontfix]` | 이 라벨이 있으면 스킵 |
| | `minBodyLength` | `number` | `30` | 최소 본문 길이 |
| | `skipBots` | `boolean` | `true` | 봇 이슈 자동 스킵 |
| `judge` | `promptMode` | `extend` \| `replace` | `extend` | 프롬프트 모드 |
| | `systemPromptExtra` | `string` | `""` | 시스템 프롬프트 추가/교체 |
| | `additionalCriteria` | `string` | `""` | 추가 판단 기준 |
| `writer` | `promptMode` | `extend` \| `replace` | `extend` | 프롬프트 모드 |
| | `systemPromptExtra` | `string` | `""` | 시스템 프롬프트 추가/교체 |
| | `tone` | `string` | `""` | 글 톤/스타일 |
| | `targetLength` | `string` | `"1000-2000"` | 목표 글자 수 |
| | `language` | `string` | `ko` | 작성 언어 |
| | `structureHint` | `string` | `""` | 글 구조 힌트 |
| `publish` | `categoryId` | `number` | `0` | 티스토리 카테고리 ID |
| | `visibility` | `number` | `3` | 공개 설정 (0: 비공개, 3: 공개) |
| | `tagPrefix` | `string` | `""` | 태그 접두사 |
| | `extraTags` | `string[]` | `[]` | 추가 태그 |
| `batch` | `minIssues` | `number` | `2` | 배치 발행 최소 이슈 수 |
| | `maxIntervalDays` | `number` | `3` | 최대 발행 간격 (일) |
| | `titleTemplate` | `string` | `{repo} 개발일지 - {date}` | 배치 제목 템플릿 |
| | `labels.worthy` | `string` | `blog-적합` | Judge 적합 판정 라벨 |
| | `labels.notWorthy` | `string` | `blog-부적합` | Judge 부적합 판정 라벨 |
| | `labels.published` | `string` | `blog-완료` | 발행 완료 라벨 |

### 예시: cryptobot용 설정

소스 레포 루트에 `.autoposter.yml` 생성:

```yaml
# .autoposter.yml
prefilter:
  skipLabels: [no-blog, duplicate]
  minBodyLength: 50

judge:
  additionalCriteria: |
    - 암호화폐/트레이딩 관련 기술적 내용을 우선시
    - 단순 설정 변경은 스킵

writer:
  tone: "실용적이고 경험 기반, 코드 예시 풍부"
  targetLength: "1500-2500"

publish:
  categoryId: 12
  extraTags: [crypto, trading-bot]
```

---

## 소스 레포 연동

### 1. Caller workflow 설치

`caller-workflow/tistory-dispatch.yml`을 소스 레포의 `.github/workflows/`에 복사합니다.

### 2. 소스 레포 Secret 추가

| Secret | 설명 |
|---|---|
| `AUTOPOSTER_PAT` | `repo` 스코프 PAT (autoposter 레포에 dispatch 전송용) |

### 3. (선택) `.autoposter.yml` 추가

소스 레포 루트에 `.autoposter.yml`을 만들면 프로젝트별 설정이 적용됩니다.
없으면 기본값으로 동작합니다.

---

## 모드

### per-issue
이슈 하나당 블로그 글 하나. 이슈가 닫힐 때마다 파이프라인이 실행됩니다.

### batch
여러 이슈를 묶어서 하나의 개발일지로 발행합니다.

**흐름:**
1. 이슈 close → AI Judge가 판단 → `blog-적합` / `blog-부적합` 라벨 자동 부착
2. `blog-적합` 이슈가 `minIssues`개 이상 쌓이면 → 묶어서 하나의 글 작성
3. 하루 최대 1개 발행 (당일 이미 발행했으면 다음 날 09:00 KST 예약)
4. `maxIntervalDays`일을 넘기면 이슈가 1개라도 강제 발행
5. 발행 완료된 이슈에 `blog-완료` 라벨 + 코멘트 자동 부착

**필요 Secret:** `GITHUB_PAT` (autoposter 레포에 설정, 소스 레포 이슈 접근용)

**상태 추적:** `state/{owner}-{repo}.json`에 마지막 발행 시간이 자동 기록됩니다.

---

## AI 프롬프트 커스터마이징

### promptMode: extend vs replace

| 모드 | 동작 |
|---|---|
| `extend` (기본) | 기본 프롬프트 **뒤에** `systemPromptExtra`를 추가 |
| `replace` | 기본 프롬프트를 `systemPromptExtra`로 **교체** |

### 톤/스타일 예시

```yaml
writer:
  tone: "캐주얼하고 유머러스한 개발 블로그 스타일"
```

```yaml
writer:
  tone: "학술적이고 깊이 있는 기술 분석 스타일"
```

### 판단 기준 커스터마이징

```yaml
judge:
  additionalCriteria: |
    - 인프라/DevOps 관련 이슈는 무조건 포스팅 가치 있음
    - 의존성 업데이트라도 breaking change가 있으면 포스팅
```

---

## 프로젝트 구조

```
tistory-autoposter/
├── .github/workflows/
│   ├── auto-post.yml              # repository_dispatch 트리거
│   └── check-cookies.yml          # 주간 쿠키 유효성 체크
├── config/
│   └── default.yml                # 중앙 기본 설정
├── src/
│   ├── index.ts                   # 오케스트레이터 (per-issue + batch)
│   ├── types.ts                   # 공유 인터페이스
│   ├── config.ts                  # 환경변수 로더 (zod 검증)
│   ├── project-config.ts          # 프로젝트 설정 스키마 + 3-tier 리졸버
│   ├── prompt-builder.ts          # AI 프롬프트 조립기 (단일 + 배치)
│   ├── github.ts                  # 이슈 파서 + 프리필터
│   ├── github-api.ts              # GitHub API 클라이언트 (라벨, 코멘트)
│   ├── state.ts                   # 발행 상태 추적 (마지막 발행 시간)
│   ├── judge.ts                   # AI: 포스팅 여부 판단
│   ├── writer.ts                  # AI: 블로그 글 생성 (단일 + 배치)
│   └── publisher.ts               # 티스토리 발행 (HTTP + Puppeteer + 예약)
├── state/                         # 레포별 발행 상태 (자동 생성)
├── scripts/
│   ├── setup-cookies.ts           # 카카오 로그인 → 쿠키 캡처
│   └── check-cookies.ts           # 쿠키 유효성 검사
├── caller-workflow/
│   └── tistory-dispatch.yml       # 소스 레포에 복사할 워크플로우
└── package.json
```

---

## 트러블슈팅

### 프리필터에서 계속 스킵됨
- 이슈 본문이 30자 미만이면 스킵됩니다 (`prefilter.minBodyLength`)
- `no-blog`, `duplicate`, `invalid`, `wontfix` 라벨이 있으면 스킵됩니다
- 봇이 만든 이슈는 기본적으로 스킵됩니다 (`prefilter.skipBots`)

### 쿠키 만료
- 매주 월요일 `check-cookies` 워크플로우가 자동 체크합니다
- 만료 시 `npm run setup-cookies`로 다시 캡처 → Secret 업데이트

### DRY_RUN에서는 되는데 실제 발행 실패
- 쿠키가 유효한지 확인: `npm run check-cookies`
- `TISTORY_BLOG_NAME`이 정확한지 확인 (URL의 서브도메인)

### 설정이 적용되지 않음
- `.autoposter.yml`이 소스 레포 **루트**에 있는지 확인
- YAML 문법 오류가 없는지 확인 (잘못된 설정은 경고 후 기본값 사용)

---

## 기술 스택

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 + TypeScript |
| AI | Anthropic SDK (`@anthropic-ai/sdk`) |
| 브라우저 | Puppeteer (발행 폴백) |
| 검증 | Zod (환경변수 + 프로젝트 설정 스키마) |
| 설정 | YAML (`yaml` 패키지) + 3-tier 리졸버 |
| 빌드 | tsup |
| CI/CD | GitHub Actions (서버리스) |

---

## 라이선스

MIT License
