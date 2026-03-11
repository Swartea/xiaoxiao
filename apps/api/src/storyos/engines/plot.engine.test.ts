import { PlotEngine } from "./plot.engine";

describe("PlotEngine", () => {
  const engine = new PlotEngine();

  it("generates beats with required fields", () => {
    const beats = engine.generateChapterBeats({
      chapterMission: "主角夺回线索",
      conflictTarget: "敌对势力封锁",
      hookTarget: "结尾抛出更大代价",
    });

    expect(beats.length).toBeGreaterThan(0);
    expect(beats[0]).toEqual(
      expect.objectContaining({
        goal: expect.any(String),
        conflict: expect.any(String),
        obstacle: expect.any(String),
        action: expect.any(String),
        reversal: expect.any(String),
        reveal: expect.any(String),
        ending_hook: expect.any(String),
      }),
    );
  });

  it("detects flat plot when conflict/reversal is weak", () => {
    const flat = engine.detectFlatPlot([
      {
        goal: "做事",
        conflict: "弱",
        obstacle: "小障碍",
        action: "行动",
        reversal: "弱",
        reveal: "信息",
        ending_hook: "钩子",
      },
    ]);

    expect(flat).toBe(true);
  });
});
