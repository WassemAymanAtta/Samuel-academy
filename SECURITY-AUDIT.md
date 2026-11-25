# Samuel Academy — Security Audit (Phase 1, initial report)

**Date:** 2026-11-25  
**Repository:** `D:\samuel-academy`  
**Branch:** `main` at `4a2b2cc` (clean at the start of this phase)  
**Scope:** existing application only — Express/TypeScript API, Prisma schema and six migrations, React/Vite web app, configuration templates, Git history, dependency advisories, and existing tests.  
**Phase:** 1 — inspection and reporting. No application code was changed, no database was reset/migrated/seeded, no destructive test was run against live data, and no actual `.env` secret value was read or printed.

> **Phase 2 addendum:** Approved P0 + P1 code-only remediation was applied after this Phase 1 report. The finding details below are the historical baseline; their current status is superseded by **Section 6 — Phase 2 remediation status** at the end of this document. No migration was applied.

## 1. Executive summary

- **Critical findings:** 0.
- **High findings:** 6.
- **Medium findings:** 15.
- **Low findings:** 5.
- **Informational findings:** 2.
- **Overall assessment:** suitable for a controlled **local demo / supervised trial** with demo data. **Not suitable for production or an untrusted staging deployment** until the High findings are fixed and verified.
- The strongest existing controls are: explicit CORS, bcrypt cost 12, server-side role/status checks from the database, Zod allowlisted write fields, DB-derived prices, transactional payment approval, signed device/session claims, no raw SQL, and no committed secrets found in tracked history.
- The most important gaps are: no rate limiting, portable/stolen Bearer tokens because device proof is not checked after login, exam answer-key disclosure with unlimited retries, unauthenticated external-PDF URL leakage, private files reachable through unpublished lessons, and full JWTs embedded in media URLs.

### Severity definitions

| Severity | Meaning |
|---|---|
| Critical | Direct, trivial compromise of production data or admin control with little or no precondition. |
| High | Practical bypass of authentication, authorization, entitlement, or grade integrity; exploit has meaningful impact. |
| Medium | Materially weakens defence, enables abuse/DoS/fraud, or requires an additional precondition. |
| Low | Limited impact, requires unusual conditions, or mainly defence-in-depth. |
| Informational | Missing capability or documentation item; no direct exploit path today. |

### References used

- OWASP Top 10:2025 (current released version): Broken Access Control, Security Misconfiguration, Software Supply Chain Failures, Cryptographic Failures, Insecure Design, Authentication Failures, Logging & Alerting Failures.
- OWASP API Security Top 10:2023: API1 Broken Object Level Authorization, API2 Broken Authentication, API3 Broken Object Property Level Authorization, API4 Unrestricted Resource Consumption, API5 Broken Function Level Authorization, API8 Security Misconfiguration, API9 Improper Inventory Management.

## 2. Evidence gathered without modification

| Check | Result |
|---|---|
| Repository structure | Two workspaces (`apps/api`, `apps/web`), six Prisma migrations, eight API test files, no `.github`/CI/deployment directory. |
| Documentation reviewed | `README.md`, `QA_REVIEW_REPORT.md`, `CLIENT_TRIAL_GUIDE.md`, `.env.example`, `apps/api/.env.example`. |
| Git history | Three commits; only `.env.example` and `apps/api/.env.example` are tracked. Pattern scan of all history redacted potential values and found no actual `.env`/`.env.production` content tracked. |
| `.gitignore` | `.env`, `.env.*`, `storage/`, uploads, logs and build output are excluded; `!.env.example` is the explicit exception. |
| Dependencies | `npm audit --json` and `npm audit --omit=dev --json` both exit 1: **7 vulnerabilities** (5 high, 2 moderate). Direct packages needing major-version review: `prisma` → 7.10.1, `zod` → 4.6.7, `react-router-dom` → 7.18.7. |
| Installed versions | `@prisma/client`/`prisma` 6.19.3, `zod` 3.25.76, `react-router-dom` 6.30.6, Express 4.22.3, `jsonwebtoken` 9.0.3, `bcryptjs` 2.4.3. |
| Test baseline from prior QA | `npm test` 27/27, `npm run build` succeeded. Not re-run during Phase 1 so this phase stayed read-only. |
| Live servers | Earlier verified API `4000` and web `5173` returned 200; not used for destructive/security probes. |

## 3. Findings

Every finding below contains the required evidence fields. All statuses are **Open — no fix applied in Phase 1**.

---

### SA-01 — No rate limiting or lockout on login, registration, or sensitive endpoints

- **Severity:** High
- **OWASP:** A07 Authentication Failures; API2 Broken Authentication; API4 Unrestricted Resource Consumption
- **Affected code:** `apps/api/src/app.ts:16-81`; `apps/api/src/routes/auth.ts:27-76`; `apps/api/package.json:21-43` (no throttling dependency).
- **Attack scenario:** An attacker sends unlimited wrong-password requests. Every request reaches `bcrypt.compare`, allowing credential stuffing and CPU exhaustion from a single IP or botnet. Registration and payment submission can be flooded similarly.
- **Business impact:** Account takeover, admin-queue flooding, inflated hosting cost, and denial of service on the single-process API.
- **Local reproduction:** Against `TEST_DATABASE_URL` fixtures, loop 100 `POST /api/auth/login` attempts with a wrong password for one active user. All return `401`, none return `429`, and a later correct-password login still succeeds immediately. Repeat with `POST /api/auth/register` to create many `PENDING` rows.
- **Recommended fix:** Add per-IP **and** per-normalized-email limits for login, IP/device limits for register and payment creation, `429` with `Retry-After`, escalating backoff, and CAPTCHA after repeated failures. Keep limits high enough for students on shared NAT.
- **Verification test:** After N failed logins assert `429`; assert recovery after cooldown; assert repeated registration is throttled; assert legitimate shared-IP traffic is not blocked by the chosen thresholds.
- **Status:** Open — requires owner approval before implementation.

---

