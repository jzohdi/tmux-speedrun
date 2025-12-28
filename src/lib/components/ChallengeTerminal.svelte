<script lang="ts">
	import { tick } from 'svelte';

	type Props = {
		/** Callback when the user submits a command */
		onCommand?: (command: string) => void;
		/** Whether the terminal is disabled (no input allowed) */
		disabled?: boolean;
		/** Placeholder text for the input */
		placeholder?: string;
	};

	let { onCommand, disabled = false, placeholder = '' }: Props = $props();

	let inputValue = $state('');
	let inputRef = $state<HTMLInputElement | null>(null);
	let containerRef = $state<HTMLButtonElement | null>(null);

	function handleKeyDown(event: KeyboardEvent) {
		if (disabled) {
			return;
		}

		if (event.key === 'Enter') {
			event.preventDefault();
			const command = inputValue.trim();
			if (command && onCommand) {
				onCommand(command);
			}
			inputValue = '';
		}
	}

	function focusInput() {
		if (!disabled) {
			inputRef?.focus();
		}
	}

	/** Public method to focus the terminal */
	export async function focus() {
		await tick();
		inputRef?.focus();
	}

	/** Public method to clear the input */
	export function clearInput() {
		inputValue = '';
	}
</script>

<button
	class="challenge-terminal"
	bind:this={containerRef}
	onclick={focusInput}
	onkeydown={handleKeyDown}
	aria-label="Challenge terminal"
	tabindex="0"
	{disabled}
>
	<!-- Terminal Header -->
	<div class="terminal-header">
		<div class="terminal-buttons">
			<span class="terminal-button close"></span>
			<span class="terminal-button minimize"></span>
			<span class="terminal-button maximize"></span>
		</div>
		<span class="terminal-title">challenge</span>
		<div class="terminal-buttons invisible">
			<span class="terminal-button"></span>
			<span class="terminal-button"></span>
			<span class="terminal-button"></span>
		</div>
	</div>

	<!-- Terminal Body -->
	<div class="terminal-body">
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
				{disabled}
			/>
		</div>
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

	.challenge-terminal:disabled {
		opacity: 0.6;
		cursor: not-allowed;
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

	.terminal-input:disabled {
		cursor: not-allowed;
	}
</style>

