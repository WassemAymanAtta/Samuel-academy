# Samuel Academy — Security Remediation Plan

**Date:** 2026-11-25  
**Basis:** `SECURITY-AUDIT.md` Phase 1 findings.  
**Current state:** P0 and approved code-only P1 remediation applied on 2026-11-25. The SA-11 code and additive migration are implemented, but the migration is still unapplied. Owner approval is still required before applying any database-affecting work.

## 1. Prioritisation

| Priority | Findings | Goal | Approval needed |
|---|---|---|---|
| P0 — before any real data | SA-01, SA-02, SA-03, SA-04, SA-05, SA-06 | Stop credential stuffing, token replay, grade forgery, and content/payment bypass | Code changes only; no destructive DB change expected |
| P1 — before staging/public beta | SA-07, SA-08, SA-09, SA-10, SA-11, SA-12, SA-13, SA-14, SA-17, SA-18, SA-20, SA-21 | Harden sessions, entitlements, payments, headers, admin access, secrets, and logging | Yes before applying the authored SA-11 migration; yes for SA-12/SA-17/SA-20 if schema changes are chosen |
| P2 — hardening | SA-15, SA-16, SA-19, SA-22, SA-23, SA-24, SA-25 | Availability, lifecycle, supply chain, privacy, uploads, enumeration | SA-19 upgrade branch; no DB change expected |
| P3 — operational | SA-26, SA-27, SA-28 | Remove temporary tunnel host; add recovery flows, CI and deployment baseline | SA-27 later product decision |

## 2. Phase 2 — Critical/High fixes (P0)

### SA-01 — Rate limiting
- Add `express-rate-limit` or an equivalent in-memory/Redis store.
- Login: per-IP and per-normalized-email windows; `429` + `Retry-After`; temporary backoff after repeated failures.
- Register and payment creation: per-IP/device limits.
- Keep thresholds generous for shared university/mobile NAT; log limit events without logging credentials.
- **Verification:** automated test for 429 and recovery; manual smoke test from localhost.

### SA-02 — Enforce device proof on authenticated requests
- Extend `requireAuth`/`optionalAuth` to call `deviceIdFrom(req)` and compare with `payload.did` and `user.sessionDeviceId`.
- Use the signed httpOnly `sa_device` cookie as the authoritative proof; reject bare header-only replay.
- Keep a controlled media-file path for short-lived file capability tokens from SA-06.
- **Verification:** same token without device proof → 401; bound device → 200; admin role still read from DB.

### SA-03 — Stop answer-key disclosure
- Remove `correctAnswers` from `QuestionFeedback`; store only `questionId`, `correct`, `earnedPoints`, optional `explanation`.
- Remove `correctOptionTexts` from attempt response and attempt-detail response for students.
- Reveal correct answers only after an explicit policy (attempt limit/reveal time), if the product requires it.
- **Verification:** regression tests on both `/api/exams/:id/attempts` and `/api/attempts/:id`.

### SA-04 — Scrub catalog responses
- Replace `include` without `select` in `/catalog/subjects/:id` with explicit course allowlists.
- Stop spreading raw `course`/`unit` objects in `/catalog/courses/:id`.
- Reuse `fileSelect` for file metadata; no `pdfUrl`, `videoUrl`, or `pdfFileId` in public metadata.
- **Verification:** anonymous and unpaid-student assertions across subjects, courses, units, and lesson endpoints.

### SA-05 — Respect publication state for private files
- Add `isPublished` to lesson selects used by `files.ts`.
- For non-admin users, require the linked lesson to be published before allowing file bytes.
- **Verification:** hidden lesson file → 403/404; published entitled lesson file → 200; admin still 200.

### SA-06 — Replace login JWT in file URLs
- Implement short-lived file capability tokens scoped to one `FileAsset` ID and expiry, signed with a dedicated key or derived key with explicit purpose.
- Accept only that capability token on `/api/files/:id`; continue to accept normal auth only via header/cookie where possible.
- Set `Referrer-Policy: no-referrer` and ensure proxy access logs strip `token`.
- Keep `/api/files/:id` entitlement checks intact.
- **Verification:** capability token for file A cannot access file B or any non-file API; expired token → 401; media player still works.

