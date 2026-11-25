import './setup';
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';

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
      email: 'admin@security.local',
      passwordHash: await bcrypt.hash('Admin@12345', 4),
      role: 'ADMIN',
    },
  });
  const student = await prisma.user.create({
    data: {
      name: 'Student',
      email: 'student@security.local',
      passwordHash: await bcrypt.hash('Student@12345', 4),
      role: 'STUDENT',
    },
  });
  const subject = await prisma.subject.create({ data: { name: 'Math', slug: 'math' } });
  const course = await prisma.course.create({ data: { subjectId: subject.id, title: 'Algebra', slug: 'algebra' } });
  const unit = await prisma.unit.create({ data: { courseId: course.id, title: 'Unit 1' } });
  const lesson = await prisma.lesson.create({
    data: { unitId: unit.id, title: 'Public lesson', videoUrl: 'https://example.com/secret-video', pdfUrl: 'https://example.com/secret.pdf' },
  });
  const hiddenLesson = await prisma.lesson.create({
    data: { unitId: unit.id, title: 'Hidden lesson', isPublished: false, videoUrl: 'https://example.com/hidden-video' },
  });
  const product = await prisma.product.create({ data: { name: 'Unit pass', type: 'UNIT', priceCents: 9900, unitId: unit.id } });
  const otherProduct = await prisma.product.create({
    data: { name: 'Other unit pass', type: 'UNIT', priceCents: 8900, subjectId: subject.id },
  });
  return { admin, student, subject, course, unit, lesson, hiddenLesson, product, otherProduct };
}

async function login(email: string, password: string) {
  const response = await request(app).post('/api/auth/login').send({ email, password });
  assert.equal(response.status, 200);
  return response.body.token as string;
}

beforeEach(reset);

