-- Add inboundType tag to Session (first-observed) and RequestLog (per-request).
-- Null for rows written before this migration — the History view treats
-- null as "unknown" rather than one bucket.

ALTER TABLE "Session" ADD COLUMN "inboundType" TEXT;
ALTER TABLE "RequestLog" ADD COLUMN "inboundType" TEXT;
