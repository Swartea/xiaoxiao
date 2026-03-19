import { OutlineService } from "./outline.service";

function createGuardrailPrisma(intentNotes: Record<string, unknown>) {
  return {
    chapter: {
      findUnique: jest.fn().mockResolvedValue({
        id: "chapter-1",
        project_id: "project-1",
        chapter_no: 3,
        title: "第三章",
        goal: "主角夺回先手",
        conflict: "身份暴露风险升高",
        twist: null,
        cliffhanger: "密信落入敌手",
      }),
    },
    storyBlueprint: {
      findFirst: jest.fn().mockResolvedValue({
        world_rule_map: { outline_workspace: { story_spine: { main_conflict: "家国与私情冲突", non_drift_constraints: [] } } },
        main_conflict: "家国与私情冲突",
        core_suspense: "她会不会暴露身份",
        book_positioning: "高压情感与权谋并进",
        selling_points: ["情感与权谋双线推进"],
      }),
    },
    storyOutlineNode: {
      findMany: jest.fn().mockResolvedValue([
        {
          phase_no: 1,
          title: "入局",
          goal: "逼主角进场",
          conflict: "旧敌环伺",
          milestone_chapter_no: 5,
        },
      ]),
    },
    arcPlan: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    chapterIntent: {
      findFirst: jest.fn().mockResolvedValue({
        notes: {
          outline_workspace: intentNotes,
        },
        advance_goal: "逼出敌方底牌",
        conflict_target: "身份越接近真相越危险",
        hook_target: "真正的密诏下落仍未明朗",
      }),
    },
    project: {
      findUnique: jest.fn().mockResolvedValue({ id: "project-1" }),
    },
  };
}

