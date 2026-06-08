import { OnboardingDeviceStatus } from "@prisma/client";
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

export class StartOnboardingDto {
  @IsString() @MinLength(1) @MaxLength(120)
  fullName!: string;

  @IsString()
  roleId!: string;

  @IsString()
  buildingId!: string;

  @IsOptional() @IsString()
  stockSourceId?: string;

  @IsOptional() @IsDateString()
  startDate?: string;

  @IsOptional() @IsString()
  assignedTech?: string;

  @IsOptional() @IsString()
  notes?: string;
}

export class UpdateOnboardingDto {
  @IsOptional() @IsBoolean()
  adDone?: boolean;

  @IsOptional() @IsBoolean()
  badgeDone?: boolean;

  @IsOptional() @IsBoolean()
  hardwareDone?: boolean;

  @IsOptional() @IsBoolean()
  softwareDone?: boolean;

  @IsOptional() @IsEnum(OnboardingDeviceStatus)
  deviceStatus?: OnboardingDeviceStatus;

  @IsOptional() @IsString()
  assignedTech?: string;

  @IsOptional() @IsString()
  notes?: string;

  @IsOptional() @IsString()
  stockSourceId?: string | null;
}

export class AssignedDeviceItem {
  @IsString()
  deviceId!: string;
}

export class AssignOnboardingDevicesDto {
  @IsArray() @ArrayNotEmpty() @ValidateNested({ each: true }) @Type(() => AssignedDeviceItem)
  assignments!: AssignedDeviceItem[];
}
