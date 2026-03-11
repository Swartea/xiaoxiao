import { Injectable } from "@nestjs/common";
import type { StoryBeat } from "@novel-factory/storyos-domain";

@Injectable()
export class PlotEngine {
  generateArcOutline(input: {
    arcTitle: string;
    conflict: string;
    climax: string;
  }) {
    return {
      arc_title: input.arcTitle,
      setup: `${input.arcTitle} 的开端冲突建立`,
      escalation: input.conflict,
      climax: input.climax,
      payoff: `${input.arcTitle} 的阶段性兑现`,
    };
  }

  generateChapterBeats(input: {
    chapterMission: string;
    conflictTarget?: string;
    hookTarget?: string;
  }): StoryBeat[] {
    const conflict = input.conflictTarget ?? "冲突升级";
    const ending = input.hookTarget ?? "在关键抉择处收尾形成悬念";

    return [
      {
        goal: `建立本章任务：${input.chapterMission}`,
        conflict,
        obstacle: "信息不对称与时间压力",
        action: "主角主动推进",
        reversal: "看似可控的局面失衡",
        reveal: "关键线索提前暴露",
        ending_hook: "更大的代价被抛出",
      },
      {
        goal: "将局部冲突拉高到主线层",
        conflict: `${conflict} 继续抬升`,
        obstacle: "关系裂痕显性化",
        action: "角色做出高风险选择",
        reversal: "盟友立场动摇",
        reveal: "伏笔与当前困局关联",
        ending_hook: ending,
      },
    ];
  }

  trackPayoffAndSetup(input: {
    seeds: Array<{ id: string; content: string; status: string }>;
  }) {
    const pending = input.seeds.filter((seed) => seed.status !== "paid_off");
    return {
      pending_payoffs: pending.map((seed) => ({ id: seed.id, content: seed.content })),
      total_pending: pending.length,
    };
  }

  detectFlatPlot(beats: StoryBeat[]) {
    if (beats.length === 0) {
      return true;
    }
    const lowConflict = beats.filter((beat) => beat.conflict.trim().length < 4).length;
    const weakReversal = beats.filter((beat) => beat.reversal.trim().length < 4).length;
    return lowConflict > 0 || weakReversal > Math.floor(beats.length / 2);
  }

  injectTwist(beats: StoryBeat[]) {
    if (beats.length === 0) {
      return beats;
    }
    const cloned = beats.map((beat) => ({ ...beat }));
    const idx = Math.max(0, cloned.length - 1);
    cloned[idx].reversal = `${cloned[idx].reversal}，并触发隐藏代价反噬`;
    cloned[idx].ending_hook = `${cloned[idx].ending_hook}，且真相只揭开一半`;
    return cloned;
  }
}