describe("OutlineService", () => {
  it("includes information_reveal in chapter guardrail output when only legacy chapter outline exists", async () => {
    const prisma = createGuardrailPrisma({
      stage_no: 1,
      stage_position: "推进章",
      goal: "逼出敌方底牌",
      core_conflict: "身份越接近真相越危险",
      key_events: ["夜探书阁", "伪装失手", "临时改局"],
      character_change: "主角第一次主动压下私人情绪",
      information_reveal: "敌方早已知道她回京",
      ending_hook: "真正的密诏下落仍未明朗",
    });

    const service = new OutlineService(prisma as never);
    const result = await service.buildGenerationGuardrail("chapter-1");

    expect(result.lines).toContain("本章信息揭露：敌方早已知道她回京");
    expect(result.lines).toContain("本章核心冲突：身份越接近真相越危险");
    expect(result.lines).toContain("章尾钩子：真正的密诏下落仍未明朗");
    expect(result.lines.some((line) => line.includes("本章在阶段中的作用"))).toBe(false);
  });

  it("prioritizes fine outline lines and suppresses duplicate legacy event lines", async () => {
    const prisma = createGuardrailPrisma({
      stage_no: 1,
      stage_position: "推进章",
      goal: "逼出敌方底牌",
      chapter_function: "让陈安确认申家不是单独作案",
      core_conflict: "身份越接近真相越危险",
      key_events: ["旧事件一", "旧事件二", "旧事件三"],
      scene_progression: ["夜探书阁", "借错账册试探王典", "借尸灯判断谁在监视自己"],
      key_takeaways: ["申家背后还有更高层的人", "陈安确认东市仓内有人通风报信"],
      relationship_changes: ["陈安对老周的信任第一次出现裂缝"],
      character_change: "主角第一次主动压下私人情绪",
      information_reveal: "申家背后还有更高层的人",
      strategy_judgment: "先装作愿意合作，换取申家暴露更多链条",
      ending_hook: "他回到住处时，门缝里已经塞进了一张催命木筹",
    });

    const service = new OutlineService(prisma as never);
    const result = await service.buildGenerationGuardrail("chapter-1");

    expect(result.lines).toContain("本章功能：让陈安确认申家不是单独作案");
    expect(result.lines).toContain("场景推进：1. 夜探书阁 2. 借错账册试探王典 3. 借尸灯判断谁在监视自己");
    expect(result.lines).toContain("本章关键收获：1. 申家背后还有更高层的人 2. 陈安确认东市仓内有人通风报信");
    expect(result.lines).toContain("关系变化：1. 陈安对老周的信任第一次出现裂缝");
    expect(result.lines).toContain("主角判断/策略：先装作愿意合作，换取申家暴露更多链条");
    expect(result.lines).toContain("章尾钩子：他回到住处时，门缝里已经塞进了一张催命木筹");
    expect(result.lines.some((line) => line.startsWith("本章关键事件："))).toBe(false);
    expect(result.lines).not.toContain("本章信息揭露：申家背后还有更高层的人");
  });

  it("reads fine outline fields from outline workspace", async () => {
    const prisma = {
      project: {
        findUnique: jest.fn().mockResolvedValue({
          id: "project-1",
          genre: "历史权谋",
          target_platform: "webnovel",
        }),
      },
      storyOutlineNode: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      arcPlan: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      chapter: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "chapter-1",
            chapter_no: 1,
            title: "第一章",
            goal: "旧骨架目标",
            conflict: "旧骨架冲突",
            twist: "旧信息",
            cliffhanger: "旧钩子",
            word_target: 3000,
          },
        ]),
      },
      chapterIntent: {
        findMany: jest.fn().mockResolvedValue([
          {
            chapter_id: "chapter-1",
            version_no: 1,
            advance_goal: "旧骨架目标",
            conflict_target: "旧骨架冲突",
            hook_target: "旧钩子",
            notes: {
              outline_workspace: {
                chapter_function: "立住洛阳城门失控的危机",
                scene_progression: ["流民冲城", "陈安察觉口号异常", "校尉署下令查仓"],
                key_takeaways: ["有人在刻意放大官仓传言"],
                relationship_changes: ["老周对陈安第一次明确点拨"],
                strategy_judgment: "先记异常，再决定往哪条线查",
                ending_hook: "陈安刚领命，东市官仓的差吏已经先一步在等他",
              },
            },
          },
        ]),
      },
      storyBlueprint: {
        findMany: jest.fn().mockResolvedValue([
          {
            version_no: 1,
            main_conflict: "粮案牵出洛阳权力网",
            core_suspense: "查仓会不会变成送命差事",
            book_positioning: "高压权谋悬疑",
            selling_points: ["查账破局"],
            world_rule_map: { outline_workspace: { story_spine: { non_drift_constraints: [] } } },
          },
        ]),
      },
      character: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      seed: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      bibleEntity: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      glossaryTerm: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    const service = new OutlineService(prisma as never);
    const result = await service.getOutlineWorkspace("project-1");

    expect(result.chapters[0]).toMatchObject({
      chapter_function: "立住洛阳城门失控的危机",
      scene_progression: ["流民冲城", "陈安察觉口号异常", "校尉署下令查仓"],
      key_takeaways: ["有人在刻意放大官仓传言"],
      relationship_changes: ["老周对陈安第一次明确点拨"],
      strategy_judgment: "先记异常，再决定往哪条线查",
      ending_hook: "陈安刚领命，东市官仓的差吏已经先一步在等他",
    });
  });

  it("persists fine outline fields into chapter intent notes", async () => {
    const tx = {
      chapter: {
        create: jest.fn().mockResolvedValue({
          id: "chapter-1",
          project_id: "project-1",
          chapter_no: 1,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      chapterIntent: {
        create: jest.fn().mockResolvedValue({}),
      },
    };
    const prisma = {
      project: {
        findUnique: jest.fn().mockResolvedValue({
          id: "project-1",
          title: "洛阳粮案",
          genre: "历史权谋",
          target_platform: "webnovel",
        }),
      },
      storyBlueprint: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      chapter: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      chapterIntent: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      character: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      bibleEntity: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn(async (callback: (trx: typeof tx) => Promise<unknown>) => callback(tx)),
    };

    const service = new OutlineService(prisma as never);
    jest.spyOn(service, "getOutlineWorkspace").mockResolvedValue({ ok: true } as never);

    await service.patchOutlineWorkspace("project-1", {
      chapters: [
        {
          chapter_no: 1,
          title: "流民冲城",
          goal: "把陈安推进查仓局里",
          chapter_function: "让陈安意识到这不是普通饥乱",
          core_conflict: "他看出异常，却没人想听真话",
          key_events: ["流民冲城", "老周点拨", "校尉署发令"],
          scene_progression: ["流民撞门", "陈安辨认口号异常", "陈安被点去东市官仓"],
          key_takeaways: ["流民冲城背后有人组织"],
          relationship_changes: ["老周开始把陈安往更深的局里带"],
          strategy_judgment: "先记下异常，再决定汇报尺度",
          ending_hook: "东市官仓的人已经先一步等着他签字",
          word_target: 3200,
        },
      ],
    } as never);

    expect(tx.chapterIntent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          chapter_mission: "让陈安意识到这不是普通饥乱",
          advance_goal: "把陈安推进查仓局里",
          conflict_target: "他看出异常，却没人想听真话",
          hook_target: "东市官仓的人已经先一步等着他签字",
          notes: expect.objectContaining({
            outline_workspace: expect.objectContaining({
              chapter_function: "让陈安意识到这不是普通饥乱",
              scene_progression: ["流民撞门", "陈安辨认口号异常", "陈安被点去东市官仓"],
              key_takeaways: ["流民冲城背后有人组织"],
              relationship_changes: ["老周开始把陈安往更深的局里带"],
              strategy_judgment: "先记下异常，再决定汇报尺度",
            }),
          }),
        }),
      }),
    );
  });
});
