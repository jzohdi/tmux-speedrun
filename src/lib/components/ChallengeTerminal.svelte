<script lang="ts">
	import { tick, onMount } from 'svelte';
	import Manpage from './Manpage.svelte';
	import {
		getAllChallengeCommands,
		getCommandByName,
		type TmuxCommand
	} from '$lib/data/tmux-commands';
	import { isPrefixKey, lookupKeybinding, type Keybinding } from '$lib/data/keybindings';

	type TerminalMode = 'keybind' | 'input' | 'man';

	type Props = {
		/** Callback when the user completes a command (name or name:input for rename commands) */
		onCommand?: (command: string) => void;
		/** Whether commands are disabled (but keybindings still work for practice) */
		disabled?: boolean;
		/** Placeholder text for input mode */
		placeholder?: string;
		/**
		 * If provided, shows what input value is expected (for rename commands).
		 * This comes from the challenge prompt.
		 */
		expectedInput?: string;
		/**
		 * Optional list of commands to show in man page.
		 * Defaults to all challenge commands.
		 */
		manpageCommands?: TmuxCommand[];
	};

	let {
		onCommand,
		disabled = false,
		placeholder = '',
		expectedInput,
		manpageCommands
	}: Props = $props();

	// Terminal state
	let mode = $state<TerminalMode>('keybind');
	let prefixActive = $state(false);
	let lastCommand = $state<TmuxCommand | null>(null);
	let inputValue = $state('');
	let feedbackMessage = $state<string | null>(null);
	let feedbackTimeout = $state<ReturnType<typeof setTimeout> | null>(null);

	// Refs
	let containerRef = $state<HTMLButtonElement | null>(null);
	let inputRef = $state<HTMLInputElement | null>(null);
	let manpageRef = $state<HTMLDivElement | null>(null);

	// Get commands for the manpage - defaults to all challenge commands
	const commandsForManpage = $derived(manpageCommands ?? getAllChallengeCommands());

	// Visual state
	const statusText = $derived(getStatusText());

	function getStatusText(): string {
		if (mode === 'man') {
			return 'man tmux';
		}
		if (mode === 'input' && lastCommand) {
			return `${lastCommand.name}: enter value`;
		}
		if (prefixActive) {
			return 'prefix --';
		}

		return 'ready';
	}

	/**
	 * Show a brief feedback message.
	 */
	function showFeedback(message: string, durationMs = 1500) {
		if (feedbackTimeout) {
			clearTimeout(feedbackTimeout);
		}
		feedbackMessage = message;
		feedbackTimeout = setTimeout(() => {
			feedbackMessage = null;
		}, durationMs);
	}

	/**
	 * Toggle prefix mode on/off.
	 */
	function togglePrefixMode() {
		prefixActive = !prefixActive;
	}

	/**
	 * Exit prefix mode.
	 */
	function exitPrefixMode() {
		prefixActive = false;
	}

	/**
	 * Handle a detected keybinding.
	 */
	async function handleKeybinding(binding: Keybinding) {
		exitPrefixMode();

		if (binding.kind !== 'command') {
			return;
		}

		const cmd = getCommandByName(binding.commandName);
		if (!cmd) {
			return;
		}

		lastCommand = cmd;

		// Check if command requires input (rename commands)
		if (cmd.requiresInput) {
			// Enter input mode for the user to type the value
			mode = 'input';
			inputValue = '';
			await tick();
			inputRef?.focus();

			return;
		}

		// Command doesn't require input - submit immediately
		submitCommand(cmd.name);
	}

	/**
	 * Submit a completed command.
	 */
	function submitCommand(commandStr: string) {
		if (disabled) {
			showFeedback('Challenge not active');

			return;
		}

		if (onCommand) {
			onCommand(commandStr);
		}

		// Reset state
		lastCommand = null;
		mode = 'keybind';
		inputValue = '';
	}

	/**
	 * Handle keydown in keybind mode.
	 */
	function handleKeybindKeyDown(event: KeyboardEvent) {
		// Check for prefix key (Ctrl+b) - toggles prefix mode
		if (isPrefixKey(event)) {
			event.preventDefault();
			togglePrefixMode();

			return;
		}

		// If prefix is active, look up the keybinding
		if (prefixActive) {
			event.preventDefault();

			const binding = lookupKeybinding(event);
			if (binding) {
				handleKeybinding(binding);
			} else {
				// Unknown key - show feedback but stay in prefix mode
				showFeedback(`Unknown: ${event.key}`, 1000);
			}

			return;
		}

		// Allow typing "man" or "man tmux" for help
		// We'll check on Enter if it's a man command
	}

	/**
	 * Handle keydown in input mode (for rename commands).
	 */
	function handleInputKeyDown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			// Cancel input mode
			mode = 'keybind';
			lastCommand = null;
			inputValue = '';
			containerRef?.focus();

			return;
		}

		if (event.key === 'Enter') {
			event.preventDefault();
			const value = inputValue.trim();

			if (!value) {
				showFeedback('Enter a value');

				return;
			}

			if (!lastCommand) {
				mode = 'keybind';

				return;
			}

			// Submit as "command-name:value"
			submitCommand(`${lastCommand.name}:${value}`);
		}
	}

	/**
	 * Main keydown handler.
	 */
	function handleKeyDown(event: KeyboardEvent) {
		// In man mode, let the Manpage component handle events
		if (mode === 'man') {
			return;
		}

		// In input mode, handle text input
		if (mode === 'input') {
			handleInputKeyDown(event);

			return;
		}

		// Keybind mode
		handleKeybindKeyDown(event);
	}

	/**
	 * Handle text input for "man tmux" command.
	 * This is a fallback for users who type it instead of using keybindings.
	 */
	function handleTextInput(event: Event) {
		const target = event.target as HTMLInputElement;
		const value = target.value.toLowerCase().trim();

		// Check if user typed "man" or "man tmux"
		if (value === 'man' || value === 'man tmux') {
			showManPage();
			inputValue = '';
		}
	}

	/**
	 * Show the man page.
	 */
	function showManPage() {
		exitPrefixMode();
		mode = 'man';
	}

	/**
	 * Exit man mode and return to keybind mode.
	 */
	async function exitManPage() {
		mode = 'keybind';
		await tick();
		containerRef?.focus();
	}

	/**
	 * Focus the appropriate element based on mode.
	 */
	function focusTerminal() {
		if (mode === 'man') {
			manpageRef?.focus();
		} else if (mode === 'input') {
			inputRef?.focus();
		} else {
			containerRef?.focus();
		}
	}

	/** Public method to focus the terminal */
	export async function focus() {
		await tick();
		focusTerminal();
	}

	/** Public method to clear input state */
	export function clearInput() {
		inputValue = '';
		lastCommand = null;
		mode = 'keybind';
	}

	/** Public method to enter man page mode */
	export function showMan() {
		showManPage();
	}

	/** Public method to check if in man mode */
	export function isInManMode(): boolean {
		return mode === 'man';
	}

	// Focus container on mount
	onMount(() => {
		containerRef?.focus();
	});
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<button
	class="challenge-terminal"
	class:man-mode={mode === 'man'}
	class:prefix-active={prefixActive}
	class:input-mode={mode === 'input'}
	bind:this={containerRef}
	onclick={focusTerminal}
	onkeydown={handleKeyDown}
	tabindex="0"
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
			{mode === 'man' ? 'man tmux' : 'challenge'}
		</span>
		<div class="terminal-buttons invisible">
			<span class="terminal-button"></span>
			<span class="terminal-button"></span>
			<span class="terminal-button"></span>
		</div>
	</div>

	<!-- Terminal Body -->
	<div class="terminal-body">
		{#if mode === 'man'}
			<Manpage onQuit={exitManPage} commands={commandsForManpage} bind:containerRef={manpageRef} />
		{:else}
			<!-- Status Line -->
			<div class="status-line">
				<span class="status-label" class:active={prefixActive}>
					{statusText}
				</span>
				{#if feedbackMessage}
					<span class="feedback">{feedbackMessage}</span>
				{/if}
			</div>

			<!-- Keybind Mode Display -->
			{#if mode === 'keybind'}
				<div class="keybind-display">
					<div class="prefix-indicator" class:active={prefixActive}>
						<span class="key">Ctrl</span>
						<span class="plus">+</span>
						<span class="key">b</span>
					</div>
					{#if prefixActive}
						<span class="waiting-text">press command key (Ctrl+b to cancel)</span>
					{:else}
						<span class="hint-text">press Ctrl+b to start</span>
					{/if}
				</div>
			{/if}

			<!-- Input Mode (for rename commands) -->
			{#if mode === 'input' && lastCommand}
				<div class="input-mode-container">
					<div class="input-label">
						{lastCommand.description}
					</div>
					{#if expectedInput}
						<div class="expected-value">
							Expected: <code>{expectedInput}</code>
						</div>
					{/if}
					<div class="input-line">
						<span class="prompt">&gt;</span>
						<input
							type="text"
							class="terminal-input"
							bind:value={inputValue}
							bind:this={inputRef}
							oninput={handleTextInput}
							autocomplete="off"
							autocorrect="off"
							autocapitalize="off"
							spellcheck="false"
							placeholder="Type the value and press Enter"
						/>
					</div>
					<div class="input-hint">
						Press <kbd>Enter</kbd> to confirm, <kbd>Esc</kbd> to cancel
					</div>
				</div>
			{/if}

			<!-- Help hint -->
			<div class="help-footer">
				Type <kbd>man tmux</kbd> for command reference
			</div>
		{/if}
	</div>
</button>

<style>
	.challenge-terminal {
		width: 100%;
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

	.challenge-terminal.man-mode {
		min-height: 400px;
	}

	.terminal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 16px;
		background: #2d2d2d;
		border-bottom: 1px solid #3d3d3d;
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

	.terminal-body {
		padding: 20px;
		min-height: 180px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.man-mode .terminal-body {
		padding: 0;
		min-height: 350px;
	}

	/* Status Line */
	.status-line {
		display: flex;
		align-items: center;
		gap: 16px;
		font-size: 12px;
	}

	.status-label {
		color: #666;
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}

	.status-label.active {
		color: #ffb86c;
	}

	.feedback {
		color: #8be9fd;
		animation: fadeIn 0.15s ease;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	/* Keybind Display */
	.keybind-display {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 16px;
		padding: 24px 0;
	}

	.prefix-indicator {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 12px 20px;
		background: #2d2d2d;
		border-radius: 8px;
		transition: all 0.15s ease;
	}

	.prefix-indicator.active {
		border-color: #ffb86c;
		background: rgba(255, 184, 108, 0.1);
	}

	.prefix-indicator .key {
		padding: 6px 12px;
		background: #1c1c1c;
		border-radius: 4px;
		color: #e0e0e0;
		font-weight: 600;
		font-size: 13px;
	}

	.prefix-indicator.active .key {
		background: #ffb86c;
		color: #1c1c1c;
		border-color: #ffb86c;
	}

	.prefix-indicator .plus {
		color: #666;
		font-size: 16px;
	}

	.waiting-text {
		color: #ffb86c;
		font-size: 13px;
	}

	.hint-text {
		color: #666;
		font-size: 13px;
	}

	/* Input Mode */
	.input-mode-container {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 16px;
		background: #2d2d2d;
		border-radius: 8px;
	}

	.input-label {
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

	.input-line {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		background: #1c1c1c;
		border-radius: 4px;
	}

	.prompt {
		color: #50fa7b;
		font-weight: bold;
	}

	.terminal-input {
		flex: 1;
		background: transparent;
		border: none;
		outline: none;
		color: #e0e0e0;
		font-family: inherit;
		font-size: inherit;
		caret-color: #50fa7b;
	}

	.terminal-input::placeholder {
		color: #4d4d4d;
	}

	.input-hint {
		font-size: 12px;
		color: #666;
	}

	.input-hint kbd {
		background: #3d3d3d;
		padding: 2px 6px;
		border-radius: 3px;
		font-size: 11px;
	}

	/* Help Footer */
	.help-footer {
		margin-top: auto;
		font-size: 12px;
		color: #4d4d4d;
		text-align: center;
	}

	.help-footer kbd {
		color: #666;
	}
</style>