### SA-02 — Device binding is not enforced on authenticated requests; stolen JWT is portable

- **Severity:** High
- **OWASP:** A07 Authentication Failures; API2 Broken Authentication
- **Affected code:** `apps/api/src/lib/auth.ts:51-59,77-99`; `apps/api/src/routes/auth.ts:55-74`; `apps/api/src/app.ts:49-50`; `apps/web/src/context/AuthContext.tsx`.
- **Attack scenario:** Login issues a 7-day JWT stored in `sessionStorage` and also sent as a Bearer token. `requireAuth` verifies the JWT `sv`/`did` claims against the database but never verifies the request's actual device cookie/header. A token stolen by XSS, malware, or a proxy log can be replayed from another device with full account/admin privileges until logout.
- **Business impact:** The advertised one-device restriction does not stop token theft; paid content and admin actions can be performed by whoever holds the JWT.
- **Local reproduction:** Login with `X-Device-Id: device-a`, save the token. From a fresh agent with no `sa_device` cookie, call `GET /api/student/dashboard` with `Authorization: Bearer <token>` and a different `X-Device-Id`. It returns `200`.
- **Recommended fix:** On every `requireAuth`/`optionalAuth` call, require server-issued device proof matching `payload.did` and `user.sessionDeviceId` (signed httpOnly cookie or HMAC-bound device credential). Reject Bearer tokens presented without that proof. Prefer httpOnly cookies for the primary session and reserve Bearer for explicit API clients.
- **Verification test:** Valid token from bound device → `200`; same token without device proof or with a different proof → `401`; role changes still take effect immediately from the database.
- **Status:** Open.

---

### SA-03 — Exam answer key is returned after submission; unlimited retries make grades forgeable

- **Severity:** High
- **OWASP:** A04 Cryptographic Failures (integrity of grading data); API3 Broken Object Property Level Authorization; Insecure Design
- **Affected code:** `apps/api/src/services/grading.ts:19-53`; `apps/api/src/routes/exams.ts:79-110,114-142`; `apps/web/src/pages/student/ExamPage.tsx`.
- **Attack scenario:** Grading returns `correctAnswers` (correct option IDs or expected short answer) inside `feedback`, and the attempt response adds `correctOptionTexts`. A student submits an empty attempt, reads the answer key, then resubmits with correct IDs. Stored feedback is also returned by `/api/attempts/:id`.
- **Business impact:** Grades, `passed` flags, and any downstream progress/certificate decisions are unreliable; paid exam products can be completed without knowledge.
- **Local reproduction:** Admin creates a published MCQ exam and grants access. Student calls `POST /api/exams/:id/attempts` with `answers: {}`, reads `feedback[].correctOptionTexts`, then calls the endpoint again with the correct option IDs and receives 100%.
- **Recommended fix:** Never return `correctAnswers`, `correctOptionTexts`, or `expectedAnswer` to students. Store only `questionId`, `correct`, `earnedPoints`, and optional explanation. Reveal answer keys only after a defined attempt limit or reveal time. Perform all grading on the backend (already done) and keep that property.
- **Verification test:** Assert student attempt and attempt-detail responses contain no `isCorrect`, `correctAnswers`, `expectedAnswer`, or correct option text; assert stored `feedback` JSON has none of them; assert a second attempt cannot be used to discover answers.
- **Status:** Open.

---

### SA-04 — External PDF URLs are leaked by unauthenticated catalog endpoints

- **Severity:** High
- **OWASP:** A01 Broken Access Control; API1 Broken Object Level Authorization
- **Affected code:** `apps/api/src/routes/catalog.ts:28-42` and `45-108`; `apps/api/prisma/schema.prisma` course/unit PDF fields.
- **Attack scenario:** `catalogRouter.use(optionalAuth)` makes these endpoints public. `/subjects/:id` includes courses without a `select`, returning all course scalars including `pdfUrl`, `pdfFileId`, and `pdfTitle`. `/courses/:id` spreads `...course` and `...unit` into the response, leaking course- and unit-level external PDF URLs. The existing fix only scrubs `/units/:id` and lesson-level selects.
- **Business impact:** Paid external PDFs can be downloaded without purchase; entitlement checks on uploaded files are bypassed for external URLs.
- **Local reproduction:** As an anonymous caller, `GET /api/catalog/subjects/:id` and `GET /api/catalog/courses/:id`; inspect JSON for `pdfUrl` values and open them directly.
- **Recommended fix:** Use explicit `select` allowlists mirroring `fileSelect` for course and unit metadata. Return external URLs only from an entitlement-checked detail route. Add a test that anonymously requests all four catalog endpoints and fails if any `pdfUrl`, `videoUrl`, or `pdfFileId` appears.
- **Verification test:** Anonymous and unpaid-student responses contain no external resource URLs; entitled students still receive a working private file link through `/api/files/:id`.
- **Status:** Open.

---

### SA-05 — Private files attached to unpublished lessons are still served

- **Severity:** High
- **OWASP:** A01 Broken Access Control; API1 Broken Object Level Authorization
- **Affected code:** `apps/api/src/routes/files.ts:17-45`; `apps/api/src/services/access.ts:88-135`; compare `apps/api/src/routes/catalog.ts:150-190`.
- **Attack scenario:** `accessMap()` enumerates all lessons without an `isPublished` filter, and `files.ts` authorizes file access using `map.lessons.has(lessonId)`. A student with a UNIT/LESSON/subscription grant can download a PDF/MP4 linked to a hidden lesson even though `/api/catalog/lessons/:id` correctly returns 404.
- **Business impact:** Unreleased or paid material leaks before publication; editorial/publishing controls are bypassed.
- **Local reproduction:** Admin uploads a PDF, creates an unpublished lesson linked to it, and grants the student unit access. `GET /api/catalog/lessons/:hiddenId` → 404; `GET /api/files/:fileId` → 200 with bytes.
- **Recommended fix:** Include `isPublished` in lesson selects and require publication for non-admin file requests. Alternatively, filter `accessMap` lessons by publication while keeping a separate admin path.
- **Verification test:** Regression mirroring existing unpublished-lesson test: hidden lesson file → 403/404 for students, 200 for admin; published lesson file → 200 when entitled.
- **Status:** Open.

