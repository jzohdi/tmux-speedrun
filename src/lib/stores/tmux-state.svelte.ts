/**
 * Tmux State Store
 *
 * A Svelte 5 reactive store that manages the complete tmux simulation state.
 * Handles windows, panes, focus, modes, and emits signals for challenge integration.
 */

import {
	createInitialState,
	createWindow,
	createPane,
	findPaneById,
	collectAllPanes,
	countPanes,
	getFirstPane,
	splitPane,
	removePane,
	updatePane,
	addPaneHistory,
	clearPaneHistory,
	setPaneMode,
	setPaneInput,
	findPaneInDirection,
	getNextPane,
	getPreviousPane,
	type TmuxState,
	type TmuxWindow,
	type TmuxSignal,
	type TmuxSignalType,
	type PaneNode,
	type Pane,
	type PaneMode,
	type SplitDirection,
	type HistoryEntry
} from '$lib/utils/pane-tree';

import {
	executeCommand,
	type ExecuteResult,
	type CommandIdType,
	type CommandResult
} from '$lib/utils/tmux-commands';

function formatPaneList(panes: Pane[], focusedId: string): string {
	const currentPanes =
		typeof window !== 'undefined'
			? Array.from(document.querySelectorAll('.pane-container')).map((node) => {
					const bounds = node.getBoundingClientRect();
					return {
						width: Math.round(bounds.width),
						height: Math.round(bounds.height)
					};
				})
			: panes.map(() => ({
					width: 160,
					height: 24
				}));
	return panes
		.map((pane, index) => {
			const isActive = pane.id === focusedId;
			const activeMarker = isActive ? ' (active)' : '';
			// Format: "0: [160x24] [history 0/2000, 0 bytes] %0 (active)"
			const percentFull = Math.round((pane.history.length / 2000) * 100);
			return `${index}: [${currentPanes[index].width}x${currentPanes[index].height}] [history ${pane.history.length}/2000, 0 bytes] %${percentFull}${activeMarker}`;
		})
		.join('\n');
}

/**
 * Format session list output (simulates 'tmux ls' / 'tmux list-sessions').
 * Format: "0: 2 windows (created Mon Dec 29 13:37:03 2025) (attached)"
 */
function formatSessionList(windows: TmuxWindow[]): string {
	const now = new Date();
	const dateStr = now.toLocaleString('en-US', {
		weekday: 'short',
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		year: 'numeric',
		hour12: false
	});

	// In our simulation, we have a single session (session 0) that is always attached
	const windowCount = windows.length;
	const windowWord = windowCount === 1 ? 'window' : 'windows';

	return `0: ${windowCount} ${windowWord} (created ${dateStr}) (attached)`;
}

// ============================================================================
// STORE OPTIONS
// ============================================================================

export type TmuxStoreOptions = {
	/**
	 * Callback when a signal is emitted.
	 * Used for challenge integration.
	 */
	onSignal?: (signal: TmuxSignal) => void;

	/**
	 * Initial state override (for testing or resuming).
	 */
	initialState?: TmuxState;
};

// ============================================================================
// STORE FACTORY
// ============================================================================

/**
 * Create a reactive tmux state store.
 *
 * @example
 * ```svelte
 * <script>
 *   import { createTmuxStore } from '$lib/stores/tmux-state.svelte';
 *
 *   const tmux = createTmuxStore({
 *     onSignal: (signal) => console.log('Signal:', signal)
 *   });
 *
 *   // Access reactive state
 *   $: console.log(tmux.activeWindow);
 *
 *   // Perform actions
 *   tmux.splitPane('vertical');
 * </script>
 * ```
 */
