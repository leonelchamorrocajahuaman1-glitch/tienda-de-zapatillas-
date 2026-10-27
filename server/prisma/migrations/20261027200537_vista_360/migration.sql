-- CreateEnum
CREATE TYPE "public"."ImageKind" AS ENUM ('GALLERY', 'SPIN');

-- DropIndex
DROP INDEX "public"."ProductImage_productId_idx";

-- AlterTable
ALTER TABLE "public"."ProductImage" ADD COLUMN     "kind" "public"."ImageKind" NOT NULL DEFAULT 'GALLERY';

-- CreateIndex
CREATE INDEX "ProductImage_productId_kind_idx" ON "public"."ProductImage"("productId", "kind");
