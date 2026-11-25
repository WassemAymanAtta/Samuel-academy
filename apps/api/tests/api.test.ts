import './setup';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { config } from '../src/lib/config';

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

async function fixtures() {
  const admin = await prisma.user.create({
    data: {
      name: 'Admin',
      email: 'admin@test.local',
      passwordHash: await bcrypt.hash('Admin@12345', 4),
      role: 'ADMIN',
    },
  });
  const student = await prisma.user.create({
    data: {
      name: 'Student',
      email: 'student@test.local',
      passwordHash: await bcrypt.hash('Student@12345', 4),
      role: 'STUDENT',
    },
  });
  const subject = await prisma.subject.create({ data: { name: 'Programming', slug: 'programming' } });
  const course = await prisma.course.create({ data: { subjectId: subject.id, title: 'JS', slug: 'js' } });
  const unit = await prisma.unit.create({ data: { courseId: course.id, title: 'Unit 1' } });
  const lesson = await prisma.lesson.create({ data: { unitId: unit.id, title: 'Lesson 1', videoUrl: 'https://example.com/v' } });
  const product = await prisma.product.create({
    data: { name: 'Unit 1 pass', type: 'UNIT', priceCents: 9900, unitId: unit.id },
  });
  return { admin, student, subject, course, unit, lesson, product };
}

beforeEach(reset);

describe('Authentication and role-based authorization', { concurrency: false }, () => {
  it('registers a Pending student and only allows login after admin approval', async () => {
    const f = await fixtures();
    const agent = request.agent(app);
    const response = await agent.post('/api/auth/register').send({
      name: 'New Student',
      email: 'new@test.local',
      password: 'Password123',
    });
    assert.equal(response.status, 201);
    assert.equal(response.body.user.role, 'STUDENT');
    assert.equal(response.body.user.status, 'PENDING');
    assert.equal(response.headers['set-cookie']?.some((c: string) => c.startsWith('sa_token=')), false);

    assert.equal((await agent.get('/api/auth/me')).status, 401);
    const blockedLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'new@test.local', password: 'Password123' });
    assert.equal(blockedLogin.status, 403);
    assert.match(blockedLogin.body.error.message, /قيد المراجعة/);

    const adminAgent = request.agent(app);
    await adminAgent.post('/api/auth/login').send({ email: f.admin.email, password: 'Admin@12345' });
    const pendingList = await adminAgent.get('/api/admin/students?status=PENDING');
    assert.ok(pendingList.body.students.some((s: { email: string }) => s.email === 'new@test.local'));

    const approved = await adminAgent
      .patch(`/api/admin/students/${response.body.user.id}/status`)
      .send({ status: 'ACTIVE' });
    assert.equal(approved.status, 200);
    assert.equal(approved.body.student.status, 'ACTIVE');

    const login = await agent.post('/api/auth/login').send({ email: 'new@test.local', password: 'Password123' });
    assert.equal(login.status, 200);
    assert.ok(login.headers['set-cookie']?.some((c: string) => c.startsWith('sa_token=')));
    const me = await agent.get('/api/auth/me');
    assert.equal(me.status, 200);
    assert.equal(me.body.user.status, 'ACTIVE');

    const badLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'new@test.local', password: 'wrong-password' });
    assert.equal(badLogin.status, 401);
  });

  it('blocks students from admin APIs and allows admins', async () => {
    const f = await fixtures();
    const studentAgent = request.agent(app);
    await studentAgent.post('/api/auth/login').send({ email: f.student.email, password: 'Student@12345' });

    const denied = await studentAgent.get('/api/admin/overview');
    assert.equal(denied.status, 403);

    const adminAgent = request.agent(app);
    await adminAgent.post('/api/auth/login').send({ email: f.admin.email, password: 'Admin@12345' });
    const ok = await adminAgent.get('/api/admin/overview');
    assert.equal(ok.status, 200);
    assert.equal(ok.body.stats.students, 1);
  });
});

