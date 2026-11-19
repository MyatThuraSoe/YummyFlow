-- Employee pay area: roster, attendance, advances, deductions, tips, meals, notes.

CREATE TABLE "RosterShift" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "shift" TEXT NOT NULL DEFAULT 'MORNING',
    "position" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RosterShift_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Attendance" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "businessDate" TIMESTAMP(3) NOT NULL,
    "clockIn" TIMESTAMP(3) NOT NULL,
    "clockOut" TIMESTAMP(3),
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "lateMinutes" INTEGER NOT NULL DEFAULT 0,
    "earlyMinutes" INTEGER NOT NULL DEFAULT 0,
    "method" TEXT NOT NULL DEFAULT 'PIN',
    "terminalId" TEXT,
    "editedById" TEXT,
    "editReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StaffAdvance" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "businessDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" TEXT,
    "repaymentDate" TIMESTAMP(3),
    "acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StaffAdvance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StaffDeduction" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "businessDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" TEXT,
    "acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StaffDeduction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TipEntry" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "businessDate" TIMESTAMP(3) NOT NULL,
    "tipAmount" DECIMAL(12,2) NOT NULL,
    "serviceCharge" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "rule" TEXT NOT NULL DEFAULT 'EQUAL',
    "allocations" JSONB,
    "enteredById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TipEntry_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StaffMeal" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "businessDate" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "cost" DECIMAL(12,2),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StaffMeal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmployeeNote" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmployeeNote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RosterShift_restaurantId_employeeId_dayOfWeek_shift_key" ON "RosterShift"("restaurantId", "employeeId", "dayOfWeek", "shift");
CREATE INDEX "RosterShift_restaurantId_dayOfWeek_idx" ON "RosterShift"("restaurantId", "dayOfWeek");
CREATE UNIQUE INDEX "Attendance_employeeId_businessDate_key" ON "Attendance"("employeeId", "businessDate");
CREATE INDEX "Attendance_restaurantId_businessDate_idx" ON "Attendance"("restaurantId", "businessDate");
CREATE INDEX "StaffAdvance_restaurantId_businessDate_idx" ON "StaffAdvance"("restaurantId", "businessDate");
CREATE INDEX "StaffAdvance_employeeId_idx" ON "StaffAdvance"("employeeId");
CREATE INDEX "StaffDeduction_restaurantId_businessDate_idx" ON "StaffDeduction"("restaurantId", "businessDate");
CREATE INDEX "StaffDeduction_employeeId_idx" ON "StaffDeduction"("employeeId");
CREATE UNIQUE INDEX "TipEntry_restaurantId_businessDate_key" ON "TipEntry"("restaurantId", "businessDate");
CREATE INDEX "TipEntry_restaurantId_businessDate_idx" ON "TipEntry"("restaurantId", "businessDate");
CREATE INDEX "StaffMeal_restaurantId_businessDate_idx" ON "StaffMeal"("restaurantId", "businessDate");
CREATE INDEX "StaffMeal_employeeId_idx" ON "StaffMeal"("employeeId");
CREATE INDEX "EmployeeNote_employeeId_createdAt_idx" ON "EmployeeNote"("employeeId", "createdAt");

ALTER TABLE "RosterShift" ADD CONSTRAINT "RosterShift_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RosterShift" ADD CONSTRAINT "RosterShift_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StaffAdvance" ADD CONSTRAINT "StaffAdvance_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StaffAdvance" ADD CONSTRAINT "StaffAdvance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StaffDeduction" ADD CONSTRAINT "StaffDeduction_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StaffDeduction" ADD CONSTRAINT "StaffDeduction_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TipEntry" ADD CONSTRAINT "TipEntry_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StaffMeal" ADD CONSTRAINT "StaffMeal_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StaffMeal" ADD CONSTRAINT "StaffMeal_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmployeeNote" ADD CONSTRAINT "EmployeeNote_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmployeeNote" ADD CONSTRAINT "EmployeeNote_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
