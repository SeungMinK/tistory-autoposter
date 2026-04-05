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
  const url = `https://${blogName}.tistory.com/manage/post.json`;
  const cookieHeader = cookiesToHeader(cookies);
  const tags = buildTags(post, publishCfg);

  const body: Record<string, string | number> = {
    id: 0,
    title: post.title,
    content: post.htmlContent,
    category: publishCfg.categoryId,
    visibility: publishCfg.visibility,
    acceptComment: 1,
    tag: tags.join(","),
    type: "post",
  };

  if (scheduledDate) {
    // Unix timestamp in seconds for scheduled publishing
    body.published = Math.floor(scheduledDate.getTime() / 1000);
    console.log(`예약 발행: ${formatTistoryDate(scheduledDate)} KST`);
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Cookie: cookieHeader,
      "Content-Type": "application/json",
      Referer: `https://${blogName}.tistory.com/manage/newpost`,
    },
    body: JSON.stringify(body),
    redirect: "manual",
  });

  if (response.ok) {
    const data = (await response.json()) as { entryUrl?: string; url?: string; entryId?: number };
    return {
      success: true,
      url: data.entryUrl ?? data.url ?? `https://${blogName}.tistory.com/${data.entryId}`,
      method: "http",
    };
  }

  throw new Error(`HTTP 발행 실패: ${response.status} ${response.statusText}`);
}

/**
 * Puppeteer로 티스토리에 글을 발행한다. (HTTP 실패 시 폴백)
 * JSON API를 사용하여 직접 HTTP 요청을 발행한다.
 */
async function publishViaPuppeteer(
  blogName: string,
  cookies: TistoryCookie[],
  post: WriterResult,
  publishCfg: PublishConfig,
  scheduledDate?: Date,
): Promise<PublishResult> {
  const url = `https://${blogName}.tistory.com/manage/post.json`;
  const cookieHeader = cookiesToHeader(cookies);
  const tags = buildTags(post, publishCfg);

  const body: Record<string, string | number> = {
    id: 0,
    title: post.title,
    content: post.htmlContent,
    category: publishCfg.categoryId,
    visibility: publishCfg.visibility,
    acceptComment: 1,
    tag: tags.join(","),
    type: "post",
  };

  if (scheduledDate) {
    // Unix timestamp in seconds for scheduled publishing
    body.published = Math.floor(scheduledDate.getTime() / 1000);
    console.log(`예약 발행: ${formatTistoryDate(scheduledDate)} KST`);
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Cookie: cookieHeader,
      "Content-Type": "application/json",
      Referer: `https://${blogName}.tistory.com/manage/newpost`,
    },
    body: JSON.stringify(body),
    redirect: "manual",
  });

  if (response.ok) {
    const data = (await response.json()) as { entryUrl?: string; url?: string; entryId?: number };
    return {
      success: true,
      url: data.entryUrl ?? data.url ?? `https://${blogName}.tistory.com/${data.entryId}`,
      method: "puppeteer",
    };
  }

  throw new Error(`Puppeteer 폴백 발행 실패: ${response.status} ${response.statusText}`);
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

  // 2차: Puppeteer 폴백 (JSON API 사용)
  try {
    console.log(scheduledDate ? "Puppeteer 폴백으로 예약 발행 시도..." : "Puppeteer 폴백으로 발행 시도...");
    return await publishViaPuppeteer(config.TISTORY_BLOG_NAME, cookies, post, publishCfg, scheduledDate ?? undefined);
  } catch (puppeteerError) {
    return {
      success: false,
      method: "puppeteer",
      error: `HTTP와 Puppeteer 모두 실패: ${puppeteerError}`,
    };
  }
}
