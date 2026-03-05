import OpenAI from "openai";
import { z } from "zod";

export type GenerateTextArgs<TSchema extends z.ZodTypeAny | undefined = undefined> = {
  system: string;
  user: string;
  schema?: TSchema;
  temperature?: number;
  maxTokens?: number;
  model: string;
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
    const response = await this.client.chat.completions.create({
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
    });

    const text = response.choices[0]?.message?.content ?? "";
    return this.parseStructured(args.schema, text, args.model);
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
