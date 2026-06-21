import { TaskPriority, TaskSource, TaskStatus, TaskType } from "@prisma/client";
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from "class-validator";

export class CreateTaskDto {
  @IsString() @MaxLength(200)
  title!: string;

  @IsOptional() @IsString() @MaxLength(2000)
  description?: string;

  @IsOptional() @IsEnum(TaskType)
  type?: TaskType;

  @IsOptional() @IsEnum(TaskPriority)
  priority?: TaskPriority;

  // Source is server-controlled for generated tasks; manual creates may omit it.
  @IsOptional() @IsEnum(TaskSource)
  source?: TaskSource;

  @IsOptional() @IsString()
  staffId?: string;

  @IsOptional() @IsString()
  deviceId?: string;

  @IsOptional() @IsString()
  buildingId?: string;

  @IsOptional() @IsString()
  ticketId?: string;

  @IsOptional() @IsString()
  assigneeId?: string;

  @IsOptional() @IsDateString()
  dueDate?: string;
}

export class UpdateTaskDto {
  @IsOptional() @IsString() @MaxLength(200)
  title?: string;

  @IsOptional() @IsString() @MaxLength(2000)
  description?: string;

  @IsOptional() @IsEnum(TaskType)
  type?: TaskType;

  @IsOptional() @IsEnum(TaskStatus)
  status?: TaskStatus;

  @IsOptional() @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @IsOptional() @IsString()
  staffId?: string | null;

  @IsOptional() @IsString()
  deviceId?: string | null;

  @IsOptional() @IsString()
  buildingId?: string | null;

  @IsOptional() @IsString()
  ticketId?: string | null;

  @IsOptional() @IsString()
  assigneeId?: string | null;

  @IsOptional() @IsDateString()
  dueDate?: string | null;
}

export class ListTasksQueryDto {
  @IsOptional() @IsEnum(TaskStatus)
  status?: TaskStatus;

  @IsOptional() @IsEnum(TaskType)
  type?: TaskType;

  @IsOptional() @IsEnum(TaskSource)
  source?: TaskSource;

  @IsOptional() @IsString()
  assigneeId?: string;

  @IsOptional() @IsString()
  buildingId?: string;

  @IsOptional() @IsString()
  staffId?: string;

  @IsOptional() @IsString() @MaxLength(120)
  q?: string;
}
