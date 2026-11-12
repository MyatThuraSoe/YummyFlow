-- P1 integrity: kitchen rounds, unique staff PINs, one open session per table.

-- ── Kitchen rounds ─────────────────────────────────────────
ALTER TABLE "KitchenTicket" ADD COLUMN "round" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "OrderLine" ADD COLUMN "round" INTEGER NOT NULL DEFAULT 0;

-- Lines that already have a ticket were sent in the first round.
UPDATE "OrderLine" ol
SET "round" = 1
WHERE EXISTS (
  SELECT 1 FROM "KitchenTicketLine" ktl WHERE ktl."orderLineId" = ol."id"
);

-- ── Unique PIN lookup (keyed hash, never the PIN itself) ───
ALTER TABLE "User" ADD COLUMN "pinLookup" TEXT;
CREATE UNIQUE INDEX "User_restaurantId_pinLookup_key" ON "User"("restaurantId", "pinLookup");

-- ── One open table session per table ───────────────────────
-- Keep the most recent session and close the rest so the index can build.
UPDATE "TableSession"
SET status = 'CLOSED', "closedAt" = NOW()
WHERE status = 'OPEN'
  AND id NOT IN (
    SELECT DISTINCT ON ("tableId") id
    FROM "TableSession"
    WHERE status = 'OPEN'
    ORDER BY "tableId", "openedAt" DESC, id DESC
  );

CREATE UNIQUE INDEX "TableSession_tableId_open_key"
  ON "TableSession"("tableId")
  WHERE status = 'OPEN';
