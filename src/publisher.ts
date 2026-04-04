import type { TistoryCookie, PublishResult, WriterResult } from "./types.js";
import { loadConfig } from "./config.js";
import type { PublishConfig } from "./project-config.js";

/**
 * Base64로 인코딩된 쿠키 JSON을 파싱한다.
 */
function parseCookies(base64Cookies: string): TistoryCookie[] {
  const json = Buffer.from(base64Cookies, "base64").toString("utf-8");
  return JSON.parse(json) as TistoryCookie[];
}

/**
 * 쿠키 배열을 Cookie 헤더 문자열로 변환한다.
 */
function cookiesToHeader(cookies: TistoryCookie[]): string {
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

/**
 * 태그에 prefix와 extraTags를 적용한다.
 */
function buildTags(post: WriterResult, publishCfg: PublishConfig): string[] {
  let tags = post.tags;
  if (publishCfg.tagPrefix) {
    tags = tags.map((t) => `${publishCfg.tagPrefix}${t}`);
  }
  if (publishCfg.extraTags.length > 0) {
    tags = [...tags, ...publishCfg.extraTags];
  }
  return tags;
}

/**
 * Date를 티스토리 API 형식으로 변환한다 (YYYY-MM-DD HH:mm:ss, KST).
 */
function formatTistoryDate(date: Date): string {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().replace("T", " ").slice(0, 19);
}

/**
 * HTTP POST로 티스토리에 글을 발행한다.
 * scheduledDate가 주어지면 예약 발행.
 */
async function publishViaHttp(
  blogName: string,
  cookies: TistoryCookie[],
  post: WriterResult,
  publishCfg: PublishConfig,
  scheduledDate?: Date,
): Promise<PublishResult> {
  const url = `https://${blogName}.tistory.com/manage/post/write.json`;
  const cookieHeader = cookiesToHeader(cookies);
  const tags = buildTags(post, publishCfg);

  const formData = new URLSearchParams();
  formData.append("title", post.title);
  formData.append("content", post.htmlContent);
  formData.append("category", String(publishCfg.categoryId));
  formData.append("visibility", String(publishCfg.visibility));
  formData.append("acceptComment", "1");
  formData.append("tag", tags.join(","));
  formData.append("editor", "0"); // HTML 에디터

  if (scheduledDate) {
    formData.append("date", formatTistoryDate(scheduledDate));
    console.log(`예약 발행: ${formatTistoryDate(scheduledDate)} KST`);
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Cookie: cookieHeader,
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: `https://${blogName}.tistory.com/manage/newpost`,
    },
    body: formData.toString(),
    redirect: "manual",
  });

  if (response.ok) {
    const data = (await response.json()) as { url?: string; entryId?: number };
    return {
      success: true,
      url: data.url ?? `https://${blogName}.tistory.com/${data.entryId}`,
      method: "http",
    };
  }

  throw new Error(`HTTP 발행 실패: ${response.status} ${response.statusText}`);
}

/**
 * Puppeteer로 티스토리에 글을 발행한다. (HTTP 실패 시 폴백)
 */
async function publishViaPuppeteer(
  blogName: string,
  cookies: TistoryCookie[],
  post: WriterResult,
): Promise<PublishResult> {
  const puppeteer = await import("puppeteer");
  const browser = await puppeteer.default.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();

    // 쿠키 설정
    const puppeteerCookies = cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path ?? "/",
      httpOnly: c.httpOnly ?? false,
      secure: c.secure ?? false,
    }));
    await page.setCookie(...puppeteerCookies);

    // 글쓰기 페이지 이동
    const writeUrl = `https://${blogName}.tistory.com/manage/newpost`;
    await page.goto(writeUrl, { waitUntil: "networkidle2", timeout: 30000 });

    // 제목 입력
    await page.waitForSelector("#post-title-inp", { timeout: 10000 });
    await page.type("#post-title-inp", post.title);

    // HTML 모드 전환 버튼
    const htmlModeBtn = await page.$(".btn-mode-html");
    if (htmlModeBtn) {
      await htmlModeBtn.click();
      await page.waitForTimeout(1000);
    }

    // HTML 내용 입력
    await page.evaluate((html: string) => {
      const editor = document.querySelector(".CodeMirror") as HTMLElement & { CodeMirror?: { setValue: (v: string) => void } };
      if (editor?.CodeMirror) {
        editor.CodeMirror.setValue(html);
      } else {
        const textarea = document.querySelector("#html-editor-textarea") as HTMLTextAreaElement;
        if (textarea) textarea.value = html;
      }
    }, post.htmlContent);

    // 태그 입력
    const tagInput = await page.$("#tagText");
    if (tagInput) {
      await tagInput.type(post.tags.join(","));
      await page.keyboard.press("Enter");
    }

    // 발행 버튼 클릭
    const publishBtn = await page.$(".btn-publish, #publish-layer-btn");
    if (publishBtn) {
      await publishBtn.click();
      await page.waitForTimeout(2000);
    }

    // 최종 발행 확인
    const confirmBtn = await page.$(".btn-publish-submit, #publish-btn");
    if (confirmBtn) {
      await confirmBtn.click();
      await page.waitForNavigation({ timeout: 10000 }).catch(() => {});
    }

    return {
      success: true,
      url: page.url(),
      method: "puppeteer",
    };
  } finally {
    await browser.close();
  }
}

/**
 * 티스토리에 블로그 글을 발행한다.
 * HTTP POST를 먼저 시도하고, 실패 시 Puppeteer로 폴백.
 * scheduledDate가 주어지면 예약 발행.
 */
export async function publish(
  post: WriterResult,
  publishCfg: PublishConfig,
  scheduledDate?: Date | null,
): Promise<PublishResult> {
  const config = loadConfig();

  if (config.DRY_RUN) {
    console.log("[DRY_RUN] 발행 스킵");
    console.log(`[DRY_RUN] 제목: ${post.title}`);
    console.log(`[DRY_RUN] 태그: ${buildTags(post, publishCfg).join(", ")}`);
    console.log(`[DRY_RUN] HTML 길이: ${post.htmlContent.length}자`);
    console.log(`[DRY_RUN] 카테고리: ${publishCfg.categoryId}, 공개: ${publishCfg.visibility}`);
    if (scheduledDate) {
      console.log(`[DRY_RUN] 예약: ${formatTistoryDate(scheduledDate)} KST`);
    }
    return { success: true, method: "http", url: "(dry-run)" };
  }

  const cookies = parseCookies(config.TISTORY_COOKIES);

  // 1차: HTTP POST 시도
  try {
    console.log(scheduledDate ? "HTTP POST로 예약 발행 시도..." : "HTTP POST로 발행 시도...");
    return await publishViaHttp(config.TISTORY_BLOG_NAME, cookies, post, publishCfg, scheduledDate ?? undefined);
  } catch (httpError) {
    console.warn(`HTTP 발행 실패, Puppeteer 폴백: ${httpError}`);
  }

  // 2차: Puppeteer 폴백 (예약 발행은 HTTP에서만 지원)
  if (scheduledDate) {
    console.warn("Puppeteer 폴백은 예약 발행을 지원하지 않습니다. 즉시 발행합니다.");
  }
  try {
    console.log("Puppeteer로 발행 시도...");
    return await publishViaPuppeteer(config.TISTORY_BLOG_NAME, cookies, post);
  } catch (puppeteerError) {
    return {
      success: false,
      method: "puppeteer",
      error: `HTTP와 Puppeteer 모두 실패: ${puppeteerError}`,
    };
  }
}
