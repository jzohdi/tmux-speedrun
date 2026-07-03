/**
 * Isolated tmux server lifecycle (issue #35, interface §5.2, invariant ISO1).
 *
 * Every run gets a dedicated tmux server on a unique private socket
 * (`tmux -L tmux-speedrun-<random>`) with a generated config. The user's
 * default socket is NEVER referenced, so a prompted `kill-session`/`kill-server`
 * can only affect this socket. Teardown (kill-server + temp cleanup) runs on
 * every exit path — signal handlers + caller `try/finally` — and is idempotent.
 */

import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { tmuxExec, type TmuxResult } from './client';
import { buildIsolatedConfig } from './config';

export type IsolatedTmuxServer = {
	socketName: string;
	confPath: string;
	eventSink: string;
	exec(args: string[]): Promise<TmuxResult>;
	/** Attach the user's TTY into the isolated server (blocks until detach). */
	attach(target?: string): Promise<void>;
	/** kill-server on THIS socket + remove temp dir. Idempotent; ignores "no server". */
	teardown(): Promise<void>;
};

export async function createIsolatedTmuxServer(opts?: {
	initialSession?: string;
}): Promise<IsolatedTmuxServer> {
	const socketName = `tmux-speedrun-${randomBytes(4).toString('hex')}`;
	const tempDir = mkdtempSync(join(tmpdir(), 'tmux-speedrun-'));
	const confPath = join(tempDir, 'tmux.conf');
	const eventSink = join(tempDir, 'events.log');

	writeFileSync(confPath, buildIsolatedConfig({ eventSink }).text, { mode: 0o600 });
	writeFileSync(eventSink, '', { mode: 0o600 });

	let toreDown = false;
	const exec = (args: string[]) => tmuxExec(socketName, args, { conf: confPath });

	const teardown = async (): Promise<void> => {
		if (toreDown) return;
		toreDown = true;
		try {
			await exec(['kill-server']);
		} catch {
			// no server / already gone — ignore
		}
		rmSync(tempDir, { recursive: true, force: true });
	};

	// Bulletproof cleanup on every exit path (ISO1). Idempotent teardown.
	const onSignal = () => {
		void teardown().finally(() => process.exit(130));
	};
	process.once('SIGINT', onSignal);
	process.once('SIGTERM', onSignal);
	process.once('SIGHUP', onSignal);
	process.once('exit', () => {
		// Synchronous best-effort on normal exit; the async teardown in `finally`
		// is the primary path, this only backstops an unexpected exit.
		if (!toreDown) {
			try {
				spawn('tmux', ['-L', socketName, 'kill-server'], { stdio: 'ignore' }).unref();
				rmSync(tempDir, { recursive: true, force: true });
			} catch {
				// ignore
			}
		}
	});

	// Create the initial session detached so we can configure it before attach.
	await exec(['new-session', '-d', '-s', opts?.initialSession ?? 'speedrun']);

	return {
		socketName,
		confPath,
		eventSink,
		exec,
		attach(target?: string): Promise<void> {
			return new Promise((resolve, reject) => {
				const args = ['-L', socketName, '-f', confPath, 'attach-session'];
				if (target) args.push('-t', target);
				const child = spawn('tmux', args, { stdio: 'inherit' });
				child.on('error', reject);
				child.on('close', () => resolve());
			});
		},
		teardown
	};
}
