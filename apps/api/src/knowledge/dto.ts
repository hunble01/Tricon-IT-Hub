import { IsArray, IsOptional, IsString, MaxLength } from "class-validator";

export class GenerateArticleDto {
  @IsString()
  ticketId!: string;
}

export class CreateArticleDto {
  @IsString() @MaxLength(200)
  title!: string;

  @IsString() @MaxLength(8000)
  content!: string;

  @IsOptional() @IsArray() @IsString({ each: true })
  tags?: string[];

  @IsOptional() @IsString() @MaxLength(120)
  source?: string;

  // When the article was generated from a ticket, link it for provenance.
  @IsOptional() @IsString()
  sourceTicketId?: string;
}
