/**
 * Tests for `deriveCandidates` (`detector.ts`) — issue #35, interface §7
 * (invariant DET1: pure/deterministic; trial-decrypt is the correctness
 * authority, so the detector only needs to *include* the right candidate).
 *
 * Because emitting EXTRA candidates is explicitly allowed (the key-chain
 * trial-decrypt filters them), assertions are `toContain(expected)` by
 * default. Issue #45 (interface §5) tightens a few specific cases — targeted
 * vs generic window selection, wrong-text renames, kill-server only when the
 * server is empty — and those suites assert absence deliberately.
 */

import { describe, it, expect } from 'vitest';
import * as detectorModule from './detector';
import { deriveCandidates } from './detector';
import type { PaneInfo, StateDelta, TmuxState } from '../engine/types';
import type { DecryptedStep } from '$lib/client/challenge-core';

function pane(paneId: string, over: Partial<PaneInfo> = {}): PaneInfo {
	return {
		paneId,
		sessionName: 'main',
		windowIndex: 0,
		windowName: 'win',
		active: false,
		left: 0,
		top: 0,
		width: 80,
		height: 24,
		zoomed: false,
		inMode: false,
		...over
	};
}

function emptyState(): TmuxState {
	return {
		sessions: [],
		windows: [],
		panes: [],
		activePaneId: null,
		activeWindow: null,
		buffers: []
	};
}

type MovedPane = {
	paneId: string;
	from: { session: string; windowIndex: number };
	to: { session: string; windowIndex: number };
};

/** StateDelta plus the issue #45 fields (interface §1) the detector must read. */
type DeltaX = StateDelta & {
	commandEvents: string[];
	enteredMode?: string;
	movedPanes: MovedPane[];
};

function delta(over: Partial<DeltaX>): DeltaX {
	return {
		prev: emptyState(),
		next: emptyState(),
		paneCountDelta: 0,
		sessionCountDelta: 0,
		windowCountDelta: 0,
		addedPanes: [],
		removedPaneIds: [],
		activePaneChanged: false,
		activeWindowChanged: false,
		activeSessionChanged: false,
		zoomToggled: false,
		enteredCopyMode: false,
		bufferRemoved: false,
		commandEvents: [],
		movedPanes: [],
		...over
	};
}

const simpleStep: DecryptedStep = { prompt: 'do it' };

describe('deriveCandidates — pane splits', () => {
	it('a pane added to the right of its sibling → split-vertical', () => {
		const left = pane('%0', { left: 0, top: 0, width: 40 });
		const right = pane('%1', { left: 41, top: 0, width: 39 });
		const d = delta({
			paneCountDelta: 1,
			addedPanes: [right],
			next: { ...emptyState(), panes: [left, right] }
		});
		expect(deriveCandidates(d, simpleStep)).toContain('split-vertical');
	});

	it('a pane added below its sibling → split-horizontal', () => {
		const top = pane('%0', { left: 0, top: 0, height: 12 });
		const bottom = pane('%1', { left: 0, top: 13, height: 11 });
		const d = delta({
			paneCountDelta: 1,
			addedPanes: [bottom],
			next: { ...emptyState(), panes: [top, bottom] }
		});
		expect(deriveCandidates(d, simpleStep)).toContain('split-horizontal');
	});
});

describe('deriveCandidates — windows & panes', () => {
	it('a new window in the same session → new-window', () => {
		const d = delta({ windowCountDelta: 1, paneCountDelta: 1, removedPaneIds: [] });
		expect(deriveCandidates(d, simpleStep)).toContain('new-window');
	});

	it('a pane removed while its window remains → kill-pane', () => {
		const d = delta({ paneCountDelta: -1, windowCountDelta: 0, removedPaneIds: ['%2'] });
		expect(deriveCandidates(d, simpleStep)).toContain('kill-pane');
	});
});

