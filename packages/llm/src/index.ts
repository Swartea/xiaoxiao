import OpenAI from "openai";
import { z } from "zod";

export type GenerateTextArgs<TSchema extends z.ZodTypeAny | undefined = undefined> = {
  system: string;
  user: string;
  schema?: TSchema;
  temperature?: number;
  maxTokens?: number;
  model: string;
  timeoutMs?: number;
};

export type GenerateTextResult<TSchema extends z.ZodTypeAny | undefined> = {
  text: string;
  parsed?: TSchema extends z.ZodTypeAny ? z.infer<TSchema> : never;
  model: string;
};

export interface LlmProvider {
  readonly name: string;
  generateText<TSchema extends z.ZodTypeAny | undefined = undefined>(
    args: GenerateTextArgs<TSchema>,
  ): Promise<GenerateTextResult<TSchema>>;
}

type OpenAiCompatibleProviderConfig = {
  apiKey: string;
  baseURL?: string;
  name: "openai" | "deepseek" | "xai";
};

const DEFAULT_LLM_TIMEOUT_MS = 120_000;

function resolveTimeoutMs(input?: number) {
  if (Number.isFinite(input) && (input ?? 0) > 0) {
    return Number(input);
  }

  const fromEnv = Number.parseInt(
    (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.LLM_REQUEST_TIMEOUT_MS ??
      "",
    10,
  );
  if (Number.isFinite(fromEnv) && fromEnv > 0) {
    return fromEnv;
  }

  return DEFAULT_LLM_TIMEOUT_MS;
}

class OpenAiCompatibleChatProvider implements LlmProvider {
  readonly name: "openai" | "deepseek" | "xai";
  private client: OpenAI;

  constructor(config: OpenAiCompatibleProviderConfig) {
    this.name = config.name;
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
  }

  private parseStructured<TSchema extends z.ZodTypeAny | undefined>(
    schema: TSchema,
    text: string,
    model: string,
  ): GenerateTextResult<TSchema> {
    if (!schema) {
      return { text, model } as GenerateTextResult<TSchema>;
    }
    const parsed = schema.parse(JSON.parse(text));
    return { text, parsed, model } as GenerateTextResult<TSchema>;
  }

  async generateText<TSchema extends z.ZodTypeAny | undefined = undefined>(
    args: GenerateTextArgs<TSchema>,
  ): Promise<GenerateTextResult<TSchema>> {
    // deepseek-reasoner does not support temperature; omit it for compatibility.
    const shouldSetTemperature = !args.model.includes("reasoner");
    const timeoutMs = resolveTimeoutMs(args.timeoutMs);
    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), timeoutMs);

    try {
      const response = await this.client.chat.completions.create(
        {
          model: args.model,
          messages: [
            {
              role: "system",
              content: args.system,
            },
            {
              role: "user",
              content: args.user,
            },
          ],
          temperature: shouldSetTemperature ? args.temperature : undefined,
          max_tokens: args.maxTokens,
        },
        {
          signal: abortController.signal,
        },
      );

      const text = response.choices[0]?.message?.content ?? "";
      return this.parseStructured(args.schema, text, args.model);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const aborted =
        (error instanceof Error && error.name === "AbortError") ||
        message.toLowerCase().includes("aborted") ||
        message.toLowerCase().includes("timed out") ||
        message.toLowerCase().includes("timeout");

      if (aborted) {
        throw new Error(`LLM request timed out after ${Math.ceil(timeoutMs / 1000)}s`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

export class OpenAiProvider extends OpenAiCompatibleChatProvider {
  constructor(apiKey: string, baseURL?: string) {
    super({ name: "openai", apiKey, baseURL });
  }
}

export class DeepSeekProvider extends OpenAiCompatibleChatProvider {
  constructor(apiKey: string, baseURL = "https://api.deepseek.com") {
    super({ name: "deepseek", apiKey, baseURL });
  }
}

export class XAiProvider extends OpenAiCompatibleChatProvider {
  constructor(apiKey: string, baseURL = "https://api.x.ai/v1") {
    super({ name: "xai", apiKey, baseURL });
  }
}

export type StageModelConfig = {
  beats: string;
  draft: string;
  polish: string;
  check: string;
  extract: string;
  fix: string;
};
