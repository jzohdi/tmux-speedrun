-- tmux-speedrun database initialization
-- This script runs automatically when the Postgres container starts for the first time

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Leaderboard table
-- Stores completed challenge times for the global leaderboard
CREATE TABLE IF NOT EXISTS leaderboard (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id TEXT NOT NULL,
  user_id UUID,                          -- nullable; for future GitHub OAuth
  username TEXT,                         -- nullable; display name for leaderboard
  duration_ms INTEGER NOT NULL,          -- completion time in milliseconds
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fetching top times per challenge (most common query)
CREATE INDEX IF NOT EXISTS idx_leaderboard_challenge_duration
  ON leaderboard (challenge_id, duration_ms ASC);

-- Index for user profile pages (future feature)
CREATE INDEX IF NOT EXISTS idx_leaderboard_user
  ON leaderboard (user_id) WHERE user_id IS NOT NULL;

-- Index for recent submissions
CREATE INDEX IF NOT EXISTS idx_leaderboard_created_at
  ON leaderboard (created_at DESC);

-- Comment on table
COMMENT ON TABLE leaderboard IS 'Stores completed challenge times for the global leaderboard';
COMMENT ON COLUMN leaderboard.challenge_id IS 'Unique identifier for the challenge';
COMMENT ON COLUMN leaderboard.user_id IS 'Optional user ID for authenticated users (GitHub OAuth)';
COMMENT ON COLUMN leaderboard.username IS 'Display name shown on the leaderboard';
COMMENT ON COLUMN leaderboard.duration_ms IS 'Time to complete the challenge in milliseconds';

