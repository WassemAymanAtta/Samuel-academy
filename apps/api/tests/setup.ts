import dotenv from 'dotenv';
import path from 'node:path';
import { execSync } from 'node:child_process';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });

process.env.NODE_ENV = 'test';
process.env.MAX_UPLOAD_BYTES ??= '1024';
process.env.MAX_MEDIA_BYTES ??= '4096';
if (!process.env.TEST_DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL is required to run the API tests');
}
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

// Make sure the isolated test database has the latest schema.
execSync('npx prisma migrate deploy', {
  env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL },
  stdio: 'ignore',
});
