import { z } from "zod";

const configSchema = z.object({
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required"),
  LLM_MODEL: z.string().default("claude-haiku-4-5"),
  TISTORY_COOKIES: z.string().min(1, "TISTORY_COOKIES is required"),
  TISTORY_BLOG_NAME: z.string().min(1, "TISTORY_BLOG_NAME is required"),
  DRY_RUN: z
    .string()
    .optional()
    .transform((v) => v === "true"),
});

export type Config = z.infer<typeof configSchema>;

let cachedConfig: Config | null = null;

export function loadConfig(): Config {
  if (cachedConfig) return cachedConfig;

  const result = configSchema.safeParse(process.env);
  if (!result.success) {
    const errors = result.error.issues.map((i) => `  - ${i.path}: ${i.message}`).join("\n");
    throw new Error(`환경변수 검증 실패:\n${errors}`);
  }

  cachedConfig = result.data;
  return cachedConfig;
}