---

### SA-06 — Full long-lived JWT is placed in private file URLs

- **Severity:** High
- **OWASP:** A07 Authentication Failures; API2 Broken Authentication; Security Misconfiguration
- **Affected code:** `apps/api/src/lib/auth.ts:51-58`; `apps/web/src/lib/api.ts:34-38`; `apps/web/src/pages/student/LessonPage.tsx`; `apps/web/src/pages/student/CoursePage.tsx`; `apps/api/tests/api.test.ts:496-505` currently codifies this behaviour.
- **Attack scenario:** `<video>`, `<audio>`, and `<a download>` URLs include `?token=<JWT>`. The token is a normal 7-day credential accepted as a Bearer token on every API. It can be captured from browser history, screenshots, reverse-proxy access logs, or `Referer` headers.
- **Business impact:** Session hijacking and paid-content theft; device binding is bypassed because the replayed token already contains the bound device claim.
- **Local reproduction:** Login, copy a media `src` from the network panel, extract `token`, then call `GET /api/student/dashboard` with `Authorization: Bearer <token>` from a fresh client → 200.
- **Recommended fix:** Issue short-lived (seconds-to-minutes), single-purpose, file-scoped signed capability tokens or opaque stream tokens. Never expose the login JWT in URLs. Add `Referrer-Policy: no-referrer` and ensure proxy logs strip `token`.
- **Verification test:** File token works only for its file and expires quickly; replay after TTL or for another file → 401; it is rejected by `/api/student/dashboard`; generated media URLs contain no login JWT.
- **Status:** Open.

---

### SA-07 — `X-Device-Id` is trusted as device proof and can be spoofed

- **Severity:** Medium
- **OWASP:** A07 Authentication Failures; Insecure Design
- **Affected code:** `apps/api/src/app.ts:51-64`; `apps/api/src/lib/auth.ts:61-67`; `apps/api/src/routes/auth.ts:55-72`.
- **Attack scenario:** The API sets a non-authorising `sa_device` cookie only when no header is present, but `deviceIdFrom()` prefers a raw client header. An attacker with the password can replay a known/victim device ID from another machine and take over the session; an attacker can also bind a chosen ID first and lock out the legitimate user.
- **Business impact:** The one-device control gives false assurance; enables account takeover and denial of service.
- **Local reproduction:** Login as victim with `X-Device-Id: device-a`. From another client, submit the same credentials with `X-Device-Id: device-a` and no matching cookie → login succeeds and the victim's old token is invalidated.
- **Recommended fix:** Require the server-issued signed httpOnly device cookie; if a header is accepted, verify it equals the cookie/HMAC-bound value. Never treat a bare client-supplied header as proof.
- **Verification test:** Correct password + spoofed header without cookie → 403; valid cookie + mismatched header → 403; valid cookie + matching header → 200.
- **Status:** Open.

---

### SA-08 — Stale logout can revoke a newer session

- **Severity:** Medium
- **OWASP:** A07 Authentication Failures; API2 Broken Authentication
- **Affected code:** `apps/api/src/lib/auth.ts:77-99`; `apps/api/src/routes/auth.ts:78-89`.
- **Attack scenario:** Logout increments `sessionVersion` and clears `sessionDeviceId` by user ID without checking that the presented token is still current. A stale token that was valid when the request began can log out a newer session created by a same-device re-login.
- **Business impact:** Race-based availability issue, unexpected device unbinding, inconsistent revocation semantics.
- **Local reproduction:** Login on device A → `token1`; re-login on device A → `token2`; send logout with `token1`; `token2` now returns 401 and the device binding is cleared.
- **Recommended fix:** Attach verified JWT claims to `req` in `requireAuth`, then perform a conditional `updateMany` matching `id`, `sessionVersion`, and `sessionDeviceId`; require `count === 1`.
- **Verification test:** Stale-token logout fails and leaves the newest token valid; normal logout still revokes immediately.
- **Status:** Open.

---

### SA-09 — Lesson/unit grants unlock course-level files and catalog “unlocked” state

- **Severity:** Medium
- **OWASP:** A01 Broken Access Control; API1 Broken Object Level Authorization
- **Affected code:** `apps/api/src/services/access.ts:97-127`; `apps/api/src/routes/files.ts:28-42`; `apps/api/src/routes/catalog.ts:80-108`; `apps/web/src/pages/student/CoursePage.tsx`.
- **Attack scenario:** `accessMap()` adds a course ID when any lesson or unit in it is accessible. `files.ts` then allows a course-level file via `map.courses.has(course.id)`, and catalog returns `unlocked: true` for the whole course. A student who bought one lesson can download a whole-course PDF.
- **Business impact:** Revenue loss and entitlement mismatch; UI “unlocked” state overstates actual access.
- **Local reproduction:** Course with a `pdfFileId`, one lesson, and a cheap LESSON product. Grant only that lesson. `GET /api/catalog/courses/:id` → `unlocked: true`; `GET /api/files/:coursePdfId` → 200.
- **Recommended fix:** Separate decoration sets from entitlement sets. Course-level files require a course/subject subscription or explicit course product, not inferred ownership from a lesson/unit grant.
- **Verification test:** Lesson-only and unit-only grants → course PDF 403; course/subject subscription → 200; lesson access still works where intended.
- **Status:** Open.

---

### SA-10 — Weak password policy and predictable demo credentials

