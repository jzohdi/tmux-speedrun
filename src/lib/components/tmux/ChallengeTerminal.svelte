<script lang="ts">
	import { tick, onMount, onDestroy } from 'svelte';
	import { createTmuxStore, type TmuxStore } from '$lib/stores/tmux-state.svelte';
	import type { TmuxSignal } from '$lib/utils/pane-tree';
	import { isPrefixKey, lookupKeybinding } from '$lib/data/keybindings';
	import { getCommandByName, type TmuxCommand } from '$lib/data/tmux-commands';
	import { CommandId, type CommandIdType, isValidCommandId } from '$lib/utils/tmux-commands';
	import TabBar from './TabBar.svelte';
	import PaneGrid from './PaneGrid.svelte';
	import StatusBar from './StatusBar.svelte';

	// ========================================================================
	// PROPS
	// ========================================================================

	type ChallengeTerminalProps = {
		/**
		 * Callback when a signal is emitted (for challenge integration).
		 * Signals include: command, window-created, pane-split, tmux-entered, etc.
		 */
		onSignal?: (signal: TmuxSignal) => void;
		/**
		 * Whether the terminal is disabled (commands won't be processed).
		 */
		disabled?: boolean;
		/**
		 * If provided, shows what input value is expected (for rename commands).
		 */
		expectedInput?: string;
	};

	let { onSignal, disabled = false /* expectedInput */ }: ChallengeTerminalProps = $props();

	// ========================================================================
	// STATE
	// ========================================================================

	// Create the tmux store with signal callback
	const tmux = createTmuxStore({
		onSignal: (signal) => {
			if (onSignal) {
				onSignal(signal);
			}
		}
	});

	// Local UI state
	let containerRef = $state<HTMLDivElement | null>(null);
	let feedbackMessage = $state<string | null>(null);
	let feedbackTimeout = $state<ReturnType<typeof setTimeout> | null>(null);
	let timeState = $state<{
		interval: NodeJS.Timeout | null;
		timeString: string;
		paneId: string; // Which pane should display the clock overlay
		canCloseYet: boolean; // The keydown binding fires too early, need to store if it can close yet
	} | null>(null);

	// Derived clock state to pass down to PaneGrid/PaneView
	const clockState = $derived(
		timeState ? { paneId: timeState.paneId, timeString: timeState.timeString } : null
	);

	// Input mode state (for commands that require text input like rename-window)
	let inputModeCommand = $state<TmuxCommand | null>(null);
	let inputModeValue = $state('');

	// Derived state
	const isInTmuxMode = $derived(tmux.focusedPane?.mode === 'tmux');
	const isInManMode = $derived(tmux.focusedPane?.mode === 'man');
	// const isInDefaultMode = $derived(tmux.focusedPane?.mode === 'default');
	const isInInputMode = $derived(inputModeCommand !== null);

	// Status bar input mode state (for tmux-style inline input)
	const statusBarInputMode = $derived(
		inputModeCommand
			? {
					active: true,
					actionLabel: inputModeCommand.name,
					value: inputModeValue
				}
			: { active: false, actionLabel: '', value: '' }
	);

	// ========================================================================
	// FEEDBACK
	// ========================================================================

	/**
	 * Show a brief feedback message.
	 */
	function showFeedback(message: string, durationMs = 1500): void {
		if (feedbackTimeout) {
			clearTimeout(feedbackTimeout);
		}
		feedbackMessage = message;
		feedbackTimeout = setTimeout(() => {
			feedbackMessage = null;
		}, durationMs);
	}

	// ========================================================================
	// KEYBOARD HANDLING
	// ========================================================================

	/**
	 * Handle status bar input value change.
	 */
	function handleStatusBarInputChange(value: string): void {
		inputModeValue = value;
	}

	/**
	 * Handle status bar input submission.
	 */
	function handleStatusBarInputSubmit(value: string): void {
		const trimmedValue = value.trim();

		if (!trimmedValue) {
			showFeedback('Enter a value');
			return;
		}

		if (!inputModeCommand) {
			inputModeCommand = null;
			inputModeValue = '';
			restoreFocusAfterInputMode();
			return;
		}

		// Validate the command name is a valid CommandIdType
		if (!isValidCommandId(inputModeCommand.name)) {
			console.error(`Invalid command name: ${inputModeCommand.name}`);
			inputModeCommand = null;
			inputModeValue = '';
			restoreFocusAfterInputMode();
			return;
		}

		const commandName = inputModeCommand.name;

		// Execute the actual command based on command type
		switch (commandName) {
			case CommandId.RENAME_WINDOW:
				tmux.renameWindow(trimmedValue);
				break;
			// Add other input commands here as needed
			default:
				console.warn(`No handler for input command: ${commandName}`);
		}

		// Emit the command signal for challenge tracking
		tmux.executeTmuxCommand(commandName, trimmedValue);

		// Reset input mode and restore focus to terminal
		inputModeCommand = null;
		inputModeValue = '';
		restoreFocusAfterInputMode();
	}

	/**
	 * Handle status bar input cancellation.
	 */
	function handleStatusBarInputCancel(): void {
		inputModeCommand = null;
		inputModeValue = '';
		restoreFocusAfterInputMode();
	}

	/**
	 * Restore focus to the pane input after exiting input mode (e.g., after renaming).
	 * Triggers the store's focus mechanism to properly focus the active pane's input.
	 */
	function restoreFocusAfterInputMode(): void {
		// Re-focus the currently focused pane to trigger input focus
		if (tmux.focusedPaneId) {
			tmux.focusPane(tmux.focusedPaneId);
		}
	}

	/**
	 * Handle keydown in input mode (for commands like rename-window).
	 * @deprecated Use StatusBar inline input instead - this is kept for legacy overlay support
	 */
	function handleInputModeKeyDown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			event.preventDefault();
			handleStatusBarInputCancel();
			return;
		}

		if (event.key === 'Enter') {
			event.preventDefault();
			handleStatusBarInputSubmit(inputModeValue);
		}
	}

	/**
	 * Handle keydown when in tmux mode (prefix key handling).
	 */
	function handleTmuxModeKeyDown(event: KeyboardEvent): void {
		// In input mode, handle separately
		if (isInInputMode) {
			handleInputModeKeyDown(event);
			return;
		}

		// Check for prefix key (Ctrl+b) - toggles prefix mode
		if (isPrefixKey(event)) {
			event.preventDefault();
			tmux.togglePrefix();
			return;
		}

		// If prefix is active, look up the keybinding
		if (tmux.prefixActive) {
			event.preventDefault();

			const binding = lookupKeybinding(event);
			if (binding) {
				// Handle select-window specially since we need the actual digit pressed
				if (binding.commandName === CommandId.SELECT_WINDOW) {
					handleSelectWindowByNumber(event.key);
				} else {
					handleKeybinding(binding.commandName);
				}
			} else {
				// Unknown key - show feedback but stay in prefix mode
				showFeedback(`Unknown: ${event.key}`, 1000);
			}
			return;
		}

		// Not in prefix mode and not a special key
		// Let normal typing pass through to the input field
	}

	/**
	 * Handle select-window command by number (prefix + 0-9).
	 * @param key - The key pressed (should be '0'-'9')
	 */
	function handleSelectWindowByNumber(key: string): void {
		tmux.deactivatePrefix();

		if (disabled) {
			showFeedback('Challenge not active');
			return;
		}

		const windowIndex = parseInt(key, 10);

		if (isNaN(windowIndex) || windowIndex < 0 || windowIndex > 9) {
			return;
		}

		// Check if the window exists
		if (windowIndex >= tmux.windowCount) {
			showFeedback(`Window ${windowIndex} does not exist`, 1000);
			return;
		}

		// Switch to the window
		tmux.switchWindow(windowIndex);

		// Emit the command signal for challenge tracking
		tmux.executeTmuxCommand(CommandId.SELECT_WINDOW);
	}

	/**
	 * Handle a detected keybinding command.
	 * @param commandName - The type-safe command ID from the keybinding
	 */
	async function handleKeybinding(commandName: CommandIdType): Promise<void> {
		tmux.deactivatePrefix();

		if (disabled) {
			showFeedback('Challenge not active');
			return;
		}

		const cmd = getCommandByName(commandName);
		if (!cmd) {
			return;
		}

		// Check if command requires input (rename commands)
		if (cmd.requiresInput) {
			inputModeCommand = cmd;
			inputModeValue = '';
			return;
		}

		// Emit the command signal for challenge verification BEFORE executing
		// (Important: must emit before mode changes like 'detach' which exits tmux mode)
		tmux.executeTmuxCommand(commandName);

		// Execute commands that affect local state
		executeLocalCommand(commandName);
	}

	/**
	 * Execute commands that affect local terminal state.
	 * @param commandName - The type-safe command ID
	 */
	function executeLocalCommand(commandName: CommandIdType): void {
		switch (commandName) {
			// Window commands
			case CommandId.NEW_WINDOW:
				tmux.createWindow();
				break;
			case CommandId.NEXT_WINDOW:
				tmux.nextWindow();
				break;
			case CommandId.PREVIOUS_WINDOW:
				tmux.previousWindow();
				break;
			case CommandId.KILL_WINDOW:
				tmux.closeWindow();
				break;
			case CommandId.LIST_WINDOWS:
				// Output window list to history (same format as 'tmux lsw')
				tmux.outputWindowList();
				break;

			// Pane commands
			case CommandId.SPLIT_HORIZONTAL:
				tmux.splitPane('horizontal');
				break;
			case CommandId.SPLIT_VERTICAL:
				tmux.splitPane('vertical');
				break;
			case CommandId.KILL_PANE:
				tmux.closePane();
				break;
			case CommandId.TOGGLE_ZOOM:
				if (tmux.paneCount > 1) {
					tmux.togglePaneZoom();
				} else {
					showFeedback('Cannot zoom with single pane', 1000);
				}
				break;

			// Navigation
			case CommandId.SELECT_PANE:
				// This is handled via arrow key direction in the keybinding
				// For now, just cycle to next pane
				tmux.focusNextPane();
				break;
			case CommandId.LAST_PANE:
				tmux.focusLastPane();
				break;
			case CommandId.LAST_WINDOW:
				// Toggle between last two windows
				if (tmux.windowCount > 1) {
					tmux.previousWindow();
				}
				break;

			// Select window by number (0-9)
			// Note: This is handled by handleSelectWindowByNumber() before this function is called
			case CommandId.SELECT_WINDOW:
				break;
			case CommandId.SHOW_TIME:
				clearTimestate();
				showCurrentTime();
				break;
			// Session commands
			case CommandId.DETACH: {
				// Detach from the current session (session is preserved in background)
				const detachedSessionName = tmux.detachSession();
				if (detachedSessionName !== null) {
					tmux.setMode('default');
					tmux.addHistory({
						type: 'system',
						content: `[detached (from session ${detachedSessionName})]`,
						timestamp: Date.now()
					});
				}
				break;
			}
		}
	}

	/**
	 * Handle arrow key navigation when prefix is active.
	 */
	function handlePrefixArrowKey(event: KeyboardEvent): void {
		if (!tmux.prefixActive) {
			return;
		}

		const direction = event.key.replace('Arrow', '').toLowerCase() as
			| 'up'
			| 'down'
			| 'left'
			| 'right';

		console.debug(
			'[ChallengeTerminal] Arrow navigation - direction:',
			direction,
			'currentFocusedPaneId:',
			tmux.focusedPaneId
		);

		tmux.moveFocus(direction);

		console.debug('[ChallengeTerminal] After moveFocus - newFocusedPaneId:', tmux.focusedPaneId);

		tmux.deactivatePrefix();

		// Also emit the select-pane command
		tmux.executeTmuxCommand(CommandId.SELECT_PANE);
	}

	function clearTimestate(): void {
		clearInterval(timeState?.interval ?? undefined);
		timeState = null;
	}

	function getCurrentTime(): string {
		const now = new Date();
		const hours = String(now.getHours()).padStart(2, '0');
		const minutes = String(now.getMinutes()).padStart(2, '0');
		return `${hours}:${minutes}`;
	}

	function showCurrentTime(): void {
		if (timeState?.interval) {
			clearInterval(timeState.interval);
		}

		// which pane triggered the clock command
		const targetPaneId = tmux.focusedPaneId;

		const interval = setInterval(() => {
			if (!timeState) {
				return;
			}
			timeState = {
				...timeState,
				timeString: getCurrentTime()
			};
		}, 1000 * 60);

		timeState = {
			interval,
			timeString: getCurrentTime(),
			paneId: targetPaneId,
			canCloseYet: false
		};
	}

	/**
	 * Main keydown handler.
	 */
	function handleKeyDown(event: KeyboardEvent): void {
		// In man mode, let the pane handle keyboard events
		if (isInManMode) {
			return;
		}

		if (timeState && tmux.focusedPaneId === timeState.paneId) {
			if (timeState.canCloseYet) {
				clearTimestate();
			} else {
				timeState.canCloseYet = true;
			}
			return;
		}

		// In tmux mode, handle prefix key
		if (isInTmuxMode) {
			// Handle arrow keys for pane navigation when prefix is active
			if (tmux.prefixActive && event.key.startsWith('Arrow')) {
				event.preventDefault();
				handlePrefixArrowKey(event);
				return;
			}

			handleTmuxModeKeyDown(event);
			return;
		}

		// In default mode, let the pane input handle normal typing
		// (handled by PaneView's input)
	}

	// ========================================================================
	// PANE EVENT HANDLERS
	// ========================================================================

	/**
	 * Handle input change from a pane.
	 */
	function handlePaneInputChange(paneId: string, value: string): void {
		tmux.setInput(value, paneId);
	}

	/**
	 * Handle submit from a pane (Enter pressed).
	 */
	function handlePaneSubmit(paneId: string, value: string): void {
		// Focus the pane first
		tmux.focusPane(paneId);

		// Process the command
		tmux.processCommand(value);
	}

	/**
	 * Handle pane focus.
	 */
	function handlePaneFocus(paneId: string): void {
		tmux.focusPane(paneId);
	}

	/**
	 * Handle exiting man mode.
	 * Uses exitManMode to restore the previous mode (tmux or default).
	 */
	function handleExitMan(paneId: string): void {
		tmux.exitManMode(paneId);
	}

	// ========================================================================
	// TAB HANDLERS
	// ========================================================================

	/**
	 * Handle tab click.
	 */
	function handleTabClick(index: number): void {
		tmux.switchWindow(index);
	}

	/**
	 * Handle tab reorder.
	 */
	function handleTabReorder(fromIndex: number, toIndex: number): void {
		tmux.reorderWindows(fromIndex, toIndex);
	}

	// ========================================================================
	// PUBLIC METHODS
	// ========================================================================

	/**
	 * Focus the terminal input of the currently focused pane.
	 * Uses tick() to ensure Svelte DOM updates are complete,
	 * then requestAnimationFrame to ensure browser has rendered.
	 */
	export async function focus(): Promise<void> {
		await tick();
		// Use requestAnimationFrame to ensure browser has rendered
		requestAnimationFrame(() => {
			// Focus the input in the currently focused pane (has .focused class)
			const focusedPaneInput = containerRef?.querySelector(
				'.pane-view.focused input'
			) as HTMLInputElement | null;
			if (focusedPaneInput) {
				focusedPaneInput.focus();
			} else {
				// Fallback to first input if no focused pane found
				containerRef?.querySelector('input')?.focus();
			}
		});
	}

	/**
	 * Clear input state.
	 */
	export function clearInput(): void {
		inputModeCommand = null;
		inputModeValue = '';
		if (tmux.focusedPaneId) {
			tmux.setInput('');
		}
	}

	/**
	 * Reset the terminal to initial state.
	 */
	export function reset(): void {
		tmux.reset();
		inputModeCommand = null;
		inputModeValue = '';
		feedbackMessage = null;
	}

	/**
	 * Get the current tmux store (for testing/debugging).
	 */
	export function getStore(): TmuxStore {
		return tmux;
	}

	// ========================================================================
	// LIFECYCLE
	// ========================================================================

	onMount(() => {
		containerRef?.querySelector('input')?.focus();
	});

	onDestroy(() => {
		clearTimestate();
	});
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	class="challenge-terminal"
	class:prefix-active={tmux.prefixActive}
	class:disabled
	class:input-mode={isInInputMode}
	bind:this={containerRef}
	onkeydown={handleKeyDown}
	tabindex="0"
	role="application"
	aria-label="Challenge terminal - press Ctrl+b for prefix"
