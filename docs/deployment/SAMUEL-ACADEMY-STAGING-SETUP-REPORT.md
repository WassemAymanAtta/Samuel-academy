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
