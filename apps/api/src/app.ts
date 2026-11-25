import { randomUUID } from 'node:crypto';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config } from './lib/config';
import { errorHandler, notFound } from './lib/errors';
import { deviceCookieValue, deviceIdFrom, requireAdmin, requireAuth } from './lib/auth';
import {
  loginEmailLimit,
  loginIpLimit,
  paymentIpLimit,
  registerIpLimit,
} from './lib/rateLimit';
import { authRouter } from './routes/auth';
import { catalogRouter } from './routes/catalog';
import { studentRouter } from './routes/student';
import { paymentRouter } from './routes/payments';
import { examRouter } from './routes/exams';
import { adminRouter } from './routes/admin';
import { uploadRouter } from './routes/uploads';
import { fileRouter } from './routes/files';

export function createApp() {
  const app = express();

  const allowedOrigins = config.webOrigin.split(',').map((origin) => origin.trim()).filter(Boolean);
  if (allowedOrigins.includes('*')) {
    throw new Error('WEB_ORIGIN must list explicit origins when credentials are enabled');
  }
  app.use(
    cors({
      origin: allowedOrigins,
      credentials: true,
    }),
  );
  // JSON API responses must never be served from a browser cache: a 304 with
  // an empty body would otherwise be parsed as an empty payload by the client.
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'DENY');
    res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (config.isProduction) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });
  app.use((req, res, next) => {
    req.id = randomUUID();
    res.set('X-Request-ID', req.id);
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  // Server-issued signed device proof. The raw header is no longer accepted as
  // proof: only this httpOnly cookie can bind a browser to a session.
  app.use((req, res, next) => {
    if (!deviceIdFrom(req)) {
      const value = deviceCookieValue(randomUUID());
      req.cookies[config.deviceCookieName] = value;
      res.cookie(config.deviceCookieName, value, {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.isProduction,
        maxAge: config.cookieMaxAge,
        path: '/',
      });
    }
    next();
  });

  app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'samuel-academy-api' }));

  app.use('/api/auth/login', loginIpLimit, loginEmailLimit);
  app.use('/api/auth/register', registerIpLimit);
  app.use('/api/payments', paymentIpLimit);

  app.use('/api/auth', authRouter);
  app.use('/api/catalog', catalogRouter);
  app.use('/api/student', studentRouter);
  app.use('/api', paymentRouter);
  app.use('/api', examRouter);
  app.use('/api/files', fileRouter);

  // Auth before raw parsers: anonymous clients can no longer make the API
  // buffer up to 200 MB before being rejected.
  app.use('/api/admin/uploads', requireAuth, requireAdmin);
  app.use(
    '/api/admin/uploads/pdf',
    express.raw({ type: ['application/pdf', 'application/octet-stream'], limit: config.maxUploadBytes }),
  );
  app.use(
    '/api/admin/uploads/media',
    express.raw({
      type: ['video/mp4', 'audio/mpeg', 'audio/mp3', 'application/octet-stream'],
      limit: config.maxMediaBytes,
    }),
  );
  app.use('/api/admin/uploads', uploadRouter);
  app.use('/api/admin', adminRouter);

  app.use((_req, _res, next) => next(notFound('الصفحة المطلوبة غير موجودة')));
  app.use(errorHandler);

  return app;
}
