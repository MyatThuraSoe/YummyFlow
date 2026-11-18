-- CreateTable
CREATE TABLE "HandoverNote" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "shiftId" TEXT,
    "businessDate" TIMESTAMP(3) NOT NULL,
    "ranOut" TEXT,
    "broke" TEXT,
    "late" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HandoverNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HandoverNote_restaurantId_businessDate_idx" ON "HandoverNote"("restaurantId", "businessDate");

-- CreateIndex
CREATE INDEX "HandoverNote_shiftId_idx" ON "HandoverNote"("shiftId");

-- AddForeignKey
ALTER TABLE "HandoverNote" ADD CONSTRAINT "HandoverNote_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandoverNote" ADD CONSTRAINT "HandoverNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
