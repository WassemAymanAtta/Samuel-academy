import { Router, type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  asyncHandler,
  badRequest,
  forbidden,
  notFound,
  unauthorized,
} from '../lib/errors';
import { deviceIdFrom, requireAuth } from '../lib/auth';
import { FILE_TOKEN_QUERY, signFileToken, verifyFileToken } from '../lib/fileToken';
import { prisma } from '../lib/prisma';
import { config } from '../lib/config';
import { activeGrants, subscriptionAllows } from '../services/access';

export const fileRouter = Router();

/** Media tags cannot send headers; a short-lived file-scoped token is accepted here only. */
async function fileAuth(req: Request, res: Response, next: NextFunction) {
  const raw = req.query[FILE_TOKEN_QUERY];
  if (typeof raw !== 'string') return requireAuth(req, res, next);

  try {
    const payload = verifyFileToken(raw);
    if (!payload || payload.fid !== req.params.id) throw unauthorized('رابط الملف غير صالح أو منتهي');
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.status !== 'ACTIVE') throw unauthorized('رابط الملف غير صالح أو منتهي');
    if (user.sessionVersion !== payload.sv || user.sessionDeviceId !== payload.did) {
      throw unauthorized('رابط الملف غير صالح أو منتهي');
    }
    if (deviceIdFrom(req) !== (user.sessionDeviceId ?? undefined)) {
      throw unauthorized('رابط الملف غير صالح أو منتهي');
    }
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

fileRouter.get(
  '/:id/token',
  requireAuth,
  asyncHandler(async (req, res) => {
    const file = await prisma.fileAsset.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!file) throw notFound('الملف غير موجود');
    const token = signFileToken(file.id, req.user!);
    res.json({
      token,
      url: `${BASE_FILE_PATH}${encodeURIComponent(file.id)}?${FILE_TOKEN_QUERY}=${encodeURIComponent(token)}`,
      expiresInSeconds: 600,
    });
  }),
);

const BASE_FILE_PATH = '/api/files/';

async function authorizeFile(req: Request, fileId: string) {
  const user = req.user!;
  if (user.role === 'ADMIN') return;

  const file = await prisma.fileAsset.findUnique({
    where: { id: fileId },
    include: {
      pdfLessons: { select: { id: true, isPublished: true } },
      mediaLessons: { select: { id: true, isPublished: true } },
      units: { include: { course: { select: { id: true, subjectId: true } } } },
      courses: { select: { id: true, subjectId: true } },
    },
  });
  if (!file) throw notFound('الملف غير موجود');

  const grants = await activeGrants(user.id);
  const subscribed = (courseId: string, subjectId: string) =>
    subscriptionAllows(grants, { courseId, subjectId });

  // Course-level files require a real subscription, not a lesson/unit purchase
  // that merely belongs to that course.
  const courseAllowed = file.courses.some((course) => subscribed(course.id, course.subjectId));
  const unitAllowed = file.units.some(
    (unit) =>
      subscribed(unit.course.id, unit.course.subjectId) ||
      grants.some((grant) => grant.product.type === 'UNIT' && grant.product.unitId === unit.id),
  );
  // Unpublished lessons never release their files to students, even with a grant.
  const publishedLessonIds = [...file.pdfLessons, ...file.mediaLessons]
    .filter((lesson) => lesson.isPublished)
    .map((lesson) => lesson.id);

  // Use the same rule as lesson pages for subscription, unit and lesson grants.
  const mapLessons = new Set<string>();
  for (const lessonId of publishedLessonIds) {
    const lesson = await prisma.lesson.findUnique({
      where: { id: lessonId },
      include: { unit: { include: { course: true } } },
    });
    if (!lesson) continue;
    if (
      subscribed(lesson.unit.courseId, lesson.unit.course.subjectId) ||
      grants.some((grant) => grant.product.type === 'UNIT' && grant.product.unitId === lesson.unitId) ||
      grants.some((grant) => grant.product.type === 'LESSON' && grant.product.lessonId === lesson.id)
    ) {
      mapLessons.add(lesson.id);
    }
  }

  if (!courseAllowed && !unitAllowed && mapLessons.size === 0) {
    throw forbidden('لا تملك صلاحية الوصول إلى هذا الملف');
  }
}

fileRouter.get(
  '/:id',
  fileAuth,
  asyncHandler(async (req, res) => {
    const file = await prisma.fileAsset.findUnique({
      where: { id: req.params.id },
      include: {
        pdfLessons: { select: { id: true, isPublished: true } },
        mediaLessons: { select: { id: true, isPublished: true } },
      },
    });
    if (!file) throw notFound('الملف غير موجود');

    await authorizeFile(req, file.id);

    const fullPath = path.resolve(config.uploadDir, file.storedName);
    if (!fullPath.startsWith(`${config.uploadDir}${path.sep}`)) throw forbidden('مسار الملف غير صالح');

    let bytes: Buffer;
    try {
      bytes = await fs.readFile(fullPath);
    } catch {
      throw notFound('الملف غير موجود على الخادم');
    }

    const mimeType = file.mimeType === 'audio/mpeg' || file.mimeType === 'video/mp4' ? file.mimeType : 'application/pdf';
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(file.originalName)}`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Referrer-Policy', 'no-referrer');

    // Browsers request byte ranges when seeking inside an MP4/MP3.
    const range = req.header('range');
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if (!match) throw badRequest('نطاق البايتات غير صالح');
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Number(match[2]) : bytes.length - 1;
      if (!Number.isInteger(start) || !Number.isInteger(end) || start > end || start >= bytes.length) {
        throw badRequest('نطاق البايتات غير صالح');
      }
      const last = Math.min(end, bytes.length - 1);
      res.setHeader('Content-Range', `bytes ${start}-${last}/${bytes.length}`);
      res.status(206).send(bytes.subarray(start, last + 1));
      return;
    }

    res.send(bytes);
  }),
);
