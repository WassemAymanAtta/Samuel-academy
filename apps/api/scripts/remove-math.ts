import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../src/lib/prisma';
import { config } from '../src/lib/config';

/**
 * Surgical Math removal for an already-seeded database.
 * It never calls db:reset and never touches programming courses.
 */
function assertTarget() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run Math cleanup in production.');
  }
  if (process.env.ALLOW_MATH_CLEANUP !== '1') {
    throw new Error('Refusing to remove Math data. Set ALLOW_MATH_CLEANUP=1 to confirm.');
  }
  let databaseName = '';
  try {
    databaseName = decodeURIComponent(new URL(process.env.DATABASE_URL ?? '').pathname.replace(/^\//, ''));
  } catch {
    throw new Error('DATABASE_URL is invalid; refusing to remove Math data.');
  }
  if (!['samuel_academy', 'samuel_academy_test'].includes(databaseName)) {
    throw new Error(`Refusing to clean database "${databaseName}". Only samuel_academy / samuel_academy_test are allowed.`);
  }
}

async function main() {
  assertTarget();

  const subjects = await prisma.subject.findMany({
    where: { OR: [{ slug: 'math-egypt' }, { name: { contains: 'رياضيات' } }] },
  });
  const subjectIds = subjects.map((record) => record.id);

  const courses = await prisma.course.findMany({
    where: {
      OR: [
        { subjectId: { in: subjectIds } },
        { slug: 'math-grade-3' },
        { title: { contains: 'رياضيات' } },
      ],
    },
  });
  const courseIds = courses.map((record) => record.id);

  const units = await prisma.unit.findMany({ where: { courseId: { in: courseIds } } });
  const unitIds = units.map((record) => record.id);

  const lessons = await prisma.lesson.findMany({ where: { unitId: { in: unitIds } } });
  const lessonIds = lessons.map((record) => record.id);

  const exams = await prisma.exam.findMany({
    where: { OR: [{ unitId: { in: unitIds } }, { lessonId: { in: lessonIds } }, { title: { contains: 'الرياضيات' } }] },
  });
  const examIds = exams.map((record) => record.id);

  const products = await prisma.product.findMany({
    where: {
      OR: [
        { subjectId: { in: subjectIds } },
        { courseId: { in: courseIds } },
        { unitId: { in: unitIds } },
        { lessonId: { in: lessonIds } },
        { examId: { in: examIds } },
        { name: { contains: 'الرياضيات' } },
      ],
    },
  });
  const productIds = products.map((record) => record.id);

  const fileIds = new Set<string>();
  for (const record of [...courses, ...units, ...lessons]) {
    if (record.pdfFileId) fileIds.add(record.pdfFileId);
    if ('mediaFileId' in record && record.mediaFileId) fileIds.add(record.mediaFileId);
  }

  await prisma.examAttempt.deleteMany({ where: { examId: { in: examIds } } });
  await prisma.lessonProgress.deleteMany({ where: { lessonId: { in: lessonIds } } });
  await prisma.accessGrant.deleteMany({ where: { productId: { in: productIds } } });
  await prisma.paymentRequest.deleteMany({ where: { productId: { in: productIds } } });
  await prisma.answerOption.deleteMany({ where: { question: { examId: { in: examIds } } } });
  await prisma.question.deleteMany({ where: { examId: { in: examIds } } });
  await prisma.exam.deleteMany({ where: { id: { in: examIds } } });
  await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  await prisma.lesson.deleteMany({ where: { id: { in: lessonIds } } });
  await prisma.unit.deleteMany({ where: { id: { in: unitIds } } });
  await prisma.course.deleteMany({ where: { id: { in: courseIds } } });
  await prisma.subject.deleteMany({ where: { id: { in: subjectIds } } });

  let removedFiles = 0;
  for (const fileId of fileIds) {
    const file = await prisma.fileAsset.findUnique({
      where: { id: fileId },
      include: { pdfLessons: true, mediaLessons: true, units: true, courses: true },
    });
    if (!file) continue;
    const stillUsed =
      file.pdfLessons.length > 0 ||
      file.mediaLessons.length > 0 ||
      file.units.length > 0 ||
      file.courses.length > 0;
    if (stillUsed) continue;

    const fullPath = path.resolve(config.uploadDir, file.storedName);
    if (fullPath.startsWith(`${config.uploadDir}${path.sep}`)) {
      await fs.unlink(fullPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
    await prisma.fileAsset.delete({ where: { id: fileId } });
    removedFiles += 1;
  }

  console.log(
    JSON.stringify(
      {
        subjects: subjectIds.length,
        courses: courseIds.length,
        units: unitIds.length,
        lessons: lessonIds.length,
        exams: examIds.length,
        products: productIds.length,
        files: removedFiles,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
