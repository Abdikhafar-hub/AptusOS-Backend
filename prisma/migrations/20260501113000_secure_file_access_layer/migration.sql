-- Extend audit actions with file access event
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'DOCUMENT_ACCESSED';

-- Persist Cloudinary delivery metadata for secure URL generation
ALTER TABLE "Document"
  ADD COLUMN IF NOT EXISTS "cloudinaryResourceType" TEXT NOT NULL DEFAULT 'raw',
  ADD COLUMN IF NOT EXISTS "cloudinaryDeliveryType" TEXT NOT NULL DEFAULT 'authenticated';

ALTER TABLE "DocumentVersion"
  ADD COLUMN IF NOT EXISTS "cloudinaryResourceType" TEXT NOT NULL DEFAULT 'raw',
  ADD COLUMN IF NOT EXISTS "cloudinaryDeliveryType" TEXT NOT NULL DEFAULT 'authenticated';

-- Backfill previously stored direct URLs into an internal storage URI representation.
-- This prevents permanent Cloudinary URLs from being stored as source-of-truth.
UPDATE "Document"
SET "fileUrl" = CONCAT(
  'cloudinary://',
  COALESCE(NULLIF("cloudinaryResourceType", ''), 'raw'),
  '/',
  COALESCE(NULLIF("cloudinaryDeliveryType", ''), 'authenticated'),
  '/',
  "cloudinaryPublicId"
)
WHERE "cloudinaryPublicId" IS NOT NULL;

UPDATE "DocumentVersion"
SET "fileUrl" = CONCAT(
  'cloudinary://',
  COALESCE(NULLIF("cloudinaryResourceType", ''), 'raw'),
  '/',
  COALESCE(NULLIF("cloudinaryDeliveryType", ''), 'authenticated'),
  '/',
  "cloudinaryPublicId"
)
WHERE "cloudinaryPublicId" IS NOT NULL;
