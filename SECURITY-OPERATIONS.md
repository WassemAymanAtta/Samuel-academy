# Samuel Academy — Security Operations (Phase 1 baseline)

**Date:** 2026-11-25  
**Status:** Phase 1 operational baseline plus Phase 2 execution notes. Items marked **TODO** remain owner actions; Section 8 records what changed on 2026-11-25.

## 1. Secrets management

### Current state

- `.env`, `.env.*`, `storage/`, uploads, logs and build output are excluded by `.gitignore`.
- Only `.env.example` and `apps/api/.env.example` are tracked; both contain templates, not real production secrets.
- A local `.env.production` exists with production admin configuration and JWT secret. It is gitignored. Its values are intentionally not reproduced in these reports.
- `apps/api/src/lib/config.ts` refuses production startup when `DEMO_MODE` is not `false`, when `DATABASE_URL` points to a demo database, or when `ADMIN_EMAIL` / `ADMIN_PASSWORD` are missing or placeholder values.
- DONE (SA-18): production now requires `PAYMENT_INSTAPAY` and `PAYMENT_EWALLET` and rejects demo placeholders; demo mode still uses `DEMO_PAYMENT_*`.
- PARTIAL (SA-21): production now requires a ≥32-character `JWT_SECRET`; token TTL is still 7 days.
- TODO (SA-28): add automated secret scanning in CI.

### Rules

1. Keep production secrets in a managed secret store or gitignored `.env.production`; never commit them.
2. Generate `JWT_SECRET` with a cryptographically secure generator and rotate it during an incident. Rotating it invalidates every existing session, so plan a maintenance window.
3. Store the production admin password only in the secret store. Do not send it to students or paste it into tickets/chat.
4. If any secret was ever committed, removing it in a later commit is not enough: rotate it immediately and purge history according to the organisation’s process.
5. Logs must never contain passwords, tokens, reset links, cookies, or payment proof contents.
6. API errors in production must remain generic; do not enable stack traces or verbose Prisma errors.

## 2. Backup and restore

### Existing backup

A pre-change backup was created earlier at:

```text
D:\Temp\opencode\samuel-academy-backup-20261125-014426
```

It includes a database snapshot. This was used for prior QA work, not for this Phase 1 audit.

### Backup policy to adopt

| Asset | Recommended schedule | Notes |
|---|---|---|
| PostgreSQL database | Before every migration and at least daily in production | Use `pg_dump` with a least-privilege backup role; encrypt at rest. |
| Uploaded files (`apps/api/storage/uploads`) | Same cadence as database | Must be restored together with the DB so `FileAsset` rows match files. |
| Secrets | Managed secret store with version history | Never store in the repository or backup as plaintext. |
| Logs / audit events | Retention per policy (suggest 180 days) | Append-only where possible. |

### Restore procedure (owner action; not executed)

1. Stop write traffic or enter maintenance mode.
2. Restore database and upload files to a **staging copy** first.
3. Verify counts for users, payments, access grants, exam attempts, progress, and file assets.
4. Verify representative student login, PDF access, and payment approval.
5. Only then restore the target environment.
6. Rotate sessions after a suspected compromise by bumping `sessionVersion` for affected users.

**Status:** Restore has **not** been tested. Owner should schedule a restore drill before production.

## 3. Safe database change rules

- Never run `npm run db:reset` or `npm run db:seed` against a real/shared database.
- `db:seed` already requires `ALLOW_DEMO_SEED=1` and an allow-listed demo database name. Keep that guard.
- Use `npm run db:migrate` (`prisma migrate deploy`) for forward-only migrations.
- Review generated SQL before applying any migration.
- Test every migration on a restored copy first.
- No destructive migration has been applied during this audit.
- Proposed migrations requiring approval are listed in `SECURITY-REMEDIATION-PLAN.md` section 5.

## 4. Monitoring and logging

### Current state

- Structured JSON security events and `X-Request-ID` are now emitted to stdout (`lib/logging.ts`).
- No durable audit table or alert routing yet; TODO (SA-20) remains open for the `AuditLog` migration.
- Existing error handler still returns safe generic errors and now caps Zod detail output.

