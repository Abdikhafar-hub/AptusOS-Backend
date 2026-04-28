ALTER TYPE "DocumentCategory" ADD VALUE IF NOT EXISTS 'BUSINESS_REGISTRATION_CERTIFICATE';
ALTER TYPE "DocumentCategory" ADD VALUE IF NOT EXISTS 'BUSINESS_PERMIT';
ALTER TYPE "DocumentCategory" ADD VALUE IF NOT EXISTS 'PHARMACIST_REGISTRATION_PROOF';
ALTER TYPE "DocumentCategory" ADD VALUE IF NOT EXISTS 'PURCHASE_AUTHORIZATION_LETTER';

-- CreateEnum
CREATE TYPE "ComplianceRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "DueDiligenceStatus" AS ENUM ('PENDING', 'PASSED', 'FAILED', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "PaymentTerms" AS ENUM ('CASH', 'CREDIT', 'MIXED');

-- CreateEnum
CREATE TYPE "CustomerCategory" AS ENUM ('RETAIL', 'WHOLESALE', 'INSTITUTION', 'CORPORATE');

-- AlterTable
ALTER TABLE "CustomerOnboarding"
ADD COLUMN     "registrationNumber" TEXT,
ADD COLUMN     "taxComplianceCertificateNumber" TEXT,
ADD COLUMN     "licenseExpiryDate" TIMESTAMP(3),
ADD COLUMN     "ppbLicenseNumber" TEXT,
ADD COLUMN     "ppbLicenseExpiryDate" TIMESTAMP(3),
ADD COLUMN     "businessPermitNumber" TEXT,
ADD COLUMN     "businessPermitExpiryDate" TIMESTAMP(3),
ADD COLUMN     "contactPersonRole" TEXT,
ADD COLUMN     "alternatePhone" TEXT,
ADD COLUMN     "superintendentPharmacistName" TEXT,
ADD COLUMN     "superintendentPharmacistRegistrationNumber" TEXT,
ADD COLUMN     "pharmacistPhone" TEXT,
ADD COLUMN     "pharmacistEmail" TEXT,
ADD COLUMN     "county" TEXT,
ADD COLUMN     "town" TEXT,
ADD COLUMN     "physicalAddress" TEXT,
ADD COLUMN     "buildingName" TEXT,
ADD COLUMN     "street" TEXT,
ADD COLUMN     "gpsLocation" TEXT,
ADD COLUMN     "deliveryAddress" TEXT,
ADD COLUMN     "complianceRiskLevel" "ComplianceRiskLevel",
ADD COLUMN     "dueDiligenceStatus" "DueDiligenceStatus",
ADD COLUMN     "inspectionRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "paymentTerms" "PaymentTerms",
ADD COLUMN     "creditLimit" DECIMAL(65,30),
ADD COLUMN     "creditDays" INTEGER,
ADD COLUMN     "preferredDeliverySchedule" TEXT,
ADD COLUMN     "customerCategory" "CustomerCategory",
ADD COLUMN     "purchaseAuthorizationRequired" BOOLEAN NOT NULL DEFAULT false;
