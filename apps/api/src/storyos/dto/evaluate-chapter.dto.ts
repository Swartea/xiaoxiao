import { IsOptional, IsString, IsUUID } from "class-validator";

export class EvaluateChapterDto {
  @IsOptional()
  @IsUUID()
  version_id?: string;

  @IsOptional()
  @IsString()
  style_preset?: string;
}
