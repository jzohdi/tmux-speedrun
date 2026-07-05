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

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { tmuxVersion } from './client';
import { createIsolatedTmuxServer, type IsolatedTmuxServer } from './server';
import * as configModule from './config';
import { SINK_HOOKS } from './config';

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

// ---------------------------------------------------------------------------
// R2 — ONESHOT round (issue #45 PR feedback, plan §8.5 integration tests 1–5).
// Pins the per-machine hook/alias balance, the rebind coverage, liveHooks
// capture, the nested-context shims, and the speedrun-attach runner spelling.
// The R2 exports are reached via casts — they do not exist yet.
// ---------------------------------------------------------------------------

type KeyRebindX = { key: string; repeat?: boolean; events: readonly string[]; command: string };
type CommandAliasX = { names: readonly string[]; events: readonly string[]; command: string };

const { KEY_REBINDS, COMMAND_ALIASES, RUNNER_ATTACH_COMMAND, expectedSinkEventsFor } =
	configModule as unknown as {
		KEY_REBINDS?: readonly KeyRebindX[];
		COMMAND_ALIASES?: readonly CommandAliasX[];
		RUNNER_ATTACH_COMMAND?: string;
		expectedSinkEventsFor?: (args: string[], liveHooks: ReadonlySet<string>) => string[];
	};

type ServerR2 = IsolatedTmuxServer & { liveHooks?: ReadonlySet<string> };

/** Run a real tmux CLI client to completion, capturing output. */
function runTmuxClient(
	args: string[],
	env?: NodeJS.ProcessEnv
): Promise<{ code: number | null; out: string; err: string }> {
	return new Promise((resolve, reject) => {
		const child = spawn('tmux', args, {
			env: env ?? process.env,
			stdio: ['ignore', 'pipe', 'pipe']
		});
		let out = '';
		let err = '';
		child.stdout.on('data', (d: Buffer) => (out += d.toString()));
		child.stderr.on('data', (d: Buffer) => (err += d.toString()));
		child.on('error', reject);
		child.on('close', (code) => resolve({ code, out, err }));
	});
}

