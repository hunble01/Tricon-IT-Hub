import { BuildingStatus } from "@prisma/client";
import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

export class CreateBuildingDto {
  @IsString() @MinLength(1) @MaxLength(120)
  name!: string;

  @IsOptional() @IsString() @MaxLength(200)
  displayName?: string;

  @IsOptional() @IsString() @MaxLength(120)
  neighborhood?: string;

  @IsOptional() @IsEnum(BuildingStatus)
  status?: BuildingStatus;

  @IsOptional() @IsString()
  notes?: string;
}

export class UpdateBuildingDto {
  @IsOptional() @IsString() @MaxLength(200)
  displayName?: string;

  @IsOptional() @IsString() @MaxLength(120)
  neighborhood?: string;

  @IsOptional() @IsEnum(BuildingStatus)
  status?: BuildingStatus;

  @IsOptional() @IsString()
  notes?: string;
}
