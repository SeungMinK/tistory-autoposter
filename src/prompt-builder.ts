import type { IssuePayload, JudgeResult } from "./types.js";
import type { JudgeConfig, WriterConfig } from "./project-config.js";

// ── Judge 기본 프롬프트 ──

const JUDGE_SYSTEM_DEFAULT = `당신은 기술 블로그 편집자입니다.
GitHub 이슈 정보를 보고, 이 이슈가 기술 블로그 포스팅으로 작성할 만한 가치가 있는지 판단합니다.

판단 기준:
- 기술적 깊이: 구현 세부사항, 아키텍처 결정, 트레이드오프 분석이 있는가?
- 학습 가치: 다른 개발자가 읽고 배울 수 있는 내용인가?
- 완결성: 문제 정의 → 해결 과정이 명확한가?

포스팅하기 적합하지 않은 경우:
- 단순 버그 수정 (오타, 린트 에러 등)
- 의존성 업데이트
- 문서 수정만 있는 경우
- 내부 리팩토링으로 외부에 공유할 가치가 낮은 경우

반드시 JSON으로만 응답하세요.`;

const JUDGE_USER_TEMPLATE = `다음 GitHub 이슈를 블로그 포스팅으로 작성할 가치가 있는지 판단해주세요.

**레포지토리**: {repo}
**이슈 제목**: {title}
**라벨**: {labels}
**이슈 본문**:
{body}

{additionalCriteria}다음 JSON 형식으로 응답하세요:
{
  "worthy": true/false,
  "reason": "판단 이유 (한국어, 1-2문장)",
  "suggestedTitle": "블로그 제목 제안 (worthy=true일 때만)",
  "suggestedTags": ["태그1", "태그2"] // worthy=true일 때만
}`;

// ── Writer 기본 프롬프트 ──

const WRITER_SYSTEM_DEFAULT = `당신은 {language} 기술 블로그 작가입니다.
GitHub 이슈 정보를 바탕으로 티스토리에 발행할 블로그 글을 작성합니다.

작성 규칙:
1. {language}로 작성
2. HTML 형식으로 출력 (티스토리 HTML 에디터 호환)
3. 구조: 도입 → 문제/배경 → 해결 과정 → 결과/회고
4. 코드 블록은 <pre><code class="language-xxx"> 사용
5. 너무 길지 않게 ({targetLength}자 내외)
6. 개발자 독자를 대상으로 기술적이면서도 읽기 쉽게
7. GitHub 이슈 링크를 본문 끝에 참조로 포함
{toneDirective}{structureDirective}
반드시 JSON으로만 응답하세요.`;

const WRITER_USER_TEMPLATE = `다음 GitHub 이슈를 바탕으로 기술 블로그 글을 작성해주세요.

**레포지토리**: {repo}
**이슈 제목**: {title}
**라벨**: {labels}
**이슈 URL**: {url}
**제안된 블로그 제목**: {suggestedTitle}
**제안된 태그**: {suggestedTags}

**이슈 본문**:
{body}

다음 JSON 형식으로 응답하세요:
{
  "title": "블로그 글 제목",
  "htmlContent": "<h2>...</h2><p>...</p>...",
  "tags": ["태그1", "태그2", "태그3"]
}`;

// ── 빌더 함수 ──

function langLabel(code: string): string {
  const map: Record<string, string> = { ko: "한국어", en: "English", ja: "日本語" };
  return map[code] ?? code;
}

export function buildJudgeSystemPrompt(cfg: JudgeConfig): string {
  if (cfg.promptMode === "replace" && cfg.systemPromptExtra) {
    return cfg.systemPromptExtra;
  }
  const base = JUDGE_SYSTEM_DEFAULT;
  if (cfg.systemPromptExtra) {
    return `${base}\n\n${cfg.systemPromptExtra}`;
  }
  return base;
}

export function buildJudgeUserPrompt(payload: IssuePayload, cfg: JudgeConfig): string {
  const criteria = cfg.additionalCriteria ? `추가 판단 기준:\n${cfg.additionalCriteria}\n\n` : "";

  return JUDGE_USER_TEMPLATE.replace("{repo}", payload.repository.full_name)
    .replace("{title}", payload.issue.title)
    .replace("{labels}", payload.issue.labels.map((l) => l.name).join(", ") || "없음")
    .replace("{body}", payload.issue.body || "(본문 없음)")
    .replace("{additionalCriteria}", criteria);
}

