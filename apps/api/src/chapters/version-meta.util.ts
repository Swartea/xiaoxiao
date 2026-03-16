type VersionMetaSource = {
  id: string;
  version_no: number;
  stage: string;
  created_at: Date;
  parent_version_id?: string | null;
  meta?: unknown;
};

export function pickMetaString(meta: unknown, key: string): string | null {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    return null;
  }
  const value = (meta as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function excerptText(value: string | null, maxLength = 120): string | null {
  if (!value) {
    return null;
  }
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

export function summarizeVersionMeta(version: VersionMetaSource) {
  return {
    id: version.id,
    version_no: version.version_no,
    stage: version.stage,
    created_at: version.created_at,
    parent_version_id: version.parent_version_id ?? null,
    fix_mode: pickMetaString(version.meta, "mode"),
    strategy_id: pickMetaString(version.meta, "strategy_id"),
    instruction_excerpt: excerptText(pickMetaString(version.meta, "instruction")),
    prompt_name: pickMetaString(version.meta, "prompt_name"),
    prompt_version_label: pickMetaString(version.meta, "prompt_version_label"),
    platform_variant: pickMetaString(version.meta, "platform_variant"),
    style_preset_name: pickMetaString(version.meta, "style_preset_name"),
  };
}
