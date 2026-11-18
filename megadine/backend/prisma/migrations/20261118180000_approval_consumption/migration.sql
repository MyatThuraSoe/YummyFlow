-- A granted approval may only authorise one action; record when it is used.
ALTER TABLE "ApprovalRequest" ADD COLUMN "consumedAt" TIMESTAMP(3);
