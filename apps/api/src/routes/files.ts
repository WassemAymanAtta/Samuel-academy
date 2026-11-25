import { Router } from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { asyncHandler, badRequest, forbidden, notFound } from '../lib/errors';
import { requireAuth } from '../lib/auth';
import { prisma } from '../lib/prisma';
import { config } from '../lib/config';
import { accessMap, subscriptionAllows } from '../services/access';

export const fileRouter = Router();
fileRouter.use(requireAuth);

fileRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const file = await prisma.fileAsset.findUnique({
      where: { id: req.params.id },
      include: {
        pdfLessons: { select: { id: true } },
        mediaLessons: { select: { id: true } },
        units: { include: { course: { select: { id: true, subjectId: true } } } },
        courses: { select: { id: true, subjectId: true } },
      },
    });
    if (!file) throw notFound('الملف غير موجود');

    if (user.role !== 'ADMIN') {
      const map = await accessMap(user.id);
      const subscribed = (courseId: string, subjectId: string) =>
        subscriptionAllows(map.grants, { courseId, subjectId });

      const lessonIds = [...file.pdfLessons, ...file.mediaLessons].map((lesson) => lesson.id);
      const allowed =
        file.courses.some((course) => map.courses.has(course.id) || subscribed(course.id, course.subjectId)) ||
        file.units.some(
          (unit) =>
            map.units.has(unit.id) ||
            subscribed(unit.course.id, unit.course.subjectId) ||
            map.grants.some((grant) => grant.product.type === 'UNIT' && grant.product.unitId === unit.id),
        ) ||
        lessonIds.some((lessonId) => map.lessons.has(lessonId));

      if (!allowed) throw forbidden('لا تملك صلاحية الوصول إلى هذا الملف');
    }

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
