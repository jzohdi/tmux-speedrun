/**
 * Low-level `tmux -L <socket> ...` exec helpers (issue #35, interface §5.1).
 *
 * Every challenge/practice tmux invocation goes through here with an explicit
 * `-L <socket>` (and optional `-f <conf>`) so the user's default tmux server is
 * never referenced (invariant ISO1).
 */

import { spawn } from 'node:child_process';

export type TmuxResult = { stdout: string; stderr: string; code: number };

/**
 * Run `tmux -L <socket> [-f <conf>] <args...>`. Resolves with the captured
 * output; never rejects on a non-zero exit (callers decide). Rejects only if
 * tmux cannot be spawned (e.g. not installed).
 */
export function tmuxExec(
	socket: string,
	args: string[],
	opts?: { conf?: string }
): Promise<TmuxResult> {
	const baseArgs = ['-L', socket];
	if (opts?.conf) baseArgs.push('-f', opts.conf);

	return new Promise((resolve, reject) => {
		const child = spawn('tmux', [...baseArgs, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
		let stdout = '';
		let stderr = '';
		child.stdout.on('data', (d) => (stdout += d.toString()));
		child.stderr.on('data', (d) => (stderr += d.toString()));
		child.on('error', reject);
		child.on('close', (code) => resolve({ stdout, stderr, code: code ?? 0 }));
	});
}

/** `tmux -V` → parsed { major, minor, raw }. Rejects if tmux is missing. */
export function tmuxVersion(): Promise<{ major: number; minor: number; raw: string }> {
	return new Promise((resolve, reject) => {
		const child = spawn('tmux', ['-V'], { stdio: ['ignore', 'pipe', 'pipe'] });
		let stdout = '';
		child.stdout.on('data', (d) => (stdout += d.toString()));
		child.on('error', reject);
		child.on('close', () => {
			const raw = stdout.trim();
			// e.g. "tmux 3.3a" → major 3, minor 3
			const match = raw.match(/(\d+)\.(\d+)/);
			if (!match) {
				reject(new Error(`Could not parse tmux version from: ${raw}`));
				return;
			}
			resolve({ major: Number(match[1]), minor: Number(match[2]), raw });
		});
	});
}
