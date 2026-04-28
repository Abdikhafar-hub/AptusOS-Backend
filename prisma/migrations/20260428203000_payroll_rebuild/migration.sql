DO $$ BEGIN
  CREATE TYPE "PayrollPayFrequency" AS ENUM ('MONTHLY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "CompensationValueType" AS ENUM ('FIXED', 'PERCENTAGE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "DeductionCategory" AS ENUM ('TAX', 'LOAN', 'BENEFIT', 'STATUTORY', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "DeductionTiming" AS ENUM ('PRE_TAX', 'POST_TAX');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "PayrollCycleStatus" AS ENUM ('DRAFT', 'PROCESSING', 'PENDING_APPROVAL', 'APPROVED', 'PAID');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "PayrollRecordStatus" AS ENUM ('DRAFT', 'CALCULATED', 'APPROVED', 'PAID', 'FLAGGED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "PayrollLineItemType" AS ENUM ('EARNING', 'DEDUCTION');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "PayrollLineSourceType" AS ENUM ('BASE_SALARY', 'ALLOWANCE', 'DEDUCTION', 'STATUTORY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "PayrollStatutoryRuleType" AS ENUM ('TAX_BRACKETS', 'FIXED', 'PERCENTAGE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "EmployeeCompensation" (
  "id" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "baseSalary" DECIMAL(65,30) NOT NULL,
  "payFrequency" "PayrollPayFrequency" NOT NULL DEFAULT 'MONTHLY',
  "currency" TEXT NOT NULL DEFAULT 'KES',
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "effectiveTo" TIMESTAMP(3),
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "EmployeeCompensation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Allowance" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "employeeId" TEXT,
  "departmentId" TEXT,
  "type" "CompensationValueType" NOT NULL,
  "amount" DECIMAL(65,30) NOT NULL,
  "taxable" BOOLEAN NOT NULL DEFAULT true,
  "recurring" BOOLEAN NOT NULL DEFAULT true,
  "isRuleBased" BOOLEAN NOT NULL DEFAULT false,
  "currency" TEXT NOT NULL DEFAULT 'KES',
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "effectiveTo" TIMESTAMP(3),
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "Allowance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Deduction" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "employeeId" TEXT,
  "departmentId" TEXT,
  "category" "DeductionCategory" NOT NULL,
  "calculationType" "CompensationValueType" NOT NULL,
  "amount" DECIMAL(65,30) NOT NULL,
  "timing" "DeductionTiming" NOT NULL,
  "recurring" BOOLEAN NOT NULL DEFAULT true,
  "isRuleBased" BOOLEAN NOT NULL DEFAULT false,
  "currency" TEXT NOT NULL DEFAULT 'KES',
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "effectiveTo" TIMESTAMP(3),
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "Deduction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PayrollStatutoryRule" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "ruleType" "PayrollStatutoryRuleType" NOT NULL,
  "config" JSONB NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "currency" TEXT NOT NULL DEFAULT 'KES',
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "effectiveTo" TIMESTAMP(3),
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "PayrollStatutoryRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PayrollCycle" (
  "id" TEXT NOT NULL,
  "periodMonth" INTEGER NOT NULL,
  "periodYear" INTEGER NOT NULL,
  "startDate" TIMESTAMP(3) NOT NULL,
  "endDate" TIMESTAMP(3) NOT NULL,
  "status" "PayrollCycleStatus" NOT NULL DEFAULT 'DRAFT',
  "currency" TEXT NOT NULL DEFAULT 'KES',
  "createdById" TEXT NOT NULL,
  "approvedById" TEXT,
  "approvedAt" TIMESTAMP(3),
  "paidAt" TIMESTAMP(3),
  "notes" TEXT,
  "lockedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "PayrollCycle_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PayrollRecord" (
  "id" TEXT NOT NULL,
  "payrollCycleId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "compensationId" TEXT,
  "baseSalary" DECIMAL(65,30) NOT NULL,
  "grossPay" DECIMAL(65,30) NOT NULL,
  "totalAllowances" DECIMAL(65,30) NOT NULL,
  "taxableIncome" DECIMAL(65,30) NOT NULL,
  "totalDeductions" DECIMAL(65,30) NOT NULL,
  "netPay" DECIMAL(65,30) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'KES',
  "status" "PayrollRecordStatus" NOT NULL DEFAULT 'DRAFT',
  "hasAnomaly" BOOLEAN NOT NULL DEFAULT false,
  "anomalyReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "PayrollRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PayrollLineItem" (
  "id" TEXT NOT NULL,
  "payrollRecordId" TEXT NOT NULL,
  "type" "PayrollLineItemType" NOT NULL,
  "sourceType" "PayrollLineSourceType" NOT NULL,
  "name" TEXT NOT NULL,
  "amount" DECIMAL(65,30) NOT NULL,
  "calculationReference" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PayrollLineItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PayrollAuditLog" (
  "id" TEXT NOT NULL,
  "payrollCycleId" TEXT,
  "payrollRecordId" TEXT,
  "action" TEXT NOT NULL,
  "performedById" TEXT NOT NULL,
  "payloadBefore" JSONB,
  "payloadAfter" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PayrollAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PayrollStatutoryRule_code_key" ON "PayrollStatutoryRule"("code");
CREATE UNIQUE INDEX IF NOT EXISTS "PayrollCycle_periodMonth_periodYear_key" ON "PayrollCycle"("periodMonth", "periodYear");
CREATE UNIQUE INDEX IF NOT EXISTS "PayrollRecord_payrollCycleId_employeeId_key" ON "PayrollRecord"("payrollCycleId", "employeeId");

CREATE INDEX IF NOT EXISTS "EmployeeCompensation_employeeId_effectiveFrom_idx" ON "EmployeeCompensation"("employeeId", "effectiveFrom");
CREATE INDEX IF NOT EXISTS "Allowance_employeeId_effectiveFrom_idx" ON "Allowance"("employeeId", "effectiveFrom");
CREATE INDEX IF NOT EXISTS "Allowance_departmentId_effectiveFrom_idx" ON "Allowance"("departmentId", "effectiveFrom");
CREATE INDEX IF NOT EXISTS "Deduction_employeeId_effectiveFrom_idx" ON "Deduction"("employeeId", "effectiveFrom");
CREATE INDEX IF NOT EXISTS "Deduction_departmentId_effectiveFrom_idx" ON "Deduction"("departmentId", "effectiveFrom");
CREATE INDEX IF NOT EXISTS "PayrollStatutoryRule_effectiveFrom_effectiveTo_isActive_idx" ON "PayrollStatutoryRule"("effectiveFrom", "effectiveTo", "isActive");
CREATE INDEX IF NOT EXISTS "PayrollCycle_status_periodYear_periodMonth_idx" ON "PayrollCycle"("status", "periodYear", "periodMonth");
CREATE INDEX IF NOT EXISTS "PayrollRecord_employeeId_payrollCycleId_idx" ON "PayrollRecord"("employeeId", "payrollCycleId");
CREATE INDEX IF NOT EXISTS "PayrollRecord_status_idx" ON "PayrollRecord"("status");
CREATE INDEX IF NOT EXISTS "PayrollLineItem_payrollRecordId_type_idx" ON "PayrollLineItem"("payrollRecordId", "type");
CREATE INDEX IF NOT EXISTS "PayrollAuditLog_payrollCycleId_createdAt_idx" ON "PayrollAuditLog"("payrollCycleId", "createdAt");
CREATE INDEX IF NOT EXISTS "PayrollAuditLog_payrollRecordId_createdAt_idx" ON "PayrollAuditLog"("payrollRecordId", "createdAt");

ALTER TABLE "EmployeeCompensation"
  ADD CONSTRAINT "EmployeeCompensation_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmployeeCompensation"
  ADD CONSTRAINT "EmployeeCompensation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Allowance"
  ADD CONSTRAINT "Allowance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Allowance"
  ADD CONSTRAINT "Allowance_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Allowance"
  ADD CONSTRAINT "Allowance_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Deduction"
  ADD CONSTRAINT "Deduction_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Deduction"
  ADD CONSTRAINT "Deduction_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Deduction"
  ADD CONSTRAINT "Deduction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PayrollStatutoryRule"
  ADD CONSTRAINT "PayrollStatutoryRule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PayrollCycle"
  ADD CONSTRAINT "PayrollCycle_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayrollCycle"
  ADD CONSTRAINT "PayrollCycle_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PayrollRecord"
  ADD CONSTRAINT "PayrollRecord_payrollCycleId_fkey" FOREIGN KEY ("payrollCycleId") REFERENCES "PayrollCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayrollRecord"
  ADD CONSTRAINT "PayrollRecord_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayrollRecord"
  ADD CONSTRAINT "PayrollRecord_compensationId_fkey" FOREIGN KEY ("compensationId") REFERENCES "EmployeeCompensation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PayrollLineItem"
  ADD CONSTRAINT "PayrollLineItem_payrollRecordId_fkey" FOREIGN KEY ("payrollRecordId") REFERENCES "PayrollRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PayrollAuditLog"
  ADD CONSTRAINT "PayrollAuditLog_payrollCycleId_fkey" FOREIGN KEY ("payrollCycleId") REFERENCES "PayrollCycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PayrollAuditLog"
  ADD CONSTRAINT "PayrollAuditLog_payrollRecordId_fkey" FOREIGN KEY ("payrollRecordId") REFERENCES "PayrollRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PayrollAuditLog"
  ADD CONSTRAINT "PayrollAuditLog_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
