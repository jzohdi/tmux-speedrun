<script lang="ts">
	import { tick } from 'svelte';
	import type { Pane, HistoryEntry } from '$lib/utils/pane-tree';
	import { isPrefixKey } from '$lib/data/keybindings';
	import { createCopySurface, getCopySurfaceSelectionRows } from '$lib/utils/tmux-copy-surface';
	import { getPaneOverlayText, type PaneOverlay } from '$lib/utils/tmux-overlay';
	import Manpage from '../Manpage.svelte';

	type PaneViewProps = {
		/** The pane data to render */
		pane: Pane;
		/** Whether this pane is currently focused */
		isFocused: boolean;
		/** Counter that increments when focus should be refreshed */
		focusTrigger?: number;
		/** Transient overlay state - if this pane has an entry, show it */
		paneOverlay?: PaneOverlay | null;
		/** Callback when input changes */
		onInputChange?: (value: string) => void;
		/** Callback when Enter is pressed in input */
		onSubmit?: (value: string) => void;
		/** Callback when the pane is clicked (for focus) */
		onFocus?: () => void;
		/** Callback to exit man mode */
		onExitMan?: () => void;
		/** Editor callbacks */
		onEditorInputChange?: (value: string) => void;
		onEditorEscape?: () => void;
		onEditorResumeInsert?: () => void;
		onEditorCommandChange?: (value: string) => void;
		onEditorCommandSubmit?: (value: string) => void;
		onCopyMouseDown?: (paneId: string, row: number, column: number) => void;
		onCopyMouseEnter?: (paneId: string, row: number, column: number) => void;
		onCopyMouseUp?: (paneId: string, row: number, column: number) => void;
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
		paneOverlay,
		onInputChange,
		onSubmit,
		onFocus,
		onExitMan,
		onEditorInputChange,
		onEditorEscape,
		onEditorResumeInsert,
		onEditorCommandChange,
		onEditorCommandSubmit,
		onCopyMouseDown,
		onCopyMouseEnter,
		onCopyMouseUp,
		onKeyDown
	}: PaneViewProps = $props();

	// Refs
	let inputRef = $state<HTMLInputElement | null>(null);
	let historyRef = $state<HTMLDivElement | null>(null);
	let manpageRef = $state<HTMLDivElement | null>(null);
	let editorRef = $state<HTMLTextAreaElement | null>(null);
	let editorCommandRef = $state<HTMLInputElement | null>(null);

	// Derived
	const prompt = $derived(pane.mode === 'tmux' ? '%' : '$');
	const showCopySurface = $derived(pane.copyState !== null && pane.mode === 'tmux');
	const showInput = $derived(
		pane.mode !== 'man' && pane.mode !== 'editor' && pane.copyState === null
	);
	const showHistory = $derived(
		pane.mode !== 'man' && pane.mode !== 'editor' && pane.copyState === null
	);
	const isEditorMode = $derived(pane.mode === 'editor');
	const editorState = $derived(pane.editorState);
	const copySurface = $derived(showCopySurface ? createCopySurface(pane) : null);
	const copySelectionRows = $derived.by(() => {
		if (!copySurface || !pane.copyState?.selectionAnchor) {
			return new Map();
		}

		return new Map(
			getCopySurfaceSelectionRows(
				copySurface,
				pane.copyState.selectionAnchor,
				pane.copyState.cursor
			).map((row) => [row.row, row])
		);
	});
	const overlayText = $derived(getPaneOverlayText(paneOverlay, pane.id));
	const showPaneOverlay = $derived(overlayText !== null);
	const overlayClassName = $derived(
		paneOverlay?.kind === 'pane-number'
			? 'pane-overlay pane-number-overlay'
			: 'pane-overlay clock-overlay'
	);

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
		// Check for the configured prefix key in tmux mode
		// Must intercept this before it reaches browser default behavior
		if (pane.mode === 'tmux' && isPrefixKey(event)) {
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
		if (pane.mode === 'editor') {
			editorRef?.focus();
		} else if (pane.copyState) {
			historyRef?.focus();
		} else if (pane.mode !== 'man') {
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

	function handleEditorInput(event: Event): void {
		const target = event.target as HTMLTextAreaElement;
		onEditorInputChange?.(target.value);
	}

	function handleEditorKeyDown(event: KeyboardEvent): void {
		if (!editorState?.insertMode) {
			event.preventDefault();
			return;
		}

		if (event.key === 'Escape') {
			event.preventDefault();
			onEditorEscape?.();
		}
	}

	function handleEditorNormalModeKeyDown(event: KeyboardEvent): void {
		if (editorState?.insertMode) {
			return;
		}

		if (event.key === 'i') {
			event.preventDefault();
			onEditorResumeInsert?.();
			return;
		}

		if (event.key === ':') {
			event.preventDefault();
			onEditorCommandChange?.('');
			requestAnimationFrame(() => {
				editorCommandRef?.focus();
			});
		}
	}

	function handleEditorCommandInput(event: Event): void {
		const target = event.target as HTMLInputElement;
		onEditorCommandChange?.(target.value);
	}

	function handleEditorCommandKeyDown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			event.preventDefault();
			onEditorCommandChange?.('');
			editorRef?.focus();
			return;
		}

		if (event.key === 'Enter') {
			event.preventDefault();
			onEditorCommandSubmit?.(editorState?.commandLine ?? '');
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

	function getCopyRowCells(text: string): Array<{ char: string; column: number }> {
		if (text.length === 0) {
			return [
				{
					char: ' ',
					column: 0
				}
			];
		}

		return Array.from(text).map((char, column) => ({
			char,
			column
		}));
	}

	function getCopyPointerPosition(event: MouseEvent): { row: number; column: number } | null {
		const rowElement = event.currentTarget as HTMLElement;
		const cellElement =
			event.target instanceof HTMLElement
				? event.target.closest<HTMLElement>('[data-copy-column]')
				: null;
		const row = Number(rowElement.dataset.copyRow);
		const column = Number(cellElement?.dataset.copyColumn);

		if (Number.isNaN(row) || Number.isNaN(column)) {
			return null;
		}

		return { row, column };
	}

	function handleCopyRowMouseDown(event: MouseEvent): void {
		event.preventDefault();
		const position = getCopyPointerPosition(event);

		if (!position) {
			return;
		}

		onCopyMouseDown?.(pane.id, position.row, position.column);
	}

	function handleCopyRowMouseMove(event: MouseEvent): void {
		const position = getCopyPointerPosition(event);

		if (!position) {
			return;
		}

		onCopyMouseEnter?.(pane.id, position.row, position.column);
	}

	function handleCopyRowMouseUp(event: MouseEvent): void {
		event.preventDefault();
		const position = getCopyPointerPosition(event);

		if (!position) {
			return;
		}

		onCopyMouseUp?.(pane.id, position.row, position.column);
	}

	// Focus input when pane becomes focused or when focusTrigger changes
	// The focusTrigger is used to re-focus after commands that output info/errors
	// Uses tick() to ensure DOM is updated, then focuses the appropriate element
	$effect(() => {
		// Read focusTrigger to establish dependency (even if not used directly)
		const _trigger = focusTrigger;
		// Also track isFocused to ensure effect runs when focus changes between panes
		const shouldFocus = isFocused;
		// Track pane.id and pane.mode to ensure proper dependency tracking
		const paneId = pane.id;
		const paneMode = pane.mode;

		console.debug(
			'[PaneView] Effect running - paneId:',
			paneId,
			'isFocused:',
			shouldFocus,
			'focusTrigger:',
			_trigger,
			'mode:',
			paneMode
		);

		if (shouldFocus && pane.copyState) {
			tick().then(() => {
				historyRef?.focus();
			});
		} else if (shouldFocus && paneMode !== 'man' && paneMode !== 'editor') {
			// Use tick() to wait for Svelte DOM updates, then focus
			tick().then(() => {
				console.debug(
					'[PaneView] Focusing input for pane:',
					paneId,
					'inputRef exists:',
					!!inputRef
				);
				if (inputRef) {
					inputRef.focus();
					console.debug('[PaneView] Focus called on input for pane:', paneId);
				} else {
					console.warn('[PaneView] inputRef is null for pane:', paneId);
				}
			});
		} else if (shouldFocus && paneMode === 'man') {
			tick().then(() => {
				manpageRef?.focus();
			});
		} else if (shouldFocus && paneMode === 'editor') {
			tick().then(() => {
				if (pane.editorState?.insertMode) {
					editorRef?.focus();
				} else if (pane.editorState?.commandLine !== '') {
					editorCommandRef?.focus();
				} else {
					editorRef?.focus();
				}
			});
		}
	});

	// Scroll to bottom when history changes
	$effect(() => {
		if (pane.history.length > 0) {
			scrollToBottom();
		}
	});

	$effect(() => {
		const cursorRow = pane.copyState?.cursor.row;

		if (cursorRow === undefined || !historyRef) {
			return;
		}

		tick().then(() => {
			const targetRow = historyRef?.querySelector<HTMLElement>(`[data-copy-row="${cursorRow}"]`);
			targetRow?.scrollIntoView({
				block: 'nearest'
			});
		});
	});

	/**
	 * Public method to focus the pane's input.
	 */
	export async function focus(): Promise<void> {
		await tick();
		if (pane.mode === 'man') {
			manpageRef?.focus();
		} else if (pane.mode === 'editor') {
			editorRef?.focus();
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
	<!-- Transient overlay (clock, pane numbers) -->
	{#if showPaneOverlay && overlayText}
		<div class={overlayClassName}>
			{overlayText}
		</div>
	{/if}

	{#if pane.mode === 'man'}
		<Manpage onQuit={handleManQuit} bind:containerRef={manpageRef} />
	{:else if isEditorMode && editorState}
		<div class="editor-shell" onkeydown={handleEditorNormalModeKeyDown}>
			<textarea
				class="editor-textarea"
				class:readonly={!editorState.insertMode}
				bind:this={editorRef}
				value={editorState.buffer}
				oninput={handleEditorInput}
				onkeydown={handleEditorKeyDown}
				readonly={!editorState.insertMode}
				spellcheck="false"
			></textarea>
			<div class="editor-status">
				<span class="editor-file">{editorState.filePath}</span>
				<span class="editor-mode">
					{editorState.insertMode ? '-- INSERT --' : '-- NORMAL --'}
				</span>
				<span class="editor-dirty">{editorState.isDirty ? '[+]' : ''}</span>
			</div>
			<div class="editor-command-line">
				<span class="editor-command-prefix">:</span>
				<input
					type="text"
					class="editor-command-input"
					bind:this={editorCommandRef}
					value={editorState.commandLine}
					oninput={handleEditorCommandInput}
					onkeydown={handleEditorCommandKeyDown}
					autocomplete="off"
					autocorrect="off"
					autocapitalize="off"
					spellcheck="false"
				/>
			</div>
		</div>
	{:else}
		{#if showCopySurface && copySurface && pane.copyState}
			<div class="copy-surface" bind:this={historyRef} tabindex="-1">
				{#each copySurface.rows as row (`copy-${row.index}`)}
					{@const isCursorRow = row.index === pane.copyState.cursor.row}
					{@const selectionRow = copySelectionRows.get(row.index)}
					<div
						class="copy-row"
						class:cursor-row={isCursorRow}
						data-copy-row={row.index}
						onmousedown={handleCopyRowMouseDown}
						onmousemove={handleCopyRowMouseMove}
						onmouseup={handleCopyRowMouseUp}
					>
						{#each getCopyRowCells(row.text) as cell (`${row.index}-${cell.column}`)}
							<span
								class="copy-cell"
								class:copy-selected={selectionRow !== undefined &&
									cell.column >= selectionRow.startColumn &&
									cell.column < selectionRow.endColumn}
								class:copy-cursor={isCursorRow && cell.column === pane.copyState.cursor.column}
								data-copy-column={cell.column}
							>
								{cell.char}
							</span>
						{/each}
					</div>
				{/each}
			</div>
		{/if}

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

	/* Shared transient pane overlay */
	.pane-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		justify-content: center;
		align-items: center;
		background: #1c1c1c;
		z-index: 10;
		font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', 'Menlo', monospace;
	}

	.clock-overlay {
		font-size: 1.7rem;
		font-weight: 500;
		color: #50fa7b;
	}

	.pane-number-overlay {
		font-size: 3.2rem;
		font-weight: 700;
		letter-spacing: 0.08em;
		color: #ffb86c;
		font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', 'Menlo', monospace;
		text-shadow: 0 0 18px rgba(255, 184, 108, 0.2);
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

	.copy-surface {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 8px 12px;
		font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', 'Menlo', monospace;
		font-size: 13px;
		line-height: 1.5;
		outline: none;
	}

	.copy-row {
		white-space: pre-wrap;
		word-break: break-word;
		color: #e0e0e0;
		min-height: 1.5em;
	}

	.copy-cell {
		white-space: pre;
	}

	.copy-selected {
		background: rgba(139, 233, 253, 0.25);
	}

	.copy-cursor {
		background: #f8f8f2;
		color: #1c1c1c;
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

	.editor-shell {
		display: flex;
		flex: 1;
		min-height: 0;
		flex-direction: column;
		background: #111;
	}

	.editor-textarea {
		flex: 1;
		min-height: 0;
		resize: none;
		border: none;
		outline: none;
		background: #111;
		color: #e0e0e0;
		padding: 12px;
		font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', 'Menlo', monospace;
		font-size: 13px;
		line-height: 1.5;
		caret-color: #50fa7b;
	}

	.editor-textarea.readonly {
		caret-color: transparent;
	}

	.editor-status,
	.editor-command-line {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 6px 10px;
		font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', 'Menlo', monospace;
		font-size: 12px;
	}

	.editor-status {
		background: #1a1a1a;
		color: #8be9fd;
		border-top: 1px solid #2d2d2d;
	}

	.editor-mode {
		color: #50fa7b;
	}

	.editor-dirty {
		margin-left: auto;
		color: #ffb86c;
	}

	.editor-command-line {
		background: #0d0d0d;
		color: #ffb86c;
		border-top: 1px solid #222;
	}

	.editor-command-prefix {
		font-weight: 700;
	}

	.editor-command-input {
		flex: 1;
		background: transparent;
		border: none;
		outline: none;
		color: inherit;
		font-family: inherit;
		font-size: inherit;
		caret-color: #ffb86c;
	}

	/* Man mode fills entire pane */
	.pane-view.man-mode :global(.manpage-container) {
		position: relative;
		height: 100%;
	}
</style>
