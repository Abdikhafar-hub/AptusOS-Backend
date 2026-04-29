-- CreateEnum
CREATE TYPE "LogisticsTaskType" AS ENUM ('SHIPMENT_HANDLING', 'CUSTOMS_CLEARANCE', 'WAREHOUSE_OPERATION', 'TRANSPORT_DELIVERY', 'COLD_CHAIN_MONITORING', 'INVENTORY_MOVEMENT', 'VENDOR_COORDINATION', 'COMPLIANCE_INSPECTION', 'EMERGENCY_RESPONSE');

-- CreateEnum
CREATE TYPE "LogisticsTransportMode" AS ENUM ('AIR', 'SEA', 'ROAD', 'MULTI_MODAL');

-- CreateEnum
CREATE TYPE "LogisticsTaskStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'AWAITING_CLEARANCE', 'IN_TRANSIT', 'DELAYED', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "LogisticsMilestoneStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'DELAYED', 'MISSED');

-- CreateEnum
CREATE TYPE "LogisticsTaskDocumentType" AS ENUM ('CUSTOMS_DOCUMENT', 'INVOICE', 'PACKING_LIST', 'BILL_OF_LADING_AIRWAY_BILL', 'CLEARANCE_CERTIFICATE', 'INSPECTION_REPORT', 'OTHER');

-- CreateEnum
CREATE TYPE "LogisticsDependencyBlockerType" AS ENUM ('DOCUMENT_MISSING', 'APPROVAL_PENDING', 'SHIPMENT_DELAY', 'OTHER');

