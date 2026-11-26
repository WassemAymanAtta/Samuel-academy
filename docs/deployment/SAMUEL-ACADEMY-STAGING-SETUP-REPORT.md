# Samuel Academy — Staging Setup Report

**Date:** 2026-11-25/26 (UTC)
**Environment:** Staging only — isolated from Production
**Target architecture:** Vercel (web) + Render (API, Frankfurt) + Neon PostgreSQL (Frankfurt)
**Final verdict:** **PARTIALLY COMPLETE**

---

## Contents

1. [Executive summary and verdict](#1-executive-summary-and-verdict)
2. [Scope, isolation and non-destructive guarantees](#2-scope-isolation-and-non-destructive-guarantees)
3. [Target architecture and regions](#3-target-architecture-and-regions)
4. [Provider accounts and authentication](#4-provider-accounts-and-authentication)
5. [Neon database provisioning and identity](#5-neon-database-provisioning-and-identity)
6. [Backup and restore drill](#6-backup-and-restore-drill)
7. [SA-11 migration verification](#7-sa-11-migration-verification)
8. [Synthetic staging data](#8-synthetic-staging-data)
9. [Environment variables and secrets](#9-environment-variables-and-secrets)
10. [CORS and production-mode security configuration](#10-cors-and-production-mode-security-configuration)
11. [API deployment (Render)](#11-api-deployment-render)
12. [Web deployment (Vercel)](#12-web-deployment-vercel)
13. [Test, build and dependency verification](#13-test-build-and-dependency-verification)
14. [Smoke test results](#14-smoke-test-results)
15. [Blockers, risks and open decisions](#15-blockers-risks-and-open-decisions)
16. [Next steps and sign-off](#16-next-steps-and-sign-off)
17. [Completion update — 2026-11-26](#17-completion-update--2026-11-26)

---

## 1. Executive summary and verdict

The entire database side of Staging is provisioned, verified and ready: a dedicated Neon project in Frankfurt, a verified Staging database identity, a pre-change backup branch, a successful restore drill completed **before** the SA-11 migration, the unchanged SA-11 migration applied through the correct Prisma workflow, and synthetic-only fixtures. All 58 API tests pass, the full build succeeds, and 14/14 production-mode smoke checks pass against the Staging database.

The application was **not deployed**: neither Vercel nor Render had an authenticated session, no provider tokens or CLIs were available, and the owner explicitly chose to continue without deployment. Therefore live HTTPS URLs, provider-side secrets, proxy/HSTS hardening and end-to-end browser smoke tests remain unverified.

**Final verdict: PARTIALLY COMPLETE.** Staging data infrastructure is ready; Staging deployment is blocked on provider authentication.

## 2. Scope, isolation and non-destructive guarantees

| Requirement | Result |
|---|---|
| No connection to, inspection of, or modification of Production | ✅ No Production database, deployment or secret was accessed |
| `.env.production` untouched | ✅ Last write `2026-11-25T01:08:43Z`, SHA-256 `48219C74A73A75B37DA09BFF5236BB1DCC936709D6DC4697AE2B9B5D84FFF48A` (value never read or printed) |
| No production credentials reused | ✅ Staging has its own generated JWT secret and admin password |
| No destructive command, reset, delete or branch removal | ✅ None executed; backup and drill branches still exist |
| SA-11 migration unchanged | ✅ SHA-256 `70366A1EA8B6EEAF898599F172B74E3A0DB96B4BEF52D1551F732092CDA0092F` (same before and after all work) |
| No real student or payment data | ✅ Only labelled synthetic fixtures |
| No secrets committed | ✅ `.env.staging` is gitignored; no secret value appears in this report |
| No paid upgrade requested or performed | ✅ Existing free Neon organisation used |

Production remains **NOT READY FOR PRODUCTION** and is out of scope for this report.

## 3. Target architecture and regions

| Layer | Provider | Intended Staging resource | Region | Status |
|---|---|---|---|---|
| Database | Neon | Project `samuel-academy-staging` (`quiet-king-99299808`) | `aws-eu-central-1` (Frankfurt) | ✅ Provisioned |
| API | Render | Service `samuel-academy-staging-api` | Frankfurt | ⛔ Not created — auth blocked |
| Web | Vercel | Project `samuel-academy-staging` | Global edge | ⛔ Not created — auth blocked |
| Transport | Provider-managed TLS | HTTPS only, HSTS on API | — | ⛔ Unverified until deployed |

No provider was substituted for convenience; the requested architecture was retained.

## 4. Provider accounts and authentication

- **Neon:** authenticated through the Neon CLI browser OAuth flow under the `DEFAULT` profile. Account organisation: `WM_Solutions` (`org-dry-cloud-62996362`, free plan).
- **Render:** `https://dashboard.render.com/login-next` — not authenticated. No `RENDER_API_KEY`, `RENDER_API_TOKEN` or `render` CLI found.
- **Vercel:** `https://vercel.com/login` — not authenticated. No `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` or `vercel` CLI found.
- The owner was asked whether to sign in and chose **“Continue without deploy.”** Deployment and live-URL verification were therefore intentionally skipped.

## 5. Neon database provisioning and identity

A dedicated Staging project was created rather than reusing any existing project:

| Property | Value |
|---|---|
| Organisation | `WM_Solutions` / `org-dry-cloud-62996362` |
| Project | `samuel-academy-staging` / `quiet-king-99299808` |
| Region | `aws-eu-central-1` (Frankfurt) |
| PostgreSQL version | 18 |
| Primary branch | `main` / `br-raspy-rain-bhxziymc` (state `ready`) |
| Endpoint host | `ep-orange-morning-bh63idpn.c-10.eu-central-1.aws.neon.tech` |
| Database | `samuel_academy_staging` |
| Role | `samuel_academy_staging_owner` |
| Connection strings | Direct and pooled, `sslmode=verify-full`, stored only in the gitignored `.env.staging` |

Identity was verified **before any schema operation** with a read-only query through Prisma:

```text
current_database = samuel_academy_staging
current_user     = samuel_academy_staging_owner
server_version   = PostgreSQL 18.7
_prisma_migrations table = absent (fresh database)
```

A second identity check was performed on the restore-drill endpoint before using it. The connection string enforces `verify-full`; the proxy terminates TLS upstream, so `pg_stat_ssl` at the SQL layer is not used as evidence of transport encryption.

## 6. Backup and restore drill

Neon branching was used as the backup and restore mechanism. Both branches were kept; nothing was deleted or reset.

| Asset | Value |
|---|---|
| Backup branch | `staging-pre-sa11-20261126` / `br-odd-leaf-bhr17zph` |
| Created from | `main` at LSN `0/19F5128`, `2026-11-25T23:05:30Z`, state `ready` |
| Restore-drill branch | `restore-drill-pre-sa11-20261126` / `br-flat-king-bhtvfh1r` |
| Created from | backup branch at LSN `0/19FA6B0`, `2026-11-25T23:05:47Z`, state `ready` |
| Drill endpoint | `ep-mute-leaf-bh6qfg06.c-10.eu-central-1.aws.neon.tech` |
| Drill verification | Restored branch reports `samuel_academy_staging` / `samuel_academy_staging_owner`; `_prisma_migrations` absent, matching the pre-migration backup state |
| Ordering | Backup → restore drill → SA-11 applied to `main` (`23:08:39Z`) |

**Result:** the restore drill succeeded before the migration was applied. Note that this was a freshly created database, so the drill validates the backup/restore mechanism and identity, not restoration of a large production dataset.

## 7. SA-11 migration verification

Applied with the correct forward-only workflow on the verified Staging database only:

```powershell
$env:DATABASE_URL = (Get-Content -Raw 'D:\Temp\opencode\samuel-staging-direct.txt').Trim()
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
```

All seven migrations applied, including `20261125130000_sa11_exam_attempt_policy`. Post-migration read-only verification:

- `_prisma_migrations` row: `finished_at = 2026-11-25 23:08:39.537644+00`, `rolled_back_at = null`, `applied_steps_count = 1`, no errors.
- `Exam.maxAttempts` (integer, nullable), `ExamAttempt.startedAt` (timestamp), `ExamAttempt.sessionId` (text) present.
- `ExamAttemptSession` table present.
- Constraints present: `Exam_maxAttempts_positive`, `ExamAttemptSession_pkey`, `ExamAttemptSession_userId_fkey`, `ExamAttemptSession_examId_fkey`, `ExamAttempt_sessionId_fkey`.
- Expected unique and lookup indexes present (idempotency key, started-at, expiry, session id, submitted-at).
- Migration file hash unchanged at `70366A1E…92F`.

The SA-11 API code was built and smoke-tested only against this migrated Staging database. No production migration or deployment was performed.

## 8. Synthetic staging data

The destructive demo seed script was **not** used (it wipes data and only allows `samuel_academy` / `samuel_academy_test`). An additive, idempotent fixture script was run instead against the verified Staging endpoints only.

Created fixtures (all labelled `STAGING` / `SYNTHETIC`, emails on the `.test` domain):

| Entity | Count / detail |
|---|---|
| Users | 4 — admin, active student, pending student, rejected student |
| Subject / Course / Unit / Lesson | 1 each |
| Exam | 1, `maxAttempts = 2`, `timeLimitMinutes = 10`, published |
| Question / answer options | 1 MCQ with one correct synthetic option |
| Product | 1 `EXAM_PACKAGE`, 19,900 synthetic EGP cents |
| Payment request | 1 `PENDING`, reference `STG-REF-0001`, no real money |
| Attempt session / attempt | 1 each, idempotency key `STG-IDEM-0001` |

Final row counts from the Staging database: `users=4, subjects=1, courses=1, units=1, lessons=1, exams=1, questions=1, products=1, payments=1, sessions=1, attempts=1`.

## 9. Environment variables and secrets

A gitignored Staging env file was generated at `D:\samuel-academy\.env.staging` (never printed in full):

| Variable | Staging value / treatment |
|---|---|
| `DATABASE_URL`, `DATABASE_URL_POOLED` | Dedicated Neon Staging endpoint, `sslmode=verify-full` |
| `NODE_ENV` | `production` — Staging security guards active |
| `DEMO_MODE` | `false` |
| `JWT_SECRET` | Fresh cryptographically random 96-character value; distinct from Production |
| `ADMIN_EMAIL` | `staging-admin@samuelacademy.test` |
| `ADMIN_PASSWORD` | Fresh random 28-character value; distinct from Production |
| `PAYMENT_INSTAPAY`, `PAYMENT_EWALLET` | Clearly labelled synthetic Staging values, no real transfer details |
| `WEB_ORIGIN` | `https://samuel-academy-staging.vercel.app` — exact, non-wildcard; **intended** host, unverified until Vercel provisioning |
| `VITE_API_URL` | `https://samuel-academy-staging-api.onrender.com` — intended Render host, unverified |

Secrets must be entered into Render/Vercel dashboards from this file after provisioning; they must never be committed. If Vercel assigns a different hostname, `WEB_ORIGIN` and `VITE_API_URL` must be updated before deployment.

## 10. CORS and production-mode security configuration

Verified with the API running in `NODE_ENV=production` against the Staging database, from a temp working directory so no Production `.env.production` was reachable by the process:

- CORS allowlist is exact (`WEB_ORIGIN`, no `*`), `credentials: true`.
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`.
- `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Permissions-Policy`.
- Session and device cookies are `Secure` + `HttpOnly` in production mode.
- Demo credentials are rejected; public config reports `demoMode: false` and contains no secrets.
- The temporary ngrok host was removed from `apps/web/vite.config.ts`; only `localhost` plus an optional explicit `VITE_ALLOWED_HOSTS` list remain.

## 11. API deployment (Render)

**Status: BLOCKED — not deployed.** No Render session, API key or CLI was available, and the owner chose to continue without deployment.

Prepared deployment specification:

- Service: `samuel-academy-staging-api`, region **Frankfurt**, runtime Node.js.
- Build: `npm install && npm run build`.
- Release/migrate step: `npx prisma migrate deploy --schema apps/api/prisma/schema.prisma` (already applied to Staging DB; deploy is idempotent).
- Start: `npm run start -w apps/api`.
- Environment: all values from `.env.staging`, including `NODE_ENV=production`, `DEMO_MODE=false`, the Staging `DATABASE_URL`, generated JWT/admin secrets and synthetic payment details.
- Health check: `GET /api/health`.

## 12. Web deployment (Vercel)

**Status: BLOCKED — not deployed.** No Vercel session, token or CLI was available, and the owner chose to continue without deployment.

Prepared deployment specification:

- Project: `samuel-academy-staging`, framework Vite, root `apps/web`, output `apps/web/dist`.
- Build: `npm run build -w apps/web` (or the root `npm run build`).
- Environment: `VITE_API_URL=https://samuel-academy-staging-api.onrender.com` (update to the real Render URL).
- HTTPS-only; no wildcard CORS origin.

## 13. Test, build and dependency verification

| Check | Command | Result |
|---|---|---|
| Full API test suite | `npm test` | ✅ 58 passed, 0 failed, 9 suites |
| Full build | `npm run build` | ✅ API `tsc` clean; web `tsc -b && vite build`, 1653 modules |
| Migration status on Staging | `npx prisma migrate status` before deploy | ✅ 7 pending → all applied after `migrate deploy` |
| Migration file integrity | `Get-FileHash` | ✅ unchanged `70366A1E…92F` |
| Dependency audit | `npm audit --omit=dev` | ⚠️ 7 vulnerabilities (2 moderate, 5 high) |

The audit findings affect Prisma, React Router and Zod; all fixes require breaking major upgrades (`prisma@7`, `react-router-dom@7`, `zod@4`). No upgrades were applied — owner approval is required. This is a documented risk, not a deployment gate for isolated Staging.

## 14. Smoke test results

A self-contained smoke harness (`D:\Temp\opencode\staging-smoke.cjs`) started the built API with Staging env vars in `NODE_ENV=production` from `D:\Temp\opencode`, ran checks, then stopped the process. Evidence: `D:\Temp\opencode\staging-smoke-results.json` and `staging-api-smoke.log`.

| # | Check | Result |
|---|---|---|
| 1 | `GET /api/health` → 200 with expected payload | ✅ |
| 2 | HSTS header present | ✅ |
| 3 | `X-Request-ID` present | ✅ |
| 4 | `Referrer-Policy: no-referrer` | ✅ |
| 5 | CORS allows exact Staging origin | ✅ |
| 6 | CORS credentials enabled | ✅ |
| 7 | CORS rejects unknown origin | ✅ |
| 8 | Public config reports `demoMode: false` | ✅ |
| 9 | Public config contains no JWT/admin secrets | ✅ |
| 10 | Payment details clearly synthetic | ✅ |
| 11 | Staging admin login → 200, role `ADMIN`, token issued | ✅ |
| 12 | Session cookie `Secure` + `HttpOnly` | ✅ |
| 13 | Synthetic student login → 200, role `STUDENT` | ✅ |
| 14 | Demo credentials rejected → 401 | ✅ |

**Summary: 14/14 passed.** These were local-process checks against the Staging database; they are not a substitute for live Vercel/Render smoke tests.

## 15. Blockers, risks and open decisions

1. **Deployment blocked (primary):** Vercel and Render are unauthenticated; no tokens or CLIs. Owner chose to continue without deploy.
2. **Hostnames provisional:** `WEB_ORIGIN` and `VITE_API_URL` use intended Vercel/Render names and must be replaced with actual assigned URLs before deployment.
3. **Provider hardening unverified:** HTTPS termination, HSTS at the edge, proxy trust headers, body-size limits and access-log token stripping cannot be confirmed without deployed services.
4. **Dependency advisories:** 7 unresolved; breaking upgrades require owner approval or documented risk acceptance.
5. **Rate limiting scope:** the limiter is in-process; a multi-instance Render plan needs a shared store before relying on it.
6. **Restore drill scope:** verified on a fresh database, not a restored large dataset.
7. **Neon skills status discrepancy:** project-level skills were installed by the CLI and `neon skills update -y` reports them up to date, but `neon skills status` still labels them “outdated”. Cosmetic CLI inconsistency; files are present.
8. **Billing:** no paid upgrade was requested or made; any Render/Vercel paid tier needs owner approval.

## 16. Next steps and sign-off

1. Sign in to Vercel and Render (browser tabs were opened) or supply `VERCEL_TOKEN` / `RENDER_API_KEY`.
2. Create the Frankfurt Render service and the Vercel project using §11–§12 specifications.
3. Enter Staging secrets from `.env.staging` into provider dashboards; update `WEB_ORIGIN` and `VITE_API_URL` to the real assigned URLs, then redeploy.
4. Re-run `GET /api/health`, admin/student login, CORS and cookie checks against the live HTTPS URLs; confirm no demo login cards are shown.
5. Record the live URLs in §3, §9, §11 and §12 of this report.
6. Obtain an owner decision on the 7 dependency advisories and on shared rate-limit storage before any production discussion.

**Sign-off:** Staging database, backup/restore, SA-11 migration, synthetic data, configuration, tests and local production-mode smoke checks are complete. Live Staging deployment remains blocked on provider authentication.

> # FINAL VERDICT: PARTIALLY COMPLETE

---

## 17. Completion update — 2026-11-26

This section records the continuation performed after the original setup report. The original history above (§1–§16) is preserved unchanged; the earlier `PARTIALLY COMPLETE` sign-off in §16 was written before deployment and is superseded by the results below. Final verification timestamp: **2026-11-26T00:28Z** UTC (session date 2026-11-26 local).

Earlier in this continuation, a harness permission layer initially rejected the approved `git push`. Owner approval was later honored, the branch was pushed, and both Vercel deployments completed; all “not deployed / push rejected / Render-hosted” statements from that earlier snapshot are superseded by this section.

### 17.1 Final architecture and provider regions

| Layer | Provider / region | Staging resource | Status |
|---|---|---|---|
| Database | Neon `aws-eu-central-1` (Frankfurt), PostgreSQL 18.7 | Project `samuel-academy-staging` / `quiet-king-99299808`; DB `samuel_academy_staging`; primary branch `br-raspy-rain-bhxziymc` | ✅ Verified live |
| API | Vercel Node runtime (Express adapter), global edge network | Project `samuel-academy-staging-api` / `prj_381kRehce7F0V4iuVFZMzVAniwsh`; root `apps/api`; deployment `xMFy4dHyzuegVFxSd43zrJJRzoap` | ✅ Ready, Production, 23s |
| Web | Vercel, `WM_Solutions` team | Project `samuel-academy-staging` / `prj_14S660gqBENdEXaWCWodFansofdF`; root `apps/web`; latest deployment `GYnCvKrt7nR8cnB6UcNVRFHN6ww8` | ✅ Ready, Production, 13s |
| Source | GitHub `WassemAymanAtta/Samuel-academy` | `staging/sa11-20261126` at `2cde39a03beb01f46ec0d864a0ff8729180b7310` | ✅ Pushed; `git ls-remote` matches local HEAD |

Render was inspected but no service was created because billing showed no card on file and the free plan was unavailable without card verification. Railway's workspace trial had expired and required a paid Hobby upgrade. Netlify would have required a serverless-function refactor. The owner approved Vercel for the API, so no paid tier or card verification was performed.

### 17.2 Actual frontend and API URLs

| URL | Value |
|---|---|
| Canonical web origin | **https://samuel-academy-staging.vercel.app** |
| Canonical API origin | **https://samuel-academy-staging-api.vercel.app** |
| Additional web domains | `samuel-academy-staging-git-staging-sa11-20261126-wm-solutions.vercel.app`, `samuel-academy-staging-4i6aoh0ni-wm-solutions.vercel.app` |
| Additional API domains | `samuel-academy-staging-api-git-staging-sa11-d4437e-wm-solutions.vercel.app`, `samuel-academy-staging-mwxzobpbe-wm-solutions.vercel.app` |
| `.env.staging` | Local gitignored reference only; values were entered directly in provider dashboards; the file was never uploaded or committed |

No hostname was invented or substituted for a real deployment URL. The built web bundle embeds the canonical API origin above.

### 17.3 Resource names and non-sensitive identifiers

| Resource | Identifier | Action in this continuation |
|---|---|---|
| Neon project | `quiet-king-99299808` (`samuel-academy-staging`) | Reused; no recreation |
| Primary branch | `br-raspy-rain-bhxziymc` (`main`) | Reused; no reset/delete |
| Pre-SA-11 backup | `br-odd-leaf-bhr17zph` (`staging-pre-sa11-20261126`) | Preserved; no delete |
| Pre-SA-11 drill | `br-flat-king-bhtvfh1r` (`restore-drill-pre-sa11-20261126`) | Preserved; no delete |
| Post-SA-11 backup | `br-bitter-rain-bhonkz6b` (`staging-post-sa11-20261126`), endpoint `ep-misty-brook-bh7l6z9x…` | Created from `main` at LSN `0/1C44A18` |
| Post-SA-11 restore | `br-late-waterfall-bhmthz0d` (`restore-drill-post-sa11-20261126`), endpoint `ep-winter-haze-bhlsyh4p…` | Created from the new backup at LSN `0/1C49D48` |
| Git branch / commit | `staging/sa11-20261126` / `2cde39a` | Pushed; remote and local HEAD match |
| Vercel web deploy hooks | `staging-sa11-deploy` | Created, used twice; hook URL treated as a secret and not recorded |
| Vercel API deploy hook | `staging-sa11-api-deploy` | Created, used once; hook URL treated as a secret and not recorded |
| Vercel web deployments | `BRyeV8RnNggobp3NEZxeScwe2e7S`, `J8SPPfKmu7tNUvM7czmQtjA2dmWP`, `GYnCvKrt7nR8cnB6UcNVRFHN6ww8` | All Ready; latest is `GYnCvKrt7…` |
| Vercel API deployment | `xMFy4dHyzuegVFxSd43zrJJRzoap` | Ready, Production |

### 17.4 Deployment status and timestamps

| Operation | Timestamp (UTC) | Result |
|---|---|---|
| Remote branch finally pushed and SHA verified | 2026-11-26 before 00:13Z | ✅ `2cde39a03beb01f46ec0d864a0ff8729180b7310` on `staging/sa11-20261126` |
| Vercel web project created with Production Branch `staging/sa11-20261126` | 2026-11-26 before 00:13Z | ✅ `samuel-academy-staging`; first deployment `BRyeV8Rn…` Ready |
| SPA rewrite added for direct client routes | 2026-11-26 before 00:13Z | ✅ Commit `de2f8f7`; redeployment `J8SPPfKmu…` Ready |
| API project created with root `apps/api`, Express preset, `npm run db:generate` | 2026-11-26 ≈00:13Z | ✅ `samuel-academy-staging-api` |
| API environment variables imported and API deploy hook used | 2026-11-26 ≈00:14Z | ✅ Job `mDkZTzcLuZOw3fNFjXX0`; deployment `xMFy4dHy…` Ready in 23s |
| Web `VITE_API_URL` corrected to canonical API origin and web redeployed | 2026-11-26T00:19:36Z | ✅ Job `IxoXB89vOCGO6OLlIuKJ`; config set for Production and Preview |
| Final web deployment Ready with updated API URL | 2026-11-26 ≈00:20Z | ✅ `GYnCvKrt7…`, Production, 13s; bundle contains canonical API origin |
| Targeted Staging session-binding cleanup | 2026-11-26 ≈00:24Z | ✅ Cleared stale `sessionDeviceId` on the two synthetic Staging accounts only; no other rows touched |
| Live HTTPS smoke suite | 2026-11-26 ≈00:25Z | ✅ `live-staging-smoke.cjs`: 19/19 checks passed |
| Final read-only database re-verification | 2026-11-26 ≈00:28Z | ✅ `post-sa11-drill-verify.cjs`: 10/10 checks; no migration rerun |

### 17.5 Environment-variable configuration status

Names present in the gitignored local `.env.staging` reference (values intentionally omitted): `DATABASE_URL`, `DATABASE_URL_POOLED`, `PORT`, `NODE_ENV`, `DEMO_MODE`, `WEB_ORIGIN`, `VITE_API_URL`, `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `PAYMENT_INSTAPAY`, `PAYMENT_EWALLET`. The API project additionally received `UPLOAD_DIR=/tmp/samuel-academy-uploads` for the ephemeral Vercel filesystem.

| Setting | Local Staging value status | Provider-side status |
|---|---|---|
| `NODE_ENV` | `production` | ✅ Set on API project; production mode confirmed by live HSTS/behavior |
| `DEMO_MODE` | `false` | ✅ Set on API project; live `/api/auth/config` returns `demoMode:false` and demo login returns 401 |
| `WEB_ORIGIN` | Canonical web origin, no wildcard | ✅ Set on API project; live CORS allows only the exact staging web origin |
| `VITE_API_URL` | Canonical API origin | ✅ Web Config variable for Production and Preview; rebuilt into the served bundle; old Secret value removed |
| `DATABASE_URL` / `DATABASE_URL_POOLED` | Staging-only Neon strings with `verify-full` | ✅ Set provider-side on API project; never printed or committed |
| `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `PAYMENT_*` | Fresh Staging-only values | ✅ Set provider-side on API project; never printed or committed |
| `UPLOAD_DIR` | `/tmp/samuel-academy-uploads` | ✅ Set provider-side on API project |
| Secrets in repository / report | None | ✅ Verified in commit `8633f2a`; later commits added only config/adapter files; deploy hook URLs withheld |

### 17.6 Database identity verification evidence

Read-only verification was repeated against the Staging endpoint before the new backup work, and again after both deployments were Ready:

| Check | Observed value |
|---|---|
| Host | `ep-orange-morning-bh63idpn.c-10.eu-central-1.aws.neon.tech` |
| `current_database()` | `samuel_academy_staging` |
| `current_user` | `samuel_academy_staging_owner` |
| Server version | PostgreSQL 18.7 |
| `_prisma_migrations` | Present; 7 rows after migration deployment |
| SA-11 row | `20261125130000_sa11_exam_attempt_policy`, `finished_at = 2026-11-25 23:08:39.537644+00`, `rolled_back_at = null`, `applied_steps_count = 1` |
| `npx prisma migrate status` | “Database schema is up to date!”, 7 migrations found |

The verification script (`post-sa11-drill-verify.cjs`) returned **10/10** checks passed on the primary Staging database, covering identity, migration state, SA-11 columns, `ExamAttemptSession` table, five expected constraints, indexes, fixture counts, session/attempt linkage and the admin fixture. The final post-deployment re-run was also **10/10**; no migration was reapplied.

### 17.7 Pre-migration backup and restore evidence

Preserved from the original run: branch `br-odd-leaf-bhr17zph` from `main` at LSN `0/19F5128` and drill branch `br-flat-king-bhtvfh1r` from the backup at LSN `0/19FA6B0`, both created before SA-11 was applied at `23:08:39Z`. Both branches still exist and were not deleted.

### 17.8 Post-migration backup and restore evidence

| Check | Result |
|---|---|
| New backup branch `staging-post-sa11-20261126` | ✅ Created from `main` at LSN `0/1C44A18`, state `ready` |
| New restore target `restore-drill-post-sa11-20261126` | ✅ Created from the backup at LSN `0/1C49D48`, state `ready` |
| Current Staging database untouched | ✅ No reset, overwrite or destructive operation |
| Backup branch verification | ✅ 10/10 checks, including SA-11 applied and all fixtures |
| Restored target verification | ✅ 10/10 checks: identity `samuel_academy_staging` / owner role; 7 migrations; SA-11 row applied and not rolled back; `Exam.maxAttempts`, `ExamAttempt.startedAt`, `ExamAttempt.sessionId`; `ExamAttemptSession` table; 5 constraints; 6 indexes; fixture counts `users=4, subjects=1, courses=1, units=1, lessons=1, exams=1, questions=1, products=1, payments=1, sessions=1, attempts=1`; student/admin exam session linked to one attempt with `maxAttempts=2`, expiry set and score recorded |
| Read-only application smoke against restored target | ⛔ Not run: a practical focused harness would require starting the API against the drill connection string; schema/data verification was completed instead |

Both new branches are retained; no retention decision has been made, so nothing was deleted.

### 17.9 SA-11 migration status and checksum

| Check | Result |
|---|---|
| Migration file SHA-256 | ✅ `70366A1EA8B6EEAF898599F172B74E3A0DB96B4BEF52D1551F732092CDA0092F` (unchanged) |
| Applied migrations | ✅ 7/7, “Database schema is up to date” |
| SA-11 row on primary, backup and restore target | ✅ Present, not rolled back, same `finished_at` |
| Schema objects | ✅ `ExamAttemptSession` table, FK/PK constraints, `Exam_maxAttempts_positive`, indexes |

Policy behaviour is covered by `apps/api/tests/sa11-attempts.test.ts`, which includes unlimited attempts for `NULL`, finite limits, concurrent starts/submissions, idempotent replay, server-clock timeouts, abandoned sessions, ownership enforcement, no per-question correctness disclosure and stored-answer integrity. The full suite passed in this continuation (below).

### 17.10 Test commands and actual results

| Command | Result |
|---|---|
| `npx prisma migrate status --schema apps/api/prisma/schema.prisma` | ✅ 7 migrations found; schema up to date |
| `npm test` | ✅ 58 tests, 9 suites, 0 failed, 0 skipped (41.3 s) |
| `node post-sa11-drill-verify.cjs <primary>` | ✅ 10/10 checks (twice, including after deployment) |
| `node post-sa11-drill-verify.cjs <post-SA-11 backup>` | ✅ 10/10 checks |
| `node post-sa11-drill-verify.cjs <post-SA-11 restore>` | ✅ 10/10 checks |
| `npm audit --json` | ⚠️ 7 advisories: 2 moderate, 5 high |
| `npm run build` | ✅ Passed earlier in this engagement (API `tsc`, web `tsc -b && vite build`) |
| `staging-smoke.cjs` (`NODE_ENV=production`) | ✅ 14/14 local checks |
| `live-staging-smoke.cjs` | ✅ 19/19 live HTTPS checks |
| Live `curl` header/CORS checks | ✅ 200 health, 204 preflight, exact origin, HSTS, secure cookie |
| Served-client asset scan | ✅ Canonical API origin present; no localhost/ngrok/onrender/placeholder patterns |
| Public-page browser load | ✅ `/login` and `/dashboard` return 200; no JS exceptions |

### 17.11 Public smoke-test results

| Area | Status |
|---|---|
| Frontend HTTPS load | ✅ `https://samuel-academy-staging.vercel.app/login` and `/dashboard` both return HTTP 200 HTML; Vercel HSTS `max-age=63072000; includeSubDomains; preload` |
| SPA direct routing | ✅ `apps/web/vercel.json` rewrite serves `index.html` for client routes; direct `/dashboard` load works |
| Built client configuration | ✅ `/assets/index-OmdSFcPX.js` contains `https://samuel-academy-staging-api.vercel.app` |
| Old host/placeholder search | ✅ No localhost, `127.0.0.1`, ngrok, `onrender.com`, demo payment placeholder or `change-this` string in the served bundle |
| API health | ✅ `GET /api/health` → 200 JSON `{ ok: true, service: "samuel-academy-api" }`, `Cache-Control: no-store`, `X-Request-ID`, API HSTS `max-age=31536000; includeSubDomains` |
| Secure cookies | ✅ `sa_device` and session cookie flags include `HttpOnly; Secure; SameSite=Lax` |
| CORS | ✅ Preflight from exact web origin → 204 with `Access-Control-Allow-Origin: https://samuel-academy-staging.vercel.app` and `Access-Control-Allow-Credentials: true`; unknown origin receives no `Access-Control-Allow-Origin` |
| Config and demo mode | ✅ `/api/auth/config` reports `demoMode:false`, synthetic payment details, and no `JWT_SECRET`/`ADMIN_PASSWORD` values |
| Database connectivity via live API | ✅ Admin `/api/admin/overview` → 200 with `students=3`, `exams=1` from Neon Staging |
| Admin/student login and RBAC | ✅ Admin login 200/`ADMIN`; student login 200/`STUDENT`; `/api/auth/me` returns matching role; anonymous admin request 401; student admin request 403 |
| Demo rejection | ✅ Demo credentials return 401 in the live API |
| Browser console | ✅ No JavaScript exceptions; the only console error is the expected unauthenticated `/api/auth/me` 401 on public pages, handled by `AuthContext` |
| Aggregate live result | ✅ `live-staging-smoke.cjs` 19/19 passed; 0 failed |

Local production-mode smoke results (§14) remain valid, and the live-public results above now supersede the earlier “not run” status.

### 17.12 npm audit advisory-by-advisory decisions

Fresh audit: `npm audit --json` → 7 advisories (2 moderate, 5 high). Every available fix is a breaking major upgrade, so none was applied silently.

| Package | Installed | Path | Advisory | Severity | Scope | Reachability | Fix | Breaking | Classification |
|---|---|---|---|---|---|---|---|---|---|
| `@prisma/config` | 6.19.3 | `prisma → @prisma/config` (transitive) | via `deepmerge-ts`, `effect` | High | Dev/build toolchain | Not exposed at runtime; CLI reads static config | `prisma@7.10.1` | Yes (6→7) | ACCEPT TEMPORARILY; upgrade NEEDS OWNER APPROVAL |
| `deepmerge-ts` | 7.1.5 | `prisma → @prisma/config → deepmerge-ts` | GHSA-ggr8-5vv4-36mx (stack exhaustion on recursive object graphs) | High | Dev/build toolchain | No attacker-controlled recursive config in this repo | via `prisma@7.10.1` | Yes | ACCEPT TEMPORARILY; NEEDS OWNER APPROVAL |
| `effect` | 3.21.0 | `prisma → @prisma/config → effect` | GHSA-7589-6fvf-x4pw (ReDoS in `Schema.TemplateLiteral`) | High | Dev/build toolchain | No attacker-controlled schema strings at build time | via `prisma@7.10.1` | Yes | ACCEPT TEMPORARILY; NEEDS OWNER APPROVAL |
| `prisma` | 6.19.3 | Direct devDependency of `apps/api` (also via `@prisma/client`) | via `@prisma/config` | High | Build/migration CLI | Runs at build/deploy against trusted schema; no request path | `prisma@7.10.1` | Yes | NEEDS OWNER APPROVAL; plan before Production |
| `react-router` | 6.30.6 | `react-router-dom → react-router` (transitive) | GHSA-wrjc-x8rr-h8h6 (backslash open redirect), GHSA-337j-9hxr-rhxg (SSR hydration constructor injection) | Moderate | Client SPA dependency | Navigation targets are internal literals; login `from` comes from `location.pathname + search` set by the app; no SSR hydration | `react-router-dom@7.18.7` | Yes (6→7) | ACCEPT TEMPORARILY for Staging; FIX BEFORE PRODUCTION if routing changes |
| `react-router-dom` | 6.30.6 | Direct dependency of `apps/web` | via `react-router` | Moderate | Client dependency | Same as above | `react-router-dom@7.18.7` | Yes | ACCEPT TEMPORARILY; NEEDS OWNER APPROVAL |
| `zod` | 3.25.76 | Direct runtime dependency of `apps/api` | CVE-2023-54404 / GHSA-mrhx-c7xc-m3w5 (memory exhaustion on unconstrained arrays) | High | Runtime request validation | Partially mitigated: body limited to 1 MB and both `z.array` uses have `.max(50)`; no unconstrained array schema found | `zod@4.6.7` | Yes (3→4) | FIX BEFORE PRODUCTION; NEEDS OWNER APPROVAL for major upgrade |

No `npm audit fix --force` or blanket major upgrades were run; the audit above is the fresh post-check state, so no advisory is claimed fixed.

### 17.13 Security review findings

- Secret scan of all 78 files in commit `8633f2a`: no `.env` files other than the documented `.env.example`, no tokens, API keys or private keys. Later commits `de2f8f7` and `2cde39a` added only SPA rewrite and Vercel adapter configuration.
- Six pattern matches were reviewed individually and are non-secret: demo `postgresql://u:p@…` strings in `README.md`/`.env.example`/a test fixture, example `JWT_SECRET`/`ADMIN_PASSWORD` placeholders, and literal environment-variable names in the report.
- Production remained untouched: `.env.production` was not read or modified; no Production database, credential, project or deployment was used.
- HTTPS/TLS verified live: Vercel web HSTS `max-age=63072000; includeSubDomains; preload`, API HSTS `max-age=31536000; includeSubDomains`, secure session/device cookies, and Neon connections using `verify-full`.
- CORS verified live: exact canonical web origin only, credentials enabled, unknown origin rejected, no wildcard.
- Demo mode verified live: `false` from `/api/auth/config`, demo credentials rejected.
- Deploy hook URLs and provider secret values were treated as secrets; hook names are recorded but URLs are not.

### 17.14 Files changed and reasons

| Path | Reason |
|---|---|
| `docs/deployment/SAMUEL-ACADEMY-STAGING-SETUP-REPORT.md` | This dated completion section; original report preserved |
| `apps/web/vercel.json` | SPA rewrite so direct client routes such as `/dashboard` return `index.html` |
| `apps/api/vercel.json` | Vercel Node rewrite to `/api/index` |
| `apps/api/api/index.ts` | Minimal Vercel Node adapter importing the existing Express app |
| `D:\Temp\opencode\post-sa11-drill-verify.cjs` | Read-only verifier for identity, SA-11 objects, migration state and fixtures across primary/backup/restore |
| `D:\Temp\opencode\live-staging-smoke.cjs`, `live-staging-smoke-results.json`, `live-login-diagnostic.cjs`, `clear-staging-session-binding.cjs` | Live HTTPS verification, diagnostic and targeted Staging-only session-binding cleanup; kept outside the repo |
| `D:\Temp\opencode\audit-summary.cjs`, `audit-summary.json`, `staging-audit.json` | Fresh advisory extraction and reachability analysis |
| `D:\Temp\opencode\commit-secret-scan.cjs`, `commit-secret-scan.json` | Secret verification before the branch was pushed |
| `D:\Temp\opencode\post-sa11-backup-branch.json`, `post-sa11-restore-branch.json`, `post-sa11-*-verify.json`, `post-sa11-final-verify.json`, `samuel-staging-post-*.txt` | Non-secret branch metadata, verification evidence and secret-bearing connection strings kept outside the repo |
| Commit `8633f2a` (78 files) | SA-11 implementation, security hardening, docs, Neon skills/MCP config and prior Staging work |
| Commits `de2f8f7`, `2cde39a` | Vercel SPA rewrite and API adapter; both pushed on `staging/sa11-20261126` |
| `apps/web/vite.config.ts` | Earlier removal of the temporary ngrok host (retained) |

No Production configuration file was changed.

### 17.15 Provider resources created or reused

| Provider | Created | Reused | Not created |
|---|---|---|---|
| Neon | Branches `staging-post-sa11-20261126` and `restore-drill-post-sa11-20261126` | Project, primary DB, role, endpoint, two pre-SA-11 branches | No new project/database; no plan upgrade |
| GitHub | Remote branch `staging/sa11-20261126` at `2cde39a` | Existing repository and `main` baseline | No push to `main`; no force-push |
| Vercel | Web project, API project, environment variables, two deploy hooks, multiple Ready deployments | Existing `WM_Solutions` team | No Production project or Production branch target |
| Render / Railway / Netlify | — | Dashboards inspected only | No service created; no card verification or paid upgrade |

### 17.16 Remaining manual actions

1. Obtain owner approval before the breaking major upgrades (`prisma@7`, `react-router-dom@7`, `zod@4`) or any paid tier.
2. Decide on a shared rate-limit store before scaling the Vercel API beyond a single instance/region.
3. Decide retention for the four Neon branches; do not delete them before that decision.
4. Optional for later: custom domain, WAF rules, monitoring/alerting and persistent object storage for uploads. None blocks Staging readiness.

No deployment blocker remains.

### 17.17 Remaining risks and limitations

- The post-SA-11 restore drill proves recovery of the schema and the small synthetic dataset, not a large real dataset.
- The focused read-only application smoke test against the restored database was replaced by direct schema/data verification.
- All seven dependency advisories remain; the highest remaining practical exposure is the runtime `zod` advisory, currently limited by a 1 MB body cap and `.max(50)` array schemas.
- Rate limiting is in-process; multiple Vercel API instances/regions would need a shared store.
- Uploads use `/tmp/samuel-academy-uploads` on Vercel; this is acceptable for Staging but would need persistent object storage for Production.
- The only public-page console error is the expected unauthenticated `/api/auth/me` 401, which the app handles.
- Deploy hook URLs remain secrets; rotate them if they are ever exposed.
- Production was not inspected or modified throughout this work.

### 17.18 Final verdict

**STAGING READY.** Both Vercel projects are live from `staging/sa11-20261126` at commit `2cde39a`: the web deployment `GYnCvKrt7nR8cnB6UcNVRFHN6ww8` and API deployment `xMFy4dHyzuegVFxSd43zrJJRzoap` are Ready. Live HTTPS verification passed 19/19 checks, including exact-origin credentialed CORS, HSTS, secure cookies, `DEMO_MODE=false`, admin/student login, RBAC, demo rejection, Neon DB connectivity, built-client API URL and asset/console checks. The final read-only database verification passed 10/10, 7/7 migrations remain applied, and no Production resource was touched.

> # FINAL VERDICT: STAGING READY

---

## Appendix A — Neon skill and MCP setup changes

The official Neon agent skill was fetched from `https://neon.com/.well-known/agent-skills/neon/SKILL.md` and followed (CLI-first workflow, skill status checks, OAuth for project-level MCP). Changes made:

| Change | Path | Effect |
|---|---|---|
| Installed 7 Neon skills for OpenCode at project level | `.agents/skills/neon*/` (untracked) | `neon`, `neon-ai-gateway`, `neon-auth`, `neon-functions`, `neon-object-storage`, `neon-postgres`, `neon-realtime` available to this project |
| Recorded skill versions | `skills-lock.json` (untracked) | Source `neondatabase/agent-skills`, commit `d3601d9e…` |
| Added project MCP server | `opencode.jsonc` (untracked) | Remote Neon MCP at `https://mcp.neon.tech/mcp`; OAuth sign-in on first use; **no API key written to any file** |
| Stored Neon project context | `.neon` (untracked) | `{ "projectId": "quiet-king-99299808" }` only; no credentials |
| Updated user-level skills | Global OpenCode skill directory | `neon-postgres` and `neon-realtime` refreshed; all 7 user-level skills now report “up to date” |
| Removed temporary tunnel host | `apps/web/vite.config.ts` (modified) | ngrok default host replaced with explicit optional `VITE_ALLOWED_HOSTS` |

Preserved configuration:

- Global OpenCode MCP servers remain `capcut`, `context7`, `playwright`, `pollinations` — no global Neon entry was added and no global config file was overwritten.
- The project had no prior `opencode.jsonc`, `.agents/`, `.neon` or `skills-lock.json`; nothing was replaced.
- No existing code identifiers, migration files or environment templates were renamed or modified beyond the ngrok cleanup listed above.
