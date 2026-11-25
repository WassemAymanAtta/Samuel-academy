import './setup';
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { signToken } from '../src/lib/auth';

const app = createApp();

async function reset() {
  await prisma.examAttempt.deleteMany();
  await prisma.lessonProgress.deleteMany();
  await prisma.accessGrant.deleteMany();
  await prisma.paymentRequest.deleteMany();
  await prisma.answerOption.deleteMany();
  await prisma.question.deleteMany();
  await prisma.exam.deleteMany();
  await prisma.product.deleteMany();
  await prisma.lesson.deleteMany();
  await prisma.unit.deleteMany();
  await prisma.course.deleteMany();
  await prisma.subject.deleteMany();
  await prisma.fileAsset.deleteMany();
  await prisma.user.deleteMany();
}

async function admin() {
  const user = await prisma.user.create({
    data: {
      name: 'Feature Admin',
      email: 'feature-admin@test.local',
      passwordHash: await bcrypt.hash('Admin@12345', 4),
      role: 'ADMIN',
    },
  });
  const login = await request(app).post('/api/auth/login').send({ email: user.email, password: 'Admin@12345' });
  assert.equal(login.status, 200);
  return { user, token: login.body.token as string };
}

beforeEach(reset);

describe('Previously requested features', { concurrency: false }, () => {
  it('lists Pending students, blocks them, and allows approve/reject from the API', async () => {
    const a = await admin();
    const pending = await request(app).post('/api/auth/register').send({
      name: 'Pending Learner',
      email: 'pending-feature@test.local',
      password: 'Pending@12345',
    });
    assert.equal(pending.status, 201);
    assert.equal(pending.body.user.status, 'PENDING');

    const blockedLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: pending.body.user.email, password: 'Pending@12345' });
    assert.equal(blockedLogin.status, 403);

    // A token minted before suspension must not unlock protected student APIs.
    const pendingToken = signToken(pending.body.user);
    assert.equal((await request(app).get('/api/student/dashboard').set('Authorization', `Bearer ${pendingToken}`)).status, 403);

    const list = await request(app).get('/api/admin/students?status=PENDING').set('Authorization', `Bearer ${a.token}`);
    assert.equal(list.status, 200);
    assert.equal(list.body.students.some((s: { email: string }) => s.email === pending.body.user.email), true);

    const approved = await request(app)
      .patch(`/api/admin/students/${pending.body.user.id}/status`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ status: 'ACTIVE' });
    assert.equal(approved.status, 200);
    assert.equal((await request(app).post('/api/auth/login').send({ email: pending.body.user.email, password: 'Pending@12345' })).status, 200);

    const second = await request(app).post('/api/auth/register').send({
      name: 'Rejected Learner',
      email: 'rejected-feature@test.local',
      password: 'Rejected@12345',
    });
    const rejected = await request(app)
      .patch(`/api/admin/students/${second.body.user.id}/status`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ status: 'REJECTED' });
    assert.equal(rejected.status, 200);
    assert.equal((await request(app).post('/api/auth/login').send({ email: second.body.user.email, password: 'Rejected@12345' })).status, 403);
    assert.equal((await request(app).get('/api/student/dashboard').set('Authorization', `Bearer ${signToken(second.body.user)}`)).status, 403);
  });

  it('supports uploaded PDF and external URL in the same content form and protects the uploaded file', async () => {
    const a = await admin();
    const subject = await prisma.subject.create({ data: { name: 'Feature Subject', slug: 'feature-subject' } });
    const course = await prisma.course.create({ data: { subjectId: subject.id, title: 'Feature Course', slug: 'feature-course' } });

    const upload = await request(app)
      .post('/api/admin/uploads/pdf')
      .set('Authorization', `Bearer ${a.token}`)
      .set('Content-Type', 'application/pdf')
      .set('X-File-Name', encodeURIComponent('qa-notes.pdf'))
      .send(Buffer.from('%PDF-1.4\nQA regression notes\n%%EOF'));
    assert.equal(upload.status, 201);
    assert.equal(upload.body.file.originalName, 'qa-notes.pdf');

    const withUpload = await request(app)
      .post('/api/admin/units')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ courseId: course.id, title: 'Uploaded PDF unit', pdfFileId: upload.body.file.id, sortOrder: 1 });
    assert.equal(withUpload.status, 201);
    assert.equal(withUpload.body.item.pdfFileId, upload.body.file.id);
    assert.equal(withUpload.body.item.pdfUrl, null);

    const withUrl = await request(app)
      .post('/api/admin/units')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ courseId: course.id, title: 'External PDF unit', pdfUrl: 'https://example.com/notes.pdf', sortOrder: 2 });
    assert.equal(withUrl.status, 201);
    assert.equal(withUrl.body.item.pdfUrl, 'https://example.com/notes.pdf');
    assert.equal(withUrl.body.item.pdfFileId, null);

    const both = await request(app)
      .put(`/api/admin/units/${withUrl.body.item.id}`)
      .set('Authorization', `Bearer ${a.token}`)
      .send({ courseId: course.id, title: 'Both sources', pdfUrl: 'https://example.com/notes.pdf', pdfFileId: upload.body.file.id, sortOrder: 2 });
    assert.equal(both.status, 400);

    const granted = await prisma.user.create({
      data: {
        name: 'Granted',
        email: 'granted-feature@test.local',
        passwordHash: await bcrypt.hash('Granted@12345', 4),
      },
    });
    const outsider = await prisma.user.create({
      data: {
        name: 'Outsider',
        email: 'outsider-feature@test.local',
        passwordHash: await bcrypt.hash('Outsider@12345', 4),
      },
    });
    await prisma.accessGrant.create({ data: { userId: granted.id, productId: (await prisma.product.create({
      data: { name: 'Feature unit pass', type: 'UNIT', priceCents: 100, unitId: withUpload.body.item.id },
    })).id } });

    const grantedLogin = await request(app).post('/api/auth/login').send({ email: granted.email, password: 'Granted@12345' });
    const outsiderLogin = await request(app).post('/api/auth/login').send({ email: outsider.email, password: 'Outsider@12345' });
    const allowed = await request(app)
      .get(`/api/files/${upload.body.file.id}`)
      .set('Authorization', `Bearer ${grantedLogin.body.token}`);
    assert.equal(allowed.status, 200);
    assert.equal(Buffer.isBuffer(allowed.body), true);
    assert.match(allowed.body.toString('latin1'), /%PDF-1\.4/);

    const denied = await request(app)
      .get(`/api/files/${upload.body.file.id}`)
      .set('Authorization', `Bearer ${outsiderLogin.body.token}`);
    assert.equal(denied.status, 403);
  });

  it('binds one account to one device and allows only the newest session on that device', async () => {
    const user = await prisma.user.create({
      data: {
        name: 'Single Session',
        email: 'single-session@test.local',
        passwordHash: await bcrypt.hash('Session@12345', 4),
      },
    });

    const firstDevice = await request(app)
      .post('/api/auth/login')
      .set('X-Device-Id', 'device-a')
      .send({ email: user.email, password: 'Session@12345' });
    assert.equal(firstDevice.status, 200);

    // A friend with the correct password but a different device is refused, so
    // the stolen credentials cannot unlock the student's paid content.
    const friendDevice = await request(app)
      .post('/api/auth/login')
      .set('X-Device-Id', 'device-b')
      .send({ email: user.email, password: 'Session@12345' });
    assert.equal(friendDevice.status, 403);
    assert.match(friendDevice.body.error.message, /جهاز آخر/);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).sessionDeviceId, 'device-a');
    assert.equal(
      (await request(app).get('/api/auth/me').set('Authorization', `Bearer ${firstDevice.body.token}`)).status,
      200,
    );

    // Re-login from the bound device is allowed and replaces the old token.
    const secondSession = await request(app)
      .post('/api/auth/login')
      .set('X-Device-Id', 'device-a')
      .send({ email: user.email, password: 'Session@12345' });
    assert.equal(secondSession.status, 200);
    assert.notEqual(firstDevice.body.token, secondSession.body.token);

    const oldSession = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${firstDevice.body.token}`);
    assert.equal(oldSession.status, 401);

    const currentSession = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${secondSession.body.token}`);
    assert.equal(currentSession.status, 200);
    assert.equal(currentSession.body.user.id, user.id);
  });

  it('revokes the active token when the user logs out', async () => {
    const user = await prisma.user.create({
      data: {
        name: 'Logout Session',
        email: 'logout-session@test.local',
        passwordHash: await bcrypt.hash('Session@12345', 4),
      },
    });
    const login = await request(app)
      .post('/api/auth/login')
      .set('X-Device-Id', 'device-a')
      .send({ email: user.email, password: 'Session@12345' });
    assert.equal(login.status, 200);

    const logout = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${login.body.token}`);
    assert.equal(logout.status, 200);

    const afterLogout = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${login.body.token}`);
    assert.equal(afterLogout.status, 401);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).sessionDeviceId, null);

    // Logging out releases the device binding, so a normal login works elsewhere.
    const nextDevice = await request(app)
      .post('/api/auth/login')
      .set('X-Device-Id', 'device-b')
      .send({ email: user.email, password: 'Session@12345' });
    assert.equal(nextDevice.status, 200);
  });
});
