/**
 * Persistent CLI session store (~/.config/tmux-speedrun/session.json, mode 0600).
 *
 * Issue #35, interface §4.6 / §10. Holds the signed session token obtained by
 * `login`. `decodeSessionToken` decodes username/githubId locally WITHOUT
 * verifying the HMAC (the server verifies on use); it returns null on a
 * malformed token.
 */

import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export type StoredSession = {
	token: string;
	username: string;
	githubId: number;
	savedAt: number;
};

/** Config dir: $XDG_CONFIG_HOME/tmux-speedrun or ~/.config/tmux-speedrun. */
export function configDir(): string {
	const xdg = process.env.XDG_CONFIG_HOME;
	const base = xdg && xdg.length > 0 ? xdg : join(homedir(), '.config');
	return join(base, 'tmux-speedrun');
}

/** <configDir>/session.json. */
export function sessionFilePath(): string {
	return join(configDir(), 'session.json');
}

/** Load the stored session, or null if absent/unreadable/malformed. */
export function loadSession(): StoredSession | null {
	try {
		const raw = readFileSync(sessionFilePath(), 'utf8');
		const parsed = JSON.parse(raw);
		if (
			parsed &&
			typeof parsed === 'object' &&
			typeof parsed.token === 'string' &&
			typeof parsed.username === 'string' &&
			typeof parsed.githubId === 'number' &&
			typeof parsed.savedAt === 'number'
		) {
			return parsed as StoredSession;
		}
		return null;
	} catch {
		return null;
	}
}

/** Write the session (mode 0600), creating the config dir if needed. */
export function saveSession(s: StoredSession): void {
	const path = sessionFilePath();
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	writeFileSync(path, JSON.stringify(s, null, 2), { mode: 0o600 });
}

/** Remove the session file if present (no error if absent). */
export function clearSession(): void {
	rmSync(sessionFilePath(), { force: true });
}

/** base64url → UTF-8 string. Tolerates missing padding. */
function base64UrlToString(value: string): string {
	const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
	return Buffer.from(normalized, 'base64').toString('utf8');
}

/**
 * Decode username/githubId locally from a session token WITHOUT verifying the
 * HMAC (the server verifies on use). Returns null on a malformed token.
 *
 * Token shape: `base64url(JSON(payload)).base64url(sig)` (session.ts).
 */
export function decodeSessionToken(token: string): { githubId: number; username: string } | null {
	try {
		if (!token) return null;
		const parts = token.split('.');
		if (parts.length !== 2) return null;

		const payload = JSON.parse(base64UrlToString(parts[0]));
		if (
			payload &&
			typeof payload === 'object' &&
			typeof payload.githubId === 'number' &&
			typeof payload.username === 'string'
		) {
			return { githubId: payload.githubId, username: payload.username };
		}
		return null;
	} catch {
		return null;
	}
}