describe.skipIf(!hasTmux)('live server — R2 ONESHOT round (plan §8.5)', () => {
	const servers: IsolatedTmuxServer[] = [];

	afterEach(async () => {
		for (const server of servers.splice(0)) {
			await server.teardown();
		}
	});

	async function create(): Promise<ServerR2> {
		const server = await createIsolatedTmuxServer({ initialSession: 'speedrun' });
		servers.push(server);
		return server as ServerR2;
	}

	const sinkFrom = (server: IsolatedTmuxServer, offset: number): string[] =>
		readFileSync(server.eventSink, 'utf8')
			.slice(offset)
			.split('\n')
			.map((l) => l.trim())
			.filter(Boolean);

	it('captures liveHooks via show-hooks -g: a non-empty subset of SINK_HOOKS, and every DEAD hook’s command still has a rebind/alias channel', async () => {
		const server = await create();
		expect(server.liveHooks, 'server must expose liveHooks (R2, interface §3)').toBeDefined();
		const live = server.liveHooks!;
		expect(live.size, 'no SINK_HOOKS entry is live — show-hooks parsing is broken').toBeGreaterThan(
			0
		);
		for (const hook of live) {
			expect(SINK_HOOKS, `liveHooks contains '${hook}' which is not in SINK_HOOKS`).toContain(hook);
		}

		// Version-drift net (§8.5 test 3): a hook this tmux rejected must not be
		// a step's ONLY channel — its command needs a write-first rebind/alias,
		// or a guaranteed state-diff channel.
		expect(KEY_REBINDS, 'config.ts must export KEY_REBINDS (R2)').toBeDefined();
		expect(COMMAND_ALIASES, 'config.ts must export COMMAND_ALIASES (R2)').toBeDefined();
		const coveredWords = new Set([
			...(KEY_REBINDS ?? []).map((r) => r.command.split(' ')[0]),
			...(COMMAND_ALIASES ?? []).flatMap((a) => [...a.names]),
			...(COMMAND_ALIASES ?? []).map((a) => a.command.split(' ')[0])
		]);
		// Always performable from minimal state; classified from the state diff.
		const stateDiffCovered = [
			'copy-mode',
			'split-window',
			'new-window',
			'kill-pane',
			'kill-window',
			'rename-window',
			'rename-session'
		];
		const stranded: string[] = [];
		for (const hook of SINK_HOOKS) {
			if (!hook.startsWith('after-')) continue;
			if (live.has(hook)) continue;
			const command = hook.slice('after-'.length);
			if (!coveredWords.has(command) && !stateDiffCovered.includes(command)) {
				stranded.push(`${hook} is dead on this tmux and '${command}' has no other channel`);
			}
		}
		expect(stranded, stranded.join('\n')).toEqual([]);
	}, 30_000);

	it('one scripted exec per aliased spelling writes EXACTLY the expected sink multiset (per-machine hook/alias balance, §8.5 test 1)', async () => {
		expect(COMMAND_ALIASES, 'config.ts must export COMMAND_ALIASES (R2)').toBeDefined();
		expect(typeof expectedSinkEventsFor, 'config.ts must export expectedSinkEventsFor').toBe(
			'function'
		);
		const server = await create();
		expect(server.liveHooks, 'server must expose liveHooks (R2, interface §3)').toBeDefined();
		const live = server.liveHooks!;

		// Scripted state: a second window + window-nav history, so every alias's
		// real command can succeed where the context allows it.
		await server.exec(['new-window', '-d', '-t', 'speedrun:1']);
		await server.exec(['select-window', '-t', 'speedrun:1']);
		await server.exec(['select-window', '-t', 'speedrun:0']);
		const noopConf = join(
			tmpdir(),
			`speedrun-noop-${process.pid}-${Math.random().toString(36).slice(2)}.conf`
		);
		writeFileSync(noopConf, '# no-op sourced file\n');

		// One exec per intercepted spelling. `errors: true` marks spellings whose
		// trailing command deterministically errors in this scripted (client-less)
		// context — those must still write the ALIAS events (§2.3 rule-2 subset):
		// that write-first behavior is exactly what un-sticks the reported steps.
		const scripted: Record<string, { prep?: string[][]; args: string[]; errors?: boolean }> = {
			'show-buffer': { prep: [['set-buffer', 'seed-show-buffer']], args: ['show-buffer'] },
			showb: { prep: [['set-buffer', 'seed-showb']], args: ['showb'] },
			'source-file': { args: ['source-file', noopConf] },
			source: { args: ['source', noopConf] },
			'kill-session': {
				prep: [['new-session', '-d', '-s', 'victim']],
				args: ['kill-session', '-t', 'victim']
			},
			'select-window': { args: ['select-window', '-t', 'speedrun:0'] },
			selectw: { args: ['selectw', '-t', 'speedrun:0'] },
			'next-window': { args: ['next-window', '-t', 'speedrun'] },
			next: { args: ['next', '-t', 'speedrun'] },
			'previous-window': { args: ['previous-window', '-t', 'speedrun'] },
			prev: { args: ['prev', '-t', 'speedrun'] },
			'last-window': { args: ['last-window', '-t', 'speedrun'] },
			last: { args: ['last', '-t', 'speedrun'] },
			'new-session': { args: ['new-session', '-s', 'made-new-session'] },
			new: { args: ['new', '-s', 'made-new'] },
			'attach-session': { args: ['attach-session'], errors: true },
			attach: { args: ['attach'], errors: true },
			a: { args: ['a'], errors: true },
			'list-sessions': { args: ['list-sessions'] },
			ls: { args: ['ls'] },
			'list-windows': { args: ['list-windows', '-t', 'speedrun'] },
			lsw: { args: ['lsw', '-t', 'speedrun'] },
			'list-buffers': { args: ['list-buffers'] },
			lsb: { args: ['lsb'] },
			'delete-buffer': { prep: [['set-buffer', 'seed-del-1']], args: ['delete-buffer'] },
			deleteb: { prep: [['set-buffer', 'seed-del-2']], args: ['deleteb'] },
			'capture-pane': { args: ['capture-pane', '-t', 'speedrun:0'] },
			capturep: { args: ['capturep', '-t', 'speedrun:0'] },
			'join-pane': {
				prep: [['new-window', '-d', '-t', 'speedrun:7']],
				args: ['join-pane', '-s', 'speedrun:7', '-t', 'speedrun:0']
			},
			joinp: {
				prep: [['new-window', '-d', '-t', 'speedrun:8']],
				args: ['joinp', '-s', 'speedrun:8', '-t', 'speedrun:0']
			},
			'swap-window': { args: ['swap-window', '-s', 'speedrun:0', '-t', 'speedrun:1'] },
			swapw: { args: ['swapw', '-s', 'speedrun:0', '-t', 'speedrun:1'] },
			'list-keys': { args: ['list-keys'] },
			lsk: { args: ['lsk'] }
		};

		const mismatches: string[] = [];
		try {
			for (const alias of COMMAND_ALIASES ?? []) {
				for (const name of alias.names) {
					const script = scripted[name];
					if (!script) {
						mismatches.push(`no scripted exec for alias '${name}' — extend this test`);
						continue;
					}
					for (const prep of script.prep ?? []) await server.exec(prep);
					await sleep(400); // let prep / straggler hook writes land before marking
					const from = readFileSync(server.eventSink, 'utf8').length;
					await server.exec(script.args);
					const expected = (
						script.errors ? [...alias.events] : expectedSinkEventsFor!(script.args, live)
					).sort();
					await waitFor(() => sinkFrom(server, from).length >= expected.length, 4000);
					await sleep(400); // catch EXTRA writes too — extras are the self-completion bug
					const got = sinkFrom(server, from).sort();
					if (JSON.stringify(got) !== JSON.stringify(expected)) {
						mismatches.push(`${name}: expected [${expected.join(', ')}] got [${got.join(', ')}]`);
					}
				}
			}
		} finally {
			rmSync(noopConf, { force: true });
		}
		expect(mismatches, `sink multiset drift:\n${mismatches.join('\n')}`).toEqual([]);
	}, 180_000);

	it('list-keys shows every KEY_REBINDS key bound to the sink write plus its final command (§8.5 test 2)', async () => {
		expect(KEY_REBINDS, 'config.ts must export KEY_REBINDS (R2)').toBeDefined();
		const server = await create();
		const res = await server.exec(['list-keys']);
		expect(res.code).toBe(0);
		const lines = res.stdout.split('\n');
		for (const rebind of KEY_REBINDS ?? []) {
			const line = lines.find(
				(l) => l.includes(rebind.command) && rebind.events.every((e) => l.includes(e))
			);
			expect(
				line,
				`no binding runs '${rebind.command}' with its sink write (key ${rebind.key})`
			).toBeDefined();
			if (rebind.repeat) {
				expect(line, `binding for ${rebind.key} must keep the -r repeat flag`).toContain('-r');
			}
		}
	}, 30_000);

	it('a client with $TMUX set can run new-session: the shim creates a REAL detached session, no nested error (§8.5 test 4)', async () => {
		const server = await create();
		const from = readFileSync(server.eventSink, 'utf8').length;

		// Simulates the reported feedback case 1: the user types `tmux new -s x`
		// in a challenge pane, where $TMUX points at the private server.
		const res = await runTmuxClient(
			['-L', server.socketName, '-f', server.confPath, 'new-session', '-s', 'nested-ok'],
			{
				...process.env,
				TMUX: '/tmp/tmux-99999/default,12345,0',
				TMUX_PANE: '%7'
			}
		);
		expect(res.err, 'the nested-session guard must not fire inside the run').not.toMatch(
			/nested with care/
		);
		expect(res.code, `client failed: ${res.err}`).toBe(0);

		const list = await server.exec(['list-sessions', '-F', '#{session_name}']);
		expect(list.stdout, 'the shim must create a real session on the private server').toContain(
			'nested-ok'
		);
		expect(
			await waitFor(() => sinkFrom(server, from).includes('after-new-session')),
			'the write-first after-new-session event is missing from the sink'
		).toBe(true);
	}, 30_000);

	it('runner attaches use speedrun-attach with TMUX stripped, and config errors stay absorbed across restarts (§8.5 test 5)', async () => {
		const calls: { args: readonly string[]; env?: NodeJS.ProcessEnv }[] = [];
		const recordingSpawn = ((command: string, args: string[], opts: Record<string, unknown>) => {
			calls.push({ args, env: opts?.env as NodeJS.ProcessEnv | undefined });
			return spawn(command as never, args as never, opts as never);
		}) as typeof spawn;

		const server = (await createIsolatedTmuxServer({
			initialSession: 'speedrun',
			spawnImpl: recordingSpawn
		} as unknown as Parameters<typeof createIsolatedTmuxServer>[0])) as ServerR2;
		servers.push(server);

		// (a) the absorb control client goes through the private alias with a
		// sanitized env — with the §2.4a shim installed, a raw 'attach-session'
		// would be rewritten into a non-attaching switch-client and the queued
		// config errors would hit the user's first real attach.
		const runnerAttach = RUNNER_ATTACH_COMMAND ?? 'speedrun-attach';
		const attachSpawns = calls.filter((c) => c.args?.includes(runnerAttach));
		expect(
			attachSpawns.length,
			'absorbConfigErrors must spawn its control client via speedrun-attach through the spawnImpl seam'
		).toBeGreaterThan(0);
		for (const call of calls) {
			expect(
				call.args,
				'no runner client spawn may use the intercepted attach-session spelling'
			).not.toContain('attach-session');
			expect(call.env, 'client spawns must pass an explicit sanitized env').toBeDefined();
			expect('TMUX' in (call.env ?? {}), 'client env must strip TMUX').toBe(false);
			expect('TMUX_PANE' in (call.env ?? {}), 'client env must strip TMUX_PANE').toBe(false);
		}

		// (b) …and attach() uses the same spelling (recorded through the seam).
		const beforeAttach = calls.length;
		await server.attach(); // no TTY here: the client exits immediately, which is fine
		const attachCall = calls.slice(beforeAttach).find((c) => c.args?.includes(runnerAttach));
		expect(attachCall, 'attach() must spawn its client via speedrun-attach').toBeDefined();

		// (c) a FRESH control client sees no queued config-error output at start…
		const probe = () =>
			runTmuxClient([
				'-L',
				server.socketName,
				'-f',
				server.confPath,
				'-C',
				runnerAttach,
				';',
				'detach-client'
			]);
		let res = await probe();
		expect(res.out + res.err).not.toMatch(/%config-error|unknown command/i);

		// …and after a scripted ensureRunning restart (which must re-absorb).
		await server.exec(['kill-server']);
		await sleep(300);
		const restart = await server.ensureRunning({ session: 'speedrun' });
		expect(restart.restartedServer).toBe(true);
		res = await probe();
		expect(res.out + res.err).not.toMatch(/%config-error|unknown command/i);
	}, 60_000);
});
