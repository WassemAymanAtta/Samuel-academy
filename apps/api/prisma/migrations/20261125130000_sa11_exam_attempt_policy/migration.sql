-- SA-11: durable exam attempt policy. Additive only; no existing rows are rewritten.

ALTER TABLE "Exam"
ADD COLUMN "maxAttempts" INTEGER,
ADD CONSTRAINT "Exam_maxAttempts_positive"
CHECK ("maxAttempts" IS NULL OR "maxAttempts" > 0);

CREATE TABLE "ExamAttemptSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "abandonedAt" TIMESTAMP(3),
    "idempotencyKey" TEXT,

    CONSTRAINT "ExamAttemptSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ExamAttemptSession_userId_examId_idempotencyKey_key"
    ON "ExamAttemptSession"("userId", "examId", "idempotencyKey");

CREATE INDEX "ExamAttemptSession_userId_examId_startedAt_idx"
    ON "ExamAttemptSession"("userId", "examId", "startedAt");

CREATE INDEX "ExamAttemptSession_expiresAt_idx"
    ON "ExamAttemptSession"("expiresAt");

ALTER TABLE "ExamAttempt"
ADD COLUMN "startedAt" TIMESTAMP(3),
ADD COLUMN "sessionId" TEXT;

CREATE UNIQUE INDEX "ExamAttempt_sessionId_key"
    ON "ExamAttempt"("sessionId");

CREATE INDEX "ExamAttempt_examId_userId_submittedAt_idx"
    ON "ExamAttempt"("examId", "userId", "submittedAt");

ALTER TABLE "ExamAttemptSession"
ADD CONSTRAINT "ExamAttemptSession_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "ExamAttemptSession_examId_fkey"
FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ExamAttempt"
ADD CONSTRAINT "ExamAttempt_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "ExamAttemptSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