describe('deriveCandidates — sessions', () => {
	it('a new session → new-session', () => {
		const d = delta({
			sessionCountDelta: 1,
			windowCountDelta: 1,
			paneCountDelta: 1,
			next: { ...emptyState(), sessions: ['main', 'work'] }
		});
		expect(deriveCandidates(d, simpleStep)).toContain('new-session');
	});

	it('one session disappears while others remain → kill-session', () => {
		const d = delta({
			sessionCountDelta: -1,
			prev: { ...emptyState(), sessions: ['main', 'work'] },
			next: { ...emptyState(), sessions: ['work'] }
		});
		expect(deriveCandidates(d, simpleStep)).toContain('kill-session');
	});

	it('all sessions disappear (server empty) → kill-server', () => {
		const d = delta({
			sessionCountDelta: -2,
			prev: { ...emptyState(), sessions: ['main', 'work'] },
			next: { ...emptyState(), sessions: [] }
		});
		expect(deriveCandidates(d, simpleStep)).toContain('kill-server');
	});
});

describe('deriveCandidates — input (rename) commands use step.requiredInput', () => {
	it('a window rename to the required input → rename-window:<requiredInput>', () => {
		const step: DecryptedStep = {
			prompt: "Rename the window to 'swift-tiger-42'",
			requiredInput: 'swift-tiger-42'
		};
		const d = delta({ renamedWindow: { from: 'win', to: 'swift-tiger-42' } });
		expect(deriveCandidates(d, step)).toContain('rename-window:swift-tiger-42');
	});

	it('a session rename to the required input → rename-session:<requiredInput>', () => {
		const step: DecryptedStep = { prompt: 'Rename the session', requiredInput: 'calm-otter-7' };
		const d = delta({ renamedSession: { from: 'main', to: 'calm-otter-7' } });
		expect(deriveCandidates(d, step)).toContain('rename-session:calm-otter-7');
	});
});

describe('deriveCandidates — navigation is intentionally ambiguous (multi-candidate)', () => {
	it('active pane changed → includes both select-pane and last-pane', () => {
		const candidates = deriveCandidates(delta({ activePaneChanged: true }), simpleStep);
		expect(candidates).toContain('select-pane');
		expect(candidates).toContain('last-pane');
	});

	it('active window changed → includes all plausible window-navigation commands', () => {
		const candidates = deriveCandidates(delta({ activeWindowChanged: true }), simpleStep);
		for (const c of ['select-window', 'next-window', 'previous-window', 'last-window']) {
			expect(candidates).toContain(c);
		}
	});
});

describe('deriveCandidates — flags & buffers', () => {
	it('zoom toggled → toggle-zoom', () => {
		expect(deriveCandidates(delta({ zoomToggled: true }), simpleStep)).toContain('toggle-zoom');
	});

	it('entered copy mode → copy-mode', () => {
		expect(deriveCandidates(delta({ enteredCopyMode: true }), simpleStep)).toContain('copy-mode');
	});

	it('a buffer removed → delete-buffer', () => {
		expect(deriveCandidates(delta({ bufferRemoved: true }), simpleStep)).toContain('delete-buffer');
	});
});

describe('deriveCandidates — copy-paste step uses step.seedInput', () => {
	it('a paste of the seed text → copy-paste-sequence:<seedInput>', () => {
		const step: DecryptedStep = { prompt: 'Copy then paste the text', seedInput: 'hello world' };
		const d = delta({ pasteObserved: true, bufferAdded: 'hello world' });
		expect(deriveCandidates(d, step)).toContain('copy-paste-sequence:hello world');
	});
});

// ---------------------------------------------------------------------------
// Issue #45 — command-event channel + state-diff refinements (interface §5).
// The deltas below carry `commandEvents` from the observer's sink tail; the
// detector maps each event to canonical answer candidates.
// ---------------------------------------------------------------------------

const SERVER_DIED_EVENT =
	(detectorModule as { SERVER_DIED_EVENT?: string }).SERVER_DIED_EVENT ?? 'speedrun-server-died';

