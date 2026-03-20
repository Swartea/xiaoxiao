import { Type } from "class-transformer";
import { IsArray, IsIn, IsOptional, IsString, MaxLength, ValidateNested } from "class-validator";

class AuthorAdviceMessageDto {
  @IsIn(["user", "assistant"])
  role!: "user" | "assistant";

  @IsString()
  @MaxLength(4000)
  content!: string;
}

export class AuthorAdviceDto {
  @IsString()
  @MaxLength(2000)
  question!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30000)
  draft_text?: string;

  @IsOptional()
  @IsString()
  version_id?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AuthorAdviceMessageDto)
  messages?: AuthorAdviceMessageDto[];
}
