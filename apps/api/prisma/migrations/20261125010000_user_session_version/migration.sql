-- One active session per user: every login/logout bumps this counter and
-- invalidates JWTs minted with the previous value.
ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
