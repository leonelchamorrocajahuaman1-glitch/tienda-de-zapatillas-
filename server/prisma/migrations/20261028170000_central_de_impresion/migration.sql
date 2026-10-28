-- Referencia de cada impresión enviada a la central de impresión externa
ALTER TABLE "public"."PrintJob" ADD COLUMN     "externalRef" TEXT;
