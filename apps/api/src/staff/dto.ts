import { EmploymentStatus, StaffSource } from "@prisma/client";
import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

export class CreateStaffDto {
  @IsString() @MinLength(1) @MaxLength(120)
  fullName!: string;

  @IsOptional() @IsString() @MaxLength(80)
  firstName?: string;

  @IsOptional() @IsString() @MaxLength(80)
  lastName?: string;

  @IsOptional() @IsString() @MaxLength(80)
  adPrefix?: string;

  @IsOptional() @IsString()
  roleId?: string;

  @IsOptional() @IsString()
  buildingId?: string;

  @IsOptional() @IsDateString()
  startDate?: string;

  @IsOptional() @IsEnum(EmploymentStatus)
  employmentStatus?: EmploymentStatus;

  @IsOptional() @IsEmail()
  email?: string;

  @IsOptional() @IsString() @MaxLength(40)
  phone?: string;

  @IsOptional() @IsEnum(StaffSource)
  source?: StaffSource;

  @IsOptional() @IsString()
  notes?: string;
}

export class UpdateStaffDto {
  @IsOptional() @IsString() @MaxLength(80)
  adPrefix?: string;

  @IsOptional() @IsString()
  roleId?: string | null;

  @IsOptional() @IsString()
  buildingId?: string | null;

  @IsOptional() @IsDateString()
  startDate?: string;

  @IsOptional() @IsEnum(EmploymentStatus)
  employmentStatus?: EmploymentStatus;

  @IsOptional() @IsEmail()
  email?: string;

  @IsOptional() @IsString() @MaxLength(40)
  phone?: string;

  @IsOptional() @IsString()
  notes?: string;
}

export class MatchStaffDto {
  @IsString() @MinLength(1)
  name!: string;

  @IsOptional() @IsString()
  buildingId?: string;
}

export class SuggestAdPrefixDto {
  @IsString() @MinLength(1) @MaxLength(80)
  firstName!: string;

  @IsString() @MinLength(1) @MaxLength(80)
  lastName!: string;
}
