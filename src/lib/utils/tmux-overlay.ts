import type { Pane } from './pane-tree';

export type PaneOverlayKind = 'clock' | 'pane-number';

export type PaneOverlay = {
	kind: PaneOverlayKind;
	entries: Record<string, string>;
	canDismissYet: boolean;
};

export function createClockOverlay(paneId: string, timeString: string): PaneOverlay {
	return {
		kind: 'clock',
		entries: {
			[paneId]: timeString
		},
		canDismissYet: false
	};
}

export function createDisplayPanesOverlay(panes: Pane[]): PaneOverlay {
	return {
		kind: 'pane-number',
		entries: Object.fromEntries(panes.map((pane, index) => [pane.id, String(index)])),
		canDismissYet: false
	};
}

export function getPaneOverlayText(
	overlay: PaneOverlay | null | undefined,
	paneId: string
): string | null {
	return overlay?.entries[paneId] ?? null;
}

export function advanceOverlayDismissal(overlay: PaneOverlay): PaneOverlay | null {
	if (overlay.canDismissYet) {
		return null;
	}

	return {
		...overlay,
		canDismissYet: true
	};
}
