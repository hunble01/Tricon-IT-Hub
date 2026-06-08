-- Phase 2 — operational layer: offboarding, ticket assignment + send log.
-- Additive only: new enum, new tables (Offboarding, TicketReply), and new
-- nullable columns on Ticket. Applied via `prisma migrate deploy`.

-- CreateEnum: OffboardingStatus
CREATE TYPE "OffboardingStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED');

-- CreateTable: Offboarding (mirror of Onboarding)
CREATE TABLE "Offboarding" (
  "id" TEXT NOT NULL,
  "staffId" TEXT NOT NULL,
  "lastDay" TIMESTAMP(3),
  "adDisabled" BOOLEAN NOT NULL DEFAULT false,
  "badgeReturned" BOOLEAN NOT NULL DEFAULT false,
  "hardwareReturned" BOOLEAN NOT NULL DEFAULT false,
  "accountsRevoked" BOOLEAN NOT NULL DEFAULT false,
  "status" "OffboardingStatus" NOT NULL DEFAULT 'PENDING',
  "assignedTech" TEXT,
  "monthLabel" TEXT,
  "reason" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Offboarding_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Offboarding_staffId_key" ON "Offboarding"("staffId");
CREATE INDEX "Offboarding_monthLabel_idx" ON "Offboarding"("monthLabel");
CREATE INDEX "Offboarding_status_idx" ON "Offboarding"("status");

-- AlterTable: Ticket — delegated per-agent assignment.
ALTER TABLE "Ticket"
  ADD COLUMN "assignedToUserId" TEXT,
  ADD COLUMN "assignedAt" TIMESTAMP(3);
CREATE INDEX "Ticket_assignedToUserId_idx" ON "Ticket"("assignedToUserId");
CREATE INDEX "Ticket_slaDueAt_idx" ON "Ticket"("slaDueAt");

-- CreateTable: TicketReply (human-in-the-loop send log)
CREATE TABLE "TicketReply" (
  "id" TEXT NOT NULL,
  "ticketId" TEXT NOT NULL,
  "userId" TEXT,
  "channel" "TicketSource" NOT NULL,
  "body" TEXT NOT NULL,
  "internalNote" TEXT,
  "mode" TEXT NOT NULL DEFAULT 'sandbox',
  "delivered" BOOLEAN NOT NULL DEFAULT false,
  "externalRef" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TicketReply_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TicketReply_ticketId_idx" ON "TicketReply"("ticketId");

-- AddForeignKey
ALTER TABLE "Offboarding" ADD CONSTRAINT "Offboarding_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TicketReply" ADD CONSTRAINT "TicketReply_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TicketReply" ADD CONSTRAINT "TicketReply_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
