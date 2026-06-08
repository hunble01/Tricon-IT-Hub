import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthenticatedUser } from "../auth/types";
import { AddLineItemsDto, CreatePurchaseDocDto, ExtractDto } from "./dto";
import { ProcurementService } from "./procurement.service";

interface UploadedFileLike {
  originalname: string;
  buffer: Buffer;
  mimetype: string;
  size: number;
}

@Controller("procurement")
export class ProcurementController {
  constructor(private readonly svc: ProcurementService) {}

  @Post("extract")
  extract(@Body() dto: ExtractDto) {
    return this.svc.extract(dto.rawText);
  }

  @Get()
  list() {
    return this.svc.list();
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.svc.get(id);
  }

  @Post()
  create(@Body() dto: CreatePurchaseDocDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.svc.create(dto, actor);
  }

  @Post(":id/line-items")
  addLineItems(
    @Param("id") id: string,
    @Body() dto: AddLineItemsDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.svc.addLineItems(id, dto, actor);
  }

  @Post(":id/process")
  process(@Param("id") id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.svc.process(id, actor);
  }

  @Post(":id/file")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 20 * 1024 * 1024 } }))
  attachFile(
    @Param("id") id: string,
    @UploadedFile() file: UploadedFileLike,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.svc.attachFile(id, file, actor);
  }

  @Get(":id/file")
  async getFile(@Param("id") id: string, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const f = await this.svc.getFileMeta(id);
    res.set({
      "Content-Type": f.contentType,
      "Content-Disposition": `inline; filename="${f.name}"`,
    });
    return new StreamableFile(f.stream);
  }
}
