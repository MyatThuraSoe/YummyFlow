-- F-16: attribute refunds to an actor and a shift.
ALTER TABLE "Refund" ADD COLUMN "actorId" TEXT;
ALTER TABLE "Refund" ADD COLUMN "shiftId" TEXT;
