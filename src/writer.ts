import Anthropic from "@anthropic-ai/sdk";
import type { IssuePayload, JudgeResult, WriterResult } from "./types.js";
import { loadConfig } from "./config.js";
import type { WriterConfig } from "./project-config.js";
import {
  buildWriterSystemPrompt,
  buildWriterUserPrompt,
  buildBatchWriterSystemPrompt,
  buildBatchWriterUserPrompt,
} from "./prompt-builder.js";

export async function writePost(
  payload: IssuePayload,
  judgeResult: JudgeResult,
  writerCfg: WriterConfig,
): Promise<WriterResult> {
  const config = loadConfig();
  const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

  const systemPrompt = buildWriterSystemPrompt(writerCfg);
  const userPrompt = buildWriterUserPrompt(payload, judgeResult, writerCfg);

  const response = await client.messages.create({
    model: config.LLM_MODEL,
    max_tokens: 4096,
    system: systemPrompt,
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

/**
 * 여러 이슈를 묶어서 하나의 개발일지 블로그 글을 작성한다.
 */
export async function writeBatchPost(
  repo: string,
  issues: IssuePayload["issue"][],
  titleTemplate: string,
  writerCfg: WriterConfig,
): Promise<WriterResult> {
  const config = loadConfig();
  const client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY });

  const systemPrompt = buildBatchWriterSystemPrompt(writerCfg);
  const userPrompt = buildBatchWriterUserPrompt(repo, issues, titleTemplate, writerCfg);

  const response = await client.messages.create({
    model: config.LLM_MODEL,
    max_tokens: 8192,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Batch Writer 응답에서 JSON을 찾을 수 없음: ${text}`);
  }

  const result = JSON.parse(jsonMatch[0]) as WriterResult;

  if (!result.title || !result.htmlContent) {
    throw new Error("Batch Writer 응답에 title 또는 htmlContent 누락");
  }

  return result;
}
