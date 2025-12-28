-- tmux-speedrun database initialization
-- This script runs automatically when the Postgres container starts for the first time
-- Table creation is handled by Drizzle migrations

-- Enable UUID extension (required for gen_random_uuid())
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

