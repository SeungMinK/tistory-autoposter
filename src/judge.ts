import Anthropic from "@anthropic-ai/sdk";
import type { IssuePayload, JudgeResult } from "./types.js";
import { loadConfig } from "./config.js";

const SYSTEM_PROMPT = `당신은 기술 블로그 편집자입니다.
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

const USER_PROMPT_TEMPLATE = `다음 GitHub 이슈를 블로그 포스팅으로 작성할 가치가 있는지 판단해주세요.

**레포지토리**: {repo}
**이슈 제목**: {title}
**라벨**: {labels}
**이슈 본문**:
{body}

다음 JSON 형식으로 응답하세요:
{
  "worthy": true/false,
  "reason": "판단 이유 (한국어, 1-2문장)",
  "suggestedTitle": "블로그 제목 제안 (worthy=true일 때만)",
  "suggestedTags": ["태그1", "태그2"] // worthy=true일 때만
}`;

export async function judgeIssue(payload: IssuePayload): Promise<JudgeResult> {
  const config = loadConfig();
  const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

  const userPrompt = USER_PROMPT_TEMPLATE.replace("{repo}", payload.repository.full_name)
    .replace("{title}", payload.issue.title)
    .replace("{labels}", payload.issue.labels.map((l) => l.name).join(", ") || "없음")
    .replace("{body}", payload.issue.body || "(본문 없음)");

  const response = await client.messages.create({
    model: config.LLM_MODEL,
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";

  // JSON 파싱 (코드블록 감싸기 처리)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Judge 응답에서 JSON을 찾을 수 없음: ${text}`);
  }

  const result = JSON.parse(jsonMatch[0]) as JudgeResult;
  return result;
}
