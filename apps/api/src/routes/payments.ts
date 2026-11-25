import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, badRequest, notFound } from '../lib/errors';
import { requireAuth, requireStudent } from '../lib/auth';
import { prisma } from '../lib/prisma';
import { config } from '../lib/config';

export const paymentRouter = Router();

const productInclude = {
  subject: { select: { id: true, name: true } },
  course: { select: { id: true, title: true } },
  unit: { select: { id: true, title: true } },
  lesson: { select: { id: true, title: true } },
  exam: { select: { id: true, title: true } },
} as const;

paymentRouter.get(
  '/products',
  requireAuth,
  asyncHandler(async (req, res) => {
    const type = z.enum(['MONTHLY', 'TERM', 'UNIT', 'LESSON', 'EXAM_PACKAGE']).optional().parse(req.query.type);
    const products = await prisma.product.findMany({
      where: {
        isActive: true,
        ...(type ? { type } : {}),
      },
      include: productInclude,
      orderBy: [{ type: 'asc' }, { priceCents: 'asc' }],
    });
    res.json({ products });
  }),
);

paymentRouter.post(
  '/payments',
  requireAuth,
  requireStudent,
  asyncHandler(async (req, res) => {
    const data = z
      .object({
        productId: z.string().min(1),
        method: z.enum(['INSTAPAY', 'EWALLET']),
        reference: z.string().trim().min(3, 'رقم العملية قصير جداً').max(100),
        note: z.string().trim().max(500).optional().nullable(),
      })
      .parse(req.body);

    const product = await prisma.product.findUnique({ where: { id: data.productId } });
    if (!product || !product.isActive) throw notFound('هذه الباقة غير متاحة حالياً');

    // Check across all users, not only the current one. A global unique index
    // is proposed separately to close the race window without an unsafe migration.
    const duplicate = await prisma.paymentRequest.findFirst({
      where: {
        reference: data.reference,
        OR: [{ userId: req.user!.id, status: 'PENDING' }, { userId: { not: req.user!.id } }],
      },
    });
    if (duplicate) throw badRequest('رقم العملية مستخدم بالفعل في طلب آخر');

    let payment;
    try {
      payment = await prisma.paymentRequest.create({
        data: {
          userId: req.user!.id,
          productId: product.id,
          amountCents: product.priceCents, // price always comes from the database
          method: data.method,
          reference: data.reference,
          note: data.note,
        },
        include: { product: true },
      });
    } catch (error) {
      // The DB unique index closes the race between two simultaneous submissions.
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
        throw badRequest('رقم العملية مستخدم بالفعل في طلب آخر');
      }
      throw error;
    }

    res.status(201).json({
      payment,
      instructions: {
        demoMode: config.demoMode,
        instapay: config.paymentDetails.instapay,
        ewallet: config.paymentDetails.ewallet,
        message: 'يتم مراجعة الطلب يدوياً من الإدارة. لا يتم التحقق من تحويلات InstaPay تلقائياً.',
      },
    });
  }),
);

paymentRouter.get(
  '/me/payments',
  requireAuth,
  asyncHandler(async (req, res) => {
    const payments = await prisma.paymentRequest.findMany({
      where: { userId: req.user!.id },
      include: { product: { include: productInclude }, accessGrant: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ payments });
  }),
);
