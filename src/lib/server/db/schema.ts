import { pgTable, uuid, text, integer, timestamp } from 'drizzle-orm/pg-core';

export const leaderboard = pgTable('leaderboard', {
	id: uuid('id').primaryKey().defaultRandom(),
	challengeId: text('challenge_id').notNull(),
	userId: uuid('user_id'),
	username: text('username'),
	durationMs: integer('duration_ms').notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});