describe('Security regressions', { concurrency: false }, () => {
  it('never exposes external lesson URLs through the public unit endpoint', async () => {
    const f = await fixtures();
    for (const token of [undefined, await login(f.student.email, 'Student@12345')]) {
      const response = await request(app)
        .get(`/api/catalog/units/${f.unit.id}`)
        .set(token ? { Authorization: `Bearer ${token}` } : {});
      assert.equal(response.status, 200);
      assert.equal(JSON.stringify(response.body).includes('secret-video'), false);
      assert.equal(JSON.stringify(response.body).includes('secret.pdf'), false);
      assert.equal(response.body.lessons.some((l: { id: string }) => l.id === f.hiddenLesson.id), false);
    }
  });

  it('returns 404 for an unpublished lesson even to a purchaser', async () => {
    const f = await fixtures();
    await prisma.accessGrant.create({ data: { userId: f.student.id, productId: f.product.id } });
    const studentToken = await login(f.student.email, 'Student@12345');
    const adminToken = await login(f.admin.email, 'Admin@12345');

    assert.equal((await request(app).get(`/api/catalog/lessons/${f.hiddenLesson.id}`).set('Authorization', `Bearer ${studentToken}`)).status, 404);
    assert.equal((await request(app).get(`/api/catalog/lessons/${f.hiddenLesson.id}`).set('Authorization', `Bearer ${adminToken}`)).status, 200);
  });

  it('does not return password hashes from admin student and payment APIs', async () => {
    const f = await fixtures();
    const token = await login(f.admin.email, 'Admin@12345');
    const payment = await request(app).post('/api/payments')
      .set('Authorization', `Bearer ${await login(f.student.email, 'Student@12345')}`)
      .send({ productId: f.product.id, method: 'INSTAPAY', reference: 'NO-HASH-1' });
    assert.equal(payment.status, 201);

    for (const path of ['/api/admin/students', `/api/admin/students/${f.student.id}`, `/api/admin/payments/${payment.body.payment.id}`]) {
      const response = await request(app).get(path).set('Authorization', `Bearer ${token}`);
      assert.equal(response.status, 200);
      assert.equal(JSON.stringify(response.body).includes('passwordHash'), false);
    }
  });

  it('rejects invalid enum filters with 400 instead of a server error', async () => {
    const f = await fixtures();
    const adminToken = await login(f.admin.email, 'Admin@12345');
    const studentToken = await login(f.student.email, 'Student@12345');
    assert.equal((await request(app).get('/api/admin/payments?status=bogus').set('Authorization', `Bearer ${adminToken}`)).status, 400);
    assert.equal((await request(app).get('/api/products?type=bogus').set('Authorization', `Bearer ${studentToken}`)).status, 400);
  });

  it('rejects duplicate payment references even when submitted concurrently', async () => {
    const f = await fixtures();
    const token = await login(f.student.email, 'Student@12345');
    const send = () => request(app).post('/api/payments')
      .set('Authorization', `Bearer ${token}`)
      .send({ productId: f.product.id, method: 'EWALLET', reference: 'RACE-REF-1' });
    const responses = await Promise.all([send(), send()]);
    assert.deepEqual(responses.map((r) => r.status).sort(), [201, 400]);
    assert.equal(await prisma.paymentRequest.count({ where: { userId: f.student.id, reference: 'RACE-REF-1' } }), 1);
  });

  it('grants only the approved product and refuses a second review', async () => {
    const f = await fixtures();
    const studentToken = await login(f.student.email, 'Student@12345');
    const adminToken = await login(f.admin.email, 'Admin@12345');
    const payment = await request(app).post('/api/payments')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ productId: f.product.id, method: 'EWALLET', reference: 'APPROVE-1', amountCents: 1 });
    assert.equal(payment.status, 201);
    assert.equal(payment.body.payment.amountCents, f.product.priceCents);

    const rejected = await request(app).post('/api/payments')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ productId: f.otherProduct.id, method: 'EWALLET', reference: 'REJECT-1' });
    await request(app).patch(`/api/admin/payments/${rejected.body.payment.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'REJECTED' });

    const approvals = await Promise.all([
      request(app).patch(`/api/admin/payments/${payment.body.payment.id}`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'APPROVED' }),
      request(app).patch(`/api/admin/payments/${payment.body.payment.id}`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'APPROVED' }),
    ]);
    assert.deepEqual(approvals.map((r) => r.status).sort(), [200, 409]);

    const grants = await prisma.accessGrant.findMany({ where: { userId: f.student.id } });
    assert.equal(grants.length, 1);
    assert.equal(grants[0].productId, f.product.id);
    assert.equal((await request(app).get(`/api/catalog/lessons/${f.lesson.id}`).set('Authorization', `Bearer ${studentToken}`)).status, 200);
  });

  it('requires lesson access before clearing progress', async () => {
    const f = await fixtures();
    const token = await login(f.student.email, 'Student@12345');
    assert.equal((await request(app).delete(`/api/student/lessons/${f.lesson.id}/complete`).set('Authorization', `Bearer ${token}`)).status, 403);
    await prisma.accessGrant.create({ data: { userId: f.student.id, productId: f.product.id } });
    assert.equal((await request(app).delete(`/api/student/lessons/${f.lesson.id}/complete`).set('Authorization', `Bearer ${token}`)).status, 200);
  });

  it('accepts a query token only on private file routes', async () => {
    const f = await fixtures();
    const token = await login(f.student.email, 'Student@12345');
    assert.equal((await request(app).get(`/api/admin/overview?token=${encodeURIComponent(token)}`)).status, 401);
    assert.equal((await request(app).get(`/api/files/missing?token=${encodeURIComponent(token)}`)).status, 404);
  });

  it('marks public config no-store so browsers never return an empty 304 body', async () => {
    const response = await request(app).get('/api/auth/config');
    assert.equal(response.status, 200);
    assert.match(response.headers['cache-control'] ?? '', /no-store/);
    assert.equal(response.body.demoMode, true);
  });
});