- **Severity:** Medium
- **OWASP:** A07 Authentication Failures; Insecure Design
- **Affected code:** `apps/api/src/routes/auth.ts:11-16`; `apps/web/src/pages/Register.tsx:67-75`; `apps/api/prisma/seed.ts`; `README.md:88-98`.
- **Attack scenario:** Students may register with any 8-character password, including repetitive or common values. With SA-01 present, dictionary attacks are practical. Well-known demo credentials are intentionally published and pre-filled in demo mode.
- **Business impact:** Student account takeover and paid-content abuse; predictable admin access if demo data reaches a non-demo environment.
- **Local reproduction:** Register a test user with an 8-character common password; API accepts it. In demo mode, login with documented demo credentials succeeds by design.
- **Recommended fix:** Require ≥12 characters and reject common, sequential, repetitive, and email-derived passwords; consider a breached-password check with a privacy-preserving API. Keep demo credentials strictly gated to demo mode/demo database names and never pre-fill them outside that mode.
- **Verification test:** Weak examples are rejected; strong passphrases accepted; production config with demo credentials fails startup (already partly enforced for bootstrap admin).
- **Status:** Open.

---

### SA-11 — Exam attempts have no server-side limit, deadline, or idempotency

- **Severity:** Medium
- **OWASP:** API4 Unrestricted Resource Consumption; Insecure Design
- **Affected code:** `apps/api/src/routes/exams.ts:58-110`; `apps/api/prisma/schema.prisma` `Exam.timeLimitMinutes`, `ExamAttempt`; `apps/web/src/pages/student/ExamPage.tsx`.
- **Attack scenario:** `timeLimitMinutes` is displayed in the UI but never enforced. No `maxAttempts` count or idempotency key exists, so a student can submit unlimited attempts, brute-force short answers, and create many rows from double-clicks or scripts.
- **Business impact:** Inflated/weaponised grades and database abuse.
- **Local reproduction:** Submit the same attempt 20 times rapidly → 20 rows created. Wait past the displayed time limit → submission still accepted.
- **Recommended fix:** Add optional `maxAttempts` and server-side `startedAt`/deadline checks inside a transaction; require an idempotency key or dedupe window for duplicate submissions.
- **Verification test:** `(maxAttempts + 1)`th submission → 403; late submission → 403; duplicate key returns the original attempt without creating a second row.
- **Status:** Open — likely needs a backward-compatible migration; owner approval required before applying.

---

### SA-12 — Payment reference uniqueness is per-user, not global

- **Severity:** Medium
- **OWASP:** Insecure Design; API3 Broken Object Property Level Authorization
- **Affected code:** `apps/api/src/routes/payments.ts:52-76`; `apps/api/prisma/schema.prisma:259`; migration `20261125005406_payment_reference_unique/migration.sql`; `apps/api/src/routes/admin.ts:583-667`.
- **Attack scenario:** The unique index is `@@unique([userId, reference])`. Two students can submit the same transfer reference; manual review does not surface a global collision warning. Admin can approve both and grant two entitlements from one transfer.
- **Business impact:** Revenue loss and duplicate access grants.
- **Local reproduction:** Student A and B submit `reference: "TXN-2026-001"` → both 201. Admin approves both → two `AccessGrant` rows.
- **Recommended fix:** Check for existing references on a non-destructive read first, then add a global unique index (or normalized `transferKey`) after resolving any legitimate duplicates. Surface collisions in admin UI and require a logged override reason if reuse is allowed.
- **Verification test:** Two users submitting the same reference → second 409; approve-first-then-second conflict; only one grant created.
- **Status:** Open — schema/index change requires owner approval.

---

### SA-13 — Large upload bodies are buffered before authentication

- **Severity:** Medium
- **OWASP:** API4 Unrestricted Resource Consumption; A01 Broken Access Control
- **Affected code:** `apps/api/src/app.ts:35-46` (raw parsers mounted before cookie parser and routers); `apps/api/src/routes/uploads.ts:10-12,55-121`.
- **Attack scenario:** Anonymous clients can stream up to 20 MB PDF or 200 MB media into memory before `requireAuth`/`requireAdmin` runs inside the upload router. Concurrent requests exhaust memory/bandwidth.
- **Business impact:** Denial of service on the single-process API.
- **Local reproduction:** POST a large body to `/api/admin/uploads/media` without credentials; the server reads the body before returning 401/403.
- **Recommended fix:** Mount authentication and admin authorization before the raw body parsers; add proxy-level body-size and concurrency limits; add rate limiting from SA-01.
- **Verification test:** Unauthenticated oversized request returns 401 before the body is consumed; authenticated valid upload still works.
- **Status:** Open.

---

### SA-14 — Missing security headers, CSP, HSTS, and Referrer-Policy

- **Severity:** Medium
- **OWASP:** A05 Security Misconfiguration; API8 Security Misconfiguration
- **Affected code:** `apps/api/src/app.ts:16-81`; `apps/api/src/routes/files.ts:57-62` (only file-specific `nosniff` and cache headers). No Helmet/CSP configuration present.
- **Attack scenario:** Without CSP/Referrer-Policy/HSTS/frame headers, the app relies entirely on framework escaping and SameSite cookies. This is especially risky while SA-06 puts JWTs in URLs.
- **Business impact:** Increased XSS, clickjacking, token leakage, and downgrade risk; fails common production baselines.
- **Local reproduction:** Inspect response headers for `/`, `/login`, and `/api/health`: no `Content-Security-Policy`, `Strict-Transport-Security`, `Referrer-Policy`, `X-Frame-Options`, or `Permissions-Policy`.
- **Recommended fix:** Add an allowlisted security-header middleware; set a restrictive CSP for the Vite build, HSTS only behind HTTPS, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, and keep `nosniff`. Configure trusted proxy headers explicitly.
- **Verification test:** Header assertions in smoke tests; verify uploaded media/PDF rendering still works under CSP.
- **Status:** Open.

---

### SA-15 — Unbounded admin list and report queries

