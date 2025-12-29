<script lang="ts">
	import { tick } from 'svelte';
	import type { Pane, HistoryEntry } from '$lib/utils/pane-tree';
	import Manpage from '../Manpage.svelte';

	type PaneViewProps = {
		/** The pane data to render */
		pane: Pane;
		/** Whether this pane is currently focused */
		isFocused: boolean;
		/** Counter that increments when focus should be refreshed */
		focusTrigger?: number;
		/** Callback when input changes */
		onInputChange?: (value: string) => void;
		/** Callback when Enter is pressed in input */
		onSubmit?: (value: string) => void;
		/** Callback when the pane is clicked (for focus) */
		onFocus?: () => void;
		/** Callback to exit man mode */
		onExitMan?: () => void;
		/**
		 * Callback for key events that should be handled by the parent.
		 * Used for prefix key in tmux mode.
		 */
		onKeyDown?: (event: KeyboardEvent) => void;
	};

	let {
		pane,
		isFocused,
		focusTrigger,
		onInputChange,
		onSubmit,
		onFocus,
		onExitMan,
		onKeyDown
	}: PaneViewProps = $props();

	// Refs
	let inputRef = $state<HTMLInputElement | null>(null);
	let historyRef = $state<HTMLDivElement | null>(null);
	let manpageRef = $state<HTMLDivElement | null>(null);

	// Derived
	const prompt = $derived(pane.mode === 'tmux' ? '%' : '$');
	const showInput = $derived(pane.mode !== 'man');
	const showHistory = $derived(pane.mode !== 'man');

	/**
	 * Scroll history to bottom.
	 */
	function scrollToBottom(): void {
		if (historyRef) {
			requestAnimationFrame(() => {
				if (historyRef) {
					historyRef.scrollTop = historyRef.scrollHeight;
				}
			});
		}
	}

	/**
	 * Handle input keydown.
	 */
	function handleInputKeyDown(event: KeyboardEvent): void {
		// Check for prefix key (Ctrl+B) in tmux mode
		// Must intercept this before it reaches browser default behavior
		if (pane.mode === 'tmux' && event.ctrlKey && event.key.toLowerCase() === 'b') {
			event.preventDefault();
			event.stopPropagation();
			if (onKeyDown) {
				onKeyDown(event);
			}
			return;
		}

		// Forward other key events to parent if in tmux mode (for prefix command handling)
		// But don't prevent default - allow normal typing
		if (pane.mode === 'tmux' && onKeyDown) {
			onKeyDown(event);
		}

		// Handle Enter to submit in any mode
		if (event.key === 'Enter') {
			event.preventDefault();
			if (onSubmit) {
				onSubmit(pane.inputValue);
			}
			return;
		}
	}

	/**
	 * Handle input change.
	 */
	function handleInput(event: Event): void {
		const target = event.target as HTMLInputElement;
		if (onInputChange) {
			onInputChange(target.value);
		}
	}

	/**
	 * Handle pane click for focus.
	 */
	function handleClick(): void {
		if (onFocus) {
			onFocus();
		}
		// Also directly focus the input
		if (pane.mode !== 'man') {
			inputRef?.focus();
		} else {
			manpageRef?.focus();
		}
	}

	/**
	 * Handle man page quit.
	 */
	function handleManQuit(): void {
		if (onExitMan) {
			onExitMan();
		}
	}

	/**
	 * Get CSS class for history entry type.
	 */
	function getEntryClass(entry: HistoryEntry): string {
		return `history-entry history-${entry.type}`;
	}

	/**
	 * Format entry content for display.
	 */
	function formatEntry(entry: HistoryEntry): string {
		if (entry.type === 'input') {
			// Use stored mode if available, otherwise default to '$' for default mode
			const modePrompt = entry.mode === 'tmux' ? '%' : '$';
			return `${modePrompt} ${entry.content}`;
		}
		return entry.content;
	}

	// Focus input when pane becomes focused or when focusTrigger changes
	// The focusTrigger is used to re-focus after commands that output info/errors
	// Uses requestAnimationFrame to ensure DOM is fully ready (especially for new panes)
	$effect(() => {
		// Read focusTrigger to establish dependency (even if not used directly)
		const _trigger = focusTrigger;
		
		if (isFocused && pane.mode !== 'man') {
			// Use requestAnimationFrame to ensure the input element is fully rendered
			requestAnimationFrame(() => {
				inputRef?.focus();
			});
		} else if (isFocused && pane.mode === 'man') {
			requestAnimationFrame(() => {
				manpageRef?.focus();
			});
		}
	});

	// Scroll to bottom when history changes
	$effect(() => {
		if (pane.history.length > 0) {
			scrollToBottom();
		}
	});

	/**
	 * Public method to focus the pane's input.
	 */
	export async function focus(): Promise<void> {
		await tick();
		if (pane.mode === 'man') {
			manpageRef?.focus();
		} else {
			inputRef?.focus();
		}
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="pane-view"
	class:focused={isFocused}
	class:man-mode={pane.mode === 'man'}
	onclick={handleClick}
>
	{#if pane.mode === 'man'}
		<Manpage
			onQuit={handleManQuit}
			bind:containerRef={manpageRef}
		/>
	{:else}
		<!-- History -->
		{#if showHistory}
			<div class="pane-history" bind:this={historyRef}>
				{#each pane.history as entry, idx (`${entry.timestamp}-${idx}`)}
					<div class={getEntryClass(entry)}>
						{formatEntry(entry)}
					</div>
				{/each}
			</div>
		{/if}

		<!-- Input Line -->
		{#if showInput}
			<div class="pane-input-line">
				<span class="pane-prompt">{prompt}</span>
				<input
					type="text"
					name="pane-input"
					class="pane-input"
					bind:this={inputRef}
					value={pane.inputValue}
					oninput={handleInput}
					onkeydown={handleInputKeyDown}
					autocomplete="off"
					autocorrect="off"
					autocapitalize="off"
					spellcheck="false"
				/>
			</div>
		{/if}
	{/if}
</div>

<style>
	.pane-view {
		display: flex;
		flex-direction: column;
		background: #1c1c1c;
		height: 100%;
		min-height: 0;
		overflow: hidden;
		position: relative;
		border: 1px solid #2d2d2d;
	}


	/* .pane-view.man-mode {
		border-color: #8be9fd;
	} */

	/* History */
	.pane-history {
		overflow-y: auto;
		padding: 8px 12px;
		font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', 'Menlo', monospace;
		font-size: 13px;
		line-height: 1.5;
	}

	.pane-history::-webkit-scrollbar {
		width: 6px;
	}

	.pane-history::-webkit-scrollbar-track {
		background: transparent;
	}

	.pane-history::-webkit-scrollbar-thumb {
		background: #3d3d3d;
		border-radius: 3px;
	}

	.history-entry {
		white-space: pre-wrap;
		word-break: break-word;
		color: #e0e0e0;
		min-height: 1.5em;
	}

	.history-input {
		color: #50fa7b;
	}

	.history-output {
		color: #e0e0e0;
	}

	.history-error {
		color: #ff5555;
	}

	.history-system {
		color: #8be9fd;
		font-style: italic;
	}

	/* Input Line */
	.pane-input-line {
		display: flex;
		align-items: center;
		padding: 8px 12px;
		background: #1a1a1a;
		flex-shrink: 0;
	}

	.pane-prompt {
		color: #50fa7b;
		font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', 'Menlo', monospace;
		font-size: 13px;
		font-weight: bold;
		margin-right: 8px;
		user-select: none;
	}

	.pane-input {
		flex: 1;
		background: transparent;
		border: none;
		outline: none;
		color: #e0e0e0;
		font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', 'Menlo', monospace;
		font-size: 13px;
		caret-color: #50fa7b;
	}

	.pane-input::placeholder {
		color: #4d4d4d;
	}

	/* Man mode fills entire pane */
	.pane-view.man-mode :global(.manpage-container) {
		position: relative;
		height: 100%;
	}
</style>

