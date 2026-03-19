import { Type } from "class-transformer";
import { IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUUID, ValidateNested } from "class-validator";

enum ChapterStatusDto {
  outline = "outline",
  draft = "draft",
  final = "final",
  blocked_review = "blocked_review",
}

export class CreateChapterDto {
  @IsInt()
  chapter_no!: number;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  goal?: string;

  @IsOptional()
  @IsString()
  conflict?: string;

  @IsOptional()
  @IsString()
  twist?: string;

  @IsOptional()
  @IsString()
  cliffhanger?: string;

  @IsOptional()
  @IsInt()
  word_target?: number;

  @IsOptional()
  @IsEnum(ChapterStatusDto)
  status?: "outline" | "draft" | "final" | "blocked_review";
}

export class UpdateChapterReviewBlockDto {
  @IsBoolean()
  blocked!: boolean;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  source?: "continuity_fail" | "fix_exhaustion" | "quality_fail" | "manual";

  @IsOptional()
  @IsArray()
  details?: string[];

  @IsOptional()
  @IsUUID()
  version_id?: string;
}

class ImportChapterEntryDto {
  @IsOptional()
  @IsInt()
  chapter_no?: number;

  @IsOptional()
  @IsString()
  title?: string;

  @IsString()
  text!: string;

  @IsOptional()
  @IsString()
  stage?: "beats" | "draft" | "polish" | "fix";
}

export class ImportChaptersDto {
  @IsOptional()
  @IsString()
  raw_text?: string;

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => ImportChapterEntryDto)
  @IsArray()
  entries?: ImportChapterEntryDto[];

  @IsOptional()
  @IsString()
  default_stage?: "beats" | "draft" | "polish" | "fix";
}

export class RollbackChapterDto {
  @IsUUID()
  version_id!: string;
}