export function createTmuxStore(options: TmuxStoreOptions = {}) {
	const { onSignal, initialState } = options;

	// ========================================================================
	// CORE REACTIVE STATE
	// ========================================================================

	let state = $state<TmuxState>(initialState ?? createInitialState());
	let prefixActive = $state(false);
	let lastFocusedPaneId = $state<string | null>(null);
	/**
	 * Counter that increments whenever input focus should be refreshed.
	 * Used to trigger focus in PaneView even when focusedPaneId hasn't changed.
	 */
	let focusTrigger = $state(0);

	// ========================================================================
	// DERIVED STATE
	// ========================================================================

	const windows = $derived(state.windows);
	const activeWindowIndex = $derived(state.activeWindowIndex);
	const activeWindow = $derived(state.windows[state.activeWindowIndex]);
	const focusedPaneId = $derived(state.focusedPaneId);
	const focusedPane = $derived(
		activeWindow ? findPaneById(activeWindow.paneTree, state.focusedPaneId) : null
	);
	const allPanesInActiveWindow = $derived(
		activeWindow ? collectAllPanes(activeWindow.paneTree) : []
	);
	const paneCount = $derived(activeWindow ? countPanes(activeWindow.paneTree) : 0);
	const windowCount = $derived(state.windows.length);

	// ========================================================================
	// SIGNAL EMISSION
	// ========================================================================

	function emitSignal(type: TmuxSignalType, data: Partial<TmuxSignal> = {}): void {
		if (onSignal) {
			onSignal({ type, ...data });
		}
	}

	// ========================================================================
	// STATE MUTATION HELPERS
	// ========================================================================

	function generateOutput(type: CommandResult['generateOutput']): string | null {
		switch (type) {
			case 'pane-list':
				return formatPaneList(allPanesInActiveWindow, focusedPaneId);
			case 'session-list':
				return formatSessionList(windows);
			//   case 'window-list':
			// 	return formatWindowList(windows, activeWindowIndex);
			default:
				return null;
		}
	}

	function updateActiveWindowTree(newTree: PaneNode): void {
		state = {
			...state,
			windows: state.windows.map((w, i) =>
				i === state.activeWindowIndex ? { ...w, paneTree: newTree } : w
			)
		};
	}

	function setFocusedPane(paneId: string): void {
		if (state.focusedPaneId !== paneId) {
			lastFocusedPaneId = state.focusedPaneId;
			state = { ...state, focusedPaneId: paneId };
			emitSignal('focus-changed', { paneId });
		}
		// Always trigger focus refresh when explicitly focusing a pane
		triggerInputFocus();
	}

	/**
	 * Trigger a focus refresh on the currently focused pane's input.
	 * Call this after operations that should maintain focus (e.g., command output).
	 * Uses requestAnimationFrame to defer until after Svelte renders and the browser paints.
	 */
	function triggerInputFocus(): void {
		requestAnimationFrame(() => {
			focusTrigger++;
		});
	}

	// ========================================================================
	// WINDOW OPERATIONS
	// ========================================================================

	/**
	 * Create a new window.
	 *
	 * @param name - Optional name for the window
	 */
	function createNewWindow(name?: string): void {
		const newWindow = createWindow(name);
		const newWindowIndex = state.windows.length;

		state = {
			...state,
			windows: [...state.windows, newWindow],
			activeWindowIndex: newWindowIndex,
			focusedPaneId: (newWindow.paneTree as Pane).id
		};

		emitSignal('window-created', { windowId: newWindow.id });
		// Focus the new window's pane input
		triggerInputFocus();
	}

	/**
	 * Close a window by index.
	 * Cannot close if it's the last window.
	 *
	 * @param index - Window index to close (defaults to active window)
	 * @returns true if closed, false if refused (last window)
	 */
	function closeWindow(index?: number): boolean {
		const targetIndex = index ?? state.activeWindowIndex;

		// Guard: cannot close last window
		if (state.windows.length <= 1) {
			return false;
		}

		const closedWindow = state.windows[targetIndex];
		const newWindows = state.windows.filter((_, i) => i !== targetIndex);

		// Adjust active index if needed
		let newActiveIndex = state.activeWindowIndex;
		if (targetIndex <= state.activeWindowIndex) {
			newActiveIndex = Math.max(0, state.activeWindowIndex - 1);
		}
		if (newActiveIndex >= newWindows.length) {
			newActiveIndex = newWindows.length - 1;
		}

		const newActiveWindow = newWindows[newActiveIndex];
		const firstPane = getFirstPane(newActiveWindow.paneTree);

		state = {
			...state,
			windows: newWindows,
			activeWindowIndex: newActiveIndex,
			focusedPaneId: firstPane.id
		};

		emitSignal('window-closed', { windowId: closedWindow.id });
		return true;
	}

	/**
	 * Switch to a window by index.
	 *
	 * @param index - Window index to switch to
	 */
	function switchWindow(index: number): void {
		if (index < 0 || index >= state.windows.length) {
			return;
		}

		if (index === state.activeWindowIndex) {
			return;
		}

		const targetWindow = state.windows[index];
		const firstPane = getFirstPane(targetWindow.paneTree);

		state = {
			...state,
			activeWindowIndex: index,
			focusedPaneId: firstPane.id
		};

		emitSignal('window-switched', { windowId: targetWindow.id });
		// Focus the switched window's pane input
		triggerInputFocus();
	}

	/**
	 * Switch to the next window (wraps around).
	 */
	function nextWindow(): void {
		const newIndex = (state.activeWindowIndex + 1) % state.windows.length;
		switchWindow(newIndex);
	}

	/**
	 * Switch to the previous window (wraps around).
	 */
	function previousWindow(): void {
		const newIndex = (state.activeWindowIndex - 1 + state.windows.length) % state.windows.length;
		switchWindow(newIndex);
	}

	/**
	 * Rename a window.
	 *
	 * @param index - Window index to rename (defaults to active window)
	 * @param name - New name for the window
	 */
	function renameWindow(name: string, index?: number): void {
		const targetIndex = index ?? state.activeWindowIndex;

		if (targetIndex < 0 || targetIndex >= state.windows.length) {
			return;
		}

		state = {
			...state,
			windows: state.windows.map((w, i) => (i === targetIndex ? { ...w, name } : w))
		};

		emitSignal('window-renamed', {
			windowId: state.windows[targetIndex].id,
			metadata: { name }
		});
	}

	/**
	 * Reorder windows (for drag and drop).
	 *
	 * @param fromIndex - Original index
	 * @param toIndex - New index
	 */
	function reorderWindows(fromIndex: number, toIndex: number): void {
		if (
			fromIndex < 0 ||
			fromIndex >= state.windows.length ||
			toIndex < 0 ||
			toIndex >= state.windows.length ||
			fromIndex === toIndex
		) {
			return;
		}

		const newWindows = [...state.windows];
		const [removed] = newWindows.splice(fromIndex, 1);
		newWindows.splice(toIndex, 0, removed);

		// Adjust active index
		let newActiveIndex = state.activeWindowIndex;
		if (fromIndex === state.activeWindowIndex) {
			newActiveIndex = toIndex;
		} else if (fromIndex < state.activeWindowIndex && toIndex >= state.activeWindowIndex) {
			newActiveIndex--;
		} else if (fromIndex > state.activeWindowIndex && toIndex <= state.activeWindowIndex) {
			newActiveIndex++;
		}

		state = {
			...state,
			windows: newWindows,
			activeWindowIndex: newActiveIndex
		};
	}

	// ========================================================================
	// PANE OPERATIONS
	// ========================================================================

	/**
	 * Split the focused pane.
	 *
	 * @param direction - 'horizontal' (top/bottom) or 'vertical' (left/right)
	 */
	function splitFocusedPane(direction: SplitDirection): void {
		if (!activeWindow) {
			return;
		}

		const result = splitPane(activeWindow.paneTree, state.focusedPaneId, direction);

		if (!result) {
			return;
		}

		updateActiveWindowTree(result.tree);

		// Focus the new pane
		setFocusedPane(result.newPane.id);

		emitSignal('pane-split', {
			paneId: result.newPane.id,
			direction
		});
	}

	/**
	 * Close the focused pane.
	 * Cannot close if it's the last pane in the window.
	 *
	 * @returns true if closed, false if refused (last pane)
	 */
	function closeFocusedPane(): boolean {
		if (!activeWindow) {
			return false;
		}

		// Guard: cannot close last pane
		if (countPanes(activeWindow.paneTree) <= 1) {
			return false;
		}

		const closedPaneId = state.focusedPaneId;
		const newTree = removePane(activeWindow.paneTree, closedPaneId);

		if (!newTree) {
			return false;
		}

		// Find a new pane to focus (prefer the previous pane, or first pane)
		const allPanes = collectAllPanes(newTree);
		let newFocusedPane: Pane;

		if (lastFocusedPaneId && allPanes.find((p) => p.id === lastFocusedPaneId)) {
			newFocusedPane = allPanes.find((p) => p.id === lastFocusedPaneId)!;
		} else {
			newFocusedPane = getFirstPane(newTree);
		}

		updateActiveWindowTree(newTree);
		setFocusedPane(newFocusedPane.id);

		emitSignal('pane-closed', { paneId: closedPaneId });
		return true;
	}

	/**
	 * Focus a pane by ID.
	 */
	function focusPane(paneId: string): void {
		if (!activeWindow) {
			return;
		}

		const pane = findPaneById(activeWindow.paneTree, paneId);
		if (pane) {
			setFocusedPane(paneId);
		}
	}

	/**
	 * Move focus in a direction.
	 *
	 * @param direction - 'up', 'down', 'left', 'right'
	 */
	function moveFocus(direction: 'up' | 'down' | 'left' | 'right'): void {
		if (!activeWindow) {
			return;
		}

		const targetPane = findPaneInDirection(activeWindow.paneTree, state.focusedPaneId, direction);

		if (targetPane) {
			setFocusedPane(targetPane.id);
		}
	}

	/**
	 * Move focus to the next pane (cycles).
	 */
	function focusNextPane(): void {
		if (!activeWindow) {
			return;
		}

		const nextPane = getNextPane(activeWindow.paneTree, state.focusedPaneId);
		setFocusedPane(nextPane.id);
	}

	/**
	 * Move focus to the previous pane (cycles).
	 */
	function focusPreviousPane(): void {
		if (!activeWindow) {
			return;
		}

		const prevPane = getPreviousPane(activeWindow.paneTree, state.focusedPaneId);
		setFocusedPane(prevPane.id);
	}

	/**
	 * Move focus to the last focused pane.
	 */
	function focusLastPane(): void {
		if (!activeWindow || !lastFocusedPaneId) {
			return;
		}

		const pane = findPaneById(activeWindow.paneTree, lastFocusedPaneId);
		if (pane) {
			setFocusedPane(lastFocusedPaneId);
		}
	}

	// ========================================================================
	// PANE CONTENT OPERATIONS
	// ========================================================================

	/**
	 * Add a history entry to a pane.
	 */
	function addHistory(entry: HistoryEntry, paneId?: string): void {
		if (!activeWindow) {
			return;
		}

		const targetPaneId = paneId ?? state.focusedPaneId;
		const newTree = addPaneHistory(activeWindow.paneTree, targetPaneId, entry);
		updateActiveWindowTree(newTree);
	}

	/**
	 * Clear a pane's history.
	 */
	function clearHistory(paneId?: string): void {
		if (!activeWindow) {
			return;
		}

		const targetPaneId = paneId ?? state.focusedPaneId;
		const newTree = clearPaneHistory(activeWindow.paneTree, targetPaneId);
		updateActiveWindowTree(newTree);
	}

	/**
	 * Set a pane's mode.
	 * When entering man mode, stores the current mode as previousMode.
	 * When exiting man mode (via exitManMode), restores the previous mode.
	 */
	function setMode(mode: PaneMode, paneId?: string): void {
		if (!activeWindow) {
			return;
		}

		const targetPaneId = paneId ?? state.focusedPaneId;
		const oldPane = findPaneById(activeWindow.paneTree, targetPaneId);
		const oldMode = oldPane?.mode;

		// When entering man mode, store the current mode so we can restore it later
		if (mode === 'man' && oldMode !== 'man') {
			const treeWithPreviousMode = updatePane(activeWindow.paneTree, targetPaneId, {
				previousMode: oldMode
			});
			const newTree = setPaneMode(treeWithPreviousMode, targetPaneId, mode);
			updateActiveWindowTree(newTree);
		} else {
			const newTree = setPaneMode(activeWindow.paneTree, targetPaneId, mode);
			updateActiveWindowTree(newTree);
		}

		if (oldMode !== mode) {
			emitSignal('mode-changed', {
				paneId: targetPaneId,
				newMode: mode,
				metadata: { oldMode }
			});

			// Special signals for tmux enter/exit
			if (mode === 'tmux' && oldMode === 'default') {
				emitSignal('tmux-entered', { paneId: targetPaneId });
			} else if (mode === 'default' && oldMode === 'tmux') {
				emitSignal('tmux-exited', { paneId: targetPaneId });
			}
		}
	}

	/**
	 * Exit man mode and restore the previous mode.
	 * If no previous mode is stored, defaults to 'default'.
	 */
	function exitManMode(paneId?: string): void {
		if (!activeWindow) {
			return;
		}

		const targetPaneId = paneId ?? state.focusedPaneId;
		const pane = findPaneById(activeWindow.paneTree, targetPaneId);

		if (!pane || pane.mode !== 'man') {
			return;
		}

		// Restore the previous mode, default to 'default' if not set
		const modeToRestore = pane.previousMode ?? 'default';

		// Clear previousMode and set the restored mode
		const treeWithClearedPrevious = updatePane(activeWindow.paneTree, targetPaneId, {
			previousMode: undefined
		});
		const newTree = setPaneMode(treeWithClearedPrevious, targetPaneId, modeToRestore);
		updateActiveWindowTree(newTree);

		emitSignal('mode-changed', {
			paneId: targetPaneId,
			newMode: modeToRestore,
			metadata: { oldMode: 'man' }
		});

		// Emit tmux-entered if restoring to tmux mode
		if (modeToRestore === 'tmux') {
			emitSignal('tmux-entered', { paneId: targetPaneId });
		}
	}

	/**
	 * Set a pane's input value.
	 */
	function setInput(value: string, paneId?: string): void {
		if (!activeWindow) {
			return;
		}

		const targetPaneId = paneId ?? state.focusedPaneId;
		const newTree = setPaneInput(activeWindow.paneTree, targetPaneId, value);
		updateActiveWindowTree(newTree);
	}

	/**
	 * Update arbitrary pane properties.
	 */
	function updateFocusedPane(updates: Partial<Omit<Pane, 'type' | 'id'>>): void {
		if (!activeWindow) {
			return;
		}

		const newTree = updatePane(activeWindow.paneTree, state.focusedPaneId, updates);
		updateActiveWindowTree(newTree);
	}

	// ========================================================================
	// PREFIX MODE
	// ========================================================================

	/**
	 * Toggle prefix mode.
	 */
	function togglePrefix(): void {
		prefixActive = !prefixActive;
	}

	/**
	 * Activate prefix mode.
	 */
	function activatePrefix(): void {
		prefixActive = true;
	}

	/**
	 * Deactivate prefix mode.
	 */
	function deactivatePrefix(): void {
		prefixActive = false;
	}

	// ========================================================================
	// COMMAND PROCESSING
	// ========================================================================

	/**
	 * Process a command in the focused pane.
	 * This handles mode switching and command recording.
	 *
	 * @param command - The command string
	 */
	function processCommand(command: string): void {
		if (!focusedPane) {
			return;
		}

		const trimmedCommand = command.trim();

		// Don't process empty commands
		if (!trimmedCommand) {
			return;
		}

		// Add to history as input (include mode for proper prompt display)
		addHistory({
			type: 'input',
			content: trimmedCommand,
			timestamp: Date.now(),
			mode: focusedPane.mode
		});

		// Clear input
		setInput('');

		// Handle mode-switching commands in default mode
		if (focusedPane.mode === 'default') {
			if (trimmedCommand === 'tmux' || trimmedCommand.startsWith('tmux ')) {
				setMode('tmux');
				addHistory({
					type: 'system',
					content: '[tmux session started]',
					timestamp: Date.now()
				});
				return;
			}

			if (trimmedCommand === 'man tmux') {
				setMode('man');
				return;
			}

			if (trimmedCommand === 'clear') {
				clearHistory();
				return;
			}

			// Unknown command in default mode
			addHistory({
				type: 'error',
				content: `command not found: ${trimmedCommand.split(' ')[0]}`,
				timestamp: Date.now()
			});
			// Ensure focus stays on input after error
			triggerInputFocus();
			return;
		}

		// In tmux mode, handle special commands first, then try the command registry
		if (focusedPane.mode === 'tmux') {
			// Handle 'man tmux' command - switch to man mode while preserving tmux state
			if (trimmedCommand === 'man tmux') {
				setMode('man');
				return;
			}

			const execution = executeCommand(trimmedCommand, focusedPane.id, focusedPane.mode);

			if (execution && execution.result.handled) {
				const { result, commandName } = execution;

				// Apply command result side effects
				if (result.output) {
					addHistory({
						type: 'output',
						content: result.output,
						timestamp: Date.now()
					});
				}

				if (result.error) {
					addHistory({
						type: 'error',
						content: result.error,
						timestamp: Date.now()
					});
				}

				if (result.system) {
					addHistory({
						type: 'system',
						content: result.system,
						timestamp: Date.now()
					});
				}

				if (result.clearHistory) {
					clearHistory();
				}

				if (result.newMode) {
					setMode(result.newMode);
				}

				if (result.signal) {
					emitSignal(result.signal.type as TmuxSignalType, result.signal.data);
				}

				if (result.generateOutput) {
					const output = generateOutput(result.generateOutput);
					if (output) {
						addHistory({ type: 'output', content: output, timestamp: Date.now() });
					}
				}

				// Handle special exit behavior
				if (result.exitBehavior === 'close-pane-or-detach') {
					if (paneCount > 1) {
						// Multiple panes: close current pane and focus another
						closeFocusedPane();
						addHistory({
							type: 'system',
							content: '[pane closed]',
							timestamp: Date.now()
						});
					} else {
						// Single pane: detach from tmux (exit to default mode)
						setMode('default');
						addHistory({
							type: 'system',
							content: '[detached (from session 0)]',
							timestamp: Date.now()
						});
					}
				}

				// Emit command-executed signal for challenge tracking (type-safe)
				emitSignal('command-executed', {
					commandName,
					command: trimmedCommand,
					paneId: focusedPane.id
				});

				// Ensure focus stays on input after command execution
				triggerInputFocus();
				return;
			}

			// Command not found in registry - show error
			addHistory({
				type: 'error',
				content: `tmux: unknown command: ${trimmedCommand.split(' ')[0]}`,
				timestamp: Date.now()
			});

			// Emit unrecognized command signal (not type-safe, just raw command)
			emitSignal('command', { command: trimmedCommand, paneId: focusedPane.id });

			// Ensure focus stays on input after command processing
			triggerInputFocus();
		}
	}

	/**
	 * Execute a tmux command (called from keybinding handler).
	 * Emits a type-safe 'command-executed' signal for challenge integration.
	 *
	 * @param commandName - The command ID (type-safe from CommandIdType)
	 * @param value - Optional value for commands that require input (e.g., rename)
	 */
	function executeTmuxCommand(commandName: CommandIdType, value?: string): void {
		if (!focusedPane || focusedPane.mode !== 'tmux') {
			return;
		}

		// Format the command with optional value for display
		const fullCommand = value ? `${commandName}:${value}` : commandName;

		// Emit type-safe command-executed signal for challenge tracking
		emitSignal('command-executed', {
			commandName,
			command: fullCommand,
			paneId: focusedPane.id
		});
	}

	// ========================================================================
	// RESET
	// ========================================================================

	/**
	 * Reset to initial state.
	 */
	function reset(): void {
		state = initialState ?? createInitialState();
		prefixActive = false;
		lastFocusedPaneId = null;
	}

	// ========================================================================
	// RETURN STORE INTERFACE
	// ========================================================================

	return {
		// Reactive state (read-only via getters)
		get windows() {
			return windows;
		},
		get activeWindowIndex() {
			return activeWindowIndex;
		},
		get activeWindow() {
			return activeWindow;
		},
		get focusedPaneId() {
			return focusedPaneId;
		},
		get focusedPane() {
			return focusedPane;
		},
		get allPanesInActiveWindow() {
			return allPanesInActiveWindow;
		},
		get paneCount() {
			return paneCount;
		},
		get windowCount() {
			return windowCount;
		},
		get prefixActive() {
			return prefixActive;
		},
		/**
		 * Counter that increments when input focus should be refreshed.
		 * Pass this to PaneView to trigger focus updates.
		 */
		get focusTrigger() {
			return focusTrigger;
		},

		// Window operations
		createWindow: createNewWindow,
		closeWindow,
		switchWindow,
		nextWindow,
		previousWindow,
		renameWindow,
		reorderWindows,

		// Pane operations
		splitPane: splitFocusedPane,
		closePane: closeFocusedPane,
		focusPane,
		moveFocus,
		focusNextPane,
		focusPreviousPane,
		focusLastPane,

		// Pane content
		addHistory,
		clearHistory,
		setMode,
		exitManMode,
		setInput,
		updateFocusedPane,

		// Prefix mode
		togglePrefix,
		activatePrefix,
		deactivatePrefix,

		// Command processing
		processCommand,
		executeTmuxCommand,

		// Reset
		reset
	};
}

/**
 * Type for the tmux store.
 */
export type TmuxStore = ReturnType<typeof createTmuxStore>;