describe('deriveCandidates — command-event table (issue #45, interface §5.1)', () => {
	const table: [string, string[]][] = [
		['after-select-window', ['select-window']],
		['after-next-window', ['next-window']],
		['after-previous-window', ['previous-window']],
		['after-last-window', ['last-window']],
		['after-select-pane', ['select-pane', 'last-pane']],
		['after-last-pane', ['last-pane']],
		['after-list-sessions', ['list-sessions']],
		['after-list-windows', ['list-windows']],
		['after-choose-tree', ['list-windows', 'list-sessions']],
		['after-list-keys', ['list-keys']],
		['after-list-buffers', ['list-buffers']],
		['after-show-buffer', ['show-buffer']],
		['after-delete-buffer', ['delete-buffer']],
		['after-capture-pane', ['capture-pane']],
		['after-paste-buffer', ['paste-buffer']],
		['after-copy-mode', ['copy-mode']],
		['after-clock-mode', ['show-time']],
		['after-display-panes', ['display-panes']],
		['after-command-prompt', ['command-prompt']],
		['after-source-file', ['reload-config']],
		['after-split-window', ['split-vertical', 'split-horizontal']],
		['after-new-window', ['new-window']],
		['after-new-session', ['new-session']],
		['after-break-pane', ['break-pane']],
		['after-join-pane', ['join-pane']],
		['after-swap-pane', ['swap-pane']],
		['after-swap-window', ['swap-window']],
		['after-rotate-window', ['rotate-panes']],
		['after-kill-pane', ['kill-pane']],
		['after-kill-window', ['kill-window']],
		['after-kill-session', ['kill-session']],
		['client-detached', ['detach']],
		['client-attached', ['attach-session']],
		['after-attach-session', ['attach-session']],
		['after-switch-client', ['attach-session', 'next-session', 'previous-session']]
	];

	it.each(table)('%s → %j (even with an otherwise-unchanged state)', (event, expected) => {
		const candidates = deriveCandidates(delta({ commandEvents: [event] }), simpleStep);
		for (const c of expected) expect(candidates).toContain(c);
	});

	it('trigger-only events yield no candidates by themselves', () => {
		const triggerOnly = [
			'session-closed',
			'window-renamed',
			'pane-mode-changed',
			'pane-focus-in',
			'totally-unknown-event'
		];
		for (const event of triggerOnly) {
			expect(deriveCandidates(delta({ commandEvents: [event] }), simpleStep)).toEqual([]);
		}
	});
});

describe('deriveCandidates — window-by-number regression (issue #45 defect 2)', () => {
	it('after-select-window with NO state change still yields select-window (prefix+0 on the already-active window)', () => {
		const candidates = deriveCandidates(
			delta({ commandEvents: ['after-select-window'] }),
			simpleStep
		);
		expect(candidates).toContain('select-window');
	});

	it('after-next-window alone does NOT yield select-window (targeted vs generic stays distinguishable)', () => {
		const candidates = deriveCandidates(
			delta({ commandEvents: ['after-next-window'] }),
			simpleStep
		);
		expect(candidates).toContain('next-window');
		expect(candidates).not.toContain('select-window');
	});
});

describe('deriveCandidates — server death (issue #45 defect 3)', () => {
	it("exports SERVER_DIED_EVENT = 'speedrun-server-died'", () => {
		expect((detectorModule as { SERVER_DIED_EVENT?: string }).SERVER_DIED_EVENT).toBe(
			'speedrun-server-died'
		);
	});

	it('SERVER_DIED_EVENT → kill-server AND kill-session', () => {
		const candidates = deriveCandidates(delta({ commandEvents: [SERVER_DIED_EVENT] }), simpleStep);
		expect(candidates).toContain('kill-server');
		expect(candidates).toContain('kill-session');
	});
});