- **Severity:** Medium
- **OWASP:** API4 Unrestricted Resource Consumption
- **Affected code:** `apps/api/src/routes/admin.ts:212-234,281-304,385-398,531-546,583-597,674-716`.
- **Attack scenario:** `/api/admin/progress` scans all lesson progress and exam attempts and computes results O(students × courses) in application memory. Other list endpoints have no pagination or `take` cap.
- **Business impact:** Admin dashboard timeouts and possible process exhaustion as data grows; a compromised admin token can amplify this.
- **Local reproduction:** On the test DB create N students × M courses/lessons; call `/api/admin/progress` and observe response size/time growing roughly N×M.
- **Recommended fix:** Add cursor pagination with a maximum `take`, move aggregation into grouped Prisma/SQL queries, and add query timeouts at the database/proxy layer.
- **Verification test:** With 200 students × 50 courses, page size is capped and response stays under an agreed threshold.
- **Status:** Open.

---

### SA-16 — Account status changes do not revoke sessions

- **Severity:** Medium
- **OWASP:** A07 Authentication Failures; API2 Broken Authentication
- **Affected code:** `apps/api/src/routes/admin.ts:261-277`; `apps/api/src/lib/auth.ts:77-99`; contrast `apps/api/scripts/bootstrap-admin.ts`.
- **Attack scenario:** Admin sets a student to `REJECTED`; the old token is blocked by the status check. If the student is later reactivated, the same old token becomes valid again because `sessionVersion` and `sessionDeviceId` were not changed.
- **Business impact:** Suspended sessions silently resume; inconsistent offboarding.
- **Local reproduction:** Login → admin rejects → token 401 → admin reactivates → same token 200.
- **Recommended fix:** Increment `sessionVersion` and clear `sessionDeviceId` whenever status leaves `ACTIVE`, and preferably on reactivation too, forcing a fresh login.
- **Verification test:** Reject → reactivate → old JWT remains 401; fresh login succeeds.
- **Status:** Open.

---

### SA-17 — No MFA or reauthentication for sensitive admin actions

- **Severity:** Medium
- **OWASP:** A07 Authentication Failures; Insecure Design
- **Affected code:** `apps/api/src/routes/auth.ts:45-89`; `apps/api/src/routes/admin.ts`; `README.md` production admin section.
- **Attack scenario:** The production admin account is protected only by a single password. There is no second factor and no current-password prompt for sensitive changes such as role/status, product prices, payment approval, or admin credential bootstrap.
- **Business impact:** One phished or leaked admin password yields full platform control and access to all student data and payment proofs.
- **Local reproduction:** Login as admin with only email/password; no second factor is requested; sensitive admin endpoints accept the session without reauthentication.
- **Recommended fix:** Add TOTP/WebAuthn MFA for `ADMIN` accounts and step-up authentication for status/price/approval changes. Document break-glass recovery. Keep MFA optional for students initially if rollout is a concern.
- **Verification test:** Admin login without MFA fails; step-up challenge required before sensitive mutation; recovery flow tested in staging.
- **Status:** Open — feasibility decision needed from owner.

---

### SA-18 — Demo payment details remain as production fallbacks

- **Severity:** Medium
- **OWASP:** A05 Security Misconfiguration; Insecure Design
- **Affected code:** `apps/api/src/lib/config.ts:43-52,89-99`; `apps/api/src/routes/auth.ts:100-109`; `apps/api/src/routes/payments.ts:78-86`.
- **Attack scenario:** `required('DEMO_PAYMENT_INSTAPAY', 'DEMO - ...')` supplies demo payment instructions even when `DEMO_MODE=false`. `/api/auth/config` and every payment response show a fake alias without a clear production-safe configuration requirement.
- **Business impact:** Students may transfer real money to an invalid/demo recipient; support and chargeback disputes.
- **Local reproduction:** Start with `NODE_ENV=production`, `DEMO_MODE=false`, valid admin config, but no `DEMO_PAYMENT_*` variables; public config shows demo alias.
- **Recommended fix:** When `!demoMode`, require real `PAYMENT_INSTAPAY` and `PAYMENT_EWALLET` values and reject placeholder patterns, as already done for admin credentials.
- **Verification test:** Production startup fails when payment details are missing/placeholder; configured real details are returned with `demoMode:false`.
- **Status:** Open.

---

### SA-19 — Dependency advisories require reviewed upgrades

- **Severity:** Medium
- **OWASP:** A03 Software Supply Chain Failures; API9 Improper Inventory Management
- **Affected code:** `package.json`, `apps/api/package.json`, `apps/web/package.json`, `package-lock.json`.
- **Attack scenario:** `npm audit` reports 7 advisories (5 high, 2 moderate): Prisma toolchain (`@prisma/config`, `deepmerge-ts`, `effect`, `prisma`), `zod`, and `react-router`/`react-router-dom`. Fixes require major-version upgrades, so blind upgrades could break the app.
- **Business impact:** Known vulnerable code in build/runtime dependencies; potential ReDoS/stack exhaustion/open-redirect/hydration issues depending on use.
- **Local reproduction:** `npm audit --json` and `npm audit --omit=dev --json` both exit 1 with the counts above.
- **Recommended fix:** Review each advisory and affected code path; upgrade in a branch with full tests, starting with `zod` and React Router major versions, then Prisma. Add `npm audit --omit=dev` to CI once CI exists. Do not blindly upgrade all packages.
- **Verification test:** Clean or explicitly accepted audit after upgrades; `npm test` and `npm run build` pass; route/validation smoke tests pass.
- **Status:** Open — no upgrades applied in Phase 1.

---

### SA-20 — No structured security logging, request IDs, or alerting

- **Severity:** Medium
- **OWASP:** A09 Logging & Alerting Failures
- **Affected code:** No central logger in `apps/api/src`; `apps/api/src/lib/errors.ts` handles errors without audit events; no `AuditLog` model in `apps/api/prisma/schema.prisma`.
- **Attack scenario:** Failed logins, approvals/rejections, role/status changes, price changes, payment decisions, file upload failures, and repeated authorization failures leave no durable, structured record. Incident investigation and detection are impossible.
- **Business impact:** Undetected abuse, inability to prove who changed what, weak incident response.
- **Local reproduction:** Trigger failed logins and an admin approval; grep application output for structured events/request IDs — none are produced.
- **Recommended fix:** Add structured JSON logs with request IDs; write security events to a dedicated append-only `AuditLog` table; alert on repeated 401/403/429 and admin actions. Never log passwords, tokens, reset links, or payment proof contents.
- **Verification test:** Test asserts log/event fields and absence of sensitive values; a simulated alert fires after repeated failures.
- **Status:** Open — new table would be a non-destructive migration requiring approval.

