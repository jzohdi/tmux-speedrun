/**
 * Failing tests for the observer's issue #45 surface (interface §4).
 *
 * The event sink becomes a real channel: offset tailing (§4.2), a runner
 * self-suppression queue (§4.3, invariant SUP1), `commandEvents` /
 * `enteredMode` / `movedPanes` on the diff (§1), and the run loop's recovery
 * primitives `resetBaseline()` / `drainDelta()`.
 *
 * The new members are reached through a typed shim (`obsX`) because they do
 * not exist yet — each test fails at runtime ("not a function" / missing
 * field) until the feature is implemented. No tmux binary is needed: the
 * server is faked and the sink is a real temp file.
 */

import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TmuxObserver } from './observer';
import type { IsolatedTmuxServer } from './server';
import type { TmuxResult } from './client';
import type { PaneInfo, StateDelta, TmuxState } from '../engine/types';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type MovedPane = {
	paneId: string;
	from: { session: string; windowIndex: number };
	to: { session: string; windowIndex: number };
};

type DeltaX = StateDelta & {
	commandEvents?: string[];
	enteredMode?: string;
	movedPanes?: MovedPane[];
};

/** The issue #45 observer surface (interface §4). */
type ObserverX = {
	exec(args: string[]): Promise<TmuxResult>;
	expectEvents(events: string[]): void;
	snapshot(): Promise<TmuxState>;
	diff(prev: TmuxState, next: TmuxState, ctx?: { seedInput?: string; commandEvents?: string[] }): DeltaX;
	watch(
		onDelta: (d: DeltaX) => void,
		opts?: { intervalMs?: number; getSeedInput?: () => string | undefined }
	): { stop(): void };
	resetBaseline(opts?: { settleMs?: number }): Promise<void>;
	drainDelta(opts?: {
		settleMs?: number;
		extraEvents?: string[];
		seedInput?: string;
	}): Promise<DeltaX>;
};

const obsX = (o: TmuxObserver): ObserverX => o as unknown as ObserverX;

const ok = (stdout: string): TmuxResult => ({ stdout, stderr: '', code: 0 });

const cleanups: (() => void)[] = [];
afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
});

/**
 * Fake isolated server: canned exec responses (zero panes/buffers so the
 * canned lines parse under ANY future -F format) + a REAL temp sink file.
 */
function makeFakeServer(overrides?: { exec?: (args: string[]) => Promise<TmuxResult> }) {
	const dir = mkdtempSync(join(tmpdir(), 'speedrun-observer-test-'));
	const sinkPath = join(dir, 'events.log');
	writeFileSync(sinkPath, '');
	cleanups.push(() => rmSync(dir, { recursive: true, force: true }));

	const execLog: string[][] = [];
	const exec = async (args: string[]): Promise<TmuxResult> => {
		execLog.push(args);
		if (overrides?.exec) return overrides.exec(args);
		switch (args[0]) {
			case 'list-sessions':
				return ok('main\t1\n');
			default:
				return ok('');
		}
	};

	const server = {
		socketName: 'test-socket',
		confPath: join(dir, 'tmux.conf'),
		eventSink: sinkPath,
		exec,
		attach: async () => {
			throw new Error('attach is not used in observer tests');
		},
		teardown: async () => {}
	} as unknown as IsolatedTmuxServer;

	return { server, sinkPath, execLog };
}

function paneX(paneId: string, over: Partial<PaneInfo> & { mode?: string | null } = {}): PaneInfo {
	return {
		paneId,
		sessionName: 'main',
		windowIndex: 0,
		windowName: 'win',
		active: true,
		left: 0,
		top: 0,
		width: 80,
		height: 24,
		zoomed: false,
		inMode: false,
		mode: null,
		...over
	} as PaneInfo;
}

function state(over: Partial<TmuxState> = {}): TmuxState {
	return {
		sessions: ['main'],
		windows: [{ session: 'main', index: 0, name: 'win', active: true }],
		panes: [],
		activePaneId: null,
		activeWindow: { session: 'main', index: 0 },
		buffers: [],
		...over
	};
}