>
	<!-- Terminal Header -->
	<div class="terminal-header">
		<div class="terminal-buttons">
			<span class="terminal-button close"></span>
			<span class="terminal-button minimize"></span>
			<span class="terminal-button maximize"></span>
		</div>
		<span class="terminal-title">
			{#if isInManMode}
				man tmux
			{:else if isInTmuxMode}
				tmux: {tmux.activeWindow?.name ?? 'main'}
			{:else}
				terminal
			{/if}
		</span>
		<div class="terminal-buttons invisible">
			<span class="terminal-button"></span>
			<span class="terminal-button"></span>
			<span class="terminal-button"></span>
		</div>
	</div>

	<!-- Tab Bar (only show in tmux mode with multiple windows) -->
	{#if isInTmuxMode && tmux.windowCount > 1}
		<TabBar
			windows={tmux.windows}
			activeIndex={tmux.activeWindowIndex}
			onTabClick={handleTabClick}
			onReorder={handleTabReorder}
		/>
	{/if}

	<!-- Terminal Body -->
	<div class="terminal-body">
		<!-- Feedback Message -->
		{#if feedbackMessage}
			<div class="feedback-message">
				{feedbackMessage}
			</div>
		{/if}

		<!-- Pane Grid -->
		{#if tmux.activeWindow}
			<PaneGrid
				node={tmux.activeWindow.paneTree}
				focusedPaneId={tmux.focusedPaneId}
				focusTrigger={tmux.focusTrigger}
				zoomedPaneId={tmux.zoomedPaneId}
				{clockState}
				onInputChange={handlePaneInputChange}
				onSubmit={handlePaneSubmit}
				onFocusPane={handlePaneFocus}
				onExitMan={handleExitMan}
				onKeyDown={handleKeyDown}
			/>
		{:else if tmux.focusedPane}
			<!-- Detached state: render the shell pane directly -->
			<PaneGrid
				node={tmux.focusedPane}
				focusedPaneId={tmux.focusedPaneId}
				focusTrigger={tmux.focusTrigger}
				{clockState}
				onInputChange={handlePaneInputChange}
				onSubmit={handlePaneSubmit}
				onFocusPane={handlePaneFocus}
				onExitMan={handleExitMan}
				onKeyDown={handleKeyDown}
			/>
		{/if}
	</div>

	<!-- Status Bar (only show in tmux mode) -->
	{#if isInTmuxMode}
		<StatusBar
			sessionName={tmux.attachedSession?.name ?? 'tmux-speedrun'}
			windows={tmux.windows}
			activeWindowIndex={tmux.activeWindowIndex}
			focusedPane={tmux.focusedPane}
			prefixActive={tmux.prefixActive}
			isZoomed={tmux.isZoomed}
			inputMode={statusBarInputMode}
			onInputChange={handleStatusBarInputChange}
			onInputSubmit={handleStatusBarInputSubmit}
			onInputCancel={handleStatusBarInputCancel}
		/>
	{/if}
</div>

<style>
	.challenge-terminal {
		width: 100%;
		height: 100%;
		display: flex;
		flex-direction: column;
		background: #1c1c1c;
		border-radius: 10px;
		overflow: hidden;
		box-shadow:
			0 25px 50px -12px rgba(0, 0, 0, 0.5),
			0 0 0 1px rgba(255, 255, 255, 0.05);
		font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', 'Menlo', monospace;
		font-size: 14px;
		line-height: 1.6;
		outline: none;
		min-height: 400px;
	}

	.challenge-terminal:focus {
		box-shadow:
			0 25px 50px -12px rgba(0, 0, 0, 0.5),
			0 0 0 2px #50fa7b;
	}

	.challenge-terminal.prefix-active {
		box-shadow:
			0 25px 50px -12px rgba(0, 0, 0, 0.5),
			0 0 0 2px #ffb86c;
	}

	.challenge-terminal.disabled {
		opacity: 0.7;
	}

	/* Terminal Header */
	.terminal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 16px;
		background: #2d2d2d;
		border-bottom: 1px solid #3d3d3d;
		flex-shrink: 0;
	}

	.terminal-buttons {
		display: flex;
		gap: 8px;
	}

	.terminal-buttons.invisible {
		visibility: hidden;
	}

	.terminal-button {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: #4d4d4d;
	}

	.terminal-button.close {
		background: #ff5f56;
	}

	.terminal-button.minimize {
		background: #ffbd2e;
	}

	.terminal-button.maximize {
		background: #27ca40;
	}

	.terminal-title {
		color: #a0a0a0;
		font-size: 13px;
		font-weight: 500;
	}

	/* Terminal Body */
	.terminal-body {
		flex: 1;
		min-height: 0;
		position: relative;
		display: flex;
		flex-direction: column;
	}

	/* Ensure PaneGrid fills the terminal body */
	.terminal-body > :global(*:last-child) {
		flex: 1;
		min-height: 0;
	}

	/* Feedback Message */
	.feedback-message {
		position: absolute;
		top: 8px;
		left: 50%;
		transform: translateX(-50%);
		background: #8be9fd;
		color: #1c1c1c;
		padding: 4px 12px;
		border-radius: 4px;
		font-size: 12px;
		font-weight: 500;
		z-index: 5;
		animation: fadeInOut 1.5s ease forwards;
	}

	@keyframes fadeInOut {
		0% {
			opacity: 0;
			transform: translateX(-50%) translateY(-10px);
		}
		15% {
			opacity: 1;
			transform: translateX(-50%) translateY(0);
		}
		85% {
			opacity: 1;
		}
		100% {
			opacity: 0;
		}
	}

	/* Responsive */
	@media (max-width: 640px) {
		.challenge-terminal {
			font-size: 12px;
			border-radius: 0;
			min-height: 300px;
		}
	}
</style>
