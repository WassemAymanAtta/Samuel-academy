import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { asyncHandler, conflict, forbidden, unauthorized } from '../lib/errors';
import { accountStatusError, deviceIdFrom, setAuthCookie, signToken, requireAuth } from '../lib/auth';
import { prisma } from '../lib/prisma';
import { config } from '../lib/config';

export const authRouter = Router();

const registerSchema = z.object({
  name: z.string().trim().min(2, 'الاسم قصير جداً').max(80),
  email: z.string().trim().toLowerCase().email('بريد إلكتروني غير صالح'),
  password: z.string().min(8, 'كلمة المرور يجب أن تكون 8 أحرف على الأقل').max(100),
  phone: z.string().trim().max(30).optional().nullable(),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

function publicUser(user: { id: string; name: string; email: string; role: string; phone: string | null; status: string }) {
  return { id: user.id, name: user.name, email: user.email, role: user.role, phone: user.phone, status: user.status };
}

authRouter.post(
  '/register',
  asyncHandler(async (req, res) => {
    const data = registerSchema.parse(req.body);
    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing) throw conflict('هذا البريد مسجل بالفعل');

    const { password, ...profile } = data;
    const user = await prisma.user.create({
      data: { ...profile, status: 'PENDING', passwordHash: await bcrypt.hash(password, 12) },
    });
    res.status(201).json({
      user: publicUser(user),
      message: 'تم إنشاء حسابك. سيتم تفعيله بعد موافقة الإدارة.',
    });
  }),
);

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const data = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: data.email } });
    if (!user || !(await bcrypt.compare(data.password, user.passwordHash))) {
      throw unauthorized('البريد أو كلمة المرور غير صحيحة');
    }
    if (user.status !== 'ACTIVE') throw accountStatusError(user.status);

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
    setAuthCookie(res, token);
    res.json({ user: publicUser(fresh), token });
  }),
);

authRouter.post(
  '/logout',
  requireAuth,
  asyncHandler(async (req, res) => {
    await prisma.user.update({
      where: { id: req.user!.id },
      data: { sessionVersion: { increment: 1 }, sessionDeviceId: null },
    });
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
