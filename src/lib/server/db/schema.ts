import { pgTable, uuid, text, integer, timestamp, bigint } from 'drizzle-orm/pg-core';

export const leaderboard = pgTable('leaderboard', {
	id: uuid('id').primaryKey().defaultRandom(),
	challengeId: text('challenge_id').notNull(),
	userId: uuid('user_id'),
	username: text('username'),
	// Verified GitHub numeric id (nullable). GitHub ids fit in JS safe-integer range.
	githubId: bigint('github_id', { mode: 'number' }),
	// Challenge crypto session id (nullable for legacy rows). UNIQUE so a replayed
	// finish/record cookie+proof cannot insert duplicate rows for one session.
	sessionId: text('session_id').unique(),
	durationMs: integer('duration_ms').notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});
