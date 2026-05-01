-- Expand department profile fields for GM setup workflow depth
ALTER TABLE "Department"
  ADD COLUMN IF NOT EXISTS "code" TEXT,
  ADD COLUMN IF NOT EXISTS "businessUnit" TEXT,
  ADD COLUMN IF NOT EXISTS "costCenter" TEXT,
  ADD COLUMN IF NOT EXISTS "location" TEXT,
  ADD COLUMN IF NOT EXISTS "contactEmail" TEXT,
  ADD COLUMN IF NOT EXISTS "contactPhone" TEXT,
  ADD COLUMN IF NOT EXISTS "mission" TEXT,
  ADD COLUMN IF NOT EXISTS "operatingNotes" TEXT;

CREATE INDEX IF NOT EXISTS "Department_code_idx" ON "Department"("code");
CREATE INDEX IF NOT EXISTS "Department_businessUnit_idx" ON "Department"("businessUnit");
