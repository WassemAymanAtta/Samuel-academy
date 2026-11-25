# Samuel Academy — Security Threat Model (Phase 1)

**Date:** 2026-11-25  
**Scope:** React/Vite web app, Express API, PostgreSQL/Prisma database, private upload storage, manual payment workflow, dev/tunnel deployment.  
**Status:** Phase 1 model from read-only review, updated with Phase 2 post-remediation notes in Section 7.

## 1. System boundary and trust zones

```text
[Internet / untrusted visitor]
        |
        | HTTPS / ngrok (temporary) / localhost
        v
[Browser: React SPA]
  - sessionStorage JWT (tab-scoped)
  - sa_token httpOnly cookie (fallback)
  - sa_device signed httpOnly cookie (authorising device proof after Phase 2)
        |
        | JSON API + Bearer/cookie + signed device cookie; file-only ftoken capability
        v
[Express API]
  - CORS allowlist
  - Zod validation
  - requireAuth / optionalAuth / requireAdmin / requireStudent
  - grading, access, payment services
        |
        v
[PostgreSQL]        [Private upload directory]
  - users/roles       - PDFs, MP4, MP3
  - grades            - random stored filenames
  - payments          - no direct public web-root access
  - grants
```

### Trust boundaries

| Boundary | What crosses it | Current enforcement |
|---|---|---|
| Browser → API | Login/register, protected API calls, file downloads | Explicit CORS, bounded Zod, Bearer/cookie + signed device proof, rate limits, server-side role/status/entitlement checks |
| API → Database | All persistent state | Prisma parameterized queries; no raw SQL found; transactional payment approval |
| API → Upload storage | PDF/MP4/MP3 bytes | Admin-only router, size limits, MIME + prefix checks, random names, path-prefix check |
| Public catalog → student | Course/unit/lesson metadata | `optionalAuth`; metadata-only selects partially applied (gaps SA-04/SA-05) |
| Admin → sensitive operations | Approvals, prices, status, content publication | `requireAdmin`; no MFA or step-up auth yet (SA-17) |

## 2. Actors

| Actor | Capabilities | Security expectations | Relevant findings |
|---|---|---|---|
| Unauthenticated visitor | Landing, register, login, public catalog | Cannot see private URLs, grades, payments, or unpublished content | SA-04, SA-13, SA-14 |
| Pending student | Registered, awaiting approval | No session; no protected API access | Correctly blocked; SA-22 status disclosure |
| Rejected student | Account denied | No session; old tokens must stay invalid | SA-16 |
| Active student | Browse unlocked catalog, submit payment, take exams, view own grades/progress | Ownership enforced; cannot approve payments or access others' data | SA-03, SA-06, SA-09, SA-11, SA-24 |
| Malicious authenticated student | Same API access plus intentional abuse | Cannot manipulate prices/roles/scores, leak answer keys, bypass entitlements, or flood endpoints | SA-01, SA-03, SA-09, SA-11, SA-12 |
| Admin / Teacher | Full content, payments, students, products, grades | Trusted but still audited; MFA/step-up expected for sensitive operations | SA-15, SA-17, SA-20 |
| Compromised Admin account | Attacker with admin credentials/session | Blast radius must be limited by MFA, reauth, audit logs, and session revocation | SA-02, SA-17, SA-20 |
| External attacker | Network attacker, credential-stuffer, scanner | Rate limits, headers, no secret leakage, no host-header abuse | SA-01, SA-06, SA-14, SA-26 |
| Malicious uploaded file | PDF/MP4/MP3 polyglot or malware | Cannot execute in app origin, overwrite files, or traverse paths | SA-23; controls partially present |
| Compromised dependency / third party | Malicious npm update, tunnel provider, DB/ hosting provider | Minimal privilege, pinned/reviewed updates, no secret exposure | SA-19, SA-26 |

> **Teacher note:** there is no separate `TEACHER` role in the schema. `ADMIN` is the combined admin/teacher role, so teacher compromise equals full administrative compromise.

## 3. Sensitive assets

