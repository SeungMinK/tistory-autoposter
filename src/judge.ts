import Anthropic from "@anthropic-ai/sdk";
import type { IssuePayload, JudgeResult } from "./types.js";
import { loadConfig } from "./config.js";
import type { JudgeConfig } from "./project-config.js";
import { buildJudgeSystemPrompt, buildJudgeUserPrompt } from "./prompt-builder.js";

export async function judgeIssue(payload: IssuePayload, judgeCfg: JudgeConfig): Promise<JudgeResult> {
  const config = loadConfig();
  const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

  const systemPrompt = buildJudgeSystemPrompt(judgeCfg);
  const userPrompt = buildJudgeUserPrompt(payload, judgeCfg);

  const response = await client.messages.create({
    model: config.LLM_MODEL,
    max_tokens: 512,
    system: systemPrompt,
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
