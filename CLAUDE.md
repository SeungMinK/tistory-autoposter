# tistory-autoposter

GitHub 이슈 기반 티스토리 자동 포스팅 파이프라인.

## Claude의 역할

이 프로젝트에서 Claude는 **블로그 글 작성 + 발행 도우미**다.

유저가 "글 써줘"라고 하면:
1. `docs/publish-history.md` 읽어서 이미 다룬 이슈 확인
2. `docs/blog-writing-guide.md` 읽어서 말투/스타일 확인
3. 기존 `posts/` 글 1~2개 읽어서 톤 맞추기
4. 소스 레포(예: cryptobot)의 이슈/커밋 분석해서 글감 정리
5. HTML 파일 작성 → `posts/` 저장
6. `docs/tistory-api-notes.md` 참고해서 발행
7. `docs/publish-history.md` 업데이트

### 발행 워크플로우

```bash
# 1. 쿠키 먼저 캡처 (수명 짧으니 매번 해야 함)
npm run setup-cookies
# → 출력된 base64를 .env의 TISTORY_COOKIES에 저장

# 2. 글 발행
npx tsx scripts/publish-post.ts "posts/파일.html" "제목" "태그" "3"

# 3. 예약 발행 (KST)
npx tsx scripts/publish-post.ts "posts/파일.html" "제목" "태그" "3" "2026-04-07 21:00"
```

### 카테고리

카테고리 ID 확인: `npx tsx scripts/get-categories.ts`
카테고리 변경이 필요하면 글 수정 API 사용 (`id: 기존번호`로 재전송).

### 글 번호 규칙

파일명: `posts/NN-제목-슬러그.html` (NN은 시리즈 순번)
`publish-history.md`에 글 ID(티스토리 번호), 제목, 발행일, 다룬 이슈를 기록.

## 프로젝트 구조

- `src/` — 핵심 소스 (TypeScript, tsup 빌드)
- `scripts/` — 수동 발행/쿠키 관리 스크립트
- `config/default.yml` — 3-tier 설정 시스템의 중앙 기본값
- `posts/` — 발행한/발행할 블로그 글 HTML 파일 (gitignore)
- `docs/` — 글쓰기 가이드, API 메모, 발행 이력

## 빌드 & 실행

```bash
npm run build          # tsup 빌드
npm run setup-cookies  # 티스토리 쿠키 캡처 (카카오 로그인)
npm run check-cookies  # 쿠키 유효성 검사
```

## 문서 (docs/)

| 파일 | 내용 | git |
|------|------|-----|
| `blog-writing-guide.md` | 말투, HTML 포맷, 태그 규칙, 글 구조 | O |
| `tistory-api-notes.md` | API 엔드포인트, 쿠키, 에러/해결법 | O |
| `publish-history.md` | 발행 이력, 다룬 이슈, 다음 계획 | X (로컬) |

## 티스토리 API 핵심

- **JSON body** (`Content-Type: application/json`) 필수. form-urlencoded는 500 에러
- 엔드포인트: `POST /manage/post.json`
- 쿠키 수명 짧음 — 발행 전 `npm run setup-cookies`로 재캡처 권장
- 상세: `docs/tistory-api-notes.md` 참고

## 환경변수

`.env` 또는 GitHub Secrets에 설정:

| 변수 | 설명 |
|------|------|
| `TISTORY_BLOG_NAME` | 블로그 서브도메인 (예: `my-blog`) |
| `TISTORY_COOKIES` | Base64 인코딩된 쿠키 JSON |
| `ANTHROPIC_API_KEY` | AI 글 생성용 |
| `SOURCE_REPO_PAT` | batch 모드: 소스 레포 이슈 접근용 PAT |
