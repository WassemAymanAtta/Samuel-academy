# Samuel Academy — Runnable MVP

A working Arabic-first (RTL) education platform with real server-side auth, role-based authorization, PostgreSQL storage, manual payment review, content access control, exams and progress tracking.

**Stack:** React + TypeScript + Vite + Tailwind CSS · Node.js + Express + TypeScript + Prisma + PostgreSQL.

## 1. Prerequisites

- Node.js 20+ (tested with Node 24)
- PostgreSQL 14+ running locally (tested with PostgreSQL 18)
- npm 11+ (tested with npm 11.16; Prisma/esbuild install scripts must be approved)

## 2. Setup

A working `.env` is already included for local demo use. To recreate it from the template:

```powershell
cd D:\samuel-academy
Copy-Item .env.example .env
Copy-Item .env.example apps\api\.env
```

Then install dependencies, approve the required build scripts and migrate:

```bash
npm run setup
# equivalent to: npm install && npm approve-scripts --all && npm run db:migrate
```

`npm run setup` no longer seeds automatically. Seeding is intentionally destructive and needs an explicit opt-in plus an allow-listed demo database name:

```bash
# Windows PowerShell
$env:ALLOW_DEMO_SEED='1'; npm run db:seed

# macOS / Linux
ALLOW_DEMO_SEED=1 npm run db:seed
```

The seed refuses to run in production, without `ALLOW_DEMO_SEED=1`, or when `DATABASE_URL` points to a database other than `samuel_academy` / `samuel_academy_test`.

The default local database URL is:

```
postgresql://samuel_app:samuel_demo_pass@127.0.0.1:5432/samuel_academy?schema=public
```

If you use a different PostgreSQL user/password, create two databases (`samuel_academy`, `samuel_academy_test`) and update `DATABASE_URL` and `TEST_DATABASE_URL` in `.env` and `apps/api/.env`.

Private PDF uploads use `UPLOAD_DIR` (default `apps/api/storage/uploads`, intentionally outside the frontend `public` folder) and `MAX_UPLOAD_BYTES` (default `20971520` = 20 MB). Both are configurable in `.env`.

## 3. Run

```bash
npm run dev
```

- Web app: **http://localhost:5173**
- API health check: **http://localhost:4000/api/health**

To run only one part:

```bash
npm run dev:api
npm run dev:web
```

For a temporary client trial over a tunnel, the web dev server currently allows the exact host `reveler-disk-algebra.ngrok-free.dev` (see `apps/web/vite.config.ts`). If the tunnel URL changes, start the web server with `VITE_ALLOWED_HOSTS="new-host.ngrok-free.dev"` and remove the default host again after the trial. The full click-through script is in `CLIENT_TRIAL_GUIDE.md`.

## 4. Demo accounts (all data is DEMO)

| Role | Email | Password |
|---|---|---|
| Student | `student@samuelacademy.com` | `Student@12345` |
| Admin / Teacher | `admin@samuelacademy.com` | `Admin@12345` |
| Extra student | `demo@samuelacademy.com` | `Demo@12345` |
| Pending student (login blocked) | `pending@samuelacademy.com` | `Pending@12345` |
| Rejected student (login blocked) | `rejected@samuelacademy.com` | `Rejected@12345` |

New registrations start as **PENDING**. They cannot log in or call protected APIs until an admin approves them from **Admin → طلبات التسجيل**. Rejected accounts are blocked server-side as well.

### Try the approval workflow

1. Open **http://localhost:5173/register** and create a student. You will see the `Pending` approval message and no session is created.
2. Try logging in with that account — access is denied with a clear Arabic message.
3. Log in as the admin, open **Admin → طلبات التسجيل**, and press **Approve · قبول**. The new student can now log in.
4. Press **Reject · رفض** on another request; that account stays blocked even if it had an older cookie. The seeded `rejected@samuelacademy.com` account demonstrates this immediately.

### Try PDF / video / audio uploads and external URLs

1. Log in as the admin and open **Admin → المواد → الكورسات / الوحدات / الدروس**, then edit an item.
2. Under **مصدر ملف PDF** (courses/units/lessons) or **مصدر الفيديو / المحاضرة** (lessons only), choose **رفع ملف**, pick a PDF / MP4 / MP3 from your device, and confirm the filename and size appear. Save; the backend validates MIME, magic bytes and size, then stores the file under `UPLOAD_DIR` (never in `apps/web/public`).
3. Alternatively choose **رابط خارجي** and enter an external URL. Supplying both sources for the same item is rejected.
4. Log in as `student@samuelacademy.com` (which has demo access) and open the lesson. Uploaded files are streamed from `/api/files/:id` (with HTTP range support for seeking); external links open directly. A student without access receives `403` from `/api/files/:id`.