### Required events after remediation

| Event | Required fields (no secrets) |
|---|---|
| Login success/failure | requestId, timestamp, IP hash, userId on success, reason code, userAgent summary |
| Rate-limit violation | requestId, route, IP hash, window, count |
| Registration | requestId, IP hash, userId, status `PENDING` |
| Approval / rejection | requestId, adminId, studentId, fromStatus, toStatus |
| Payment approval / rejection | requestId, adminId, paymentId, productId, decision, amountCents, no reference content in logs |
| Role / price / product changes | requestId, adminId, objectId, field, old/new non-sensitive values |
| File upload success/failure | requestId, adminId, fileId, sizeBytes, mimeType, failure reason |
| Authorization failure | requestId, route, userId if known, reason code |
| Logout / session revocation | requestId, userId, reason |

### Alert triggers

- Repeated 401/403 from one IP or account.
- Repeated 429 violations.
- Multiple payment approvals by one admin in a short window.
- Any admin role/status/price change outside business hours.
- Upload failures with oversized or invalid file signatures.
- Production config startup failures.

## 5. Incident response

### 5.1 Disable a compromised student account

Use the admin UI where possible: **Admin → Students → status REJECTED**.

The admin status change now revokes sessions automatically. If an out-of-band compromise requires an explicit update, use this safe pattern (run only after verifying the email):

```sql
UPDATE "User"
SET "status" = 'REJECTED',
    "sessionVersion" = "sessionVersion" + 1,
    "sessionDeviceId" = NULL
WHERE "email" = $1;
```

This does not delete data. Confirm `row_count = 1` before proceeding.

### 5.2 Disable a compromised admin account

1. Rotate `ADMIN_PASSWORD` in the secret store / `.env.production`.
2. Re-run `npm run db:bootstrap-admin` against the correct production database. The script updates that admin only, bumps `sessionVersion`, and clears device binding.
3. Revoke other admin accounts with the safe SQL pattern above if they exist.
4. Rotate `JWT_SECRET` if token theft is suspected; expect all sessions to be invalidated.
5. Review audit logs after SA-20 is implemented; until then, preserve existing proxy/application logs.

### 5.3 Suspected token leakage through file URLs

1. Revoke the affected user session using the safe update above.
2. Remove URLs containing `token` from proxy logs/referrers where possible.
3. Prioritise SA-06 and SA-02 implementation.
4. Add `Referrer-Policy: no-referrer` with SA-14.

### 5.4 Suspected duplicate payment approval

1. Identify all `PaymentRequest` rows with the same reference using a read-only query.
2. Freeze further approvals for those references.
3. Verify bank/transfer records manually.
4. Revoke duplicated `AccessGrant` rows only after owner authorisation; do not delete payments or grade/progress data.
5. Implement SA-12.

## 6. Deployment checklist

### Before deployment

- [ ] Owner-approved remediation plan; P0/P1 findings resolved or explicitly risk-accepted.
- [ ] Target database backed up and the restore procedure verified with a restore drill.
- [ ] The reviewed SA-11 migration (`20261125130000_sa11_exam_attempt_policy`) is approved, applied first to a restored copy, then applied to the target database and verified before API deployment.
- [ ] `npm test` and `npm run build` pass; the build runs `prisma generate` before the API TypeScript compile.
- [ ] Deploying the new SA-11 API code against a database without the applied migration is unsupported.
- [ ] `npm audit --omit=dev` clean or documented risk acceptance.
- [ ] `.env.production` contains real `DATABASE_URL`, `WEB_ORIGIN`, fresh `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and (after SA-18) real payment details.
- [ ] `DEMO_MODE=false`.
- [ ] `SESSION_BINDING_ENABLED` is unset or `true` — never carry the Staging suspension into Production.
- [ ] `DATABASE_URL` is not `samuel_academy_staging` — Staging auto-enables demo logins and suspends device binding; the real Production target restores both protections.
- [ ] `WEB_ORIGIN` lists explicit HTTPS origins; no wildcard.
- [ ] Temporary ngrok host removed from `apps/web/vite.config.ts` after the trial (SA-26).
- [ ] Admin credentials not shared with students.

### Runtime

```bash
# On the production host with secrets supplied by the environment/secret store.
# Backup and verified restore drill must already be complete.
$env:NODE_ENV='production'

