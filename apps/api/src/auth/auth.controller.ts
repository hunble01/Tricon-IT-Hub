import { Body, Controller, Get, HttpCode, Post, UseGuards } from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { AuthService } from "./auth.service";
import { CurrentUser } from "./current-user.decorator";
import { LoginDto } from "./dto/login.dto";
import { RegisterDto } from "./dto/register.dto";
import { Public } from "./public.decorator";
import { Roles } from "./roles.decorator";
import { RolesGuard } from "./roles.guard";
import { AuthenticatedUser } from "./types";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Only ADMINs may create new users from the app; first ADMIN is seeded. */
  @Post("register")
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  register(@Body() dto: RegisterDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.auth.register(dto, actor);
  }

  @Public()
  @Post("login")
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Get("me")
  me(@CurrentUser() user: AuthenticatedUser) {
    return { user };
  }
}
