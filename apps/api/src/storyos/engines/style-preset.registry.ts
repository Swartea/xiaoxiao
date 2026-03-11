import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma.service";

type PresetSeed = {
  name: string;
  target_platform: string;
  sentence_length: "short" | "medium";
  paragraph_density: "low" | "medium" | "high";
  dialogue_ratio_min: number;
  dialogue_ratio_max: number;
  exposition_limit: number;
  opening_hook_required: boolean;
  ending_hook_required: boolean;
  taboo_rules: string[];
  favored_devices: string[];
  pacing_profile: "fast" | "balanced" | "slow-burn";
  tone: string;
  pacing: string;
};

const PRESET_SEEDS: PresetSeed[] = [
  {
    name: "webnovel",
    target_platform: "webnovel",
    sentence_length: "medium",
    paragraph_density: "medium",
    dialogue_ratio_min: 0.25,
    dialogue_ratio_max: 0.4,
    exposition_limit: 0.2,
    opening_hook_required: true,
    ending_hook_required: true,
    taboo_rules: ["禁止开头 300 字纯背景说明", "禁止连续三段心理活动", "禁止结尾软收"],
    favored_devices: ["先抛异常后补解释", "对白中埋信息", "用动作显化情绪"],
    pacing_profile: "balanced",
    tone: "长线连载",
    pacing: "balanced",
  },
  {
    name: "toutiao-fiction",
    target_platform: "toutiao-fiction",
    sentence_length: "short",
    paragraph_density: "high",
    dialogue_ratio_min: 0.3,
    dialogue_ratio_max: 0.5,
    exposition_limit: 0.16,
    opening_hook_required: true,
    ending_hook_required: true,
    taboo_rules: ["禁止解释性对白", "禁止开篇慢热", "禁止全员口吻统一"],
    favored_devices: ["小反转推动场景", "章节末留半步悬念", "前 200 字冲突入场"],
    pacing_profile: "fast",
    tone: "信息密度高",
    pacing: "fast",
  },
  {
    name: "short-drama",
    target_platform: "short-drama",
    sentence_length: "short",
    paragraph_density: "high",
    dialogue_ratio_min: 0.35,
    dialogue_ratio_max: 0.6,
    exposition_limit: 0.12,
    opening_hook_required: true,
    ending_hook_required: true,
    taboo_rules: ["禁止平铺直叙", "禁止无冲突场景", "禁止结尾无下一幕期待"],
    favored_devices: ["高冲突开场", "冲突-反转-再冲突", "对白直给信息"],
    pacing_profile: "fast",
    tone: "镜头驱动",
    pacing: "fast",
  },
];

@Injectable()
export class StylePresetRegistry {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async ensureSeeds() {
    for (const preset of PRESET_SEEDS) {
      const found = await this.prisma.stylePreset.findFirst({ where: { name: preset.name } });
      if (found) continue;

      await this.prisma.stylePreset.create({
        data: {
          ...preset,
          is_system: true,
          dialogue_ratio: (preset.dialogue_ratio_min + preset.dialogue_ratio_max) / 2,
          banned_words: [],
          preferred_words: [],
          constraints: {},
        },
      });
    }
  }

  listPresets() {
    return this.prisma.stylePreset.findMany({ orderBy: [{ is_system: "desc" }, { name: "asc" }] });
  }
}
