CREATE TABLE "UserCapabilityOverride" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "capability" TEXT NOT NULL,
  "granted" BOOLEAN NOT NULL DEFAULT true,
  "reason" TEXT,
  "endsAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdBy" TEXT,
  CONSTRAINT "UserCapabilityOverride_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "UserCapabilityOverride_userId_idx" ON "UserCapabilityOverride"("userId");

ALTER TABLE "UserCapabilityOverride" ADD CONSTRAINT "UserCapabilityOverride_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Employee" (
  "id" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "userId" TEXT,
  "firstName" TEXT NOT NULL,
  "lastName" TEXT,
  "phone" TEXT,
  "emergencyContact" TEXT,
  "address" TEXT,
  "idNumber" TEXT,
  "position" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "startDate" TIMESTAMP(3),
  "endDate" TIMESTAMP(3),
  "payType" TEXT,
  "payRate" DECIMAL(12,2),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Employee_userId_key" ON "Employee"("userId");
CREATE INDEX "Employee_restaurantId_status_idx" ON "Employee"("restaurantId", "status");

ALTER TABLE "Employee" ADD CONSTRAINT "Employee_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
