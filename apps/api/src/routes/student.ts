import { Router } from 'express';
import { asyncHandler, forbidden, notFound } from '../lib/errors';
import { requireAuth, requireStudent } from '../lib/auth';
import { prisma } from '../lib/prisma';
import { accessMap, lessonAccess } from '../services/access';

export const studentRouter = Router();
studentRouter.use(requireAuth);

studentRouter.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const map = await accessMap(user.id);
    const accessibleCourseIds =
      user.role === 'ADMIN'
        ? (await prisma.course.findMany({ select: { id: true } })).map((c) => c.id)
        : [...map.courses];

    const courses = await prisma.course.findMany({
      where: { id: { in: accessibleCourseIds } },
      include: {
        subject: true,
        units: {
          include: {
            lessons: {
              where: { isPublished: true },
              select: { id: true, title: true, sortOrder: true, unitId: true },
            },
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    const allLessonIds = courses.flatMap((c) => c.units.flatMap((u) => u.lessons.map((l) => l.id)));
    const completed = await prisma.lessonProgress.findMany({
      where: { userId: user.id, lessonId: { in: allLessonIds } },
      select: { lessonId: true, completedAt: true },
    });
    const completedIds = new Set(completed.map((p) => p.lessonId));

    const enrolled = courses.map((course) => {
      const lessons = course.units.flatMap((u) =>
        u.lessons.map((l) => ({ ...l, unitTitle: u.title, unlocked: map.lessons.has(l.id) || user.role === 'ADMIN' })),
      );
      const done = lessons.filter((l) => completedIds.has(l.id)).length;
      const percent = lessons.length ? Math.round((done / lessons.length) * 100) : 0;
      return {
        id: course.id,
        title: course.title,
        subject: course.subject.name,
        subjectIcon: course.subject.icon,
        level: course.level,
        totalLessons: lessons.length,
        completedLessons: done,
        progress: percent,
        unitsCount: course.units.length,
        nextLesson: lessons.find((l) => !completedIds.has(l.id) && l.unlocked) ?? null,
      };
    });

    const continueLearning = enrolled
      .filter((course) => course.nextLesson)
      .map((course) => ({ courseId: course.id, courseTitle: course.title, lesson: course.nextLesson! }))
      .slice(0, 3);

    const [grants, attempts, payments] = await Promise.all([
      prisma.accessGrant.findMany({
        where: { userId: user.id },
        include: { product: true },
        orderBy: { grantedAt: 'desc' },
      }),
      prisma.examAttempt.findMany({
        where: { userId: user.id },
        include: { exam: { include: { unit: { include: { course: true } }, lesson: true } } },
        orderBy: { submittedAt: 'desc' },
        take: 5,
      }),
      prisma.paymentRequest.findMany({
        where: { userId: user.id },
        include: { product: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    res.json({
      enrolled,
      continueLearning,
      purchases: grants.map((g) => ({
        id: g.id,
        productName: g.product.name,
        type: g.product.type,
        grantedAt: g.grantedAt,
        expiresAt: g.expiresAt,
        permanent: g.expiresAt === null,
      })),
      recentAttempts: attempts.map((a) => ({
        id: a.id,
        examTitle: a.exam.title,
        courseTitle: a.exam.unit?.course.title ?? a.exam.lesson?.title ?? '—',
        score: a.score,
        maxScore: a.maxScore,
        percent: a.maxScore ? Math.round((a.score / a.maxScore) * 100) : 0,
        passed: a.passed,
        submittedAt: a.submittedAt,
      })),
      pendingPayments: payments.filter((p) => p.status === 'PENDING').map((p) => ({
        id: p.id,
        productName: p.product.name,
        amountCents: p.amountCents,
        method: p.method,
        reference: p.reference,
        status: p.status,
        createdAt: p.createdAt,
      })),
      stats: {
        courses: enrolled.length,
        completedLessons: completedIds.size,
        averageProgress: enrolled.length
          ? Math.round(enrolled.reduce((sum, c) => sum + c.progress, 0) / enrolled.length)
          : 0,
        examsTaken: attempts.length,
      },
    });
  }),
);

studentRouter.get(
  '/me/access',
  asyncHandler(async (req, res) => {
    const grants = await prisma.accessGrant.findMany({
      where: { userId: req.user!.id },
      include: { product: true },
      orderBy: { grantedAt: 'desc' },
    });
    res.json({ grants });
  }),
);

studentRouter.get(
  '/me/attempts',
  asyncHandler(async (req, res) => {
    const attempts = await prisma.examAttempt.findMany({
      where: { userId: req.user!.id },
      include: { exam: { include: { unit: { include: { course: true } } } } },
      orderBy: { submittedAt: 'desc' },
    });
    res.json({ attempts });
  }),
);

studentRouter.post(
  '/lessons/:id/complete',
  requireStudent,
  asyncHandler(async (req, res) => {
    const access = await lessonAccess(req.user!.id, req.params.id);
    if (!access.allowed) throw forbidden('يجب فتح هذا الدرس أولاً قبل تسجيل الإكمال');

    const progress = await prisma.lessonProgress.upsert({
      where: { userId_lessonId: { userId: req.user!.id, lessonId: req.params.id } },
      create: { userId: req.user!.id, lessonId: req.params.id },
      update: {},
    });
    res.json({ progress, completed: true });
  }),
);

studentRouter.delete(
  '/lessons/:id/complete',
  requireStudent,
  asyncHandler(async (req, res) => {
    const access = await lessonAccess(req.user!.id, req.params.id);
    if (!access.allowed) throw forbidden('يجب فتح هذا الدرس أولاً قبل تعديل الإكمال');
    await prisma.lessonProgress.deleteMany({
      where: { userId: req.user!.id, lessonId: req.params.id },
    });
    res.json({ completed: false });
  }),
);

studentRouter.get(
  '/courses/:id/progress',
  asyncHandler(async (req, res) => {
    const course = await prisma.course.findUnique({
      where: { id: req.params.id },
      include: { units: { include: { lessons: { where: { isPublished: true }, select: { id: true } } } } },
    });
    if (!course) throw notFound('الكورس غير موجود');
    const ids = course.units.flatMap((u) => u.lessons.map((l) => l.id));
    const done = await prisma.lessonProgress.count({ where: { userId: req.user!.id, lessonId: { in: ids } } });
    res.json({
      courseId: course.id,
      completed: done,
      total: ids.length,
      percent: ids.length ? Math.round((done / ids.length) * 100) : 0,
    });
  }),
);
