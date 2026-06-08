import { DeviceType, RoleCategory } from "@prisma/client";
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

export class RoleDeviceItem {
  @IsEnum(DeviceType)
  deviceType!: DeviceType;

  @IsOptional() @IsInt() @Min(1)
  quantity?: number;
}

export class CreateRoleDto {
  @IsString() @MinLength(1) @MaxLength(120)
  title!: string;

  @IsOptional() @IsEnum(RoleCategory)
  category?: RoleCategory;

  @IsOptional() @IsBoolean()
  isSharedDevice?: boolean;

  @IsOptional() @IsString()
  notes?: string;

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => RoleDeviceItem)
  devices?: RoleDeviceItem[];
}

export class UpdateRoleDto {
  @IsOptional() @IsEnum(RoleCategory)
  category?: RoleCategory;

  @IsOptional() @IsBoolean()
  isSharedDevice?: boolean;

  @IsOptional() @IsString()
  notes?: string;
}

export class SetRoleDevicesDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => RoleDeviceItem)
  devices!: RoleDeviceItem[];
}
