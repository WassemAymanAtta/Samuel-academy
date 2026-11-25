import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { asyncHandler, badRequest } from '../lib/errors';
import { requireAdmin, requireAuth } from '../lib/auth';
import { prisma } from '../lib/prisma';
import { config } from '../lib/config';

export const uploadRouter = Router();
uploadRouter.use(requireAuth);
uploadRouter.use(requireAdmin);

function publicFile(file: { id: string; originalName: string; mimeType: string; sizeBytes: number; createdAt: Date }) {
  return {
    id: file.id,
    originalName: file.originalName,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    createdAt: file.createdAt,
  };
}

function safeFileName(raw: string, fallback: string) {
  const base = raw.split(/[\\/]/).pop() ?? fallback;
  const cleaned = base.replace(/[^\p{L}\p{N}._ -]/gu, '_').trim();
  return (cleaned || fallback).slice(0, 120);
}

function fileNameFrom(req: { header: (name: string) => string | undefined }, fallback: string) {
  try {
    return decodeURIComponent(req.header('x-file-name') ?? fallback);
  } catch {
    throw badRequest('اسم الملف غير صالح');
  }
}

async function store(bytes: Buffer, originalName: string, mimeType: string, extension: string, uploadedById: string) {
  const storedName = `${randomUUID()}${extension}`;
  const fullPath = path.join(config.uploadDir, storedName);
  await fs.mkdir(config.uploadDir, { recursive: true });
  await fs.writeFile(fullPath, bytes, { flag: 'wx' });

  try {
    const file = await prisma.fileAsset.create({
      data: { originalName, storedName, mimeType, sizeBytes: bytes.length, uploadedById },
    });
    return publicFile(file);
  } catch (error) {
    await fs.unlink(fullPath).catch(() => undefined);
    throw error;
  }
}

uploadRouter.post(
  '/pdf',
  asyncHandler(async (req, res) => {
    const bytes = req.body;
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
      throw badRequest('اختر ملف PDF من جهازك أولاً');
    }
    if (bytes.length > config.maxUploadBytes) {
      throw badRequest(`حجم الملف يتجاوز الحد المسموح (${Math.round(config.maxUploadBytes / 1024 / 1024)} ميجابايت)`);
    }

    const contentType = (req.header('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (contentType !== 'application/pdf' && contentType !== 'application/octet-stream') {
      throw badRequest('يُسمح برفع ملفات PDF فقط');
    }
    if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') {
      throw badRequest('الملف المختار ليس ملف PDF صالحاً');
    }

    const file = await store(
      bytes,
      safeFileName(fileNameFrom(req, 'document.pdf'), 'document.pdf'),
      'application/pdf',
      '.pdf',
      req.user!.id,
    );
    res.status(201).json({ file });
  }),
);

/** Detect MP4 (ISO BMFF `ftyp`) or MP3 (ID3 tag / MPEG frame sync) from magic bytes. */
function detectMedia(bytes: Buffer): { mimeType: string; extension: string } {
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString('latin1') === 'ftyp') {
    return { mimeType: 'video/mp4', extension: '.mp4' };
  }
  if (bytes.subarray(0, 3).toString('latin1') === 'ID3' || (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) {
    return { mimeType: 'audio/mpeg', extension: '.mp3' };
  }
  throw badRequest('الملف يجب أن يكون فيديو MP4 أو صوت MP3 صالحاً');
}

uploadRouter.post(
  '/media',
  asyncHandler(async (req, res) => {
    const bytes = req.body;
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
      throw badRequest('اختر ملف فيديو أو صوت من جهازك أولاً');
    }
    if (bytes.length > config.maxMediaBytes) {
      throw badRequest(`حجم الملف يتجاوز الحد المسموح (${Math.round(config.maxMediaBytes / 1024 / 1024)} ميجابايت)`);
    }

    const contentType = (req.header('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!['video/mp4', 'audio/mpeg', 'audio/mp3', 'application/octet-stream'].includes(contentType)) {
      throw badRequest('يُسمح برفع ملفات MP4 أو MP3 فقط');
    }

    const { mimeType, extension } = detectMedia(bytes);
    const file = await store(
      bytes,
      safeFileName(fileNameFrom(req, `lesson${extension}`), `lesson${extension}`),
      mimeType,
      extension,
      req.user!.id,
    );
    res.status(201).json({ file });
  }),
);