---

### SA-21 — Weak secret floor and long-lived session tokens

- **Severity:** Medium
- **OWASP:** A02 Cryptographic Failures; A07 Authentication Failures
- **Affected code:** `apps/api/src/lib/config.ts:43-46`; `apps/api/src/lib/auth.ts:16-25,36-44,100-102`.
- **Attack scenario:** `JWT_SECRET` is accepted at 16 characters, which is weak for HS256. Tokens live 7 days with no refresh rotation or server-side revocation list beyond `sessionVersion`.
- **Business impact:** Brute-force/offline secret guessing and long token replay windows.
- **Local reproduction:** Start with a 16-character JWT secret → startup succeeds; decode a token shows `exp` 7 days out.
- **Recommended fix:** Require at least 32 random bytes/characters for HS256 in production, shorten access-token lifetime, add rotating refresh tokens with reuse detection, or move to opaque server-side sessions.
- **Verification test:** Config rejects short secrets; token TTL matches policy; refresh replay is detected and revoked.
- **Status:** Open.

---

### SA-22 — Email enumeration and account-status disclosure

- **Severity:** Low
- **OWASP:** A07 Authentication Failures; API2 Broken Authentication
- **Affected code:** `apps/api/src/routes/auth.ts:23-32,49-53,69-75`.
- **Attack scenario:** Registration returns a specific conflict for existing emails. After a correct password, login distinguishes `PENDING` from `REJECTED`. Public user responses include `status`.
- **Business impact:** Privacy leakage and improved targeting for phishing/credential stuffing; low direct authorization impact.
- **Local reproduction:** Register duplicate vs new email; compare responses. Login correct password on pending vs rejected accounts; compare Arabic messages.
- **Recommended fix:** Use a uniform registration response for new and duplicate emails, avoid revealing status pre-authentication, and apply SA-01 limits. Keep the clear internal UX message for legitimate users after authentication where possible.
- **Verification test:** Duplicate/new registration responses are indistinguishable; unauthenticated callers cannot infer account state.
- **Status:** Open.

---

### SA-23 — Weak magic-byte validation and no upload quota/AV scanning

- **Severity:** Low
- **OWASP:** A03 Software Supply Chain Failures; A05 Security Misconfiguration
- **Affected code:** `apps/api/src/routes/uploads.ts:66-72,85-94`; `apps/api/src/routes/files.ts:57-62`.
- **Attack scenario:** PDF validation only checks `%PDF-`; MP4 checks `ftyp`; MP3 checks a frame-sync prefix. Polyglot files with valid prefixes and arbitrary payloads are accepted. No per-user/admin storage quota or AV scan exists.
- **Business impact:** Malware/polyglot hosting and storage exhaustion. Serving forces MIME and `nosniff`, which limits browser XSS but not downstream parser risk.
- **Local reproduction:** Upload `%PDF-1.4` followed by arbitrary HTML/JS → accepted; upload a valid `ftyp` prefix followed by arbitrary bytes → accepted.
- **Recommended fix:** Validate container structure/EOF and expected box/frame layout, add quotas and retention cleanup for orphaned files, and scan uploads with AV/sandbox in production. Serve downloads from a separate origin if feasible.
- **Verification test:** Truncated/polyglot payloads → 400; quota exceeded → 413/429; orphan cleanup verified.
- **Status:** Open.

---

### SA-24 — Course progress endpoint leaks structure metadata to unentitled students

- **Severity:** Low
- **OWASP:** API1 Broken Object Level Authorization
- **Affected code:** `apps/api/src/routes/student.ts:182-198`.
- **Attack scenario:** Endpoint requires only authentication. Any student can query any published course's lesson count (`total`) by changing the course ID; `completed` is their own data.
- **Business impact:** Minor content-structure enumeration and inconsistent entitlement handling.
- **Local reproduction:** Student token → `GET /api/student/courses/<unownedCourseId>/progress` → 200 with `total`.
- **Recommended fix:** Reuse `lessonAccess`/`accessMap` and return 403/404 when not enrolled, or move public metadata to catalog if intentionally public.
- **Verification test:** Unentitled student → 403; entitled student → 200 with correct counts.
- **Status:** Open.

---

### SA-25 — Demo seed prints credentials to console

- **Severity:** Low
- **OWASP:** A09 Logging & Alerting Failures
- **Affected code:** `apps/api/prisma/seed.ts:569-572`.
- **Attack scenario:** Seed output writes the admin and student credentials to stdout. Seed is gated to demo database names and non-production mode, but CI/dev console logs may be retained or shared.
- **Business impact:** Credential leakage into logs; full admin compromise if a seeded environment is exposed.
- **Local reproduction:** On a throwaway `samuel_academy_test` DB with explicit opt-in, seed and inspect stdout for credential text. (Not executed during this audit.)
- **Recommended fix:** Never print passwords; print only the admin email and “retrieve password from secret store”.
- **Verification test:** Capture seed stdout/stderr with a dummy password and assert the password string is absent.
- **Status:** Open.

---

### SA-26 — Temporary ngrok host is hardcoded in Vite `allowedHosts`

