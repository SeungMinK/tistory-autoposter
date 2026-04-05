# 티스토리 API 메모

## 핵심: JSON API

티스토리 내부 API는 **`Content-Type: application/json`** 으로 JSON body를 보내야 작동한다.
`application/x-www-form-urlencoded`로 보내면 **500 에러** ("일시적인 문제로 처리할 수 없습니다") 발생.

이건 공식 문서에 없는 내용이다. form-urlencoded로 삽질하지 말 것.

### 글 발행/수정

```
POST https://{blogName}.tistory.com/manage/post.json
Content-Type: application/json
X-Requested-With: XMLHttpRequest
Cookie: (세션 쿠키 4개)
Referer: https://{blogName}.tistory.com/manage/newpost
Origin: https://{blogName}.tistory.com
```

**Body (새 글):**
```json
{
  "id": 0,
  "title": "글 제목",
  "content": "<p>HTML 본문</p>",
  "visibility": 3,
  "category": 0,
  "tag": "태그1,태그2",
  "acceptComment": 1,
  "type": "post"
}
```

- `id: 0` → 새 글 생성
- `id: 기존번호` → 글 수정 (카테고리 변경, 내용 수정 등)
- `visibility`: 0=비공개, 3=공개
- `category`: 카테고리 ID (숫자). 0이면 미분류. 관리 페이지에서 확인.

**예약 발행:**
```json
{
  "published": 1775563200
}
```
- Unix timestamp (초 단위)
- KST → UTC 변환 필요: `Math.floor(new Date("2026-04-07T21:00:00+09:00").getTime() / 1000)`

**응답 (성공):**
```json
{"entryUrl": "https://{blogName}.tistory.com/123"}
```

### 카테고리 조회

```
GET https://{blogName}.tistory.com/manage/category.json
X-Requested-With: XMLHttpRequest
Cookie: (세션 쿠키)
```

응답에 `categories` 배열로 id, name 등 반환.

### 블로그 정보 추출

`/manage` 페이지 인라인 스크립트에서 `blogId` 추출 가능:

```javascript
// page.evaluate에서
const scripts = document.querySelectorAll("script:not([src])");
// "blogId":"1234567" 패턴 매칭
```

## 쿠키/세션

### 필요한 쿠키

| 쿠키 | 출처 |
|------|------|
| `_T_ANO` | 카카오 로그인 시 발급 |
| `TSSESSION` | 카카오 로그인 시 발급 |
| `__T_` | `/manage` 페이지 방문 시 생성 |
| `__T_SECURE` | `/manage` 페이지 방문 시 생성 |

- 카카오 로그인으로 얻는 쿠키 2개(`_T_ANO`, `TSSESSION`)를 base64로 저장
- Puppeteer로 `/manage` 방문하면 나머지 2개 자동 생성
- API 호출 시 **4개 모두** Cookie 헤더에 포함해야 함

### 쿠키 수명

**짧다.** 수십 분~수 시간 내 만료될 수 있음.
만료 시 `/manage` 접근하면 `www.tistory.com/auth/login`으로 리다이렉트.

```bash
# 재캡처
npm run setup-cookies
# 브라우저 열림 → 카카오 로그인 → base64 문자열 출력
# .env의 TISTORY_COOKIES 업데이트
```

### 발행 워크플로우

1. `setup-cookies`로 쿠키 캡처 → `.env` 저장
2. `publish-post.ts` 실행 → Puppeteer가 `/manage` 방문 → 쿠키 4개 확보 → Node.js fetch로 API 호출
3. 쿠키 만료 시 다시 1번부터

## 안 되는 것들

| 시도 | 결과 |
|------|------|
| `POST /manage/post.json` + form-urlencoded | 500 에러 |
| `POST /manage/post/write.json` | 405 (엔드포인트 없음) |
| `POST /manage/newpost/save.json` | 405 |
| `POST /manage/entry/post.json` | 405 |
| `POST /manage/post/delete.json` | 405 (삭제 API 못 찾음) |
| `POST /manage/category/add.json` | 권한 없음 |
| Puppeteer `page.evaluate(fetch(...))` on newpost | 무한 hang (페이지 너무 무거움) |
| Puppeteer CodeMirror `setValue()` | 값 설정되지만 화면에 안 보임 (hidden editor) |

## 발행 스크립트 사용법

```bash
# 즉시 발행 (공개)
npx tsx scripts/publish-post.ts "posts/파일.html" "제목" "태그1,태그2" "3"

# 예약 발행 (KST)
npx tsx scripts/publish-post.ts "posts/파일.html" "제목" "태그" "3" "2026-04-07 21:00"

# 비공개 발행
npx tsx scripts/publish-post.ts "posts/파일.html" "제목" "태그" "0"
```

### 카테고리 변경

`scripts/update-category.ts` — 내부에 포스트 목록 하드코딩.
글 수정 API(`id: 기존번호`)로 같은 내용 + 다른 카테고리로 재전송하는 방식.
