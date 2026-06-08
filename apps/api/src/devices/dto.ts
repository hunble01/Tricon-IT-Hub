import { DeviceStatus, DeviceType } from "@prisma/client";
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
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

  // Updates §6a — purchase provenance for hand-entered / legacy assets,
  // so manually-added devices carry the same cost/age data procurement sets.
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  purchaseCost?: number;

  @IsOptional() @IsDateString()
  purchaseDate?: string;

  @IsOptional() @IsString()
  purchaseLocationId?: string;
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

  // Updates §6a — purchase provenance (editable after creation).
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0)
  purchaseCost?: number | null;

  @IsOptional() @IsDateString()
  purchaseDate?: string | null;

  @IsOptional() @IsString()
  purchaseLocationId?: string | null;
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
