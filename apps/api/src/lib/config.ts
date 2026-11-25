import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });

// In tests we point Prisma at the separate test database before the client is created.
if (process.env.NODE_ENV === 'test' && process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

// Private uploads live outside apps/web/public so paid material is never served by Vite.
const defaultUploadDir = path.resolve(__dirname, '../../storage/uploads');
const uploadDir = path.resolve(process.env.UPLOAD_DIR ?? defaultUploadDir);
fs.mkdirSync(uploadDir, { recursive: true });

const maxUploadBytes = Number(process.env.MAX_UPLOAD_BYTES ?? 20 * 1024 * 1024);
if (!Number.isInteger(maxUploadBytes) || maxUploadBytes < 1024) {
  throw new Error('MAX_UPLOAD_BYTES must be an integer of at least 1024 bytes');
}

// Videos/audio are usually much larger than PDFs, so they get their own limit.
const maxMediaBytes = Number(process.env.MAX_MEDIA_BYTES ?? 200 * 1024 * 1024);
if (!Number.isInteger(maxMediaBytes) || maxMediaBytes < 1024) {
  throw new Error('MAX_MEDIA_BYTES must be an integer of at least 1024 bytes');
}

const jwtSecret = required('JWT_SECRET');
if (jwtSecret.length < 16 || /change-this/i.test(jwtSecret)) {
  throw new Error('JWT_SECRET must be a long random value (at least 16 chars, not a placeholder)');
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  webOrigin: required('WEB_ORIGIN', 'http://localhost:5173'),
  jwtSecret,
  demoMode: process.env.DEMO_MODE !== 'false',
  paymentDetails: {
    instapay: required('DEMO_PAYMENT_INSTAPAY', 'DEMO - InstaPay alias: 01000000000'),
    ewallet: required('DEMO_PAYMENT_EWALLET', 'DEMO - Vodafone Cash: 01000000000'),
  },
  cookieName: 'sa_token',
  deviceCookieName: 'sa_device',
  cookieMaxAge: 7 * 24 * 60 * 60 * 1000,
  uploadDir,
  maxUploadBytes,
  maxMediaBytes,
};
