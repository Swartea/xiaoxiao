import { IsNotEmpty, IsString, MaxLength } from "class-validator";

export class BootstrapProjectDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  logline!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  protagonist_brief!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  tone_setting!: string;
}
