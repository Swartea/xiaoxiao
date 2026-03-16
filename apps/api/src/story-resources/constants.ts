import { ResourceType } from "@prisma/client";

export const RESOURCE_COLLECTION_TO_TYPE = {
  characters: ResourceType.character,
  glossary: ResourceType.glossary,
  relationships: ResourceType.relationship,
  timeline: ResourceType.timeline_event,
  "rules/sensitive-words": ResourceType.sensitive_word,
  "rules/regex": ResourceType.regex_rule,
} as const;

export const RESOURCE_TYPE_TO_COLLECTION: Record<ResourceType, string> = {
  [ResourceType.character]: "characters",
  [ResourceType.glossary]: "glossary",
  [ResourceType.relationship]: "relationships",
  [ResourceType.timeline_event]: "timeline",
  [ResourceType.sensitive_word]: "rules/sensitive-words",
  [ResourceType.regex_rule]: "rules/regex",
};

export const RESOURCE_GROUP_KEYS = {
  [ResourceType.character]: "characters",
  [ResourceType.glossary]: "glossary",
  [ResourceType.relationship]: "relationships",
  [ResourceType.timeline_event]: "timeline",
  [ResourceType.sensitive_word]: "sensitive_words",
  [ResourceType.regex_rule]: "regex_rules",
} as const;

export function resourceTypeFromCollection(collection: string): ResourceType {
  const value = RESOURCE_COLLECTION_TO_TYPE[collection as keyof typeof RESOURCE_COLLECTION_TO_TYPE];
  if (!value) {
    throw new Error(`Unsupported resource collection: ${collection}`);
  }
  return value;
}
