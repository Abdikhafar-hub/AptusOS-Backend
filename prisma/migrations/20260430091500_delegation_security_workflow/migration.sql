-- Extend DelegationStatus enum for workflow states
ALTER TYPE "DelegationStatus" ADD VALUE IF NOT EXISTS 'DRAFT';
ALTER TYPE "DelegationStatus" ADD VALUE IF NOT EXISTS 'PENDING_APPROVAL';

-- Extend delegation table for secure scoped delegation
ALTER TABLE "Delegation"
  ADD COLUMN IF NOT EXISTS "restrictedModules" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "restrictedDepartmentId" TEXT,
  ADD COLUMN IF NOT EXISTS "maxApprovalAmount" DECIMAL(65,30),
  ADD COLUMN IF NOT EXISTS "allowFinancialApprovals" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "allowContractApprovals" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "immediateActivation" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "autoExpire" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "reason" TEXT,
  ADD COLUMN IF NOT EXISTS "justification" TEXT,
  ADD COLUMN IF NOT EXISTS "approvalRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "approverId" TEXT,
  ADD COLUMN IF NOT EXISTS "approvedById" TEXT,
  ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "metadata" JSONB,
  ADD COLUMN IF NOT EXISTS "revokedReason" TEXT;

ALTER TABLE "Delegation"
  ALTER COLUMN "status" SET DEFAULT 'DRAFT';

-- Delegation relation indexes and FKs
CREATE INDEX IF NOT EXISTS "Delegation_approverId_status_idx" ON "Delegation"("approverId", "status");
CREATE INDEX IF NOT EXISTS "Delegation_restrictedDepartmentId_status_idx" ON "Delegation"("restrictedDepartmentId", "status");

ALTER TABLE "Delegation" ADD CONSTRAINT "Delegation_restrictedDepartmentId_fkey" FOREIGN KEY ("restrictedDepartmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Delegation" ADD CONSTRAINT "Delegation_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Delegation" ADD CONSTRAINT "Delegation_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
