CREATE TABLE "StationPrinter" (
  "id" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "station" "Station" NOT NULL,
  "name" TEXT NOT NULL,
  "ip" TEXT NOT NULL,
  "port" INTEGER NOT NULL DEFAULT 9100,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StationPrinter_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StationPrinter_restaurantId_station_key" ON "StationPrinter"("restaurantId", "station");

CREATE TABLE "PrintJob" (
  "id" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "orderId" TEXT,
  "ticketId" TEXT,
  "kind" TEXT NOT NULL,
  "station" "Station",
  "printerIp" TEXT,
  "port" INTEGER,
  "payload" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMP(3),
  CONSTRAINT "PrintJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PrintJob_restaurantId_status_nextAttemptAt_idx" ON "PrintJob"("restaurantId", "status", "nextAttemptAt");
