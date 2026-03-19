import { ArrayMaxSize, IsArray, IsNotEmpty, IsOptional, IsString, MaxLength } from "class-validator";

export class BootstrapProjectDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  genre!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  logline!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  central_conflict!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  protagonist_brief!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  relationship_hook!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  status_tension!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  opening_scene!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @IsString({ each: true })
  @MaxLength(30, { each: true })
  tone_tags?: string[];
}
