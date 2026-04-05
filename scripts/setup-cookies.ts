/**
 * 로컬 1회 실행: 카카오 로그인 → 티스토리 쿠키 캡처 → Base64 출력
 *
 * 사용법:
 *   npm run setup-cookies
 *
 * 브라우저가 열리면 카카오 계정으로 로그인하세요.
 * 로그인 완료 후 자동으로 쿠키를 캡처하고 Base64로 출력합니다.
 * 출력된 값을 GitHub Secret `TISTORY_COOKIES`에 저장하세요.
 */

import puppeteer from "puppeteer";

const BLOG_NAME = process.env.TISTORY_BLOG_NAME;
if (!BLOG_NAME) { console.error("TISTORY_BLOG_NAME 환경변수를 설정하세요."); process.exit(1); }
const LOGIN_URL = `https://${BLOG_NAME}.tistory.com/manage`;
const TIMEOUT_MS = 120_000; // 2분 (수동 로그인 대기)

async function main() {
  console.log("브라우저를 열고 티스토리 로그인 페이지로 이동합니다...");
  console.log("카카오 계정으로 로그인해주세요.\n");

  const browser = await puppeteer.launch({
    headless: false, // 사용자가 직접 로그인해야 하므로 headful 모드
    defaultViewport: { width: 1280, height: 800 },
  });

  const page = await browser.newPage();
  await page.goto(LOGIN_URL, { waitUntil: "networkidle2" });

  // 로그인 완료 대기 (manage 페이지에 도달하면 완료)
  console.log("로그인 대기 중... (최대 2분)");

  try {
    await page.waitForFunction(
      (blogName: string) => window.location.hostname === `${blogName}.tistory.com` && window.location.pathname.includes("/manage"),
      { timeout: TIMEOUT_MS },
      BLOG_NAME
    );
  } catch {
    console.error("타임아웃: 로그인을 완료하지 못했습니다.");
    await browser.close();
    process.exit(1);
  }

  console.log("로그인 성공! 쿠키 캡처 중...");

  // 쿠키 캡처
  const cookies = await page.cookies();
  const relevantCookies = cookies.filter(
    (c) => c.domain.includes("tistory.com") || c.domain.includes("kakao")
  );

  const cookieJson = JSON.stringify(
    relevantCookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      httpOnly: c.httpOnly,
      secure: c.secure,
    }))
  );

  const base64 = Buffer.from(cookieJson).toString("base64");

  console.log("\n=== GitHub Secret에 저장할 값 (TISTORY_COOKIES) ===\n");
  console.log(base64);
  console.log("\n=== 끝 ===\n");
  console.log(`쿠키 ${relevantCookies.length}개 캡처 완료.`);

  await browser.close();
}

main().catch((error) => {
  console.error("에러:", error);
  process.exit(1);
});
