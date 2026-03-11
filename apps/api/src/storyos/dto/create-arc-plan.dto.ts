import { Type } from "class-transformer";
import { IsArray, IsInt, IsOptional, IsString, Min, ValidateNested } from "class-validator";

export class ArcItemDto {
  @IsInt()
  @Min(1)
  arc_no!: number;

  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  summary?: string;

  @IsOptional()
  @IsString()
  mainline?: string;

  @IsOptional()
  @IsString()
  subline?: string;

  @IsOptional()
  @IsString()
  pacing_profile?: string;

  @IsOptional()
  @IsInt()
  chapter_range_start?: number;

  @IsOptional()
  @IsInt()
  chapter_range_end?: number;
}

export class CreateArcPlanDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ArcItemDto)
  arcs!: ArcItemDto[];
}