## 3. Phase 3 — Medium fixes (P1)

### Sessions and account lifecycle
- **SA-07:** require signed device cookie; header must match cookie or be ignored.
- **SA-08:** conditional logout update matching verified `sv`/`did`; stale logout must fail.
- **SA-16:** increment `sessionVersion` and clear `sessionDeviceId` on any status transition away from `ACTIVE` and on reactivation.
- **SA-21:** require ≥32 random characters for production JWT secret; shorten access token TTL; introduce refresh rotation if needed.
- **SA-17:** add TOTP/WebAuthn MFA for admin accounts and step-up authentication for status/price/payment approval changes. This may add a new MFA credential table/fields.

### Entitlements, exams and payments
- **SA-09:** separate catalog decoration sets from entitlement sets; course-level files require explicit course/subject grants.
- **SA-10:** server-side password policy ≥12 chars with common/sequential/email-derived rejection; mirror in UI.
- **SA-11:** enforce attempt count and server-side deadline; add idempotency/dedupe for duplicate submissions. Implemented in code; migration authored but unapplied, so deployment remains blocked pending approval and verification.
- **SA-12:** detect existing duplicate references; add a global unique index or normalized `transferKey` after cleanup/owner decision; surface collisions in admin UI.

### Requests, headers and uploads
- **SA-13:** move `requireAuth`/`requireAdmin` before raw upload parsers.
- **SA-14:** add security headers (`CSP`, HSTS behind HTTPS, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`, `nosniff`).
- **SA-23:** stronger container validation, quota, orphan cleanup, and AV/sandbox plan for production.

### Configuration and observability
- **SA-18:** require real payment details when `DEMO_MODE=false`; reject demo/placeholder values.
- **SA-20:** structured JSON logs with request IDs and append-only `AuditLog` events for failed logins, status/role changes, price changes, payment decisions, approvals/rejections, upload failures, and repeated 401/403/429.
- **SA-28:** add CI running tests, build, `npm audit --omit=dev`, and secret scanning.

## 4. Phase 4 — Automated security tests

Create/extend `apps/api/tests/security.test.ts` and a new `apps/api/tests/exam-security.test.ts`:

1. Student cannot access admin endpoints and cannot change role/status/price/payment status.
2. Student cannot read another student's grades, attempts, payments, or progress.
3. Pending/rejected users cannot call protected APIs even with stale cookies.
4. Invalid/expired/stale-logout tokens are rejected.
5. Logout revokes the presented session and no newer one.
6. Token replay from a different device without device proof → 401.
7. Rate limits return 429 and include `Retry-After`.
8. File access requires entitlement and publication; unpublished lesson file → 403/404.
9. External/private URLs never appear in anonymous catalog responses.
10. File capability token expires and is file-scoped; login JWT is never in a media URL.
11. Exam answer key never appears in responses or stored feedback.
12. Exam attempt limit, deadline, and idempotency work server-side.
13. Payment approval is atomic/idempotent; duplicate global reference is rejected.
14. Unauthenticated oversized upload is rejected before body buffering.
15. Password hashes and sensitive fields never appear in API responses.
16. Production config rejects missing/placeholder secrets and demo payment details.

All tests must use `TEST_DATABASE_URL` fixtures and must not touch the demo/production database.

## 5. Database-affecting changes requiring explicit owner approval

No database change has been applied. SA-11 is implemented as an additive migration file but remains unapplied; the other rows below are **proposals only**:

| Finding | Proposed / authored change | Impact | Approval question |
|---|---|---|---|
| SA-11 | Authored `20261125130000_sa11_exam_attempt_policy`: nullable `Exam.maxAttempts`, `ExamAttemptSession` table with durable `idempotencyKey`, `ExamAttempt.startedAt`/`sessionId`, constraints and indexes | Backward-compatible: existing rows remain valid; `NULL` preserves unlimited behaviour; legacy attempts with `sessionId = NULL` still count | Approve applying the authored migration after backup and restore verification? |
| SA-12 | Add global unique index on `PaymentRequest.reference` or normalized `transferKey` | Read-only pre-check required; if historical duplicates exist, they must be handled deliberately. No rows deleted automatically | Approve index and duplicate-handling policy? |
| SA-17 | Add MFA credential fields/table for admins | Backward-compatible; admins without MFA can be forced to enroll before sensitive actions | Approve MFA rollout and break-glass process? |
| SA-20 | Add append-only `AuditLog` table | New table only; no existing data modified | Approve retention period (e.g. 90/180/365 days)? |

Before applying any migration, back up the target database and verify the restore procedure, then run the migration against a **backup/restored copy** first, review generated SQL, and only then apply to the target database using `prisma migrate deploy`. For SA-11, verify the migration record and the new columns/table before deploying the new API. Deploying the new API against a database without the SA-11 migration is unsupported. Do not use `db:reset`, `db:seed`, `migrate resolve`, or destructive SQL.

## 6. Phase 5 — Verification gates

Required after implementation:

- `npm run build` → exit 0.
- `npm test` → all tests pass, including new regressions.
- `npm audit --omit=dev` → clean or each remaining advisory has a documented risk acceptance.
- `npm run db:migrate` → only approved migrations, applied to a test/backup copy first; SA-11 stays unapplied until explicitly approved.
- API health and web smoke tests on localhost.
- Browser checks for login, paid content, exam, payment approval, dark mode, and file playback under CSP.
- Security header and token-leak checks in network panel.
- Review logs to confirm no passwords/tokens/payment proof contents are written.

## 7. Phase 6 — Final diff review checklist

- No `db:reset`, destructive seed, `DELETE FROM`, `DROP`, or `TRUNCATE`.
- No student/payment/grade/course/lesson/progress data deleted.
- No `.env`, `.env.production`, token, password, or secret added to tracked files.
- No weakened authorization middleware.
- No wildcard CORS/host allowance except an explicitly temporary trial value.
- No unrelated UI rewrite.
- All new admin actions covered by server-side checks and audit events.
- `SECURITY-VERIFICATION.md` updated with actual commands and results.

---

## 8. Phase 2 execution record (2026-11-25)

### 8.1 What was executed

- P0: SA-01, SA-02, SA-03 (disclosure part; later extended by §8.5), SA-04, SA-05, SA-06.
- P1 code-only: SA-07, SA-08, SA-09, SA-10, SA-13, SA-16, SA-18; partial code work for SA-12, SA-14, SA-20, SA-21, SA-22.
- SA-03 disclosure was fixed; SA-11 was later implemented in code with an authored migration, but that migration remains unapplied and unapproved.
- Pre-change backup: `D:\Temp\opencode\samuel-academy-p0-backup-20261125-031500`.
- **No migration, seed, reset, delete, or destructive database action was performed.**

### 8.2 Remaining database proposals — exact details, still unapproved

SA-11 below documents the authored (but unapplied) migration. The remaining rows are proposals only. None has been applied or tested against a restored copy; each must first be reviewed as generated SQL on a backup/restored database.

#### SA-11 — Exam attempt controls (authored migration, still unapplied)

- **Exact schema change** (`20261125130000_sa11_exam_attempt_policy`)
  - `Exam.maxAttempts Int?` with `CHECK (maxAttempts IS NULL OR maxAttempts > 0)`; `NULL` means unlimited.
  - New `ExamAttemptSession` table: `id`, `userId`, `examId`, `startedAt`, `expiresAt`, `submittedAt`, `abandonedAt`, `idempotencyKey`; unique `(userId, examId, idempotencyKey)` plus started-at/expires-at indexes.
  - `ExamAttempt.startedAt DateTime?` and `ExamAttempt.sessionId String? @unique` with a nullable FK to `ExamAttemptSession`.
  - Index `@@index([examId, userId, submittedAt])` for attempt-count queries.
- **Why required:** enforce `maxAttempts`, authoritative deadlines from the database clock, durable idempotency, and atomic submit/duplicate rejection.
- **Existing data affected:** no row values change; all added columns are nullable. Existing attempts (including `sessionId = NULL`) remain valid and count toward finite limits. No backfill is performed.
- **Application invariant:** one active session per `(userId, examId)` is enforced by `pg_advisory_xact_lock` plus row checks in `examAttemptSessions.ts`; it is not a DB partial unique constraint.
- **Duplicate/orphan pre-check:** verify no orphan attempts and no duplicate legacy keys before applying; the new session table starts empty, so no idempotency key can pre-exist.
- **Rollback/recovery:** drop the added constraints/indexes, then the two added columns and the new table, or restore the pre-migration snapshot. No separate down migration file exists. No grades/progress are deleted by the forward migration.

#### SA-12 — Global payment reference uniqueness

- **Exact schema change:** add `@@unique([reference])` to `PaymentRequest`, retaining the existing `@@unique([userId, reference])`.
- **Why required:** close the race window left by the application-level cross-user pre-check; one transfer reference must not grant two students access.
- **Existing data affected:** no values are changed. If historical exact duplicates exist, constraint creation fails; no rows are deleted or auto-merged.
- **Duplicate/orphan pre-check (read-only):**
  ```sql
  SELECT reference, COUNT(*)
  FROM "PaymentRequest"
  GROUP BY reference
  HAVING COUNT(*) > 1
  ORDER BY COUNT(*) DESC;
  ```
  Also verify `productId` and `userId` resolve. If duplicates exist, owner must decide a manual policy. Case/whitespace normalization is **not** included; a normalized `transferKey` would be a separate proposal requiring a backfill.
- **Rollback/recovery:** drop the added constraint (`PaymentRequest_reference_key`) or restore the pre-migration snapshot. No payment/grant rows are removed by the forward migration.

#### SA-17 — Admin MFA credentials

- **Exact schema change:** new `AdminMfaCredential` table with `id`, `userId` (unique FK to `User`, `onDelete: Cascade`), `type` (`TOTP`/`WEBAUTHN`), `secretEncrypted`, `confirmedAt`, `lastUsedAt`, `createdAt`.
- **Why required:** second factor and step-up reauthentication for admin status/price/payment actions.
- **Existing data affected:** new table only; no user/payment/grade rows modified. Enforcement remains off until owner-approved rollout and break-glass process.
- **Duplicate/orphan pre-check:** list `ADMIN` users without a credential before enforcement; verify no non-admin gets a credential; FK prevents orphan rows.
- **Rollback/recovery:** drop the new table or restore snapshot; only MFA enrolments created after go-live are lost. Break-glass admin recovery must be documented before enforcement.

#### SA-20 — Durable audit log

- **Exact schema change:** new append-only `AuditLog` table with `id`, `createdAt`, `type`, `requestId`, `actorUserId` (plain string, not FK), `subjectUserId` (plain string, nullable), `route`, `ipHash`, `metadata Json`. No cascade relationship to `User`, so audit history survives user deletion.
- **Why required:** current structured JSON events go only to stdout; durable events and alerting are needed for incident reconstruction.
- **Existing data affected:** new table only; no existing rows modified.
- **Duplicate/orphan pre-check:** no existing rows; `requestId` is intentionally non-unique because one request can emit several events; verify no sensitive field names/values are written by the emitter.
- **Rollback/recovery:** drop the table or restore snapshot; events recorded after deployment are lost. Owner must approve retention (suggest 180 days) and alert routing before production use.

### 8.3 Dependency advisory decisions

No packages were installed, upgraded, or removed. All 7 advisories remain open by version, with these documented decisions:

- `@prisma/config`, `deepmerge-ts`, `effect`, `prisma` (4 high): build/CLI toolchain path only in this app; no patched 6.x line; fix requires major Prisma 7.10.1. Deferred pending owner-approved upgrade branch and full regression run.
- `react-router`, `react-router-dom` (2 moderate): SSR hydration path is unreachable in this client-only `BrowserRouter`; open-redirect path is latent because navigation targets are app-controlled. Fix requires major 7.18.7. Deferred pending owner-approved branch.
- `zod` (high): runtime-reachable through unbounded arrays in answer/admin-question validation. Interim `.max()` caps added in `exams.ts` and `admin.ts`; error-detail output capped in `errors.ts`. Major 4.6.7 upgrade deferred.

### 8.4 Gate results

- `npm test` → 38/38 passed, 8 suites, 0 failures.
- `npm run build` → exit 0 for API type-check and web Vite build.
- `npm audit --omit=dev --json` → exit 1 as expected; 7 advisories (5 high, 2 moderate), individually documented above.
- `GET /api/health` → 200; `GET /` → 200 on the existing local demo servers.
- No production deployment or production configuration change was made.

### 8.5 Hotfix phase: SA-01 and SA-03 closure (2026-11-25)

A follow-up code-only phase closed the two independent-review blockers. **No schema, migration, seed, database data, dependency, lockfile, production configuration, or deployment was changed.**

**SA-01 implemented policy**
- Login requests are checked before authentication, but the counter is incremented only by `recordFailedLogin()` on malformed input or invalid credentials. Successful authentication, non-ACTIVE status, and device-binding failures do not consume the failed-login budget.
- The email bucket key is a salted SHA-256 hash of the normalized email plus a salted hash of `req.ip`. Raw emails and raw IPs are not stored in keys or structured logs.
- Login limits remain 10 failed attempts per email-hash/IP-hash composite and 100 failed attempts per IP per 15-minute window. Register/payment limits remain eager per-IP limits.
- Invalid or missing email values are validated safely, count as failed attempts for the IP-based bucket, and still receive `429` + numeric `Retry-After` at the limit.
- Express `trust proxy` remains disabled in `app.ts`; the limiter never reads `X-Forwarded-For` directly. A proxy deployment must explicitly configure trusted hops or accept that all clients share the proxy IP bucket.
- The store is still an in-process `Map`: state is not restart-safe and is not shared across API instances. A shared store remains an owner decision; it was not added in this phase.

**SA-03 implemented policy**
- Grading stays server-side. `QuestionFeedback` still computes correctness internally, but no response or stored attempt persists/exposes `correct`, `earnedPoints`, `explanation`, answer keys, or correct option text.
- `feedback` written to `ExamAttempt` is limited to `{ questionId }`. Student submission, `/api/attempts/:id`, `/api/student/me/attempts`, and dashboard responses sanitize legacy rows through `safeFeedback()`.
- Only the earliest persisted attempt for `(userId, examId)` may disclose an overall score. Repeated submissions and concurrent duplicate submissions receive a receipt with no score, percent, passed flag, or feedback.
- First-attempt selection is derived from persisted rows after creation, so two racing submits cannot both claim the first-attempt score. No in-memory attempt limit or idempotency workaround was added.
- Durable `maxAttempts`, `startedAt`, deadline, and idempotency-key behaviour are implemented and covered by regression tests, but remain **unapplied** because production approval has not been granted. Admins retain score visibility; per-question correctness is not restored for admins in this phase.

**Direct regression coverage**
- `does not count successful logins toward the failed-login limit`
- `limits failed logins by composite email/IP key and returns Retry-After`
- `does not let an attacker lock a victim by email from another IP`
- `handles invalid or missing login email safely and still limits failures`
- `recovers the failed-login limit after the configured window`
- `keeps server-side grading and first-attempt scoring correct without disclosing per-question correctness`
- `does not expose correctness on repeated exam submissions`
- `does not create an answer oracle from concurrent duplicate submissions`
- `does not let a student read another student’s exam result`

**Indirect coverage:** existing authentication, session, logout, status-change, payment, entitlement, and file-token suites continue to exercise surrounding behavior. They do not replace the explicit assertions above.

**Hotfix gate results**
- Filtered SA-01/SA-03 run: **26/26 passed**, 0 failures — `D:\Temp\opencode\p0-hotfix-targeted.log`.
- Complete API suite: **46/46 passed**, 8 suites, 0 failures, 0 skipped — `D:\Temp\opencode\p0-hotfix-test.log`.
- `npm run build`: **Exit 0**; API `tsc` clean; web `tsc -b && vite build` clean, 1653 modules — `D:\Temp\opencode\p0-hotfix-build.log`.
- No schema, migration, seed, dependency manifest, lockfile, production config, or deployment change occurred in this hotfix.
