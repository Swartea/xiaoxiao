import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ExtractedStatus, Prisma } from "@prisma/client";
import { runContinuityCheck } from "@novel-factory/memory";
import { chapterEvaluationSchema, type ChapterEvaluation } from "@novel-factory/storyos-domain";
import { PrismaService } from "../../prisma.service";
import { mapContinuityIssuesForEvaluation } from "../continuity-evaluation";

const DIALOGUE_QUOTE_REGEX = /[“"「『]([^”"」』]{1,120})[”"」』]/g;
const SENSORY_DETAIL_REGEX =
  /(目光|呼吸|脚步|掌心|汗|风声|灯光|血|刺痛|冷意|温度|雨水|火光|气味|衣角|门轴|泥水|潮气|脉搏|眩光|回声|震动|谷壳|米气|霉味|灯笼|灯影|麻袋|木门|木轴|谷粒|囤壁|封泥|砖棱|火把|油烟|仓灰|土腥气|漆味|酸臭)/g;
const ACTION_DETAIL_REGEX =
  /(攥|推|撞|掀|压|拖|拔|捂|踉跄|逼近|盯|退后|扑|跪|侧身|咬紧|撑住|抬手|扯开|按住|甩开|拽住|抹去|抬眼|掂|抹|量|合上|翻开|扫|窜|碾|挤|扑上|钻进|伏住|缩在|压低|拎起|带上|挡住|顶住|拍上|掼|擦过)/g;
const EXPOSITION_MARKER_REGEX = /(其实|原来|曾经|意味着|说明|代表|设定是|背景是|众所周知|归根结底|说到底|总之|重要的是|本质上|换句话说)/g;
const ABSTRACT_LABEL_REGEX = /(命运|危机|压迫|阴影|情绪|心绪|复杂|意味|主题|本质|局势|局面|氛围|感觉|感受)/g;
const DIALOGUE_EXPOSITION_REGEX = /(其实|因为|所以|换句话说|总之|你要知道|你应该明白|这意味着|重要的是|本质上)/;
const AI_CONNECTOR_REGEX = /(然而|与此同时|此时此刻|某种程度上|显而易见|不可否认|不禁|深吸一口气|倒吸一口凉气|嘴角勾起一抹弧度)/g;
const SYMMETRY_REGEX = /(既[^，。；]{1,14}又[^，。；]{1,14}|不是[^，。；]{1,14}而是[^，。；]{1,14}|一边[^，。；]{1,14}一边[^，。；]{1,14}|越[^，。；]{1,14}越[^，。；]{1,14}|不再[^，。；]{1,14}而是[^，。；]{1,14})/g;
const MENTAL_LABEL_REGEX = /(他心想|她心想|心里想着|心中一动|他知道|她知道|他意识到|她意识到|他明白|她明白)/g;
const EMOTION_LABEL_REGEX = /(愤怒|震惊|恐惧|悲伤|绝望|紧张|欣喜|复杂|羞辱|尴尬|惊慌)/g;
const ATTRIBUTE_CHAIN_REGEX = /(?:[^\s，。；！？]{1,8}的){2,}[^\s，。；！？]{1,8}/g;
const MODIFIER_STACK_REGEX = /(仿佛|宛如|骤然|蓦地|极其|非常|无比|格外|分外|越发|愈发|一点点|轻轻地|慢慢地|冷冷地|狠狠地|重重地)/g;

type ParagraphSpan = {
  index: number;
  text: string;
  from: number;
  to: number;
  sentenceCount: number;
};

type StylePresetLite = {
  name: string;
  target_platform: string | null;
  sentence_length: string | null;
  paragraph_density: string | null;
  dialogue_ratio_min: number | null;
  dialogue_ratio_max: number | null;
  exposition_limit: number | null;
  opening_hook_required: boolean;
  ending_hook_required: boolean;
  banned_words: string[];
};

type DimensionDetail = {
  score: number;
  reason: string;
  evidence: string[];
  focusSpan?: { from: number; to: number };
};

function clampScore(value: number) {
  return Math.max(0, Math.min(10, Number(value.toFixed(2))));
}

function avg(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((acc, current) => acc + current, 0) / values.length;
}

function stddev(values: number[]) {
  if (values.length <= 1) return 0;
  const mean = avg(values);
  return Math.sqrt(avg(values.map((value) => (value - mean) ** 2)));
}

function textDensity(text: string) {
  return text.replace(/\s+/g, "").length;
}

function countMatches(text: string, regex: RegExp) {
  return (text.match(regex) ?? []).length;
}

function termCount(text: string, term: string) {
  if (!term) return 0;
  let count = 0;
  let from = 0;
  while (from < text.length) {
    const idx = text.indexOf(term, from);
    if (idx < 0) break;
    count += 1;
    from = idx + term.length;
  }
  return count;
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function compactSnippet(text: string, max = 38) {
  const normalized = text.replace(/\s+/g, "").trim();
  if (normalized.length <= max) {
    return normalized;
  }
  return `${normalized.slice(0, max)}...`;
}

function severityByScore(score: number) {
  if (score < 4.5) return "high" as const;
  if (score < 6) return "medium" as const;
  return "low" as const;
}

@Injectable()
export class QualityEngine {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private splitParagraphs(text: string): ParagraphSpan[] {
    const rawParagraphs = text
      .split(/\n+/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean);

    const spans: ParagraphSpan[] = [];
    let cursor = 0;

    for (const paragraph of rawParagraphs) {
      const from = text.indexOf(paragraph, cursor);
      const safeFrom = from >= 0 ? from : cursor;
      const to = safeFrom + paragraph.length;
      cursor = to;
      spans.push({
        index: spans.length,
        text: paragraph,
        from: safeFrom,
        to,
        sentenceCount: Math.max(1, paragraph.split(/[。！？!?；;]/).map((item) => item.trim()).filter(Boolean).length),
      });
    }

    return spans;
  }

  private splitSentences(text: string) {
    return text
      .split(/[。！？!?；;\n]+/)
      .map((sentence) => sentence.trim())
      .filter(Boolean);
  }

  private dialogueRatio(text: string) {
    const lines = text.split(/\n+/);
    const dialogueChars = lines
      .filter((line) => /[“"「『].+[”"」』]/.test(line) || line.includes("："))
      .reduce((acc, line) => acc + line.length, 0);

    return dialogueChars / Math.max(1, textDensity(text));
  }

  private resolveStylePreset(args: { stylePresetName?: string; projectId: string; stylePresetId?: string | null; targetPlatform?: string | null }) {
    if (args.stylePresetName) {
      return this.prisma.stylePreset.findFirst({ where: { name: args.stylePresetName } });
    }

    if (args.stylePresetId) {
      return this.prisma.stylePreset.findUnique({ where: { id: args.stylePresetId } });
    }

    if (args.targetPlatform) {
      return this.prisma.stylePreset.findFirst({
        where: {
          OR: [{ name: args.targetPlatform }, { target_platform: args.targetPlatform }],
        },
        orderBy: [{ is_system: "desc" }, { name: "asc" }],
      });
    }

    return Promise.resolve(null);
  }

  private resolveSceneIndexForSpan(sceneList: unknown, span?: { from: number; to: number }) {
    if (!span || !Array.isArray(sceneList)) {
      return undefined;
    }

    const scene = sceneList.find((item) => {
      if (!item || typeof item !== "object") return false;
      const anchor = (item as { anchor_span?: { from?: number; to?: number } }).anchor_span;
      return typeof anchor?.from === "number" && typeof anchor?.to === "number" && span.from >= anchor.from && span.to <= anchor.to;
    }) as { scene_index?: number } | undefined;

    return typeof scene?.scene_index === "number" ? scene.scene_index : undefined;
  }

  private scoreOpeningHook(text: string) {
    const opening = text.slice(0, 420);
    const punctuationSignal = countMatches(opening, /[！？?!]/g);
    const urgencySignal = countMatches(
      opening,
      /(突然|立刻|危机|追杀|失控|异变|不合常理|喝道|呵斥|鞭子|集合|命令|压迫|危险|代价|关门|拔刀|封住|围住|见血|逼近|灭口|空仓)/g,
    );
    const anomalySignal = countMatches(opening, /(却|但|然而|偏偏|竟|不对|不合常理|太空了|没有该有的|门外有人)/g);
    const actionSignal = countMatches(opening, /(睁开|推开|撞在|冲|盯着|攥紧|发软|脚步|呼吸|合上|摸到|翻开|逼近|落笔|拔出)/g);
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
      /(冲突|对峙|威胁|反击|追击|压迫|代价|背叛|失控|呵斥|鞭子|命令|逼视|监视|灭口|失踪|贱卖|审问|试探|关门|拔刀|围住|堵死|逼签|看守|追赶|认尸|断手|点火|弩)/g,
    );
    const dialoguePressure = countMatches(
      text,
      /(明白吗|少说话|迟了|伺候|不该|别想|活得长久|谁敢|盯着他|压低声音|快点|关门|签|别出来|只数到三|断一只手|认账|认尸)/g,
    );
    const oppositionSignal = countMatches(text, /(不对|不合常理|却|然而|但|风险|后果|否则|要么|还是)/g);
    const density = (explicitSignal * 1.2 + dialoguePressure * 1.5 + oppositionSignal * 0.6) / (chars / 1000);
    return clampScore(3 + Math.min(4.2, density * 0.4) + Math.min(1.2, dialoguePressure * 0.1));
  }

  private scorePacing(text: string, paragraphs: ParagraphSpan[], stylePreset?: StylePresetLite | null) {
    if (paragraphs.length === 0) return 3;
    const avgLen = avg(paragraphs.map((paragraph) => paragraph.text.length));
    const sentenceCounts = paragraphs.map((paragraph) => paragraph.sentenceCount);
    const explanatoryParagraphs = paragraphs.filter((paragraph) => countMatches(paragraph.text, EXPOSITION_MARKER_REGEX) >= 2).length;
    let score = 7.4;

    if (avgLen > 180) score -= 1.6;
    else if (avgLen > 140) score -= 0.9;
    else if (avgLen < 20) score -= 1.4;

    if (stddev(sentenceCounts) < 0.9) {
      score -= 0.7;
    }

    if (stylePreset?.paragraph_density === "high" && avgLen > 110) {
      score -= 0.8;
    }
    if (stylePreset?.paragraph_density === "low" && avgLen < 35) {
      score -= 0.5;
    }

    score -= Math.min(1.1, explanatoryParagraphs * 0.18);
    return clampScore(score);
  }

  private scoreCharacterVoice(text: string, characterNames: string[]) {
    if (characterNames.length === 0) return 6;
    const mentions = characterNames.filter((name) => text.includes(name)).length;
    const ratio = mentions / characterNames.length;
    return clampScore(4 + ratio * 4.5);
  }

  private scoreSceneVividness(text: string, paragraphs: ParagraphSpan[], stylePreset?: StylePresetLite | null): DimensionDetail {
    const chars = Math.max(1, textDensity(text));
    const sensorySignal = countMatches(text, SENSORY_DETAIL_REGEX);
    const actionSignal = countMatches(text, ACTION_DETAIL_REGEX);
    const abstractSignal = countMatches(text, ABSTRACT_LABEL_REGEX);
    const vividParagraphs = paragraphs.filter((paragraph) => {
      const strength = countMatches(paragraph.text, SENSORY_DETAIL_REGEX) + countMatches(paragraph.text, ACTION_DETAIL_REGEX);
      return strength >= 3;
    }).length;
    const weakParagraph = paragraphs
      .map((paragraph) => ({
        paragraph,
        strength: countMatches(paragraph.text, SENSORY_DETAIL_REGEX) + countMatches(paragraph.text, ACTION_DETAIL_REGEX),
        abstract: countMatches(paragraph.text, ABSTRACT_LABEL_REGEX),
      }))
      .sort((left, right) => left.strength + left.abstract - (right.strength + right.abstract))[0];

    let score = 4.8 + Math.min(2.4, (sensorySignal * 1.15 + actionSignal) / (chars / 220));
    score += Math.min(1.8, vividParagraphs * 0.18);
    score -= Math.min(2.4, abstractSignal * 0.08);

    if (stylePreset?.paragraph_density === "high" && vividParagraphs < Math.max(1, Math.floor(paragraphs.length / 3))) {
      score -= 0.6;
    }

    const evidence = [
      `五感/动作信号 ${sensorySignal + actionSignal} 处`,
      vividParagraphs > 0 ? `具象段落 ${vividParagraphs} 段` : "具象段落偏少",
    ];
    if (weakParagraph?.paragraph) {
      evidence.push(`薄弱片段：${compactSnippet(weakParagraph.paragraph.text)}`);
    }

    return {
      score: clampScore(score),
      reason:
        score >= 6.5
          ? "画面细节和动作反应能支撑场景。"
          : "场景更多在汇报结果，具象细节不足。",
      evidence,
      focusSpan: weakParagraph?.paragraph ? { from: weakParagraph.paragraph.from, to: weakParagraph.paragraph.to } : undefined,
    };
  }

  private scoreDialogueNaturalness(text: string): DimensionDetail {
    const dialogueRatio = this.dialogueRatio(text);
    const dialogues = Array.from(text.matchAll(DIALOGUE_QUOTE_REGEX)).map((match) => match[1].trim()).filter(Boolean);
    const longFormalLines = dialogues.filter((line) => line.length >= 32).length;
    const expositoryLines = dialogues.filter((line) => DIALOGUE_EXPOSITION_REGEX.test(line)).length;
    const brokenLines = dialogues.filter((line) => line.length <= 14 || /[……？！!?]/.test(line)).length;
    const pressureLines = dialogues.filter((line) => /(明白吗|关门|快点|签|别出来|谁敢|在|诺|开门|给口粟)/.test(line)).length;
    const questionLines = dialogues.filter((line) => /[吗？\?]/.test(line)).length;
    const commandLines = dialogues.filter((line) => /^(快|签|开门|顶住|斛来|在|诺|关门|别|说|给|抬|记住|滚|站住)/.test(line)).length;
    const avgLength = avg(dialogues.map((line) => line.length));

    let score = 5.6;
    if (dialogues.length > 0) {
      if (dialogueRatio >= 0.12 && dialogueRatio <= 0.55) score += 1.1;
      score += Math.min(1.4, brokenLines * 0.24);
      score += Math.min(0.9, pressureLines * 0.16);
      score += Math.min(0.7, questionLines * 0.08 + commandLines * 0.06);
      score -= Math.min(2.5, longFormalLines * 0.42 + expositoryLines * 0.55);
      if (avgLength > 26 && pressureLines < Math.max(2, dialogues.length * 0.18)) {
        score -= 0.8;
      }
    }

    const evidence = [
      dialogues.length > 0 ? `对白 ${dialogues.length} 句` : "对白偏少",
      `书面/说明型对白 ${longFormalLines + expositoryLines} 句`,
      pressureLines > 0 ? `短促施压对白 ${pressureLines} 句` : "短促施压对白偏少",
      questionLines + commandLines > 0 ? `问答/命令句 ${questionLines + commandLines} 句` : "问答/命令句偏少",
    ];

    return {
      score: clampScore(score),
      reason:
        score >= 6.5
          ? "对白有停顿和留白，口语节奏自然。"
          : "对白偏完整偏说明，像在替作者交代信息。",
      evidence,
    };
  }

  private scoreExpositionControl(text: string, paragraphs: ParagraphSpan[], stylePreset?: StylePresetLite | null): DimensionDetail {
    const expositionParagraphs = paragraphs.filter((paragraph) => {
      const exposition = countMatches(paragraph.text, EXPOSITION_MARKER_REGEX);
      const abstract = countMatches(paragraph.text, ABSTRACT_LABEL_REGEX);
      const mental = countMatches(paragraph.text, MENTAL_LABEL_REGEX);
      const action = countMatches(paragraph.text, ACTION_DETAIL_REGEX);
      const dialogue = countMatches(paragraph.text, DIALOGUE_QUOTE_REGEX);
      return exposition + abstract + mental >= 2 && action <= 1 && dialogue === 0;
    });
    const hardSummaryCount = countMatches(text, /(总之|归根结底|说到底|重要的是|这意味着|这说明了|本质上)/g);
    const rawExpositionCount = countMatches(text, EXPOSITION_MARKER_REGEX);
    const limit = stylePreset?.exposition_limit ?? 0.22;
    const expositionRatio = paragraphs.length === 0 ? 0 : expositionParagraphs.length / paragraphs.length;
    let score = 8.1;

    score -= Math.max(0, expositionRatio - limit) * 18;
    score -= Math.min(1.8, expositionParagraphs.length * 0.25);
    score -= Math.min(1.5, hardSummaryCount * 0.4);
    score -= Math.min(1.6, rawExpositionCount * 0.08);

    const worstParagraph = expositionParagraphs.sort(
      (left, right) =>
        countMatches(right.text, EXPOSITION_MARKER_REGEX) + countMatches(right.text, ABSTRACT_LABEL_REGEX) -
        (countMatches(left.text, EXPOSITION_MARKER_REGEX) + countMatches(left.text, ABSTRACT_LABEL_REGEX)),
    )[0];

    const evidence = [
      `说明性段落占比 ${(expositionRatio * 100).toFixed(0)}%`,
      hardSummaryCount > 0 ? `硬总结 ${hardSummaryCount} 处` : "硬总结控制尚可",
    ];
    if (worstParagraph) {
      evidence.push(`最重说明段：${compactSnippet(worstParagraph.text)}`);
    }

    return {
      score: clampScore(score),
      reason:
        score >= 6.5
          ? "说明段比例受控，叙述没有频繁跳出场景总结。"
          : "解释和总结偏多，挤压了动作与场景呈现。",
      evidence,
      focusSpan: worstParagraph ? { from: worstParagraph.from, to: worstParagraph.to } : undefined,
    };
  }

  private scoreAiToneRisk(text: string, paragraphs: ParagraphSpan[], stylePreset?: StylePresetLite | null): DimensionDetail {
    const bannedHits = (stylePreset?.banned_words ?? []).map((word) => ({ word, count: termCount(text, word) })).filter((item) => item.count > 0);
    const symmetryCount = countMatches(text, SYMMETRY_REGEX);
    const connectorCount = countMatches(text, AI_CONNECTOR_REGEX);
    const mentalCount = countMatches(text, MENTAL_LABEL_REGEX);
    const emotionCount = countMatches(text, EMOTION_LABEL_REGEX);
    const attributeChainCount = countMatches(text, ATTRIBUTE_CHAIN_REGEX);
    const modifierStackCount = countMatches(text, MODIFIER_STACK_REGEX);
    const sentenceLengths = this.splitSentences(text).map((sentence) => sentence.length).filter(Boolean);
    const rhythmUniformity = avg(sentenceLengths) > 0 ? stddev(sentenceLengths) / avg(sentenceLengths) : 0;
    const uniformPenalty = rhythmUniformity < 0.3 ? 1.3 : rhythmUniformity < 0.42 ? 0.6 : 0;
    const hotspot = paragraphs
      .map((paragraph) => ({
        paragraph,
        score:
          (stylePreset?.banned_words ?? []).reduce((acc, word) => acc + termCount(paragraph.text, word), 0) * 2 +
          countMatches(paragraph.text, SYMMETRY_REGEX) +
          countMatches(paragraph.text, AI_CONNECTOR_REGEX) +
          countMatches(paragraph.text, MENTAL_LABEL_REGEX) +
          countMatches(paragraph.text, ATTRIBUTE_CHAIN_REGEX) * 2 +
          countMatches(paragraph.text, MODIFIER_STACK_REGEX) * 0.7,
      }))
      .sort((left, right) => right.score - left.score)[0];

    let score = 8.4;
    score -= Math.min(3, bannedHits.reduce((acc, item) => acc + item.count, 0) * 0.58);
    score -= Math.min(1.4, symmetryCount * 0.35 + connectorCount * 0.22);
    score -= Math.min(1.4, Math.max(0, mentalCount - 4) * 0.12 + Math.max(0, emotionCount - 4) * 0.1);
    score -= Math.min(1.3, attributeChainCount * 0.32 + modifierStackCount * 0.08);
    score -= uniformPenalty;

    const evidence = [
      bannedHits.length > 0
        ? `命中禁词：${bannedHits.slice(0, 4).map((item) => `${item.word}x${item.count}`).join("、")}`
        : "未命中预设禁词",
      symmetryCount > 0 ? `对称句式 ${symmetryCount} 处` : "对称句式控制尚可",
      attributeChainCount > 0 ? `连续定语链 ${attributeChainCount} 处` : "定语链控制尚可",
      modifierStackCount > 4 ? `高频修饰副词 ${modifierStackCount} 处` : "修饰副词密度正常",
      rhythmUniformity < 0.42 ? "句长分布偏整齐" : "句长分布有变化",
    ];
    if (hotspot?.paragraph && hotspot.score > 0) {
      evidence.push(`高风险片段：${compactSnippet(hotspot.paragraph.text)}`);
    }

    return {
      score: clampScore(score),
      reason:
        score >= 6.5
          ? "语言基本摆脱套话和工整腔。"
          : "存在套话、对称句或解释性心理标签，AI 味偏重。",
      evidence,
      focusSpan: hotspot?.paragraph && hotspot.score > 0 ? { from: hotspot.paragraph.from, to: hotspot.paragraph.to } : undefined,
    };
  }

  private scoreEndingHook(text: string) {
    const ending = text.slice(-220);
    const signal = countMatches(ending, /[？?!！]/g) + countMatches(ending, /(未完|下一刻|然而|就在这时|但他不知道|只差一步)/g);
    return clampScore(4 + signal * 1.35);
  }

  private scorePlatformFit(
    text: string,
    stylePreset?: Pick<StylePresetLite, "dialogue_ratio_min" | "dialogue_ratio_max" | "exposition_limit" | "opening_hook_required" | "ending_hook_required" | "banned_words"> | null,
  ) {
    if (!stylePreset) {
      return 6.5;
    }

    let score = 7;
    const dialogueRatio = this.dialogueRatio(text);
    const bannedHits = (stylePreset.banned_words ?? []).reduce((acc, word) => acc + termCount(text, word), 0);

    if (stylePreset.dialogue_ratio_min !== null && dialogueRatio < stylePreset.dialogue_ratio_min) {
      score -= 1.2;
    }

    if (stylePreset.dialogue_ratio_max !== null && dialogueRatio > stylePreset.dialogue_ratio_max) {
      score -= 1.0;
    }

    if (stylePreset.exposition_limit !== null) {
      const exposition = countMatches(text, EXPOSITION_MARKER_REGEX) / Math.max(1, textDensity(text) / 100);
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

    if (bannedHits > 0) {
      score -= Math.min(1.4, bannedHits * 0.18);
    }

    return clampScore(score);
  }

  private mapContinuityIssues(issues: Array<{ type: string; message: string }>) {
    return mapContinuityIssuesForEvaluation(issues);
  }

  private buildDiagnostics(args: {
    openingHook: number;
    endingHook: number;
    pacing: number;
    sceneVividness: DimensionDetail;
    dialogueNaturalness: DimensionDetail;
    expositionControl: DimensionDetail;
    aiToneRisk: DimensionDetail;
    sceneList: unknown;
  }) {
    const diagnostics: Array<{
      issue_type: "ai_tone" | "exposition_overload" | "weak_scene" | "stiff_dialogue" | "opening_hook" | "ending_hook" | "pacing";
      severity: "low" | "medium" | "high";
      score: number;
      reason: string;
      evidence: string[];
      suggested_actions: string[];
      focus_span?: { from: number; to: number };
      focus_scene_index?: number;
    }> = [];

    const pushDiagnostic = (diagnostic: (typeof diagnostics)[number]) => {
      diagnostics.push({
        ...diagnostic,
        focus_scene_index: this.resolveSceneIndexForSpan(args.sceneList, diagnostic.focus_span),
      });
    };

    if (args.aiToneRisk.score < 6.2) {
      pushDiagnostic({
        issue_type: "ai_tone",
        severity: severityByScore(args.aiToneRisk.score),
        score: args.aiToneRisk.score,
        reason: args.aiToneRisk.reason,
        evidence: args.aiToneRisk.evidence,
        suggested_actions: [
          "砍掉连续“的”字定语链，把一半修饰拆成动作、名词或结果。",
          "打破连续对称句式，拉开长短句差异。",
          "删除显式心理标签，改写成动作、停顿、环境反应。",
          "把套话替换为具体场面信息，不做近义词平移。",
        ],
        focus_span: args.aiToneRisk.focusSpan,
      });
    }

    if (args.expositionControl.score < 6.2) {
      pushDiagnostic({
        issue_type: "exposition_overload",
        severity: severityByScore(args.expositionControl.score),
        score: args.expositionControl.score,
        reason: args.expositionControl.reason,
        evidence: args.expositionControl.evidence,
        suggested_actions: [
          "删除段首或段尾的解释性总结句。",
          "把说明段拆成动作推进和对白交换。",
          "只保留当前场景必须的信息，其余延后。",
        ],
        focus_span: args.expositionControl.focusSpan,
      });
    }

    if (args.sceneVividness.score < 6.2) {
      pushDiagnostic({
        issue_type: "weak_scene",
        severity: severityByScore(args.sceneVividness.score),
        score: args.sceneVividness.score,
        reason: args.sceneVividness.reason,
        evidence: args.sceneVividness.evidence,
        suggested_actions: [
          "补一到两个可见动作和五感细节。",
          "让环境或物件对人物动作产生反馈。",
          "少写抽象判断，多写当下正在发生的画面。",
        ],
        focus_span: args.sceneVividness.focusSpan,
      });
    }

    if (args.dialogueNaturalness.score < 6.2) {
      pushDiagnostic({
        issue_type: "stiff_dialogue",
        severity: severityByScore(args.dialogueNaturalness.score),
        score: args.dialogueNaturalness.score,
        reason: args.dialogueNaturalness.reason,
        evidence: args.dialogueNaturalness.evidence,
        suggested_actions: [
          "把完整说明句改成打断、反问、半句停住。",
          "删除替作者解释背景的对白。",
          "保留角色目标，让对白承担试探、遮掩和施压。",
        ],
      });
    }

    if (args.openingHook < 6) {
      pushDiagnostic({
        issue_type: "opening_hook",
        severity: severityByScore(args.openingHook),
        score: args.openingHook,
        reason: "开头缺少异常事件或即时压力。",
        evidence: ["前 300-400 字冲突不足", "首段更像交代而不是开场"],
        suggested_actions: ["把最异常的信息前置", "开头先给动作或威胁，再补最少解释"],
        focus_span: { from: 0, to: Math.min(320, Math.max(0, args.expositionControl.focusSpan?.to ?? 320)) },
      });
    }

    if (args.endingHook < 6) {
      pushDiagnostic({
        issue_type: "ending_hook",
        severity: severityByScore(args.endingHook),
        score: args.endingHook,
        reason: "结尾收得太稳，缺少下一步风险。",
        evidence: ["结尾悬念或代价暴露不足"],
        suggested_actions: ["把未兑现代价留到最后一句", "只揭示一半信息，保留下一步压力"],
      });
    }

    if (args.pacing < 6) {
      pushDiagnostic({
        issue_type: "pacing",
        severity: severityByScore(args.pacing),
        score: args.pacing,
        reason: "段落密度和信息节拍不够稳定。",
        evidence: ["解释段偏多或段落长度过于平均"],
        suggested_actions: ["拆短说明段", "在动作段和信息段之间制造落差"],
      });
    }

    return diagnostics.sort((left, right) => left.score - right.score);
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

    const project = await this.prisma.project.findUnique({
      where: { id: chapter.project_id },
      select: { id: true, style_preset_id: true, target_platform: true },
    });
    if (!project) {
      throw new NotFoundException("Project not found");
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

    const stylePreset = (await this.resolveStylePreset({
      stylePresetName: args.stylePresetName,
      projectId: project.id,
      stylePresetId: project.style_preset_id,
      targetPlatform: project.target_platform,
    })) as StylePresetLite | null;

    const [glossary, characters, facts, sceneMemory] = await Promise.all([
      this.prisma.glossaryTerm.findMany({ where: { project_id: chapter.project_id } }),
      this.prisma.character.findMany({ where: { project_id: chapter.project_id } }),
      this.prisma.fact.findMany({
        where: { project_id: chapter.project_id, status: ExtractedStatus.confirmed },
      }),
      this.prisma.chapterMemory.findFirst({
        where: {
          chapter_id: chapter.id,
          extracted_from_version_id: version.id,
        },
        orderBy: { created_at: "desc" },
      }),
    ]);

    const paragraphs = this.splitParagraphs(version.text);
    const openingHook = this.scoreOpeningHook(version.text);
    const conflictStrength = this.scoreConflict(version.text);
    const pacing = this.scorePacing(version.text, paragraphs, stylePreset);
    const dialogueNaturalness = this.scoreDialogueNaturalness(version.text);
    const characterVoice = this.scoreCharacterVoice(version.text, characters.map((item) => item.name));
    const sceneVividness = this.scoreSceneVividness(version.text, paragraphs, stylePreset);
    const expositionControl = this.scoreExpositionControl(version.text, paragraphs, stylePreset);
    const aiToneRisk = this.scoreAiToneRisk(version.text, paragraphs, stylePreset);
    const endingHook = this.scoreEndingHook(version.text);
    const platformFit = this.scorePlatformFit(version.text, stylePreset);

    const overallScore = clampScore(
      avg([
        openingHook,
        conflictStrength,
        pacing,
        dialogueNaturalness.score,
        characterVoice,
        sceneVividness.score,
        expositionControl.score,
        aiToneRisk.score,
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

    const diagnostics = this.buildDiagnostics({
      openingHook,
      endingHook,
      pacing,
      sceneVividness,
      dialogueNaturalness,
      expositionControl,
      aiToneRisk,
      sceneList: sceneMemory?.scene_list,
    });

    const summaryFocus = diagnostics.slice(0, 2).map((item) => item.issue_type).join("、");
    const summary =
      overallScore >= 7.5
        ? "本章质量可发布，反 AI 味和场景表现基本稳定。"
        : overallScore >= 6
          ? `本章可读性尚可，但需优先处理 ${summaryFocus || "局部表达问题"}。`
          : `本章质量偏弱，建议先做定向修复，重点处理 ${summaryFocus || "冲突与表达"}。`;

    const evaluation = chapterEvaluationSchema.parse({
      overall_score: overallScore,
      quality: {
        opening_hook: { score: openingHook, reason: openingHook >= 6 ? "开头冲突有效" : "开头钩子不足" },
        conflict_strength: {
          score: conflictStrength,
          reason: conflictStrength >= 6 ? "冲突推进稳定" : "冲突密度偏低",
        },
        pacing: { score: pacing, reason: pacing >= 6 ? "节奏可控" : "节奏松散或过于平均" },
        dialogue_quality: {
          score: dialogueNaturalness.score,
          reason: dialogueNaturalness.reason,
        },
        dialogue_naturalness: {
          score: dialogueNaturalness.score,
          reason: dialogueNaturalness.reason,
        },
        character_voice: {
          score: characterVoice,
          reason: characterVoice >= 6 ? "角色声纹可辨识" : "角色声纹区分不足",
        },
        scene_vividness: {
          score: sceneVividness.score,
          reason: sceneVividness.reason,
        },
        exposition_control: {
          score: expositionControl.score,
          reason: expositionControl.reason,
        },
        ai_tone_risk: {
          score: aiToneRisk.score,
          reason: aiToneRisk.reason,
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
      diagnostics,
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
          dialogue_quality: dialogueNaturalness.score,
          character_voice: characterVoice,
          scene_vividness: sceneVividness.score,
          exposition_control: expositionControl.score,
          ending_hook: endingHook,
          platform_fit: platformFit,
          overall_score: overallScore,
          summary,
          report: toJson({
            ...evaluation,
            meta: {
              style_preset: stylePreset?.name ?? null,
              target_platform: stylePreset?.target_platform ?? project.target_platform ?? null,
            },
          }),
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
