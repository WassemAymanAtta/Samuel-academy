import { createHash } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { config } from './config';
import { securityEvent } from './logging';

type Bucket = { count: number; resetAt: number };
type LimitOptions = {
  name: string;
  windowMs: number;
  max: number;
  key: (req: Request) => string;
  message?: string;
};

// In-memory only: see the limitation note in SECURITY-OPERATIONS.md.
const buckets = new Map<string, Bucket>();
const pendingFailures = new WeakMap<Request, Array<() => void>>();
let clock = () => Date.now();

export function resetRateLimits() {
  buckets.clear();
}

/** Test-only helpers; never exposed through HTTP. */
export function rateLimitKeysForTest(): string[] {
  return [...buckets.keys()];
}

export function setRateLimitClockForTest(next: () => number) {
  clock = next;
}

export function resetRateLimitClockForTest() {
  clock = () => Date.now();
}

function clientIp(req: Request): string {
  const raw = req.ip || req.socket.remoteAddress || 'unknown';
  return raw.startsWith('::ffff:') ? raw.slice(7) : raw;
}

/** Salted hash: rate-limit keys and logs must not contain raw IPs or emails. */
function clientIpKey(req: Request): string {
  return createHash('sha256').update(`${config.jwtSecret}:${clientIp(req)}`).digest('hex').slice(0, 24);
}

function emailKey(req: Request): string {
  const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
  const raw = body.email;
  if (typeof raw !== 'string') return 'invalid';
  const email = raw.trim().toLowerCase();
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'invalid';
  return createHash('sha256').update(`${config.jwtSecret}:${email}`).digest('hex').slice(0, 24);
}

function removeExpired(now: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

function setHeaders(res: Response, options: LimitOptions, bucket: Bucket, now: number) {
  res.set('RateLimit-Limit', String(options.max));
  res.set('RateLimit-Remaining', String(Math.max(0, options.max - bucket.count)));
  res.set('RateLimit-Reset', String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
}

function reject(res: Response, options: LimitOptions, resetSeconds: number) {
  res.set('Retry-After', String(resetSeconds));
  return res.status(429).json({
    error: {
      code: 'RATE_LIMITED',
      message: options.message ?? 'طلبات كثيرة جداً، حاول مرة أخرى بعد قليل',
    },
  });
}

/** Eager limiter for non-authentication routes (register, payments). */
export function rateLimit(options: LimitOptions): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const now = clock();
    removeExpired(now);

    const key = `${options.name}:${options.key(req)}`;
    const bucket = buckets.get(key) ?? { count: 0, resetAt: now + options.windowMs };
    bucket.count += 1;
    buckets.set(key, bucket);
    setHeaders(res, options, bucket, now);

    if (bucket.count > options.max) {
      securityEvent('rate_limit', req, { limiter: options.name, ipHash: clientIpKey(req) });
      return reject(res, options, Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)));
    }
    next();
  };
}

/**
 * Deferred limiter for login. The request is only checked here; the failure
 * counter is incremented by recordFailedLogin() after authentication fails.
 */
export function deferredRateLimit(options: LimitOptions): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const now = clock();
    removeExpired(now);

    const key = `${options.name}:${options.key(req)}`;
    const bucket = buckets.get(key) ?? { count: 0, resetAt: now + options.windowMs };
    buckets.set(key, bucket);
    setHeaders(res, options, bucket, now);

    const resetSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    if (bucket.count >= options.max) {
      securityEvent('rate_limit', req, { limiter: options.name, ipHash: clientIpKey(req) });
      return reject(res, options, resetSeconds);
    }

    let callbacks = pendingFailures.get(req);
    if (!callbacks) {
      callbacks = [];
      pendingFailures.set(req, callbacks);
    }
    let counted = false;
    callbacks.push(() => {
      if (counted) return;
      counted = true;
      const failureTime = clock();
      const current = buckets.get(key) ?? { count: 0, resetAt: failureTime + options.windowMs };
      if (current.resetAt <= failureTime) {
        current.count = 0;
        current.resetAt = failureTime + options.windowMs;
      }
      current.count += 1;
      buckets.set(key, current);
      res.set('RateLimit-Remaining', String(Math.max(0, options.max - current.count)));
    });

    next();
  };
}

/** Called only from the login failure path; successful logins never call it. */
export function recordFailedLogin(req: Request) {
  const callbacks = pendingFailures.get(req);
  if (!callbacks) return;
  for (const callback of callbacks) callback();
  callbacks.length = 0;
}

const FIFTEEN_MINUTES = 15 * 60 * 1000;

export const loginIpLimit = deferredRateLimit({
  name: 'login-ip',
  windowMs: FIFTEEN_MINUTES,
  max: 100,
  key: clientIpKey,
});

export const loginEmailLimit = deferredRateLimit({
  name: 'login-email-ip',
  windowMs: FIFTEEN_MINUTES,
  max: 10,
  // Composite key stops email-only victim lockout; no raw email is stored.
  key: (req) => `${emailKey(req)}:${clientIpKey(req)}`,
  message: 'محاولات دخول فاشلة كثيرة لهذا الحساب، حاول مرة أخرى بعد قليل',
});

export const registerIpLimit = rateLimit({
  name: 'register-ip',
  windowMs: FIFTEEN_MINUTES,
  max: 60,
  key: clientIpKey,
  message: 'طلبات تسجيل كثيرة، حاول مرة أخرى بعد قليل',
});

export const paymentIpLimit = rateLimit({
  name: 'payment-ip',
  windowMs: FIFTEEN_MINUTES,
  max: 120,
  key: clientIpKey,
});