- **Severity:** Low
- **OWASP:** A05 Security Misconfiguration
- **Affected code:** `apps/web/vite.config.ts:4-16`.
- **Attack scenario:** The dev server always accepts `Host: reveler-disk-algebra.ngrok-free.dev`. Anyone controlling that hostname could point it at a victim's dev server during a trial.
- **Business impact:** Host-header/DNS-rebinding exposure in a dev server that may be connected to real data.
- **Local reproduction:** Request the dev server with the hardcoded host → accepted.
- **Recommended fix:** Remove the default entry; require `VITE_ALLOWED_HOSTS` explicitly for trials and remove it afterward. This was already the agreed temporary arrangement in `CLIENT_TRIAL_GUIDE.md`.
- **Verification test:** Default config contains no non-localhost allowed host; explicit env override still works for a temporary trial.
- **Status:** Open — deliberate temporary trial exception; remove after the trial.

---

### SA-27 — No password reset, recovery, or password-change flow

- **Severity:** Informational
- **OWASP:** A07 Authentication Failures
- **Affected code:** `README.md:215-223` explicitly postpones password reset; no reset model or route in `apps/api/src`.
- **Attack scenario:** No reset tokens exist today, so there is no reset-token reuse/expiry vulnerability. However, users cannot self-recover or rotate a compromised password, and there is no current-password reauthentication step.
- **Business impact:** Operational burden and slower incident recovery.
- **Recommended fix:** When implementing, use random single-use tokens stored hashed, short TTL, strict rate limits, and revoke all sessions on password change.
- **Verification test:** Reset token cannot be reused; expired token rejected; password change invalidates existing sessions.
- **Status:** Informational — no code change required in Phase 1.

---

### SA-28 — No CI, deployment baseline, or automated secret/dependency checks

- **Severity:** Informational
- **OWASP:** A03 Software Supply Chain Failures; A05 Security Misconfiguration
- **Affected code:** No `.github/workflows`, `Dockerfile`, `docker-compose*.yml`, or deployment manifest in the repository.
- **Attack scenario:** Security regressions and vulnerable dependencies can be merged without automated checks; production configuration relies on manual steps.
- **Business impact:** Inconsistent deployments and no enforceable security gate.
- **Local reproduction:** Repository file listing contains no CI/deployment files; only the local Git history was checked for secrets.
- **Recommended fix:** Add CI running `npm test`, `npm run build`, `npm audit --omit=dev`, and secret scanning; document a hardened deployment template with TLS, proxy limits, and trusted hosts.
- **Verification test:** CI fails on test/build/audit regressions; deployment checklist is exercised in staging.
- **Status:** Informational.

## 4. Controls verified as correctly implemented

| Control | Evidence |
|---|---|
| Explicit CORS origins; wildcard rejected with credentials | `apps/api/src/app.ts:19-28` |
| No-store API responses; private files also `private, no-store` and `nosniff` | `apps/api/src/app.ts:29-34`; `apps/api/src/routes/files.ts:57-62` |
| bcrypt cost 12, no plaintext passwords | `apps/api/src/routes/auth.ts:34-37`; `apps/api/scripts/bootstrap-admin.ts:26-28` |
| Generic wrong-email/wrong-password message | `apps/api/src/routes/auth.ts:49-52` |
| PENDING/REJECTED blocked server-side on every request | `apps/api/src/lib/auth.ts:85-88`; tests in `features.test.ts` |
| Roles read from database, not JWT claim | `apps/api/src/lib/auth.ts:118-127` |
| Admin route guards at router level | `apps/api/src/routes/admin.ts:10-12`; `apps/api/src/routes/uploads.ts:10-12` |
| Ownership checks on payments, grants, attempts | `apps/api/src/routes/payments.ts:90-99`; `apps/api/src/routes/student.ts:129-150`; `apps/api/src/routes/exams.ts:114-123` |
| Price always from database; client amount ignored | `apps/api/src/routes/payments.ts:63`; test in `security.test.ts` |
| Atomic payment approval and duplicate-approval protection | `apps/api/src/routes/admin.ts:626-667`; schema unique constraints |
| Random stored filenames, `wx` no-overwrite, DB-failure cleanup | `apps/api/src/routes/uploads.ts:38-53` |
| Path traversal guard on file reads | `apps/api/src/routes/files.ts:47-48` |
| Entitlement check and expired-grant exclusion on private files | `apps/api/src/routes/files.ts:28-45`; `apps/api/src/services/access.ts:6-15`; tests |
| No raw SQL in API source | static search for `$queryRaw`/`$executeRaw` variants returned none |
| Zod allowlists prevent mass assignment of role/status/price/score | `apps/api/src/routes/auth.ts:11-16`; `admin.ts`; `exams.ts:62` |
| Sensitive fields excluded from responses | `apps/api/src/routes/auth.ts:23-24`; `admin.ts` selects; `grading.ts:67-77` |
| Production config refuses demo mode, demo DB, missing admin credentials | `apps/api/src/lib/config.ts:48-87` |
| Demo login cards hidden when `demoMode:false` | `apps/web/src/pages/Login.tsx`, `Landing.tsx`; verified on temporary production server |
| No secrets tracked in Git history | tracked-file list and redacted history scan; only `*.env.example` tracked |

## 5. Phase 1 conclusion

No Critical finding was identified. Six High findings require remediation before any real student data, real payments, or public production deployment is allowed. The application is acceptable for the current controlled demo with known demo accounts and demo payment instructions, provided the temporary ngrok host is removed once the trial ends.

**No code, migration, seed, database data, or server process was changed during Phase 1.** Approval is required before Phase 2 fixes, especially for SA-11/SA-12/SA-20, which may need backward-compatible migrations or new tables.

---

## 6. Phase 2 remediation status (2026-11-25)

Approved P0 and code-only P1 fixes were applied after the Phase 1 report. A pre-change source backup was kept at `D:\Temp\opencode\samuel-academy-p0-backup-20261125-031500`. **No migration was applied**; `prisma/schema.prisma` and all migration files are unchanged in `git status`. No database was reset, deleted, reseeded, or recreated.

### 6.1 High findings after remediation

