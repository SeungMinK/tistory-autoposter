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

## 주요 기능

| 기능 | 설명 |
|---|---|
| **AI 판단** | 이슈 내용을 분석해 블로그에 올릴 가치가 있는지 자동 판단 |
| **AI 작성** | 한국어 기술 블로그 글을 HTML로 자동 생성 |
| **자동 발행** | 티스토리에 HTTP POST로 발행 (실패 시 Puppeteer 폴백) |
| **프리필터** | 봇 이슈, 짧은 본문, 스킵 라벨 등을 AI 호출 없이 빠르게 걸러냄 |
| **크로스 레포** | 여러 레포에서 하나의 autoposter로 dispatch — 설정 1번이면 끝 |
| **쿠키 관리** | 로컬 1회 캡처 + 주간 자동 유효성 체크 |
| **DRY_RUN** | 실제 발행 없이 전체 파이프라인 테스트 가능 |

---

## 아키텍처

```
소스 레포 (cryptobot 등)
│  이슈 Close / 'blog-worthy' 라벨
│
▼  repository_dispatch
┌─ tistory-autoposter (GitHub Actions) ─────────────┐
│                                                    │
│  1. Prefilter    본문 길이, 라벨, 봇 체크           │
│       ↓ pass                                       │
│  2. AI Judge     포스팅 가치 판단 (worthy/skip)     │
│       ↓ worthy                                     │
│  3. AI Writer    한국어 HTML 블로그 글 생성          │
│       ↓                                            │
│  4. Publisher    티스토리 발행                       │
│       HTTP POST (우선) → Puppeteer (폴백)          │
│                                                    │
└────────────────────────────────────────────────────┘
       ↓
  티스토리 블로그 글 발행 완료
```

---

## 빠른 시작

### 사전 요구사항

- Node.js 20+
- Anthropic API Key
- 티스토리 블로그 (카카오 로그인)

### 설치

```bash
git clone https://github.com/SeungMinK/tistory-autoposter.git
cd tistory-autoposter
npm install
npm run build
```

### 환경변수 설정

```bash
cp .env.example .env
```

필수:
```env
ANTHROPIC_API_KEY=sk-ant-xxx     # Anthropic API
TISTORY_COOKIES=base64...        # 아래 쿠키 설정 참조
TISTORY_BLOG_NAME=seung-min      # 블로그 이름
```

선택:
```env
LLM_MODEL=claude-haiku-4-5       # 기본값; 다른 모델로 변경 가능
DRY_RUN=true                     # 발행 없이 로그만 출력
```

### 쿠키 캡처 (최초 1회)

```bash
npm run setup-cookies
# 브라우저가 열리면 카카오 계정으로 로그인
# 출력된 Base64 문자열 → GitHub Secret TISTORY_COOKIES에 저장
```

### 로컬 테스트

```bash
DRY_RUN=true \
TEST_PAYLOAD='{"action":"closed","issue":{"number":1,"title":"테스트 이슈","body":"이슈 본문 내용이 충분히 길어야 프리필터를 통과합니다.","html_url":"https://github.com/test/repo/issues/1","labels":[],"user":{"login":"testuser"}},"repository":{"full_name":"test/repo","html_url":"https://github.com/test/repo"}}' \
node dist/index.js
```

---

## GitHub 설정

### 1. 이 레포의 Secrets

| Secret | 설명 |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API 키 |
| `TISTORY_COOKIES` | Base64 인코딩된 쿠키 JSON |
| `TISTORY_BLOG_NAME` | 블로그 이름 |

선택 (Repository Variables):

| Variable | 설명 |
|---|---|
| `LLM_MODEL` | AI 모델 (기본: `claude-haiku-4-5`) |

### 2. 소스 레포에 caller workflow 추가

`caller-workflow/tistory-dispatch.yml`을 소스 레포의 `.github/workflows/`에 복사하고, 소스 레포에 아래 Secret 추가:

| Secret | 설명 |
|---|---|
| `AUTOPOSTER_PAT` | `repo` 스코프 PAT (이 레포에 dispatch 전송용) |

---

## 프로젝트 구조

```
tistory-autoposter/
├── .github/workflows/
│   ├── auto-post.yml              # repository_dispatch 트리거
│   └── check-cookies.yml          # 주간 쿠키 유효성 체크
├── src/
│   ├── index.ts                   # 오케스트레이터
│   ├── types.ts                   # 공유 인터페이스
│   ├── config.ts                  # 환경변수 로더 (zod 검증)
│   ├── github.ts                  # 이슈 파서 + 프리필터
│   ├── judge.ts                   # AI: 포스팅 여부 판단
│   ├── writer.ts                  # AI: 블로그 글 생성
│   └── publisher.ts               # 티스토리 발행 (HTTP + Puppeteer)
├── scripts/
│   ├── setup-cookies.ts           # 카카오 로그인 → 쿠키 캡처
│   └── check-cookies.ts           # 쿠키 유효성 검사
├── caller-workflow/
│   └── tistory-dispatch.yml       # 소스 레포에 복사할 워크플로우
└── package.json
```

---

## 기술 스택

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 + TypeScript |
| AI | Anthropic SDK (`@anthropic-ai/sdk`) |
| 브라우저 | Puppeteer (발행 폴백) |
| 검증 | zod (환경변수 스키마) |
| 빌드 | tsup |
| CI/CD | GitHub Actions (서버리스) |

---

## 라이선스

MIT License
