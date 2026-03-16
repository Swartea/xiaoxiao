import { apiDelete, apiGet, apiPatch, apiPost } from "./api";

export type ResourceStats = {
  collection: string;
  resource_type: string;
  resource_id: string;
  total_chapters: number;
  latest_chapter_no: number | null;
  total_hits: number;
  canonical_conflict_count: number;
  state_distribution: {
    inferred: number;
    confirmed: number;
    ignored: number;
  };
};

export type ResourceReferenceItem = {
  id: string;
  resource_type: string;
  resource_id: string;
  state: "confirmed" | "inferred" | "ignored";
  confidence: number;
  occurrence_count: number;
  resource: any;
  stats?: ResourceStats;
  chapter?: {
    id: string;
    chapter_no: number;
    title: string | null;
  };
  version?: {
    id: string;
    version_no: number;
    stage: string;
  } | null;
};

export type ChapterReferencesPayload = {
  chapter_id: string;
  summary: {
    total: number;
    confirmed: number;
    inferred: number;
    ignored: number;
  };
  references: {
    characters: ResourceReferenceItem[];
    glossary: ResourceReferenceItem[];
    relationships: ResourceReferenceItem[];
    timeline: ResourceReferenceItem[];
    sensitive_words: ResourceReferenceItem[];
    regex_rules: ResourceReferenceItem[];
  };
};

function buildQuery(query?: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    params.set(key, String(value));
  }
  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
}

export function displayReferenceName(item: ResourceReferenceItem) {
  const resource = item.resource ?? {};
  if (typeof resource.name === "string" && resource.name.trim()) return resource.name;
  if (typeof resource.term === "string" && resource.term.trim()) return resource.term;
  if (typeof resource.event === "string" && resource.event.trim()) return resource.event;
  if (typeof resource.time_mark === "string" && resource.time_mark.trim()) return resource.time_mark;
  if (typeof resource.replacement === "string" && resource.replacement.trim()) return resource.replacement;
  if (resource.fromCharacter?.name || resource.toCharacter?.name) {
    return `${resource.fromCharacter?.name ?? "?"} -> ${resource.toCharacter?.name ?? "?"}`;
  }
  return item.resource_id;
}

export async function fetchProjectCollection<T = any>(
  projectId: string,
  collection: string,
  query?: {
    q?: string;
    include?: string;
    chapter_id?: string;
    limit?: number;
    offset?: number;
  },
) {
  return apiGet<T>(`/projects/${projectId}/${collection}${buildQuery(query)}`);
}

export async function createProjectResource<T = any>(projectId: string, collection: string, payload: unknown) {
  return apiPost<T>(`/projects/${projectId}/${collection}`, payload);
}

export async function updateProjectResource<T = any>(
  projectId: string,
  collection: string,
  resourceId: string,
  payload: unknown,
) {
  return apiPatch<T>(`/projects/${projectId}/${collection}/${resourceId}`, payload);
}

export async function deleteProjectResource<T = any>(projectId: string, collection: string, resourceId: string) {
  return apiDelete<T>(`/projects/${projectId}/${collection}/${resourceId}`);
}

export async function getResourceReferences(projectId: string, collection: string, resourceId: string) {
  return apiGet<{ references: ResourceReferenceItem[]; stats: ResourceStats }>(
    `/projects/${projectId}/${collection}/${resourceId}/references`,
  );
}

export async function getResourceStats(projectId: string, collection: string, resourceId: string) {
  return apiGet<ResourceStats>(`/projects/${projectId}/${collection}/${resourceId}/stats`);
}

export async function getChapterReferences(projectId: string, chapterId: string) {
  return apiGet<ChapterReferencesPayload>(`/projects/${projectId}/chapters/${chapterId}/references`);
}

export async function patchChapterReferences(
  projectId: string,
  chapterId: string,
  items: Array<{
    resource_type: string;
    resource_id: string;
    state: "confirmed" | "ignored" | "inferred";
    confidence?: number;
  }>,
) {
  return apiPatch<ChapterReferencesPayload>(`/projects/${projectId}/chapters/${chapterId}/references`, { items });
}

export async function rebuildChapterReferences(projectId: string, chapterId: string) {
  return apiPost<ChapterReferencesPayload>(`/projects/${projectId}/chapters/${chapterId}/references/rebuild`, {});
}
