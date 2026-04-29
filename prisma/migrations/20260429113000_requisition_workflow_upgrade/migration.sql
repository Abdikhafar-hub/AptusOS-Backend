-- CreateEnum
CREATE TYPE "RequisitionCategory" AS ENUM ('GOODS', 'SERVICES', 'MAINTENANCE', 'IT_EQUIPMENT', 'OFFICE_SUPPLIES', 'MEDICAL_CLINICAL_SUPPLIES', 'LOGISTICS', 'EMERGENCY_PROCUREMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "RequisitionRequestType" AS ENUM ('NEW_PURCHASE', 'REPLACEMENT', 'REPAIR', 'RENEWAL', 'SERVICE_CONTRACT');

-- CreateEnum
CREATE TYPE "RequisitionFundingSource" AS ENUM ('DEPARTMENT_BUDGET', 'PROJECT_BUDGET', 'EMERGENCY_FUND', 'OTHER');

-- CreateEnum
CREATE TYPE "RequisitionExpenditureType" AS ENUM ('CAPEX', 'OPEX');

-- CreateEnum
CREATE TYPE "RequisitionApprovalRoute" AS ENUM ('AUTO', 'MANUAL');

-- CreateEnum
CREATE TYPE "RequisitionAttachmentType" AS ENUM ('SUPPLIER_QUOTATION', 'SPECIFICATION_DOCUMENT', 'APPROVAL_MEMO', 'PREVIOUS_INVOICE_RECEIPT', 'EMERGENCY_JUSTIFICATION', 'OTHER');

-- AlterTable
ALTER TABLE "Requisition"
ADD COLUMN "requestCategory" "RequisitionCategory" NOT NULL DEFAULT 'GOODS',
ADD COLUMN "requestType" "RequisitionRequestType" NOT NULL DEFAULT 'NEW_PURCHASE',
ADD COLUMN "businessJustification" TEXT,
ADD COLUMN "requiredByDate" TIMESTAMP(3),
ADD COLUMN "urgencyReason" TEXT,
ADD COLUMN "emergencyJustification" TEXT,
ADD COLUMN "subtotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
ADD COLUMN "taxApplicable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "taxRate" DECIMAL(65,30),
ADD COLUMN "taxAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
ADD COLUMN "grandTotal" DECIMAL(65,30) NOT NULL DEFAULT 0,
ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'KES',
ADD COLUMN "budgetLine" TEXT,
ADD COLUMN "costCenter" TEXT,
ADD COLUMN "fundingSource" "RequisitionFundingSource" NOT NULL DEFAULT 'DEPARTMENT_BUDGET',
ADD COLUMN "budgetAvailableAmount" DECIMAL(65,30),
ADD COLUMN "budgetExceeded" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "budgetOverrideUsed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "budgetOverrideReason" TEXT,
ADD COLUMN "expenditureType" "RequisitionExpenditureType" NOT NULL DEFAULT 'OPEX',
ADD COLUMN "preferredSupplier" TEXT,
ADD COLUMN "supplierContact" TEXT,
ADD COLUMN "supplierQuoteReference" TEXT,
ADD COLUMN "requireMultipleQuotes" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "quotesRequired" INTEGER,
ADD COLUMN "approvalRoute" "RequisitionApprovalRoute" NOT NULL DEFAULT 'AUTO',
ADD COLUMN "manualApproverIds" JSONB,
ADD COLUMN "approvalRoutePreview" JSONB,
ADD COLUMN "requestedBySnapshot" JSONB,
ADD COLUMN "complianceChecks" JSONB;

UPDATE "Requisition"
SET
  "subtotal" = COALESCE("estimatedAmount", 0),
  "grandTotal" = COALESCE("estimatedAmount", 0)
WHERE "subtotal" = 0 AND "grandTotal" = 0;

-- CreateTable
CREATE TABLE "RequisitionLineItem" (
  "id" TEXT NOT NULL,
  "requisitionId" TEXT NOT NULL,
  "itemName" TEXT NOT NULL,
  "specification" TEXT,
  "quantity" DECIMAL(65,30) NOT NULL,
  "unitOfMeasure" TEXT NOT NULL,
  "estimatedUnitCost" DECIMAL(65,30) NOT NULL,
  "estimatedTotalCost" DECIMAL(65,30) NOT NULL,
  "preferredBrandModel" TEXT,
  "requiredByDate" TIMESTAMP(3) NOT NULL,
  "budgetCode" TEXT,
  "costCenter" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RequisitionLineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequisitionAttachment" (
  "id" TEXT NOT NULL,
  "requisitionId" TEXT NOT NULL,
  "attachmentType" "RequisitionAttachmentType" NOT NULL,
  "documentId" TEXT,
  "fileName" TEXT,
  "mimeType" TEXT,
  "fileSize" INTEGER,
  "uploadedById" TEXT NOT NULL,
  "metadata" JSONB,
  "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "removedAt" TIMESTAMP(3),
  CONSTRAINT "RequisitionAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequisitionApprovalStep" (
  "id" TEXT NOT NULL,
  "requisitionId" TEXT NOT NULL,
  "stepOrder" INTEGER NOT NULL,
  "stepType" TEXT NOT NULL,
  "label" TEXT,
  "approverRoleId" TEXT,
  "approverUserId" TEXT,
  "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RequisitionApprovalStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequisitionAuditLog" (
  "id" TEXT NOT NULL,
  "requisitionId" TEXT NOT NULL,
  "actorId" TEXT,
  "eventType" TEXT NOT NULL,
  "description" TEXT,
  "oldValues" JSONB,
  "newValues" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RequisitionAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Requisition_departmentId_status_idx" ON "Requisition"("departmentId", "status");

-- CreateIndex
CREATE INDEX "Requisition_requestedById_status_idx" ON "Requisition"("requestedById", "status");

-- CreateIndex
CREATE INDEX "Requisition_requestCategory_idx" ON "Requisition"("requestCategory");

-- CreateIndex
CREATE INDEX "Requisition_requiredByDate_idx" ON "Requisition"("requiredByDate");

-- CreateIndex
CREATE INDEX "Requisition_budgetExceeded_idx" ON "Requisition"("budgetExceeded");

-- CreateIndex
CREATE INDEX "RequisitionLineItem_requisitionId_idx" ON "RequisitionLineItem"("requisitionId");

-- CreateIndex
CREATE INDEX "RequisitionAttachment_requisitionId_attachmentType_idx" ON "RequisitionAttachment"("requisitionId", "attachmentType");

-- CreateIndex
CREATE INDEX "RequisitionAttachment_uploadedById_idx" ON "RequisitionAttachment"("uploadedById");

-- CreateIndex
CREATE INDEX "RequisitionApprovalStep_requisitionId_stepOrder_idx" ON "RequisitionApprovalStep"("requisitionId", "stepOrder");

-- CreateIndex
CREATE INDEX "RequisitionApprovalStep_approverRoleId_idx" ON "RequisitionApprovalStep"("approverRoleId");

-- CreateIndex
CREATE INDEX "RequisitionApprovalStep_approverUserId_idx" ON "RequisitionApprovalStep"("approverUserId");

-- CreateIndex
CREATE INDEX "RequisitionAuditLog_requisitionId_createdAt_idx" ON "RequisitionAuditLog"("requisitionId", "createdAt");

-- CreateIndex
CREATE INDEX "RequisitionAuditLog_actorId_idx" ON "RequisitionAuditLog"("actorId");

-- AddForeignKey
ALTER TABLE "RequisitionLineItem" ADD CONSTRAINT "RequisitionLineItem_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "Requisition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequisitionAttachment" ADD CONSTRAINT "RequisitionAttachment_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "Requisition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequisitionAttachment" ADD CONSTRAINT "RequisitionAttachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequisitionApprovalStep" ADD CONSTRAINT "RequisitionApprovalStep_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "Requisition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequisitionApprovalStep" ADD CONSTRAINT "RequisitionApprovalStep_approverRoleId_fkey" FOREIGN KEY ("approverRoleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequisitionApprovalStep" ADD CONSTRAINT "RequisitionApprovalStep_approverUserId_fkey" FOREIGN KEY ("approverUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequisitionAuditLog" ADD CONSTRAINT "RequisitionAuditLog_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "Requisition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequisitionAuditLog" ADD CONSTRAINT "RequisitionAuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
