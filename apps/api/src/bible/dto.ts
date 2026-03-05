import {
  IsArray,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

export class CreateCharacterDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  aliases?: string[];

  @IsOptional()
  @IsInt()
  age?: number;

  @IsOptional()
  @IsString()
  appearance?: string;

  @IsOptional()
  @IsString()
  personality?: string;

  @IsOptional()
  @IsString()
  motivation?: string;

  @IsOptional()
  @IsString()
  secrets?: string;

  @IsOptional()
  @IsObject()
  abilities?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  catchphrases?: string[];
}

export class UpdateCharacterDto extends CreateCharacterDto {}

export class CreateRelationshipDto {
  @IsUUID()
  from_character_id!: string;

  @IsUUID()
  to_character_id!: string;

  @IsString()
  relation_type!: string;

  @IsInt()
  @Min(0)
  @Max(100)
  intensity!: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsInt()
  last_updated_chapter_no?: number;
}

export class UpdateRelationshipDto extends CreateRelationshipDto {}

export class CreateEntityDto {
  @IsString()
  type!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  constraints?: string;

  @IsOptional()
  @IsString()
  cost?: string;

  @IsOptional()
  @IsInt()
  first_appearance_chapter_no?: number;
}

export class UpdateEntityDto extends CreateEntityDto {}

export class CreateGlossaryDto {
  @IsString()
  term!: string;

  @IsString()
  canonical_form!: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateGlossaryDto extends CreateGlossaryDto {}

export class CreateTimelineDto {
  @IsString()
  time_mark!: string;

  @IsString()
  event!: string;

  @IsOptional()
  @IsObject()
  involved_entities?: Record<string, unknown>;

  @IsInt()
  chapter_no_ref!: number;
}

export class UpdateTimelineDto extends CreateTimelineDto {}

export class PatchBibleDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateCharacterDto)
  characters?: CreateCharacterDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateRelationshipDto)
  relationships?: CreateRelationshipDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateEntityDto)
  entities?: CreateEntityDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateGlossaryDto)
  glossary?: CreateGlossaryDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateTimelineDto)
  timeline?: CreateTimelineDto[];
}
