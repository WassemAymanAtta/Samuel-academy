import { prisma } from '../lib/prisma';

type AttemptMeta = { id: string; examId: string; submittedAt: Date | string };

function time(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

/** Oldest attempt per exam is the only attempt whose score may be disclosed. */
export function firstAttemptIds(attempts: AttemptMeta[]): Set<string> {
  const ordered = [...attempts].sort(
    (a, b) => time(a.submittedAt) - time(b.submittedAt) || a.id.localeCompare(b.id),
  );
  const seen = new Set<string>();
  const first = new Set<string>();
  for (const attempt of ordered) {
    if (seen.has(attempt.examId)) continue;
    seen.add(attempt.examId);
    first.add(attempt.id);
  }
  return first;
}

export async function firstAttemptIdFor(userId: string, examId: string): Promise<string | null> {
  const attempt = await prisma.examAttempt.findFirst({
    where: { userId, examId },
    orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }],
    select: { id: true },
  });
  return attempt?.id ?? null;
}

/**
 * Strips correctness, points and explanations from stored feedback. This also
 * sanitises legacy rows written before the answer-oracle fix.
 */
export function safeFeedback(feedback: unknown, promptById: Map<string, string>) {
  if (!Array.isArray(feedback)) return [];
  return feedback.map((item) => {
    const row = item && typeof item === 'object' ? (item as { questionId?: unknown; prompt?: unknown }) : {};
    const questionId = typeof row.questionId === 'string' ? row.questionId : '';
    const prompt = promptById.get(questionId) ?? (typeof row.prompt === 'string' ? row.prompt : '');
    return { questionId, prompt };
  });
}
