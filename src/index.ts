import { readFileSync } from "node:fs";
import { parseIssuePayload, prefilter } from "./github.js";
import { judgeIssue } from "./judge.js";
import { writePost } from "./writer.js";
import { publish } from "./publisher.js";
import type { PipelineResult } from "./types.js";

/**
 * 메인 파이프라인: 이슈 → 프리필터 → Judge → Writer → Publisher
 */
async function run(): Promise<PipelineResult> {
  // 1. 페이로드 로드
  const eventPath = process.env.GITHUB_EVENT_PATH;
  let rawPayload: unknown;

  if (eventPath) {
    console.log(`이벤트 파일 로드: ${eventPath}`);
    rawPayload = JSON.parse(readFileSync(eventPath, "utf-8"));
    // repository_dispatch의 client_payload 추출
    rawPayload = (rawPayload as Record<string, unknown>).client_payload ?? rawPayload;
  } else if (process.env.TEST_PAYLOAD) {
    console.log("테스트 페이로드 사용");
    rawPayload = JSON.parse(process.env.TEST_PAYLOAD);
  } else {
    throw new Error("GITHUB_EVENT_PATH 또는 TEST_PAYLOAD 환경변수가 필요합니다.");
  }

  const payload = parseIssuePayload(rawPayload);
  console.log(`이슈: ${payload.repository.full_name}#${payload.issue.number} - ${payload.issue.title}`);

  // 2. 프리필터
  const filterResult = prefilter(payload);
  if (!filterResult.pass) {
    console.log(`프리필터 스킵: ${filterResult.reason}`);
    return {
      issueUrl: payload.issue.html_url,
      skipped: true,
      skipReason: filterResult.reason,
    };
  }
  console.log("프리필터 통과");

  // 3. Claude Judge
  console.log("Claude Judge 호출 중...");
  const judgeResult = await judgeIssue(payload);
  console.log(`Judge 결과: worthy=${judgeResult.worthy}, reason=${judgeResult.reason}`);

  if (!judgeResult.worthy) {
    return {
      issueUrl: payload.issue.html_url,
      skipped: true,
      skipReason: `Judge: ${judgeResult.reason}`,
      judgeResult,
    };
  }

  // 4. Claude Writer
  console.log("Claude Writer 호출 중...");
  const writerResult = await writePost(payload, judgeResult);
  console.log(`Writer 완료: "${writerResult.title}" (${writerResult.htmlContent.length}자)`);

  // 5. Publisher
  console.log("티스토리 발행 중...");
  const publishResult = await publish(writerResult);

  if (publishResult.success) {
    console.log(`발행 성공 (${publishResult.method}): ${publishResult.url}`);
  } else {
    console.error(`발행 실패: ${publishResult.error}`);
  }

  return {
    issueUrl: payload.issue.html_url,
    skipped: false,
    judgeResult,
    writerResult,
    publishResult,
  };
}

// 실행
run()
  .then((result) => {
    console.log("\n=== 파이프라인 결과 ===");
    console.log(JSON.stringify(result, null, 2));

    if (result.publishResult && !result.publishResult.success) {
      process.exit(1);
    }
  })
  .catch((error) => {
    console.error("파이프라인 에러:", error);
    process.exit(1);
  });
