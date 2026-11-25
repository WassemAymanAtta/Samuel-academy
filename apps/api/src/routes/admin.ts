import { Router } from 'express';
import type { AccountStatus } from '@prisma/client';
import { z } from 'zod';
import { asyncHandler, badRequest, conflict, notFound } from '../lib/errors';
import { requireAdmin, requireAuth } from '../lib/auth';
import { prisma } from '../lib/prisma';
import { grantExpiry } from '../services/access';
import { slugify } from '../lib/util';

export const adminRouter = Router();
adminRouter.use(requireAuth);
adminRouter.use(requireAdmin);

const optionalText = z.string().trim().max(2000).optional().nullable();
const optionalUrl = z.string().trim().max(500).url('رابط غير صالح').optional().nullable();
const fileRef = z.string().min(1).optional().nullable();
const id = z.string().min(1);

const pdfFields = {
  pdfUrl: optionalUrl,
  pdfFileId: fileRef,
  pdfTitle: z.string().trim().max(150).optional().nullable(),
};

function rejectDualPdfSource(data: { pdfUrl?: string | null; pdfFileId?: string | null }, ctx: z.RefinementCtx) {
  if (data.pdfUrl && data.pdfFileId) {
    ctx.addIssue({ code: 'custom', path: ['pdfFileId'], message: 'اختر رابط PDF أو ملف مرفوع، وليس الاثنين معاً' });
  }
}

function rejectDualMediaSource(data: { videoUrl?: string | null; mediaFileId?: string | null }, ctx: z.RefinementCtx) {
  if (data.videoUrl && data.mediaFileId) {
    ctx.addIssue({ code: 'custom', path: ['mediaFileId'], message: 'اختر رابط فيديو أو ملف MP4/MP3 مرفوع، وليس الاثنين معاً' });
  }
}

const subjectSchema = z.object({
  name: z.string().trim().min(2).max(100),
  slug: z.string().trim().max(100).optional(),
  description: optionalText,
  icon: z.string().trim().max(20).optional().nullable(),
  sortOrder: z.number().int().default(0),
});

const courseSchema = z
  .object({
    subjectId: id,
    title: z.string().trim().min(2).max(150),
    slug: z.string().trim().max(120).optional(),
    description: optionalText,
    level: z.string().trim().max(60).optional().nullable(),
    ...pdfFields,
    sortOrder: z.number().int().default(0),
  })
  .superRefine(rejectDualPdfSource);

const unitSchema = z
  .object({
    courseId: id,
    title: z.string().trim().min(2).max(150),
    description: optionalText,
    ...pdfFields,
    sortOrder: z.number().int().default(0),
  })
  .superRefine(rejectDualPdfSource);

const lessonSchema = z
  .object({
    unitId: id,
    title: z.string().trim().min(2).max(150),
    description: optionalText,
    videoUrl: optionalUrl,
    mediaFileId: fileRef,
    mediaTitle: z.string().trim().max(150).optional().nullable(),
    ...pdfFields,
    durationMinutes: z.number().int().min(0).max(1000).optional().nullable(),
    sortOrder: z.number().int().default(0),
    isPublished: z.boolean().default(true),
  })
  .superRefine((data, ctx) => {
    rejectDualPdfSource(data, ctx);
    rejectDualMediaSource(data, ctx);
    if (!data.videoUrl && !data.mediaFileId && !data.pdfUrl && !data.pdfFileId) {
      ctx.addIssue({
        code: 'custom',
        path: ['videoUrl'],
        message: 'أضف رابط فيديو أو ارفع ملف MP4/MP3 أو أضف ملف PDF للدرس',
      });
    }
  });

const examSchema = z
  .object({
    unitId: id.optional().nullable(),
    lessonId: id.optional().nullable(),
    title: z.string().trim().min(2).max(150),
    description: optionalText,
    passingScore: z.number().int().min(0).max(100).default(60),
    timeLimitMinutes: z.number().int().min(1).max(300).optional().nullable(),
    isPublished: z.boolean().default(true),
  })
  .refine((data) => !!data.unitId || !!data.lessonId, {
    message: 'الاختبار يجب أن يرتبط بوحدة أو درس',
    path: ['unitId'],
  });

