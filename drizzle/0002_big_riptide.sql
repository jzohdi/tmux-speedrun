ALTER TABLE "leaderboard" ADD COLUMN "session_id" text;--> statement-breakpoint
ALTER TABLE "leaderboard" ADD CONSTRAINT "leaderboard_session_id_unique" UNIQUE("session_id");