import { IsArray, IsOptional, IsString } from "class-validator";

export class CreateChapterIntentDto {
  @IsString()
  chapter_mission!: string;

  @IsOptional()
  @IsString()
  advance_goal?: string;

  @IsOptional()
  @IsString()
  conflict_target?: string;

  @IsOptional()
  @IsString()
  hook_target?: string;

  @IsOptional()
  @IsString()
  pacing_direction?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  must_payoff_seed_ids?: string[];
}
