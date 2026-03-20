import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma.service";

function toJson(value: unknown): Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue {
  if (value === undefined || value === null) {
    return Prisma.JsonNull;
  }
  return value as Prisma.InputJsonValue;
}

@Injectable()
export class CharacterEngine {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async createCharacterProfile(projectId: string, input: {
    name: string;
    personalityCore?: string;
    values?: string;
    desire?: string;
    fear?: string;
    voiceStyle?: string;
    actionPreference?: string;
    tabooBehaviors?: string[];
    emotionTriggers?: string[];
  }) {
    return this.prisma.character.create({
      data: {
        project_id: projectId,
        name: input.name,
        aliases: [],
        personality: input.personalityCore,
        motivation: input.desire,
        secrets: input.fear,
        personality_tags: input.voiceStyle,
        abilities: toJson({
          values: input.values,
          action_preference: input.actionPreference,
          taboo_behaviors: input.tabooBehaviors ?? [],
          emotion_triggers: input.emotionTriggers ?? [],
        }),
        catchphrases: [],
      },
    });
  }

  async updateCharacterState(characterId: string, state: string) {
    const found = await this.prisma.character.findUnique({ where: { id: characterId } });
    if (!found) {
      throw new NotFoundException("Character not found");
    }
    return this.prisma.character.update({
      where: { id: characterId },
      data: { current_status: state },
    });
  }

  trackCharacterArc(states: Array<{ chapter_no: number; state: string }>) {
    return states.slice().sort((a, b) => a.chapter_no - b.chapter_no);
  }

  enforceCharacterVoice(text: string, profiles: Array<{ name: string; voiceStyle?: string | null }>) {
    const warnings: string[] = [];
    for (const profile of profiles) {
      if (!profile.voiceStyle) continue;
      if (profile.voiceStyle.includes("短促") && text.includes(`${profile.name}：`)) {
        const sample = text.split(`${profile.name}：`).slice(1, 2)[0] ?? "";
        if (sample.length > 60) {
          warnings.push(`${profile.name} 台词偏长，和“短促”设定不一致`);
        }
      }
      if (profile.voiceStyle.includes("反问") && text.includes(`${profile.name}：`) && !text.includes("？")) {
        warnings.push(`${profile.name} 缺少反问句特征`);
      }
    }
    return warnings;
  }

  detectOutOfCharacterBehavior(input: {
    text: string;
    profiles: Array<{ name: string; tabooBehaviors: string[] }>;
  }) {
    const issues: string[] = [];
    for (const profile of input.profiles) {
      for (const taboo of profile.tabooBehaviors) {
        if (taboo && input.text.includes(profile.name) && input.text.includes(taboo)) {
          issues.push(`${profile.name} 触发禁忌行为：${taboo}`);
        }
      }
    }
    return issues;
  }
}
