-- Updates §6 — Inventory upgrade (chain-of-custody + procurement).
-- Additive only: extends enums, adds Device provenance columns, and adds the
-- site-audit + procurement tables. Applied via `prisma migrate deploy`.

-- AlterEnum: DeviceType (peripherals)
ALTER TYPE "DeviceType" ADD VALUE IF NOT EXISTS 'KEYBOARD';
ALTER TYPE "DeviceType" ADD VALUE IF NOT EXISTS 'MOUSE';
ALTER TYPE "DeviceType" ADD VALUE IF NOT EXISTS 'WEBCAM';
ALTER TYPE "DeviceType" ADD VALUE IF NOT EXISTS 'CABLE';
ALTER TYPE "DeviceType" ADD VALUE IF NOT EXISTS 'ADAPTER';

-- AlterEnum: DeviceStatus (audit reality)
ALTER TYPE "DeviceStatus" ADD VALUE IF NOT EXISTS 'MISSING';
ALTER TYPE "DeviceStatus" ADD VALUE IF NOT EXISTS 'MISPLACED';
ALTER TYPE "DeviceStatus" ADD VALUE IF NOT EXISTS 'OFFSITE';

-- CreateEnum
CREATE TYPE "DocType" AS ENUM ('QUOTE', 'RECEIPT', 'INVOICE');
CREATE TYPE "InvoiceStatus" AS ENUM ('UPLOADED', 'EXTRACTED', 'REVIEWED', 'PROCESSED');

-- AlterTable: Device provenance
ALTER TABLE "Device"
  ADD COLUMN "purchaseCost" DECIMAL(12,2),
  ADD COLUMN "purchaseDate" TIMESTAMP(3),
  ADD COLUMN "purchaseLocationId" TEXT,
  ADD COLUMN "invoiceLineItemId" TEXT;

CREATE INDEX "Device_invoiceLineItemId_idx" ON "Device"("invoiceLineItemId");

-- CreateTable: SiteAudit
CREATE TABLE "SiteAudit" (
  "id" TEXT NOT NULL,
  "buildingId" TEXT NOT NULL,
  "performedById" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "notes" TEXT,
  CONSTRAINT "SiteAudit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SiteAudit_buildingId_idx" ON "SiteAudit"("buildingId");

-- CreateTable: SiteAuditEntry
CREATE TABLE "SiteAuditEntry" (
  "id" TEXT NOT NULL,
  "siteAuditId" TEXT NOT NULL,
  "deviceId" TEXT,
  "expected" BOOLEAN NOT NULL DEFAULT true,
  "found" BOOLEAN NOT NULL DEFAULT false,
  "resultStatus" "DeviceStatus",
  "notes" TEXT,
  CONSTRAINT "SiteAuditEntry_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SiteAuditEntry_siteAuditId_idx" ON "SiteAuditEntry"("siteAuditId");
CREATE INDEX "SiteAuditEntry_deviceId_idx" ON "SiteAuditEntry"("deviceId");

-- CreateTable: PurchaseDoc
CREATE TABLE "PurchaseDoc" (
  "id" TEXT NOT NULL,
  "vendor" TEXT NOT NULL DEFAULT 'CDW',
  "docType" "DocType" NOT NULL,
  "docNumber" TEXT,
  "purchaseDate" TIMESTAMP(3),
  "destinationId" TEXT,
  "totalCost" DECIMAL(12,2),
  "filePath" TEXT NOT NULL,
  "status" "InvoiceStatus" NOT NULL DEFAULT 'UPLOADED',
  "extractionRaw" JSONB,
  "uploadedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PurchaseDoc_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PurchaseDoc_status_idx" ON "PurchaseDoc"("status");
CREATE INDEX "PurchaseDoc_destinationId_idx" ON "PurchaseDoc"("destinationId");

-- CreateTable: InvoiceLineItem
CREATE TABLE "InvoiceLineItem" (
  "id" TEXT NOT NULL,
  "purchaseDocId" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "unitCost" DECIMAL(12,2),
  "serialNumbers" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "mappedType" "DeviceType",
  "reviewed" BOOLEAN NOT NULL DEFAULT false,
  "createdDeviceIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  CONSTRAINT "InvoiceLineItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "InvoiceLineItem_purchaseDocId_idx" ON "InvoiceLineItem"("purchaseDocId");

-- AddForeignKey
ALTER TABLE "SiteAuditEntry" ADD CONSTRAINT "SiteAuditEntry_siteAuditId_fkey" FOREIGN KEY ("siteAuditId") REFERENCES "SiteAudit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InvoiceLineItem" ADD CONSTRAINT "InvoiceLineItem_purchaseDocId_fkey" FOREIGN KEY ("purchaseDocId") REFERENCES "PurchaseDoc"("id") ON DELETE CASCADE ON UPDATE CASCADE;
