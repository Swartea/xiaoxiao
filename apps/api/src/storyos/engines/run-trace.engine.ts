import { Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { AgentRunPayload } from "@novel-factory/storyos-domain";
import { agentRunSchema } from "@novel-factory/storyos-domain";
import { PrismaService } from "../../prisma.service";

function toJson(value: unknown): Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue {
  if (value === undefined || value === null) {
    return Prisma.JsonNull;
  }
  return value as Prisma.InputJsonValue;
}

@Injectable()
export class RunTraceEngine {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async logAgentRun(args: AgentRunPayload & {
    version_id?: string;
    input_payload?: Record<string, unknown>;
    output_payload?: Record<string, unknown>;
  }) {
    const payload = agentRunSchema.parse(args);

    return this.prisma.agentRun.create({
      data: {
        run_id: payload.run_id,
        project_id: payload.project_id,
        chapter_id: payload.chapter_id,
        version_id: args.version_id,
        agent_name: payload.agent_name,
        prompt_name: payload.prompt_name,
        prompt_version: payload.prompt_version,
        prompt_template_version_id: payload.prompt_template_version_id,
        platform_variant: payload.platform_variant,
        model: payload.model,
        style_preset: payload.style_preset,
        retriever_strategy: payload.retriever_strategy,
        context_hash: payload.context_hash,
        token_usage: toJson(payload.token_usage),
        quality_score: payload.quality_score,
        input_payload: toJson(args.input_payload),
        output_payload: toJson(args.output_payload),
      },
    });
  }
}
