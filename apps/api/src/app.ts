import { randomUUID } from 'node:crypto';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config } from './lib/config';
import { errorHandler, notFound } from './lib/errors';
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
    next();
  });
  app.use(express.json({ limit: '1mb' }));
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
  app.use(cookieParser());

  // A non-authorising device cookie lets the API bind one account to one browser.
  // A stolen password from a different device has no matching cookie and is refused.
  app.use((req, res, next) => {
    if (!req.cookies?.[config.deviceCookieName] && !req.header('x-device-id')) {
      const deviceId = randomUUID();
      req.cookies[config.deviceCookieName] = deviceId;
      res.cookie(config.deviceCookieName, deviceId, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: config.cookieMaxAge,
        path: '/',
      });
    }
    next();
  });

  app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'samuel-academy-api' }));

  app.use('/api/auth', authRouter);
  app.use('/api/catalog', catalogRouter);
  app.use('/api/student', studentRouter);
  app.use('/api', paymentRouter);
  app.use('/api', examRouter);
  app.use('/api/files', fileRouter);
  app.use('/api/admin/uploads', uploadRouter);
  app.use('/api/admin', adminRouter);

  app.use((_req, _res, next) => next(notFound('الصفحة المطلوبة غير موجودة')));
  app.use(errorHandler);

  return app;
}
