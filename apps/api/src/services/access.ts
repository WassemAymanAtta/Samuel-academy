import type { AccessGrant, Product } from '@prisma/client';
import { prisma } from '../lib/prisma';

type ActiveGrant = AccessGrant & { product: Product };

export async function activeGrants(userId: string): Promise<ActiveGrant[]> {
  const now = new Date();
  return prisma.accessGrant.findMany({
    where: {
      userId,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    include: { product: true },
  });
}

export function subscriptionAllows(grants: ActiveGrant[], scope: { subjectId?: string | null; courseId?: string | null }) {
  return grants.some(({ product }) => {
    if (product.type !== 'MONTHLY' && product.type !== 'TERM') return false;
    // A grant with no subject/course restriction unlocks the whole library.
    if (!product.subjectId && !product.courseId) return true;
    if (scope.courseId && product.courseId === scope.courseId) return true;
    if (scope.subjectId && product.subjectId === scope.subjectId) return true;
    return false;
  });
}

export async function lessonAccess(userId: string, lessonId: string) {
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    include: { unit: { include: { course: true } } },
  });
  if (!lesson) return { allowed: false, reason: 'الدرس غير موجود' as const };

  const grants = await activeGrants(userId);
  const allowed =
    subscriptionAllows(grants, {
      subjectId: lesson.unit.course.subjectId,
      courseId: lesson.unit.courseId,
    }) ||
    grants.some(({ product }) => product.type === 'UNIT' && product.unitId === lesson.unitId) ||
    grants.some(({ product }) => product.type === 'LESSON' && product.lessonId === lesson.id);

  return { allowed, lesson, grants };
}

export async function examAccess(userId: string, examId: string) {
  const exam = await prisma.exam.findUnique({ where: { id: examId } });
  if (!exam) return { allowed: false, reason: 'الاختبار غير موجود' as const };

  const grants = await activeGrants(userId);
  let allowed = grants.some(({ product }) => product.type === 'EXAM_PACKAGE' && product.examId === exam.id);

  if (!allowed && exam.lessonId) {
    const lesson = await prisma.lesson.findUnique({
      where: { id: exam.lessonId },
      include: { unit: { include: { course: true } } },
    });
    if (lesson) {
      allowed =
        subscriptionAllows(grants, {
          subjectId: lesson.unit.course.subjectId,
          courseId: lesson.unit.courseId,
        }) ||
        grants.some(({ product }) => product.type === 'UNIT' && product.unitId === lesson.unitId) ||
        grants.some(({ product }) => product.type === 'LESSON' && product.lessonId === lesson.id);
    }
  }

  if (!allowed && exam.unitId) {
    const unit = await prisma.unit.findUnique({ where: { id: exam.unitId }, include: { course: true } });
    if (unit) {
      allowed =
        subscriptionAllows(grants, {
          subjectId: unit.course.subjectId,
          courseId: unit.courseId,
        }) || grants.some(({ product }) => product.type === 'UNIT' && product.unitId === unit.id);
    }
  }

  if (!allowed && !exam.unitId && !exam.lessonId) {
    allowed = subscriptionAllows(grants, {});
  }

  return { allowed, exam, grants };
}

/** Ids of courses/units/lessons the student can open, used to decorate catalog responses. */
export async function accessMap(userId: string) {
  const grants = await activeGrants(userId);
  const courses = await prisma.course.findMany({ select: { id: true, subjectId: true } });
  const units = await prisma.unit.findMany({ select: { id: true, courseId: true } });
  const lessons = await prisma.lesson.findMany({ select: { id: true, unitId: true } });
  const courseById = new Map(courses.map((c) => [c.id, c]));
  const unitById = new Map(units.map((u) => [u.id, u]));

  const accessibleCourses = new Set<string>();
  const accessibleUnits = new Set<string>();
  const accessibleLessons = new Set<string>();

  for (const lesson of lessons) {
    const unit = unitById.get(lesson.unitId);
    if (!unit) continue;
    const course = courseById.get(unit.courseId);
    if (!course) continue;

    const ok =
      subscriptionAllows(grants, { subjectId: course.subjectId, courseId: course.id }) ||
      grants.some((g) => g.product.type === 'UNIT' && g.product.unitId === unit.id) ||
      grants.some((g) => g.product.type === 'LESSON' && g.product.lessonId === lesson.id);

    if (ok) {
      accessibleCourses.add(course.id);
      accessibleUnits.add(unit.id);
      accessibleLessons.add(lesson.id);
    }
  }

  for (const grant of grants) {
    if (grant.product.type === 'UNIT' && grant.product.unitId) {
      const unit = unitById.get(grant.product.unitId);
      if (unit) {
        accessibleUnits.add(unit.id);
        accessibleCourses.add(unit.courseId);
      }
    }
  }

  return {
    courses: accessibleCourses,
    units: accessibleUnits,
    lessons: accessibleLessons,
    grants,
  };
}

export function grantExpiry(product: Product): Date | null {
  if (!product.durationDays) return null;
  const expires = new Date();
  expires.setDate(expires.getDate() + product.durationDays);
  return expires;
}
