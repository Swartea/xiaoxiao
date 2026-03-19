import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

export class OutlineNodeDto {
  @IsInt()
  @Min(1)
  phase_no!: number;

  @IsString()
  title!: string;

  @IsString()
  summary!: string;

  @IsOptional()
  @IsString()
  goal?: string;

  @IsOptional()
  @IsString()
  conflict?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  milestone_chapter_no?: number;
}

export class PatchOutlineDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OutlineNodeDto)
  nodes!: OutlineNodeDto[];
}

export class StorySpineDto {
  @IsOptional()
  @IsString()
  logline?: string;

  @IsOptional()
  @IsString()
  main_conflict?: string;

  @IsOptional()
  @IsString()
  protagonist_long_goal?: string;

  @IsOptional()
  @IsString()
  external_pressure?: string;

  @IsOptional()
  @IsString()
  internal_conflict?: string;

  @IsOptional()
  @IsString()
  central_question?: string;

  @IsOptional()
  @IsString()
  ending_direction?: string;

  @IsOptional()
  @IsString()
  ending_cost?: string;

  @IsOptional()
  @IsString()
  story_promise?: string;

  @IsOptional()
  @IsString()
  theme_statement?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  non_drift_constraints?: string[];
}

export class OutlineStateDto {
  @IsOptional()
  @IsString()
  protagonist_state?: string;

  @IsOptional()
  @IsString()
  relationship_state?: string;

  @IsOptional()
  @IsString()
  world_state?: string;
}

export class OutlineProgressDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5)
  plot?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5)
  relationship?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5)
  information?: number;
}

export class OutlineCharacterRoleDto {
  @IsOptional()
  @IsUUID()
  character_id?: string;

  @IsOptional()
  @IsString()
  character_name?: string;

  @IsOptional()
  @IsString()
  role?: string;
}

export class OutlineSeedLinkDto {
  @IsOptional()
  @IsUUID()
  seed_id?: string;

  @IsOptional()
  @IsString()
  seed_name?: string;

  @IsOptional()
  @IsInt()
  introduce_in_stage?: number;

  @IsOptional()
  @IsInt()
  introduce_in_chapter?: number;

  @IsOptional()
  @IsInt()
  payoff_in_stage?: number;

  @IsOptional()
  @IsInt()
  payoff_in_chapter?: number;

  @IsOptional()
  @IsString()
  current_status?: string;

  @IsOptional()
  @IsString()
  link_type?: string;
}

export class StageOutlineWorkspaceItemDto extends OutlineNodeDto {
  @IsOptional()
  @IsString()
  stage_function?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => OutlineStateDto)
  start_state?: OutlineStateDto;

  @IsOptional()
  @IsString()
  stage_goal?: string;

  @IsOptional()
  @IsString()
  main_opponent?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  key_events?: string[];

  @IsOptional()
  @IsString()
  midpoint_change?: string;

  @IsOptional()
  @IsString()
  climax?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => OutlineStateDto)
  ending_state?: OutlineStateDto;

  @IsOptional()
  @IsString()
  stage_cost?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => OutlineProgressDto)
  progress?: OutlineProgressDto;

  @IsOptional()
  @IsString()
  completion_criteria?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  no_drift_constraints?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  involved_character_ids?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OutlineCharacterRoleDto)
  character_role_assignments?: OutlineCharacterRoleDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OutlineSeedLinkDto)
  seed_links?: OutlineSeedLinkDto[];

  @IsOptional()
  @IsInt()
  chapter_range_start?: number;

  @IsOptional()
  @IsInt()
  chapter_range_end?: number;
}

export class ChapterOutlineWorkspaceItemDto {
  @IsOptional()
  @IsUUID()
  chapter_id?: string;

  @IsInt()
  @Min(1)
  chapter_no!: number;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  stage_no?: number;

  @IsOptional()
  @IsString()
  stage_position?: string;

  @IsOptional()
  @IsString()
  goal?: string;

  @IsOptional()
  @IsString()
  chapter_function?: string;

  @IsOptional()
  @IsString()
  core_conflict?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  key_events?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  scene_progression?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  key_takeaways?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  relationship_changes?: string[];

  @IsOptional()
  @IsString()
  character_change?: string;

  @IsOptional()
  @IsString()
  information_reveal?: string;

  @IsOptional()
  @IsString()
  strategy_judgment?: string;

  @IsOptional()
  @IsString()
  ending_hook?: string;

  @IsOptional()
  @IsInt()
  word_target?: number;
}

export class PatchOutlineWorkspaceDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => StorySpineDto)
  story_spine?: StorySpineDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StageOutlineWorkspaceItemDto)
  stages?: StageOutlineWorkspaceItemDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChapterOutlineWorkspaceItemDto)
  chapters?: ChapterOutlineWorkspaceItemDto[];
}
