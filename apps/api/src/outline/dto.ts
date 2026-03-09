import { IsArray, IsInt, IsOptional, IsString, Min, ValidateNested } from "class-validator";
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