describe('diff — commandEvents / enteredMode / movedPanes (interface §1)', () => {
	const obs = () => obsX(new TmuxObserver(makeFakeServer().server));

	it('copies ctx.commandEvents into the delta verbatim', () => {
		const d = obs().diff(state(), state(), {
			commandEvents: ['after-select-window', 'client-detached']
		});
		expect(d.commandEvents).toEqual(['after-select-window', 'client-detached']);
	});

	it('commandEvents defaults to [] (always present)', () => {
		expect(obs().diff(state(), state()).commandEvents).toEqual([]);
	});

	it('a pane entering clock-mode sets enteredMode but NOT enteredCopyMode', () => {
		const prev = state({ panes: [paneX('%1')], activePaneId: '%1' });
		const next = state({
			panes: [paneX('%1', { inMode: true, mode: 'clock-mode' })],
			activePaneId: '%1'
		});
		const d = obs().diff(prev, next);
		expect(d.enteredMode).toBe('clock-mode');
		expect(d.enteredCopyMode).toBe(false);
	});

	it('a pane entering tree-mode likewise does not count as copy mode', () => {
		const prev = state({ panes: [paneX('%1')], activePaneId: '%1' });
		const next = state({
			panes: [paneX('%1', { inMode: true, mode: 'tree-mode' })],
			activePaneId: '%1'
		});
		const d = obs().diff(prev, next);
		expect(d.enteredMode).toBe('tree-mode');
		expect(d.enteredCopyMode).toBe(false);
	});

	it('copy-mode and view-mode still set enteredCopyMode', () => {
		for (const mode of ['copy-mode', 'view-mode']) {
			const prev = state({ panes: [paneX('%1')], activePaneId: '%1' });
			const next = state({ panes: [paneX('%1', { inMode: true, mode })], activePaneId: '%1' });
			const d = obs().diff(prev, next);
			expect(d.enteredCopyMode, `mode ${mode} must count as copy mode`).toBe(true);
			expect(d.enteredMode).toBe(mode);
		}
	});

	it('enteredMode is undefined when no pane entered a mode', () => {
		const d = obs().diff(state({ panes: [paneX('%1')] }), state({ panes: [paneX('%1')] }));
		expect(d.enteredMode).toBeUndefined();
	});

	it('a pane whose (session, windowIndex) changed is reported in movedPanes', () => {
		const prev = state({ panes: [paneX('%1'), paneX('%2', { windowIndex: 1, active: false })] });
		const next = state({
			panes: [paneX('%1', { windowIndex: 1 }), paneX('%2', { windowIndex: 1, active: false })]
		});
		const d = obs().diff(prev, next);
		expect(d.movedPanes).toEqual([
			{ paneId: '%1', from: { session: 'main', windowIndex: 0 }, to: { session: 'main', windowIndex: 1 } }
		]);
	});

	it('movedPanes is [] when nothing moved (always present)', () => {
		const d = obs().diff(state({ panes: [paneX('%1')] }), state({ panes: [paneX('%1')] }));
		expect(d.movedPanes).toEqual([]);
	});
});

describe('sink tailing + suppression queue (interface §4.2–§4.3)', () => {
	it('lines already in the sink at construction are never read (offset starts at EOF)', async () => {
		const f = makeFakeServer();
		appendFileSync(f.sinkPath, 'after-select-window\n'); // pre-run line
		const obs = obsX(new TmuxObserver(f.server));
		const d = await obs.drainDelta({ settleMs: 0 });
		expect(d.commandEvents).toEqual([]);
	});

	it('a user-caused hook line reaches the delta', async () => {
		const f = makeFakeServer();
		const obs = obsX(new TmuxObserver(f.server));
		appendFileSync(f.sinkPath, 'after-select-window\n');
		const d = await obs.drainDelta({ settleMs: 0 });
		expect(d.commandEvents).toEqual(['after-select-window']);
	});

	it('sink lines are consumed exactly once', async () => {
		const f = makeFakeServer();
		const obs = obsX(new TmuxObserver(f.server));
		appendFileSync(f.sinkPath, 'after-kill-session\n');
		expect((await obs.drainDelta({ settleMs: 0 })).commandEvents).toEqual(['after-kill-session']);
		expect((await obs.drainDelta({ settleMs: 0 })).commandEvents).toEqual([]);
	});

	it('a partial line is not consumed until its newline arrives', async () => {
		const f = makeFakeServer();
		const obs = obsX(new TmuxObserver(f.server));
		appendFileSync(f.sinkPath, 'after-select-');
		expect((await obs.drainDelta({ settleMs: 0 })).commandEvents).toEqual([]);
		appendFileSync(f.sinkPath, 'window\n');
		expect((await obs.drainDelta({ settleMs: 0 })).commandEvents).toEqual(['after-select-window']);
	});

	it('exec() suppresses exactly ONE matching sink line (runner action ≠ user action)', async () => {
		const f = makeFakeServer();
		const obs = obsX(new TmuxObserver(f.server));
		await obs.exec(['select-window', '-t', ':=1']);
		// the runner's own hook line + an identical user-caused one
		appendFileSync(f.sinkPath, 'after-select-window\nafter-select-window\n');
		const d = await obs.drainDelta({ settleMs: 0 });
		expect(d.commandEvents).toEqual(['after-select-window']);
	});

	it('exec() delegates to the server', async () => {
		const f = makeFakeServer();
		const obs = obsX(new TmuxObserver(f.server));
		await obs.exec(['select-window', '-t', ':=1']);
		expect(f.execLog).toContainEqual(['select-window', '-t', ':=1']);
	});

	it('expectEvents() accounts events WITHOUT executing anything', async () => {
		const f = makeFakeServer();
		const obs = obsX(new TmuxObserver(f.server));
		const execsBefore = f.execLog.length;
		obs.expectEvents(['client-attached', 'after-attach-session']);
		expect(f.execLog.length).toBe(execsBefore);
		appendFileSync(f.sinkPath, 'client-attached\nafter-attach-session\n');
		const d = await obs.drainDelta({ settleMs: 0 });
		expect(d.commandEvents).toEqual([]);
	});

	it('suppression entries expire (TTL) — a stale expectation cannot swallow a later user action', async () => {
		const f = makeFakeServer();
		const obs = obsX(new TmuxObserver(f.server));
		obs.expectEvents(['after-select-window']);
		await sleep(3100); // interface §4.3 pins the TTL at ~2000ms
		appendFileSync(f.sinkPath, 'after-select-window\n');
		const d = await obs.drainDelta({ settleMs: 0 });
		expect(d.commandEvents).toEqual(['after-select-window']);
	}, 10_000);
});

