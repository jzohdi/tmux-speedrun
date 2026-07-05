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
	mode?: string | null; // #{pane_mode} — 'copy-mode' | 'view-mode' | 'clock-mode' | 'tree-mode' | ... | null
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
	/** True only for real copy/view mode; clock/tree modes set `enteredMode` instead. */
	enteredCopyMode: boolean;
	bufferAdded?: string;
	bufferRemoved: boolean;
	pasteObserved?: boolean;
	/**
	 * Sink event names observed since the previous delta (installed hook names,
	 * one per occurrence, in file order), after runner-origin suppression. May
	 * also contain synthetic events injected by the run loop (SERVER_DIED_EVENT).
	 * Always present ([] when none).
	 */
	commandEvents: string[];
	/** Raw #{pane_mode} of a pane that newly entered a mode this delta. */
	enteredMode?: string;
	/** Panes present in both snapshots whose (sessionName, windowIndex) changed. */
	movedPanes: {
		paneId: string;
		from: { session: string; windowIndex: number };
		to: { session: string; windowIndex: number };
	}[];
};
