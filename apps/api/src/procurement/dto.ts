import { Type } from "class-transformer";
import { DeviceType, DocType } from "@prisma/client";
import {
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";

export class CreatePurchaseDocDto {
  @IsOptional() @IsString() @MaxLength(80)
  vendor?: string;

  @IsEnum(DocType)
  docType!: DocType;

  @IsOptional() @IsString() @MaxLength(80)
  docNumber?: string;

  @IsOptional() @IsString()
  purchaseDate?: string;

  @IsOptional() @IsString()
  destinationId?: string;

  @IsOptional() @IsNumber()
  totalCost?: number;

  @IsOptional() @IsString()
  filePath?: string;
}

export class LineItemInput {
  @IsString() @MaxLength(300)
  description!: string;

  @IsOptional() @IsInt() @Min(1)
  quantity?: number;

  @IsOptional() @IsNumber()
  unitCost?: number;

  @IsOptional() @IsArray() @IsString({ each: true })
  serialNumbers?: string[];

  @IsOptional() @IsEnum(DeviceType)
  mappedType?: DeviceType;
}

export class AddLineItemsDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => LineItemInput)
  lineItems!: LineItemInput[];
}

export class ExtractDto {
  @IsString() @MaxLength(20000)
  rawText!: string;
}
