import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { AlertsModule } from "./alerts/alerts.module";
import { AssistantModule } from "./assistant/assistant.module";
import { AuditModule } from "./audit/audit.module";
import { AuthModule } from "./auth/auth.module";
import { JwtAuthGuard } from "./auth/jwt-auth.guard";
import { BriefingModule } from "./briefing/briefing.module";
import { BuildingsModule } from "./buildings/buildings.module";
import { ConnectionsModule } from "./connections/connections.module";
import { DashboardModule } from "./dashboard/dashboard.module";
import { DevicesModule } from "./devices/devices.module";
import { HealthController } from "./health.controller";
import { IntakeModule } from "./intake/intake.module";
import { KnowledgeModule } from "./knowledge/knowledge.module";
import { LlmModule } from "./llm/llm.module";
import { MemoryModule } from "./memory/memory.module";
import { OffboardingModule } from "./offboarding/offboarding.module";
import { OnboardingModule } from "./onboarding/onboarding.module";
import { PatternsModule } from "./patterns/patterns.module";
import { PrismaModule } from "./prisma/prisma.module";
import { ProcurementModule } from "./procurement/procurement.module";
import { RolesModule } from "./roles/roles.module";
import { SiteAuditModule } from "./site-audit/site-audit.module";
import { SlaModule } from "./sla/sla.module";
import { StaffModule } from "./staff/staff.module";
import { TasksModule } from "./tasks/tasks.module";
import { TicketsModule } from "./tickets/tickets.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env.local", ".env", "../../.env"],
    }),
    PrismaModule,
    AuditModule,
    LlmModule,
    MemoryModule,
    AuthModule,
    BuildingsModule,
    RolesModule,
    StaffModule,
    DevicesModule,
    OnboardingModule,
    OffboardingModule,
    TasksModule,
    TicketsModule,
    DashboardModule,
    IntakeModule,
    SiteAuditModule,
    ProcurementModule,
    ConnectionsModule,
    SlaModule,
    AlertsModule,
    BriefingModule,
    AssistantModule,
    KnowledgeModule,
    PatternsModule,
  ],
  controllers: [HealthController],
  providers: [
    // JWT is enforced everywhere; opt out per-route with @Public().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
