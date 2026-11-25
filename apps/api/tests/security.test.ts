import './setup';
import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { authHeaders } from './helpers';
import { config } from '../src/lib/config';
import {
  rateLimitKeysForTest,
  resetRateLimits,
  resetRateLimitClockForTest,
  setRateLimitClockForTest,
} from '../src/lib/rateLimit';

const app = createApp();

async function reset() {
  resetRateLimits();
  resetRateLimitClockForTest();
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

const ORACLE_KEYS = new Set([
  'correct', 'correctAnswers', 'correctOptionTexts', 'isCorrect', 'earnedPoints', 'explanation',
]);

function assertNoAnswerOracle(value: unknown, forbiddenText: string[] = []) {
  const serialized = JSON.stringify(value);
  for (const text of forbiddenText) {
    assert.equal(serialized.includes(text), false, `response disclosed answer text: ${text}`);
  }
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== 'object') return;
    for (const [key, child] of Object.entries(node)) {
      assert.equal(ORACLE_KEYS.has(key), false, `response disclosed oracle field: ${key}`);
      visit(child);
    }
  };
  visit(value);
}

async function gradedExamFixture() {
  const f = await fixtures();
  const exam = await prisma.exam.create({
    data: { unitId: f.unit.id, title: 'Oracle exam', isPublished: true },
  });
  const question = await prisma.question.create({
    data: { examId: exam.id, type: 'MCQ', prompt: 'Pick the right option', points: 1 },
  });
  await prisma.answerOption.createMany({
    data: [
      { questionId: question.id, text: 'Right', isCorrect: true },
      { questionId: question.id, text: 'Wrong', isCorrect: false },
    ],
  });
  const product = await prisma.product.create({
    data: { name: 'Oracle exam pass', type: 'EXAM_PACKAGE', priceCents: 100, examId: exam.id },
  });
  await prisma.accessGrant.create({ data: { userId: f.student.id, productId: product.id } });
  const token = await login(f.student.email, 'Student@12345');
  return { ...f, exam, question, token };
}

function startAttempt(token: string, examId: string, idempotencyKey = randomUUID()) {
  return request(app)
    .post(`/api/exams/${examId}/attempts/start`)
    .set({ ...authHeaders(token), 'Idempotency-Key': idempotencyKey });
}

function submitAttempt(token: string, examId: string, sessionId: string, idempotencyKey: string, answers: unknown) {
  return request(app)
    .post(`/api/exams/${examId}/attempts`)
    .set({ ...authHeaders(token), 'Idempotency-Key': idempotencyKey })
    .send({ sessionId, answers });
}

async function beginAttempt(token: string, examId: string) {
  const idempotencyKey = randomUUID();
  const started = await startAttempt(token, examId, idempotencyKey);
  assert.equal(started.status, 201);
  return { idempotencyKey, sessionId: started.body.session.id as string };
}

beforeEach(reset);

