import { IsOptional, IsString, IsUUID, MaxLength } from "class-validator";

export class AdaptChapterDto {
  @IsOptional()
  @IsUUID()
  version_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  target_platform?: string;
}
