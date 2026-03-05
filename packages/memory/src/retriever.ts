import type { RetrievedItem } from "./types";

export function dedupeByEntityAndContent<T>(items: RetrievedItem<T>[]): RetrievedItem<T>[] {
  const bestByKey = new Map<string, RetrievedItem<T>>();

  for (const item of items) {
    const key = `${item.entity_id ?? "none"}:${item.normalized_content_hash ?? item.id}`;
    const existing = bestByKey.get(key);
    if (!existing || item.score > existing.score) {
      bestByKey.set(key, item);
    }
  }

  return Array.from(bestByKey.values()).sort((a, b) => b.score - a.score);
}

export function scaleQuota(base: number, k: number, baseline = 50): number {
  if (k >= baseline) {
    return base;
  }
  return Math.max(1, Math.floor((base * k) / baseline));
}
