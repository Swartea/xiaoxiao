import { IsEnum, IsInt, IsOptional, IsString, IsUUID } from "class-validator";

enum ChapterStatusDto {
  outline = "outline",
  draft = "draft",
  final = "final",
}

export class CreateChapterDto {
  @IsInt()
  chapter_no!: number;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  goal?: string;

  @IsOptional()
  @IsString()
  conflict?: string;

  @IsOptional()
  @IsString()
  twist?: string;

  @IsOptional()
  @IsString()
  cliffhanger?: string;

  @IsOptional()
  @IsInt()
  word_target?: number;

  @IsOptional()
  @IsEnum(ChapterStatusDto)
  status?: "outline" | "draft" | "final";
}

export class RollbackChapterDto {
  @IsUUID()
  version_id!: string;
}