describe('Security regressions', { concurrency: false }, () => {
  it('never exposes external lesson URLs through the public unit endpoint', async () => {
    const f = await fixtures();
    for (const token of [undefined, await login(f.student.email, 'Student@12345')]) {
      const response = await request(app)
        .get(`/api/catalog/units/${f.unit.id}`)
        .set(token ? authHeaders(token) : {});
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

    assert.equal((await request(app).get(`/api/catalog/lessons/${f.hiddenLesson.id}`).set(authHeaders(studentToken))).status, 404);
    assert.equal((await request(app).get(`/api/catalog/lessons/${f.hiddenLesson.id}`).set(authHeaders(adminToken))).status, 200);
  });

  it('does not return password hashes from admin student and payment APIs', async () => {
    const f = await fixtures();
    const token = await login(f.admin.email, 'Admin@12345');
    const payment = await request(app).post('/api/payments')
      .set(authHeaders(await login(f.student.email, 'Student@12345')))
      .send({ productId: f.product.id, method: 'INSTAPAY', reference: 'NO-HASH-1' });
    assert.equal(payment.status, 201);

    for (const path of ['/api/admin/students', `/api/admin/students/${f.student.id}`, `/api/admin/payments/${payment.body.payment.id}`]) {
      const response = await request(app).get(path).set(authHeaders(token));
      assert.equal(response.status, 200);
      assert.equal(JSON.stringify(response.body).includes('passwordHash'), false);
    }
  });

  it('rejects invalid enum filters with 400 instead of a server error', async () => {
    const f = await fixtures();
    const adminToken = await login(f.admin.email, 'Admin@12345');
    const studentToken = await login(f.student.email, 'Student@12345');
    assert.equal((await request(app).get('/api/admin/payments?status=bogus').set(authHeaders(adminToken))).status, 400);
    assert.equal((await request(app).get('/api/products?type=bogus').set(authHeaders(studentToken))).status, 400);
  });

  it('rejects duplicate payment references even when submitted concurrently', async () => {
    const f = await fixtures();
    const token = await login(f.student.email, 'Student@12345');
    const send = () => request(app).post('/api/payments')
      .set(authHeaders(token))
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
      .set(authHeaders(studentToken))
      .send({ productId: f.product.id, method: 'EWALLET', reference: 'APPROVE-1', amountCents: 1 });
    assert.equal(payment.status, 201);
    assert.equal(payment.body.payment.amountCents, f.product.priceCents);

    const rejected = await request(app).post('/api/payments')
      .set(authHeaders(studentToken))
      .send({ productId: f.otherProduct.id, method: 'EWALLET', reference: 'REJECT-1' });
    await request(app).patch(`/api/admin/payments/${rejected.body.payment.id}`)
      .set(authHeaders(adminToken))
      .send({ status: 'REJECTED' });

    const approvals = await Promise.all([
      request(app).patch(`/api/admin/payments/${payment.body.payment.id}`).set(authHeaders(adminToken)).send({ status: 'APPROVED' }),
      request(app).patch(`/api/admin/payments/${payment.body.payment.id}`).set(authHeaders(adminToken)).send({ status: 'APPROVED' }),
    ]);
    assert.deepEqual(approvals.map((r) => r.status).sort(), [200, 409]);

    const grants = await prisma.accessGrant.findMany({ where: { userId: f.student.id } });
    assert.equal(grants.length, 1);
    assert.equal(grants[0].productId, f.product.id);
    assert.equal((await request(app).get(`/api/catalog/lessons/${f.lesson.id}`).set(authHeaders(studentToken))).status, 200);
  });

  it('requires lesson access before clearing progress', async () => {
    const f = await fixtures();
    const token = await login(f.student.email, 'Student@12345');
    assert.equal((await request(app).delete(`/api/student/lessons/${f.lesson.id}/complete`).set(authHeaders(token))).status, 403);
    await prisma.accessGrant.create({ data: { userId: f.student.id, productId: f.product.id } });
    assert.equal((await request(app).delete(`/api/student/lessons/${f.lesson.id}/complete`).set(authHeaders(token))).status, 200);
  });

  it('never accepts a login token from a URL; only short-lived file tokens are scoped', async () => {
    const f = await fixtures();
    const token = await login(f.student.email, 'Student@12345');
    assert.equal((await request(app).get(`/api/admin/overview?token=${encodeURIComponent(token)}`)).status, 401);
    assert.equal((await request(app).get(`/api/files/missing?token=${encodeURIComponent(token)}`)).status, 401);
    assert.equal((await request(app).get(`/api/files/missing?ftoken=${encodeURIComponent(token)}`)).status, 401);
  });

  it('marks public config no-store so browsers never return an empty 304 body', async () => {
    const response = await request(app).get('/api/auth/config');
    assert.equal(response.status, 200);
    assert.match(response.headers['cache-control'] ?? '', /no-store/);
    assert.equal(response.body.demoMode, true);
  });

  it('does not leak external PDF URLs from anonymous subject and course catalogs', async () => {
    const f = await fixtures();
    for (const url of [`/api/catalog/subjects/${f.subject.id}`, `/api/catalog/courses/${f.course.id}`]) {
      const response = await request(app).get(url);
      assert.equal(response.status, 200);
      assert.equal(JSON.stringify(response.body).includes('secret.pdf'), false);
      assert.equal(JSON.stringify(response.body).includes('pdfUrl'), false);
      assert.equal(JSON.stringify(response.body).includes('videoUrl'), false);
    }
  });

  it('does not serve files linked to unpublished lessons', async () => {
    const f = await fixtures();
    const storedName = `hidden-${randomUUID()}.pdf`;
    fs.writeFileSync(path.join(config.uploadDir, storedName), '%PDF-1.4\nhidden\n%%EOF');
    const file = await prisma.fileAsset.create({
      data: { originalName: 'hidden.pdf', storedName, mimeType: 'application/pdf', sizeBytes: 21 },
    });
    await prisma.lesson.update({ where: { id: f.hiddenLesson.id }, data: { pdfFileId: file.id } });
    await prisma.accessGrant.create({ data: { userId: f.student.id, productId: f.product.id } });
    const token = await login(f.student.email, 'Student@12345');

    assert.equal((await request(app).get(`/api/files/${file.id}`).set(authHeaders(token))).status, 403);
    const adminToken = await login(f.admin.email, 'Admin@12345');
    assert.equal((await request(app).get(`/api/files/${file.id}`).set(authHeaders(adminToken))).status, 200);
  });

  it('never returns answer keys in exam feedback or stored attempts', async () => {
    const f = await fixtures();
    const exam = await prisma.exam.create({
      data: { unitId: f.unit.id, title: 'Security exam', isPublished: true },
    });
    const question = await prisma.question.create({
      data: { examId: exam.id, type: 'MCQ', prompt: 'Which answer is correct?', points: 1 },
    });
    await prisma.answerOption.createMany({
      data: [
        { questionId: question.id, text: 'Right', isCorrect: true },
        { questionId: question.id, text: 'Wrong', isCorrect: false },
      ],
    });
    const product = await prisma.product.create({
      data: { name: 'Exam pass', type: 'EXAM_PACKAGE', priceCents: 100, examId: exam.id },
    });
    await prisma.accessGrant.create({ data: { userId: f.student.id, productId: product.id } });
    const token = await login(f.student.email, 'Student@12345');

    const { idempotencyKey, sessionId } = await beginAttempt(token, exam.id);
    const response = await submitAttempt(token, exam.id, sessionId, idempotencyKey, {});
    assert.equal(response.status, 201);
    const body = JSON.stringify(response.body);
    assert.equal(body.includes('correctAnswers'), false);
    assert.equal(body.includes('correctOptionTexts'), false);
    assert.equal(body.includes('Right'), false);
    assertNoAnswerOracle(response.body, ['Right']);

    const stored = await prisma.examAttempt.findUniqueOrThrow({ where: { id: response.body.attempt.id } });
    assert.equal(JSON.stringify(stored.feedback).includes('correctAnswers'), false);
    assert.deepEqual(Object.keys((stored.feedback as Array<unknown>)[0] ?? {}), ['questionId']);

    const detail = await request(app).get(`/api/attempts/${stored.id}`).set(authHeaders(token));
    assert.equal(detail.status, 200);
    assert.equal(JSON.stringify(detail.body).includes('correctAnswers'), false);
    assertNoAnswerOracle(detail.body, ['Right']);
  });

  it('keeps server-side grading and first-attempt scoring correct without disclosing per-question correctness', async () => {
    const f = await gradedExamFixture();
    const options = await prisma.answerOption.findMany({ where: { questionId: f.question.id } });
    const right = options.find((option) => option.text === 'Right')!.id;
    const { idempotencyKey, sessionId } = await beginAttempt(f.token, f.exam.id);
    const response = await submitAttempt(f.token, f.exam.id, sessionId, idempotencyKey, { [f.question.id]: right });
    assert.equal(response.status, 201);
    assert.equal(response.body.attempt.score, 1);
    assert.equal(response.body.attempt.maxScore, 1);
    assert.equal(response.body.attempt.percent, 100);
    assert.equal(response.body.attempt.passed, true);
    assertNoAnswerOracle(response.body, ['Right']);

    const stored = await prisma.examAttempt.findUniqueOrThrow({ where: { id: response.body.attempt.id } });
    assert.equal(stored.score, 1);
    assert.deepEqual(Object.keys((stored.feedback as Array<unknown>)[0] ?? {}), ['questionId']);
  });

  it('does not expose correctness on repeated exam submissions', async () => {
    const f = await gradedExamFixture();
    const options = await prisma.answerOption.findMany({ where: { questionId: f.question.id } });
    const right = options.find((option) => option.text === 'Right')!.id;
    const wrong = options.find((option) => option.text === 'Wrong')!.id;

    const firstSession = await beginAttempt(f.token, f.exam.id);
    const first = await submitAttempt(f.token, f.exam.id, firstSession.sessionId, firstSession.idempotencyKey, { [f.question.id]: wrong });
    assert.equal(first.status, 201);
    assert.equal(typeof first.body.attempt.score, 'number');
    assertNoAnswerOracle(first.body, ['Right']);

    const secondSession = await beginAttempt(f.token, f.exam.id);
    const second = await submitAttempt(f.token, f.exam.id, secondSession.sessionId, secondSession.idempotencyKey, { [f.question.id]: right });
    assert.equal(second.status, 201);
    assert.equal(second.body.repeated, true);
    assert.deepEqual(Object.keys(second.body.attempt).sort(), ['id', 'submittedAt']);
    assert.equal(second.body.attempt.score, undefined);
    assert.equal(second.body.attempt.percent, undefined);
    assert.equal(second.body.feedback, undefined);
    assertNoAnswerOracle(second.body, ['Right']);

    const stored = await prisma.examAttempt.findUniqueOrThrow({ where: { id: second.body.attempt.id } });
    assert.deepEqual(Object.keys((stored.feedback as Array<unknown>)[0] ?? {}), ['questionId']);

    const detail = await request(app).get(`/api/attempts/${stored.id}`).set(authHeaders(f.token));
    assert.equal(detail.status, 200);
    assert.equal(detail.body.attempt.score, undefined);
    assert.equal(detail.body.attempt.percent, undefined);
    assertNoAnswerOracle(detail.body, ['Right']);

    const studentList = await request(app).get('/api/student/me/attempts').set(authHeaders(f.token));
    assert.equal(studentList.status, 200);
    const listed = studentList.body.attempts.find((attempt: { id: string }) => attempt.id === stored.id);
    assert.ok(listed);
    assert.equal(listed.score, undefined);
    assert.equal(JSON.stringify(listed).includes('feedback'), false);
  });

  it('does not create an answer oracle from concurrent duplicate submissions', async () => {
    const f = await gradedExamFixture();
    const options = await prisma.answerOption.findMany({ where: { questionId: f.question.id } });
    const wrong = options.find((option) => option.text === 'Wrong')!.id;
    const { idempotencyKey, sessionId } = await beginAttempt(f.token, f.exam.id);
    const payload = { [f.question.id]: wrong };

    const responses = await Promise.all([
      submitAttempt(f.token, f.exam.id, sessionId, idempotencyKey, payload),
      submitAttempt(f.token, f.exam.id, sessionId, idempotencyKey, payload),
    ]);
    assert.ok(responses.every((response) => response.status === 201 || response.status === 409));
    const successes = responses.filter((response) => response.status === 201);
    assert.equal(successes.length, 2);
    for (const response of successes) assertNoAnswerOracle(response.body, ['Right']);
    assert.equal(successes[0].body.attempt.id, successes[1].body.attempt.id);

    const attempts = await prisma.examAttempt.findMany({ where: { examId: f.exam.id, userId: f.student.id } });
    assert.equal(attempts.length, 1);
    assert.equal(successes[0].body.attempt.id, attempts[0].id);
  });

  it('does not let a student read another student’s exam result', async () => {
    const f = await gradedExamFixture();
    const options = await prisma.answerOption.findMany({ where: { questionId: f.question.id } });
    const right = options.find((option) => option.text === 'Right')!.id;
    const { idempotencyKey, sessionId } = await beginAttempt(f.token, f.exam.id);
    const attempt = await submitAttempt(f.token, f.exam.id, sessionId, idempotencyKey, { [f.question.id]: right });
    assert.equal(attempt.status, 201);

    const other = await prisma.user.create({
      data: {
        name: 'Other Student',
        email: `other-${randomUUID()}@security.local`,
        passwordHash: await bcrypt.hash('Other@12345', 4),
        status: 'ACTIVE',
      },
    });
    const otherToken = await login(other.email, 'Other@12345');
    assert.equal((await request(app).get(`/api/attempts/${attempt.body.attempt.id}`).set(authHeaders(otherToken))).status, 403);
  });

  it('issues file-scoped short-lived tokens that cannot be reused elsewhere', async () => {
    const f = await fixtures();
    const makeFile = async (name: string) => {
      const storedName = `${name}-${randomUUID()}.pdf`;
      fs.writeFileSync(path.join(config.uploadDir, storedName), '%PDF-1.4\ntoken test\n%%EOF');
      return prisma.fileAsset.create({
        data: { originalName: `${name}.pdf`, storedName, mimeType: 'application/pdf', sizeBytes: 23 },
      });
    };
    const first = await makeFile('first');
    const second = await makeFile('second');
    await prisma.lesson.update({
      where: { id: f.lesson.id },
      data: { pdfFileId: first.id, mediaFileId: second.id },
    });
    await prisma.accessGrant.create({ data: { userId: f.student.id, productId: f.product.id } });
    const token = await login(f.student.email, 'Student@12345');
    const headers = authHeaders(token);

    const issued = await request(app).get(`/api/files/${first.id}/token`).set(headers);
    assert.equal(issued.status, 200);
    const fileToken = issued.body.token as string;
    assert.equal((await request(app).get(`/api/files/${first.id}?ftoken=${encodeURIComponent(fileToken)}`).set(headers)).status, 200);
    assert.equal((await request(app).get(`/api/files/${second.id}?ftoken=${encodeURIComponent(fileToken)}`).set(headers)).status, 401);
    assert.equal((await request(app).get('/api/student/dashboard').set({ ...headers, Authorization: `Bearer ${fileToken}` })).status, 401);
  });

  it('does not count successful logins toward the failed-login limit', async () => {
    const f = await fixtures();
    const agent = request.agent(app);
    for (let i = 0; i < 12; i += 1) {
      const response = await agent.post('/api/auth/login').send({ email: f.student.email, password: 'Student@12345' });
      assert.equal(response.status, 200);
    }
    const keys = rateLimitKeysForTest();
    assert.equal(keys.some((key) => key.includes(f.student.email)), false);
    assert.equal(keys.some((key) => key.includes('student@security.local')), false);
    assert.ok(keys.every((key) => /^login-/.test(key)));
  });

  it('limits failed logins by composite email/IP key and returns Retry-After', async () => {
    const email = `brute-${randomUUID()}@test.local`;
    for (let i = 0; i < 10; i += 1) {
      assert.equal((await request(app).post('/api/auth/login').send({ email, password: 'Wrong@12345' })).status, 401);
    }
    const limited = await request(app).post('/api/auth/login').send({ email, password: 'Wrong@12345' });
    assert.equal(limited.status, 429);
    assert.match(String(limited.headers['retry-after']), /^\d+$/);
    assert.ok(Number(limited.headers['retry-after']) > 0);
    assert.equal(limited.headers['ratelimit-limit'], '10');
    const keys = rateLimitKeysForTest();
    assert.equal(keys.some((key) => key.includes(email)), false);
    assert.ok(keys.some((key) => key.startsWith('login-email-ip:')));
  });

  it('does not let an attacker lock a victim by email from another IP', async () => {
    // Test-only proxy trust simulates distinct clients; production app.ts keeps
    // Express trust proxy disabled and never reads X-Forwarded-For directly.
    const proxyApp = createApp();
    proxyApp.set('trust proxy', true);
    const email = `victim-${randomUUID()}@test.local`;
    await prisma.user.create({
      data: { name: 'Victim', email, passwordHash: await bcrypt.hash('Victim@12345', 4), status: 'ACTIVE' },
    });

    for (let i = 0; i < 11; i += 1) {
      const response = await request(proxyApp)
        .post('/api/auth/login')
        .set('X-Forwarded-For', '203.0.113.10')
        .send({ email, password: 'Wrong@12345' });
      assert.equal(response.status, i < 10 ? 401 : 429);
    }
    const victimLogin = await request(proxyApp)
      .post('/api/auth/login')
      .set('X-Forwarded-For', '203.0.113.20')
      .send({ email, password: 'Victim@12345' });
    assert.equal(victimLogin.status, 200);

    const keys = rateLimitKeysForTest();
    assert.equal(keys.some((key) => key.includes(email)), false);
    assert.ok(keys.some((key) => key.startsWith('login-email-ip:')));
  });

  it('handles invalid or missing login email safely and still limits failures', async () => {
    const missing = await request(app).post('/api/auth/login').send({ password: 'Wrong@12345' });
    assert.equal(missing.status, 400);
    resetRateLimits();

    for (let i = 0; i < 10; i += 1) {
      assert.equal(
        (await request(app).post('/api/auth/login').send({ email: 'not-an-email', password: 'Wrong@12345' })).status,
        400,
      );
    }
    const limited = await request(app).post('/api/auth/login').send({ email: 'not-an-email', password: 'Wrong@12345' });
    assert.equal(limited.status, 429);
    assert.match(String(limited.headers['retry-after']), /^\d+$/);
    assert.ok(rateLimitKeysForTest().every((key) => !key.includes('not-an-email')));
  });

  it('recovers the failed-login limit after the configured window', async () => {
    const email = `window-${randomUUID()}@test.local`;
    let now = 1_800_000_000_000;
    setRateLimitClockForTest(() => now);
    try {
      for (let i = 0; i < 10; i += 1) {
        assert.equal((await request(app).post('/api/auth/login').send({ email, password: 'Wrong@12345' })).status, 401);
      }
      assert.equal((await request(app).post('/api/auth/login').send({ email, password: 'Wrong@12345' })).status, 429);

      now += 15 * 60 * 1000 + 1;
      const recovered = await request(app).post('/api/auth/login').send({ email, password: 'Wrong@12345' });
      assert.equal(recovered.status, 401);
      assert.equal(recovered.headers['retry-after'], undefined);
    } finally {
      resetRateLimitClockForTest();
    }
  });

  it('rejects a payment reference already submitted by another user', async () => {
    const f = await fixtures();
    const other = await prisma.user.create({
      data: {
        name: 'Other Payer',
        email: 'other-payer@security.local',
        passwordHash: await bcrypt.hash('Other!123456', 4),
        status: 'ACTIVE',
      },
    });
    const otherToken = await login(other.email, 'Other!123456');
    const token = await login(f.student.email, 'Student@12345');
    const send = (authToken: string) =>
      request(app)
        .post('/api/payments')
        .set(authHeaders(authToken))
        .send({ productId: f.product.id, method: 'EWALLET', reference: 'GLOBAL-REF-1' });

    assert.equal((await send(otherToken)).status, 201);
    assert.equal((await send(token)).status, 400);
    assert.equal(await prisma.paymentRequest.count({ where: { reference: 'GLOBAL-REF-1' } }), 1);
  });

  it('does not let a lesson grant unlock the whole course PDF', async () => {
    const f = await fixtures();
    const storedName = `course-${randomUUID()}.pdf`;
    fs.writeFileSync(path.join(config.uploadDir, storedName), '%PDF-1.4\ncourse\n%%EOF');
    const file = await prisma.fileAsset.create({
      data: { originalName: 'course.pdf', storedName, mimeType: 'application/pdf', sizeBytes: 22 },
    });
    await prisma.course.update({ where: { id: f.course.id }, data: { pdfFileId: file.id } });

    const lessonProduct = await prisma.product.create({
      data: { name: 'Lesson only', type: 'LESSON', priceCents: 100, lessonId: f.lesson.id },
    });
    await prisma.accessGrant.create({ data: { userId: f.student.id, productId: lessonProduct.id } });
    const token = await login(f.student.email, 'Student@12345');

    const catalog = await request(app).get(`/api/catalog/courses/${f.course.id}`).set(authHeaders(token));
    assert.equal(catalog.status, 200);
    assert.equal(catalog.body.unlocked, false);
    assert.equal((await request(app).get(`/api/files/${file.id}`).set(authHeaders(token))).status, 403);

    const subscription = await prisma.product.create({
      data: { name: 'Library subscription', type: 'MONTHLY', priceCents: 1000, durationDays: 30 },
    });
    await prisma.accessGrant.create({ data: { userId: f.student.id, productId: subscription.id } });
    const subscribed = await request(app).get(`/api/catalog/courses/${f.course.id}`).set(authHeaders(token));
    assert.equal(subscribed.body.unlocked, true);
    assert.equal((await request(app).get(`/api/files/${file.id}`).set(authHeaders(token))).status, 200);
  });

  it('returns a uniform duplicate-registration response without existing account data', async () => {
    const first = await request(app).post('/api/auth/register').send({
      name: 'First Applicant',
      email: 'duplicate@test.local',
      phone: '01000000001',
      password: 'StrongPass123!',
    });
    assert.equal(first.status, 201);
    const duplicate = await request(app).post('/api/auth/register').send({
      name: 'Second Applicant',
      email: 'duplicate@test.local',
      phone: '01000000002',
      password: 'StrongPass123!',
    });
    assert.equal(duplicate.status, 201);
    assert.equal(duplicate.body.user.name, 'Second Applicant');
    assert.equal(duplicate.body.user.phone, '01000000002');
    assert.notEqual(duplicate.body.user.id, first.body.user.id);
  });

  it('does not resurrect an old token after reject and reactivate', async () => {
    const f = await fixtures();
    const adminToken = await login(f.admin.email, 'Admin@12345');
    const user = await prisma.user.create({
      data: {
        name: 'Reactivate Me',
        email: 'reactivate@security.local',
        passwordHash: await bcrypt.hash('Reactivate@12345', 4),
      },
    });
    const token = await login(user.email, 'Reactivate@12345');

    assert.equal(
      (await request(app).patch(`/api/admin/students/${user.id}/status`).set(authHeaders(adminToken)).send({ status: 'REJECTED' })).status,
      200,
    );
    assert.equal(
      (await request(app).patch(`/api/admin/students/${user.id}/status`).set(authHeaders(adminToken)).send({ status: 'ACTIVE' })).status,
      200,
    );
    assert.equal((await request(app).get('/api/auth/me').set(authHeaders(token))).status, 401);
    assert.ok(await login(user.email, 'Reactivate@12345'));
  });
});