describe('Manual payment workflow and automatic access granting', { concurrency: false }, () => {
  it('only grants access after an admin approves the request', async () => {
    const f = await fixtures();
    const studentAgent = request.agent(app);
    await studentAgent.post('/api/auth/login').send({ email: f.student.email, password: 'Student@12345' });

    const submitted = await studentAgent.post('/api/payments').send({
      productId: f.product.id,
      method: 'EWALLET',
      reference: 'TEST-REF-1001',
      note: 'demo transfer',
    });
    assert.equal(submitted.status, 201);
    assert.equal(submitted.body.payment.status, 'PENDING');
    assert.equal(submitted.body.payment.amountCents, 9900);

    // Pending payment must not unlock content.
    const locked = await studentAgent.get(`/api/catalog/lessons/${f.lesson.id}`);
    assert.equal(locked.status, 403);
    assert.equal(locked.body.error.code, 'CONTENT_LOCKED');

    const dashboardBefore = await studentAgent.get('/api/student/dashboard');
    assert.equal(dashboardBefore.body.pendingPayments.length, 1);
    assert.equal(dashboardBefore.body.purchases.length, 0);

    const adminAgent = request.agent(app);
    await adminAgent.post('/api/auth/login').send({ email: f.admin.email, password: 'Admin@12345' });

    const approved = await adminAgent.patch(`/api/admin/payments/${submitted.body.payment.id}`).send({
      status: 'APPROVED',
      adminNote: 'verified demo reference',
    });
    assert.equal(approved.status, 200);
    assert.equal(approved.body.granted, true);

    const unlocked = await studentAgent.get(`/api/catalog/lessons/${f.lesson.id}`);
    assert.equal(unlocked.status, 200);
    assert.equal(unlocked.body.unlocked, true);
    assert.ok(unlocked.body.lesson.videoUrl);

    const dashboardAfter = await studentAgent.get('/api/student/dashboard');
    assert.equal(dashboardAfter.body.pendingPayments.length, 0);
    assert.equal(dashboardAfter.body.purchases.length, 1);

    // A second approval of the same request is rejected.
    const duplicate = await adminAgent.patch(`/api/admin/payments/${submitted.body.payment.id}`).send({ status: 'APPROVED' });
    assert.equal(duplicate.status, 409);
  });

  it('rejecting a payment does not create access', async () => {
    const f = await fixtures();
    const studentAgent = request.agent(app);
    await studentAgent.post('/api/auth/login').send({ email: f.student.email, password: 'Student@12345' });
    const payment = await studentAgent.post('/api/payments').send({
      productId: f.product.id,
      method: 'INSTAPAY',
      reference: 'TEST-REF-2002',
    });

    const adminAgent = request.agent(app);
    await adminAgent.post('/api/auth/login').send({ email: f.admin.email, password: 'Admin@12345' });
    const rejected = await adminAgent.patch(`/api/admin/payments/${payment.body.payment.id}`).send({ status: 'REJECTED' });
    assert.equal(rejected.status, 200);
    assert.equal(rejected.body.granted, false);

    assert.equal(await prisma.accessGrant.count({ where: { userId: f.student.id } }), 0);
  });
});

describe('Content access rules', { concurrency: false }, () => {
  it('honours permanent and expired subscription grants', async () => {
    const f = await fixtures();
    const studentAgent = request.agent(app);
    await studentAgent.post('/api/auth/login').send({ email: f.student.email, password: 'Student@12345' });

    const subscription = await prisma.product.create({
      data: { name: 'Subscription', type: 'MONTHLY', priceCents: 49900, subjectId: f.subject.id, durationDays: 30 },
    });

    await prisma.accessGrant.create({
      data: {
        userId: f.student.id,
        productId: subscription.id,
        expiresAt: new Date(Date.now() - 86_400_000),
      },
    });
    assert.equal((await studentAgent.get(`/api/catalog/lessons/${f.lesson.id}`)).status, 403);

    await prisma.accessGrant.deleteMany({ where: { userId: f.student.id } });
    await prisma.accessGrant.create({
      data: { userId: f.student.id, productId: subscription.id, expiresAt: null },
    });
    assert.equal((await studentAgent.get(`/api/catalog/lessons/${f.lesson.id}`)).status, 200);
  });

  it('lets students complete lessons and records progress', async () => {
    const f = await fixtures();
    await prisma.accessGrant.create({ data: { userId: f.student.id, productId: f.product.id } });

    const studentAgent = request.agent(app);
    await studentAgent.post('/api/auth/login').send({ email: f.student.email, password: 'Student@12345' });

    const completion = await studentAgent.post(`/api/student/lessons/${f.lesson.id}/complete`);
    assert.equal(completion.status, 200);
    const progress = await studentAgent.get(`/api/student/courses/${f.course.id}/progress`);
    assert.equal(progress.body.percent, 100);
  });
});

