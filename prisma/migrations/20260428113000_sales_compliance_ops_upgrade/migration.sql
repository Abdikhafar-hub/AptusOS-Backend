ALTER TYPE "ComplianceRiskLevel" ADD VALUE IF NOT EXISTS 'CRITICAL';

DO $$ BEGIN
  CREATE TYPE "CustomerBlacklistStatus" AS ENUM ('CLEAR', 'WATCHLISTED', 'BLOCKED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "CustomerAccountStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING_APPROVAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "AccountTier" AS ENUM ('A', 'B', 'C', 'D');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "CustomerHealthStatus" AS ENUM ('GOOD', 'WATCH', 'AT_RISK', 'BLOCKED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "TerritoryStatus" AS ENUM ('ACTIVE', 'INACTIVE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "VisitRouteStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "VisitRouteStopStatus" AS ENUM ('PLANNED', 'VISITED', 'MISSED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "AccountNoteType" AS ENUM ('GENERAL', 'COMMERCIAL', 'COMPLIANCE', 'PAYMENT', 'RELATIONSHIP');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "OpportunityStage" AS ENUM ('PROSPECTING', 'QUALIFICATION', 'NEGOTIATION', 'EXPECTED_ORDER', 'WON', 'LOST');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "OpportunityStatus" AS ENUM ('OPEN', 'WON', 'LOST', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ProductFeedbackType" AS ENUM ('DEMAND_SPIKE', 'QUALITY_COMPLAINT', 'SUBSTITUTION_REQUEST', 'PRICE_FEEDBACK', 'AVAILABILITY_ISSUE', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ProductFeedbackStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'CLOSED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "IssueType" AS ENUM ('DELIVERY', 'PRODUCT', 'PRICING', 'COMPLIANCE', 'PAYMENT', 'RELATIONSHIP', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "IssueStatus" AS ENUM ('OPEN', 'ESCALATED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "EscalationDepartment" AS ENUM ('HR', 'FINANCE', 'OPERATIONS', 'COMPLIANCE', 'MANAGEMENT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "DiscountRequestStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "CustomerAlertType" AS ENUM ('LICENSE_EXPIRY', 'CREDIT_RISK', 'COMPLIANCE_RISK', 'OVERDUE_FOLLOWUP', 'ISSUE_SLA', 'DOCUMENT_MISSING', 'PAYMENT_DELAY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "CustomerAlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "VisitType" AS ENUM ('SALES', 'FOLLOW_UP', 'COMPLIANCE_CHECK', 'COMPLAINT', 'COLLECTION', 'RELATIONSHIP');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "CustomerOnboarding"
ADD COLUMN IF NOT EXISTS "taxComplianceExpiryDate" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "blacklistStatus" "CustomerBlacklistStatus" NOT NULL DEFAULT 'CLEAR',
ADD COLUMN IF NOT EXISTS "accountStatus" "CustomerAccountStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
ADD COLUMN IF NOT EXISTS "complianceNotes" TEXT,
ADD COLUMN IF NOT EXISTS "outstandingBalance" DECIMAL(65,30),
ADD COLUMN IF NOT EXISTS "paymentDelayFlag" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "blockedForCredit" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "preferredOrderChannel" TEXT,
ADD COLUMN IF NOT EXISTS "accountTier" "AccountTier",
ADD COLUMN IF NOT EXISTS "isKeyAccount" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "accountOwnerId" TEXT,
ADD COLUMN IF NOT EXISTS "territoryId" TEXT,
ADD COLUMN IF NOT EXISTS "lastVisitDate" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "nextFollowUpDate" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "customerHealthStatus" "CustomerHealthStatus";

ALTER TABLE "Task"
ADD COLUMN IF NOT EXISTS "customerId" TEXT,
ADD COLUMN IF NOT EXISTS "opportunityId" TEXT,
ADD COLUMN IF NOT EXISTS "issueId" TEXT,
ADD COLUMN IF NOT EXISTS "visitId" TEXT;

ALTER TABLE "SalesReport"
ADD COLUMN IF NOT EXISTS "territoryId" TEXT;

ALTER TABLE "ClientVisitNote"
ADD COLUMN IF NOT EXISTS "purpose" TEXT,
ADD COLUMN IF NOT EXISTS "outcome" TEXT,
ADD COLUMN IF NOT EXISTS "nextAction" TEXT,
ADD COLUMN IF NOT EXISTS "nextFollowUpDate" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "customerId" TEXT,
ADD COLUMN IF NOT EXISTS "territoryId" TEXT,
ADD COLUMN IF NOT EXISTS "routeStopId" TEXT,
ADD COLUMN IF NOT EXISTS "attachments" JSONB,
ADD COLUMN IF NOT EXISTS "geoLocation" TEXT,
ADD COLUMN IF NOT EXISTS "visitType" "VisitType";

CREATE TABLE IF NOT EXISTS "SalesTerritory" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "region" TEXT,
  "county" TEXT,
  "towns" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "assignedOfficerId" TEXT,
  "description" TEXT,
  "status" "TerritoryStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "SalesTerritory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "VisitRoute" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "assignedOfficerId" TEXT NOT NULL,
  "territoryId" TEXT NOT NULL,
  "routeDate" TIMESTAMP(3) NOT NULL,
  "status" "VisitRouteStatus" NOT NULL DEFAULT 'PLANNED',
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "VisitRoute_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "VisitRouteStop" (
  "id" TEXT NOT NULL,
  "routeId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "plannedTime" TIMESTAMP(3),
  "visitOrder" INTEGER NOT NULL,
  "status" "VisitRouteStopStatus" NOT NULL DEFAULT 'PLANNED',
  "visitId" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VisitRouteStop_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CustomerAccountNote" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "note" TEXT NOT NULL,
  "noteType" "AccountNoteType" NOT NULL DEFAULT 'GENERAL',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerAccountNote_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SalesOpportunity" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "stage" "OpportunityStage" NOT NULL DEFAULT 'PROSPECTING',
  "expectedValue" DECIMAL(65,30),
  "currency" TEXT NOT NULL DEFAULT 'KES',
  "expectedOrderDate" TIMESTAMP(3),
  "competitorInvolved" BOOLEAN NOT NULL DEFAULT false,
  "competitorName" TEXT,
  "lossReason" TEXT,
  "probability" INTEGER,
  "status" "OpportunityStatus" NOT NULL DEFAULT 'OPEN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "SalesOpportunity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ProductFeedback" (
  "id" TEXT NOT NULL,
  "customerId" TEXT,
  "submittedById" TEXT NOT NULL,
  "productName" TEXT NOT NULL,
  "productCategory" TEXT,
  "feedbackType" "ProductFeedbackType" NOT NULL,
  "description" TEXT NOT NULL,
  "severity" "Priority" NOT NULL DEFAULT 'MEDIUM',
  "status" "ProductFeedbackStatus" NOT NULL DEFAULT 'OPEN',
  "relatedVisitId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "ProductFeedback_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CustomerIssue" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "reportedById" TEXT NOT NULL,
  "assignedToId" TEXT,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "issueType" "IssueType" NOT NULL,
  "severity" "Priority" NOT NULL DEFAULT 'MEDIUM',
  "status" "IssueStatus" NOT NULL DEFAULT 'OPEN',
  "escalationDepartment" "EscalationDepartment",
  "slaDueAt" TIMESTAMP(3),
  "resolvedAt" TIMESTAMP(3),
  "resolutionNotes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "CustomerIssue_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "DiscountRequest" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "requestedById" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "standardPrice" DECIMAL(65,30) NOT NULL,
  "requestedPrice" DECIMAL(65,30) NOT NULL,
  "discountPercent" DECIMAL(65,30) NOT NULL,
  "estimatedValue" DECIMAL(65,30),
  "currency" TEXT NOT NULL DEFAULT 'KES',
  "approvalRequired" BOOLEAN NOT NULL DEFAULT true,
  "status" "DiscountRequestStatus" NOT NULL DEFAULT 'DRAFT',
  "approvalRequestId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "DiscountRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CustomerAlert" (
  "id" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "alertType" "CustomerAlertType" NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "severity" "Priority" NOT NULL DEFAULT 'MEDIUM',
  "dueDate" TIMESTAMP(3),
  "status" "CustomerAlertStatus" NOT NULL DEFAULT 'OPEN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "CustomerAlert_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "VisitRouteStop_visitId_key" ON "VisitRouteStop"("visitId");
CREATE UNIQUE INDEX IF NOT EXISTS "VisitRouteStop_routeId_visitOrder_key" ON "VisitRouteStop"("routeId", "visitOrder");

CREATE INDEX IF NOT EXISTS "CustomerOnboarding_accountOwnerId_idx" ON "CustomerOnboarding"("accountOwnerId");
CREATE INDEX IF NOT EXISTS "CustomerOnboarding_territoryId_idx" ON "CustomerOnboarding"("territoryId");
CREATE INDEX IF NOT EXISTS "CustomerOnboarding_customerHealthStatus_idx" ON "CustomerOnboarding"("customerHealthStatus");
CREATE INDEX IF NOT EXISTS "CustomerOnboarding_blacklistStatus_idx" ON "CustomerOnboarding"("blacklistStatus");

CREATE INDEX IF NOT EXISTS "Task_customerId_idx" ON "Task"("customerId");
CREATE INDEX IF NOT EXISTS "Task_opportunityId_idx" ON "Task"("opportunityId");
CREATE INDEX IF NOT EXISTS "Task_issueId_idx" ON "Task"("issueId");
CREATE INDEX IF NOT EXISTS "Task_visitId_idx" ON "Task"("visitId");

CREATE INDEX IF NOT EXISTS "SalesReport_territoryId_idx" ON "SalesReport"("territoryId");
CREATE INDEX IF NOT EXISTS "ClientVisitNote_customerId_idx" ON "ClientVisitNote"("customerId");
CREATE INDEX IF NOT EXISTS "ClientVisitNote_territoryId_idx" ON "ClientVisitNote"("territoryId");
CREATE INDEX IF NOT EXISTS "ClientVisitNote_routeStopId_idx" ON "ClientVisitNote"("routeStopId");
CREATE INDEX IF NOT EXISTS "ClientVisitNote_visitDate_idx" ON "ClientVisitNote"("visitDate");

CREATE INDEX IF NOT EXISTS "SalesTerritory_assignedOfficerId_status_idx" ON "SalesTerritory"("assignedOfficerId", "status");
CREATE INDEX IF NOT EXISTS "SalesTerritory_name_idx" ON "SalesTerritory"("name");
CREATE INDEX IF NOT EXISTS "VisitRoute_assignedOfficerId_routeDate_idx" ON "VisitRoute"("assignedOfficerId", "routeDate");
CREATE INDEX IF NOT EXISTS "VisitRoute_territoryId_routeDate_idx" ON "VisitRoute"("territoryId", "routeDate");
CREATE INDEX IF NOT EXISTS "VisitRoute_status_idx" ON "VisitRoute"("status");
CREATE INDEX IF NOT EXISTS "VisitRouteStop_routeId_status_idx" ON "VisitRouteStop"("routeId", "status");
CREATE INDEX IF NOT EXISTS "VisitRouteStop_customerId_idx" ON "VisitRouteStop"("customerId");
CREATE INDEX IF NOT EXISTS "CustomerAccountNote_customerId_createdAt_idx" ON "CustomerAccountNote"("customerId", "createdAt");
CREATE INDEX IF NOT EXISTS "CustomerAccountNote_createdById_idx" ON "CustomerAccountNote"("createdById");
CREATE INDEX IF NOT EXISTS "SalesOpportunity_customerId_status_idx" ON "SalesOpportunity"("customerId", "status");
CREATE INDEX IF NOT EXISTS "SalesOpportunity_ownerId_stage_idx" ON "SalesOpportunity"("ownerId", "stage");
CREATE INDEX IF NOT EXISTS "SalesOpportunity_expectedOrderDate_idx" ON "SalesOpportunity"("expectedOrderDate");
CREATE INDEX IF NOT EXISTS "ProductFeedback_customerId_status_idx" ON "ProductFeedback"("customerId", "status");
CREATE INDEX IF NOT EXISTS "ProductFeedback_feedbackType_severity_idx" ON "ProductFeedback"("feedbackType", "severity");
CREATE INDEX IF NOT EXISTS "ProductFeedback_relatedVisitId_idx" ON "ProductFeedback"("relatedVisitId");
CREATE INDEX IF NOT EXISTS "CustomerIssue_customerId_status_idx" ON "CustomerIssue"("customerId", "status");
CREATE INDEX IF NOT EXISTS "CustomerIssue_assignedToId_status_idx" ON "CustomerIssue"("assignedToId", "status");
CREATE INDEX IF NOT EXISTS "CustomerIssue_slaDueAt_idx" ON "CustomerIssue"("slaDueAt");
CREATE INDEX IF NOT EXISTS "DiscountRequest_customerId_status_idx" ON "DiscountRequest"("customerId", "status");
CREATE INDEX IF NOT EXISTS "DiscountRequest_requestedById_status_idx" ON "DiscountRequest"("requestedById", "status");
CREATE INDEX IF NOT EXISTS "DiscountRequest_approvalRequestId_idx" ON "DiscountRequest"("approvalRequestId");
CREATE INDEX IF NOT EXISTS "CustomerAlert_customerId_status_idx" ON "CustomerAlert"("customerId", "status");
CREATE INDEX IF NOT EXISTS "CustomerAlert_alertType_dueDate_idx" ON "CustomerAlert"("alertType", "dueDate");

ALTER TABLE "CustomerOnboarding"
  ADD CONSTRAINT "CustomerOnboarding_accountOwnerId_fkey" FOREIGN KEY ("accountOwnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CustomerOnboarding"
  ADD CONSTRAINT "CustomerOnboarding_territoryId_fkey" FOREIGN KEY ("territoryId") REFERENCES "SalesTerritory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Task"
  ADD CONSTRAINT "Task_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "CustomerOnboarding"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "Task_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "SalesOpportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "Task_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "CustomerIssue"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "Task_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "ClientVisitNote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SalesReport"
  ADD CONSTRAINT "SalesReport_territoryId_fkey" FOREIGN KEY ("territoryId") REFERENCES "SalesTerritory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ClientVisitNote"
  ADD CONSTRAINT "ClientVisitNote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "CustomerOnboarding"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "ClientVisitNote_territoryId_fkey" FOREIGN KEY ("territoryId") REFERENCES "SalesTerritory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SalesTerritory"
  ADD CONSTRAINT "SalesTerritory_assignedOfficerId_fkey" FOREIGN KEY ("assignedOfficerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "VisitRoute"
  ADD CONSTRAINT "VisitRoute_assignedOfficerId_fkey" FOREIGN KEY ("assignedOfficerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "VisitRoute_territoryId_fkey" FOREIGN KEY ("territoryId") REFERENCES "SalesTerritory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "VisitRouteStop"
  ADD CONSTRAINT "VisitRouteStop_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "VisitRoute"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "VisitRouteStop_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "CustomerOnboarding"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "VisitRouteStop_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "ClientVisitNote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CustomerAccountNote"
  ADD CONSTRAINT "CustomerAccountNote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "CustomerOnboarding"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CustomerAccountNote_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SalesOpportunity"
  ADD CONSTRAINT "SalesOpportunity_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "CustomerOnboarding"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "SalesOpportunity_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProductFeedback"
  ADD CONSTRAINT "ProductFeedback_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "CustomerOnboarding"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "ProductFeedback_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ProductFeedback_relatedVisitId_fkey" FOREIGN KEY ("relatedVisitId") REFERENCES "ClientVisitNote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CustomerIssue"
  ADD CONSTRAINT "CustomerIssue_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "CustomerOnboarding"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CustomerIssue_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "CustomerIssue_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DiscountRequest"
  ADD CONSTRAINT "DiscountRequest_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "CustomerOnboarding"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "DiscountRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CustomerAlert"
  ADD CONSTRAINT "CustomerAlert_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "CustomerOnboarding"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