# 1. Apply the reviewed SA-11 migration only after owner approval.
#    Use the CLI directly so client generation happens once, in npm run build.
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma

# 2. Verify success before deploying any SA-11-dependent API code:
#    _prisma_migrations contains 20261125130000_sa11_exam_attempt_policy;
#    Exam.maxAttempts, ExamAttemptSession, ExamAttempt.startedAt and
#    ExamAttempt.sessionId are present. Stop if any check fails.

# 3. Build artifacts. npm run build -> prisma generate + API tsc + web vite.
npm run build
npm run db:bootstrap-admin

# 4. Only now deploy/start the API code that depends on the new schema.
npm run start -w apps/api
```

Serve `apps/web/dist` from a normal static host behind HTTPS.

### Proxy / TLS

- [ ] TLS terminated at a trusted reverse proxy; no plaintext HTTP to users.
- [ ] HSTS enabled only after confirming HTTPS.
- [ ] Request body-size limits at proxy (must not exceed configured media limit).
- [ ] Connection/concurrency rate limits at proxy.
- [ ] Trusted proxy headers configured explicitly; no spoofed `X-Forwarded-*` from clients.
- [ ] Access logs strip `token` query parameters.
- [ ] PostgreSQL not publicly exposed; use private networking and least-privilege DB role.
- [ ] Upload directory not served directly by the web server.

### After deployment

- [ ] `GET /api/health` returns 200 and no infrastructure details.
- [ ] Admin can log in with configured credentials.
- [ ] Demo credential cards absent on `/login` and `/`.
- [ ] New registration starts `PENDING` and cannot access protected APIs.
- [ ] Payment approval still requires admin and creates one grant.
- [ ] Private PDF/media access is authorized and tokens are not visible in URLs.
- [ ] Security headers and CSP verified.
- [ ] Logs contain security events and no sensitive values.

## 7. Owner manual actions

1. Approve or reject the remediation plan, including proposed migrations.
2. Decide MFA rollout and break-glass admin recovery (SA-17).
3. Decide payment-detail production values (SA-18).
4. Remove the temporary ngrok host after the current trial (SA-26).
5. Schedule and perform a backup restore drill.
6. Confirm whether GitHub Dependabot advisories should be remediated by major upgrades or risk-accepted with compensating controls.

---

## 8. Phase 2 operational changes (2026-11-25)

### 8.1 Sessions and devices

- The signed httpOnly `sa_device` cookie is now **authorising proof**, not just a hint. A bare `X-Device-Id` header is ignored.
- Login issues an httpOnly `sa_token` cookie and a tab Bearer token; both require the matching signed device cookie on every protected request.
- Logout clears both cookies and conditionally increments `sessionVersion`; a stale logout cannot revoke a newer session.
- Any student status change now increments `sessionVersion` and clears `sessionDeviceId`, so reject → reactivate cannot resurrect an old token.
- In production both cookies use `secure: true`. Keep `WEB_ORIGIN` explicit and serve over HTTPS.

### 8.2 Rate limits

| Endpoint | Limit | Window |
|---|---|---|
| `POST /api/auth/login` | 100 failed attempts per IP **and** 10 failed attempts per salted email-hash + IP-hash composite | 15 minutes |
| `POST /api/auth/register` | 60 per IP | 15 minutes |
| `POST /api/payments` | 120 per IP | 15 minutes |

Successful logins do not consume the failed-login budget. Valid JSON with a missing or invalid email is counted as a failed attempt and still returns the normal validation error until the limit is reached; syntactically invalid JSON is rejected by `express.json()` before the login route and is not counted by this limiter. Rate-limit keys contain salted hashes only; raw emails and IPs are not retained.

Responses include `429`, a numeric `Retry-After`, `RateLimit-Limit`, `RateLimit-Remaining`, and `RateLimit-Reset` (seconds until reset). Express `trust proxy` is disabled and `X-Forwarded-For` is ignored; behind a proxy, configure trusted hops deliberately or all clients will share the proxy IP bucket. The limiter is in-process only and clears on restart; a multi-instance deployment must replace it with a shared store before relying on it.

### 8.2.1 Exam attempt disclosure

- Grading remains server-side; no student-facing response contains per-question `correct`, points, explanations, answer keys, or correct option text.
- Stored feedback is limited to `{ questionId }`; `safeFeedback()` sanitizes legacy rows on read.
- Only the earliest persisted attempt per student/exam shows an overall score. Repeated attempts and racing duplicates return a receipt with no score, percent, pass flag, or feedback.
- Student attempt list and dashboard also hide repeated-attempt scores. Admins still see overall scores, not per-question correctness.
- SA-11 durable attempt limits, server-side deadlines, and idempotency keys are implemented in code and have an authored migration, but the migration is still **unapplied** and production approval has **not** been granted. Do not deploy the new API against an unmigrated database; until then, treat exams as single-score assessments, not unlimited practice with feedback.

### 8.3 Configuration

- Demo mode still uses `DEMO_PAYMENT_INSTAPAY` and `DEMO_PAYMENT_EWALLET` with demo defaults.
- Production (`DEMO_MODE=false`) now requires `PAYMENT_INSTAPAY` and `PAYMENT_EWALLET`; values beginning with `DEMO`, containing `change-this`, or the dummy `01000000000` are rejected at startup.
- Production `JWT_SECRET` must be at least 32 characters and must not be a placeholder.
- `apps/api/.env.example` documents the new production keys. No real environment value was read or printed.

### 8.4 Private files and media URLs

- Login JWTs are no longer appended to file/media URLs.
- Browsers use the normal session cookie; API/media clients that cannot use headers can request `/api/files/:id/token` and use the short-lived `ftoken` query parameter.
- `ftoken` is valid for 10 minutes, scoped to one file ID, bound to the current session/device, and rejected by all non-file APIs.
- Reverse-proxy access logs should strip both `token` and `ftoken` query parameters. `Referrer-Policy: no-referrer` is set by the API.

### 8.5 Security events currently emitted

Events are JSON lines on stdout with `ts`, `type`, `requestId`, and route. Implemented types: `register`, `register_duplicate`, `login_success`, `login_failed`, `logout`, `rate_limit`, `student_status_changed`, `payment_reviewed`. Fields are hashed where identifying (`emailHash`, `ipHash`) and never include passwords, tokens, cookies, or payment-proof contents.

No durable `AuditLog` table, retention job, or alert routing exists yet; those remain owner-approved migration/operational work.

### 8.6 Database and deployment state

- No migration, seed, reset, delete, or destructive database action was performed in Phase 2.
- Schema and migration files were unchanged from Phase 1 during Phase 2; the later SA-11 code and additive migration file are implemented but remain unapplied.
- Pre-change source backup: `D:\Temp\opencode\samuel-academy-p0-backup-20261125-031500`.
- Local demo smoke checks after remediation: `GET /api/health` → 200, `GET /` → 200.
- No production deployment or production configuration file was changed; only code validation and release-checklist requirements changed.
- Current SA-11 release gate: migration unapplied, production approval not granted, and new API code must not be deployed until the migration is applied and verified.

### 8.7 Owner actions still required

1. Approve (or defer) the already-authored SA-11 migration before applying it, and approve or defer the SA-12/SA-17/SA-20 proposals in `SECURITY-REMEDIATION-PLAN.md` §5.
2. Decide admin MFA rollout and break-glass recovery (SA-17).
3. Supply real `PAYMENT_INSTAPAY`/`PAYMENT_EWALLET` values in production if/when deployment is approved (SA-18).
4. Approve major dependency upgrades or record explicit risk acceptance for the 7 advisories.
5. Remove the temporary ngrok host after the trial (SA-26).
6. Schedule a backup restore drill and add proxy/TLS/CI hardening before production.
