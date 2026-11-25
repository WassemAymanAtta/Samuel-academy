# Samuel Academy — Security Verification (Phase 1 baseline)

**Date:** 2026-11-25  
**Status:** Phase 1 baseline plus executed Phase 2 verification. Remediation tests were run; results are in Section 7.  
**Rule followed:** Phase 1 was read-only. No destructive security testing was performed against live or production data.

## 1. Commands executed in Phase 1

| Command / check | Result | Notes |
|---|---|---|
| Repository structure and file listing | Completed | Two npm workspaces, six migrations, eight API test files, no CI/deployment directory found. |
| Read `README.md`, `QA_REVIEW_REPORT.md`, `CLIENT_TRIAL_GUIDE.md`, env templates | Completed | Documentation reviewed; no secret values from real `.env` files were read or printed. |
| `git status --short --branch` | Clean `main...origin/main` at `4a2b2cc` before reports were created | Reports are new untracked files. |
| `git log --oneline -n 12` | Three commits: `bf95dfe`, `55d01a6`, `4a2b2cc` | No production admin changes pending at start of Phase 1. |
| Tracked-file env scan | Only `.env.example` and `apps/api/.env.example` tracked | `.env`, `.env.production`, `apps/api/.env` are ignored. |
| Redacted Git history secret pattern scan | No actual secret value found tracked | Pattern output was redacted before display; only template placeholders matched. |
| `npm audit --json` | Exit 1; 7 vulnerabilities: 5 high, 2 moderate | Full dependency tree. |
| `npm audit --omit=dev --json` | Exit 1; same 7 advisories | Direct majors suggested: Prisma 7.10.1, Zod 4.6.7, React Router 7.18.7. |
| `npm ls ...` | Prisma 6.19.3, Zod 3.25.76, React Router DOM 6.30.6, Express 4.22.3, JWT 9.0.3, bcryptjs 2.4.3 | Versions recorded for risk review. |
| Static source review | Completed | Findings recorded in `SECURITY-AUDIT.md`. |
| OWASP references | OWASP Top 10:2025 and API Security Top 10:2023 | Current OWASP released versions used. |

Logs from dependency checks are stored outside the repository at:

- `D:\Temp\opencode\security-npm-audit.json`
- `D:\Temp\opencode\security-npm-audit.err`
- `D:\Temp\opencode\security-npm-audit-prod.json`
- `D:\Temp\opencode\security-npm-audit-prod.err`

## 2. Baseline results from prior QA (not re-run in Phase 1)

| Check | Prior result |
|---|---|
| `npm test` | 27/27 passed, 8 suites |
| `npm run build` | Exit 0, API + web |
| `npm run db:migrate` | 6 migrations applied, no pending migrations |
| `GET /api/health` | 200 |
| `GET /` | 200 |

These results are inherited from `QA_REVIEW_REPORT.md` and the earlier production-admin verification. They do **not** validate the new Phase 1 findings.

## 3. Tests not executed in Phase 1 and why

- No destructive/policy security tests were run against the running demo or tunnel deployment.
- No `db:reset`, `db:seed`, `migrate reset`, `DROP`, `TRUNCATE`, or data-modifying probe was run.
- No live brute-force, oversized-upload, or exam-retry exploit was run against a shared/live server.
- No migration was applied.

This was intentional: the owner instructed Phase 1 to inspect and report first, and to wait for approval before database-affecting or potentially destructive changes.

## 4. Planned verification after remediation

### 4.1 Mandatory commands

```bash
npm run build
npm test
npm audit --omit=dev
npm run db:migrate   # only approved migrations; test/backup copy first
```

### 4.2 Required new regression tests

