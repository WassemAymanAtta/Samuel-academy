import type { AnswerOption, Prisma, Question } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { conflict, forbidden, notFound } from '../lib/errors';
import { gradeAttempt, type SubmittedAnswers } from './grading';

type Tx = Prisma.TransactionClient;

export type AttemptExam = {
  id: string;
  passingScore: number;
  timeLimitMinutes: number | null;
  maxAttempts: number | null;
  questions: Array<Question & { options: AnswerOption[] }>;
};

export type SessionState = 'active' | 'submitted' | 'abandoned' | 'expired';

type SessionRow = {
  id: string;
  userId: string;
  examId: string;
  startedAt: Date;
  expiresAt: Date | null;
  submittedAt: Date | null;
  abandonedAt: Date | null;
  idempotencyKey: string | null;
};

type AttemptRow = {
  id: string;
  score: number;
  maxScore: number;
  passed: boolean;
  submittedAt: Date;
  feedback: Prisma.JsonValue;
};

/** Serialises all policy decisions for one student/exam pair on PostgreSQL. */
async function lockPair(tx: Tx, userId: string, examId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${userId}:${examId}`}, 0))`;
}

/** All deadlines come from the database clock, never from the browser. */
async function dbNow(tx: Tx): Promise<Date> {
  const rows = await tx.$queryRaw<Array<{ now: Date }>>`SELECT now() AS "now"`;
  return rows[0]!.now;
}

function isExpired(session: Pick<SessionRow, 'expiresAt'>, now: Date) {
  return session.expiresAt !== null && session.expiresAt.getTime() <= now.getTime();
}

export function sessionState(session: SessionRow, now: Date): SessionState {
  if (session.submittedAt) return 'submitted';
  if (session.abandonedAt) return 'abandoned';
  if (isExpired(session, now)) return 'expired';
  return 'active';
}