const optionSchema = z.object({
  text: z.string().trim().min(1).max(300),
  isCorrect: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
});

const questionTypes = z.enum(['MCQ', 'TRUE_FALSE', 'MULTIPLE_SELECT', 'SHORT_ANSWER']);

const questionSchema = z
  .object({
    examId: id,
    type: questionTypes,
    prompt: z.string().trim().min(3).max(1000),
    explanation: optionalText,
    expectedAnswer: z.string().trim().max(300).optional().nullable(),
    points: z.number().int().min(1).max(20).default(1),
    sortOrder: z.number().int().default(0),
    options: z.array(optionSchema).default([]),
  })
  .superRefine((data, ctx) => {
    if (data.type === 'SHORT_ANSWER') {
      if (!data.expectedAnswer) {
        ctx.addIssue({ code: 'custom', path: ['expectedAnswer'], message: 'الإجابة النموذجية مطلوبة' });
      }
      return;
    }
    const correct = data.options.filter((o) => o.isCorrect).length;
    if (data.options.length < 2) {
      ctx.addIssue({ code: 'custom', path: ['options'], message: 'اختر خيارين على الأقل' });
    }
    if (correct < 1) {
      ctx.addIssue({ code: 'custom', path: ['options'], message: 'حدد إجابة صحيحة واحدة على الأقل' });
    }
    if ((data.type === 'MCQ' || data.type === 'TRUE_FALSE') && correct !== 1) {
      ctx.addIssue({ code: 'custom', path: ['options'], message: 'يجب تحديد إجابة صحيحة واحدة فقط' });
    }
    if (data.type === 'TRUE_FALSE' && data.options.length !== 2) {
      ctx.addIssue({ code: 'custom', path: ['options'], message: 'سؤال صح/خطأ يحتاج خيارين' });
    }
  });

const productSchema = z
  .object({
    name: z.string().trim().min(2).max(150),
    description: optionalText,
    type: z.enum(['MONTHLY', 'TERM', 'UNIT', 'LESSON', 'EXAM_PACKAGE']),
    priceCents: z.number().int().min(100, 'السعر يجب أن يكون 1 جنيه على الأقل'),
    currency: z.string().trim().length(3).default('EGP'),
    durationDays: z.number().int().min(1).max(3650).optional().nullable(),
    subjectId: id.optional().nullable(),
    courseId: id.optional().nullable(),
    unitId: id.optional().nullable(),
    lessonId: id.optional().nullable(),
    examId: id.optional().nullable(),
    isActive: z.boolean().default(true),
  })
  .superRefine((data, ctx) => {
    const needs: Record<string, keyof typeof data> = {
      UNIT: 'unitId',
      LESSON: 'lessonId',
      EXAM_PACKAGE: 'examId',
    };
    const field = needs[data.type];
    if (field && !data[field]) {
      ctx.addIssue({ code: 'custom', path: [field], message: 'هذا النوع يحتاج إلى محتوى مرتبط' });
    }
  });