export function buildWriterSystemPrompt(cfg: WriterConfig): string {
  if (cfg.promptMode === "replace" && cfg.systemPromptExtra) {
    return cfg.systemPromptExtra;
  }

  const lang = langLabel(cfg.language);
  const toneDirective = cfg.tone ? `\n8. 톤/스타일: ${cfg.tone}` : "";
  const structureDirective = cfg.structureHint ? `\n9. 글 구조 힌트: ${cfg.structureHint}` : "";

  const base = WRITER_SYSTEM_DEFAULT.replace(/\{language\}/g, lang)
    .replace("{targetLength}", cfg.targetLength)
    .replace("{toneDirective}", toneDirective)
    .replace("{structureDirective}", structureDirective);

  if (cfg.systemPromptExtra) {
    return `${base}\n\n${cfg.systemPromptExtra}`;
  }
  return base;
}

export function buildWriterUserPrompt(
  payload: IssuePayload,
  judgeResult: JudgeResult,
  _cfg: WriterConfig,
): string {
  return WRITER_USER_TEMPLATE.replace("{repo}", payload.repository.full_name)
    .replace("{title}", payload.issue.title)
    .replace("{labels}", payload.issue.labels.map((l) => l.name).join(", ") || "없음")
    .replace("{url}", payload.issue.html_url)
    .replace("{suggestedTitle}", judgeResult.suggestedTitle ?? payload.issue.title)
    .replace("{suggestedTags}", (judgeResult.suggestedTags ?? []).join(", "))
    .replace("{body}", payload.issue.body || "(본문 없음)");
}

// ── Batch Writer 프롬프트 ──

const BATCH_WRITER_SYSTEM_DEFAULT = `당신은 {language} 기술 블로그 작가입니다.
여러 GitHub 이슈를 묶어서 하나의 개발일지 블로그 글을 작성합니다.

작성 규칙:
1. {language}로 작성
2. HTML 형식으로 출력 (티스토리 HTML 에디터 호환)
3. 여러 이슈를 하나의 자연스러운 글로 엮어 작성 — 단순 나열이 아닌, 전체 맥락을 연결
4. 코드 블록은 <pre><code class="language-xxx"> 사용
5. 목표 분량: {targetLength}자 내외
6. 개발자 독자를 대상으로 기술적이면서도 읽기 쉽게
7. 본문 끝에 참조 이슈 링크 목록 포함
{toneDirective}{structureDirective}
반드시 JSON으로만 응답하세요.`;

const BATCH_WRITER_USER_TEMPLATE = `다음 GitHub 이슈들을 묶어서 하나의 기술 블로그 개발일지를 작성해주세요.

**레포지토리**: {repo}
**블로그 제목 형식**: {titleTemplate}

{issueList}

다음 JSON 형식으로 응답하세요:
{
  "title": "블로그 글 제목",
  "htmlContent": "<h2>...</h2><p>...</p>...",
  "tags": ["태그1", "태그2", "태그3"]
}`;

export function buildBatchWriterSystemPrompt(cfg: WriterConfig): string {
  if (cfg.promptMode === "replace" && cfg.systemPromptExtra) {
    return cfg.systemPromptExtra;
  }

  const lang = langLabel(cfg.language);
  const toneDirective = cfg.tone ? `\n8. 톤/스타일: ${cfg.tone}` : "";
  const structureDirective = cfg.structureHint ? `\n9. 글 구조 힌트: ${cfg.structureHint}` : "";

  const base = BATCH_WRITER_SYSTEM_DEFAULT.replace(/\{language\}/g, lang)
    .replace("{targetLength}", cfg.targetLength)
    .replace("{toneDirective}", toneDirective)
    .replace("{structureDirective}", structureDirective);

  if (cfg.systemPromptExtra) {
    return `${base}\n\n${cfg.systemPromptExtra}`;
  }
  return base;
}

export function buildBatchWriterUserPrompt(
  repo: string,
  issues: IssuePayload["issue"][],
  titleTemplate: string,
  _cfg: WriterConfig,
): string {
  const issueList = issues
    .map(
      (issue, i) =>
        `### 이슈 ${i + 1}: #${issue.number} — ${issue.title}\n**URL**: ${issue.html_url}\n**라벨**: ${issue.labels.map((l) => l.name).join(", ") || "없음"}\n**본문**:\n${issue.body || "(본문 없음)"}\n`,
    )
    .join("\n---\n\n");

  const dateStr = new Date().toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Seoul",
  });
  const title = titleTemplate.replace("{repo}", repo.split("/")[1] ?? repo).replace("{date}", dateStr);

  return BATCH_WRITER_USER_TEMPLATE.replace("{repo}", repo)
    .replace("{titleTemplate}", title)
    .replace("{issueList}", issueList);
}
