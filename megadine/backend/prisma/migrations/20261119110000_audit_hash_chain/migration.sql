-- Tamper-evidence for the append-only audit trail. Existing rows keep NULL
-- (they predate chaining and are skipped by verification); new rows get a
-- per-restaurant sequence, a link to the previous hash and their own hash.
ALTER TABLE "AuditLog" ADD COLUMN "seq" INTEGER;
ALTER TABLE "AuditLog" ADD COLUMN "prevHash" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "hash" TEXT;

CREATE INDEX "AuditLog_restaurantId_seq_idx" ON "AuditLog"("restaurantId", "seq");
