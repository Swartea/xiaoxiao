import { promptTemplateSeedSchema, type PromptTemplateSeed } from "@novel-factory/storyos-domain";
import defaultPrompts from "./templates/default-prompts.json";

export const defaultPromptSeeds: PromptTemplateSeed[] = promptTemplateSeedSchema.array().parse(defaultPrompts);

export function getPromptSeedByName(promptName: string): PromptTemplateSeed | undefined {
  return defaultPromptSeeds.find((item) => item.prompt_name === promptName);
}
