import { validate } from "class-validator";
import { buildBootstrapPromptContext, normalizeBootstrapGenre } from "./bootstrap.service";
import { BootstrapProjectDto } from "./dto";

describe("Bootstrap DTO and prompt helpers", () => {
  it("requires genre and central_conflict and caps tone_tags length", async () => {
    const dto = Object.assign(new BootstrapProjectDto(), {
      genre: "",
      logline: "一名落魄皇女必须重返京城。",
      central_conflict: "",
      protagonist_brief: "沈昭，二十岁，冷静克制。",
      relationship_hook: "她必须接近昔日仇敌。",
      status_tension: "皇命倒计时七日。",
      opening_scene: "雪夜回京。",
      tone_tags: ["权谋", "克制", "甜虐", "悬疑"],
    });

    const errors = await validate(dto);
    const fields = errors.map((item) => item.property);

    expect(fields).toContain("genre");
    expect(fields).toContain("central_conflict");
    expect(fields).toContain("tone_tags");
  });

  it("maps known genres to template families", () => {
    expect(normalizeBootstrapGenre("古偶")).toBe("historical-romance");
    expect(normalizeBootstrapGenre("宫斗")).toBe("palace-politics");
    expect(normalizeBootstrapGenre("都市言情")).toBe("modern-romance");
    expect(normalizeBootstrapGenre("推理")).toBe("suspense");
    expect(normalizeBootstrapGenre("赛博传奇")).toBe("general-webnovel");
  });

  it("injects central_conflict and template guide into bootstrap prompt context", () => {
    const context = buildBootstrapPromptContext({
      genre: "古偶",
      logline: "她以假身份回宫复仇。",
      central_conflict: "她必须在复仇与真心之间二选一。",
      protagonist_brief: "女主表面温顺，实则极擅布局。",
      relationship_hook: "她与宿敌不得不假意结盟。",
      status_tension: "三日内必须拿到密诏。",
      opening_scene: "春宴上，她第一次与宿敌同席。",
      tone_tags: ["权谋", "克制"],
    });

    expect(context.template).toBe("historical-romance");
    expect(context.lines).toContain("central_conflict: 她必须在复仇与真心之间二选一。");
    expect(context.lines).toContain("tone_tags: 权谋 / 克制");
    expect(context.lines.at(-1)).toContain("身份秩序");
  });
});
