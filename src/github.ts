import type { IssuePayload, PrefilterResult } from "./types.js";

const MIN_BODY_LENGTH = 30;
const SKIP_LABELS = ["no-blog", "duplicate", "invalid", "wontfix"];

/**
 * repository_dispatch의 client_payload에서 이슈 페이로드를 파싱한다.
 * GitHub Actions 환경에서 GITHUB_EVENT_PATH를 읽거나, 직접 전달받은 payload를 사용한다.
 */
export function parseIssuePayload(rawPayload: unknown): IssuePayload {
  const payload = rawPayload as Record<string, unknown>;

  // repository_dispatch는 client_payload 아래에 데이터가 있음
  const clientPayload = (payload.client_payload ?? payload) as Record<string, unknown>;

  const issue = clientPayload.issue as IssuePayload["issue"];
  const repository = clientPayload.repository as IssuePayload["repository"];
  const action = (clientPayload.action as string) ?? "closed";

  if (!issue?.title || !repository?.full_name) {
    throw new Error("유효하지 않은 이슈 페이로드: issue 또는 repository 누락");
  }

  return { action: action as IssuePayload["action"], issue, repository };
}

/**
 * 블로그 포스팅 전 빠른 필터링.
 * Claude API 호출 없이 명확한 스킵 케이스를 걸러낸다.
 */
export function prefilter(payload: IssuePayload): PrefilterResult {
  const { issue } = payload;

  // 스킵 라벨 체크
  const skipLabel = issue.labels.find((l) => SKIP_LABELS.includes(l.name));
  if (skipLabel) {
    return { pass: false, reason: `스킵 라벨: ${skipLabel.name}` };
  }

  // 본문 길이 체크
  const bodyLength = (issue.body ?? "").trim().length;
  if (bodyLength < MIN_BODY_LENGTH) {
    return { pass: false, reason: `본문 너무 짧음 (${bodyLength}자 < ${MIN_BODY_LENGTH}자)` };
  }

  // 봇 이슈 스킵
  if (issue.user.login.endsWith("[bot]") || issue.user.login === "dependabot") {
    return { pass: false, reason: `봇 이슈: ${issue.user.login}` };
  }

  return { pass: true };
}
