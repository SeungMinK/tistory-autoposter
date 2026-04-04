import { readFileSync } from "node:fs";
import { parseIssuePayload, prefilter } from "./github.js";
import { judgeIssue } from "./judge.js";
import { writePost, writeBatchPost } from "./writer.js";
import { publish } from "./publisher.js";
import { resolveConfig } from "./project-config.js";
import type { AutoposterConfig } from "./project-config.js";
import { loadConfig } from "./config.js";
import { GitHubClient } from "./github-api.js";
import { loadState, saveState, daysSinceLastPublish, getNextPublishDate } from "./state.js";
import type { IssuePayload, PipelineResult } from "./types.js";

// ── 페이로드 로드 ──

function loadRawPayload(): unknown {
  const eventPath = process.env.GITHUB_EVENT_PATH;

  if (eventPath) {
    console.log(`이벤트 파일 로드: ${eventPath}`);
    const raw = JSON.parse(readFileSync(eventPath, "utf-8"));
    return (raw as Record<string, unknown>).client_payload ?? raw;
  }

  if (process.env.TEST_PAYLOAD) {
    console.log("테스트 페이로드 사용");
    return JSON.parse(process.env.TEST_PAYLOAD);
  }

  throw new Error("GITHUB_EVENT_PATH 또는 TEST_PAYLOAD 환경변수가 필요합니다.");
}

// ── per-issue 파이프라인 ──