Limits: `MAX_UPLOAD_BYTES` (PDF, default 20 MB) and `MAX_MEDIA_BYTES` (MP4/MP3, default 200 MB). Each browser tab keeps its own session token, so refreshing a tab no longer sends you to another account's dashboard after logging in elsewhere.

The lesson player spans the full content width (no 16:9 height cap for uploaded media) and has a **تكبير المشغّل** button for viewport-filling theater mode; press Escape or the same button to return. On small screens the dashboard sidebar is a slide-in drawer with a backdrop, and the bottom bar shows the main items plus **المزيد** for the rest. A short branded intro plays once per browser tab and is skipped automatically for users who prefer reduced motion.

Sample payment instructions (shown in the UI, configurable via env):

- InstaPay: `DEMO only - InstaPay alias: 01000000000 (do not send real money)`
- E-wallet: `DEMO only - Wallet: Vodafone Cash 01000000000 (do not send real money)`

**No real money should be sent.** The system never verifies InstaPay transfers automatically; an admin reviews each request manually. No payment credentials or banking secrets are stored.

## 5. Useful commands

```bash
npm run build          # builds API and web for production
npm test               # API tests (auth, approval, payments, uploads, access, security, single-device, PDF)
npm run db:migrate     # apply migrations to DATABASE_URL
npm run db:seed        # wipe and re-seed demo data (requires ALLOW_DEMO_SEED=1)
npm run db:reset       # reset database, migrations + seed
```

Tests use the separate `samuel_academy_test` database and apply migrations automatically. `JWT_SECRET` must be set to a long random value (no fallback secret); `WEB_ORIGIN` must be an explicit origin list (`*` is rejected because cookies are credentialed).

## 6. What is implemented

### Student
- Register / login / logout with httpOnly JWT cookie and bcrypt password hashing. New students are `PENDING` and see a clear approval message until activated.
- Browse subjects → courses → units → lessons (Arabic RTL, English technical terms LTR).
- Watch external videos or privately uploaded MP4/MP3 lessons inline, and open/download external or privately uploaded PDF resources (only with access).
- Locked lessons show relevant purchasable products instead of content.
- Mark lessons complete; course progress calculated from completed lessons.
- Take exams (MCQ, True/False, multiple select, short answer), get instant grading and feedback.
- View grades, purchased content, access expiry, and pending payment requests.
- Submit manual payment requests with InstaPay or e-wallet, reference and note; no client-side approval.

### Admin / Teacher
- Overview statistics and quick navigation.
- Student directory and per-student detail (grants, payments, attempts, completed lessons).
- Dedicated **Pending Students / طلبات التسجيل** page with name, email, registration date, account status, and Approve / Reject actions.
- Full CRUD for subjects, courses, units and lessons (external video URL **or** real MP4/MP3 upload, external PDF URL **or** real PDF upload, order, publishing).
- PDF/video/audio uploads are validated on the backend (magic bytes, MIME, `MAX_UPLOAD_BYTES` / `MAX_MEDIA_BYTES`), stored outside `apps/web/public`, and streamed only to authorised users through `/api/files/:id` with byte-range support.
- Exam and question management with option editors and validation.
- Product and price management for monthly/term/unit/lesson/exam-package products; prices come only from the database.
- Payment queue with approve/reject; approval automatically creates an `AccessGrant` with correct expiry (permanent when no duration).
- Student progress report (completion %, average exam score, last activity).

### Technical
- Zod server-side validation on all writes.
- `AccountStatus` enforced in `requireAuth`/`optionalAuth`: PENDING and REJECTED users cannot call protected APIs even with a stale cookie.
- Role checks enforced on every admin route; students receive 403 on admin APIs.
- Access decisions made on the server from `AccessGrant` rows — never from localStorage; private PDFs, videos and audio are checked against the same access map.
- Each tab stores its JWT in `sessionStorage` and sends it as a Bearer token; private file URLs append it as a query token because native `<video>`/`<audio>` elements cannot send headers.
- **One device per account:** `User.sessionVersion` + `sessionDeviceId` plus a `sa_device` cookie and `sv`/`did` claims in the JWT. A correct password on a second device is refused with `403`; signing in again from the same device invalidates its previous token; logout bumps the version, clears the binding and revokes old tokens immediately.
- **Dark mode:** class-based Tailwind theme with semantic CSS variables, `localStorage` persistence, system-preference fallback and no first-paint flash.
- Prisma migration + opt-in destructive demo seed (`ALLOW_DEMO_SEED=1` and an allow-listed database name required).
- CORS limited to `WEB_ORIGIN`, secure cookie flag in production, environment-based secrets.
- Modular backend (`lib`, `routes`, `services`) and page-based frontend structure.

