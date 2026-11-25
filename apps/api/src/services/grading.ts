import type { AnswerOption, Question, QuestionType } from '@prisma/client';

export type SubmittedAnswers = Record<string, string | string[]>;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, '') // Arabic diacritics
    .replace(/[.,!؟?؛;:"'()\[\]{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function answerList(answer: string | string[] | undefined): string[] {
  if (answer === undefined) return [];
  return Array.isArray(answer) ? answer : [answer];
}

export interface QuestionFeedback {
  questionId: string;
  correct: boolean;
  earnedPoints: number;
  correctAnswers: string[];
  explanation?: string | null;
}

export function gradeQuestion(
  question: Question & { options: AnswerOption[] },
  answer: string | string[] | undefined,
): QuestionFeedback {
  const selected = answerList(answer);
  const correctOptions = question.options.filter((option) => option.isCorrect);
  const correctIds = correctOptions.map((option) => option.id);
  let correct = false;

  if (question.type === ('SHORT_ANSWER' as QuestionType)) {
    const accepted = (question.expectedAnswer ?? '').split('|').map(normalize).filter(Boolean);
    correct = accepted.length > 0 && accepted.includes(normalize(selected[0] ?? ''));
  } else if (question.type === ('MULTIPLE_SELECT' as QuestionType)) {
    const a = [...new Set(selected)].sort().join(',');
    const b = [...new Set(correctIds)].sort().join(',');
    correct = correctIds.length > 0 && a === b;
  } else {
    correct = correctIds.length > 0 && selected.length === 1 && selected[0] === correctIds[0];
  }

  return {
    questionId: question.id,
    correct,
    earnedPoints: correct ? question.points : 0,
    correctAnswers: correctIds.length ? correctIds : question.expectedAnswer ? [question.expectedAnswer] : [],
    explanation: question.explanation,
  };
}

export function gradeAttempt(
  questions: Array<Question & { options: AnswerOption[] }>,
  answers: SubmittedAnswers,
) {
  const feedback = questions.map((question) => gradeQuestion(question, answers[question.id]));
  const score = feedback.reduce((total, item) => total + item.earnedPoints, 0);
  const maxScore = questions.reduce((total, question) => total + question.points, 0);
  const percent = maxScore === 0 ? 0 : Math.round((score / maxScore) * 100);
  return { feedback, score, maxScore, percent };
}

/** Student-facing exam payload: never includes isCorrect or expected answers. */
export function publicQuestion(question: Question & { options: AnswerOption[] }) {
  return {
    id: question.id,
    type: question.type,
    prompt: question.prompt,
    points: question.points,
    sortOrder: question.sortOrder,
    options: question.options.map((option) => ({ id: option.id, text: option.text, sortOrder: option.sortOrder })),
  };
}
