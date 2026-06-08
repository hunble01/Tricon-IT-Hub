import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class DraftTicketDto {
  /** Paste the whole ticket here; subject/body are derived if omitted. */
  @IsOptional() @IsString() @MaxLength(20000)
  rawText?: string;

  @IsOptional() @IsString() @MaxLength(200)
  subject?: string;

  @IsOptional() @IsString() @MaxLength(20000)
  body?: string;

  @IsOptional() @IsString() @MaxLength(120)
  requesterName?: string;

  @IsOptional() @IsString() @MaxLength(120)
  buildingHint?: string;

  @IsOptional() @IsString() @MaxLength(60)
  category?: string;
}

export class ResolveTicketDto {
  @IsString() @MinLength(1) @MaxLength(20000)
  resolution!: string;
}

export class SendReplyDto {
  @IsString() @MinLength(1) @MaxLength(20000)
  body!: string;

  @IsOptional() @IsString() @MaxLength(20000)
  internalNote?: string;
}

export class AssignTicketDto {
  // Assign to a specific agent. Omit to claim for the acting agent.
  @IsOptional() @IsString()
  userId?: string;
}