// ---------- Overview ----------
adminRouter.get(
  '/overview',
  asyncHandler(async (_req, res) => {
    const [students, pendingStudents, pendingPayments, subjects, courses, lessons, exams, approved, recentPayments] = await Promise.all([
      prisma.user.count({ where: { role: 'STUDENT' } }),
      prisma.user.count({ where: { role: 'STUDENT', status: 'PENDING' } }),
      prisma.paymentRequest.count({ where: { status: 'PENDING' } }),
      prisma.subject.count(),
      prisma.course.count(),
      prisma.lesson.count(),
      prisma.exam.count(),
      prisma.paymentRequest.aggregate({ where: { status: 'APPROVED' }, _sum: { amountCents: true } }),
      prisma.paymentRequest.findMany({
        where: { status: 'PENDING' },
        include: { user: { select: { name: true, email: true } }, product: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
    ]);
    res.json({
      stats: {
        students,
        pendingStudents,
        pendingPayments,
        subjects,
        courses,
        lessons,
        exams,
        approvedRevenueCents: approved._sum.amountCents ?? 0,
      },
      recentPayments,
    });
  }),
);

// ---------- Students ----------
adminRouter.get(
  '/students',
  asyncHandler(async (req, res) => {
    const status = z.enum(['PENDING', 'ACTIVE', 'REJECTED']).optional().parse(req.query.status);
    const students = await prisma.user.findMany({
      where: {
        role: 'STUDENT',
        ...(status ? { status: status as AccountStatus } : {}),
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        createdAt: true,
        _count: { select: { accessGrants: true, paymentRequests: true, examAttempts: true, lessonProgress: true } },
      },
    });
    res.json({ students });
  }),
);

adminRouter.get(
  '/students/:id',
  asyncHandler(async (req, res) => {
    const student = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        status: true,
        createdAt: true,
        accessGrants: { include: { product: true }, orderBy: { grantedAt: 'desc' } },
        paymentRequests: { include: { product: true }, orderBy: { createdAt: 'desc' } },
        examAttempts: { include: { exam: true }, orderBy: { submittedAt: 'desc' }, take: 10 },
        lessonProgress: { include: { lesson: { include: { unit: { include: { course: true } } } } } },
      },
    });
    if (!student || student.role !== 'STUDENT') throw notFound('الطالب غير موجود');
    res.json({ student });
  }),
);

adminRouter.patch(
  '/students/:id/status',
  asyncHandler(async (req, res) => {
    const { status } = z
      .object({ status: z.enum(['PENDING', 'ACTIVE', 'REJECTED']) })
      .parse(req.body);

    const student = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!student || student.role !== 'STUDENT') throw notFound('الطالب غير موجود');

    const updated = await prisma.user.update({
      where: { id: student.id },
      data: { status },
      select: { id: true, name: true, email: true, status: true },
    });
    res.json({ student: updated });
  }),
);

// ---------- Content tree ----------
adminRouter.get(
  '/content',
  asyncHandler(async (_req, res) => {
    const subjects = await prisma.subject.findMany({
      orderBy: { sortOrder: 'asc' },
      include: {
        courses: {
          orderBy: { sortOrder: 'asc' },
          include: {
            units: {
              orderBy: { sortOrder: 'asc' },
              include: {
                lessons: { orderBy: { sortOrder: 'asc' }, include: { pdfFile: true, mediaFile: true } },
                pdfFile: true,
              },
            },
            pdfFile: true,
          },
        },
      },
    });
    res.json({ subjects });
  }),
);

async function assertFileExists(fileId: unknown) {
  if (!fileId) return;
  const file = await prisma.fileAsset.findUnique({ where: { id: String(fileId) } });
  if (!file) throw badRequest('الملف المرفوع غير موجود، أعد رفعه');
}

function normalizePdfSource(data: Record<string, unknown>) {
  if (data.pdfUrl && data.pdfFileId) throw badRequest('اختر رابط PDF أو ملف مرفوع، وليس الاثنين معاً');
  if (data.pdfUrl) data.pdfFileId = null;
  if (data.pdfFileId) data.pdfUrl = null;
}

function normalizeMediaSource(data: Record<string, unknown>) {
  if (data.videoUrl && data.mediaFileId) throw badRequest('اختر رابط فيديو أو ملف MP4/MP3 مرفوع، وليس الاثنين معاً');
  if (data.videoUrl) data.mediaFileId = null;
  if (data.mediaFileId) data.videoUrl = null;
}

