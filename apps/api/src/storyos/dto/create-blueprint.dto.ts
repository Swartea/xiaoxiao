import { IsArray, IsOptional, IsString, MaxLength } from "class-validator";

export class CreateBlueprintDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  book_positioning?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  genre?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  selling_points?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(80)
  target_platform?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  target_readers?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  pleasure_pacing?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  main_conflict?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  core_suspense?: string;
}
