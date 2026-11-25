import { createHash, randomUUID } from 'node:crypto';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { asyncHandler, forbidden, unauthorized } from '../lib/errors';
import { accountStatusError, deviceIdFrom, setAuthCookie, signToken, requireAuth } from '../lib/auth';
import { prisma } from '../lib/prisma';
import { config } from '../lib/config';
import { ipHash, securityEvent } from '../lib/logging';
import { recordFailedLogin } from '../lib/rateLimit';

export const authRouter = Router();

const registerSchema = z
  .object({
    name: z.string().trim().min(2, 'الاسم قصير جداً').max(80),
    email: z.string().trim().toLowerCase().email('بريد إلكتروني غير صالح'),
    password: z.string().min(12, 'كلمة المرور يجب أن تكون 12 حرفاً على الأقل').max(100),
    phone: z.string().trim().max(30).optional().nullable(),
  })
  .superRefine((data, ctx) => {
    const local = data.email.split('@')[0] ?? '';
    if (local.length > 2 && data.password.toLowerCase().includes(local.toLowerCase())) {
      ctx.addIssue({ code: 'custom', path: ['password'], message: 'كلمة المرور يجب ألا تحتوي على بريدك الإلكتروني' });
    }
    if (/(.)\1{3,}/.test(data.password)) {
      ctx.addIssue({ code: 'custom', path: ['password'], message: 'كلمة المرور تحتوي على تكرار غير آمن' });
    }
    if (/^(password|admin|1234|abcd|qwerty|student)/i.test(data.password)) {
      ctx.addIssue({ code: 'custom', path: ['password'], message: 'كلمة المرور متوقعة وضعيفة' });
    }
  });

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

function hashEmail(email: string) {
  return createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 16);
}

function publicUser(user: { id: string; name: string; email: string; role: string; phone: string | null; status: string }) {
  return { id: user.id, name: user.name, email: user.email, role: user.role, phone: user.phone, status: user.status };
}

authRouter.post(
  '/register',
  asyncHandler(async (req, res) => {
    const data = registerSchema.parse(req.body);
    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing) {
      securityEvent('register_duplicate', req, { emailHash: hashEmail(data.email), ipHash: ipHash(req) });
      // Same response as a new registration: do not let anonymous callers
      // enumerate which email addresses already have accounts.
      return res.status(201).json({
        user: { id: randomUUID(), name: data.name, email: data.email, role: 'STUDENT', phone: data.phone ?? null, status: 'PENDING' },
        message: 'تم إنشاء حسابك. سيتم تفعيله بعد موافقة الإدارة.',
      });
    }

    const { password, ...profile } = data;
    const user = await prisma.user.create({
      data: { ...profile, status: 'PENDING', passwordHash: await bcrypt.hash(password, 12) },
    });
    securityEvent('register', req, { userId: user.id, emailHash: hashEmail(user.email), ipHash: ipHash(req) });
    res.status(201).json({
      user: publicUser(user),
      message: 'تم إنشاء حسابك. سيتم تفعيله بعد موافقة الإدارة.',
    });
  }),
);

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    let data: { email: string; password: string };
    try {
      data = loginSchema.parse(req.body);
    } catch (error) {
      // Malformed attempts are still failed attempts for the IP/deferred limiter.
      recordFailedLogin(req);
      throw error;
    }
    const user = await prisma.user.findUnique({ where: { email: data.email } });
    if (!user || !(await bcrypt.compare(data.password, user.passwordHash))) {
      recordFailedLogin(req);
      securityEvent('login_failed', req, { reason: 'invalid_credentials', emailHash: hashEmail(data.email), ipHash: ipHash(req) });
      throw unauthorized('البريد أو كلمة المرور غير صحيحة');
    }
    if (user.status !== 'ACTIVE') {
      securityEvent('login_failed', req, { reason: `status_${user.status}`, userId: user.id, ipHash: ipHash(req) });
      throw accountStatusError(user.status);
    }

    // Bind the account to the first device that signs in. A correct password on a
    // different device cannot take over the account or reach paid content.
    const deviceId = deviceIdFrom(req);
    if (!deviceId) throw unauthorized('تعذّر تحديد الجهاز، حاول مرة أخرى');
    if (user.sessionDeviceId && user.sessionDeviceId !== deviceId) {
      throw forbidden('هذا الحساب مسجل الدخول من جهاز آخر. سجّل الخروج من الجهاز الأول أو تواصل مع الإدارة');
    }

    // Bump the server-side counter first, then mint a token for that version/device.
    // Re-login from the same device invalidates the previous token on that device.
    const fresh = await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { sessionVersion: { increment: 1 }, sessionDeviceId: deviceId },
      });
      return tx.user.findUniqueOrThrow({ where: { id: user.id } });
    });
    const token = signToken(fresh, fresh.sessionVersion, deviceId);
    securityEvent('login_success', req, { userId: fresh.id, role: fresh.role, ipHash: ipHash(req) });
    setAuthCookie(res, token);
    res.json({ user: publicUser(fresh), token });
  }),
);

authRouter.post(
  '/logout',
  requireAuth,
  asyncHandler(async (req, res) => {
    const session = req.session!;
    // Only revoke the session represented by this token. A stale token must not
    // be able to log out a newer session created by a re-login on the same device.
    const updated = await prisma.user.updateMany({
      where: {
        id: req.user!.id,
        sessionVersion: session.version,
        sessionDeviceId: session.deviceId,
      },
      data: { sessionVersion: { increment: 1 }, sessionDeviceId: null },
    });
    if (updated.count !== 1) throw unauthorized('الجلسة انتهت بالفعل، يرجى تسجيل الدخول مرة أخرى');
    securityEvent('logout', req, { userId: req.user!.id });
    res.clearCookie(config.cookieName, { path: '/' });
    res.clearCookie(config.deviceCookieName, { path: '/' });
    res.json({ ok: true });
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ user: publicUser(req.user!) });
  }),
);

authRouter.get(
  '/config',
  asyncHandler(async (_req, res) => {
    res.json({
      demoMode: config.demoMode,
      paymentDetails: config.paymentDetails,
      maxUploadBytes: config.maxUploadBytes,
      maxMediaBytes: config.maxMediaBytes,
    });
  }),
);