| Area | Test | Finding |
|---|---|---|
| Rate limiting | Successful logins never count; failed logins limited by hashed email+IP composite; attacker cannot lock a victim from another IP; keys contain no raw email; malformed/missing email fails safely; numeric `Retry-After`; recovery after cooldown | SA-01 |
| Session | Valid token without device proof → 401; stolen token not portable | SA-02, SA-07 |
| Logout | Stale logout cannot revoke newer session | SA-08 |
| Exams | No answer key, per-question `correct`, points, explanation, or correct option text in any student response; repeated/concurrent attempts reveal no correctness; first-attempt grading stays correct; another student's result is forbidden | SA-03 |
| Exams | Attempt limit, deadline, and idempotency enforced server-side | SA-11 |
| Catalog | No `pdfUrl`/`pdfFileId`/`videoUrl` in anonymous public responses | SA-04 |
| Files | Unpublished lesson file → 403/404; entitled published file → 200 | SA-05 |
| Entitlement | Lesson-only/unit-only grant cannot open course-level PDF | SA-09 |
| Media URL | No login JWT in URL; file-scoped token expires and cannot access another file | SA-06 |
| Payments | Global duplicate reference rejected; only one grant after duplicate approval attempt | SA-12 |
| Uploads | Unauthenticated large body rejected before buffering; fake PDF/MP4/MP3 rejected | SA-13, SA-23 |
| RBAC/IDOR | Student cannot access admin endpoints, other grades, other payments, or other progress | Existing + new tests |
| Account status | Pending/rejected blocked; reject→reactivate does not resurrect old token | SA-16 |
| Config | Production rejects demo mode, demo DB, missing admin/payment details, short JWT secret | SA-18, SA-21 |
| Logs | Security events present; passwords/tokens/payment proof contents absent | SA-20 |

### 4.3 Manual/browser checks

- Login and logout for student and admin.
- Exam submission shows score only on the first attempt; repeated attempts show a receipt, not correctness.
- PDF and media playback works with short-lived file capability token.
- Payment request + admin approval still creates exactly one grant.
- CSP does not break the Vite-built app.
- Response headers include the agreed security headers; no login JWT appears in URLs or console logs.
- Dark mode and RTL layout remain intact.

## 5. Remaining risks after Phase 1

| Risk | Evidence | Current handling |
|---|---|---|
| Credential stuffing / victim lockout | Deferred failed-login counting with hashed email+IP composite and in-memory buckets | SA-01 code fix verified; shared store and restart-safe state still require owner decision |
| Token theft replay | Bearer token not tied to request device proof; token in media URLs | SA-02/SA-06; owner approval pending |
| Grade manipulation | No per-question oracle; repeated attempts return no score/feedback; SA-11 durable policy implemented in code and migration file | SA-03 oracle closed; SA-11 migration still unapplied and unapproved, so the new API must not be deployed yet |
| Content/payment bypass | Catalog URL leakage, unpublished file access, course-scope inflation, duplicate references | SA-04/SA-05/SA-09/SA-12; owner approval pending |
| Admin blast radius | No MFA, no audit log | SA-17/SA-20; owner approval pending |
| Supply chain | 7 dependency advisories needing reviewed major upgrades | SA-19; no upgrades applied |
| Deployment hardening | No CI/deployment baseline; temporary ngrok host still allowed | SA-26/SA-28; owner action pending |
| Backup recovery | Backup exists, restore has not been tested | See `SECURITY-OPERATIONS.md`; owner action required |

## 6. Production readiness statement

- **Local demo / supervised trial:** acceptable with demo data only, known demo credentials, demo payment instructions, and the temporary tunnel removed after the trial.
- **Staging with real-looking data:** not recommended until all P0 findings are fixed and verified.
- **Production with real students/payments:** not ready. Required before production: P0 and P1 fixes, reviewed dependency upgrades, MFA decision, backup restore test, TLS/proxy hardening, CI security gate, and documented incident response.

No claim is made that the application is “fully secure” or “unhackable”. This is an evidence-based assessment of the current codebase only.

---

## 7. Phase 2 verification results (2026-11-25)

### 7.1 Gate results

| Command / check | Final result | Evidence |
|---|---|---|
| `npm test` after SA-01/SA-03 hotfix | **46/46 passed**, 8 suites, 0 failures, 0 skipped, 33.90 s | `D:\Temp\opencode\p0-hotfix-test.log` |
| Targeted SA-01/SA-03 filtered run | **26/26 passed**, 1 suite, 0 failures, 8.39 s | `D:\Temp\opencode\p0-hotfix-targeted.log` |
| Previous full run before hotfix | 38/38 passed | `D:\Temp\opencode\p0-final-root-test.log` |
| Targeted API run after P0 wiring | 33/33 passed | `D:\Temp\opencode\p0-final-test-2.log` |
| Targeted API run after payment/catalog/enumeration regressions | 37/37 passed | `D:\Temp\opencode\p0-final-test-3.log` |
| Targeted API run after final stale-session regression | 38/38 passed | `D:\Temp\opencode\p0-final-test-4.log` |
| `npm run build` after SA-01/SA-03 hotfix | **Exit 0**; API `tsc` clean; web `tsc -b && vite build` clean, 1653 modules | `D:\Temp\opencode\p0-hotfix-build.log` |
| Previous build before hotfix | Exit 0 | `D:\Temp\opencode\p0-final-build-3.log` |
| `npm audit --omit=dev --json` | Exit 1; **7 advisories remain** (5 high, 2 moderate) | `D:\Temp\opencode\p0-final-audit-prod.json` |
| `GET /api/health` | 200 | Local smoke check on port 4000 |
| `GET /` | 200 | Local smoke check on port 5173 |
| Migration check | **No migration applied**; `git status` shows no schema or migration file change | Final diff review |
| Secret check | No real `.env`/`.env.production` value was read, printed, or added to tracked files | Final diff review |

