import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';

// Load environment-specific overrides first: dotenv never overwrites an
// existing value, so .env.production wins over the local demo .env.
const envFiles = [
  ...(process.env.NODE_ENV ? [`.env.${process.env.NODE_ENV}`, `../../.env.${process.env.NODE_ENV}`] : []),
  '.env',
  '../../.env',
];
for (const file of envFiles) {
  dotenv.config({ path: path.resolve(process.cwd(), file) });
}

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
const isProduction = process.env.NODE_ENV === 'production';
const jwtMinimum = isProduction ? 32 : 16;
if (jwtSecret.length < jwtMinimum || /change-this/i.test(jwtSecret)) {
  throw new Error(`JWT_SECRET must be a long random value (at least ${jwtMinimum} chars, not a placeholder)`);
}

function databaseName(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
  } catch {
    return '';
  }
}
const currentDatabase = databaseName(process.env.DATABASE_URL ?? '');
const isStagingDatabase = currentDatabase === 'samuel_academy_staging';

// Device-bound sessions stay ON for every database except the isolated Staging
// one. Production keeps the protection automatically; Staging can also opt out
// explicitly with SESSION_BINDING_ENABLED=false.
const sessionBindingEnabled = process.env.SESSION_BINDING_ENABLED
  ? process.env.SESSION_BINDING_ENABLED !== 'false'
  : !isStagingDatabase;

// DEMO_MODE is forbidden in production. The isolated Staging database enables
// demo logins automatically and cannot be turned back into a production target
// by a stray environment variable; a real production database never gets demo
// logins, regardless of any staging-related flag.
const stagingDemoOverride = isStagingDatabase;
const demoMode = isStagingDatabase || process.env.DEMO_MODE !== 'false';
if (isProduction && demoMode && !stagingDemoOverride) {
  throw new Error('DEMO_MODE="false" is required in production so demo logins are never exposed');
}

const demoDatabases = new Set(['samuel_academy', 'samuel_academy_test']);
if (isProduction && demoDatabases.has(currentDatabase)) {
  throw new Error('Refusing to start in production against a demo database; set DATABASE_URL to the production database');
}

// Demo data keeps the well-known credentials for the trial. Production must
// name the one admin account that the bootstrap script creates, and supply a
// strong password. These values are never exposed by the public config route.
function bootstrapAdmin(name: string, demoValue: string): string {
  if (demoMode) return demoValue;
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set when DEMO_MODE=false`);
  return value;
}

const adminEmail = bootstrapAdmin('ADMIN_EMAIL', 'admin@samuelacademy.com').trim().toLowerCase();
const adminPassword = bootstrapAdmin('ADMIN_PASSWORD', 'Admin@12345');

if (!demoMode) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) throw new Error('ADMIN_EMAIL must be a valid email address');
  if (['student@samuelacademy.com', 'demo@samuelacademy.com'].includes(adminEmail)) {
    throw new Error('ADMIN_EMAIL must not be a demo student account');
  }
  if (adminPassword.length < 12 || /change-this|Admin@12345/i.test(adminPassword)) {
    throw new Error('ADMIN_PASSWORD must be at least 12 chars and must not be a demo/placeholder password');
  }
}

function paymentDetail(realName: string, demoName: string, demoValue: string): string {
  if (demoMode) return required(demoName, demoValue);
  const value = required(realName);
  if (/^DEMO\b|change-this|01000000000/i.test(value)) {
    throw new Error(`${realName} must contain real production payment details`);
  }
  return value;
}

const paymentDetails = {
  instapay: paymentDetail('PAYMENT_INSTAPAY', 'DEMO_PAYMENT_INSTAPAY', 'DEMO - InstaPay alias: 01000000000'),
  ewallet: paymentDetail('PAYMENT_EWALLET', 'DEMO_PAYMENT_EWALLET', 'DEMO - Vodafone Cash: 01000000000'),
};

export const config = {
  port: Number(process.env.PORT ?? 4000),
  webOrigin: required('WEB_ORIGIN', 'http://localhost:5173'),
  jwtSecret,
  isProduction,
  demoMode,
  sessionBindingEnabled,
  stagingDemoOverride,
  admin: { email: adminEmail, password: adminPassword },
  paymentDetails,
  cookieName: 'sa_token',
  deviceCookieName: 'sa_device',
  cookieMaxAge: 7 * 24 * 60 * 60 * 1000,
  uploadDir,
  maxUploadBytes,
  maxMediaBytes,
};
