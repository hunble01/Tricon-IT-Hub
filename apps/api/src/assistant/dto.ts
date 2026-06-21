import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from "class-validator";

export class ChatMessageDto {
  @IsIn(["user", "assistant"])
  role!: "user" | "assistant";

  @IsString() @MaxLength(4000)
  content!: string;
}

export class ChatDto {
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  messages!: ChatMessageDto[];
}

export class ActDto {
  @IsString()
  tool!: string;

  @IsOptional() @IsObject()
  args?: Record<string, unknown>;
}
