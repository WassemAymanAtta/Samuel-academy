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
 * The server-side sessionVersion still limits the account to one active device.
 */
function tokenFrom(req: Request): string | undefined {
  const header = req.header('authorization');
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  // <video>/<audio>/<a download> cannot send headers; they carry the tab token as
  // a query parameter instead. This is only accepted by the private file route.
  const queryToken = req.query?.token;
  if (typeof queryToken === 'string' && req.originalUrl.startsWith('/api/files/')) return queryToken;
  return req.cookies?.[config.cookieName] as string | undefined;
}

/** A stable, non-authorising device ID set by the API middleware. */
export function deviceIdFrom(req: Request): string | undefined {
  const header = req.header('x-device-id');
  if (header?.trim()) return header.trim().slice(0, 64);
  const cookie = req.cookies?.[config.deviceCookieName];
  return typeof cookie === 'string' && cookie.trim() ? cookie.trim().slice(0, 64) : undefined;
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

    const payload = jwt.verify(token, config.jwtSecret) as { sub?: string; sv?: unknown; did?: unknown };
    if (!payload.sub) throw unauthorized();

    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) throw unauthorized();
    if (!sessionIsCurrent(payload, user)) throw sessionExpired();
    if (user.status !== 'ACTIVE') throw accountStatusError(user.status);

    req.user = user;
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
      const payload = jwt.verify(token, config.jwtSecret) as { sub?: string; sv?: unknown; did?: unknown };
      if (payload.sub) {
        const user = await prisma.user.findUnique({ where: { id: payload.sub } });
        if (user?.status === 'ACTIVE' && sessionIsCurrent(payload, user)) req.user = user;
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