describe('deriveCandidates — cascade kills over-emit (issue #45, interface §5.2.1)', () => {
	it('killing the LAST session on a live server emits kill-session AND kill-server', () => {
		// With `exit-empty off` an empty live server means the last session was
		// killed — the key chain decides which of the two the step wanted.
		const d = delta({
			sessionCountDelta: -1,
			prev: { ...emptyState(), sessions: ['main'] },
			next: { ...emptyState(), sessions: [] }
		});
		const candidates = deriveCandidates(d, simpleStep);
		expect(candidates).toContain('kill-session');
		expect(candidates).toContain('kill-server');
	});

	it('a killed session cascades kill-window and kill-pane', () => {
		const d = delta({
			sessionCountDelta: -1,
			prev: { ...emptyState(), sessions: ['main', 'work'] },
			next: { ...emptyState(), sessions: ['work'] }
		});
		const candidates = deriveCandidates(d, simpleStep);
		expect(candidates).toContain('kill-session');
		expect(candidates).toContain('kill-window');
		expect(candidates).toContain('kill-pane');
	});

	it('kill-server is NOT emitted while sessions remain', () => {
		const d = delta({
			sessionCountDelta: -1,
			prev: { ...emptyState(), sessions: ['main', 'work'] },
			next: { ...emptyState(), sessions: ['work'] }
		});
		expect(deriveCandidates(d, simpleStep)).not.toContain('kill-server');
	});
});

describe('deriveCandidates — pane modes (issue #45, interface §5.2.2)', () => {
	it("enteredMode 'clock-mode' → show-time, NOT copy-mode", () => {
		const candidates = deriveCandidates(delta({ enteredMode: 'clock-mode' }), simpleStep);
		expect(candidates).toContain('show-time');
		expect(candidates).not.toContain('copy-mode');
	});

	it("enteredMode 'tree-mode' → list-windows + list-sessions, NOT copy-mode", () => {
		const candidates = deriveCandidates(delta({ enteredMode: 'tree-mode' }), simpleStep);
		expect(candidates).toContain('list-windows');
		expect(candidates).toContain('list-sessions');
		expect(candidates).not.toContain('copy-mode');
	});

	it('enteredCopyMode (now = real copy/view mode) still → copy-mode', () => {
		const candidates = deriveCandidates(
			delta({ enteredCopyMode: true, enteredMode: 'copy-mode' }),
			simpleStep
		);
		expect(candidates).toContain('copy-mode');
	});
});

describe('deriveCandidates — moved panes (issue #45, interface §5.2.3)', () => {
	const moved: MovedPane[] = [
		{
			paneId: '%1',
			from: { session: 'main', windowIndex: 0 },
			to: { session: 'main', windowIndex: 1 }
		}
	];

	it('a pane that changed window → join-pane, swap-pane, swap-window', () => {
		const candidates = deriveCandidates(delta({ movedPanes: moved }), simpleStep);
		expect(candidates).toContain('join-pane');
		expect(candidates).toContain('swap-pane');
		expect(candidates).toContain('swap-window');
	});

	it('a moved pane with a window added → also break-pane', () => {
		const candidates = deriveCandidates(
			delta({ movedPanes: moved, windowCountDelta: 1 }),
			simpleStep
		);
		expect(candidates).toContain('break-pane');
	});
});

describe('deriveCandidates — renames tightened to the required text (issue #45, interface §5.2.4)', () => {
	it('a window rename to the WRONG text emits no rename candidate', () => {
		const step: DecryptedStep = { prompt: 'Rename the window', requiredInput: 'right-name' };
		const candidates = deriveCandidates(
			delta({ renamedWindow: { from: 'win', to: 'oops' } }),
			step
		);
		expect(candidates).not.toContain('rename-window:right-name');
	});

	it('a session rename to the WRONG text emits no rename candidate', () => {
		const step: DecryptedStep = { prompt: 'Rename the session', requiredInput: 'right-name' };
		const candidates = deriveCandidates(
			delta({ renamedSession: { from: 'main', to: 'oops' } }),
			step
		);
		expect(candidates).not.toContain('rename-session:right-name');
	});
});
