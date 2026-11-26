import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = `
  import('./src/lib/config.ts')
    .then((m) => console.log(JSON.stringify({
      demoMode: m.config.demoMode,
      sessionBindingEnabled: m.config.sessionBindingEnabled,
      stagingDemoOverride: m.config.stagingDemoOverride,
    })))
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
  PAYMENT_INSTAPAY: 'REAL-INSTAPAY-1234567890',
  PAYMENT_EWALLET: 'REAL-EWALLET-1234567890',
};

const stagingDatabase = 'postgresql://u:p@127.0.0.1:5432/samuel_academy_staging?schema=public';

function loadConfig(overrides: Record<string, string>) {
  return spawnSync(process.execPath, ['--import', 'tsx', '-e', script], {
    cwd: process.cwd(),
    env: { ...process.env, ...productionEnv, ...overrides },
    encoding: 'utf8',
  });
}

test('Production keeps demo mode off and device binding on', () => {
  const result = loadConfig({});
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    demoMode: false,
    sessionBindingEnabled: true,
    stagingDemoOverride: false,
  });
});

test('device binding can be disabled explicitly', () => {
  const result = loadConfig({ SESSION_BINDING_ENABLED: 'false' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).sessionBindingEnabled, false);
});

test('only the isolated staging database enables demo mode and suspends binding', () => {
  const wrongDatabase = loadConfig({ DEMO_MODE: 'true' });
  assert.equal(wrongDatabase.status, 1);
  assert.match(wrongDatabase.stderr, /DEMO_MODE="false" is required in production/);

  const staging = loadConfig({ DEMO_MODE: 'true', DATABASE_URL: stagingDatabase });
  assert.equal(staging.status, 0, staging.stderr);
  assert.deepEqual(JSON.parse(staging.stdout), {
    demoMode: true,
    sessionBindingEnabled: false,
    stagingDemoOverride: true,
  });
});
