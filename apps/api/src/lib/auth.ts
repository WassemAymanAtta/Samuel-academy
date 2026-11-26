import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { AccountStatus, Role, User } from '@prisma/client';
import { config } from './config';
import { prisma } from './prisma';
import { unauthorized, forbidden } from './errors';

declare global {
  namespace Express {
    interface Request {
      user?: User;
      session?: { version: number; deviceId: string | null };
    }
  }
}

export function signToken(
  user: Pick<User, 'id' | 'role'>,
  sessionVersion = 0,
  deviceId: string | null = null,
): string {
  return jwt.sign(
    { sub: user.id, role: user.role, sv: sessionVersion, did: deviceId },
    config.jwtSecret,
    { expiresIn: '7d' },
  );
}

/** Accept a token only while it matches the account's current version and bound device. */
function sessionIsCurrent(payload: { sv?: unknown; did?: unknown }, user: User): boolean {
  const tokenDeviceId = typeof payload.did === 'string' ? payload.did : null;
  return typeof payload.sv === 'number' && payload.sv === user.sessionVersion && tokenDeviceId === user.sessionDeviceId;
}

const sessionExpired = () => unauthorized('تم تسجيل الدخول من جهاز آخر، يرجى تسجيل الدخول مرة أخرى');

export function setAuthCookie(res: Response, token: string) {
  res.cookie(config.cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: config.cookieMaxAge,
    path: '/',
  });
}

/**
 * A tab that logs in stores its token in sessionStorage and sends it as a Bearer
 * header. The shared httpOnly cookie is the fallback for native media/file links.
 * Tokens are never accepted from URLs: a token in browser history or a proxy log
 * is a leaked credential, not a media helper.
 */
function tokenFrom(req: Request): string | undefined {
  const header = req.header('authorization');
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  return req.cookies?.[config.cookieName] as string | undefined;
}

function deviceKey() {
  return createHmac('sha256', config.jwtSecret).update('samuel-device-proof-v1').digest();
}

/** Server-issued, HMAC-protected value for the httpOnly device cookie. */
export function deviceCookieValue(deviceId: string): string {
  const signature = createHmac('sha256', deviceKey()).update(deviceId).digest('base64url');
  return `${deviceId}.${signature}`;
}

function verifiedDeviceId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const separator = value.lastIndexOf('.');
  if (separator < 1) return undefined;
  const id = value.slice(0, separator).trim().slice(0, 64);
  const signature = value.slice(separator + 1);
  const expected = createHmac('sha256', deviceKey()).update(id).digest('base64url');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return undefined;
  return id;
}

/**
 * Device proof is the signed httpOnly cookie only. A raw X-Device-Id header is
 * client-controlled and is deliberately ignored; it previously allowed a stolen
 * password plus a known ID to take over a session from another machine.
 */
export function deviceIdFrom(req: Request): string | undefined {
  return verifiedDeviceId(req.cookies?.[config.deviceCookieName]);
}

export function accountStatusError(status: AccountStatus) {
  return forbidden(
    status === 'PENDING'
      ? 'حسابك قيد المراجعة ويحتاج موافقة الإدارة قبل تسجيل الدخول'
      : 'تم رفض حسابك، تواصل مع الإدارة لمعرفة السبب',
  );
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = tokenFrom(req);
    if (!token) throw unauthorized();

    const payload = jwt.verify(token, config.jwtSecret) as {
      sub?: string;
      sv?: unknown;
      did?: unknown;
      purpose?: unknown;
    };
    if (!payload.sub || payload.purpose) throw unauthorized();

    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) throw unauthorized();
    // Report the account state first so suspended users get a clear 403. The
    // session checks still revoke that token even if the account is reactivated.
    if (user.status !== 'ACTIVE') throw accountStatusError(user.status);
    if (!sessionIsCurrent(payload, user)) throw sessionExpired();
    if (
      config.sessionBindingEnabled &&
      user.sessionDeviceId &&
      deviceIdFrom(req) !== user.sessionDeviceId
    ) throw sessionExpired();

    req.user = user;
    req.session = { version: user.sessionVersion, deviceId: user.sessionDeviceId };
    next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
      next(unauthorized('انتهت الجلسة، يرجى تسجيل الدخول مرة أخرى'));
    } else {
      next(error);
    }
  }
}

/** Attaches the user when a valid cookie exists, but never blocks the request. */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = tokenFrom(req);
    if (token) {
      const payload = jwt.verify(token, config.jwtSecret) as {
        sub?: string;
        sv?: unknown;
        did?: unknown;
        purpose?: unknown;
      };
      if (payload.sub) {
        const user = await prisma.user.findUnique({ where: { id: payload.sub } });
        if (
          user?.status === 'ACTIVE' &&
          !payload.purpose &&
          sessionIsCurrent(payload, user) &&
          (!config.sessionBindingEnabled ||
            !user.sessionDeviceId ||
            deviceIdFrom(req) === user.sessionDeviceId)
        ) {
          req.user = user;
          req.session = { version: user.sessionVersion, deviceId: user.sessionDeviceId };
        }
      }
    }
    next();
  } catch {
    next();
  }
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
}

export const requireAdmin = requireRole('ADMIN');
export const requireStudent = requireRole('STUDENT');
