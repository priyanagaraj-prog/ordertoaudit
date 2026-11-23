# Security Specification — FactoryFlow ERP (Order-to-Audit ERP)

## 1. Data Invariants & Access Model
1. **PII Strict Isolation (`/users/{userId}`)**: `/users/{userId}` documents contain verified employee email and phone PII. Only authenticated, email-verified owners/admins or the document owner (`request.auth.uid == userId`) may read `/users`. Demonstration mode users NEVER access `/users`.
2. **Demonstration Mode Disclosure**: FactoryFlow ERP supports a sign-in-free evaluation workspace (Merchant Portal & Buyer Portal) per Phase 2 requirements. Server-side `/api/*` endpoints issue HMAC-signed portal session tokens (`X-FactoryFlow-Session`) so Buyers are blocked (`403 Forbidden`) from invoking Merchant-only manufacturing, variance, or AI endpoints.
3. **Strict Schema Blueprints (`isValid[Entity]`)**: Every document written to Cloud Firestore must pass full key allowlisting (`keys().hasAll(...) && keys().hasOnly(...)` on create; `affectedKeys().hasOnly(...)` on update), strict type checks, string `.size()` bounds, integer-paisa assertions (`is int`), and `isValidId()` path validation (`^[a-zA-Z0-9_\-]+$`).
4. **Immutable Ledgers (`stock_movements`, `audit_logs`, `payments`, `qc_inspections`)**: Append-only audit trails deny all `update` and `delete` operations (`allow update, delete: if false;`).
5. **No Destructive Deletes**: `allow delete: if false;` is enforced across every collection.
6. **Temporal Integrity**: `createdAt` and `updatedAt` must strictly equal `request.time` (server timestamps).
7. **Accountant / Deactivated Member Guard**: If signed into Firebase Auth with an inactive `/users/{uid}` status, all workspace writes and reads are denied.

## 2. Adversarial Payloads Verified Against Rules
1. **Unauthenticated PII Read**: Unauthenticated client attempts `get(/users/uid_1)` -> `PERMISSION_DENIED`.
2. **Shadow Field Injection**: Client injects ghost key `bypassAudit: true` on `sales_orders` -> `PERMISSION_DENIED`.
3. **Float Paisa Poisoning**: Client submits `sellingPricePaisa: 75.5` on `products` -> `PERMISSION_DENIED`.
4. **Oversized String DoS**: Client submits 50KB description on `products` or invalid `docId` -> `PERMISSION_DENIED`.
5. **Audit Log Mutation**: Any client attempts `update` or `delete` on `audit_logs/{id}` -> `PERMISSION_DENIED`.
6. **Stock Ledger Tampering**: Any client attempts `update` or `delete` on `stock_movements/{id}` -> `PERMISSION_DENIED`.
7. **Terminal State Bypass**: Client attempts modifying an already `delivered` dispatch or `received` purchase -> `PERMISSION_DENIED`.
8. **Buyer Privilege Escalation on Backend**: Buyer session token calls `POST /api/production/calculate-variance` or `POST /api/ai/insights` -> `403 Forbidden`.
