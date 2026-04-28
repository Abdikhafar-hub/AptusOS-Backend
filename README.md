# AptusOS Internal Operations Platform Backend

Production-grade Node.js, Express, PostgreSQL, Prisma backend foundation for Aptus Pharma internal operations. This system intentionally avoids CRM scope such as product inventory, stock, sales orders, invoices, procurement shipment tracking, batch numbers, and expiry management.

## Stack

- Node.js + Express
- PostgreSQL + Prisma ORM
- JWT authentication with persisted refresh-token sessions
- bcrypt password hashing
- Zod validation
- Multer + Cloudinary upload service
- Nodemailer provider-ready email abstraction
- Helmet, CORS, compression, rate limiting
- Pino request/application logging

## Setup

```bash
cp .env.example .env
npm install
npx prisma generate
npx prisma migrate dev
npm run seed
npm run dev
```

The API is served at:

```text
http://localhost:5000/api/v1
```

Health check:

```text
GET /api/v1/health
```

## Seeded Defaults

- Roles: General Manager, Department Head, HR Manager, Finance & Accounts Manager, Sales & Compliance Officer, Operations / Procurement Officer, Employee
- Departments: HR, Finance, Accounts, Sales & Compliance, Operations / Procurement, Management
- Leave policies
- First General Manager from `DEFAULT_GM_*` environment variables
- Department channels for each default department

## Architecture

```text
src/
  app.js
  server.js
  config/
  constants/
  controllers/
  emails/
  jobs/
  middleware/
  prisma/
  routes/
  services/
  uploads/
  utils/
  validators/
```

Controllers are thin. Business logic lives in services. Sensitive workflows write audit logs. Notifications are persisted for communication, documents, tasks, approvals, leave, finance, training, and performance events.

Role summary:

- `GENERAL_MANAGER`: Highest authority with full visibility and final approvals.
- `DEPARTMENT_HEAD`: Manages assigned department staff, work, documents, announcements, and approvals.
- `HR_MANAGER`: Handles staff lifecycle, leave, attendance, HR actions, trainings, performance, and separations.
- `FINANCE_ACCOUNTS_MANAGER`: Handles finance requests, budgets, petty cash, reimbursements, payroll review/approval, payment proof uploads, invoice/payment archives, tax/KRA documents, financial reports, and accounting records.
- `SALES_COMPLIANCE_OFFICER`: Handles compliance onboarding, regulatory docs, sales reports, risks, incidents, and escalations.
- `OPERATIONS_PROCUREMENT_OFFICER`: Handles requisitions, vendor documents, logistics tasks, and operational coordination.
- `EMPLOYEE`: Normal staff self-service access.

## Core API Groups

All required route groups are mounted under `/api/v1`, including auth, users, roles, departments, documents, approvals, tasks, comments, messages, channels, announcements, notifications, HR, payroll, finance, accounts, customer onboarding, sales/compliance, operations/procurement, trainings, performance, reports, audit logs, settings, dashboards, and health.

## Notes

- Cloudinary credentials are required for real file uploads.
- Email sends are skipped with a log message until SMTP/provider credentials are configured.
- PDF generation and real-time sockets are intentionally provider-ready extension points.
