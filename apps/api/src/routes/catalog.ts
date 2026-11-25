import { Router } from 'express';
import { asyncHandler, notFound } from '../lib/errors';
import { optionalAuth } from '../lib/auth';
import { prisma } from '../lib/prisma';
import { accessMap, lessonAccess } from '../services/access';

export const catalogRouter = Router();
catalogRouter.use(optionalAuth);

const fileSelect = { id: true, originalName: true, mimeType: true, sizeBytes: true } as const;

catalogRouter.get(
  '/subjects',
  asyncHandler(async (_req, res) => {
    const subjects = await prisma.subject.findMany({
      orderBy: { sortOrder: 'asc' },
      include: {
        courses: {
          orderBy: { sortOrder: 'asc' },
          select: { id: true, title: true, slug: true, description: true, level: true },
        },
      },
    });
    res.json({ subjects });
  }),
);

catalogRouter.get(
  '/subjects/:id',
  asyncHandler(async (req, res) => {
    const subject = await prisma.subject.findUnique({
      where: { id: req.params.id },
      include: {
        courses: {
          orderBy: { sortOrder: 'asc' },
          include: { _count: { select: { units: true } } },
        },
      },
    });
    if (!subject) throw notFound('المادة غير موجودة');
    res.json({ subject });
  }),
);

catalogRouter.get(
  '/courses/:id',
  asyncHandler(async (req, res) => {
    const course = await prisma.course.findUnique({
      where: { id: req.params.id },
      include: {
        subject: true,
        pdfFile: { select: fileSelect },
        units: {
          orderBy: { sortOrder: 'asc' },
          include: {
            pdfFile: { select: fileSelect },
            lessons: {
              orderBy: { sortOrder: 'asc' },
              select: {
                id: true,
                title: true,
                durationMinutes: true,
                sortOrder: true,
                isPublished: true,
                pdfFile: { select: fileSelect },
                mediaFile: { select: fileSelect },
              },
            },
            exams: {
              where: { isPublished: true },
              select: { id: true, title: true, passingScore: true },
              orderBy: { createdAt: 'desc' },
            },
          },
        },
      },
    });
    if (!course) throw notFound('الكورس غير موجود');

    let unlocked = { courses: new Set<string>(), units: new Set<string>(), lessons: new Set<string>() };
    let completedLessonIds: string[] = [];
    if (req.user) {
      const map = await accessMap(req.user.id);
      unlocked = map;
      if (req.user.role === 'ADMIN') {
        unlocked.lessons = new Set(course.units.flatMap((u) => u.lessons.map((l) => l.id)));
      }
      completedLessonIds = (
        await prisma.lessonProgress.findMany({
          where: { userId: req.user.id, lessonId: { in: course.units.flatMap((u) => u.lessons.map((l) => l.id)) } },
          select: { lessonId: true },
        })
      ).map((p) => p.lessonId);
    }

    const units = course.units.map((unit) => ({
      ...unit,
      lessons: unit.lessons
        .filter((lesson) => lesson.isPublished || req.user?.role === 'ADMIN')
        .map((lesson) => ({ ...lesson, unlocked: req.user?.role === 'ADMIN' || unlocked.lessons.has(lesson.id) })),
      unlocked: req.user?.role === 'ADMIN' || unlocked.units.has(unit.id),
    }));

    res.json({
      course: { ...course, units },
      completedLessonIds,
      unlocked: req.user?.role === 'ADMIN' || unlocked.courses.has(course.id),
    });
  }),
);

catalogRouter.get(
  '/units/:id',
  asyncHandler(async (req, res) => {
    // Metadata only: never expose external video/PDF URLs or unpublished lessons here.
    const unit = await prisma.unit.findUnique({
      where: { id: req.params.id },
      include: {
        course: { include: { subject: true, pdfFile: { select: fileSelect } } },
        pdfFile: { select: fileSelect },
        lessons: {
          where: req.user?.role === 'ADMIN' ? undefined : { isPublished: true },
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            title: true,
            sortOrder: true,
            durationMinutes: true,
            isPublished: true,
            pdfFile: { select: fileSelect },
            mediaFile: { select: fileSelect },
          },
        },
        exams: { where: { isPublished: true }, select: { id: true, title: true, passingScore: true } },
      },
    });
    if (!unit) throw notFound('الوحدة غير موجودة');

    const map = req.user ? await accessMap(req.user.id) : null;
    res.json({
      unit,
      lessons: unit.lessons.map((lesson) => ({
        ...lesson,
        unlocked: req.user?.role === 'ADMIN' || !!map?.lessons.has(lesson.id),
      })),
    });
  }),
);

catalogRouter.get(
  '/lessons/:id',
  asyncHandler(async (req, res) => {
    const access = req.user
      ? await lessonAccess(req.user.id, req.params.id)
      : { allowed: false, lesson: null };
    const lesson = await prisma.lesson.findUnique({
      where: { id: req.params.id },
      include: {
        unit: { include: { course: { include: { subject: true, pdfFile: { select: fileSelect } } }, pdfFile: { select: fileSelect } } },
        pdfFile: { select: fileSelect },
        mediaFile: { select: fileSelect },
        exams: { where: { isPublished: true }, select: { id: true, title: true, passingScore: true } },
      },
    });
    if (!lesson) throw notFound('الدرس غير موجود');
    if (!lesson.isPublished && req.user?.role !== 'ADMIN') throw notFound('الدرس غير موجود');

    const unlocked = req.user?.role === 'ADMIN' || access.allowed;
    if (!unlocked) {
      const suggestions = await prisma.product.findMany({
        where: {
          isActive: true,
          OR: [
            { lessonId: lesson.id },
            { unitId: lesson.unitId },
            { courseId: lesson.unit.courseId },
            { subjectId: lesson.unit.course.subjectId },
            { subjectId: null, courseId: null, unitId: null, lessonId: null },
          ],
        },
        orderBy: { priceCents: 'asc' },
        take: 5,
      });
      return res.status(403).json({
        error: { code: 'CONTENT_LOCKED', message: 'هذا الدرس مغلق. اختر باقة مناسبة لفتح المحتوى.' },
        lesson: { id: lesson.id, title: lesson.title, description: lesson.description },
        suggestions,
      });
    }

    let completed = false;
    if (req.user) {
      completed = !!(await prisma.lessonProgress.findUnique({
        where: { userId_lessonId: { userId: req.user.id, lessonId: lesson.id } },
      }));
    }

    res.json({ lesson, unlocked: true, completed });
  }),
);
