import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";

export class BootstrapStorySeedDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(24)
  label!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  setup!: string;
}

export class BootstrapProtagonistTemplateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  role_identity!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(240)
  strength!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(240)
  weakness!: string;
}

export class BootstrapVolumeMissionDto {
  @IsInt()
  @Min(1)
  chapter_no!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(240)
  mission!: string;
}

export class BootstrapVolumePlanDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  volume_title!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(240)
  main_objective!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(240)
  antagonist_force!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(240)
  central_mystery!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(240)
  first_turning_point!: string;

  @IsArray()
  @ArrayMinSize(5)
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => BootstrapVolumeMissionDto)
  chapter_missions!: BootstrapVolumeMissionDto[];
}

export class BootstrapProjectDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  logline!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  protagonist_brief!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  tone_setting!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  genre?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  sub_genre?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @IsString({ each: true })
  @MaxLength(80, { each: true })
  tropes?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(240)
  story_seed?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => BootstrapProtagonistTemplateDto)
  protagonist_template?: BootstrapProtagonistTemplateDto;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  selected_title?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => BootstrapVolumePlanDto)
  selected_volume_plan?: BootstrapVolumePlanDto;
}

class BootstrapAdviceMessageDto {
  @IsIn(["user", "assistant"])
  role!: "user" | "assistant";

  @IsString()
  @MaxLength(4000)
  content!: string;
}

export class BootstrapAdviceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  question!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  logline?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  protagonist_brief?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  tone_setting?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BootstrapAdviceMessageDto)
  messages?: BootstrapAdviceMessageDto[];
}

export class BootstrapStorySeedOptionsDto {
  @IsString()
  @IsNotEmpty()
  genre!: string;

  @IsString()
  @IsNotEmpty()
  sub_genre!: string;

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(3)
  @IsString({ each: true })
  tropes!: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  exclude_ids?: string[];
}

export class BootstrapTitleOptionsDto {
  @IsString()
  @IsNotEmpty()
  genre!: string;

  @IsString()
  @IsNotEmpty()
  sub_genre!: string;

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(3)
  @IsString({ each: true })
  tropes!: string[];

  @ValidateNested()
  @Type(() => BootstrapStorySeedDto)
  story_seed!: BootstrapStorySeedDto;

  @ValidateNested()
  @Type(() => BootstrapProtagonistTemplateDto)
  protagonist_template!: BootstrapProtagonistTemplateDto;
}

export class BootstrapLoglineOptionsDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  seed_logline?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  protagonist_brief?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  tone_setting?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  genre?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  sub_genre?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @IsString({ each: true })
  tropes?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => BootstrapStorySeedDto)
  story_seed?: BootstrapStorySeedDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => BootstrapProtagonistTemplateDto)
  protagonist_template?: BootstrapProtagonistTemplateDto;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  selected_title?: string;
}

export class BootstrapVolumePlanGenerationDto {
  @IsString()
  @IsNotEmpty()
  genre!: string;

  @IsString()
  @IsNotEmpty()
  sub_genre!: string;

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(3)
  @IsString({ each: true })
  tropes!: string[];

  @ValidateNested()
  @Type(() => BootstrapStorySeedDto)
  story_seed!: BootstrapStorySeedDto;

  @ValidateNested()
  @Type(() => BootstrapProtagonistTemplateDto)
  protagonist_template!: BootstrapProtagonistTemplateDto;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  selected_title!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  selected_logline!: string;
}

export class BootstrapRandomIdeaDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  genre?: string;
}
