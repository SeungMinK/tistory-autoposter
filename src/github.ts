import type { IssuePayload, PrefilterResult } from "./types.js";
import type { PrefilterConfig, TriggerConfig } from "./project-config.js";

/**
 * repository_dispatch의 client_payload에서 이슈 페이로드를 파싱한다.
 * GitHub Actions 환경에서 GITHUB_EVENT_PATH를 읽거나, 직접 전달받은 payload를 사용한다.
 */
export function parseIssuePayload(rawPayload: unknown): IssuePayload & { config?: string } {
  const payload = rawPayload as Record<string, unknown>;

  // repository_dispatch는 client_payload 아래에 데이터가 있음
  const clientPayload = (payload.client_payload ?? payload) as Record<string, unknown>;

  const issue = clientPayload.issue as IssuePayload["issue"];
  const repository = clientPayload.repository as IssuePayload["repository"];
  const action = (clientPayload.action as string) ?? "closed";
  const config = clientPayload.config as string | undefined;

  if (!issue?.title || !repository?.full_name) {
    throw new Error("유효하지 않은 이슈 페이로드: issue 또는 repository 누락");
  }

  return { action: action as IssuePayload["action"], issue, repository, config };
}

/**
 * 블로그 포스팅 전 빠른 필터링.
 * Claude API 호출 없이 명확한 스킵 케이스를 걸러낸다.
 */
export function prefilter(
  payload: IssuePayload,
  prefilterCfg: PrefilterConfig,
  triggerCfg: TriggerConfig,
): PrefilterResult {
  const { issue } = payload;

  // requireLabels 체크: 지정된 라벨 중 하나라도 있어야 통과
  if (triggerCfg.requireLabels.length > 0) {
    const hasRequired = issue.labels.some((l) => triggerCfg.requireLabels.includes(l.name));
    if (!hasRequired) {
      return { pass: false, reason: `필수 라벨 없음: ${triggerCfg.requireLabels.join(", ")}` };
    }
  }

  // ignoreAuthors 체크
  if (triggerCfg.ignoreAuthors.includes(issue.user.login)) {
    return { pass: false, reason: `무시 작성자: ${issue.user.login}` };
  }

  // 스킵 라벨 체크
  const skipLabel = issue.labels.find((l) => prefilterCfg.skipLabels.includes(l.name));
  if (skipLabel) {
    return { pass: false, reason: `스킵 라벨: ${skipLabel.name}` };
  }

  // 본문 길이 체크
  const bodyLength = (issue.body ?? "").trim().length;
  if (bodyLength < prefilterCfg.minBodyLength) {
    return { pass: false, reason: `본문 너무 짧음 (${bodyLength}자 < ${prefilterCfg.minBodyLength}자)` };
  }

  // 봇 이슈 스킵
  if (prefilterCfg.skipBots) {
    if (issue.user.login.endsWith("[bot]") || issue.user.login === "dependabot") {
      return { pass: false, reason: `봇 이슈: ${issue.user.login}` };
    }
  }

  return { pass: true };
}
