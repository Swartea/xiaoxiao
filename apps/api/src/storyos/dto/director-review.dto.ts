import { IsBoolean, IsOptional, IsString, IsUUID } from "class-validator";

export class DirectorReviewDto {
  @IsOptional()
  @IsUUID()
  version_id?: string;

  @IsOptional()
  @IsString()
  style_preset?: string;

  @IsOptional()
  @IsBoolean()
  auto_fix?: boolean;
}
