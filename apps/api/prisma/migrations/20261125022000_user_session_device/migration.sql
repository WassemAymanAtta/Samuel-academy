-- Bind an account to the device that owns its single active session.
-- Nullable so existing accounts can re-login cleanly after deployment.
ALTER TABLE "User" ADD COLUMN "sessionDeviceId" TEXT;
