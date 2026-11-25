import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, badRequest, forbidden, notFound } from '../lib/errors';
import { requireAuth, requireStudent } from '../lib/auth';
import { prisma } from '../lib/prisma';
import { examAccess } from '../services/access';
import { gradeAttempt, publicQuestion, type SubmittedAnswers } from '../services/grading';

export const examRouter = Router();
examRouter.use(requireAuth);

const answersSchema = z.record(z.string(), z.union([z.string(), z.array(z.string())]));

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

    res.json({
      exam: {
        id: exam.id,
        title: exam.title,
        description: exam.description,
        passingScore: exam.passingScore,
        timeLimitMinutes: exam.timeLimitMinutes,
        courseTitle: exam.unit?.course.title ?? exam.lesson?.title ?? '—',
        questionCount: exam.questions.length,
      },
      questions: exam.questions.map(publicQuestion),
      attempts,
    });
  }),
);

examRouter.post(
  '/exams/:id/attempts',
  requireStudent,
  asyncHandler(async (req, res) => {
    const answers = answersSchema.parse(req.body.answers) as SubmittedAnswers;
    const access = await examAccess(req.user!.id, req.params.id);
    if (!access.allowed) throw forbidden('لا تملك صلاحية هذا الاختبار');

    const exam = await prisma.exam.findUnique({
      where: { id: req.params.id },
      include: {
        questions: { orderBy: { sortOrder: 'asc' }, include: { options: true } },
      },
    });
    if (!exam || !exam.isPublished) throw notFound('الاختبار غير متاح');

    const validIds = new Set(exam.questions.map((q) => q.id));
    if (Object.keys(answers).some((id) => !validIds.has(id))) {
      throw badRequest('توجد إجابات لأسئلة غير موجودة في هذا الاختبار');
    }

    const { feedback, score, maxScore, percent } = gradeAttempt(exam.questions, answers);
    const attempt = await prisma.examAttempt.create({
      data: {
        examId: exam.id,
        userId: req.user!.id,
        answers: answers as never,
        score,
        maxScore,
        passed: percent >= exam.passingScore,
        feedback: feedback as never,
      },
    });

    res.status(201).json({
      attempt: {
        id: attempt.id,
        score,
        maxScore,
        percent,
        passed: attempt.passed,
        submittedAt: attempt.submittedAt,
      },
      feedback: feedback.map((item) => {
        const question = exam.questions.find((q) => q.id === item.questionId)!;
        return {
          ...item,
          prompt: question.prompt,
          correctOptionTexts: question.options.filter((o) => o.isCorrect).map((o) => o.text),
        };
      }),
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

    const feedback = attempt.feedback as Array<{ questionId: string; correct: boolean; explanation?: string | null }>;
    const questions = await prisma.question.findMany({
      where: { examId: attempt.examId },
      select: { id: true, prompt: true },
    });

    res.json({
      attempt: {
        id: attempt.id,
        examTitle: attempt.exam.title,
        studentName: attempt.user.name,
        score: attempt.score,
        maxScore: attempt.maxScore,
        percent: attempt.maxScore ? Math.round((attempt.score / attempt.maxScore) * 100) : 0,
        passed: attempt.passed,
        submittedAt: attempt.submittedAt,
      },
      feedback: feedback.map((f) => ({ ...f, prompt: questions.find((q) => q.id === f.questionId)?.prompt ?? '' })),
    });
  }),
);