describe('resetBaseline — recovery boundary (interface §4)', () => {
	it('discards unread sink lines', async () => {
		const f = makeFakeServer();
		const obs = obsX(new TmuxObserver(f.server));
		appendFileSync(f.sinkPath, 'after-kill-session\n');
		await obs.resetBaseline({ settleMs: 0 });
		expect((await obs.drainDelta({ settleMs: 0 })).commandEvents).toEqual([]);
	});

	it('clears the suppression queue (post-recovery user actions are never swallowed)', async () => {
		const f = makeFakeServer();
		const obs = obsX(new TmuxObserver(f.server));
		obs.expectEvents(['after-select-window']);
		await obs.resetBaseline({ settleMs: 0 });
		appendFileSync(f.sinkPath, 'after-select-window\n');
		expect((await obs.drainDelta({ settleMs: 0 })).commandEvents).toEqual(['after-select-window']);
	});

	it('state changes across the boundary produce no delta (recovery must not look like a user action)', async () => {
		let sessions = 'main\t1\n';
		const f = makeFakeServer({
			exec: async (args) => (args[0] === 'list-sessions' ? ok(sessions) : ok(''))
		});
		const obs = obsX(new TmuxObserver(f.server));
		await obs.resetBaseline({ settleMs: 0 });
		sessions = 'main\t1\nrecovered\t0\n'; // the runner recreated a session…
		await obs.resetBaseline({ settleMs: 0 }); // …and reset across it
		const d = await obs.drainDelta({ settleMs: 0 });
		expect(d.sessionCountDelta).toBe(0);
	});
});

describe('drainDelta — exit classification (interface §4)', () => {
	it('appends synthetic extraEvents WITHOUT suppression filtering', async () => {
		const f = makeFakeServer();
		const obs = obsX(new TmuxObserver(f.server));
		// even a matching expectation must not swallow a synthetic event
		obs.expectEvents(['speedrun-server-died']);
		const d = await obs.drainDelta({ settleMs: 0, extraEvents: ['speedrun-server-died'] });
		expect(d.commandEvents).toContain('speedrun-server-died');
	});

	it('never throws when the server is dead (EMPTY_STATE fallback)', async () => {
		const f = makeFakeServer({
			exec: async () => {
				throw new Error('no server running on /tmp/tmux-000/test-socket');
			}
		});
		const obs = obsX(new TmuxObserver(f.server));
		const d = await obs.drainDelta({ settleMs: 0, extraEvents: ['speedrun-server-died'] });
		expect(d.commandEvents).toContain('speedrun-server-died');
		expect(d.next.sessions).toEqual([]);
	});
});

describe('watch — the sink is a real change channel (issue #45 defect 2 plumbing)', () => {
	it('a hook line ALONE (no state change) produces a delta carrying that commandEvent', async () => {
		const f = makeFakeServer();
		const obs = obsX(new TmuxObserver(f.server));
		const received: DeltaX[] = [];
		const watcher = obs.watch((d) => received.push(d), { intervalMs: 25 });
		try {
			await sleep(150); // let the poll establish its baseline
			// prefix+0 on the already-active window: the ONLY trace is the hook line
			appendFileSync(f.sinkPath, 'after-select-window\n');
			const deadline = Date.now() + 2000;
			while (received.length === 0 && Date.now() < deadline) await sleep(25);
		} finally {
			watcher.stop();
		}
		expect(received.length, 'watch never emitted a delta for a sink-only change').toBeGreaterThan(0);
		expect(received.some((d) => d.commandEvents?.includes('after-select-window'))).toBe(true);
	}, 10_000);
});
