-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SETTINGS_UPDATED';

-- CreateEnum
CREATE TYPE "SettingScopeType" AS ENUM ('ORGANIZATION', 'DEPARTMENT', 'ROLE', 'USER');

-- DropIndex
DROP INDEX "Setting_key_key";

-- AlterTable
ALTER TABLE "Setting"
ADD COLUMN "organizationId" TEXT NOT NULL DEFAULT 'aptus-default-org',
ADD COLUMN "section" TEXT NOT NULL DEFAULT 'legacy',
ADD COLUMN "scopeType" "SettingScopeType" NOT NULL DEFAULT 'ORGANIZATION',
ADD COLUMN "scopeKey" TEXT NOT NULL DEFAULT 'GLOBAL',
ADD COLUMN "createdById" TEXT,
ADD COLUMN "updatedById" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Setting_organizationId_section_key_scopeType_scopeKey_key" ON "Setting"("organizationId", "section", "key", "scopeType", "scopeKey");
CREATE INDEX "Setting_organizationId_section_idx" ON "Setting"("organizationId", "section");
CREATE INDEX "Setting_scopeType_scopeKey_idx" ON "Setting"("scopeType", "scopeKey");
