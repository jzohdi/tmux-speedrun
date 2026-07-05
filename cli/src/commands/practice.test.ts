/**
 * Failing test for the R4 practice-command wiring (issue #45, PR #46 third
 * feedback round, interface §12.1 / §12.3). The reported "detach/re-attach on
 * almost every command" regression is structural: `practice.ts` currently loops
 * over the drills and creates ONE isolated tmux server (and one
 * `PracticeController` + `runAttachLoop`) PER drill, tearing each down before
 * the next. The fix runs the WHOLE drill list in ONE server / ONE controller.
 *
 * This is the "light" command-level guard: with the heavy deps mocked, a
 * multi-drill run must construct `createIsolatedTmuxServer` exactly once. The
 * shipped per-item loop calls it once per drill, so this fails until the command
 * is restructured.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
	createServer: vi.fn(async () => ({ teardown: vi.fn(async () => {}) })),
	controllerRun: vi.fn(async () => ({ completed: true }))
}));

vi.mock('../tmux/server', () => ({ createIsolatedTmuxServer: h.createServer }));
vi.mock('../tmux/observer', () => ({
	TmuxObserver: class {
		constructor(_server: unknown) {}
	}
}));
vi.mock('../ui/status-line', () => ({
	StatusLine: class {
		constructor(_server: unknown) {}
	}
}));
vi.mock('../tmux/controller', () => ({
	PracticeController: class {
		run = h.controllerRun;
	}
}));
vi.mock('./preflight', () => ({ requireInteractiveTmux: async () => null }));
vi.mock('../ui/output', () => ({
	info: () => {},
	success: () => {},
	error: () => {},
	bold: (s: string) => s
}));

import { practiceCommand } from './practice';
import type { CommandContext } from './types';

const ctx = { options: {}, api: {}, session: null } as unknown as CommandContext;

describe('practice command — one isolated server for the whole run (interface §12.1)', () => {
	beforeEach(() => {
		h.createServer.mockClear();
		h.controllerRun.mockClear();
	});

	it('creates exactly one isolated tmux server for a multi-drill run', async () => {
		const code = await practiceCommand.run(ctx, []);

		expect(code).toBe(0);
		// The whole drill list runs in ONE server / ONE controller / ONE loop; the
		// shipped per-item loop created a fresh server per drill — the "detach
		// between drills" regression this fix removes.
		expect(h.createServer).toHaveBeenCalledTimes(1);
		// And the controller is driven once over all items, not once per drill.
		expect(h.controllerRun).toHaveBeenCalledTimes(1);
	});
});
