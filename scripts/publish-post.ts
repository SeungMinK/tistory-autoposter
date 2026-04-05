/**
 * 글 발행 스크립트 — JSON API 방식
 *
 * 사용법:
 *   npx tsx scripts/publish-post.ts <html파일> <제목> <태그> [visibility] [예약시간]
 *
 * visibility: 0=비공개, 3=공개 (기본 3)
 * 예약시간: "YYYY-MM-DD HH:mm" KST (생략시 즉시 발행)
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import puppeteer from "puppeteer";

// .env 수동 로드
function loadEnv() {
  const envPath = resolve(import.meta.dirname ?? __dirname, "../.env");
  if (!existsSync(envPath)) return;
  const lines = readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnv();

async function getCookieHeader(blogName: string, cookies: { name: string; value: string; domain: string; path?: string }[]): Promise<string> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    );
    await page.setCookie(
      ...cookies.map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path ?? "/",
      })),
    );

    await page.goto(`https://${blogName}.tistory.com/manage`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await new Promise((r) => setTimeout(r, 2000));

    const currentUrl = page.url();
    console.log(`   현재 URL: ${currentUrl}`);
    if (currentUrl.includes("auth/login") || currentUrl.includes("accounts.kakao")) {
      throw new Error("쿠키 만료 — npm run setup-cookies 로 재캡처 필요");
    }

    const allCookies = await page.cookies();
    return allCookies.map((c) => `${c.name}=${c.value}`).join("; ");
  } finally {
    await browser.close();
  }
}

async function publishPost(
  htmlFile: string,
  title: string,
  tags: string,
  visibility = "3",
  scheduledDate?: string,
) {
  const blogName = process.env.TISTORY_BLOG_NAME;
  const cookiesRaw = process.env.TISTORY_COOKIES;

  if (!blogName || !cookiesRaw) {
    console.error("❌ TISTORY_BLOG_NAME 또는 TISTORY_COOKIES 환경변수가 없습니다.");
    return null;
  }

  const cookies = JSON.parse(Buffer.from(cookiesRaw, "base64").toString());
  const htmlContent = readFileSync(htmlFile, "utf-8");

  console.log(`\n📝 "${title}"`);
  console.log(`   HTML: ${htmlContent.length}자 / 공개: ${visibility === "3" ? "즉시공개" : "비공개"}`);
  if (scheduledDate) console.log(`   예약: ${scheduledDate} KST`);

  // Puppeteer로 세션 쿠키 확보
  console.log("   세션 쿠키 확보 중...");
  const cookieHeader = await getCookieHeader(blogName, cookies);

  // JSON API 호출
  console.log("   API 호출 중...");

  const body: Record<string, unknown> = {
    id: 0,
    title,
    content: htmlContent,
    visibility: parseInt(visibility, 10),
    category: 0,
    tag: tags,
    acceptComment: 1,
    type: "post",
  };

  // 예약 발행: "YYYY-MM-DD HH:mm" KST → Unix timestamp (seconds)
  if (scheduledDate) {
    // KST → UTC (KST = UTC+9)
    const kstDate = new Date(scheduledDate.replace(" ", "T") + ":00+09:00");
    const unixTimestamp = Math.floor(kstDate.getTime() / 1000);
    body.published = unixTimestamp;
    console.log(`   예약 timestamp: ${unixTimestamp} (${kstDate.toISOString()})`);
  }

  const baseUrl = `https://${blogName}.tistory.com`;

  const res = await fetch(`${baseUrl}/manage/post.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
      Cookie: cookieHeader,
      Referer: `${baseUrl}/manage/newpost`,
      Origin: baseUrl,
    },
    body: JSON.stringify(body),
  });

  const status = res.status;
  const responseBody = await res.text();

  console.log(`   API 응답: ${status}`);

  if (status === 200) {
    try {
      const data = JSON.parse(responseBody);
      if (data.error) {
        console.log(`   ❌ API 오류: ${JSON.stringify(data.error)}`);
        return null;
      }
      const url = data.entryUrl || data.data?.entryUrl || `${baseUrl}/${data.entryId || data.data?.entryId}`;
      console.log(`   ✅ 발행 성공: ${url}`);
      return url;
    } catch {
      console.log(`   응답: ${responseBody.substring(0, 300)}`);
      return responseBody.includes("entryUrl") ? "success" : null;
    }
  } else {
    console.log(`   ❌ 실패 (${status}): ${responseBody.substring(0, 300)}`);
    return null;
  }
}

// -- CLI --
const args = process.argv.slice(2);
if (args.length < 3) {
  console.error(
    "사용법: npx tsx scripts/publish-post.ts <html파일> <제목> <태그> [visibility] [예약시간]",
  );
  process.exit(1);
}

publishPost(args[0], args[1], args[2], args[3] || "3", args[4]).then((url) => {
  if (!url) process.exit(1);
});
