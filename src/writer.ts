import Anthropic from "@anthropic-ai/sdk";
import type { IssuePayload, JudgeResult, WriterResult } from "./types.js";
import { loadConfig } from "./config.js";

const SYSTEM_PROMPT = `당신은 한국어 기술 블로그 작가입니다.
GitHub 이슈 정보를 바탕으로 티스토리에 발행할 블로그 글을 작성합니다.

작성 규칙:
1. 한국어로 작성
2. HTML 형식으로 출력 (티스토리 HTML 에디터 호환)
3. 구조: 도입 → 문제/배경 → 해결 과정 → 결과/회고
4. 코드 블록은 <pre><code class="language-xxx"> 사용
5. 너무 길지 않게 (1000~2000자 내외)
6. 개발자 독자를 대상으로 기술적이면서도 읽기 쉽게
7. GitHub 이슈 링크를 본문 끝에 참조로 포함

반드시 JSON으로만 응답하세요.`;

const USER_PROMPT_TEMPLATE = `다음 GitHub 이슈를 바탕으로 기술 블로그 글을 작성해주세요.

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

export async function writePost(payload: IssuePayload, judgeResult: JudgeResult): Promise<WriterResult> {
  const config = loadConfig();
  const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

  const userPrompt = USER_PROMPT_TEMPLATE.replace("{repo}", payload.repository.full_name)
    .replace("{title}", payload.issue.title)
    .replace("{labels}", payload.issue.labels.map((l) => l.name).join(", ") || "없음")
    .replace("{url}", payload.issue.html_url)
    .replace("{suggestedTitle}", judgeResult.suggestedTitle ?? payload.issue.title)
    .replace("{suggestedTags}", (judgeResult.suggestedTags ?? []).join(", "))
    .replace("{body}", payload.issue.body || "(본문 없음)");

  const response = await client.messages.create({
    model: config.LLM_MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Writer 응답에서 JSON을 찾을 수 없음: ${text}`);
  }

  const result = JSON.parse(jsonMatch[0]) as WriterResult;

  if (!result.title || !result.htmlContent) {
    throw new Error("Writer 응답에 title 또는 htmlContent 누락");
  }

  return result;
}
