import { Type } from "class-transformer";
import { DeviceStatus } from "@prisma/client";
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  ValidateNested,
} from "class-validator";

export class StartSiteAuditDto {
  @IsString()
  buildingId!: string;

  @IsOptional() @IsString()
  notes?: string;
}

export class AuditEntryInput {
  @IsString()
  deviceId!: string;

  @IsBoolean()
  found!: boolean;

  @IsOptional() @IsEnum(DeviceStatus)
  resultStatus?: DeviceStatus;
}

export class CompleteSiteAuditDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => AuditEntryInput)
  entries!: AuditEntryInput[];
}
