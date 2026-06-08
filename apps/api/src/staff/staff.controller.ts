import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { StaffSource } from "@prisma/client";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthenticatedUser } from "../auth/types";
import { AdPrefixService } from "./ad-prefix.service";
import {
  CreateStaffDto,
  MatchStaffDto,
  SuggestAdPrefixDto,
  UpdateStaffDto,
} from "./dto";
import { StaffMatcherService } from "./staff-matcher.service";
import { StaffService } from "./staff.service";

@Controller("staff")
export class StaffController {
  constructor(
    private readonly svc: StaffService,
    private readonly matcher: StaffMatcherService,
    private readonly adPrefix: AdPrefixService,
  ) {}

  @Get()
  list(
    @Query("buildingId") buildingId?: string,
    @Query("source") source?: StaffSource,
    @Query("q") q?: string,
  ) {
    return this.svc.list({ buildingId, source, q });
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.svc.get(id);
  }

  @Post()
  create(@Body() dto: CreateStaffDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.svc.create(dto, actor);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateStaffDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.svc.update(id, dto, actor);
  }

  @Post("match")
  match(@Body() dto: MatchStaffDto) {
    return this.matcher.match(dto.name, { buildingId: dto.buildingId });
  }

  @Post("ad-prefix/suggest")
  suggest(@Body() dto: SuggestAdPrefixDto) {
    return this.adPrefix.suggest(dto.firstName, dto.lastName);
  }
}
