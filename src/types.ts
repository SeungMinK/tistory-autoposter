/** GitHub 이슈 이벤트 페이로드 (repository_dispatch로 전달) */
export interface IssuePayload {
  action: "closed" | "labeled";
  issue: {
    number: number;
    title: string;
    body: string;
    html_url: string;
    labels: Array<{ name: string }>;
    user: { login: string };
  };
  repository: {
    full_name: string;
    html_url: string;
  };
}

/** 프리필터 결과 */
export interface PrefilterResult {
  pass: boolean;
  reason?: string;
}

/** Claude Judge 결과 */
export interface JudgeResult {
  worthy: boolean;
  reason: string;
  suggestedTitle?: string;
  suggestedTags?: string[];
}

/** Claude Writer 결과 */
export interface WriterResult {
  title: string;
  htmlContent: string;
  tags: string[];
}

/** 티스토리 발행 결과 */
export interface PublishResult {
  success: boolean;
  url?: string;
  method: "http" | "puppeteer";
  error?: string;
}

/** 파이프라인 전체 결과 */
export interface PipelineResult {
  issueUrl: string;
  skipped: boolean;
  skipReason?: string;
  judgeResult?: JudgeResult;
  writerResult?: WriterResult;
  publishResult?: PublishResult;
}

/** 티스토리 쿠키 */
export interface TistoryCookie {
  name: string;
  value: string;
  domain: string;
  path?: string;
  httpOnly?: boolean;
  secure?: boolean;
}