| Asset | Where it lives | Current protection | Gaps |
|---|---|---|---|
| Password hashes | PostgreSQL `User.passwordHash` | bcrypt cost 12; excluded from API responses | Weak student password policy (SA-10) |
| Auth tokens / sessions | `sessionStorage`, `sa_token` cookie, JWT claims | HttpOnly cookie fallback, 7-day expiry, `sessionVersion`, device claim | Portable Bearer token (SA-02), device spoof (SA-07), stale logout (SA-08), tokens in URLs (SA-06), long TTL (SA-21) |
| Student personal information | `User` name/email/phone | Admin-only directory; Zod field allowlist | Email/status disclosure (SA-22), no audit log (SA-20) |
| Grades and exam answers | `ExamAttempt`, `Question`, `AnswerOption` | Backend grading, question payload strips correct flags | Answer key returned after attempt (SA-03), unlimited retries/time ignored (SA-11) |
| Payment references and proofs | `PaymentRequest` note/reference | Ownership filters; manual review; DB price | Global reference reuse (SA-12), no audit log (SA-20) |
| Private lessons/PDFs/media | Upload directory + `FileAsset` | Entitlement checks, random filenames, path guard, nosniff | Unpublished lesson files (SA-05), external PDF URL leakage (SA-04), course-level scope inflation (SA-09), polyglots (SA-23) |
| Admin actions | API routes | `requireAdmin` | No structured audit trail (SA-20), no MFA (SA-17) |
| Database credentials | `.env`, `.env.production` (gitignored) | `.gitignore`, startup validation | No automated secret scanning in CI (SA-28) |
| JWT/session secrets | Environment | Required, placeholder check | Only 16-char floor in non-production (SA-21) |
| Uploaded files | `apps/api/storage/uploads` | Outside web public root, excluded from Git | No quota/AV/orphan cleanup (SA-23) |
| Backup files | Local backup directory outside repo | Manual backup exists | Restore not tested; no documented rotation (see `SECURITY-OPERATIONS.md`) |

## 4. Attack scenarios

### AS-1 — Credential stuffing against a student
1. Attacker uses leakedemail/password lists against `/api/auth/login`.
2. No rate limit or lockout exists. Each attempt triggers bcrypt.
3. A weak 8-character password from SA-10 succeeds.
4. Attacker receives a valid 7-day JWT. Because SA-02 does not verify device proof on API calls and SA-06 may expose the token in URLs, the attacker can use it from any device.

**Impact:** Account takeover, paid content access, grade/payment disclosure.  
**Mitigations to add:** SA-01, SA-02, SA-07, SA-10, SA-21.

### AS-2 — Exam grade forgery
1. Student buys or is granted an exam package.
2. Student submits empty answers.
3. Response reveals correct option IDs/texts and stored short answers (SA-03).
4. Student resubmits correct answers; no attempt limit or deadline exists (SA-11).
5. Grade and `passed` become unreliable.

**Impact:** Academic integrity failure and revenue legitimacy loss.  
**Mitigations to add:** SA-03, SA-11.

### AS-3 — Anonymous paid-PDF retrieval
1. Attacker calls `/api/catalog/subjects/:id` or `/api/catalog/courses/:id` anonymously.
2. Course/unit scalars are spread into JSON, including external `pdfUrl` values (SA-04).
3. Attacker downloads the PDF directly, bypassing purchase and `/api/files/:id` entitlement checks.

**Impact:** Direct content revenue loss.  
**Mitigations to add:** SA-04.

### AS-4 — Unreleased material via private file ID
1. Admin links a PDF to an unpublished lesson.
2. Student with a unit/lesson grant learns or guesses the file ID.
3. `/api/files/:id` authorizes against all lessons without checking `isPublished` (SA-05).
4. File bytes are returned even though the catalog returns 404 for that lesson.

**Impact:** Publication control bypass.  
**Mitigations to add:** SA-05.

### AS-5 — Partial purchase unlocks whole-course asset
1. Student buys a single lesson product.
2. `accessMap()` adds the parent course to `accessibleCourses` (SA-09).
3. Course-level PDF is approved by `map.courses.has(course.id)`.
4. Student downloads a whole-course PDF.

**Impact:** Entitlement mismatch and revenue loss.  
**Mitigations to add:** SA-09.

### AS-6 — Token leakage through media URL/log
1. Lesson page renders `<video src="/api/files/:id?token=<JWT>">` (SA-06).
2. Reverse proxy logs the full URL; browser history retains it.
3. Attacker reads the token and calls `/api/admin/...` or `/api/student/dashboard` with it.
4. Because device proof is not checked after login (SA-02), the token works remotely.

**Impact:** Session hijacking, admin compromise if admin token leaks.  
**Mitigations to add:** SA-06, SA-02, SA-14, SA-21.

### AS-7 — Duplicate payment reference fraud
1. Two students submit the same transfer reference.
2. Unique constraint is per-user, so both requests are accepted (SA-12).
3. Admin approves both without a collision warning.
4. Two access grants are created from one real transfer.

**Impact:** Revenue loss.  
**Mitigations to add:** SA-12, SA-20.

### AS-8 — Anonymous upload memory exhaustion
1. Attacker sends repeated 200 MB bodies to `/api/admin/uploads/media` without credentials.
2. Express raw parser buffers each body before auth (SA-13).
3. Process memory/bandwidth is exhausted; legitimate students are denied service.

**Impact:** Availability loss.  
**Mitigations to add:** SA-13, SA-01.

### AS-9 — Compromised admin account
1. Admin password is phished; no MFA exists (SA-17).
2. Attacker logs in and receives a portable 7-day token (SA-02).
3. Attacker approves fraudulent payments, changes prices/status, and exports student data.
4. No structured audit log exists to reconstruct the incident (SA-20).

