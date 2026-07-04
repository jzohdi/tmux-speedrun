/**
 * Observed tmux state model shared by the observer, detector, and controllers.
 * See `.agent/interface.md` §6.1. Pure type declarations (no runtime behavior).
 */

export type PaneInfo = {
	paneId: string; // #{pane_id}, stable e.g. "%3"
	sessionName: string; // #{session_name}
	windowIndex: number; // #{window_index}
	windowName: string; // #{window_name}
	active: boolean; // #{pane_active}
	left: number;
	top: number;
	width: number;
	height: number;
	zoomed: boolean; // #{window_zoomed_flag}
	inMode: boolean; // #{pane_in_mode}
};

export type TmuxState = {
	sessions: string[];
	windows: { session: string; index: number; name: string; active: boolean }[];
	panes: PaneInfo[];
	activePaneId: string | null;
	activeWindow: { session: string; index: number } | null;
	buffers: string[];
	topBufferSample?: string;
};

export type StateDelta = {
	prev: TmuxState;
	next: TmuxState;
	paneCountDelta: number;
	sessionCountDelta: number;
	windowCountDelta: number;
	addedPanes: PaneInfo[];
	removedPaneIds: string[];
	renamedWindow?: { from: string; to: string };
	renamedSession?: { from: string; to: string };
	activePaneChanged: boolean;
	activeWindowChanged: boolean;
	activeSessionChanged: boolean;
	zoomToggled: boolean;
	enteredCopyMode: boolean;
	bufferAdded?: string;
	bufferRemoved: boolean;
	pasteObserved?: boolean;
};
