import { OffboardingStatus } from "@prisma/client";
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
} from "class-validator";

export class StartOffboardingDto {
  // Offboarding references an EXISTING staff member (never creates one).
  @IsString()
  staffId!: string;

  @IsOptional() @IsDateString()
  lastDay?: string;

  @IsOptional() @IsString()
  assignedTech?: string;

  @IsOptional() @IsString()
  reason?: string;

  @IsOptional() @IsString()
  notes?: string;
}

export class UpdateOffboardingDto {
  @IsOptional() @IsBoolean()
  adDisabled?: boolean;

  @IsOptional() @IsBoolean()
  badgeReturned?: boolean;

  @IsOptional() @IsBoolean()
  hardwareReturned?: boolean;

  @IsOptional() @IsBoolean()
  accountsRevoked?: boolean;

  @IsOptional() @IsEnum(OffboardingStatus)
  status?: OffboardingStatus;

  @IsOptional() @IsString()
  assignedTech?: string;

  @IsOptional() @IsString()
  reason?: string;

  @IsOptional() @IsString()
  notes?: string;
}
