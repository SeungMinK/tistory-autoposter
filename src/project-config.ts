import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { parse as parseYaml } from "yaml";

// ── Zod 스키마 ──

const triggerSchema = z.object({
  on: z.enum(["close", "label"]).default("close"),
  requireLabels: z.array(z.string()).default([]),
  ignoreAuthors: z.array(z.string()).default([]),
});

const prefilterSchema = z.object({
  skipLabels: z.array(z.string()).default(["no-blog", "duplicate", "invalid", "wontfix"]),
  minBodyLength: z.number().default(30),
  skipBots: z.boolean().default(true),
});

const judgeSchema = z.object({
  promptMode: z.enum(["extend", "replace"]).default("extend"),
  systemPromptExtra: z.string().default(""),
  additionalCriteria: z.string().default(""),
});

const writerSchema = z.object({
  promptMode: z.enum(["extend", "replace"]).default("extend"),
  systemPromptExtra: z.string().default(""),
  tone: z.string().default(""),
  targetLength: z.string().default("1000-2000"),
  language: z.string().default("ko"),
  structureHint: z.string().default(""),
});

const publishSchema = z.object({
  categoryId: z.number().default(0),
  visibility: z.number().default(3),
  tagPrefix: z.string().default(""),
  extraTags: z.array(z.string()).default([]),
});

const batchLabelsSchema = z.object({
  worthy: z.string().default("blog-적합"),
  notWorthy: z.string().default("blog-부적합"),
  published: z.string().default("blog-완료"),
});

const batchSchema = z.object({
  minIssues: z.number().default(2),
  maxIntervalDays: z.number().default(3),
  titleTemplate: z.string().default("{repo} 개발일지 - {date}"),
  labels: batchLabelsSchema.default({}),
});

const autoposterConfigSchema = z.object({
  mode: z.enum(["per-issue", "batch"]).default("per-issue"),
  trigger: triggerSchema.default({}),
  prefilter: prefilterSchema.default({}),
  judge: judgeSchema.default({}),
  writer: writerSchema.default({}),
  publish: publishSchema.default({}),
  batch: batchSchema.default({}),
});

export type AutoposterConfig = z.infer<typeof autoposterConfigSchema>;
export type PrefilterConfig = z.infer<typeof prefilterSchema>;
export type TriggerConfig = z.infer<typeof triggerSchema>;
export type JudgeConfig = z.infer<typeof judgeSchema>;
export type WriterConfig = z.infer<typeof writerSchema>;
export type PublishConfig = z.infer<typeof publishSchema>;
export type BatchConfig = z.infer<typeof batchSchema>;

// ── Deep Merge (배열은 교체) ──

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

function deepMerge<T extends Record<string, unknown>>(base: T, override: Record<string, unknown>): T {
  const result = { ...base } as Record<string, unknown>;

  for (const key of Object.keys(override)) {
    const overrideVal = override[key];
    const baseVal = result[key];

    if (isPlainObject(baseVal) && isPlainObject(overrideVal)) {
      result[key] = deepMerge(baseVal as Record<string, unknown>, overrideVal);
    } else if (overrideVal !== undefined) {
      // 배열 포함 — 교체
      result[key] = overrideVal;
    }
  }

  return result as T;
}

// ── 로더 ──

export function loadDefaultConfig(): Record<string, unknown> {
  const configPath = resolve(import.meta.dirname ?? __dirname, "..", "config", "default.yml");
  try {
    const raw = readFileSync(configPath, "utf-8");
    return (parseYaml(raw) as Record<string, unknown>) ?? {};
  } catch {
    console.warn(`기본 설정 파일을 찾을 수 없음: ${configPath} (Zod 기본값 사용)`);
    return {};
  }
}

export function decodeProjectConfig(base64?: string): Record<string, unknown> {
  if (!base64) return {};
  try {
    const yaml = Buffer.from(base64, "base64").toString("utf-8");
    return (parseYaml(yaml) as Record<string, unknown>) ?? {};
  } catch (err) {
    console.warn(`프로젝트 설정 디코딩 실패 (무시): ${err}`);
    return {};
  }
}

// ── 리졸버 (3-tier) ──

export function resolveConfig(configBase64?: string): AutoposterConfig {
  const defaultYml = loadDefaultConfig();
  const projectYml = decodeProjectConfig(configBase64);

  const merged = deepMerge(defaultYml, projectYml);
  const result = autoposterConfigSchema.safeParse(merged);

  if (!result.success) {
    const errors = result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`설정 검증 실패:\n${errors}`);
  }

  return result.data;
}
