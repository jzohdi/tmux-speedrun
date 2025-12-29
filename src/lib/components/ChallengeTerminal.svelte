<script lang="ts">
	import { tick } from 'svelte';
	import Manpage from './Manpage.svelte';
	import { getAllChallengeCommands, type TmuxCommand } from '$lib/data/tmux-commands';

	type TerminalMode = 'input' | 'man';

	type Props = {
		/** Callback when the user submits a command */
		onCommand?: (command: string) => void;
		/** Whether the terminal is disabled (no input allowed) */
		disabled?: boolean;
		/** Placeholder text for the input */
		placeholder?: string;
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
		manpageCommands
	}: Props = $props();

	let inputValue = $state('');
	let inputRef = $state<HTMLInputElement | null>(null);
	let containerRef = $state<HTMLButtonElement | null>(null);
	let manpageRef = $state<HTMLDivElement | null>(null);
	let mode = $state<TerminalMode>('input');

	// Get commands for the manpage - defaults to all challenge commands
	const commandsForManpage = $derived(manpageCommands ?? getAllChallengeCommands());

	function handleKeyDown(event: KeyboardEvent) {
		// In man mode, let the Manpage handle all keyboard events
		if (mode === 'man') {
			return;
		}

		if (event.key === 'Enter') {
			event.preventDefault();
			const command = inputValue.trim();

			if (command) {
				// Always allow man command, even when disabled
				if (isManCommand(command)) {
					showManPage();
					inputValue = '';

					return;
				}

				// Block other commands when disabled
				if (disabled) {
					inputValue = '';

					return;
				}

				// Otherwise, pass to parent handler
				if (onCommand) {
					onCommand(command);
				}
			}
			inputValue = '';
		}
	}

	/**
	 * Check if the command is a man page request.
	 */
	function isManCommand(command: string): boolean {
		const normalized = command.toLowerCase().trim();

		return normalized === 'man tmux' || normalized === 'man';
	}

	/**
	 * Show the man page.
	 */
	function showManPage() {
		mode = 'man';
	}

	/**
	 * Exit man mode and return to input.
	 */
	async function exitManPage() {
		mode = 'input';
		await tick();
		inputRef?.focus();
	}

	function focusInput() {
		if (mode === 'man') {
			manpageRef?.focus();
		} else if (!disabled) {
			inputRef?.focus();
		}
	}

	/** Public method to focus the terminal */
	export async function focus() {
		await tick();

		if (mode === 'man') {
			manpageRef?.focus();
		} else {
			inputRef?.focus();
		}
	}

	/** Public method to clear the input */
	export function clearInput() {
		inputValue = '';
	}

	/**
	 * Public method to enter man page mode.
	 * Can be called from parent component.
	 */
	export function showMan() {
		showManPage();
	}

	/**
	 * Public method to check if in man mode.
	 */
	export function isInManMode(): boolean {
		return mode === 'man';
	}
</script>

<button
	class="challenge-terminal"
	class:man-mode={mode === 'man'}
	class:commands-disabled={disabled}
	bind:this={containerRef}
	onclick={focusInput}
	onkeydown={handleKeyDown}
	aria-label="Challenge terminal"
	tabindex="0"
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
			<Manpage
				onQuit={exitManPage}
				commands={commandsForManpage}
				bind:containerRef={manpageRef}
			/>
		{:else}
			<div class="input-line">
				<span class="prompt">$</span>
				<input
					type="text"
					class="terminal-input"
					bind:value={inputValue}
					bind:this={inputRef}
					autocomplete="off"
					autocorrect="off"
					autocapitalize="off"
					spellcheck="false"
					{placeholder}
				/>
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
		display: block;
		text-align: left;
		border: none;
		cursor: text;
	}

	.challenge-terminal.man-mode {
		min-height: 400px;
	}

	.challenge-terminal.commands-disabled:not(.man-mode) {
		opacity: 0.85;
	}

	.challenge-terminal:focus {
		outline: 2px solid #50fa7b;
		outline-offset: 2px;
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
		min-height: 120px;
		display: flex;
		flex-direction: column;
		justify-content: center;
		position: relative;
	}

	.man-mode .terminal-body {
		padding: 0;
		min-height: 350px;
	}

	.input-line {
		display: flex;
		align-items: center;
	}

	.prompt {
		color: #50fa7b;
		margin-right: 8px;
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
</style>
