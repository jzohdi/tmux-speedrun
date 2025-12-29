<script lang="ts">
	import { tick, onMount } from 'svelte';
	import { createTmuxStore, type TmuxStore } from '$lib/stores/tmux-state.svelte';
	import type { TmuxSignal, PaneMode } from '$lib/utils/pane-tree';
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

	let { onSignal, disabled = false, expectedInput }: ChallengeTerminalProps = $props();

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

	// Input mode state (for commands that require text input)
	let inputModeCommand = $state<TmuxCommand | null>(null);
	let inputModeValue = $state('');

	// Derived state
	const isInTmuxMode = $derived(tmux.focusedPane?.mode === 'tmux');
	const isInManMode = $derived(tmux.focusedPane?.mode === 'man');
	const isInDefaultMode = $derived(tmux.focusedPane?.mode === 'default');
	const isInInputMode = $derived(inputModeCommand !== null);

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
	 * Handle keydown in input mode (for commands like rename-window).
	 */
	function handleInputModeKeyDown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			event.preventDefault();
			// Cancel input mode
			inputModeCommand = null;
			inputModeValue = '';
			return;
		}

		if (event.key === 'Enter') {
			event.preventDefault();
			const value = inputModeValue.trim();

			if (!value) {
				showFeedback('Enter a value');
				return;
			}

			if (!inputModeCommand) {
				inputModeCommand = null;
				inputModeValue = '';
				return;
			}

			// Validate the command name is a valid CommandIdType
			if (!isValidCommandId(inputModeCommand.name)) {
				console.error(`Invalid command name: ${inputModeCommand.name}`);
				inputModeCommand = null;
				inputModeValue = '';
				return;
			}

			// Execute the command with the input value
			tmux.executeTmuxCommand(inputModeCommand.name, value);

			// Reset input mode
			inputModeCommand = null;
			inputModeValue = '';
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
				handleKeybinding(binding.commandName);
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

		// Execute commands that affect local state
		executeLocalCommand(commandName);

		// Also emit the command signal for challenge verification
		tmux.executeTmuxCommand(commandName);
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
				// Show window list - could be a feedback message or special UI
				showFeedback(`Windows: ${tmux.windows.map((w, i) => `${i}:${w.name}`).join(', ')}`);
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
			case CommandId.SELECT_WINDOW:
				// Handled specially - need to know which number was pressed
				break;

			// Session commands
			case CommandId.DETACH:
				// Exit tmux mode back to default
				tmux.setMode('default');
				tmux.addHistory({
					type: 'system',
					content: '[detached from session]',
					timestamp: Date.now()
				});
				break;
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
		tmux.moveFocus(direction);
		tmux.deactivatePrefix();

		// Also emit the select-pane command
		tmux.executeTmuxCommand(CommandId.SELECT_PANE);
	}

	/**
	 * Main keydown handler.
	 */
	function handleKeyDown(event: KeyboardEvent): void {
		// In man mode, let the pane handle keyboard events
		if (isInManMode) {
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
	 */
	function handleExitMan(paneId: string): void {
		// Switch back to the previous mode (tmux if was in tmux before man)
		tmux.setMode('default', paneId);
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
	 * Focus the terminal.
	 * Uses tick() to ensure Svelte DOM updates are complete,
	 * then requestAnimationFrame to ensure browser has rendered.
	 */
	export async function focus(): Promise<void> {
		await tick();
		// Use requestAnimationFrame to ensure browser has rendered
		requestAnimationFrame(() => {
			containerRef?.focus();
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
		containerRef?.focus();
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
		<!-- Input Mode Overlay -->
		{#if isInInputMode && inputModeCommand}
			<div class="input-mode-overlay">
				<div class="input-mode-container">
					<div class="input-mode-label">
						{inputModeCommand.description}
					</div>
					{#if expectedInput}
						<div class="expected-value">
							Expected: <code>{expectedInput}</code>
						</div>
					{/if}
					<div class="input-mode-line">
						<span class="input-mode-prompt">&gt;</span>
						<input
							type="text"
							class="input-mode-input"
							bind:value={inputModeValue}
							autocomplete="off"
							autocorrect="off"
							autocapitalize="off"
							spellcheck="false"
							placeholder="Type the value and press Enter"
						/>
					</div>
					<div class="input-mode-hint">
						Press <kbd>Enter</kbd> to confirm, <kbd>Esc</kbd> to cancel
					</div>
				</div>
			</div>
		{/if}

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
			windows={tmux.windows}
			activeWindowIndex={tmux.activeWindowIndex}
			focusedPane={tmux.focusedPane}
			prefixActive={tmux.prefixActive}
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

	/* Input Mode Overlay */
	.input-mode-overlay {
		position: absolute;
		inset: 0;
		background: rgba(0, 0, 0, 0.8);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 10;
	}

	.input-mode-container {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 24px;
		background: #2d2d2d;
		border-radius: 8px;
		max-width: 400px;
		width: 90%;
	}

	.input-mode-label {
		font-size: 14px;
		color: #e0e0e0;
	}

	.expected-value {
		font-size: 13px;
		color: #a0a0a0;
	}

	.expected-value code {
		color: #50fa7b;
		background: rgba(80, 250, 123, 0.1);
		padding: 2px 6px;
		border-radius: 3px;
	}

	.input-mode-line {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		background: #1c1c1c;
		border-radius: 4px;
	}

	.input-mode-prompt {
		color: #50fa7b;
		font-weight: bold;
	}

	.input-mode-input {
		flex: 1;
		background: transparent;
		border: none;
		outline: none;
		color: #e0e0e0;
		font-family: inherit;
		font-size: inherit;
		caret-color: #50fa7b;
	}

	.input-mode-input::placeholder {
		color: #4d4d4d;
	}

	.input-mode-hint {
		font-size: 12px;
		color: #666;
	}

	.input-mode-hint kbd {
		background: #3d3d3d;
		padding: 2px 6px;
		border-radius: 3px;
		font-size: 11px;
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

