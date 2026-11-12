-- Temporary credentials flag + request idempotency log.

ALTER TABLE "User" ADD COLUMN "mustChangeCredential" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "RequestLog" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resultJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequestLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RequestLog_restaurantId_action_requestId_key" ON "RequestLog"("restaurantId", "action", "requestId");
CREATE INDEX "RequestLog_createdAt_idx" ON "RequestLog"("createdAt");
