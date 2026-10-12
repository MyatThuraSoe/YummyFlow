-- CreateTable
CREATE TABLE "BusinessDayClose" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "businessDate" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedById" TEXT NOT NULL,
    "report" JSONB NOT NULL,
    "expectedCash" DECIMAL(12,2) NOT NULL,
    "actualCash" DECIMAL(12,2) NOT NULL,
    "variance" DECIMAL(12,2) NOT NULL,
    "notes" TEXT,

    CONSTRAINT "BusinessDayClose_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BusinessDayClose_restaurantId_businessDate_key" ON "BusinessDayClose"("restaurantId", "businessDate");

-- CreateIndex
CREATE INDEX "BusinessDayClose_restaurantId_businessDate_idx" ON "BusinessDayClose"("restaurantId", "businessDate");

-- AddForeignKey
ALTER TABLE "BusinessDayClose" ADD CONSTRAINT "BusinessDayClose_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
