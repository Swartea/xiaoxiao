import { IsEnum, IsOptional, IsString, IsUUID } from "class-validator";

enum PovDto {
  first = "first",
  third = "third",
}

enum TenseDto {
  past = "past",
  present = "present",
}

export class CreateProjectDto {
  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  genre?: string;

  @IsOptional()
  @IsString()
  target_platform?: string;

  @IsOptional()
  @IsEnum(PovDto)
  pov?: "first" | "third";

  @IsOptional()
  @IsEnum(TenseDto)
  tense?: "past" | "present";

  @IsOptional()
  @IsUUID()
  style_preset_id?: string;
}

export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  genre?: string;

  @IsOptional()
  @IsString()
  target_platform?: string;

  @IsOptional()
  @IsEnum(PovDto)
  pov?: "first" | "third";

  @IsOptional()
  @IsEnum(TenseDto)
  tense?: "past" | "present";

  @IsOptional()
  @IsUUID()
  style_preset_id?: string;
}
