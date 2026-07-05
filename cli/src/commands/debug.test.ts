/**
 * Failing tests for the `tmux-speedrun debug` diagnostic (issue #45 R3, plan
 * §9.4, interface §11.4). The command reuses the server/observer/detector
 * stack; its VALUE for "why isn't my command detected" is the live-vs-dead
 * hook partition (`server.liveHooks` ∩ / ∖ `SINK_HOOKS`).
 *
 * Only the PURE assembly is unit-tested here (no tmux): the hook partition and
 * the formatted report. The attach/trace path is integration/manual.
 *
 * The pure helpers do not exist yet — accessed via a cast so this file loads
 * and each test fails on the missing function, per interface §11.4/§11.5.
 */

import { describe, expect, it } from 'vitest';
import * as debugModule from './debug';

type HookPartition = { live: string[]; dead: string[] };

type DebugFacts = {
	tmuxVersion: string;
	platform: string;
	socketName: string;
	confPath: string;
	eventSink: string;
	liveHooks: readonly string[];
	sinkHooks: readonly string[];
};

const { partitionHooks, formatDebugReport } = debugModule as unknown as {
	partitionHooks?: (liveHooks: ReadonlySet<string>, sinkHooks: readonly string[]) => HookPartition;
	formatDebugReport?: (facts: DebugFacts) => string;
};

describe('partitionHooks — the live/dead hook split (interface §11.4)', () => {
	it('splits SINK_HOOKS into live and dead by liveHooks membership', () => {
		expect(partitionHooks, 'debug.ts must export partitionHooks (R3)').toBeTypeOf('function');
		const sinkHooks = ['after-select-window', 'after-clock-mode', 'client-detached'];
		const p = partitionHooks!(new Set(['after-select-window', 'client-detached']), sinkHooks);
		expect([...p.live].sort()).toEqual(['after-select-window', 'client-detached']);
		expect(p.dead).toEqual(['after-clock-mode']);
	});

	it('every SINK_HOOKS entry lands in exactly one of live/dead', () => {
		expect(partitionHooks, 'debug.ts must export partitionHooks (R3)').toBeTypeOf('function');
		const sinkHooks = ['after-a', 'after-b', 'after-c'];
		const p = partitionHooks!(new Set(['after-b']), sinkHooks);
		expect([...p.live, ...p.dead].sort()).toEqual([...sinkHooks].sort());
		expect(p.live.filter((h) => p.dead.includes(h))).toEqual([]);
	});
});

describe('formatDebugReport — the diagnostic dump (interface §11.4)', () => {
	const facts: DebugFacts = {
		tmuxVersion: '3.6a',
		platform: 'darwin',
		socketName: 'tmux-speedrun-abc123',
		confPath: '/tmp/speedrun/tmux.conf',
		eventSink: '/tmp/speedrun/events.log',
		liveHooks: ['after-select-window'],
		sinkHooks: ['after-select-window', 'after-clock-mode']
	};

	it('includes the tmux version, platform, and isolated-server locators', () => {
		expect(formatDebugReport, 'debug.ts must export formatDebugReport (R3)').toBeTypeOf('function');
		const report = formatDebugReport!(facts);
		expect(report).toContain('3.6a');
		expect(report).toContain('darwin');
		expect(report).toContain('tmux-speedrun-abc123');
		expect(report).toContain('/tmp/speedrun/tmux.conf');
		expect(report).toContain('/tmp/speedrun/events.log');
	});

	it('surfaces both the live and the dead hook so a stuck command is diagnosable', () => {
		expect(formatDebugReport, 'debug.ts must export formatDebugReport (R3)').toBeTypeOf('function');
		const report = formatDebugReport!(facts);
		expect(report).toContain('after-select-window'); // live
		expect(report).toContain('after-clock-mode'); // dead
	});
});
