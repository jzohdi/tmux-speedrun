/**
 * Preflight checks for interactive tmux commands (issue #35, interface §5.4).
 *
 * Requires tmux ≥ 3.0 (hook/format coverage) and a real TTY. Returns null when
 * OK, or a human-readable error string describing what to fix.
 */

import { tmuxVersion } from '../tmux/client';

const MIN_MAJOR = 3;

export async function requireInteractiveTmux(): Promise<string | null> {
	if (!process.stdout.isTTY || !process.stdin.isTTY) {
		return 'This command needs an interactive terminal (TTY).';
	}

	let version: { major: number; minor: number; raw: string };
	try {
		version = await tmuxVersion();
	} catch {
		return 'tmux was not found. Install tmux ≥ 3.0 (on Windows, use WSL) and try again.';
	}

	if (version.major < MIN_MAJOR) {
		return `tmux ≥ 3.0 is required (found "${version.raw}"). Please upgrade.`;
	}

	return null;
}
