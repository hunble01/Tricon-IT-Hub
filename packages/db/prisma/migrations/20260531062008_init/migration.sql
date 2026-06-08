-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'AGENT');

-- CreateEnum
CREATE TYPE "BuildingStatus" AS ENUM ('LIVE', 'OPENING', 'COMING_SOON', 'CORPORATE');

-- CreateEnum
CREATE TYPE "RoleCategory" AS ENUM ('BUILDING_STAFF', 'MANAGER', 'CORPORATE');

-- CreateEnum
CREATE TYPE "DeviceType" AS ENUM ('LAPTOP', 'SURFACE', 'PHONE', 'TABLET', 'HEADSET', 'DOCK', 'MONITOR', 'MINI_PC', 'USB_ADAPTER', 'OTHER');

-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('IN_STOCK', 'ASSIGNED', 'RETURNED', 'IN_REPAIR', 'RETIRED');

-- CreateEnum
CREATE TYPE "EmploymentStatus" AS ENUM ('ONBOARDING', 'ACTIVE', 'NO_SHOW', 'DEPARTED');

-- CreateEnum
CREATE TYPE "StaffSource" AS ENUM ('ONBOARDING', 'TICKET', 'MANUAL');

-- CreateEnum
CREATE TYPE "OnboardingDeviceStatus" AS ENUM ('PENDING', 'ALREADY_SET_UP', 'DONE');

-- CreateEnum
CREATE TYPE "TicketSource" AS ENUM ('MANUAL', 'ZENDESK', 'SERVICENOW');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'PENDING', 'RESOLVED');