describe('Account approval workflow', { concurrency: false }, () => {
  it('rejects Pending accounts, blocks their login, and blocks protected APIs for Rejected users', async () => {
    const f = await fixtures();
    const adminAgent = request.agent(app);
    await adminAgent.post('/api/auth/login').send({ email: f.admin.email, password: 'Admin@12345' });

    const registered = await request(app).post('/api/auth/register').send({
      name: 'Rejected Applicant',
      email: 'reject-me@test.local',
      password: 'Password123',
    });
    const rejected = await adminAgent
      .patch(`/api/admin/students/${registered.body.user.id}/status`)
      .send({ status: 'REJECTED' });
    assert.equal(rejected.status, 200);
    assert.equal(rejected.body.student.status, 'REJECTED');

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'reject-me@test.local', password: 'Password123' });
    assert.equal(login.status, 403);
    assert.match(login.body.error.message, /رفض/);

    // A session that was active before rejection must stop working immediately.
    const studentAgent = request.agent(app);
    await studentAgent.post('/api/auth/login').send({ email: f.student.email, password: 'Student@12345' });
    assert.equal((await studentAgent.get('/api/student/dashboard')).status, 200);

    await adminAgent.patch(`/api/admin/students/${f.student.id}/status`).send({ status: 'REJECTED' });
    const protectedApi = await studentAgent.get('/api/student/dashboard');
    assert.equal(protectedApi.status, 403);
    assert.match(protectedApi.body.error.message, /رفض/);
    assert.equal((await studentAgent.get(`/api/catalog/lessons/${f.lesson.id}`)).status, 403);
  });

  it('allows only admins to change account status', async () => {
    const f = await fixtures();
    const studentAgent = request.agent(app);
    await studentAgent.post('/api/auth/login').send({ email: f.student.email, password: 'Student@12345' });

    const denied = await studentAgent
      .patch(`/api/admin/students/${f.student.id}/status`)
      .send({ status: 'REJECTED' });
    assert.equal(denied.status, 403);

    const anonymous = await request(app)
      .patch(`/api/admin/students/${f.student.id}/status`)
      .send({ status: 'REJECTED' });
    assert.equal(anonymous.status, 401);
    assert.equal((await prisma.user.findUnique({ where: { id: f.student.id } }))?.status, 'ACTIVE');
  });
});

