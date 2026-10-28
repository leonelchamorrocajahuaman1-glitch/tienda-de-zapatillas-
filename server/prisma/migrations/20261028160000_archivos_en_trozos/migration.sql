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

-- Archivos grandes que ya estaban guardados en una sola fila: se pasan a trozos de
-- 2 MB dentro de PostgreSQL (sin pasar por la memoria del servidor). Servirlos de
-- una vez era lo que dejaba sin memoria al servidor de Render.
INSERT INTO "public"."StoredFileChunk" ("fileId", "index", "data")
SELECT f."id", s.i, substring(f."data" FROM s.i * 2097152 + 1 FOR 2097152)
FROM "public"."StoredFile" f
CROSS JOIN LATERAL generate_series(0, (length(f."data") - 1) / 2097152) AS s(i)
WHERE length(f."data") > 2097152;

UPDATE "public"."StoredFile"
SET "chunks" = (length("data") - 1) / 2097152 + 1, "data" = ''::bytea
WHERE length("data") > 2097152;
