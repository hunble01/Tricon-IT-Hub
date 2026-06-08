import { Type } from "class-transformer";
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";

export type IntakeHint = "AUTO" | "NEW_HIRE" | "DEVICES" | "STAFF";

export class AnalyzeIntakeDto {
  @IsString() @MaxLength(20000)
  rawText!: string;

  @IsOptional() @IsIn(["AUTO", "NEW_HIRE", "DEVICES", "STAFF"])
  hint?: IntakeHint;
}

export class CommitNewHireItem {
  @IsString() fullName!: string;
  @IsString() roleId!: string;
  @IsString() buildingId!: string;
  @IsOptional() @IsString() startDate?: string;
}

export class CommitDeviceItem {
  @IsString() type!: string;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsString() serialNumber?: string;
  @IsOptional() @IsString() assetTag?: string;
  @IsOptional() @IsInt() @Min(1) quantity?: number;
  @IsOptional() @IsString() locationId?: string;
}

export class CommitStaffItem {
  @IsString() fullName!: string;
  @IsOptional() @IsString() roleId?: string;
  @IsOptional() @IsString() buildingId?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() phone?: string;
}

export class CommitIntakeDto {
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => CommitNewHireItem)
  newHires?: CommitNewHireItem[];

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => CommitDeviceItem)
  devices?: CommitDeviceItem[];

  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => CommitStaffItem)
  staff?: CommitStaffItem[];
}
