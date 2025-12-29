/**
 * Tmux Terminal Components
 *
 * A tmux simulation for the challenge terminal.
 */

// Main component
export { default as ChallengeTerminal } from './ChallengeTerminal.svelte';

// Sub-components (for advanced use cases)
export { default as TabBar } from './TabBar.svelte';
export { default as PaneGrid } from './PaneGrid.svelte';
export { default as PaneView } from './PaneView.svelte';
export { default as StatusBar } from './StatusBar.svelte';

// Re-export types
export type {
	TmuxState,
	TmuxWindow,
	TmuxSignal,
	TmuxSignalType,
	PaneNode,
	Pane,
	SplitNode,
	PaneMode,
	SplitDirection,
	HistoryEntry,
	HistoryEntryType
} from '$lib/utils/pane-tree';

// Re-export store
export { createTmuxStore, type TmuxStore, type TmuxStoreOptions } from '$lib/stores/tmux-state.svelte';