function crud(path: string, model: 'subject' | 'course' | 'unit' | 'lesson', schema: z.ZodTypeAny, slug = false) {
  const delegate = prisma[model] as unknown as {
    findMany: (args?: unknown) => Promise<unknown[]>;
    findUnique: (args: unknown) => Promise<unknown | null>;
    create: (args: unknown) => Promise<unknown>;
    update: (args: unknown) => Promise<unknown>;
    delete: (args: unknown) => Promise<unknown>;
  };

  adminRouter.get(
    `/${path}`,
    asyncHandler(async (_req, res) => {
      res.json({ items: await delegate.findMany({ orderBy: { sortOrder: 'asc' } }) });
    }),
  );

  adminRouter.post(
    `/${path}`,
    asyncHandler(async (req, res) => {
      const data = schema.parse(req.body) as Record<string, unknown>;
      await assertFileExists(data.pdfFileId);
      await assertFileExists(data.mediaFileId);
      normalizePdfSource(data);
      normalizeMediaSource(data);
      if (slug && !data.slug) data.slug = slugify(String(data.name ?? data.title ?? 'item'));
      res.status(201).json({ item: await delegate.create({ data }) });
    }),
  );

  adminRouter.put(
    `/${path}/:id`,
    asyncHandler(async (req, res) => {
      const existing = await delegate.findUnique({ where: { id: req.params.id } });
      if (!existing) throw notFound('العنصر غير موجود');
      const data = schema.parse(req.body) as Record<string, unknown>;
      await assertFileExists(data.pdfFileId);
      await assertFileExists(data.mediaFileId);
      normalizePdfSource(data);
      normalizeMediaSource(data);
      if (slug && !data.slug) data.slug = (existing as { slug: string }).slug;
      res.json({ item: await delegate.update({ where: { id: req.params.id }, data }) });
    }),
  );

  adminRouter.delete(
    `/${path}/:id`,
    asyncHandler(async (req, res) => {
      const existing = await delegate.findUnique({ where: { id: req.params.id } });
      if (!existing) throw notFound('العنصر غير موجود');
      await delegate.delete({ where: { id: req.params.id } });
      res.json({ ok: true });
    }),
  );
}

crud('subjects', 'subject', subjectSchema, true);
crud('courses', 'course', courseSchema, true);
crud('units', 'unit', unitSchema);
crud('lessons', 'lesson', lessonSchema);

// ---------- Exams & questions ----------
adminRouter.get(
  '/exams',
  asyncHandler(async (_req, res) => {
    const exams = await prisma.exam.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        unit: { include: { course: true } },
        lesson: true,
        _count: { select: { questions: true, attempts: true } },
      },
    });
    res.json({ exams });
  }),
);

adminRouter.get(
  '/exams/:id',
  asyncHandler(async (req, res) => {
    const exam = await prisma.exam.findUnique({
      where: { id: req.params.id },
      include: {
        unit: { include: { course: true } },
        lesson: true,
        questions: {
          orderBy: { sortOrder: 'asc' },
          include: { options: { orderBy: { sortOrder: 'asc' } } },
        },
      },
    });
    if (!exam) throw notFound('الاختبار غير موجود');
    res.json({ exam });
  }),
);

adminRouter.post(
  '/exams',
  asyncHandler(async (req, res) => {
    const exam = await prisma.exam.create({ data: examSchema.parse(req.body) });
    res.status(201).json({ exam });
  }),
);

adminRouter.put(
  '/exams/:id',
  asyncHandler(async (req, res) => {
    const existing = await prisma.exam.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('الاختبار غير موجود');
    const exam = await prisma.exam.update({ where: { id: req.params.id }, data: examSchema.parse(req.body) });
    res.json({ exam });
  }),
);

adminRouter.delete(
  '/exams/:id',
  asyncHandler(async (req, res) => {
    await prisma.exam.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  }),
);

adminRouter.post(
  '/questions',
  asyncHandler(async (req, res) => {
    const data = questionSchema.parse(req.body);
    const question = await prisma.question.create({
      data: {
        examId: data.examId,
        type: data.type,
        prompt: data.prompt,
        explanation: data.explanation,
        expectedAnswer: data.expectedAnswer,
        points: data.points,
        sortOrder: data.sortOrder,
        options: { create: data.options.map((o, index) => ({ ...o, sortOrder: o.sortOrder || index })) },
      },
      include: { options: true },
    });
    res.status(201).json({ question });
  }),
);