### 7.2 Regression tests added or rewritten

- `admin-config.test.ts`: production requires real payment details and a strong JWT secret.
- `security.test.ts`:
  - anonymous catalog contains no external PDF/video URLs;
  - unpublished lesson file is denied to a student but allowed to admin;
  - exam attempt and stored feedback contain no answer key;
  - successful logins do not count toward the failed-login limit;
  - failed logins are limited by a composite hashed email/IP key and return numeric `Retry-After`;
  - an attacker cannot lock a victim by email from another IP;
  - rate-limit keys contain no raw email;
  - invalid or missing email values fail safely and still count as failures;
  - the failed-login limit recovers after the configured window;
  - server grading and first-attempt score remain correct without per-question correctness;
  - repeated submissions return no score, feedback, or correctness;
  - concurrent duplicate submissions disclose at most one overall score and no correctness;
  - another student's attempt detail is forbidden;
  - file token is scoped to one file and rejected by non-file APIs;
  - login JWT in a URL is rejected everywhere;
  - payment reference already used by another user is rejected;
  - lesson-only grant does not unlock the course PDF or catalog `unlocked` flag;
  - duplicate registration returns a uniform response with no real account data;
  - reject → reactivate does not resurrect the old token.
- `features.test.ts`:
  - device binding uses the signed cookie, not a spoofable header;
  - logout revokes the presented session;
  - stale logout cannot revoke a newer session.
- `api.test.ts`: media URLs no longer rely on a login query token; device proof is required.
- `helpers.ts`: new `authHeaders()` helper simulates the signed device cookie from the token's `did` claim.

### 7.3 Findings fixed and verified

| Finding | Verified fix |
|---|---|
| SA-01 | Failed-login-only deferred counting; composite salted email hash + client IP hash; no raw email/IP in keys or logs; 100/IP and 10/failed-composite limits; 429 + numeric `Retry-After` + `RateLimit-*` headers; malformed values fail safely; structured `rate_limit` event. Single-process caveat remains. |
| SA-02 / SA-07 | Signed httpOnly `sa_device` cookie is the only device proof; Bearer and cookie sessions require it; raw `X-Device-Id` ignored. |
| SA-03 | No per-question `correct`, points, explanations, answer keys, or correct option text in submission/list/detail/dashboard responses; stored feedback is `questionId` only; repeated and concurrent attempts reveal no correctness; first-attempt grading remains correct. Durable attempt policy remains open. |
| SA-04 | Explicit catalog selects; no `pdfUrl`, `videoUrl`, or `pdfFileId` in public metadata responses. |
| SA-05 | File authorization filters linked lessons by `isPublished` for non-admins. |
| SA-06 | No login JWT in file/media URLs; 10-minute, file-scoped, device-bound `ftoken` issued by `/api/files/:id/token`. |
| SA-08 | Conditional logout update matches verified session version/device; stale logout fails. |
| SA-09 | Course-level file and catalog unlock require subscription scope, not lesson/unit ownership. |
| SA-10 | API and UI password policy updated to ≥12 characters with weak-pattern rejection. |
| SA-13 | `requireAuth`/`requireAdmin` run before raw upload body parsers. |
| SA-16 | Student status transitions increment `sessionVersion` and clear device binding. |
| SA-18 | Production requires `PAYMENT_INSTAPAY`/`PAYMENT_EWALLET` and rejects demo placeholders. |

### 7.4 Findings only partially fixed or still open