async function runPerIssue(
  payload: IssuePayload,
  projectConfig: AutoposterConfig,
): Promise<PipelineResult> {
  // 프리필터
  const filterResult = prefilter(payload, projectConfig.prefilter, projectConfig.trigger);
  if (!filterResult.pass) {
    console.log(`프리필터 스킵: ${filterResult.reason}`);
    return { issueUrl: payload.issue.html_url, skipped: true, skipReason: filterResult.reason };
  }
  console.log("프리필터 통과");

  // Judge
  console.log("Claude Judge 호출 중...");
  const judgeResult = await judgeIssue(payload, projectConfig.judge);
  console.log(`Judge 결과: worthy=${judgeResult.worthy}, reason=${judgeResult.reason}`);

  if (!judgeResult.worthy) {
    return {
      issueUrl: payload.issue.html_url,
      skipped: true,
      skipReason: `Judge: ${judgeResult.reason}`,
      judgeResult,
    };
  }

  // Writer
  console.log("Claude Writer 호출 중...");
  const writerResult = await writePost(payload, judgeResult, projectConfig.writer);
  console.log(`Writer 완료: "${writerResult.title}" (${writerResult.htmlContent.length}자)`);

  // Publisher
  console.log("티스토리 발행 중...");
  const publishResult = await publish(writerResult, projectConfig.publish);

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

// ── batch 파이프라인 ──

async function runBatch(
  payload: IssuePayload,
  projectConfig: AutoposterConfig,
): Promise<PipelineResult> {
  const envConfig = loadConfig();
  const repo = payload.repository.full_name;
  const batchCfg = projectConfig.batch;

  if (!envConfig.GITHUB_PAT) {
    console.error("batch 모드에는 GITHUB_PAT 환경변수가 필요합니다. per-issue 모드로 폴백합니다.");
    return runPerIssue(payload, projectConfig);
  }

  const gh = new GitHubClient(envConfig.GITHUB_PAT);

  // 1. 프리필터
  const filterResult = prefilter(payload, projectConfig.prefilter, projectConfig.trigger);
  if (!filterResult.pass) {
    console.log(`프리필터 스킵: ${filterResult.reason}`);
    return { issueUrl: payload.issue.html_url, skipped: true, skipReason: filterResult.reason };
  }

  // 2. Judge → 라벨 부착
  console.log("Claude Judge 호출 중...");
  const judgeResult = await judgeIssue(payload, projectConfig.judge);
  console.log(`Judge 결과: worthy=${judgeResult.worthy}, reason=${judgeResult.reason}`);

  if (judgeResult.worthy) {
    console.log(`라벨 추가: ${batchCfg.labels.worthy} → #${payload.issue.number}`);
    if (!envConfig.DRY_RUN) {
      await gh.addLabel(repo, payload.issue.number, batchCfg.labels.worthy);
    }
  } else {
    console.log(`라벨 추가: ${batchCfg.labels.notWorthy} → #${payload.issue.number}`);
    if (!envConfig.DRY_RUN) {
      await gh.addLabel(repo, payload.issue.number, batchCfg.labels.notWorthy);
    }
    return {
      issueUrl: payload.issue.html_url,
      skipped: true,
      skipReason: `Judge: ${judgeResult.reason}`,
      judgeResult,
    };
  }

  // 3. blog-적합 이슈 수집
  console.log(`${batchCfg.labels.worthy} 라벨 이슈 조회 중...`);
  let worthyIssues: IssuePayload["issue"][];
  if (envConfig.DRY_RUN) {
    worthyIssues = [payload.issue];
    console.log(`[DRY_RUN] 현재 이슈만 사용: ${worthyIssues.length}개`);
  } else {
    worthyIssues = await gh.getIssuesWithLabel(repo, batchCfg.labels.worthy);
    console.log(`${batchCfg.labels.worthy} 이슈: ${worthyIssues.length}개`);
  }

  // 4. 발행 결정: 충분한 이슈가 있는가? 시간이 됐는가?
  const state = loadState(repo);
  const daysSince = daysSinceLastPublish(state);
  console.log(`마지막 발행으로부터 ${daysSince === Infinity ? "기록 없음" : `${daysSince.toFixed(1)}일`}`);

  const hasEnoughIssues = worthyIssues.length >= batchCfg.minIssues;
  const intervalExpired = daysSince >= batchCfg.maxIntervalDays;
  const hasAnyIssues = worthyIssues.length >= 1;

  const shouldPublish = (hasEnoughIssues && daysSince >= 1) || (intervalExpired && hasAnyIssues);

  if (!shouldPublish) {
    const reason = !hasEnoughIssues
      ? `이슈 부족 (${worthyIssues.length}/${batchCfg.minIssues}), 대기 중`
      : `발행 간격 미달 (${daysSince.toFixed(1)}일), 대기 중`;
    console.log(`배치 발행 보류: ${reason}`);
    return {
      issueUrl: payload.issue.html_url,
      skipped: true,
      skipReason: reason,
      judgeResult,
      batchInfo: {
        issueCount: worthyIssues.length,
        issueNumbers: worthyIssues.map((i) => i.number),
        scheduled: false,
      },
    };
  }

  // 5. 배치 글 작성
  console.log(`Claude Batch Writer 호출 중... (${worthyIssues.length}개 이슈)`);
  const writerResult = await writeBatchPost(
    repo,
    worthyIssues,
    batchCfg.titleTemplate,
    projectConfig.writer,
  );
  console.log(`Batch Writer 완료: "${writerResult.title}" (${writerResult.htmlContent.length}자)`);

  // 6. 발행 시간 결정 (하루 1개 제한)
  const scheduledDate = getNextPublishDate(state);
  if (scheduledDate) {
    console.log(`오늘 이미 발행 기록 있음 → 예약 발행: ${scheduledDate.toISOString()}`);
  }

  // 7. 발행
  console.log("티스토리 발행 중...");
  const publishResult = await publish(writerResult, projectConfig.publish, scheduledDate);

  if (publishResult.success) {
    console.log(`발행 성공 (${publishResult.method}): ${publishResult.url}`);

    // 8. 상태 업데이트
    const publishTime = (scheduledDate ?? new Date()).toISOString();
    saveState(repo, {
      lastPublishAt: scheduledDate ? state.lastPublishAt : publishTime,
      lastScheduledAt: scheduledDate ? publishTime : null,
      publishedIssues: worthyIssues.map((i) => i.number),
    });

    // 9. 이슈 blog-완료 처리
    if (!envConfig.DRY_RUN) {
      console.log(`${worthyIssues.length}개 이슈 blog-완료 처리 중...`);
      await gh.markIssuesPublished(
        repo,
        worthyIssues,
        batchCfg,
        publishResult.url ?? "(발행됨)",
      );
    }
  } else {
    console.error(`발행 실패: ${publishResult.error}`);
  }

  return {
    issueUrl: payload.issue.html_url,
    skipped: false,
    judgeResult,
    writerResult,
    publishResult,
    batchInfo: {
      issueCount: worthyIssues.length,
      issueNumbers: worthyIssues.map((i) => i.number),
      scheduled: !!scheduledDate,
      scheduledDate: scheduledDate?.toISOString(),
    },
  };
}

// ── 메인 ──

async function run(): Promise<PipelineResult> {
  const rawPayload = loadRawPayload();
  const payload = parseIssuePayload(rawPayload);
  console.log(`이슈: ${payload.repository.full_name}#${payload.issue.number} - ${payload.issue.title}`);

  // 설정 리졸브
  const projectConfig = resolveConfig(payload.config);
  console.log(`설정 로드 완료 (mode: ${projectConfig.mode})`);

  if (projectConfig.mode === "batch") {
    return runBatch(payload, projectConfig);
  }

  return runPerIssue(payload, projectConfig);
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
