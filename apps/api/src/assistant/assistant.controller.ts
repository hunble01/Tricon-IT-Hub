import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthenticatedUser } from "../auth/types";
import { AssistantService } from "./assistant.service";
import { ActDto, ChatDto } from "./dto";
import { TranscriptionService } from "./transcription.service";
import { TOOLS } from "./tools";

interface UploadedFileLike {
  originalname: string;
  buffer: Buffer;
  mimetype: string;
  size: number;
}

@Controller("assistant")
export class AssistantController {
  constructor(
    private readonly svc: AssistantService,
    private readonly transcription: TranscriptionService,
  ) {}

  /** Capabilities — lets the UI show what the assistant can do / whether voice is on. */
  @Get("capabilities")
  capabilities() {
    return {
      tools: TOOLS.map((t) => ({ name: t.name, kind: t.kind, description: t.description })),
      voice: this.transcription.available,
    };
  }

  @Post("chat")
  chat(@Body() dto: ChatDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.svc.chat(dto, actor);
  }

  /** Execute a write the user confirmed from a proposal. */
  @Post("act")
  act(@Body() dto: ActDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.svc.act(dto.tool, dto.args ?? {}, actor);
  }

  @Post("transcribe")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 25 * 1024 * 1024 } }))
  async transcribe(@UploadedFile() file: UploadedFileLike) {
    if (!file?.buffer?.length) throw new BadRequestException("No audio uploaded");
    return this.transcription.transcribe(file.buffer, file.mimetype, file.originalname);
  }
}
