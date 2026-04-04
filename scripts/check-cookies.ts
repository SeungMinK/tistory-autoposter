/**
 * 쿠키 유효성 검사.
 * TISTORY_COOKIES 환경변수의 쿠키로 티스토리 관리 페이지에 접근 가능한지 확인.
 *
 * 사용법:
 *   npm run check-cookies
 *   또는 GitHub Actions cron에서 실행
 */

const BLOG_NAME = process.env.TISTORY_BLOG_NAME ?? "seung-min";

async function main() {
  const cookiesBase64 = process.env.TISTORY_COOKIES;
  if (!cookiesBase64) {
    console.error("TISTORY_COOKIES 환경변수가 설정되지 않았습니다.");
    process.exit(1);
  }

  let cookies: Array<{ name: string; value: string }>;
  try {
    const json = Buffer.from(cookiesBase64, "base64").toString("utf-8");
    cookies = JSON.parse(json);
  } catch {
    console.error("쿠키 파싱 실패: 올바른 Base64 JSON인지 확인하세요.");
    process.exit(1);
  }

  console.log(`쿠키 ${cookies.length}개 로드됨`);

  // 티스토리 관리 페이지에 요청
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const url = `https://${BLOG_NAME}.tistory.com/manage`;

  const response = await fetch(url, {
    headers: { Cookie: cookieHeader },
    redirect: "manual",
  });

  // 리다이렉트 없이 200이면 쿠키 유효
  if (response.status === 200) {
    console.log("쿠키 유효: 관리 페이지 접근 성공");
    process.exit(0);
  }

  // 302 리다이렉트면 로그인 페이지로 돌려보내는 것 → 만료
  if (response.status === 302 || response.status === 301) {
    const location = response.headers.get("location") ?? "";
    console.error(`쿠키 만료: 리다이렉트 → ${location}`);
    console.error("scripts/setup-cookies.ts를 다시 실행하여 쿠키를 갱신하세요.");
    process.exit(1);
  }

  console.error(`예상치 못한 응답: ${response.status} ${response.statusText}`);
  process.exit(1);
}

main().catch((error) => {
  console.error("에러:", error);
  process.exit(1);
});
