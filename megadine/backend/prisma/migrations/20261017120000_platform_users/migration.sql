-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'MANAGER';

-- DropIndex
DROP INDEX "User_isActive_idx";

-- AlterTable
ALTER TABLE "Restaurant" ADD COLUMN     "address" TEXT,
ADD COLUMN     "cashVarianceTolerance" DECIMAL(12,2) NOT NULL DEFAULT 10.00,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "logo" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "taxId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "firstName" TEXT,
ADD COLUMN     "lastName" TEXT,
ADD COLUMN     "passwordChangedAt" TIMESTAMP(3),
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "preferredLanguage" TEXT NOT NULL DEFAULT 'en',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "username" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "User_isActive_deletedAt_idx" ON "User"("isActive", "deletedAt");

