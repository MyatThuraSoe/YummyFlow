-- CreateTable
CREATE TABLE "RoleCapability" (
    "id" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "capability" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoleCapability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalLimit" (
    "id" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "action" TEXT NOT NULL,
    "maxAmount" DECIMAL(12,2),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalLimit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "payload" JSONB,
    "amount" DECIMAL(12,2),
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "approverId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RoleCapability_role_capability_key" ON "RoleCapability"("role", "capability");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalLimit_role_action_key" ON "ApprovalLimit"("role", "action");

-- CreateIndex
CREATE INDEX "ApprovalRequest_restaurantId_status_createdAt_idx" ON "ApprovalRequest"("restaurantId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
