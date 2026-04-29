-- CreateEnum
CREATE TYPE "EscalationSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "EscalationType" AS ENUM (
  'OVERDUE_APPROVAL',
  'OVERDUE_TASK',
  'SLA_VIOLATION',
  'REPEATED_LEAVE_REJECT',
  'FINANCE_EXCEPTION',
  'COMPLIANCE_VIOLATION',
  'DOCUMENT_MISSING',
  'LICENSE_EXPIRY',
  'RISK_WARNING',
  'MANUAL'
);

-- CreateEnum
CREATE TYPE "EscalationEntityType" AS ENUM (
  'APPROVAL_REQUEST',
  'TASK',
  'LEAVE_REQUEST',
  'FINANCE_REQUEST',
  'COMPLIANCE_ITEM',
  'CUSTOMER_ONBOARDING',
  'DOCUMENT',
  'ISSUE',
  'OTHER'
);

-- CreateEnum
CREATE TYPE "ContractType" AS ENUM ('CUSTOMER', 'VENDOR', 'EMPLOYMENT', 'PROCUREMENT', 'SERVICE', 'PARTNERSHIP', 'NDA', 'OTHER');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('DRAFT', 'ACTIVE', 'EXPIRED', 'TERMINATED', 'RENEWAL_DUE');

-- CreateEnum
CREATE TYPE "DelegationStatus" AS ENUM ('SCHEDULED', 'ACTIVE', 'EXPIRED', 'REVOKED');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ESCALATION_CREATED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ESCALATION_RESOLVED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'CONTRACT_EXPIRY_WARNING';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'GOVERNANCE_UPDATED';

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ESCALATION_CREATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ESCALATION_RESOLVED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'GOVERNANCE_SETTING_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CONTRACT_CREATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CONTRACT_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'CONTRACT_DELETED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'DELEGATION_CREATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'DELEGATION_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'DELEGATION_REVOKED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'GM_REPORT_RUN';

-- CreateTable
CREATE TABLE "CompanySetting" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "description" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CompanySetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EscalationLog" (
  "id" TEXT NOT NULL,
  "type" "EscalationType" NOT NULL,
  "relatedEntityId" TEXT NOT NULL,
  "relatedEntityType" "EscalationEntityType" NOT NULL,
  "departmentId" TEXT,
  "reason" TEXT NOT NULL,
  "severity" "EscalationSeverity" NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  "resolvedById" TEXT,
  "resolutionNotes" TEXT,
  CONSTRAINT "EscalationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contract" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "ContractType" NOT NULL,
  "status" "ContractStatus" NOT NULL DEFAULT 'DRAFT',
  "counterpartyName" TEXT NOT NULL,
  "amount" DECIMAL(65,30),
  "currency" TEXT NOT NULL DEFAULT 'KES',
  "startDate" TIMESTAMP(3),
  "endDate" TIMESTAMP(3),
  "renewalReminderDays" INTEGER NOT NULL DEFAULT 30,
  "ownerId" TEXT,
  "departmentId" TEXT,
  "documentId" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Delegation" (
  "id" TEXT NOT NULL,
  "delegatorId" TEXT NOT NULL,
  "delegateUserId" TEXT NOT NULL,
  "modules" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "startAt" TIMESTAMP(3) NOT NULL,
  "endAt" TIMESTAMP(3) NOT NULL,
  "status" "DelegationStatus" NOT NULL DEFAULT 'SCHEDULED',
  "notes" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "resolvedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Delegation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompanySetting_key_key" ON "CompanySetting"("key");
CREATE INDEX "EscalationLog_severity_relatedEntityType_idx" ON "EscalationLog"("severity", "relatedEntityType");
CREATE INDEX "EscalationLog_relatedEntityType_relatedEntityId_idx" ON "EscalationLog"("relatedEntityType", "relatedEntityId");
CREATE INDEX "EscalationLog_departmentId_severity_idx" ON "EscalationLog"("departmentId", "severity");
CREATE INDEX "EscalationLog_createdById_idx" ON "EscalationLog"("createdById");
CREATE INDEX "EscalationLog_resolvedById_idx" ON "EscalationLog"("resolvedById");
CREATE INDEX "Contract_type_status_idx" ON "Contract"("type", "status");
CREATE INDEX "Contract_endDate_status_idx" ON "Contract"("endDate", "status");
CREATE INDEX "Contract_departmentId_status_idx" ON "Contract"("departmentId", "status");
CREATE INDEX "Delegation_delegateUserId_status_startAt_endAt_idx" ON "Delegation"("delegateUserId", "status", "startAt", "endAt");
CREATE INDEX "Delegation_delegatorId_status_idx" ON "Delegation"("delegatorId", "status");

-- AddForeignKey
ALTER TABLE "EscalationLog" ADD CONSTRAINT "EscalationLog_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EscalationLog" ADD CONSTRAINT "EscalationLog_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Delegation" ADD CONSTRAINT "Delegation_delegatorId_fkey" FOREIGN KEY ("delegatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Delegation" ADD CONSTRAINT "Delegation_delegateUserId_fkey" FOREIGN KEY ("delegateUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Delegation" ADD CONSTRAINT "Delegation_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
