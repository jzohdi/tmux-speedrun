/**
 * Failing tests for `deriveCandidates` (`detector.ts`) — issue #35, interface §7
 * (invariant DET1: pure/deterministic; trial-decrypt is the correctness
 * authority, so the detector only needs to *include* the right candidate).
 *
 * Because emitting EXTRA candidates is explicitly allowed (the key-chain
 * trial-decrypt filters them), every assertion here is `toContain(expected)` —
 * we never assert a candidate is absent.
 *
 * These fail because `deriveCandidates` is a not-yet-implemented stub.
 */

import { describe, it, expect } from 'vitest';
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

function delta(over: Partial<StateDelta>): StateDelta {
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
