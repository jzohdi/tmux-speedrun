/**
 * Pane Tree Utilities
 *
 * Type definitions and tree manipulation functions for the tmux pane system.
 * Panes are organized in a binary tree structure where each split creates
 * two children (first/second) with a direction (horizontal/vertical).
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Pane mode determines what is displayed and how input is handled.
 * - 'default': Standard shell mode with '$' prompt
 * - 'tmux': Tmux mode with '%' prompt, prefix key handling
 * - 'man': Man page viewer mode (no input, scroll only)
 */
export type PaneMode = 'default' | 'tmux' | 'man';

/**
 * History entry types for pane output.
 */
export type HistoryEntryType = 'input' | 'output' | 'error' | 'system';

/**
 * A single entry in the pane's command history.
 */
export type HistoryEntry = {
	type: HistoryEntryType;
	content: string;
	timestamp: number;
	/** The mode the pane was in when this entry was created (for proper prompt display) */
	mode?: PaneMode;
};

/**
 * A leaf pane node - the actual terminal pane that users interact with.
 */
export type Pane = {
	type: 'pane';
	id: string;
	history: HistoryEntry[];
	mode: PaneMode;
	/** The mode before entering man mode (for restoring when exiting man) */
	previousMode?: PaneMode;
	inputValue: string;
};

/**
 * Split direction for pane splits.
 * - 'horizontal': Panes stacked top/bottom (split creates top and bottom)
 * - 'vertical': Panes side by side (split creates left and right)
 */
export type SplitDirection = 'horizontal' | 'vertical';

/**
 * A split node - contains two children (first/second) split in a direction.
 * Split ratio is always 0.5 (50/50) per requirements.
 */
export type SplitNode = {
	type: 'split';
	id: string;
	direction: SplitDirection;
	first: PaneNode;
	second: PaneNode;
};

/**
 * A node in the pane tree - either a leaf pane or a split node.
 */
export type PaneNode = Pane | SplitNode;

/**
 * A window contains a name and a pane tree.
 */
export type TmuxWindow = {
	id: string;
	name: string;
	paneTree: PaneNode;
};

/**
 * A tmux session - the top-level container.
 * Sessions persist independently and can be attached/detached.
 */
export type TmuxSession = {
	id: string;
	/** User-visible name (defaults to numeric index like "0", "1", etc.) */
	name: string;
	windows: TmuxWindow[];
	activeWindowIndex: number;
	focusedPaneId: string;
	/** Timestamp when the session was created (for display in `tmux ls`) */
	createdAt: number;
};

/**
 * The complete tmux state.
 * Supports multiple sessions with attach/detach capability.
 */
export type TmuxState = {
	sessions: TmuxSession[];
	/**
	 * Index of the currently attached session, or null if detached.
	 * When null, the user is in the default shell mode.
	 */
	attachedSessionIndex: number | null;
	/**
	 * The shell pane used when not attached to any session.
	 * This represents the default shell outside of tmux.
	 */
	shellPane: Pane;
};

/**
 * Signal types emitted when tmux state changes.
 */
export type TmuxSignalType =
	| 'command' // User executed an unrecognized command
	| 'command-executed' // User executed a recognized command (for challenge tracking)
	| 'session-created' // New session created
	| 'session-attached' // Attached to a session
	| 'session-detached' // Detached from a session
	| 'session-killed' // Session destroyed
	| 'session-renamed' // Session renamed
	| 'window-created' // New window created
	| 'window-closed' // Window closed
	| 'window-switched' // Active window changed
	| 'window-renamed' // Window renamed
	| 'pane-split' // Pane was split
	| 'pane-closed' // Pane closed
	| 'focus-changed' // Focus moved to different pane
	| 'mode-changed' // Pane mode changed
	| 'tmux-entered' // User entered tmux mode (typed 'tmux')
	| 'tmux-exited'; // User exited tmux (detached)

/**
 * Import CommandIdType for type-safe command signals.
 * This creates a dependency, but ensures type safety across the system.
 */
import type { CommandIdType } from './tmux-commands';

/**
 * Signal payload emitted on state changes.
 */
export type TmuxSignal = {
	type: TmuxSignalType;
	/** The raw command string entered by user */
	command?: string;
	/** The canonical command name (type-safe, from CommandId) */
	commandName?: CommandIdType;
	sessionId?: string;
	sessionName?: string;
	windowId?: string;
	paneId?: string;
	direction?: SplitDirection;
	newMode?: PaneMode;
	metadata?: Record<string, unknown>;
};

// ============================================================================
// ID GENERATION
// ============================================================================

let paneIdCounter = 0;
let windowIdCounter = 0;
let splitIdCounter = 0;
let sessionIdCounter = 0;

