-- Purely additive: nullable JSONB column, no data migration needed.
ALTER TABLE "Ticket" ADD COLUMN "requesterCandidates" JSONB;