describe('Private PDF uploads and guarded file access', { concurrency: false }, () => {
  function tinyPdf(padding = 0) {
    return Buffer.concat([
      Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n'),
      Buffer.alloc(padding, 32),
    ]);
  }

  it('validates PDFs on the backend, rejects non-admins, and serves files only to authorised students', async () => {
    const f = await fixtures();
    const adminAgent = request.agent(app);
    await adminAgent.post('/api/auth/login').send({ email: f.admin.email, password: 'Admin@12345' });

    const uploaded = await adminAgent
      .post('/api/admin/uploads/pdf')
      .set('Content-Type', 'application/pdf')
      .set('X-File-Name', encodeURIComponent('خطة الدرس.pdf'))
      .send(tinyPdf());
    assert.equal(uploaded.status, 201);
    assert.equal(uploaded.body.file.originalName, 'خطة الدرس.pdf');
    assert.equal(uploaded.body.file.mimeType, 'application/pdf');

    const stored = await prisma.fileAsset.findUnique({ where: { id: uploaded.body.file.id } });
    assert.ok(stored);
    assert.ok(fs.existsSync(path.join(config.uploadDir, stored!.storedName)));

    const wrongMagic = await adminAgent
      .post('/api/admin/uploads/pdf')
      .set('Content-Type', 'application/pdf')
      .set('X-File-Name', 'fake.pdf')
      .send(Buffer.from('not a pdf'));
    assert.equal(wrongMagic.status, 400);

    const wrongType = await adminAgent
      .post('/api/admin/uploads/pdf')
      .set('Content-Type', 'text/plain')
      .set('X-File-Name', 'notes.txt')
      .send(Buffer.from('hello'));
    assert.equal(wrongType.status, 400);

    const tooLarge = await adminAgent
      .post('/api/admin/uploads/pdf')
      .set('Content-Type', 'application/pdf')
      .set('X-File-Name', 'large.pdf')
      .send(tinyPdf(2000));
    assert.equal(tooLarge.status, 413);

    const studentAgent = request.agent(app);
    await studentAgent.post('/api/auth/login').send({ email: f.student.email, password: 'Student@12345' });
    const studentUpload = await studentAgent
      .post('/api/admin/uploads/pdf')
      .set('Content-Type', 'application/pdf')
      .set('X-File-Name', 'student.pdf')
      .send(tinyPdf());
    assert.equal(studentUpload.status, 403);

    const linkFile = () =>
      adminAgent.put(`/api/admin/lessons/${f.lesson.id}`).send({
        unitId: f.unit.id,
        title: 'Lesson 1',
        videoUrl: 'https://example.com/v',
        pdfFileId: uploaded.body.file.id,
      });
    assert.equal((await linkFile()).status, 200);

    const externalUrl = await adminAgent.put(`/api/admin/lessons/${f.lesson.id}`).send({
      unitId: f.unit.id,
      title: 'Lesson 1',
      videoUrl: 'https://example.com/v',
      pdfUrl: 'https://example.com/external-notes.pdf',
    });
    assert.equal(externalUrl.status, 200);
    assert.equal(externalUrl.body.item.pdfUrl, 'https://example.com/external-notes.pdf');
    assert.equal(externalUrl.body.item.pdfFileId, null);

    assert.equal((await linkFile()).status, 200);

    const lockedFile = await studentAgent.get(`/api/files/${uploaded.body.file.id}`);
    assert.equal(lockedFile.status, 403);

    await prisma.accessGrant.create({ data: { userId: f.student.id, productId: f.product.id } });
    const allowedFile = await studentAgent.get(`/api/files/${uploaded.body.file.id}`);
    assert.equal(allowedFile.status, 200);
    assert.match(allowedFile.headers['content-type'], /application\/pdf/);
    assert.ok(allowedFile.body.toString().startsWith('%PDF-'));

    const other = await prisma.user.create({
      data: {
        name: 'Other Student',
        email: 'other@test.local',
        passwordHash: await bcrypt.hash('Student@12345', 4),
        role: 'STUDENT',
      },
    });
    const otherAgent = request.agent(app);
    await otherAgent.post('/api/auth/login').send({ email: other.email, password: 'Student@12345' });
    assert.equal((await otherAgent.get(`/api/files/${uploaded.body.file.id}`)).status, 403);
    assert.equal((await adminAgent.get(`/api/files/${uploaded.body.file.id}`)).status, 200);
  });
});

