/**
 * Isolated tmux server lifecycle (issue #35 §5.2; issue #45 interface §3,
 * invariant ISO1).
 *
 * Every run gets a dedicated tmux server on a unique private socket
 * (`tmux -L tmux-speedrun-<random>`) with a generated config. The user's
 * default socket is NEVER referenced, so a prompted `kill-session`/`kill-server`
 * can only affect this socket. Issue #45 adds recovery primitives: the server
 * can be restarted on the SAME socket after a challenge step kills it, and
 * sessions recreated after `kill-session` empties it (`exit-empty off` keeps
 * the server alive at zero sessions). Teardown (kill-server + temp cleanup)
 * runs on every exit path — signal handlers + caller `try/finally` — and is
 * idempotent.
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
	/** Attach the user's TTY; resolves with the tmux client's exit code when the attach ends (any reason). */
	attach(target?: string): Promise<{ code: number | null }>;
	/** True iff the private server responds on this socket. */
	isAlive(): Promise<boolean>;
	/**
	 * Idempotent recovery primitive: restart a dead server on the SAME socket
	 * (a plain exec with `-f` re-sources the conf) and/or recreate a session
	 * when the server is empty. Never touches any other socket (ISO1).
	 */
	ensureRunning(opts?: { session?: string }): Promise<{
		restartedServer: boolean;
		createdSession: boolean;
	}>;
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
	const initialSession = opts?.initialSession ?? 'speedrun';

	writeFileSync(confPath, buildIsolatedConfig({ eventSink }).text, { mode: 0o600 });
	writeFileSync(eventSink, '', { mode: 0o600 });

	let toreDown = false;
	const exec = (args: string[]) => tmuxExec(socketName, args, { conf: confPath });

	const isAlive = async (): Promise<boolean> => {
		try {
			// Probe with a command that has NO installed hook (SUP1): the run loop
			// calls isAlive between the attach ending and the drain reading the
			// sink, so a hooked probe (e.g. list-sessions) would write an
			// unaccounted event that could spuriously satisfy a step. With
			// `exit-empty off` an empty server still answers with exit 0.
			return (await exec(['show-options', '-s'])).code === 0;
		} catch {
			return false;
		}
	};

	// The generated config intentionally sets every SINK_HOOKS hook, including
	// `after-*` names the running tmux rejects (its hook whitelist varies by
	// command); tmux queues those config errors and shows them to the FIRST
	// attaching client. Absorb them with a throwaway control-mode client so the
	// user's attach never sees an error screen.
	const absorbConfigErrors = (): Promise<void> =>
		new Promise((resolve) => {
			const child = spawn(
				'tmux',
				['-L', socketName, '-f', confPath, '-C', 'attach-session', ';', 'detach-client'],
				{ stdio: 'ignore' }
			);
			const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
			const done = () => {
				clearTimeout(timer);
				resolve();
			};
			child.on('error', done);
			child.on('close', done);
		});

	const teardown = async (): Promise<void> => {
		if (toreDown) return;
		toreDown = true;
		// A torn-down server must not keep process-wide handlers: practice runs
		// one server per drill, and a STALE handler's exit(130) would race the
		// live server's async kill and orphan it (issue #45, LIFE1).
		process.removeListener('SIGINT', onSignal);
		process.removeListener('SIGTERM', onSignal);
		process.removeListener('SIGHUP', onSignal);
		process.removeListener('exit', onExit);
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
	const onExit = () => {
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
	};
	process.once('SIGINT', onSignal);
	process.once('SIGTERM', onSignal);
	process.once('SIGHUP', onSignal);
	process.once('exit', onExit);

	// Create the initial session detached so we can configure it before attach.
	await exec(['new-session', '-d', '-s', initialSession]);
	await absorbConfigErrors();

	// After teardown, nothing may touch the socket again: the signal-path
	// teardown races the run loop, and an ensureRunning/exec slipping through
	// would RESURRECT the just-killed server as an orphan (LIFE1).
	const guardedExec = (args: string[]): Promise<TmuxResult> => {
		if (toreDown) {
			return Promise.resolve({ stdout: '', stderr: 'server torn down', code: 1 });
		}
		return exec(args);
	};

	return {
		socketName,
		confPath,
		eventSink,
		exec: guardedExec,
		attach(target?: string): Promise<{ code: number | null }> {
			if (toreDown) return Promise.resolve({ code: 1 });
			return new Promise((resolve, reject) => {
				const args = ['-L', socketName, '-f', confPath, 'attach-session'];
				if (target) args.push('-t', target);
				const child = spawn('tmux', args, { stdio: 'inherit' });
				child.on('error', reject);
				child.on('close', (code) => resolve({ code }));
			});
		},
		isAlive,
		async ensureRunning(o?: { session?: string }) {
			const session = o?.session ?? initialSession;
			if (toreDown) return { restartedServer: false, createdSession: false };
			if (!(await isAlive())) {
				// `-f` on the exec re-sources the conf, so hooks and exit-empty
				// come back with the restarted server.
				await guardedExec(['new-session', '-d', '-s', session]);
				await absorbConfigErrors();
				return { restartedServer: true, createdSession: true };
			}
			const list = await guardedExec(['list-sessions', '-F', '#{session_name}']);
			const hasSessions = list.stdout.split('\n').some((l) => l.trim().length > 0);
			if (!hasSessions) {
				await guardedExec(['new-session', '-d', '-s', session]);
				return { restartedServer: false, createdSession: true };
			}
			return { restartedServer: false, createdSession: false };
		},
		teardown
	};
}