-- CreateEnum
CREATE TYPE "LogisticsRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateTable
CREATE TABLE "LogisticsTask" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "taskType" "LogisticsTaskType" NOT NULL,
  "status" "LogisticsTaskStatus" NOT NULL DEFAULT 'PENDING',
  "shipmentReferenceId" TEXT,
  "trackingNumber" TEXT,
  "originLocation" TEXT,
  "destinationLocation" TEXT,
  "transportMode" "LogisticsTransportMode",
  "carrierProvider" TEXT,
  "estimatedArrivalDate" TIMESTAMP(3),
  "actualArrivalDate" TIMESTAMP(3),
  "responsibleDepartmentId" TEXT NOT NULL,
  "primaryAssigneeId" TEXT,
  "supervisorId" TEXT,
  "externalPartner" TEXT,
  "assignedTeamSnapshot" JSONB,
  "startDate" TIMESTAMP(3),
  "expectedCompletionDate" TIMESTAMP(3),
  "actualCompletionDate" TIMESTAMP(3),
  "dependsOnTaskId" TEXT,
  "blockedByType" "LogisticsDependencyBlockerType",
  "blockedByNotes" TEXT,
  "riskLevel" "LogisticsRiskLevel" NOT NULL DEFAULT 'MEDIUM',
  "delayReason" TEXT,
  "incidentReport" TEXT,
  "alertDelayHours" INTEGER,
  "alertTemperatureBreach" BOOLEAN NOT NULL DEFAULT false,
  "alertMissedMilestone" BOOLEAN NOT NULL DEFAULT false,
  "requiredTemperatureMin" DECIMAL(65,30),
  "requiredTemperatureMax" DECIMAL(65,30),
  "currentTemperature" DECIMAL(65,30),
  "monitoringDeviceId" TEXT,
  "outOfRangeAlert" BOOLEAN NOT NULL DEFAULT false,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "LogisticsTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LogisticsTaskItem" (
  "id" TEXT NOT NULL,
  "logisticsTaskId" TEXT NOT NULL,
  "itemName" TEXT NOT NULL,
  "quantity" DECIMAL(65,30) NOT NULL,
  "unit" TEXT NOT NULL,
  "weight" DECIMAL(65,30),
  "volume" DECIMAL(65,30),
  "temperatureRequirement" TEXT,
  "specialHandlingNotes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LogisticsTaskItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LogisticsTaskDocument" (
  "id" TEXT NOT NULL,
  "logisticsTaskId" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "documentType" "LogisticsTaskDocumentType" NOT NULL,
  "fileName" TEXT,
  "mimeType" TEXT,
  "fileSize" INTEGER,
  "uploadedById" TEXT NOT NULL,
  "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" JSONB,
  CONSTRAINT "LogisticsTaskDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LogisticsTaskMilestone" (
  "id" TEXT NOT NULL,
  "logisticsTaskId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "expectedDate" TIMESTAMP(3) NOT NULL,
  "actualDate" TIMESTAMP(3),
  "status" "LogisticsMilestoneStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LogisticsTaskMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LogisticsTaskDependency" (
  "id" TEXT NOT NULL,
  "logisticsTaskId" TEXT NOT NULL,
  "dependsOnTaskId" TEXT,
  "blockerType" "LogisticsDependencyBlockerType",
  "blockerNotes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LogisticsTaskDependency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LogisticsTaskAuditLog" (
  "id" TEXT NOT NULL,
  "logisticsTaskId" TEXT NOT NULL,
  "actorId" TEXT,
  "eventType" TEXT NOT NULL,
  "description" TEXT,
  "oldValues" JSONB,
  "newValues" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LogisticsTaskAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LogisticsTaskTeamMember" (
  "id" TEXT NOT NULL,
  "logisticsTaskId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "roleLabel" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LogisticsTaskTeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LogisticsTask_responsibleDepartmentId_status_idx" ON "LogisticsTask"("responsibleDepartmentId", "status");
CREATE INDEX "LogisticsTask_primaryAssigneeId_status_idx" ON "LogisticsTask"("primaryAssigneeId", "status");
CREATE INDEX "LogisticsTask_taskType_status_idx" ON "LogisticsTask"("taskType", "status");
CREATE INDEX "LogisticsTask_shipmentReferenceId_idx" ON "LogisticsTask"("shipmentReferenceId");
CREATE INDEX "LogisticsTask_trackingNumber_idx" ON "LogisticsTask"("trackingNumber");
CREATE INDEX "LogisticsTaskItem_logisticsTaskId_idx" ON "LogisticsTaskItem"("logisticsTaskId");
CREATE INDEX "LogisticsTaskDocument_logisticsTaskId_documentType_idx" ON "LogisticsTaskDocument"("logisticsTaskId", "documentType");
CREATE INDEX "LogisticsTaskDocument_uploadedById_idx" ON "LogisticsTaskDocument"("uploadedById");
CREATE INDEX "LogisticsTaskMilestone_logisticsTaskId_expectedDate_idx" ON "LogisticsTaskMilestone"("logisticsTaskId", "expectedDate");
CREATE INDEX "LogisticsTaskDependency_logisticsTaskId_idx" ON "LogisticsTaskDependency"("logisticsTaskId");
CREATE INDEX "LogisticsTaskAuditLog_logisticsTaskId_createdAt_idx" ON "LogisticsTaskAuditLog"("logisticsTaskId", "createdAt");
CREATE INDEX "LogisticsTaskAuditLog_actorId_idx" ON "LogisticsTaskAuditLog"("actorId");
CREATE UNIQUE INDEX "LogisticsTaskTeamMember_logisticsTaskId_userId_key" ON "LogisticsTaskTeamMember"("logisticsTaskId", "userId");
CREATE INDEX "LogisticsTaskTeamMember_userId_idx" ON "LogisticsTaskTeamMember"("userId");

-- AddForeignKey
ALTER TABLE "LogisticsTask" ADD CONSTRAINT "LogisticsTask_responsibleDepartmentId_fkey" FOREIGN KEY ("responsibleDepartmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LogisticsTask" ADD CONSTRAINT "LogisticsTask_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LogisticsTask" ADD CONSTRAINT "LogisticsTask_primaryAssigneeId_fkey" FOREIGN KEY ("primaryAssigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LogisticsTask" ADD CONSTRAINT "LogisticsTask_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LogisticsTask" ADD CONSTRAINT "LogisticsTask_dependsOnTaskId_fkey" FOREIGN KEY ("dependsOnTaskId") REFERENCES "LogisticsTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LogisticsTaskItem" ADD CONSTRAINT "LogisticsTaskItem_logisticsTaskId_fkey" FOREIGN KEY ("logisticsTaskId") REFERENCES "LogisticsTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LogisticsTaskDocument" ADD CONSTRAINT "LogisticsTaskDocument_logisticsTaskId_fkey" FOREIGN KEY ("logisticsTaskId") REFERENCES "LogisticsTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LogisticsTaskDocument" ADD CONSTRAINT "LogisticsTaskDocument_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LogisticsTaskMilestone" ADD CONSTRAINT "LogisticsTaskMilestone_logisticsTaskId_fkey" FOREIGN KEY ("logisticsTaskId") REFERENCES "LogisticsTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LogisticsTaskDependency" ADD CONSTRAINT "LogisticsTaskDependency_logisticsTaskId_fkey" FOREIGN KEY ("logisticsTaskId") REFERENCES "LogisticsTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LogisticsTaskDependency" ADD CONSTRAINT "LogisticsTaskDependency_dependsOnTaskId_fkey" FOREIGN KEY ("dependsOnTaskId") REFERENCES "LogisticsTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LogisticsTaskAuditLog" ADD CONSTRAINT "LogisticsTaskAuditLog_logisticsTaskId_fkey" FOREIGN KEY ("logisticsTaskId") REFERENCES "LogisticsTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LogisticsTaskAuditLog" ADD CONSTRAINT "LogisticsTaskAuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LogisticsTaskTeamMember" ADD CONSTRAINT "LogisticsTaskTeamMember_logisticsTaskId_fkey" FOREIGN KEY ("logisticsTaskId") REFERENCES "LogisticsTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LogisticsTaskTeamMember" ADD CONSTRAINT "LogisticsTaskTeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