async function countUsed(tx: Tx, userId: string, examId: string, now: Date, excludeSessionId?: string) {
  const submitted = await tx.examAttempt.count({ where: { userId, examId } });
  const active = await tx.examAttemptSession.count({
    where: {
      userId,
      examId,
      ...(excludeSessionId ? { id: { not: excludeSessionId } } : {}),
      submittedAt: null,
      abandonedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
  });
  return submitted + active;
}

async function assertCapacity(
  tx: Tx,
  exam: Pick<AttemptExam, 'id' | 'maxAttempts'>,
  userId: string,
  now: Date,
  excludeSessionId?: string,
) {
  if (exam.maxAttempts === null) return;
  const used = await countUsed(tx, userId, exam.id, now, excludeSessionId);
  if (used >= exam.maxAttempts) {
    throw forbidden('لقد استنفدت عدد المحاولات المسموح لهذا الاختبار');
  }
}

function expiresAtFor(exam: Pick<AttemptExam, 'timeLimitMinutes'>, now: Date): Date | null {
  if (exam.timeLimitMinutes === null) return null;
  return new Date(now.getTime() + exam.timeLimitMinutes * 60_000);
}

export async function startAttemptSession(input: {
  exam: AttemptExam;
  userId: string;
  idempotencyKey: string;
}) {
  const { exam, userId, idempotencyKey } = input;
  return prisma.$transaction(async (tx) => {
    await lockPair(tx, userId, exam.id);
    const now = await dbNow(tx);

    // Same key always returns the same session; it never consumes a new slot.
    const existing = await tx.examAttemptSession.findUnique({
      where: { userId_examId_idempotencyKey: { userId, examId: exam.id, idempotencyKey } },
    });
    if (existing) return { session: existing as SessionRow, created: false, now };

    await assertCapacity(tx, exam, userId, now);

    const open = await tx.examAttemptSession.findFirst({
      where: { userId, examId: exam.id, submittedAt: null, abandonedAt: null },
      orderBy: { startedAt: 'desc' },
    });
    if (open) {
      if (!isExpired(open, now)) {
        throw conflict('لديك محاولة جارية بالفعل. أرسلها أو ألغِها قبل البدء من جديد');
      }
      // Deterministic lazy abandonment: every expired session is closed at the
      // same database timestamp and can never be submitted later.
      await tx.examAttemptSession.updateMany({
        where: {
          userId,
          examId: exam.id,
          submittedAt: null,
          abandonedAt: null,
          expiresAt: { lte: now },
        },
        data: { abandonedAt: now },
      });
    }

    const session = await tx.examAttemptSession.create({
      data: {
        userId,
        examId: exam.id,
        startedAt: now,
        expiresAt: expiresAtFor(exam, now),
        idempotencyKey,
      },
    });
    return { session: session as SessionRow, created: true, now };
  });
}

export async function submitAttemptSession(input: {
  exam: AttemptExam;
  userId: string;
  sessionId: string;
  idempotencyKey: string;
  answers: SubmittedAnswers;
}) {
  const { exam, userId, sessionId, idempotencyKey, answers } = input;
  return prisma.$transaction(async (tx) => {
    await lockPair(tx, userId, exam.id);
    const now = await dbNow(tx);

    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "ExamAttemptSession"
      WHERE "id" = ${sessionId} AND "userId" = ${userId} AND "examId" = ${exam.id}
      FOR UPDATE`;
    if (locked.length === 0) throw notFound('جلسة الاختبار غير موجودة');

    const session = await tx.examAttemptSession.findUniqueOrThrow({ where: { id: sessionId } }) as SessionRow;
    if (session.idempotencyKey !== idempotencyKey) {
      throw conflict('مفتاح الطلب لا يطابق جلسة الاختبار');
    }

    // Replaying the same submission returns the original persisted attempt.
    const replay = await tx.examAttempt.findUnique({
      where: { sessionId: session.id },
      select: { id: true, score: true, maxScore: true, passed: true, submittedAt: true, feedback: true },
    }) as AttemptRow | null;
    if (replay) {
      const first = await tx.examAttempt.findFirst({
        where: { userId, examId: exam.id },
        orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }],
        select: { id: true },
      });
      return { attempt: replay, isFirst: first?.id === replay.id, replay: true };
    }

    if (session.submittedAt) throw conflict('تم إرسال هذه الجلسة بالفعل');
    if (session.abandonedAt) throw conflict('تم إلغاء هذه الجلسة');
    if (isExpired(session, now)) {
      // Commit the deterministic abandonment, then let the route return 403.
      await tx.examAttemptSession.updateMany({
        where: { id: session.id, submittedAt: null, abandonedAt: null },
        data: { abandonedAt: now },
      });
      return { expired: true as const };
    }

    // The session being submitted already owns one slot; exclude it from the count.
    await assertCapacity(tx, exam, userId, now, session.id);

    const { feedback, score, maxScore, percent } = gradeAttempt(exam.questions, answers);
    const storedFeedback = feedback.map((item) => ({ questionId: item.questionId }));

    const attempt = await tx.examAttempt.create({
      data: {
        examId: exam.id,
        userId,
        answers: answers as never,
        score,
        maxScore,
        passed: percent >= exam.passingScore,
        feedback: storedFeedback as never,
        startedAt: session.startedAt,
        sessionId: session.id,
      },
      select: { id: true, score: true, maxScore: true, passed: true, submittedAt: true, feedback: true },
    }) as AttemptRow;

    const claimed = await tx.examAttemptSession.updateMany({
      where: { id: session.id, submittedAt: null, abandonedAt: null },
      data: { submittedAt: now },
    });
    if (claimed.count !== 1) throw conflict('تعذّر تأكيد إرسال الجلسة');

    const first = await tx.examAttempt.findFirst({
      where: { userId, examId: exam.id },
      orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    return { attempt, isFirst: first?.id === attempt.id, replay: false };
  });
}

export async function abandonAttemptSession(input: {
  userId: string;
  examId: string;
  sessionId: string;
}) {
  const { userId, examId, sessionId } = input;
  return prisma.$transaction(async (tx) => {
    await lockPair(tx, userId, examId);
    const now = await dbNow(tx);

    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "ExamAttemptSession"
      WHERE "id" = ${sessionId} AND "userId" = ${userId} AND "examId" = ${examId}
      FOR UPDATE`;
    if (locked.length === 0) throw notFound('جلسة الاختبار غير موجودة');

    const session = await tx.examAttemptSession.findUniqueOrThrow({ where: { id: sessionId } }) as SessionRow;
    if (session.submittedAt) throw conflict('تم إرسال هذه الجلسة بالفعل');
    if (session.abandonedAt) return { ok: true, now };

    await tx.examAttemptSession.updateMany({
      where: { id: session.id, submittedAt: null, abandonedAt: null },
      data: { abandonedAt: now },
    });
    return { ok: true, now };
  });
}

export async function receiptForSession(sessionId: string) {
  return prisma.examAttempt.findUnique({
    where: { sessionId },
    select: { id: true, submittedAt: true },
  });
}
