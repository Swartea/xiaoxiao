import { IsArray, IsInt, IsOptional, IsString, IsUUID, Max, Min } from "class-validator";

export class GenerateStageDto {
  @IsOptional()
  @IsString()
  instruction?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  query_entities?: string[];

  @IsOptional()
  @IsInt()
  @Min(20)
  @Max(50)
  k?: number;
}

export class CheckContinuityDto {
  @IsOptional()
  @IsUUID()
  version_id?: string;
}

export class UpdateExtractionStatusDto {
  @IsString()
  status!: "extracted" | "confirmed" | "rejected";
}