describe('Lesson media uploads (MP4/MP3)', { concurrency: false }, () => {
  function tinyMp4(padding = 200) {
    return Buffer.concat([
      Buffer.from([0, 0, 0, 24]),
      Buffer.from('ftypisom00000200isomiso2avc1mp41', 'latin1'),
      Buffer.alloc(padding),
    ]);
  }

  function tinyMp3() {
    return Buffer.concat([Buffer.from('ID3\x03\x00\x00\x00\x00\x00\x00', 'latin1'), Buffer.alloc(200)]);
  }

  it('validates media, links it to lessons, and streams it with range support only to authorised students', async () => {
    const f = await fixtures();
    const adminAgent = request.agent(app);
    await adminAgent.post('/api/auth/login').send({ email: f.admin.email, password: 'Admin@12345' });

    const mp4 = await adminAgent
      .post('/api/admin/uploads/media')
      .set('Content-Type', 'video/mp4')
      .set('X-File-Name', encodeURIComponent('شرح الدرس.mp4'))
      .send(tinyMp4());
    assert.equal(mp4.status, 201);
    assert.equal(mp4.body.file.originalName, 'شرح الدرس.mp4');
    assert.equal(mp4.body.file.mimeType, 'video/mp4');

    const mp3 = await adminAgent
      .post('/api/admin/uploads/media')
      .set('Content-Type', 'audio/mpeg')
      .set('X-File-Name', 'lesson.mp3')
      .send(tinyMp3());
    assert.equal(mp3.status, 201);
    assert.equal(mp3.body.file.mimeType, 'audio/mpeg');

    const badMagic = await adminAgent
      .post('/api/admin/uploads/media')
      .set('Content-Type', 'video/mp4')
      .set('X-File-Name', 'fake.mp4')
      .send(Buffer.from('not media'));
    assert.equal(badMagic.status, 400);

    const badType = await adminAgent
      .post('/api/admin/uploads/media')
      .set('Content-Type', 'text/plain')
      .set('X-File-Name', 'notes.txt')
      .send(tinyMp4());
    assert.equal(badType.status, 400);

    const tooLarge = await adminAgent
      .post('/api/admin/uploads/media')
      .set('Content-Type', 'video/mp4')
      .set('X-File-Name', 'large.mp4')
      .send(tinyMp4(5000));
    assert.equal(tooLarge.status, 413);

    const studentAgent = request.agent(app);
    const studentLogin = await studentAgent.post('/api/auth/login').send({ email: f.student.email, password: 'Student@12345' });
    const studentUpload = await studentAgent
      .post('/api/admin/uploads/media')
      .set('Content-Type', 'video/mp4')
      .set('X-File-Name', 'student.mp4')
      .send(tinyMp4());
    assert.equal(studentUpload.status, 403);

    const linked = await adminAgent.put(`/api/admin/lessons/${f.lesson.id}`).send({
      unitId: f.unit.id,
      title: 'Lesson 1',
      mediaFileId: mp4.body.file.id,
      mediaTitle: 'فيديو الدرس',
    });
    assert.equal(linked.status, 200);
    assert.equal(linked.body.item.mediaFileId, mp4.body.file.id);
    assert.equal(linked.body.item.videoUrl, null);

    const dualSource = await adminAgent.put(`/api/admin/lessons/${f.lesson.id}`).send({
      unitId: f.unit.id,
      title: 'Lesson 1',
      videoUrl: 'https://example.com/v',
      mediaFileId: mp4.body.file.id,
    });
    assert.equal(dualSource.status, 400);

    await prisma.accessGrant.create({ data: { userId: f.student.id, productId: f.product.id } });
    const detail = await studentAgent.get(`/api/catalog/lessons/${f.lesson.id}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.lesson.mediaFile.id, mp4.body.file.id);
    assert.equal(detail.body.lesson.mediaTitle, 'فيديو الدرس');

    const file = await studentAgent.get(`/api/files/${mp4.body.file.id}`);
    assert.equal(file.status, 200);
    assert.match(file.headers['content-type'], /video\/mp4/);
    assert.equal((await studentAgent.get(`/api/files/${mp3.body.file.id}`)).status, 403);
    assert.equal((await studentAgent.get(`/api/files/${mp3.body.file.id}`).set('Range', 'bytes=0-9')).status, 403);

    const range = await studentAgent.get(`/api/files/${mp4.body.file.id}`).set('Range', 'bytes=0-9');
    assert.equal(range.status, 206);
    assert.match(range.headers['content-range'], /^bytes 0-9\//);
    assert.equal(range.body.length, 10);

    const other = await prisma.user.create({
      data: {
        name: 'Other Student',
        email: 'other-media@test.local',
        passwordHash: await bcrypt.hash('Student@12345', 4),
        role: 'STUDENT',
      },
    });
    const otherAgent = request.agent(app);
    await otherAgent.post('/api/auth/login').send({ email: other.email, password: 'Student@12345' });
    assert.equal((await otherAgent.get(`/api/files/${mp4.body.file.id}`)).status, 403);

    // A tab token wins over another tab's cookie (refresh must not switch accounts),
    // including for <video>/<audio> requests that carry the token in the query string.
    const crossTab = await adminAgent
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${studentLogin.body.token}`);
    assert.equal(crossTab.body.user.id, f.student.id);
    const mediaWithTabToken = await otherAgent.get(
      `/api/files/${mp4.body.file.id}?token=${encodeURIComponent(studentLogin.body.token)}`,
    );
    assert.equal(mediaWithTabToken.status, 200);
  });
});
