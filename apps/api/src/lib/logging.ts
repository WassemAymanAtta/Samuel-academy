import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { config } from './config';

declare global {
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}

/** Hashed so logs do not retain raw client IP addresses. */
export function ipHash(req: Request): string {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  return createHash('sha256').update(`${config.jwtSecret}:${ip}`).digest('hex').slice(0, 16);
}

/**
 * Structured, secret-free security event. Never pass passwords, tokens,
 * cookies, reset links or payment proof contents into `fields`.
 */
export function securityEvent(type: string, req: Request, fields: Record<string, unknown> = {}) {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      type,
      requestId: req.id,
      route: req.originalUrl.split('?')[0],
      ...fields,
    }),
  );
}
