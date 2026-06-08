import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtStrategy } from "./jwt.strategy";
import { LocalAuthProvider } from "./local-auth.provider";
import { AUTH_PROVIDER } from "./tokens";

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>("JWT_SECRET");
        if (!secret) throw new Error("JWT_SECRET is not configured");
        return {
          secret,
          signOptions: { expiresIn: config.get<string>("JWT_EXPIRES_IN") ?? "12h" },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    LocalAuthProvider,
    { provide: AUTH_PROVIDER, useExisting: LocalAuthProvider },
  ],
  exports: [AuthService],
})
export class AuthModule {}
