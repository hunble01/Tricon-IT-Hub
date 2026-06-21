-- CreateEnum
CREATE TYPE "TaskType" AS ENUM ('INSTALL', 'ASSIGN_DEVICE', 'RETURN_DEVICE', 'REPAIR', 'SETUP', 'ACCESS', 'PROCUREMENT', 'AUDIT', 'ONBOARDING', 'OFFBOARDING', 'OTHER');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "TaskSource" AS ENUM ('MANUAL', 'ONBOARDING', 'OFFBOARDING', 'TICKET', 'INTAKE', 'ASSISTANT');

-- NOTE: `prisma migrate dev` also emitted DROP INDEX statements for the raw-SQL
-- pgvector HNSW + Staff pg_trgm indexes (it can't see raw indexes in the schema)
-- and an unrelated InvoiceLineItem default change. Those were REMOVED by hand —
-- this migration is intentionally additive (Task table only) and must never drop
-- the recall/search indexes that earlier raw migrations created.

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" "TaskType" NOT NULL DEFAULT 'OTHER',
    "status" "TaskStatus" NOT NULL DEFAULT 'TODO',
    "priority" "TaskPriority" NOT NULL DEFAULT 'NORMAL',
    "source" "TaskSource" NOT NULL DEFAULT 'MANUAL',
    "staffId" TEXT,
    "deviceId" TEXT,
    "buildingId" TEXT,
    "ticketId" TEXT,
    "assigneeId" TEXT,
    "createdById" TEXT,
    "dueDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "sourceKey" TEXT,
    "calendarEventId" TEXT,
    "calendarSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Task_sourceKey_key" ON "Task"("sourceKey");

-- CreateIndex
CREATE INDEX "Task_status_priority_idx" ON "Task"("status", "priority");

-- CreateIndex
CREATE INDEX "Task_assigneeId_status_idx" ON "Task"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "Task_dueDate_idx" ON "Task"("dueDate");

-- CreateIndex
CREATE INDEX "Task_buildingId_idx" ON "Task"("buildingId");

-- CreateIndex
CREATE INDEX "Task_staffId_idx" ON "Task"("staffId");