adminRouter.put(
  '/questions/:id',
  asyncHandler(async (req, res) => {
    const existing = await prisma.question.findUnique({
      where: { id: req.params.id },
      include: { options: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!existing) throw notFound('السؤال غير موجود');
    const merged = {
      examId: existing.examId,
      type: existing.type,
      prompt: existing.prompt,
      explanation: existing.explanation,
      expectedAnswer: existing.expectedAnswer,
      points: existing.points,
      sortOrder: existing.sortOrder,
      options: existing.options.map((o) => ({ text: o.text, isCorrect: o.isCorrect, sortOrder: o.sortOrder })),
      ...(req.body as Record<string, unknown>),
    };
    const data = questionSchema.parse(merged);
    const question = await prisma.$transaction(async (tx) => {
      await tx.answerOption.deleteMany({ where: { questionId: existing.id } });
      return tx.question.update({
        where: { id: existing.id },
        data: {
          examId: data.examId,
          type: data.type,
          prompt: data.prompt,
          explanation: data.explanation,
          expectedAnswer: data.expectedAnswer,
          points: data.points,
          sortOrder: data.sortOrder,
          options: { create: data.options.map((o, index) => ({ ...o, sortOrder: o.sortOrder || index })) },
        },
        include: { options: true },
      });
    });
    res.json({ question });
  }),
);

adminRouter.delete(
  '/questions/:id',
  asyncHandler(async (req, res) => {
    await prisma.question.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  }),
);

adminRouter.get(
  '/attempts',
  asyncHandler(async (_req, res) => {
    const attempts = await prisma.examAttempt.findMany({
      orderBy: { submittedAt: 'desc' },
      include: {
        user: { select: { id: true, name: true, email: true } },
        exam: { select: { id: true, title: true } },
      },
      take: 200,
    });
    res.json({ attempts });
  }),
);

// ---------- Products ----------
adminRouter.get(
  '/products',
  asyncHandler(async (_req, res) => {
    const products = await prisma.product.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        subject: { select: { name: true } },
        course: { select: { title: true } },
        unit: { select: { title: true } },
        lesson: { select: { title: true } },
        exam: { select: { title: true } },
      },
    });
    res.json({ products });
  }),
);

adminRouter.post(
  '/products',
  asyncHandler(async (req, res) => {
    const product = await prisma.product.create({ data: productSchema.parse(req.body) });
    res.status(201).json({ product });
  }),
);

adminRouter.put(
  '/products/:id',
  asyncHandler(async (req, res) => {
    const existing = await prisma.product.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('الباقة غير موجودة');
    const product = await prisma.product.update({ where: { id: req.params.id }, data: productSchema.parse(req.body) });
    res.json({ product });
  }),
);

adminRouter.delete(
  '/products/:id',
  asyncHandler(async (req, res) => {
    const count = await prisma.paymentRequest.count({ where: { productId: req.params.id } });
    if (count > 0) {
      const product = await prisma.product.update({
        where: { id: req.params.id },
        data: { isActive: false },
      });
      return res.json({ product, archived: true });
    }
    await prisma.product.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  }),
);

