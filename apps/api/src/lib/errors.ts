import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = 'APP_ERROR',
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string) => new AppError(400, message, 'BAD_REQUEST');
export const unauthorized = (message = 'يرجى تسجيل الدخول أولاً') => new AppError(401, message, 'UNAUTHORIZED');
export const forbidden = (message = 'غير مسموح لك بالوصول إلى هذا المورد') => new AppError(403, message, 'FORBIDDEN');
export const notFound = (message = 'غير موجود') => new AppError(404, message, 'NOT_FOUND');
export const conflict = (message: string) => new AppError(409, message, 'CONFLICT');

export function asyncHandler(handler: (req: Request, res: Response) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res)).catch(next);
  };
}

export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (error instanceof ZodError) {
    const details = error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message }));
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'بيانات غير صالحة', details } });
  }

  if (error instanceof AppError) {
    return res.status(error.status).json({ error: { code: error.code, message: error.message } });
  }

  if (typeof error === 'object' && error !== null && 'type' in error && error.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'FILE_TOO_LARGE', message: 'حجم الملف أكبر من الحد المسموح' } });
  }

  // Prisma unique constraint
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
    return res.status(409).json({ error: { code: 'CONFLICT', message: 'قيمة مكررة، يرجى استخدام قيمة أخرى' } });
  }

  console.error(error);
  return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'حدث خطأ غير متوقع، حاول مرة أخرى' } });
}