/**
 * Generate a unique pane ID.
 */
export function generatePaneId(): string {
	return `pane-${paneIdCounter++}`;
}

/**
 * Generate a unique window ID.
 */
export function generateWindowId(): string {
	return `window-${windowIdCounter++}`;
}

/**
 * Generate a unique split node ID.
 */
export function generateSplitId(): string {
	return `split-${splitIdCounter++}`;
}

/**
 * Generate a unique session ID.
 */
export function generateSessionId(): string {
	return `session-${sessionIdCounter++}`;
}

/**
 * Reset ID counters (useful for testing).
 */
export function resetIdCounters(): void {
	paneIdCounter = 0;
	windowIdCounter = 0;
	splitIdCounter = 0;
	sessionIdCounter = 0;
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a new pane with default state.
 */
export function createPane(mode: PaneMode = 'default'): Pane {
	return {
		type: 'pane',
		id: generatePaneId(),
		history: [],
		mode,
		inputValue: ''
	};
}

/**
 * Create a new window with a single pane.
 */
export function createWindow(name?: string): TmuxWindow {
	const id = generateWindowId();
	return {
		id,
		name: name ?? `window-${id.split('-')[1]}`,
		paneTree: createPane('tmux')
	};
}

/**
 * Create a new session with a single window and pane.
 *
 * @param name - Optional session name. Defaults to the session index (e.g., "0", "1").
 */
export function createSession(name?: string): TmuxSession {
	const id = generateSessionId();
	const sessionIndex = id.split('-')[1];
	const window = createWindow('main');

	return {
		id,
		name: name ?? sessionIndex,
		windows: [window],
		activeWindowIndex: 0,
		focusedPaneId: (window.paneTree as Pane).id,
		createdAt: Date.now()
	};
}

/**
 * Create initial tmux state with a single session containing one window and pane.
 */
export function createInitialState(): TmuxState {
	resetIdCounters();
	const session = createSession();
	const shellPane = createPane('default'); // Shell pane is in default mode

	return {
		sessions: [session],
		attachedSessionIndex: 0,
		shellPane
	};
}

// ============================================================================
// TREE TRAVERSAL
// ============================================================================

/**
 * Check if a node is a pane (leaf node).
 */
export function isPane(node: PaneNode): node is Pane {
	return node.type === 'pane';
}

/**
 * Check if a node is a split (internal node).
 */
export function isSplit(node: PaneNode): node is SplitNode {
	return node.type === 'split';
}

/**
 * Find a pane by ID in the tree.
 *
 * @param node - Root node to search from
 * @param id - Pane ID to find
 * @returns The pane if found, null otherwise
 */
export function findPaneById(node: PaneNode, id: string): Pane | null {
	if (isPane(node)) {
		return node.id === id ? node : null;
	}

	const inFirst = findPaneById(node.first, id);
	if (inFirst) {
		return inFirst;
	}

	return findPaneById(node.second, id);
}

/**
 * Find a node (pane or split) by ID.
 */
export function findNodeById(node: PaneNode, id: string): PaneNode | null {
	if (node.id === id) {
		return node;
	}

	if (isSplit(node)) {
		const inFirst = findNodeById(node.first, id);
		if (inFirst) {
			return inFirst;
		}

		return findNodeById(node.second, id);
	}

	return null;
}

/**
 * Find the parent split node of a pane.
 *
 * @param root - Root node to search from
 * @param paneId - ID of the pane whose parent we want
 * @returns The parent split node, or null if pane is root or not found
 */
export function findParentSplit(root: PaneNode, paneId: string): SplitNode | null {
	if (isPane(root)) {
		return null;
	}

	// Check if either child is the target pane
	if (
		(isPane(root.first) && root.first.id === paneId) ||
		(isPane(root.second) && root.second.id === paneId)
	) {
		return root;
	}

	// Check if target is in a split child
	if (isSplit(root.first) && findNodeById(root.first, paneId)) {
		return findParentSplit(root.first, paneId) ?? root;
	}

	if (isSplit(root.second) && findNodeById(root.second, paneId)) {
		return findParentSplit(root.second, paneId) ?? root;
	}

	// Recurse into children
	const inFirst = findParentSplit(root.first, paneId);
	if (inFirst) {
		return inFirst;
	}

	return findParentSplit(root.second, paneId);
}

/**
 * Collect all leaf panes from a tree.
 *
 * @param node - Root node to collect from
 * @returns Array of all panes in the tree (in order: first, then second)
 */
export function collectAllPanes(node: PaneNode): Pane[] {
	if (isPane(node)) {
		return [node];
	}

	return [...collectAllPanes(node.first), ...collectAllPanes(node.second)];
}

/**
 * Count the number of panes in a tree.
 */
export function countPanes(node: PaneNode): number {
	if (isPane(node)) {
		return 1;
	}

	return countPanes(node.first) + countPanes(node.second);
}

/**
 * Get the first pane in a tree (leftmost/topmost).
 */
export function getFirstPane(node: PaneNode): Pane {
	if (isPane(node)) {
		return node;
	}

	return getFirstPane(node.first);
}

/**
 * Get the last pane in a tree (rightmost/bottommost).
 */
export function getLastPane(node: PaneNode): Pane {
	if (isPane(node)) {
		return node;
	}

	return getLastPane(node.second);
}

// ============================================================================
// TREE MUTATIONS (IMMUTABLE)
// ============================================================================

/**
 * Split a pane into two panes.
 * The original pane becomes the first child, a new pane becomes the second.
 *
 * @param root - Root of the tree
 * @param paneId - ID of the pane to split
 * @param direction - Direction to split ('horizontal' or 'vertical')
 * @returns New tree with the split applied, and the new pane
 */
export function splitPane(
	root: PaneNode,
	paneId: string,
	direction: SplitDirection
): { tree: PaneNode; newPane: Pane } | null {
	const newPane = createPane('tmux'); // New panes inherit tmux mode when splitting

	function split(node: PaneNode): PaneNode | null {
		if (isPane(node)) {
			if (node.id === paneId) {
				// Found the pane to split - replace with split node
				const splitNode: SplitNode = {
					type: 'split',
					id: generateSplitId(),
					direction,
					first: node,
					second: newPane
				};
				return splitNode;
			}
			return null; // Not found in this branch
		}

		// Try to split in first child
		const newFirst = split(node.first);
		if (newFirst) {
			return { ...node, first: newFirst };
		}

		// Try to split in second child
		const newSecond = split(node.second);
		if (newSecond) {
			return { ...node, second: newSecond };
		}

		return null; // Not found
	}

	const newTree = split(root);
	if (!newTree) {
		return null;
	}

	return { tree: newTree, newPane };
}

/**
 * Remove a pane from the tree.
 * If the pane's sibling is a pane, the sibling replaces the parent split.
 * If the pane's sibling is a split, the sibling's tree replaces the parent split.
 *
 * @param root - Root of the tree
 * @param paneId - ID of the pane to remove
 * @returns New tree with the pane removed, or null if pane is the only one
 */
export function removePane(root: PaneNode, paneId: string): PaneNode | null {
	// Can't remove the root pane
	if (isPane(root) && root.id === paneId) {
		return null;
	}

	function remove(node: PaneNode): PaneNode | null | 'not-found' {
		if (isPane(node)) {
			return 'not-found';
		}

		// Check if first child is the target
		if (isPane(node.first) && node.first.id === paneId) {
			return node.second; // Replace this split with the second child
		}

		// Check if second child is the target
		if (isPane(node.second) && node.second.id === paneId) {
			return node.first; // Replace this split with the first child
		}

		// Recurse into first child
		const resultFirst = remove(node.first);
		if (resultFirst !== 'not-found') {
			if (resultFirst === null) {
				return null;
			}
			return { ...node, first: resultFirst };
		}

		// Recurse into second child
		const resultSecond = remove(node.second);
		if (resultSecond !== 'not-found') {
			if (resultSecond === null) {
				return null;
			}
			return { ...node, second: resultSecond };
		}

		return 'not-found';
	}

	const result = remove(root);
	if (result === 'not-found' || result === null) {
		return null;
	}

	return result;
}

/**
 * Update a pane in the tree (immutably).
 *
 * @param root - Root of the tree
 * @param paneId - ID of the pane to update
 * @param updates - Partial pane updates to apply
 * @returns New tree with the update applied
 */
export function updatePane(
	root: PaneNode,
	paneId: string,
	updates: Partial<Omit<Pane, 'type' | 'id'>>
): PaneNode {
	if (isPane(root)) {
		if (root.id === paneId) {
			return { ...root, ...updates };
		}
		return root;
	}

	return {
		...root,
		first: updatePane(root.first, paneId, updates),
		second: updatePane(root.second, paneId, updates)
	};
}

/**
 * Add a history entry to a pane.
 */
export function addPaneHistory(root: PaneNode, paneId: string, entry: HistoryEntry): PaneNode {
	const pane = findPaneById(root, paneId);
	if (!pane) {
		return root;
	}

	return updatePane(root, paneId, {
		history: [...pane.history, entry]
	});
}

/**
 * Clear a pane's history.
 */
export function clearPaneHistory(root: PaneNode, paneId: string): PaneNode {
	return updatePane(root, paneId, { history: [] });
}

/**
 * Set a pane's mode.
 */
export function setPaneMode(root: PaneNode, paneId: string, mode: PaneMode): PaneNode {
	return updatePane(root, paneId, { mode });
}

/**
 * Set a pane's input value.
 */
export function setPaneInput(root: PaneNode, paneId: string, inputValue: string): PaneNode {
	return updatePane(root, paneId, { inputValue });
}

// ============================================================================
// NAVIGATION
// ============================================================================

/**
 * Pane position info for navigation.
 */
export type PanePosition = {
	pane: Pane;
	x: number; // 0-1 range, center x position
	y: number; // 0-1 range, center y position
	width: number; // 0-1 range
	height: number; // 0-1 range
};

/**
 * Calculate positions for all panes in the tree.
 * Positions are normalized to 0-1 range.
 */
export function calculatePanePositions(
	node: PaneNode,
	bounds: { x: number; y: number; width: number; height: number } = {
		x: 0,
		y: 0,
		width: 1,
		height: 1
	}
): PanePosition[] {
	if (isPane(node)) {
		return [
			{
				pane: node,
				x: bounds.x + bounds.width / 2,
				y: bounds.y + bounds.height / 2,
				width: bounds.width,
				height: bounds.height
			}
		];
	}

	const half = 0.5;

	if (node.direction === 'vertical') {
		// Side by side: first on left, second on right
		const firstBounds = { ...bounds, width: bounds.width * half };
		const secondBounds = {
			...bounds,
			x: bounds.x + bounds.width * half,
			width: bounds.width * half
		};

		return [
			...calculatePanePositions(node.first, firstBounds),
			...calculatePanePositions(node.second, secondBounds)
		];
	}
	// Stacked: first on top, second on bottom
	const firstBounds = { ...bounds, height: bounds.height * half };
	const secondBounds = {
		...bounds,
		y: bounds.y + bounds.height * half,
		height: bounds.height * half
	};

	return [
		...calculatePanePositions(node.first, firstBounds),
		...calculatePanePositions(node.second, secondBounds)
	];
}

/**
 * Find the pane in a given direction from the current pane.
 *
 * @param root - Root of the pane tree
 * @param currentPaneId - ID of the current pane
 * @param direction - Direction to look ('up', 'down', 'left', 'right')
 * @returns The pane in that direction, or null if none
 */
export function findPaneInDirection(
	root: PaneNode,
	currentPaneId: string,
	direction: 'up' | 'down' | 'left' | 'right'
): Pane | null {
	const positions = calculatePanePositions(root);
	const currentPos = positions.find((p) => p.pane.id === currentPaneId);

	if (!currentPos) {
		return null;
	}

	// Filter panes in the given direction
	let candidates: PanePosition[];

	switch (direction) {
		case 'up':
			candidates = positions.filter((p) => p.y < currentPos.y - 0.01);
			break;
		case 'down':
			candidates = positions.filter((p) => p.y > currentPos.y + 0.01);
			break;
		case 'left':
			candidates = positions.filter((p) => p.x < currentPos.x - 0.01);
			break;
		case 'right':
			candidates = positions.filter((p) => p.x > currentPos.x + 0.01);
			break;
	}

	if (candidates.length === 0) {
		return null;
	}

	// Find the closest pane in that direction
	let closest = candidates[0];
	let minDistance = Infinity;

	for (const candidate of candidates) {
		const dx = candidate.x - currentPos.x;
		const dy = candidate.y - currentPos.y;
		const distance = Math.sqrt(dx * dx + dy * dy);

		if (distance < minDistance) {
			minDistance = distance;
			closest = candidate;
		}
	}

	return closest.pane;
}

/**
 * Get the next pane in sequence (for cycling).
 */
export function getNextPane(root: PaneNode, currentPaneId: string): Pane {
	const panes = collectAllPanes(root);
	const currentIndex = panes.findIndex((p) => p.id === currentPaneId);

	if (currentIndex === -1) {
		return panes[0];
	}

	const nextIndex = (currentIndex + 1) % panes.length;
	return panes[nextIndex];
}

/**
 * Get the previous pane in sequence (for cycling).
 */
export function getPreviousPane(root: PaneNode, currentPaneId: string): Pane {
	const panes = collectAllPanes(root);
	const currentIndex = panes.findIndex((p) => p.id === currentPaneId);

	if (currentIndex === -1) {
		return panes[panes.length - 1];
	}

	const prevIndex = (currentIndex - 1 + panes.length) % panes.length;
	return panes[prevIndex];
}