## 7. Hierarchy and access rules

`Subject → Course → Unit → Lesson`, with exams attached to a unit or lesson.

A lesson is unlocked when the student has an active grant for:
- a monthly/term subscription global, for the subject, or for the course;
- the lesson's unit product; or
- that individual lesson product.

Exams additionally support a dedicated exam-package product. Expired grants no longer unlock content; grants without `durationDays` are permanent. Passing an exam is **not** required to open the next lesson.

## 8. Tests

`npm test` runs 22 tests:

1. Pending registration, blocked login, admin approval, then successful login
2. student blocked from admin API, admin allowed
3. pending payment does not unlock content; admin approval does; duplicate approval rejected
4. rejecting a payment does not grant access
5. expired subscription locked, active/permanent subscription unlocked
6. lesson completion updates course progress to 100%
7. rejecting a Pending account, blocking its login, and blocking protected APIs for Rejected users
8. only admins can change account status
9. backend PDF validation, admin-only upload, external URL update, and file access only for authorised students
10. MP4/MP3 validation, admin-only media upload, lesson linking, range streaming and access checks
11. public unit endpoint never returns external video/PDF URLs or unpublished lessons
12. unpublished lessons are 404 even for a purchaser
13. admin student/payment APIs never return password hashes
14. invalid enum filters return 400 instead of 500
15. duplicate payment references are rejected even when submitted concurrently
16. approval grants only the purchased product and a second review is rejected
17. lesson completion cannot be cleared without access
18. a query-string token is accepted only on private file routes
19. Pending students appear in the admin list and are blocked before approval
20. PDF upload and external URL can both be configured, and unauthorized students get `403` even with the direct file URL
21. a second device with the correct password is rejected, while the first device's token stays valid
22. logout revokes the old token immediately and clears the device binding

## 9. Deliberately postponed

- Real payment gateway / InstaPay verification (manual MVP only).
- Email/SMS notifications and password reset.
- Third-party video hosting/CDN (local MP4/MP3 upload and external URLs are both supported).
- Timed exam enforcement, question randomization, and manual grading of subjective essays.
- Discussion/comments, certificates, coupons, refunds, and multi-language (English UI).
- Rate limiting, audit logs, and production deployment configuration.
- A UI for admins to force-release another user's device binding, and exam attempt idempotency keys, are still open items (see `QA_REVIEW_REPORT.md`). Server-side logout revocation is implemented.

## 10. Project structure

```
apps/api/
  prisma/schema.prisma       # database schema and enums
  prisma/migrations/         # generated SQL migrations
  prisma/seed.ts             # demo data seed
  src/lib/                   # config, prisma, auth, errors, utils
  src/routes/                # auth, catalog, student, payments, exams, admin, uploads, files
  src/services/              # access rules, grading
  tests/api.test.ts          # auth, approval, payment, upload and access tests
apps/web/
  public/samuel-logo.png     # supplied logo asset
  src/components/            # UI kit, layouts, logo
  src/context/               # auth + theme contexts
  src/pages/student|admin/   # all functional screens
.env.example
```

## 11. Final verification (this machine)

The demo was started with `npm run dev` and last verified on **2026-11-25** after the QA/security fixes and the requested features:

- `npm run build` ✅ API + web production builds succeeded.
- `npm test` ✅ 22/22 tests passed (auth/RBAC, payments, access, uploads, 8 security regressions, single-device and PDF regressions).
- `npm run db:migrate` ✅ 6 migrations applied; no pending migrations.
- Pre-change source and DB snapshot are preserved under `D:\Temp\opencode\samuel-academy-backup-20261125-014426`; Math removal used the opt-in surgical script `apps/api/scripts/remove-math.ts`, not `db:reset`.
- `GET http://localhost:4000/api/health` → `{"ok":true,"service":"samuel-academy-api"}`.
- `GET http://localhost:5173/` → `200`; student login → `200`.
- Browser smoke checks passed for: landing, login, student dashboard, catalog, course, lesson, purchases (payment request + admin approval), exam (100% / 6/6 + feedback), results, and all admin pages (`/admin`, students, content, exams, products, payments, progress).
- No application console errors were observed after authentication; `401` before login is the expected unauthenticated `/api/auth/me` check.

**Live app:** http://localhost:5173 · Demo credentials are listed in section 4.