**Impact:** Full platform compromise.  
**Mitigations to add:** SA-17, SA-02, SA-20, SA-21.

### AS-10 — Malicious uploaded file
1. Admin/teacher account uploads a PDF with a valid `%PDF-` prefix but malicious trailing content (SA-23).
2. File is stored with random UUID and served with forced MIME + `nosniff`, limiting browser execution.
3. If downloaded and opened locally, downstream parser risk remains; storage has no quota/AV.

**Impact:** Endpoint malware distribution or storage exhaustion.  
**Mitigations to add:** SA-23 and existing path/MIME controls.

### AS-11 — Compromised dependency or tunnel host
1. A vulnerable Prisma/Zod/React Router version is exploited in build or runtime (SA-19).
2. Or the temporary ngrok hostname is controlled by another party while the dev server still allows it (SA-26).
3. Attacker reaches a dev server possibly connected to real data and bypasses intended trust boundaries.

**Impact:** Supply-chain compromise or host-header/DNS-rebinding exposure.  
**Mitigations to add:** SA-19, SA-26, SA-28.

## 5. Trust assumptions that must not be made

- Frontend route guards are not an authorization boundary; all checks must remain server-side.
- `sessionStorage` is not protected from XSS; a Bearer token there is bearer credentials.
- `sa_device` is now the server-signed authorising device proof; a copied cookie value without the valid HMAC signature is rejected.
- Client-supplied `X-Device-Id` is not proof of device possession and is ignored.
- A file `ftoken` is a capability for one file only, not a login credential.
- Client-submitted `score`, `passed`, `role`, `status`, `price`, or `amountCents` must never be trusted.
- A published catalog entry does not imply the student has paid; entitlement must be checked separately.
- Manual payment approval is not automatic bank verification and must remain explicitly documented as manual.

## 6. Model maintenance

Revisit this model after Phase 2/3 remediation, when MFA, rate limiting, file tokens, audit logging, and any new migrations are implemented. Update attack scenarios with verification evidence from `SECURITY-VERIFICATION.md`.

---

## 7. Post-remediation model update (2026-11-25)

Phase 2 changed the trust boundary in these ways:

- Device proof is now a server-signed httpOnly cookie; a Bearer token or session cookie alone is insufficient.
- Login JWTs never appear in file/media URLs; only a 10-minute `ftoken` capability may appear in the query string, and it is scoped to one file and one session/device.
- Rate limits now count only failed logins, use salted email/IP-hash composites, and no longer allow email-only victim lockout; they remain in-process and proxy-dependent.
- Exam responses expose no correctness oracle: stored feedback is `questionId` only and only the earliest persisted attempt shows an overall score.
- Security headers, request IDs, and secret-free JSON security events now exist at the API boundary.
- Student status changes revoke sessions; logout is conditional on the presented session version/device.
- Catalog responses use allowlists; file authorization checks publication and subscription scope.

| Scenario | Post-remediation state | Residual risk |
|---|---|---|
| AS-1 credential stuffing / victim lockout | Failed-attempt-only limits keyed by salted email hash + IP hash; successful logins never consume budget; signed device proof | In-process limiter only and clears on restart; proxy IP configuration required; no CAPTCHA/escalating backoff; same-browser XSS still possible |
| AS-2 grade forgery / answer probing | No per-question correctness in responses or stored feedback; repeated/concurrent attempts reveal no score; only earliest attempt shows overall score | Durable attempt/deadline/idempotency migration deferred; admin-authored question text may still reveal answers |
| AS-3 anonymous paid-PDF retrieval | Subject/course/unit selects are metadata-only | Admin-authored description text is still public by design |
| AS-4 unreleased material via file ID | Non-admin file access requires published linked lesson | Admin path intentionally still allows unpublished files |
| AS-5 partial purchase unlocks course asset | Course files and catalog `unlocked` require subscription scope | Lesson/unit metadata remains visible as public catalog data |
| AS-6 token leakage through media URL | No login JWT in URLs; file-scoped expiring `ftoken` | `ftoken` is still a URL capability for 10 minutes and cannot be revoked early; logs should strip it |
| AS-7 duplicate payment reference | Cross-user application-level pre-check + regression test | Race window until global unique index migration is approved |
| AS-8 anonymous upload memory exhaustion | Auth/admin checks run before raw parsers; IP limits added | No proxy-level body/concurrency limits in repository |
| AS-9 compromised admin account | Portable token replay blocked; status changes revoke sessions | No MFA, step-up auth, durable audit log, or alerting |
| AS-10 malicious uploaded file | Unchanged path/MIME/nosniff controls | No stronger container validation, quota, AV, or orphan cleanup |
| AS-11 dependency/tunnel host | Zod array caps and error-detail caps added | All 7 advisories remain by version; temporary ngrok host still allowed |

No migration was applied and no production deployment was made. The model must be revisited again if SA-11/SA-12/SA-17/SA-20 migrations, MFA, CSP, shared rate-limit storage, or dependency upgrades are approved.
