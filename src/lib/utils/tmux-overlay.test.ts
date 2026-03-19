import { describe, expect, it } from 'vitest';

import { collectAllPanes, createSession, splitPane } from './pane-tree';
import {
	advanceOverlayDismissal,
	createClockOverlay,
	createDisplayPanesOverlay,
	getPaneOverlayText
} from './tmux-overlay';

describe('tmux overlay helpers', () => {
	it('creates pane-number overlays from pane order', () => {
		const session = createSession();
		const firstWindow = session.windows[0];
		const splitResult = splitPane(firstWindow.paneTree, session.focusedPaneId, 'vertical');
		expect(splitResult).not.toBeNull();
		if (splitResult === null) {
			throw new Error('Expected splitPane to return a new pane tree');
		}

		const panes = collectAllPanes(splitResult.tree);

		const overlay = createDisplayPanesOverlay(panes);

		expect(overlay.kind).toBe('pane-number');
		expect(getPaneOverlayText(overlay, panes[0].id)).toBe('0');
		expect(getPaneOverlayText(overlay, panes[1].id)).toBe('1');
	});

	it('creates clock overlays for a single pane', () => {
		const overlay = createClockOverlay('pane-7', '14:25');

		expect(overlay.kind).toBe('clock');
		expect(getPaneOverlayText(overlay, 'pane-7')).toBe('14:25');
		expect(getPaneOverlayText(overlay, 'pane-8')).toBeNull();
	});

	it('consumes one physical keypress before dismissing', () => {
		const firstState = createClockOverlay('pane-1', '10:00');
		const armedState = advanceOverlayDismissal(firstState);
		const dismissedState = armedState ? advanceOverlayDismissal(armedState) : null;

		expect(armedState).not.toBeNull();
		expect(armedState?.canDismissYet).toBe(true);
		expect(dismissedState).toBeNull();
	});
});
