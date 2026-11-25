import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = `
  import('./src/lib/config.ts')
    .then((m) => console.log(JSON.stringify({ demoMode: m.config.demoMode, email: m.config.admin.email })))
    .catch((e) => { console.error(e.message); process.exit(1); });
`;

const productionEnv = {
  NODE_ENV: 'production',
  DEMO_MODE: 'false',
  DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/samuel_prod?schema=public',
  JWT_SECRET: 'a-long-random-config-test-secret-not-a-placeholder',
  WEB_ORIGIN: 'http://localhost:5173',
  ADMIN_EMAIL: 'owner@example.com',
  ADMIN_PASSWORD: 'Str0ng-Test-Pass!',
};

function loadConfig(overrides: Record<string, string>) {
  return spawnSync(process.execPath, ['--import', 'tsx', '-e', script], {
    cwd: process.cwd(),
    env: { ...process.env, ...productionEnv, ...overrides },
    encoding: 'utf8',
  });
}

test('production admin config is active and demo mode is disabled', () => {
  const result = loadConfig({});
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { demoMode: false, email: 'owner@example.com' });
});

test('production refuses a demo database', () => {
  const result = loadConfig({ DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/samuel_academy?schema=public' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Refusing to start in production against a demo database/);
});

test('production refuses demo mode', () => {
  const result = loadConfig({ DEMO_MODE: 'true' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /DEMO_MODE="false" is required in production/);
});

test('production requires an admin password', () => {
  const result = loadConfig({ ADMIN_PASSWORD: '' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ADMIN_PASSWORD must be set when DEMO_MODE=false/);
});
