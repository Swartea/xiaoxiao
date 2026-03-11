import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { runContinuityCheck } from "@novel-factory/memory";
import { chapterEvaluationSchema, type ChapterEvaluation } from "@novel-factory/storyos-domain";
import { PrismaService } from "../../prisma.service";

function clampScore(value: number) {
  return Math.max(0, Math.min(10, Number(value.toFixed(2))));
}

function avg(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((acc, current) => acc + current, 0) / values.length;
}

function textDensity(text: string) {
  const chars = text.replace(/\s+/g, "");
  return chars.length;
}

function countMatches(text: string, regex: RegExp) {
  return (text.match(regex) ?? []).length;
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

@Injectable()
export class QualityEngine {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private scoreOpeningHook(text: string) {
    const opening = text.slice(0, 420);
    const punctuationSignal = countMatches(opening, /[！？?!]/g);
    const urgencySignal = countMatches(
      opening,
      /(突然|立刻|危机|追杀|失控|异变|不合常理|喝道|呵斥|鞭子|集合|命令|压迫|危险|代价)/g,
    );
    const anomalySignal = countMatches(opening, /(却|但|然而|偏偏|竟|不对|不合常理)/g);
    const actionSignal = countMatches(opening, /(睁开|推开|撞在|冲|盯着|攥紧|发软|脚步|呼吸)/g);
    return clampScore(
      3.8 +
        punctuationSignal * 0.6 +
        urgencySignal * 0.55 +
        anomalySignal * 0.45 +
        Math.min(2, actionSignal * 0.2),
    );
  }

  private scoreConflict(text: string) {
    const chars = Math.max(1, textDensity(text));
    const explicitSignal = countMatches(
      text,
      /(冲突|对峙|威胁|反击|追击|压迫|代价|背叛|失控|呵斥|鞭子|命令|逼视|监视|灭口|失踪|贱卖|审问|试探)/g,
    );
    const dialoguePressure = countMatches(
      text,
      /(明白吗|少说话|迟了|伺候|不该|别想|活得长久|谁敢|盯着他|压低声音)/g,
    );
    const oppositionSignal = countMatches(text, /(不对|不合常理|却|然而|但|风险|后果)/g);
    const density = (explicitSignal * 1.2 + dialoguePressure * 1.5 + oppositionSignal * 0.6) / (chars / 1000);
    return clampScore(3 + Math.min(4.2, density * 0.4) + Math.min(1.2, dialoguePressure * 0.1));
  }

  private scorePacing(text: string) {
    const paragraphs = text.split(/\n+/).map((p) => p.trim()).filter(Boolean);
    if (paragraphs.length === 0) return 3;
    const avgLen = avg(paragraphs.map((p) => p.length));
    if (avgLen > 140) return 5.4;
    if (avgLen < 20) return 5.6;
    return 7.4;
  }

  private dialogueRatio(text: string) {
    const lines = text.split(/\n+/);
    const dialogueChars = lines
      .filter((line) => /[“"「『].+[”"」』]/.test(line) || line.includes("："))
      .reduce((acc, line) => acc + line.length, 0);

    return dialogueChars / Math.max(1, textDensity(text));
  }

  private scoreDialogue(text: string) {
    const ratio = this.dialogueRatio(text);
    if (ratio < 0.12) return 4.8;
    if (ratio > 0.55) return 6.1;
    return 7.8;
  }

  private scoreCharacterVoice(text: string, characterNames: string[]) {
    if (characterNames.length === 0) return 6;
    const mentions = characterNames.filter((name) => text.includes(name)).length;
    const ratio = mentions / characterNames.length;
    return clampScore(4 + ratio * 4.5);
  }

  private scoreSceneVividness(text: string) {
    const signal = countMatches(text, /(目光|呼吸|脚步|掌心|汗|风声|灯光|血|刺痛|冷意|温度)/g);
    return clampScore(4.5 + Math.min(5, signal * 0.22));
  }

  private scoreExpositionControl(text: string) {
    const exposition = countMatches(text, /(其实|原来|曾经|他知道|她知道|设定是|背景是|众所周知)/g);
    const ratio = exposition / Math.max(1, textDensity(text) / 100);
    if (ratio > 1.8) return 4.2;
    if (ratio > 1.2) return 5.6;
    return 7.6;
  }

  private scoreEndingHook(text: string) {
    const ending = text.slice(-220);
    const signal = countMatches(ending, /[？?!！]/g) + countMatches(ending, /(未完|下一刻|然而|就在这时|但他不知道|只差一步)/g);
    return clampScore(4 + signal * 1.35);
  }

  private scorePlatformFit(text: string, stylePreset?: {
    dialogue_ratio_min: number | null;
    dialogue_ratio_max: number | null;
    exposition_limit: number | null;
    opening_hook_required: boolean;
    ending_hook_required: boolean;
  }) {
    if (!stylePreset) {
      return 6.5;
    }

    let score = 7;
    const dialogueRatio = this.dialogueRatio(text);

    if (stylePreset.dialogue_ratio_min !== null && dialogueRatio < stylePreset.dialogue_ratio_min) {
      score -= 1.2;
    }

    if (stylePreset.dialogue_ratio_max !== null && dialogueRatio > stylePreset.dialogue_ratio_max) {
      score -= 1.0;
    }

    if (stylePreset.exposition_limit !== null) {
      const exposition = countMatches(text, /(其实|原来|曾经|背景是|设定是)/g) / Math.max(1, textDensity(text) / 100);
      if (exposition > stylePreset.exposition_limit * 10) {
        score -= 1.1;
      }
    }

    if (stylePreset.opening_hook_required && this.scoreOpeningHook(text) < 6) {
      score -= 1;
    }

    if (stylePreset.ending_hook_required && this.scoreEndingHook(text) < 6) {
      score -= 1;
    }

    return clampScore(score);
  }

  private mapContinuityIssues(issues: Array<{ type: string; message: string }>) {
    const mapped = {
      world_rule_conflict: [] as string[],
      timeline_conflict: [] as string[],
      relationship_conflict: [] as string[],
      character_ooc: [] as string[],
      seed_payoff_miss: [] as string[],
    };

    for (const issue of issues) {
      if (issue.type.includes("glossary") || issue.type.includes("ability")) {
        mapped.world_rule_conflict.push(issue.message);
        continue;
      }
      if (issue.type.includes("time") || issue.type.includes("knowledge")) {
        mapped.timeline_conflict.push(issue.message);
        continue;
      }
      if (issue.type.includes("relationship")) {
        mapped.relationship_conflict.push(issue.message);
        continue;
      }
      if (issue.type.includes("character") || issue.type.includes("ooc")) {
        mapped.character_ooc.push(issue.message);
        continue;
      }
      mapped.seed_payoff_miss.push(issue.message);
    }

    return mapped;
  }

  async evaluateChapter(args: {
    chapterId: string;
    versionId?: string;
    stylePresetName?: string;
    persist?: boolean;
  }): Promise<{
    version_id: string;
    evaluation: ChapterEvaluation;
    quality_report_id?: string;
    continuity_report_id?: string;
  }> {
    const chapter = await this.prisma.chapter.findUnique({ where: { id: args.chapterId } });
    if (!chapter) {
      throw new NotFoundException("Chapter not found");
    }

    const version = args.versionId
      ? await this.prisma.chapterVersion.findFirst({
          where: { id: args.versionId, chapter_id: args.chapterId },
        })
      : await this.prisma.chapterVersion.findFirst({
          where: { chapter_id: args.chapterId },
          orderBy: { version_no: "desc" },
        });

    if (!version) {
      throw new NotFoundException("Chapter version not found");
    }

    const stylePreset = args.stylePresetName
      ? await this.prisma.stylePreset.findFirst({ where: { name: args.stylePresetName } })
      : chapter.project_id
        ? await this.prisma.stylePreset.findFirst({
            where: {
              projects: {
                some: {
                  id: chapter.project_id,
                },
              },
            },
          })
        : null;

    const [glossary, characters, facts] = await Promise.all([
      this.prisma.glossaryTerm.findMany({ where: { project_id: chapter.project_id } }),
      this.prisma.character.findMany({ where: { project_id: chapter.project_id } }),
      this.prisma.fact.findMany({ where: { project_id: chapter.project_id } }),
    ]);

    const openingHook = this.scoreOpeningHook(version.text);
    const conflictStrength = this.scoreConflict(version.text);
    const pacing = this.scorePacing(version.text);
    const dialogueQuality = this.scoreDialogue(version.text);
    const characterVoice = this.scoreCharacterVoice(version.text, characters.map((item) => item.name));
    const sceneVividness = this.scoreSceneVividness(version.text);
    const expositionControl = this.scoreExpositionControl(version.text);
    const endingHook = this.scoreEndingHook(version.text);
    const platformFit = this.scorePlatformFit(version.text, stylePreset ?? undefined);

    const overallScore = clampScore(
      avg([
        openingHook,
        conflictStrength,
        pacing,
        dialogueQuality,
        characterVoice,
        sceneVividness,
        expositionControl,
        endingHook,
        platformFit,
      ]),
    );

    const continuity = runContinuityCheck({
      versionId: version.id,
      textHash: version.text_hash,
      chapterNo: chapter.chapter_no,
      text: version.text,
      glossary: glossary.map((item) => ({ term: item.term, canonical_form: item.canonical_form })),
      characters: characters.map((item) => ({
        id: item.id,
        name: item.name,
        age: item.age,
        abilities: (item.abilities as Record<string, unknown> | null) ?? null,
      })),
      facts: facts.map((item) => ({
        id: item.id,
        content: item.content,
        chapter_no: item.chapter_no,
        known_by_character_ids: item.known_by_character_ids,
      })),
    });

    const continuityMapped = this.mapContinuityIssues(
      continuity.issues.map((issue) => ({ type: issue.type, message: issue.message })),
    );

    const summary =
      overallScore >= 7
        ? "本章质量可发布，建议只做局部精修。"
        : overallScore >= 5.5
          ? "本章可读性尚可，但需加强冲突与钩子力度。"
          : "本章质量偏弱，建议进入定向修复或重生成。";

    const evaluation = chapterEvaluationSchema.parse({
      overall_score: overallScore,
      quality: {
        opening_hook: { score: openingHook, reason: openingHook >= 6 ? "开头冲突有效" : "开头钩子不足" },
        conflict_strength: {
          score: conflictStrength,
          reason: conflictStrength >= 6 ? "冲突推进稳定" : "冲突密度偏低",
        },
        pacing: { score: pacing, reason: pacing >= 6 ? "节奏可控" : "节奏松散或跳跃" },
        dialogue_quality: {
          score: dialogueQuality,
          reason: dialogueQuality >= 6 ? "对白占比合理" : "对白与叙述比例失衡",
        },
        character_voice: {
          score: characterVoice,
          reason: characterVoice >= 6 ? "角色声纹可辨识" : "角色声纹区分不足",
        },
        scene_vividness: {
          score: sceneVividness,
          reason: sceneVividness >= 6 ? "场景细节有支撑" : "场景感不足",
        },
        exposition_control: {
          score: expositionControl,
          reason: expositionControl >= 6 ? "说明性内容控制良好" : "说明性段落偏多",
        },
        ending_hook: {
          score: endingHook,
          reason: endingHook >= 6 ? "结尾有悬念牵引" : "结尾钩子偏软",
        },
        platform_fit: {
          score: platformFit,
          reason: platformFit >= 6 ? "与平台风格匹配" : "平台风格契合度不足",
        },
      },
      continuity: continuityMapped,
      summary,
    });

    if (args.persist === false) {
      return {
        version_id: version.id,
        evaluation,
      };
    }

    const [qualityReport, continuityReport] = await Promise.all([
      this.prisma.qualityReport.create({
        data: {
          project_id: chapter.project_id,
          chapter_id: chapter.id,
          version_id: version.id,
          opening_hook: openingHook,
          conflict_strength: conflictStrength,
          pacing,
          dialogue_quality: dialogueQuality,
          character_voice: characterVoice,
          scene_vividness: sceneVividness,
          exposition_control: expositionControl,
          ending_hook: endingHook,
          platform_fit: platformFit,
          overall_score: overallScore,
          summary,
          report: toJson(evaluation),
        },
      }),
      this.prisma.continuityReport.create({
        data: {
          project_id: chapter.project_id,
          chapter_id: chapter.id,
          version_id: version.id,
          world_rule_conflict: toJson(continuityMapped.world_rule_conflict),
          timeline_conflict: toJson(continuityMapped.timeline_conflict),
          relationship_conflict: toJson(continuityMapped.relationship_conflict),
          character_ooc: toJson(continuityMapped.character_ooc),
          seed_payoff_miss: toJson(continuityMapped.seed_payoff_miss),
          overall_pass: continuity.issues.length === 0,
          report: toJson({
            mapped: continuityMapped,
            raw: continuity,
          }),
        },
      }),
    ]);

    return {
      version_id: version.id,
      evaluation,
      quality_report_id: qualityReport.id,
      continuity_report_id: continuityReport.id,
    };
  }
}
