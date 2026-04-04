# tistory-autoposter

GitHub 이슈가 close/라벨링되면 AI가 블로그 포스팅 여부를 판단하고, 자동으로 티스토리에 글을 발행합니다.

## 동작 흐름

```
소스 레포 이슈 Close/Label
  ↓ (caller workflow → repository_dispatch)
tistory-autoposter GitHub Actions 트리거
  ↓
1. 프리필터: 본문 30자 미만, 'no-blog' 라벨 등 스킵
2. AI Judge: 블로그에 올릴만한 이슈인지 판단
3. AI Writer: 한국어 블로그 글 생성 (HTML)
4. Publisher: 티스토리에 발행 (HTTP → Puppeteer 폴백)
```

## 설정

### 1. 이 레포의 GitHub Secrets

| Secret | 설명 |
|--------|------|
| `ANTHROPIC_API_KEY` | Anthropic API 키 |
| `TISTORY_COOKIES` | Base64 인코딩된 쿠키 JSON |
| `TISTORY_BLOG_NAME` | 블로그 이름 (예: `seung-min`) |

### 2. 소스 레포(cryptobot 등)의 GitHub Secrets

| Secret | 설명 |
|--------|------|
| `AUTOPOSTER_PAT` | `repo` 스코프 PAT (이 레포에 dispatch 이벤트 전송용) |

### 3. 소스 레포에 caller workflow 추가

`caller-workflow/tistory-dispatch.yml`을 소스 레포의 `.github/workflows/`에 복사합니다.

### 4. 모델 변경 (선택)

기본 모델은 `claude-haiku-4-5`입니다. 환경변수 `LLM_MODEL`로 변경 가능합니다.

```bash
LLM_MODEL=claude-sonnet-4-5  # 더 높은 품질이 필요할 때
```

## 쿠키 설정

```bash
# 1. 로컬에서 카카오 로그인 → 쿠키 캡처
npm run setup-cookies

# 2. 출력된 Base64 문자열을 GitHub Secret TISTORY_COOKIES에 저장
```

쿠키는 매주 월요일 자동으로 유효성 검사됩니다.

## 로컬 테스트

```bash
npm install
npm run build

# DRY_RUN 모드 (실제 발행 없이 로그만 출력)
ANTHROPIC_API_KEY=sk-ant-... \
TISTORY_COOKIES=... \
TISTORY_BLOG_NAME=seung-min \
DRY_RUN=true \
TEST_PAYLOAD='{"action":"closed","issue":{"number":1,"title":"테스트 이슈","body":"이슈 본문 내용이 충분히 길어야 프리필터를 통과합니다.","html_url":"https://github.com/test/repo/issues/1","labels":[],"user":{"login":"testuser"}},"repository":{"full_name":"test/repo","html_url":"https://github.com/test/repo"}}' \
node dist/index.js
```

## 기술 스택

- Node.js 20 + TypeScript
- `@anthropic-ai/sdk` (AI 판단 및 글 생성)
- Puppeteer (티스토리 발행 폴백)
- GitHub Actions (서버리스 실행)
- tsup (빌드)
- zod (환경변수 검증)