-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "MemoryType" AS ENUM ('TICKET_RESOLUTION', 'KB', 'STAFF_CONTEXT', 'ACTION_LOG', 'NOTE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'AGENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Building" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT,
    "neighborhood" TEXT,
    "status" "BuildingStatus" NOT NULL DEFAULT 'LIVE',
    "notes" TEXT,

    CONSTRAINT "Building_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" "RoleCategory" NOT NULL DEFAULT 'BUILDING_STAFF',
    "isSharedDevice" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoleDeviceProfile" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "deviceType" "DeviceType" NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "RoleDeviceProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Staff" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "adPrefix" TEXT,
    "roleId" TEXT,
    "buildingId" TEXT,
    "startDate" TIMESTAMP(3),
    "employmentStatus" "EmploymentStatus" NOT NULL DEFAULT 'ONBOARDING',
    "email" TEXT,
    "phone" TEXT,
    "source" "StaffSource" NOT NULL DEFAULT 'MANUAL',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "assetTag" TEXT,
    "serialNumber" TEXT,
    "type" "DeviceType" NOT NULL,
    "model" TEXT,
    "status" "DeviceStatus" NOT NULL DEFAULT 'IN_STOCK',
    "locationId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceAssignment" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "assignedById" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "returnedAt" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "DeviceAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Onboarding" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "stockSourceId" TEXT,
    "startDate" TIMESTAMP(3),
    "adDone" BOOLEAN NOT NULL DEFAULT false,
    "badgeDone" BOOLEAN NOT NULL DEFAULT false,
    "hardwareDone" BOOLEAN NOT NULL DEFAULT false,
    "softwareDone" BOOLEAN NOT NULL DEFAULT false,
    "recommendedDevices" JSONB NOT NULL,
    "deviceStatus" "OnboardingDeviceStatus" NOT NULL DEFAULT 'PENDING',
    "assignedTech" TEXT,
    "monthLabel" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Onboarding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL,
    "source" "TicketSource" NOT NULL DEFAULT 'MANUAL',
    "externalId" TEXT,
    "requesterStaffId" TEXT,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "category" TEXT,
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "TicketPriority" NOT NULL DEFAULT 'NORMAL',
    "slaDueAt" TIMESTAMP(3),
    "lastReplyAt" TIMESTAMP(3),
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketDraft" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "suggestedReply" TEXT NOT NULL,
    "suggestedNote" TEXT,
    "retrievedContext" JSONB,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeArticle" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "source" TEXT,
    "tags" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeArticle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemoryEntry" (
    "id" TEXT NOT NULL,
    "type" "MemoryType" NOT NULL,
    "refTable" TEXT,
    "refId" TEXT,
    "content" TEXT NOT NULL,
    "embedding" vector(1536),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemoryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Building_name_key" ON "Building"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Role_title_key" ON "Role"("title");

-- CreateIndex
CREATE UNIQUE INDEX "RoleDeviceProfile_roleId_deviceType_key" ON "RoleDeviceProfile"("roleId", "deviceType");

-- CreateIndex
CREATE INDEX "Staff_buildingId_idx" ON "Staff"("buildingId");

-- CreateIndex
CREATE INDEX "Staff_lastName_idx" ON "Staff"("lastName");

-- CreateIndex
CREATE INDEX "Staff_adPrefix_idx" ON "Staff"("adPrefix");

-- CreateIndex
CREATE UNIQUE INDEX "Device_assetTag_key" ON "Device"("assetTag");

-- CreateIndex
CREATE UNIQUE INDEX "Device_serialNumber_key" ON "Device"("serialNumber");

-- CreateIndex
CREATE INDEX "Device_type_status_idx" ON "Device"("type", "status");

-- CreateIndex
CREATE INDEX "Device_locationId_idx" ON "Device"("locationId");

-- CreateIndex
CREATE INDEX "DeviceAssignment_deviceId_idx" ON "DeviceAssignment"("deviceId");

-- CreateIndex
CREATE INDEX "DeviceAssignment_staffId_idx" ON "DeviceAssignment"("staffId");

-- CreateIndex
CREATE INDEX "DeviceAssignment_returnedAt_idx" ON "DeviceAssignment"("returnedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Onboarding_staffId_key" ON "Onboarding"("staffId");

-- CreateIndex
CREATE INDEX "Onboarding_monthLabel_idx" ON "Onboarding"("monthLabel");

-- CreateIndex
CREATE INDEX "Onboarding_deviceStatus_idx" ON "Onboarding"("deviceStatus");

-- CreateIndex
CREATE INDEX "Ticket_status_priority_idx" ON "Ticket"("status", "priority");

-- CreateIndex
CREATE INDEX "Ticket_requesterStaffId_idx" ON "Ticket"("requesterStaffId");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_source_externalId_key" ON "Ticket"("source", "externalId");

-- CreateIndex
CREATE INDEX "TicketDraft_ticketId_idx" ON "TicketDraft"("ticketId");

-- CreateIndex
CREATE INDEX "KnowledgeArticle_title_idx" ON "KnowledgeArticle"("title");

-- CreateIndex
CREATE INDEX "MemoryEntry_type_idx" ON "MemoryEntry"("type");

-- CreateIndex
CREATE INDEX "MemoryEntry_refTable_refId_idx" ON "MemoryEntry"("refTable", "refId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "RoleDeviceProfile" ADD CONSTRAINT "RoleDeviceProfile_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Staff" ADD CONSTRAINT "Staff_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Staff" ADD CONSTRAINT "Staff_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Building"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceAssignment" ADD CONSTRAINT "DeviceAssignment_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceAssignment" ADD CONSTRAINT "DeviceAssignment_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceAssignment" ADD CONSTRAINT "DeviceAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Onboarding" ADD CONSTRAINT "Onboarding_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Onboarding" ADD CONSTRAINT "Onboarding_stockSourceId_fkey" FOREIGN KEY ("stockSourceId") REFERENCES "Building"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_requesterStaffId_fkey" FOREIGN KEY ("requesterStaffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketDraft" ADD CONSTRAINT "TicketDraft_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────
-- Manual: indexes that Prisma cannot emit from the schema DSL.
-- ─────────────────────────────────────────────────────────────

-- HNSW index on MemoryEntry.embedding for cosine similarity ANN search.
-- Used by MemoryService.recall() via $queryRaw:
--   SELECT * FROM "MemoryEntry" ORDER BY embedding <=> $1 LIMIT $k
-- HNSW has better recall than IVFFlat without needing an upfront `lists`
-- tuning based on row count; trade-off is slower inserts and more memory.
CREATE INDEX "MemoryEntry_embedding_hnsw_idx"
  ON "MemoryEntry"
  USING hnsw ("embedding" vector_cosine_ops);

-- pg_trgm GIN indexes for the StaffMatcher fuzzy lookup
-- (similarity("fullName", $query) and ILIKE searches).
CREATE INDEX "Staff_fullName_trgm_idx"
  ON "Staff"
  USING gin ("fullName" gin_trgm_ops);

CREATE INDEX "Staff_firstName_trgm_idx"
  ON "Staff"
  USING gin ("firstName" gin_trgm_ops);

CREATE INDEX "Staff_lastName_trgm_idx"
  ON "Staff"
  USING gin ("lastName" gin_trgm_ops);
