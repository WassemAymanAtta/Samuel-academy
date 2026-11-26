import bcrypt from 'bcryptjs';
import { config } from '../src/lib/config';
import { prisma } from '../src/lib/prisma';

/**
 * Non-destructive production bootstrap for the single admin account.
 * Unlike the demo seed, it never deletes data and touches only this one user.
 */
function currentDatabase(): string {
  try {
    return decodeURIComponent(new URL(process.env.DATABASE_URL ?? '').pathname.replace(/^\//, ''));
  } catch {
    return '';
  }
}

async function main() {
  const isLocalDemoDatabase = ['samuel_academy', 'samuel_academy_test'].includes(currentDatabase());
  const isStagingDemo = config.stagingDemoOverride;
  if (config.demoMode && !isLocalDemoDatabase && !isStagingDemo) {
    throw new Error('Demo mode may only bootstrap the admin account on a demo database.');
  }
  if (!config.demoMode && (isLocalDemoDatabase || isStagingDemo)) {
    throw new Error('Refusing to bootstrap the production admin on a demo database; set DATABASE_URL first.');
  }

  const email = config.admin.email;
  const existing = await prisma.user.findUnique({ where: { email } });
  const passwordHash = await bcrypt.hash(config.admin.password, 12);

  const admin = existing
    ? await prisma.user.update({
        where: { email },
        data: {
          name: existing.name || 'Samuel Academy Admin',
          role: 'ADMIN',
          status: 'ACTIVE',
          passwordHash,
          sessionVersion: { increment: 1 },
          sessionDeviceId: null,
        },
      })
    : await prisma.user.create({
        data: {
          name: 'Samuel Academy Admin',
          email,
          passwordHash,
          role: 'ADMIN',
          status: 'ACTIVE',
          sessionVersion: 0,
          sessionDeviceId: null,
        },
      });

  console.log(`Admin account ready: ${admin.email} (${existing ? 'updated' : 'created'}).`);
  console.log('No other users or data were changed.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
