export type CharacterDepthInput = {
  name: string;
  visual_anchors?: string | null;
  personality_tags?: string | null;
  current_status?: string | null;
};

function normalizeField(value?: string | null): string {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "未设定";
}

function hasDepthData(character: CharacterDepthInput): boolean {
  return Boolean(
    character.visual_anchors?.trim() ||
      character.personality_tags?.trim() ||
      character.current_status?.trim(),
  );
}

export function injectCharacterDepth(characters: CharacterDepthInput[]): string {
  const anchoredCharacters = characters.filter(hasDepthData);
  if (anchoredCharacters.length === 0) {
    return "";
  }

  const lines: string[] = [
    "【核心角色描写约束】",
    "当前出场角色需严格遵循以下设定，严禁使用套路化、网红脸或与设定冲突的描写（如：不可将病弱角色写成武将气质）：",
  ];

  for (const character of anchoredCharacters) {
    const status = normalizeField(character.current_status);
    lines.push(`- 角色：${character.name}`);
    lines.push(`- 外貌锚点：${normalizeField(character.visual_anchors)}`);
    lines.push(`- 气质底色：${normalizeField(character.personality_tags)}`);
    lines.push(`- 当前状态：${status}`);
    lines.push(
      `- 执行动作：请通过“微表情”和“肢体细节”体现其状态。例如：当展现其“${status}”时，需调用“瞳孔放大、额头冷汗、眼神飘忽”等细节。`,
    );
  }

  return lines.join("\n");
}
