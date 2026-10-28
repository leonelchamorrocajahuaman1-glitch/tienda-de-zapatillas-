-- CreateEnum
CREATE TYPE "public"."ReceiptTrigger" AS ENUM ('ON_CONFIRMED', 'ON_PAID');

-- CreateEnum
CREATE TYPE "public"."PrintJobStatus" AS ENUM ('PENDING', 'PRINTING', 'PRINTED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."PrintJobKind" AS ENUM ('RECEIPT', 'TEST');

-- CreateEnum
CREATE TYPE "public"."PrintJobReason" AS ENUM ('AUTO', 'MANUAL', 'REPRINT', 'RETRY', 'TEST');

-- CreateTable
CREATE TABLE "public"."ReceiptSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "autoPrint" BOOLEAN NOT NULL DEFAULT true,
    "trigger" "public"."ReceiptTrigger" NOT NULL DEFAULT 'ON_CONFIRMED',
    "paperWidth" INTEGER NOT NULL DEFAULT 80,
    "connection" TEXT NOT NULL DEFAULT 'windows',
    "printerName" TEXT,
    "networkHost" TEXT,
    "networkPort" INTEGER NOT NULL DEFAULT 9100,
    "agentId" TEXT,
    "charset" TEXT NOT NULL DEFAULT 'cp850',
    "cutPaper" BOOLEAN NOT NULL DEFAULT true,
    "printLogo" BOOLEAN NOT NULL DEFAULT true,
    "logoUrl" TEXT,
    "copies" INTEGER NOT NULL DEFAULT 1,
    "storeName" TEXT,
    "title" TEXT NOT NULL DEFAULT 'BOLETA DE VENTA',
    "series" TEXT NOT NULL DEFAULT 'B001',
    "headerLines" TEXT NOT NULL DEFAULT '',
    "footerMessage" TEXT NOT NULL DEFAULT '¡Gracias por tu compra!',
    "legalNote" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReceiptSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ReceiptSeries" (
    "series" TEXT NOT NULL,
    "last" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ReceiptSeries_pkey" PRIMARY KEY ("series")
);

-- CreateTable
CREATE TABLE "public"."Receipt" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "series" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "orderId" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PrintJob" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT,
    "kind" "public"."PrintJobKind" NOT NULL DEFAULT 'RECEIPT',
    "reason" "public"."PrintJobReason" NOT NULL,
    "status" "public"."PrintJobStatus" NOT NULL DEFAULT 'PENDING',
    "agentId" TEXT,
    "printerLabel" TEXT,
    "error" TEXT,
    "retriedAt" TIMESTAMP(3),
    "requestedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "PrintJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."PrintAgent" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "version" TEXT,
    "hostname" TEXT,
    "printers" JSONB,
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrintAgent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_code_key" ON "public"."Receipt"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_orderId_key" ON "public"."Receipt"("orderId");

-- CreateIndex
CREATE INDEX "Receipt_issuedAt_idx" ON "public"."Receipt"("issuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_series_number_key" ON "public"."Receipt"("series", "number");

-- CreateIndex
CREATE INDEX "PrintJob_status_createdAt_idx" ON "public"."PrintJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PrintJob_receiptId_idx" ON "public"."PrintJob"("receiptId");

-- CreateIndex
CREATE UNIQUE INDEX "PrintAgent_tokenHash_key" ON "public"."PrintAgent"("tokenHash");

-- AddForeignKey
ALTER TABLE "public"."Receipt" ADD CONSTRAINT "Receipt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "public"."Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PrintJob" ADD CONSTRAINT "PrintJob_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "public"."Receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PrintJob" ADD CONSTRAINT "PrintJob_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "public"."PrintAgent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."PrintJob" ADD CONSTRAINT "PrintJob_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
