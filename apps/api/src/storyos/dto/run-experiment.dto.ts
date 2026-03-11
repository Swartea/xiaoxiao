import { IsEnum, IsNumber, IsOptional, IsString, IsUUID, Max, Min, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

enum ExperimentTypeDto {
  prompt_ab = "prompt_ab",
  model_compare = "model_compare",
  retriever_compare = "retriever_compare",
}

export class ExperimentVariantDto {
  @IsString()
  label!: string;

  @IsOptional()
  @IsString()
  prompt_version?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  retriever_strategy?: string;

  @IsOptional()
  @IsUUID()
  version_id?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10)
  manual_score?: number;
}

export class RunExperimentDto {
  @IsEnum(ExperimentTypeDto)
  type!: "prompt_ab" | "model_compare" | "retriever_compare";

  @ValidateNested()
  @Type(() => ExperimentVariantDto)
  variant_a!: ExperimentVariantDto;

  @ValidateNested()
  @Type(() => ExperimentVariantDto)
  variant_b!: ExperimentVariantDto;
}