| Finding | Status | Evidence after fix |
|---|---|---|
| SA-01 rate limiting | **Fixed for the identified lockout defect; in-process caveat remains** | Deferred counting in `lib/rateLimit.ts` + `routes/auth.ts`: only failed logins increment; key is salted normalized-email hash plus hashed client IP; raw emails/IPs are not stored or logged. Tests prove successful logins do not count, email-only victim lockout across IPs is impossible, malformed values fail safely, 429 includes numeric `Retry-After`, and the window recovers. `trust proxy` stays disabled and `X-Forwarded-For` is not trusted in production. Caveat: buckets are per process and clear on restart; no CAPTCHA/escalating backoff. |
| SA-02 stolen portable token | **Fixed** | `apps/api/src/lib/auth.ts` requires the signed httpOnly device cookie for Bearer and cookie sessions; raw `X-Device-Id` is ignored. |
| SA-03 answer key / correctness oracle | **Oracle closed; attempt policy still partial** | `exams.ts` and new `services/examDisclosure.ts` never expose per-question `correct`, points, explanations, answer keys, or correct option text. Stored feedback is limited to `questionId`; student attempt list/detail and dashboard hide repeated-attempt scores. Only the earliest persisted attempt may show an overall score; repeated and concurrent duplicate submissions receive a receipt with no score or feedback. Grading remains server-side and first-attempt score assertions remain. Durable `maxAttempts`, deadline, and idempotency key still require the unapproved SA-11 migration. |
| SA-04 catalog URL leakage | **Fixed** | `catalog.ts` uses explicit `select` allowlists; anonymous regression asserts no `pdfUrl`, `videoUrl`, or `secret.pdf`. |
| SA-05 unpublished lesson files | **Fixed** | `files.ts` filters linked lessons by `isPublished` for non-admins; student gets 403, admin still 200. |
| SA-06 JWTs in file URLs | **Fixed** | `apps/web/src/lib/api.ts` no longer appends `?token=`; `fileToken.ts` issues 10-minute, file-scoped, device-bound `ftoken`; login tokens are rejected in URL query strings. |

### 6.2 Other findings after remediation

| Finding | Status | Notes |
|---|---|---|
| SA-07 spoofable `X-Device-Id` | **Fixed** | Only server-signed `sa_device` cookie is accepted. |
| SA-08 stale logout | **Fixed** | Conditional `updateMany` matches verified session version/device; regression added. |
| SA-09 course-level scope inflation | **Fixed** | Course files require subscription scope; catalog `unlocked` no longer inferred from lesson/unit grants; regression added. |
| SA-10 weak password policy | **Fixed** | API requires ≥12 chars and rejects email-derived/repetitive/common prefixes; registration UI updated. |
| SA-11 attempt limit/deadline/idempotency | **Open; oracle mitigated without migration** | 10-second duplicate guard and first-attempt-only disclosure prevent repeated answer probing, but `maxAttempts`, `startedAt`, and durable idempotency still require approved migration. |
| SA-12 global payment-reference uniqueness | **Partial** | Cross-user pre-check added and regression-tested; global unique index migration still deferred. |
| SA-13 pre-auth body buffering | **Fixed** | `requireAuth`/`requireAdmin` mounted before raw upload parsers. |
| SA-14 security headers | **Partial** | `Referrer-Policy`, `nosniff`, `X-Frame-Options`, `Permissions-Policy`, request IDs and production HSTS added; CSP intentionally not added yet. |
| SA-16 status-change session revocation | **Fixed** | Any student status change increments `sessionVersion` and clears device binding; reject→reactivate regression added. |
| SA-17 admin MFA | **Not fixed** | Owner decision required; no MFA table or step-up flow added. |
| SA-18 demo payment fallbacks | **Fixed** | Production requires `PAYMENT_INSTAPAY`/`PAYMENT_EWALLET` and rejects demo placeholders; config regression added. |
| SA-19 dependency advisories | **Not fixed; compensating controls added** | No packages upgraded. Zod array caps and error-detail caps added. All 7 advisories documented in `SECURITY-VERIFICATION.md`. |
| SA-20 structured logging/audit | **Partial** | Secret-free JSON events with request IDs written to stdout; no durable `AuditLog` table or alerting yet. |
| SA-21 secret floor / token TTL | **Partial** | Production now requires ≥32-character JWT secret; 7-day access-token TTL and refresh rotation unchanged. |
| SA-22 registration enumeration | **Partial** | Duplicate registration now returns a uniform response with no real account ID/phone; login still distinguishes status after a correct password by design. |
| SA-23–SA-28 | **Not fixed** | Upload polyglot/quota checks, progress metadata exposure, seed credential printing, temporary ngrok host, password recovery, CI/deployment baseline remain open. |

### 6.3 Files changed in Phase 2

- API source: `apps/api/src/app.ts`, `lib/auth.ts`, `lib/config.ts`, `lib/errors.ts`, `lib/fileToken.ts` (new), `lib/logging.ts` (new), `lib/rateLimit.ts` (new), `routes/admin.ts`, `routes/auth.ts`, `routes/catalog.ts`, `routes/exams.ts`, `routes/files.ts`, `routes/payments.ts`, `routes/student.ts`, `services/examDisclosure.ts` (new), `services/grading.ts`.
- API tests: `tests/admin-config.test.ts`, `tests/api.test.ts`, `tests/features.test.ts`, `tests/security.test.ts`, `tests/helpers.ts` (new).
- Web: `apps/web/src/lib/api.ts`, `apps/web/src/pages/Register.tsx`, `apps/web/src/pages/student/ExamPage.tsx`, `apps/web/src/pages/student/Results.tsx`.
- Config template: `apps/api/.env.example` (new production keys documented; no real secret values).

### 6.4 Remaining risk statement

The six High findings have code-level fixes and regression evidence. The SA-01 account-lockout defect and the SA-03 correctness oracle are now closed in code. The application is still **not production-ready**: SA-11/SA-12/SA-17/SA-20-related schema work is deferred, multi-instance/shared rate limiting is not implemented, CSP is absent, dependency majors are unreviewed, and the temporary trial host remains. No claim is made that the application is “fully secure”.
