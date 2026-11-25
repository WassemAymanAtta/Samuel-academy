import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, badRequest, forbidden, notFound } from '../lib/errors';
import { requireAuth, requireStudent } from '../lib/auth';
import { prisma } from '../lib/prisma';
import { examAccess } from '../services/access';
import { firstAttemptIdFor, safeFeedback } from '../services/examDisclosure';
import { publicQuestion, type SubmittedAnswers } from '../services/grading';
import {
  abandonAttemptSession,
  receiptForSession,
  sessionState,
  startAttemptSession,
  submitAttemptSession,
} from '../services/examAttemptSessions';

export const examRouter = Router();
examRouter.use(requireAuth);

// Bounded arrays are an interim mitigation for the Zod advisory: a hostile
// authenticated payload cannot create thousands of validation issues under 1 MB.
const answersSchema = z
  .record(
    z.string().max(100),
    z.union([z.string().max(2000), z.array(z.string().max(200)).max(50)]),
  )
  .refine((value) => Object.keys(value).length <= 500, { message: 'عدد الإجابات كبير جداً' });

function idempotencyKeyFrom(req: { header: (name: string) => string | undefined }) {
  return z.string().uuid().parse(req.header('Idempotency-Key'));
}

async function loadAttemptExam(userId: string, examId: string) {
  const access = await examAccess(userId, examId);
  if (!access.allowed) throw forbidden('لا تملك صلاحية هذا الاختبار');

  const exam = await prisma.exam.findUnique({
    where: { id: examId },
    include: {
      questions: { orderBy: { sortOrder: 'asc' }, include: { options: true } },
    },
  });
  if (!exam || !exam.isPublished) throw notFound('الاختبار غير متاح');
  return exam;
}

examRouter.get(
  '/exams/:id',
  asyncHandler(async (req, res) => {
    const exam = await prisma.exam.findUnique({
      where: { id: req.params.id },
      include: {
        unit: { include: { course: { include: { subject: true } } } },
        lesson: true,
        questions: { orderBy: { sortOrder: 'asc' }, include: { options: { orderBy: { sortOrder: 'asc' } } } },
      },
    });
    if (!exam || (!exam.isPublished && req.user!.role !== 'ADMIN')) throw notFound('الاختبار غير موجود');

    const access = await examAccess(req.user!.id, exam.id);
    if (!access.allowed && req.user!.role !== 'ADMIN') {
      return res.status(403).json({
        error: { code: 'CONTENT_LOCKED', message: 'هذا الاختبار مغلق. اشترِ باقة الأسئلة أو الاشتراك المناسب.' },
        exam: { id: exam.id, title: exam.title, description: exam.description },
      });
    }

    const attempts = await prisma.examAttempt.findMany({
      where: { examId: exam.id, userId: req.user!.id },
      orderBy: { submittedAt: 'desc' },
      take: 5,
      select: { id: true, score: true, maxScore: true, passed: true, submittedAt: true },
    });
    const firstId = req.user!.role === 'ADMIN' ? null : await firstAttemptIdFor(req.user!.id, exam.id);
    // Students see a score only for their first attempt; later scores would
    // turn the grade into an answer oracle.
    const visibleAttempts = attempts.map((attempt) =>
      req.user!.role === 'ADMIN' || attempt.id === firstId
        ? attempt
        : { id: attempt.id, submittedAt: attempt.submittedAt },
    );

    res.json({
      exam: {
        id: exam.id,
        title: exam.title,
        description: exam.description,
        passingScore: exam.passingScore,
        timeLimitMinutes: exam.timeLimitMinutes,
        maxAttempts: exam.maxAttempts,
        courseTitle: exam.unit?.course.title ?? exam.lesson?.title ?? '—',
        questionCount: exam.questions.length,
      },
      questions: exam.questions.map(publicQuestion),
      attempts: visibleAttempts,
    });
  }),
);

