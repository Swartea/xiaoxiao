import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

export class ResourceListQueryDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @IsOptional()
  @IsUUID()
  chapter_id?: string;

  @IsOptional()
  @IsString()
  include?: string;
}

export class CreateSensitiveWordDto {
  @IsString()
  term!: string;

  @IsOptional()
  @IsString()
  replacement?: string;

  @IsOptional()
  @IsIn(["low", "med", "high"])
  severity?: "low" | "med" | "high";

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateSensitiveWordDto {
  @IsOptional()
  @IsString()
  term?: string;

  @IsOptional()
  @IsString()
  replacement?: string;

  @IsOptional()
  @IsIn(["low", "med", "high"])
  severity?: "low" | "med" | "high";

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class CreateRegexRuleDto {
  @IsString()
  name!: string;

  @IsString()
  pattern!: string;

  @IsOptional()
  @IsString()
  flags?: string;

  @IsOptional()
  @IsIn(["low", "med", "high"])
  severity?: "low" | "med" | "high";

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateRegexRuleDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  pattern?: string;

  @IsOptional()
  @IsString()
  flags?: string;

  @IsOptional()
  @IsIn(["low", "med", "high"])
  severity?: "low" | "med" | "high";

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class PatchResourceReferenceItemDto {
  @IsString()
  @IsIn(["character", "glossary", "sensitive_word", "regex_rule", "timeline_event", "relationship"])
  resource_type!: string;

  @IsUUID()
  resource_id!: string;

  @IsString()
  @IsIn(["confirmed", "ignored", "inferred"])
  state!: "confirmed" | "ignored" | "inferred";

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  confidence?: number;
}

export class PatchChapterReferencesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PatchResourceReferenceItemDto)
  items!: PatchResourceReferenceItemDto[];
}
