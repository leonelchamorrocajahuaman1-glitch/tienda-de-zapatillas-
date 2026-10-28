-- Archivos grandes (modelos 3D) en trozos de 2 MB para no agotar la memoria del servidor.
-- Los archivos ya guardados siguen en "StoredFile"."data" (chunks = 0).

-- AlterTable
ALTER TABLE "public"."StoredFile" ADD COLUMN     "chunks" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "public"."StoredFileChunk" (
    "fileId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,

    CONSTRAINT "StoredFileChunk_pkey" PRIMARY KEY ("fileId","index")
);

-- AddForeignKey
ALTER TABLE "public"."StoredFileChunk" ADD CONSTRAINT "StoredFileChunk_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "public"."StoredFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
