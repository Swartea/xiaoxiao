import { Type } from "class-transformer";
import { IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUUID, Min, ValidateNested } from "class-validator";

enum PromptStageDto {
  beats = "beats",
  draft = "draft",
  polish = "polish",
  quality_eval = "quality_eval",
  fix = "fix",
  director = "director",
  adaptation = "adaptation",
}

export class PromptTemplateVersionCreateDto {
  @IsInt()
  @Min(1)
  prompt_version!: number;

  @IsString()
  platform_variant!: string;

  @IsString()
  template!: string;

  @IsOptional()
  @IsString()
  ab_bucket?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class CreatePromptTemplateDto {
  @IsOptional()
  @IsUUID()
  project_id?: string;

  @IsString()
  prompt_name!: string;

  @IsEnum(PromptStageDto)
  stage!: "beats" | "draft" | "polish" | "quality_eval" | "fix" | "director" | "adaptation";

  @IsString()
  purpose!: string;

  @ValidateNested({ each: true })
  @Type(() => PromptTemplateVersionCreateDto)
  @IsArray()
  versions!: PromptTemplateVersionCreateDto[];
}

export class RollbackPromptTemplateDto {
  @IsInt()
  @Min(1)
  prompt_version!: number;
}
