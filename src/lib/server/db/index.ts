import { drizzle } from 'drizzle-orm/postgres-js';
import { drizzle as drizzleNeon } from 'drizzle-orm/neon-http';
import postgres from 'postgres';
import { neon } from '@neondatabase/serverless';
import * as schema from './schema';
import { env } from '$env/dynamic/private';

if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

// Validate DATABASE_URL format
try {
	new URL(env.DATABASE_URL);
} catch (error) {
	throw new Error(
		`Invalid DATABASE_URL format: ${env.DATABASE_URL}. Expected format: postgresql://user:password@host:port/database`
	);
}

// Use Neon serverless if DATABASE_URL contains 'neon' (production)
// Otherwise use postgres-js for local development
const isNeon = env.DATABASE_URL.includes('neon.tech') || env.DATABASE_URL.includes('neon');

let dbInstance: ReturnType<typeof drizzle> | ReturnType<typeof drizzleNeon>;

if (isNeon) {
	const client = neon(env.DATABASE_URL);
	dbInstance = drizzleNeon(client, { schema });
} else {
	// postgres-js configuration for local development
	const client = postgres(env.DATABASE_URL, {
		max: 1, // Limit connection pool for local dev
		onnotice: () => {} // Suppress notices
	});
	dbInstance = drizzle(client, { schema });
}

export const db = dbInstance;
