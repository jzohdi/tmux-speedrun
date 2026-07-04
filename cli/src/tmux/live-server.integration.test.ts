/**
 * Live isolated-tmux-server integration tests (issue #45, interface §10).
 *
 * Runs against a REAL private tmux server (`tmux -L tmux-speedrun-*`) — no TTY
 * needed, everything is scripted `exec`s. Skipped when tmux is not installed.
 *
 * Pins the lifecycle behavior that makes defect 3 fixable:
 *  - `exit-empty off`: killing the last session leaves a live, queryable,
 *    0-session server (so the kill is observable and recovery is possible),
 *  - `ensureRunning()` recreates sessions and restarts a dead server on the
 *    SAME private socket (invariant ISO1),
 *  - the expanded hook set writes event lines to the sink (defect 2 channel),
 *  - teardown leaves no server process or temp dir behind.
 */

import { existsSync, readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { tmuxVersion } from './client';
import { createIsolatedTmuxServer, type IsolatedTmuxServer } from './server';

const hasTmux = await tmuxVersion().then(
	() => true,
	() => false
);

/** The issue #45 server surface (interface §3); missing members fail at runtime. */
type ServerX = IsolatedTmuxServer & {
	isAlive(): Promise<boolean>;
	ensureRunning(opts?: {
		session?: string;
	}): Promise<{ restartedServer: boolean; createdSession: boolean }>;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Poll `cond` until true or timeout (hook run-shell writes are async). */
async function waitFor(cond: () => boolean, timeoutMs = 4000): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (cond()) return true;
		await sleep(100);
	}
	return cond();
}

describe.skipIf(!hasTmux)('live isolated tmux server (issue #45 lifecycle)', () => {
	const servers: IsolatedTmuxServer[] = [];

	afterEach(async () => {
		for (const server of servers.splice(0)) {
			await server.teardown();
		}
	});

	async function create(): Promise<ServerX> {
		const server = await createIsolatedTmuxServer({ initialSession: 'speedrun' });
		servers.push(server);
		return server as ServerX;
	}

	it('survives kill-session of the last session (exit-empty off), and ensureRunning recreates it', async () => {
		const server = await create();
		await server.exec(['kill-session', '-t', 'speedrun']);

		expect(server.isAlive, 'server must expose isAlive() (interface §3)').toBeTypeOf('function');
		// Today the whole private server dies with its last session, making the
		// kill unobservable and recovery impossible.
		expect(await server.isAlive()).toBe(true);

		const result = await server.ensureRunning({ session: 'speedrun' });
		expect(result.createdSession).toBe(true);
		const list = await server.exec(['list-sessions', '-F', '#{session_name}']);
		expect(list.code).toBe(0);
		expect(list.stdout).toContain('speedrun');
	}, 20_000);

	it('writes hook lines to the event sink for pool commands (defect 2 channel)', async () => {
		const server = await create();
		// select the ALREADY-ACTIVE window — the defect-2 case with no state change
		await server.exec(['select-window', '-t', 'speedrun:0']);
		await server.exec(['new-window', '-t', 'speedrun']);
		await server.exec(['next-window', '-t', 'speedrun']);
		await server.exec(['kill-session', '-t', 'speedrun']);

		const sinkHas = (event: string) => readFileSync(server.eventSink, 'utf8').includes(event);
		expect(
			await waitFor(() => sinkHas('after-select-window')),
			'after-select-window missing from sink'
		).toBe(true);
		expect(
			await waitFor(() => sinkHas('after-next-window'), 1000),
			'after-next-window missing from sink'
		).toBe(true);
		expect(
			await waitFor(() => sinkHas('after-kill-session'), 1000),
			'after-kill-session missing from sink'
		).toBe(true);
	}, 20_000);

	it('ensureRunning restarts a killed private server on the SAME socket (ISO1)', async () => {
		const server = await create();
		await server.exec(['kill-server']);
		await sleep(300);
		expect(server.isAlive, 'server must expose isAlive() (interface §3)').toBeTypeOf('function');
		expect(await server.isAlive()).toBe(false);

		const result = await server.ensureRunning({ session: 'speedrun' });
		expect(result.restartedServer).toBe(true);
		expect(await server.isAlive()).toBe(true);
		const list = await server.exec(['list-sessions', '-F', '#{session_name}']);
		expect(list.code).toBe(0);
		expect(list.stdout).toContain('speedrun');
	}, 20_000);

	it('teardown kills the private server and removes its temp dir (no orphans)', async () => {
		const server = await create();
		await server.teardown();
		const res = await server.exec(['list-sessions']);
		expect(res.code).not.toBe(0); // nothing responds on the socket anymore
		expect(existsSync(server.confPath)).toBe(false);
	}, 20_000);
});