| Finding | Status | Residual risk |
|---|---|---|
| SA-03 attempts | Closed in code | Correctness oracle is closed; server-side first-attempt-only score policy remains. |
| SA-11 | Implemented / unapplied | Code and additive migration exist, including `maxAttempts`, `startedAt`, and durable idempotency. Migration is still unapplied and production approval not granted; deploying the new API without it is unsupported. |
| SA-12 | Partial | Cross-user pre-check has a race window until a global unique index exists. |
| SA-14 | Partial | Security headers/request IDs/HSTS added; no CSP. |
| SA-17 | Open | No admin MFA or step-up auth; owner decision pending. |
| SA-19 | Open by version | No dependency upgrades. Interim Zod/error caps applied; major upgrades deferred. |
| SA-20 | Partial | Structured stdout JSON events only; no durable `AuditLog` or alerting. |
| SA-21 | Partial | Production secret floor raised to 32 characters; 7-day token TTL unchanged. |
| SA-22 | Partial | Registration enumeration reduced; login status still distinguished after correct password. |
| SA-23, SA-24, SA-25, SA-26, SA-27, SA-28 | Open | Upload validation/quota, progress metadata, seed output, temporary ngrok host, password recovery, CI/deployment baseline. |

### 7.5 All 7 npm advisories reviewed individually

| Advisory / package | Severity | Reachability in this app | Decision |
|---|---|---|---|
| `@prisma/config` | High | Transitive via `prisma` CLI/build path; not the runtime client path | Defer major Prisma 7.10.1 upgrade pending owner approval. |
| `deepmerge-ts` GHSA-ggr8-5vv4-36mx | High | Build-time transitive path via Prisma config | Defer with Prisma upgrade; no direct call site. |
| `effect` GHSA-7589-6fvf-x4pw | High | Build-time transitive path via Prisma config | Defer with Prisma upgrade; no direct call site. |
| `prisma` | High | Direct dev/build dependency, version 6.19.3 | No 6.x fix; require owner-approved major upgrade branch. |
| `react-router` GHSA-wrjc-x8rr-h8h6 / GHSA-337j-9hxr-rhxg | Moderate | SSR hydration path unreachable; open redirect latent (client-side controlled routes) | Defer major 7.18.7 upgrade pending owner approval. |
| `react-router-dom` | Moderate | Transitive wrapper of `react-router` | Defer with the React Router major upgrade. |
| `zod` GHSA-mrhx-c7xc-m3w5 | High | Runtime-reachable validation of arrays/records | Interim `.max()` caps added in exam/admin schemas and error output capped; major 4.6.7 upgrade deferred. |

### 7.6 Files changed

API source: `app.ts`, `lib/auth.ts`, `lib/config.ts`, `lib/errors.ts`, new `lib/fileToken.ts`, new `lib/logging.ts`, new `lib/rateLimit.ts`, `routes/admin.ts`, `routes/auth.ts`, `routes/catalog.ts`, `routes/exams.ts`, `routes/files.ts`, `routes/payments.ts`, `routes/student.ts`, new `services/examDisclosure.ts`, `services/grading.ts`.

Tests: `tests/admin-config.test.ts`, `tests/api.test.ts`, `tests/features.test.ts`, `tests/security.test.ts`, new `tests/helpers.ts`.

Web/config: `apps/web/src/lib/api.ts`, `apps/web/src/pages/Register.tsx`, `apps/web/src/pages/student/ExamPage.tsx`, `apps/web/src/pages/student/Results.tsx`, `apps/api/.env.example`.

### 7.7 Remaining risks and updated production readiness

- In-process rate limiting is per API process and clears on restart; a multi-instance deployment needs a shared store. Production keeps `trust proxy` disabled and does not trust `X-Forwarded-For`; deployments behind a proxy must set trusted proxy hops explicitly or the limiter will see only the proxy IP.
- A stolen Bearer token can no longer be used from another device, but XSS in the same browser remains a risk; sessionStorage tokens are still bearer credentials.
- Admin-authored `explanation` feedback may still reveal an answer if authors write it that way; content policy needed before revealing explanations broadly.
- File capability tokens expire after 10 minutes and cannot be revoked early; they still require the signed device cookie.
- No CSP; HSTS only in production; no proxy/concurrency limits configured in the repository.
- No MFA, durable audit log, alerting, or backup restore drill.
- Dependency advisories remain open by version; compensating controls are partial.
- Temporary ngrok host remains in Vite config and must be removed after the trial.

**Updated assessment:** the six High findings now have code fixes and regression evidence; the SA-01 victim-lockout defect and the SA-03 answer oracle are specifically closed in code. The controlled local demo remains working. **Production with real students/payments is still not ready** because SA-11 migration application (code/migration exist but remain unapplied), other P1 schema work, shared/restart-safe rate limiting, MFA, dependency upgrades, durable logging, verified backup restore, and deployment hardening are outstanding. This is not a claim that the application is “fully secure”.
