import './setup';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, it } from 'node:test';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createApp } from '../src/app';
import { prisma } from '../src/lib/prisma';
import { authHeaders } from './helpers';
import { resetRateLimits } from '../src/lib/rateLimit';

const app = createApp();
const ORACLE_KEYS = new Set([
  'correct', 'correctAnswers', 'correctOptionTexts', 'isCorrect', 'earnedPoints', 'explanation',
  'expectedAnswer',
]);

function assertNoOracle(value: unknown, forbiddenText: string[] = []) {
  const serialized = JSON.stringify(value);
  for (const text of forbiddenText) {
    assert.equal(serialized.includes(text), false, `response disclosed answer text: ${text}`);
  }
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== 'object') return;
    for (const [key, child] of Object.entries(node)) {
      assert.equal(ORACLE_KEYS.has(key), false, `response disclosed oracle field: ${key}`);
      visit(child);
    }
  };
  visit(value);
}

async function reset() {
  resetRateLimits();
  await prisma.examAttempt.deleteMany();
  await prisma.examAttemptSession.deleteMany();
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

async function fixture(settings: { maxAttempts?: number | null; timeLimitMinutes?: number | null } = {}) {
  const student = await prisma.user.create({
    data: {
      name: 'Attempt Student',
      email: `student-${randomUUID()}@sa11.local`,
      passwordHash: await bcrypt.hash('Student@12345', 4),
      role: 'STUDENT',
    },
  });
  const subject = await prisma.subject.create({ data: { name: 'SA11', slug: `sa11-${randomUUID()}` } });
  const course = await prisma.course.create({ data: { subjectId: subject.id, title: 'SA11 course', slug: `sa11-c-${randomUUID()}` } });
  const unit = await prisma.unit.create({ data: { courseId: course.id, title: 'SA11 unit' } });
  const exam = await prisma.exam.create({
    data: {
      unitId: unit.id,
      title: 'Attempt policy exam',
      passingScore: 60,
      maxAttempts: settings.maxAttempts ?? null,
      timeLimitMinutes: settings.timeLimitMinutes ?? null,
      isPublished: true,
    },
  });
  const question = await prisma.question.create({
    data: {
      examId: exam.id,
      type: 'MCQ',
      prompt: 'Which option is correct?',
      points: 2,
      explanation: 'SECRET_EXPLANATION',
      expectedAnswer: 'SECRET_EXPECTED',
    },
  });
  await prisma.answerOption.createMany({
    data: [
      { questionId: question.id, text: 'RIGHT_SECRET', isCorrect: true },
      { questionId: question.id, text: 'WRONG_SECRET', isCorrect: false },
    ],
  });
  const product = await prisma.product.create({
    data: { name: 'SA11 exam pass', type: 'EXAM_PACKAGE', priceCents: 100, examId: exam.id },
  });
  await prisma.accessGrant.create({ data: { userId: student.id, productId: product.id } });

  const login = await request(app).post('/api/auth/login').send({ email: student.email, password: 'Student@12345' });
  assert.equal(login.status, 200);
  const token = login.body.token as string;
  const options = await prisma.answerOption.findMany({ where: { questionId: question.id } });
  const right = options.find((option) => option.text === 'RIGHT_SECRET')!.id;
  const wrong = options.find((option) => option.text === 'WRONG_SECRET')!.id;
  return { student, subject, course, unit, exam, question, product, token, right, wrong };
}

async function otherStudent(f: Awaited<ReturnType<typeof fixture>>) {
  const user = await prisma.user.create({
    data: {
      name: 'Other Student',
      email: `other-${randomUUID()}@sa11.local`,
      passwordHash: await bcrypt.hash('Other@12345', 4),
      role: 'STUDENT',
    },
  });
  await prisma.accessGrant.create({ data: { userId: user.id, productId: f.product.id } });
  const login = await request(app).post('/api/auth/login').send({ email: user.email, password: 'Other@12345' });
  assert.equal(login.status, 200);
  return { user, token: login.body.token as string };
}

function start(token: string, examId: string, key = randomUUID()) {
  return request(app)
    .post(`/api/exams/${examId}/attempts/start`)
    .set({ ...authHeaders(token), 'Idempotency-Key': key });
}

function submit(token: string, examId: string, sessionId: string, key: string, answers: Record<string, string>) {
  return request(app)
    .post(`/api/exams/${examId}/attempts`)
    .set({ ...authHeaders(token), 'Idempotency-Key': key })
    .send({ sessionId, answers });
}

function abandon(token: string, examId: string, sessionId: string) {
  return request(app)
    .post(`/api/exams/${examId}/attempts/session/abandon`)
    .set(authHeaders(token))
    .send({ sessionId });
}

async function begin(token: string, examId: string) {
  const key = randomUUID();
  const response = await start(token, examId, key);
  assert.equal(response.status, 201);
  return { key, sessionId: response.body.session.id as string };
}

beforeEach(reset);

describe('SA-11 durable exam attempt policy', { concurrency: false }, () => {
  it('enforces maxAttempts and counts existing persisted attempts', async () => {
    const f = await fixture({ maxAttempts: 3 });
    await prisma.examAttempt.create({
      data: {
        examId: f.exam.id,
        userId: f.student.id,
        answers: { [f.question.id]: f.wrong } as never,
        score: 0,
        maxScore: 2,
        passed: false,
        feedback: [] as never,
      },
    });

    const first = await begin(f.token, f.exam.id);
    const one = await submit(f.token, f.exam.id, first.sessionId, first.key, { [f.question.id]: f.wrong });
    assert.equal(one.status, 201);

    const second = await begin(f.token, f.exam.id);
    const two = await submit(f.token, f.exam.id, second.sessionId, second.key, { [f.question.id]: f.wrong });
    assert.equal(two.status, 201);

    const blocked = await start(f.token, f.exam.id);
    assert.equal(blocked.status, 403);
    assert.equal(await prisma.examAttempt.count({ where: { examId: f.exam.id, userId: f.student.id } }), 3);
    assert.equal(await prisma.examAttemptSession.count({ where: { userId: f.student.id, examId: f.exam.id } }), 2);
  });

  it('allows unlimited attempts when maxAttempts is NULL and preserves first-attempt scoring', async () => {
    const f = await fixture({ maxAttempts: null });
    const first = await begin(f.token, f.exam.id);
    const one = await submit(f.token, f.exam.id, first.sessionId, first.key, { [f.question.id]: f.right });
    assert.equal(one.status, 201);
    assert.equal(one.body.attempt.score, 2);
    assert.equal(one.body.attempt.maxScore, 2);
    assert.equal(one.body.attempt.percent, 100);
    assert.equal(one.body.attempt.passed, true);

    const second = await begin(f.token, f.exam.id);
    const two = await submit(f.token, f.exam.id, second.sessionId, second.key, { [f.question.id]: f.wrong });
    assert.equal(two.status, 201);
    assert.equal(two.body.repeated, true);
    assert.deepEqual(Object.keys(two.body.attempt).sort(), ['id', 'submittedAt']);
    assert.equal(two.body.attempt.score, undefined);
    assert.equal(await prisma.examAttempt.count({ where: { examId: f.exam.id, userId: f.student.id } }), 2);
  });

  it('prevents two concurrent starts from bypassing the limit', async () => {
    const f = await fixture({ maxAttempts: 1 });
    const responses = await Promise.all([start(f.token, f.exam.id), start(f.token, f.exam.id)]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [201, 403]);
    assert.equal(await prisma.examAttemptSession.count({ where: { userId: f.student.id, examId: f.exam.id } }), 1);
  });

  it('prevents different idempotency keys from bypassing the limit', async () => {
    const f = await fixture({ maxAttempts: 1 });
    const first = await begin(f.token, f.exam.id);
    await submit(f.token, f.exam.id, first.sessionId, first.key, { [f.question.id]: f.right });

    const blocked = await start(f.token, f.exam.id);
    assert.equal(blocked.status, 403);
    assert.equal(await prisma.examAttempt.count({ where: { examId: f.exam.id, userId: f.student.id } }), 1);
  });

  it('returns the same session and receipt for a repeated idempotency key', async () => {
    const f = await fixture();
    const key = randomUUID();
    const first = await start(f.token, f.exam.id, key);
    assert.equal(first.status, 201);
    const replaySession = await start(f.token, f.exam.id, key);
    assert.equal(replaySession.status, 200);
    assert.equal(replaySession.body.session.id, first.body.session.id);
    assert.equal(await prisma.examAttemptSession.count({ where: { userId: f.student.id, examId: f.exam.id } }), 1);

    const submitted = await submit(f.token, f.exam.id, first.body.session.id, key, { [f.question.id]: f.right });
    assert.equal(submitted.status, 201);
    const replayReceipt = await start(f.token, f.exam.id, key);
    assert.equal(replayReceipt.status, 200);
    assert.equal(replayReceipt.body.session.status, 'submitted');
    assert.equal(replayReceipt.body.attempt.id, submitted.body.attempt.id);
    assert.equal(await prisma.examAttempt.count({ where: { examId: f.exam.id, userId: f.student.id } }), 1);
  });

  it('prevents two concurrent submissions from creating duplicate attempts', async () => {
    const f = await fixture();
    const { key, sessionId } = await begin(f.token, f.exam.id);
    const responses = await Promise.all([
      submit(f.token, f.exam.id, sessionId, key, { [f.question.id]: f.right }),
      submit(f.token, f.exam.id, sessionId, key, { [f.question.id]: f.right }),
    ]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [201, 201]);
    assert.equal(responses[0].body.attempt.id, responses[1].body.attempt.id);
    assert.equal(await prisma.examAttempt.count({ where: { examId: f.exam.id, userId: f.student.id } }), 1);
    assert.equal(await prisma.examAttemptSession.count({ where: { id: sessionId, submittedAt: { not: null } } }), 1);
  });

  it('rejects a timed-out session using the server clock and allows a fresh one', async () => {
    const f = await fixture({ timeLimitMinutes: 1 });
    const first = await begin(f.token, f.exam.id);
    await prisma.examAttemptSession.update({
      where: { id: first.sessionId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const late = await submit(f.token, f.exam.id, first.sessionId, first.key, { [f.question.id]: f.right });
    assert.equal(late.status, 403);
    assert.equal(await prisma.examAttempt.count({ where: { examId: f.exam.id, userId: f.student.id } }), 0);
    const expired = await prisma.examAttemptSession.findUniqueOrThrow({ where: { id: first.sessionId } });
    assert.ok(expired.abandonedAt);

    const second = await begin(f.token, f.exam.id);
    const onTime = await submit(f.token, f.exam.id, second.sessionId, second.key, { [f.question.id]: f.right });
    assert.equal(onTime.status, 201);
  });

  it('does not impose a deadline when timeLimitMinutes is NULL', async () => {
    const f = await fixture({ timeLimitMinutes: null });
    const { key, sessionId } = await begin(f.token, f.exam.id);
    const session = await prisma.examAttemptSession.findUniqueOrThrow({ where: { id: sessionId } });
    assert.equal(session.expiresAt, null);
    const response = await submit(f.token, f.exam.id, sessionId, key, { [f.question.id]: f.right });
    assert.equal(response.status, 201);
  });

  it('handles abandoned sessions deterministically without allowing delayed submission', async () => {
    const f = await fixture();
    const first = await begin(f.token, f.exam.id);
    assert.equal((await abandon(f.token, f.exam.id, first.sessionId)).status, 200);

    const late = await submit(f.token, f.exam.id, first.sessionId, first.key, { [f.question.id]: f.right });
    assert.equal(late.status, 409);
    assert.equal(await prisma.examAttempt.count({ where: { examId: f.exam.id, userId: f.student.id } }), 0);

    const sameKey = await start(f.token, f.exam.id, first.key);
    assert.equal(sameKey.status, 200);
    assert.equal(sameKey.body.session.status, 'abandoned');
    assert.equal(await prisma.examAttemptSession.count({ where: { userId: f.student.id, examId: f.exam.id } }), 1);

    const second = await begin(f.token, f.exam.id);
    const response = await submit(f.token, f.exam.id, second.sessionId, second.key, { [f.question.id]: f.right });
    assert.equal(response.status, 201);
  });

  it('enforces ownership of sessions and attempts for students', async () => {
    const f = await fixture();
    const other = await otherStudent(f);
    const first = await begin(f.token, f.exam.id);

    const foreignSubmit = await submit(other.token, f.exam.id, first.sessionId, randomUUID(), { [f.question.id]: f.right });
    assert.equal(foreignSubmit.status, 404);
    const foreignAbandon = await abandon(other.token, f.exam.id, first.sessionId);
    assert.equal(foreignAbandon.status, 404);
    assert.equal(await prisma.examAttempt.count({ where: { userId: other.user.id } }), 0);

    const response = await submit(f.token, f.exam.id, first.sessionId, first.key, { [f.question.id]: f.right });
    assert.equal(response.status, 201);
    const foreignRead = await request(app).get(`/api/attempts/${response.body.attempt.id}`).set(authHeaders(other.token));
    assert.equal(foreignRead.status, 403);
  });

  it('never discloses an answer key or per-question correctness', async () => {
    const f = await fixture();
    const { key, sessionId } = await begin(f.token, f.exam.id);
    const started = await start(f.token, f.exam.id, key);
    const submitted = await submit(f.token, f.exam.id, sessionId, key, { [f.question.id]: f.right });
    const examDetail = await request(app).get(`/api/exams/${f.exam.id}`).set(authHeaders(f.token));
    const attemptDetail = await request(app).get(`/api/attempts/${submitted.body.attempt.id}`).set(authHeaders(f.token));

    for (const response of [started, submitted, examDetail, attemptDetail]) {
      assert.equal(response.status, 200 + (response === submitted ? 1 : 0));
      assertNoOracle(response.body, ['SECRET_EXPLANATION', 'SECRET_EXPECTED']);
    }
    const stored = await prisma.examAttempt.findUniqueOrThrow({ where: { id: submitted.body.attempt.id } });
    assert.deepEqual(Object.keys((stored.feedback as Array<unknown>)[0] ?? {}), ['questionId']);
  });

  it('preserves server-side grading and stored answers for the first attempt', async () => {
    const f = await fixture();
    const { key, sessionId } = await begin(f.token, f.exam.id);
    const response = await submit(f.token, f.exam.id, sessionId, key, { [f.question.id]: f.right });
    assert.equal(response.status, 201);
    assert.equal(response.body.attempt.score, 2);
    assert.equal(response.body.attempt.maxScore, 2);
    assert.equal(response.body.attempt.percent, 100);
    assert.equal(response.body.attempt.passed, true);
    assert.deepEqual(response.body.feedback.map((item: { questionId: string }) => item.questionId), [f.question.id]);

    const stored = await prisma.examAttempt.findUniqueOrThrow({ where: { id: response.body.attempt.id } });
    assert.equal(stored.score, 2);
    assert.equal(stored.maxScore, 2);
    assert.equal(stored.passed, true);
    assert.deepEqual(stored.answers, { [f.question.id]: f.right });
    assert.equal(stored.startedAt instanceof Date, true);
    assert.equal(stored.sessionId, sessionId);
  });
});