// ---------- Payment review ----------
adminRouter.get(
  '/payments',
  asyncHandler(async (req, res) => {
    const status = z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional().parse(req.query.status);
    const payments = await prisma.paymentRequest.findMany({
      where: status ? { status } : undefined,
      include: {
        user: { select: { id: true, name: true, email: true, phone: true } },
        product: true,
        reviewedBy: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ payments });
  }),
);

adminRouter.get(
  '/payments/:id',
  asyncHandler(async (req, res) => {
    const payment = await prisma.paymentRequest.findUnique({
      where: { id: req.params.id },
      include: {
        user: { select: { id: true, name: true, email: true, phone: true, role: true, status: true, createdAt: true } },
        product: true,
        reviewedBy: { select: { name: true } },
      },
    });
    if (!payment) throw notFound('الطلب غير موجود');
    res.json({ payment });
  }),
);

adminRouter.patch(
  '/payments/:id',
  asyncHandler(async (req, res) => {
    const { status, adminNote } = z
      .object({
        status: z.enum(['APPROVED', 'REJECTED']),
        adminNote: z.string().trim().max(500).optional().nullable(),
      })
      .parse(req.body);

    const payment = await prisma.paymentRequest.findUnique({
      where: { id: req.params.id },
      include: { product: true },
    });
    if (!payment) throw notFound('الطلب غير موجود');
    if (payment.status !== 'PENDING') throw conflict('تمت مراجعة هذا الطلب بالفعل');

    const updated = await prisma.$transaction(async (tx) => {
      // Claim the request atomically: two concurrent reviews cannot both grant access.
      const claim = await tx.paymentRequest.updateMany({
        where: { id: payment.id, status: 'PENDING' },
        data: {
          status,
          adminNote,
          reviewedAt: new Date(),
          reviewedById: req.user!.id,
        },
      });
      if (claim.count !== 1) throw conflict('تمت مراجعة هذا الطلب بالفعل');
      const reviewed = await tx.paymentRequest.findUniqueOrThrow({ where: { id: payment.id } });

      if (status === 'APPROVED') {
        const existing = await tx.accessGrant.findUnique({
          where: { userId_productId: { userId: payment.userId, productId: payment.productId } },
        });
        await tx.accessGrant.upsert({
          where: { userId_productId: { userId: payment.userId, productId: payment.productId } },
          create: {
            userId: payment.userId,
            productId: payment.productId,
            paymentRequestId: payment.id,
            expiresAt: grantExpiry(payment.product),
          },
          update: {
            paymentRequestId: payment.id,
            expiresAt: existing?.expiresAt === null ? null : grantExpiry(payment.product),
          },
        });
      }

      return reviewed;
    });

    res.json({ payment: updated, granted: status === 'APPROVED' });
  }),
);

// ---------- Progress report ----------
adminRouter.get(
  '/progress',
  asyncHandler(async (_req, res) => {
    const students = await prisma.user.findMany({
      where: { role: 'STUDENT' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, email: true },
    });
    const courses = await prisma.course.findMany({
      include: { subject: true, units: { include: { lessons: { where: { isPublished: true }, select: { id: true } } } } },
      orderBy: { sortOrder: 'asc' },
    });
    const progress = await prisma.lessonProgress.findMany({
      select: { userId: true, lessonId: true, completedAt: true },
    });
    const attempts = await prisma.examAttempt.findMany({
      select: { userId: true, score: true, maxScore: true, examId: true },
    });

    const rows = students.flatMap((student) =>
      courses.map((course) => {
        const ids = course.units.flatMap((u) => u.lessons.map((l) => l.id));
        const done = progress.filter((p) => p.userId === student.id && ids.includes(p.lessonId));
        const courseAttempts = attempts.filter((a) => a.userId === student.id);
        const totalScore = courseAttempts.reduce((sum, a) => sum + (a.maxScore ? (a.score / a.maxScore) * 100 : 0), 0);
        return {
          studentId: student.id,
          studentName: student.name,
          studentEmail: student.email,
          courseId: course.id,
          courseTitle: course.title,
          subject: course.subject.name,
          completed: done.length,
          total: ids.length,
          percent: ids.length ? Math.round((done.length / ids.length) * 100) : 0,
          lastActivity: done.length ? done.map((d) => d.completedAt).sort().at(-1) : null,
          averageExamPercent: courseAttempts.length ? Math.round(totalScore / courseAttempts.length) : null,
        };
      }),
    );

    res.json({ rows, courses: courses.map((c) => ({ id: c.id, title: c.title })) });
  }),
);
