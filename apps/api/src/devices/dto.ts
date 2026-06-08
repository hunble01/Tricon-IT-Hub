import { DeviceStatus, DeviceType } from "@prisma/client";
import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";

export class CreateDeviceDto {
  @IsEnum(DeviceType)
  type!: DeviceType;

  @IsOptional() @IsString() @MaxLength(80)
  assetTag?: string;

  @IsOptional() @IsString() @MaxLength(120)
  serialNumber?: string;

  @IsOptional() @IsString() @MaxLength(120)
  model?: string;

  @IsOptional() @IsEnum(DeviceStatus)
  status?: DeviceStatus;

  @IsOptional() @IsString()
  locationId?: string;

  @IsOptional() @IsString()
  notes?: string;
}

export class UpdateDeviceDto {
  @IsOptional() @IsString() @MaxLength(80)
  assetTag?: string;

  @IsOptional() @IsString() @MaxLength(120)
  serialNumber?: string;

  @IsOptional() @IsString() @MaxLength(120)
  model?: string;

  @IsOptional() @IsEnum(DeviceStatus)
  status?: DeviceStatus;

  @IsOptional() @IsString()
  locationId?: string | null;

  @IsOptional() @IsString()
  notes?: string;
}

export class AssignDeviceDto {
  @IsString()
  staffId!: string;

  @IsOptional() @IsString()
  notes?: string;
}

export class ReturnDeviceDto {
  @IsOptional() @IsString()
  returnedToLocationId?: string;

  @IsOptional() @IsString()
  notes?: string;
}