examRouter.post(
  '/exams/:id/attempts/start',
  requireStudent,
  asyncHandler(async (req, res) => {
    const idempotencyKey = idempotencyKeyFrom(req);
    const exam = await loadAttemptExam(req.user!.id, req.params.id);
    const { session, created, now } = await startAttemptSession({
      exam,
      userId: req.user!.id,
      idempotencyKey,
    });
    const status = sessionState(session, now);
    const receipt = status === 'submitted' ? await receiptForSession(session.id) : null;

    res.status(created ? 201 : 200).json({
      session: {
        id: session.id,
        status,
        startedAt: session.startedAt,
        expiresAt: session.expiresAt,
        idempotencyKey: session.idempotencyKey,
      },
      exam: { maxAttempts: exam.maxAttempts, timeLimitMinutes: exam.timeLimitMinutes },
      ...(receipt ? { attempt: receipt } : {}),
    });
  }),
);

examRouter.post(
  '/exams/:id/attempts/session/abandon',
  requireStudent,
  asyncHandler(async (req, res) => {
    const { sessionId } = z.object({ sessionId: z.string().min(1) }).parse(req.body);
    await loadAttemptExam(req.user!.id, req.params.id);
    await abandonAttemptSession({ userId: req.user!.id, examId: req.params.id, sessionId });
    res.json({ ok: true });
  }),
);

examRouter.post(
  '/exams/:id/attempts',
  requireStudent,
  asyncHandler(async (req, res) => {
    const idempotencyKey = idempotencyKeyFrom(req);
    const body = z
      .object({ sessionId: z.string().min(1), answers: answersSchema })
      .parse(req.body);
    const answers = body.answers as SubmittedAnswers;
    const exam = await loadAttemptExam(req.user!.id, req.params.id);

    const validIds = new Set(exam.questions.map((q) => q.id));
    if (Object.keys(answers).some((id) => !validIds.has(id))) {
      throw badRequest('توجد إجابات لأسئلة غير موجودة في هذا الاختبار');
    }

    const submitted = await submitAttemptSession({
      exam,
      userId: req.user!.id,
      sessionId: body.sessionId,
      idempotencyKey,
      answers,
    });
    if ('expired' in submitted) throw forbidden('انتهى وقت هذا الاختبار');
    const { attempt, isFirst } = submitted;
    const promptById = new Map(exam.questions.map((question) => [question.id, question.prompt]));
    const percent = attempt.maxScore === 0 ? 0 : Math.round((attempt.score / attempt.maxScore) * 100);

    if (!isFirst) {
      // Repeated attempts are recorded and graded, but disclose no score and no
      // feedback: otherwise the grade becomes a per-question answer oracle.
      return res.status(201).json({
        attempt: { id: attempt.id, submittedAt: attempt.submittedAt },
        repeated: true,
        message: 'تم تسجيل المحاولة. لا يتم عرض درجات المحاولات المتكررة.',
      });
    }

    res.status(201).json({
      attempt: {
        id: attempt.id,
        score: attempt.score,
        maxScore: attempt.maxScore,
        percent,
        passed: attempt.passed,
        submittedAt: attempt.submittedAt,
      },
      feedback: safeFeedback(attempt.feedback, promptById),
      passingScore: exam.passingScore,
    });
  }),
);

examRouter.get(
  '/attempts/:id',
  asyncHandler(async (req, res) => {
    const attempt = await prisma.examAttempt.findUnique({
      where: { id: req.params.id },
      include: { exam: { select: { title: true, passingScore: true } }, user: { select: { name: true } } },
    });
    if (!attempt) throw notFound('المحاولة غير موجودة');
    if (req.user!.role !== 'ADMIN' && attempt.userId !== req.user!.id) throw forbidden();

    const questions = await prisma.question.findMany({
      where: { examId: attempt.examId },
      select: { id: true, prompt: true },
    });
    const promptById = new Map(questions.map((question) => [question.id, question.prompt]));
    const isAdmin = req.user!.role === 'ADMIN';
    const firstId = isAdmin ? null : await firstAttemptIdFor(attempt.userId, attempt.examId);
    const discloseScore = isAdmin || attempt.id === firstId;

    const summary: Record<string, unknown> = {
      id: attempt.id,
      examTitle: attempt.exam.title,
      studentName: attempt.user.name,
      submittedAt: attempt.submittedAt,
    };
    if (discloseScore) {
      Object.assign(summary, {
        score: attempt.score,
        maxScore: attempt.maxScore,
        percent: attempt.maxScore ? Math.round((attempt.score / attempt.maxScore) * 100) : 0,
        passed: attempt.passed,
      });
    }

    res.json({
      attempt: summary,
      feedback: safeFeedback(attempt.feedback, promptById),
    });
  }),
);
