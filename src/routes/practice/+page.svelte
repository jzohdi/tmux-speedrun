<script lang="ts">
	import { ChallengeTerminal, type TmuxSignal } from '$lib/components/tmux';
	import { onMount, tick } from 'svelte';
	import {
		getCommandsWithPrefixKeybindings,
		getKeybindingsForCommand,
		getKeybindingsForCopyModeAction,
		getPrefixKeyDisplay,
		type Keybinding
	} from '$lib/data/keybindings';
	import {
		createPracticeItems,
		shouldPreserveTerminalInputOnStepCompletion,
		type PracticeItem
	} from '$lib/data/practice-flow';
	import { tmuxConfigStore } from '$lib/stores/tmux-config.svelte';

	// Component ref
	let terminalRef = $state<ReturnType<typeof ChallengeTerminal> | null>(null);

	const configRevision = $derived(tmuxConfigStore.revision);
	const practiceItems = $derived.by(() => {
		configRevision;

		return createPracticeItems(getCommandsWithPrefixKeybindings());
	});

	// Mode: sequential or random
	let isRandomMode = $state(false);

	// Current practice queue
	let practiceQueue = $state<PracticeItem[]>([]);
	let currentIndex = $state(0);
	let currentStepIndex = $state(0);
	let completedCount = $state(0);
	let skippedCount = $state(0);
	let lastSeededItemKey = $state<string | null>(null);

	// Feedback state
	let feedbackState = $state<{ type: 'correct' | 'incorrect' | 'skipped'; message: string } | null>(
		null
	);
	let feedbackTimeout: ReturnType<typeof setTimeout> | null = null;

	// Derived state
	const currentItem = $derived(practiceQueue[currentIndex] ?? null);
	const currentStep = $derived(currentItem?.steps[currentStepIndex] ?? null);
	const currentKeybindings = $derived.by(() => {
		configRevision;
		if (!currentStep) {
			return [];
		}

		if (currentStep.kind === 'command') {
			return getKeybindingsForCommand(currentStep.commandName);
		}

		return getKeybindingsForCopyModeAction(currentStep.action);
	});
	const currentStepContextLabel = $derived(
		currentStep?.kind === 'copy-mode-action' ? 'copy mode' : 'prefix'
	);
	const prefixKey = $derived.by(() => {
		configRevision;

		return getPrefixKeyDisplay();
	});
	const isComplete = $derived(
		!isRandomMode && currentIndex >= practiceQueue.length && practiceQueue.length > 0
	);
	const progressPercent = $derived(
		practiceQueue.length > 0 ? (completedCount / practiceQueue.length) * 100 : 0
	);

	/**
	 * Initialize or reset the command queue.
	 */
	function initializeQueue(): void {
		if (isRandomMode) {
			practiceQueue = [...practiceItems];
			currentIndex = getRandomIndex(practiceQueue.length);
		} else {
			practiceQueue = shuffleArray([...practiceItems]);
			currentIndex = 0;
		}
		currentStepIndex = 0;
		completedCount = 0;
		skippedCount = 0;
		feedbackState = null;
		lastSeededItemKey = null;
	}

	/**
	 * Get a random index from 0 to max-1.
	 */
	function getRandomIndex(max: number): number {
		return Math.floor(Math.random() * max);
	}

	/**
	 * Shuffle an array using Fisher-Yates algorithm.
	 */
	function shuffleArray<T>(array: T[]): T[] {
		const shuffled = [...array];
		for (let i = shuffled.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
		}
		return shuffled;
	}

	/**
	 * Move to the next practice item.
	 */
	function nextItem(): void {
		currentStepIndex = 0;
		lastSeededItemKey = null;

		if (isRandomMode) {
			currentIndex = getRandomIndex(practiceQueue.length);
		} else {
			currentIndex++;
		}
	}

	/**
	 * Show feedback message.
	 */
	function showFeedback(type: 'correct' | 'incorrect' | 'skipped', message: string): void {
		if (feedbackTimeout) {
			clearTimeout(feedbackTimeout);
		}
		feedbackState = { type, message };
		feedbackTimeout = setTimeout(() => {
			feedbackState = null;
		}, 1500);
	}

	/**
	 * Clean up terminal state after completing or skipping an item.
	 */
	function cleanupCurrentItem(options: { clearInput?: boolean } = {}): void {
		const { clearInput = true } = options;
		terminalRef?.getStore().exitCopyMode();
		if (clearInput) {
			terminalRef?.clearInput();
		}
		terminalRef?.focus();
	}

	function advanceCurrentItem(): void {
		if (!currentItem || !currentStep) {
			return;
		}

		if (currentStepIndex + 1 < currentItem.steps.length) {
			currentStepIndex++;
			showFeedback('correct', 'Correct!');
			terminalRef?.focus();
			return;
		}

		completedCount++;
		showFeedback('correct', 'Correct!');
		cleanupCurrentItem({
			clearInput: !shouldPreserveTerminalInputOnStepCompletion(currentItem, currentStep)
		});
		nextItem();
	}

	/**
	 * Skip the current practice item.
	 */
	function skipCommand(): void {
		if (!currentItem || isComplete) {
			return;
		}

		skippedCount++;
		showFeedback('skipped', `Skipped: ${currentItem.title}`);
		cleanupCurrentItem();
		nextItem();
	}

	function isCurrentStepMatch(signal: TmuxSignal): boolean {
		if (!currentStep) {
			return false;
		}

		if (currentStep.kind === 'command') {
			if (signal.type === 'command-executed' && signal.commandName === currentStep.commandName) {
				return true;
			}

			return signal.type === 'practice-step' && signal.command === currentStep.commandName;
		}

		return signal.type === 'practice-step' && signal.command === currentStep.action;
	}

	/**
	 * Handle signals from the terminal.
	 */
	function handleSignal(signal: TmuxSignal): void {
		if (!currentItem || !currentStep) {
			return;
		}

		if (signal.type !== 'command-executed' && signal.type !== 'practice-step') {
			return;
		}

		if (isCurrentStepMatch(signal)) {
			advanceCurrentItem();
			return;
		}

		showFeedback('incorrect', `Expected: ${currentStep.prompt}`);
	}

	/**
	 * Handle keyboard shortcuts for the practice page.
	 */
	function handleKeydown(event: KeyboardEvent): void {
		if (terminalRef?.getStore().focusedPane?.copyState) {
			return;
		}

		if (event.key === 'Escape' && !isComplete) {
			skipCommand();
		}
	}

	/**
	 * Toggle between random and sequential modes.
	 */
	function toggleMode(): void {
		isRandomMode = !isRandomMode;
		initializeQueue();
	}

	/**
	 * Reset and restart practice.
	 */
	function resetPractice(): void {
		initializeQueue();
		terminalRef?.reset();
	}

	/**
	 * Format keybinding for display.
	 */
	function formatKeybinding(binding: Keybinding): string {
		if (binding.keyDisplay.includes('+')) {
			return binding.keyDisplay;
		}

		const parts: string[] = [];

		if (binding.withCtrl) {
			parts.push('Ctrl');
		}
		if (binding.withAltOrMeta) {
			parts.push('Meta');
		}
		if (binding.withShift) {
			parts.push('Shift');
		}
		parts.push(binding.keyDisplay);

		return parts.join('+');
	}

	/**
	 * Get all keybindings formatted as a display string.
	 */
	function getKeybindingsDisplay(bindings: Keybinding[]): string[] {
		// Deduplicate similar keybindings (e.g., all arrow keys for select-pane)
		const uniqueBindings = new Map<string, Keybinding>();
		for (const binding of bindings) {
			// For arrow-based commands, just show one representative
			if (binding.key.startsWith('Arrow')) {
				const baseKey = binding.withCtrl
					? 'Ctrl+Arrow'
					: binding.withAltOrMeta
						? 'Alt+Arrow'
						: 'Arrow';
				if (!uniqueBindings.has(baseKey)) {
					uniqueBindings.set(baseKey, binding);
				}
			} else if (/^[0-9]$/.exec(binding.key)) {
				// For number keys (select-window), show range
				if (!uniqueBindings.has('0-9')) {
					uniqueBindings.set('0-9', binding);
				}
			} else {
				uniqueBindings.set(binding.key, binding);
			}
		}

		return Array.from(uniqueBindings.values()).map((b) => {
			// Handle special display cases
			if (b.key.startsWith('Arrow')) {
				if (b.withCtrl) {
					return 'Ctrl+↑↓←→';
				}
				if (b.withAltOrMeta) {
					return 'Alt+↑↓←→';
				}
				return '↑↓←→';
			}
			if (/^[0-9]$/.exec(b.key)) {
				return '0-9';
			}
			return formatKeybinding(b);
		});
	}

	$effect(() => {
		const item = currentItem;
		const step = currentStep;
		const terminal = terminalRef;

		if (!item?.seedInput || !step || step.kind !== 'command' || step.commandName !== 'copy-mode' || !terminal) {
			return;
		}

		const seedKey = `${currentIndex}:${item.id}`;
		if (lastSeededItemKey === seedKey) {
			return;
		}

		lastSeededItemKey = seedKey;
		requestAnimationFrame(() => {
			terminal.getStore().setInput(item.seedInput ?? '');
			terminal.focus();
		});
	});

	// Initialize on mount
	onMount(async () => {
		initializeQueue();
		await tick();
		terminalRef?.focus();
	});
</script>

<svelte:head>
	<title>Practice | tmux-speedrun</title>
	<meta
		name="description"
		content="Learn tmux keybindings step by step. Practice mode guides you through all tmux commands with hints."
	/>

	<!-- Open Graph -->
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="tmux-speedrun" />
	<meta property="og:title" content="Practice | tmux-speedrun" />
	<meta
		property="og:description"
		content="Learn tmux keybindings step by step. Practice mode guides you through all tmux commands with hints."
	/>
	<meta property="og:image" content="/og-image.png" />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />

	<!-- Twitter Card -->
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content="Practice | tmux-speedrun" />
	<meta
		name="twitter:description"
		content="Learn tmux keybindings step by step. Practice mode guides you through all tmux commands with hints."
	/>
	<meta name="twitter:image" content="/og-image.png" />

	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<svelte:window onkeydown={handleKeydown} />

<main class="practice-page">
	<div class="bg-grid"></div>

	<div class="page-layout">
		<!-- Header -->
		<header class="page-header">
			<a href="/" class="back-link">← Back</a>
			<h1 class="page-title">Practice</h1>
			<span class="page-subtitle">Learn tmux keybindings</span>
			<a href="/tmux-conf" class="config-link">tmux.conf</a>
		</header>

		<!-- Mode Toggle & Controls -->
		<div class="controls-bar">
			<div class="mode-toggle">
				<button
					class="mode-btn"
					class:active={!isRandomMode}
					onclick={() => {
						if (isRandomMode) {
							toggleMode();
						}
					}}
				>
					Sequential
				</button>
				<button
					class="mode-btn"
					class:active={isRandomMode}
					onclick={() => {
						if (!isRandomMode) {
							toggleMode();
						}
					}}
				>
					Random
				</button>
			</div>

			<button class="reset-btn" onclick={resetPractice}>
				<span class="reset-icon">↺</span>
				Reset
			</button>
		</div>

		<!-- Progress Bar (only in sequential mode) -->
		{#if !isRandomMode}
			<div class="progress-container">
				<div class="progress-bar" style="width: {progressPercent}%"></div>
				<span class="progress-text">
					{completedCount} / {practiceQueue.length}
					{#if skippedCount > 0}
						<span class="skipped-indicator">· {skippedCount} skipped</span>
					{/if}
				</span>
			</div>
		{/if}

		<!-- Command Card -->
		{#if currentItem && currentStep && !isComplete}
			<section class="command-card">
				<div class="command-row">
					<div class="command-info">
						<span class="command-category">{currentItem.category}</span>
						<h2 class="command-name">{currentItem.title}</h2>
						<p class="command-description">
							{currentItem.description}{#if currentItem.requiresInput}<span
									class="input-badge">+ input</span
								>{/if}
						</p>
						{#if currentItem.steps.length > 1}
							<div class="step-guide">
								<span class="step-counter">
									step {currentStepIndex + 1} / {currentItem.steps.length}
								</span>
								<p class="step-prompt">{currentStep.prompt}</p>
							</div>
						{/if}
					</div>
					<div class="keybinding-area">
						<div class="keys-row">
							{#if currentStep.kind === 'command'}
								<div class="key-group">
									<kbd class="key prefix-key">{prefixKey}</kbd>
									<span class="key-label">prefix</span>
								</div>
								<span class="key-arrow">→</span>
							{:else}
								<div class="key-group">
									<span class="key-mode-label">{currentStepContextLabel}</span>
								</div>
							{/if}
							{#each getKeybindingsDisplay(currentKeybindings) as keyDisplay, i}
								{#if i > 0}<span class="key-divider">/</span>{/if}
								<kbd class="key command-key">{keyDisplay}</kbd>
							{/each}
						</div>
						<button class="skip-btn" onclick={skipCommand}>
							skip <kbd class="skip-shortcut">esc</kbd>
						</button>
					</div>
				</div>
			</section>
		{:else if isComplete}
			<section class="completion-card">
				<div class="completion-icon">🎉</div>
				<h2 class="completion-title">Practice Complete!</h2>
				<p class="completion-message">
					You've practiced all {practiceItems.length} practice lessons.
				</p>
				<button class="action-btn" onclick={resetPractice}>Practice Again</button>
			</section>
		{/if}

		<!-- Help Text -->
		<div class="help-text">
			<p>
				<strong>Tip: After leaving a tmux session, </strong> Type <code>tmux</code> to enter tmux
				mode, or edit
				<a href="/tmux-conf">tmux.conf</a> to practice your custom bindings.
			</p>
		</div>

		<!-- Terminal Section -->
		<section class="terminal-section">
			<ChallengeTerminal bind:this={terminalRef} onSignal={handleSignal} disabled={false} />
		</section>
	</div>
</main>

<!-- Toast Notification -->
{#if feedbackState}
	<div
		class="toast"
		class:correct={feedbackState.type === 'correct'}
		class:incorrect={feedbackState.type === 'incorrect'}
		class:skipped={feedbackState.type === 'skipped'}
	>
		{feedbackState.message}
	</div>
{/if}

<style>
	:global(body) {
		margin: 0;
		padding: 0;
		background: #0d0d0d;
		color: #e0e0e0;
		font-family:
			'Space Grotesk',
			-apple-system,
			BlinkMacSystemFont,
			'Segoe UI',
			sans-serif;
	}

	.practice-page {
		min-height: 100vh;
		position: relative;
	}

	.bg-grid {
		position: fixed;
		inset: 0;
		background-image:
			linear-gradient(rgba(50, 255, 150, 0.02) 1px, transparent 1px),
			linear-gradient(90deg, rgba(50, 255, 150, 0.02) 1px, transparent 1px);
		background-size: 60px 60px;
		pointer-events: none;
		z-index: 0;
	}

	.page-layout {
		position: relative;
		z-index: 1;
		max-width: 900px;
		margin: 0 auto;
		padding: 32px 24px;
		display: flex;
		flex-direction: column;
		gap: 20px;
	}

	.page-header {
		display: flex;
		align-items: center;
		gap: 24px;
	}

	.back-link {
		font-size: 14px;
		color: #50fa7b;
		text-decoration: none;
		font-family: 'JetBrains Mono', monospace;
		transition: opacity 0.2s ease;
	}

	.back-link:hover {
		opacity: 0.7;
	}

	.page-title {
		font-family: 'JetBrains Mono', monospace;
		font-size: 24px;
		font-weight: 600;
		color: #ffffff;
		margin: 0;
	}

	.page-subtitle {
		font-size: 14px;
		color: #666;
	}

	.config-link {
		margin-left: auto;
		font-size: 13px;
		color: #8be9fd;
		text-decoration: none;
		font-family: 'JetBrains Mono', monospace;
	}

	/* Controls Bar */
	.controls-bar {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 16px;
	}

	.mode-toggle {
		display: flex;
		background: #1a1a1a;
		border: 1px solid #2d2d2d;
		border-radius: 8px;
		overflow: hidden;
	}

	.mode-btn {
		padding: 10px 20px;
		background: transparent;
		border: none;
		color: #666;
		font-family: 'JetBrains Mono', monospace;
		font-size: 13px;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.mode-btn:hover {
		color: #a0a0a0;
	}

	.mode-btn.active {
		background: #50fa7b;
		color: #0d0d0d;
		font-weight: 600;
	}

	.reset-btn {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 10px 16px;
		background: #2d2d2d;
		border: 1px solid #3d3d3d;
		border-radius: 6px;
		color: #a0a0a0;
		font-family: 'JetBrains Mono', monospace;
		font-size: 13px;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.reset-btn:hover {
		background: #3d3d3d;
		color: #e0e0e0;
	}

	.reset-icon {
		font-size: 16px;
	}

	/* Progress Bar */
	.progress-container {
		position: relative;
		height: 24px;
		background: #1a1a1a;
		border: 1px solid #2d2d2d;
		border-radius: 12px;
		overflow: hidden;
	}

	.progress-bar {
		height: 100%;
		background: linear-gradient(90deg, #50fa7b, #27ca40);
		transition: width 0.3s ease;
	}

	.progress-text {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 4px;
		font-family: 'JetBrains Mono', monospace;
		font-size: 12px;
		font-weight: 600;
		color: #ffffff;
		text-shadow: 0 1px 2px rgba(0, 0, 0, 0.5);
	}

	.skipped-indicator {
		font-weight: 400;
		color: #ffb86c;
		opacity: 0.9;
	}

	/* Toast Notification */
	.toast {
		position: fixed;
		top: 24px;
		left: 50%;
		transform: translateX(-50%);
		padding: 10px 20px;
		font-family: 'JetBrains Mono', monospace;
		font-size: 13px;
		font-weight: 600;
		text-align: center;
		border-radius: 6px;
		z-index: 1000;
		animation: toastIn 0.25s ease-out;
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
	}

	.toast.correct {
		background: rgba(13, 13, 13, 0.95);
		border: 1px solid #50fa7b;
		color: #50fa7b;
	}

	.toast.incorrect {
		background: rgba(13, 13, 13, 0.95);
		border: 1px solid #ff5555;
		color: #ff5555;
	}

	.toast.skipped {
		background: rgba(13, 13, 13, 0.95);
		border: 1px solid #ffb86c;
		color: #ffb86c;
	}

	@keyframes toastIn {
		from {
			opacity: 0;
			transform: translateX(-50%) translateY(-10px);
		}
		to {
			opacity: 1;
			transform: translateX(-50%) translateY(0);
		}
	}

	/* Command Card */
	.command-card {
		background: linear-gradient(135deg, #161616 0%, #1a1a1a 100%);
		border: 1px solid #252525;
		border-radius: 10px;
		padding: 18px 22px;
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
	}

	.command-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 24px;
	}

	.command-info {
		flex: 1;
		min-width: 0;
	}

	.command-category {
		font-size: 10px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 1.2px;
		color: #8be9fd;
		opacity: 0.8;
	}

	.command-name {
		font-family: 'JetBrains Mono', monospace;
		font-size: 22px;
		font-weight: 700;
		color: #ffffff;
		margin: 4px 0 6px;
		letter-spacing: -0.3px;
	}

	.command-description {
		font-size: 13px;
		color: #888;
		line-height: 1.4;
		margin: 0;
	}

	.input-badge {
		display: inline-block;
		margin-left: 8px;
		padding: 2px 6px;
		background: rgba(255, 184, 108, 0.15);
		border-radius: 4px;
		font-size: 10px;
		font-weight: 600;
		color: #ffb86c;
		vertical-align: middle;
	}

	.step-guide {
		margin-top: 14px;
		padding-top: 12px;
		border-top: 1px solid rgba(255, 255, 255, 0.06);
	}

	.step-counter {
		display: inline-block;
		font-family: 'JetBrains Mono', monospace;
		font-size: 11px;
		font-weight: 600;
		color: #8be9fd;
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}

	.step-prompt {
		margin: 8px 0 0;
		font-size: 14px;
		line-height: 1.45;
		color: #d8d8d8;
	}

	.keybinding-area {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 10px;
	}

	.keys-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.key-group {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
	}

	.key {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 38px;
		height: 32px;
		padding: 0 10px;
		background: #222;
		border: 1px solid #333;
		border-radius: 5px;
		font-family: 'JetBrains Mono', monospace;
		font-size: 13px;
		font-weight: 600;
		color: #fff;
		box-shadow: 0 2px 0 #111;
	}

	.key.prefix-key {
		background: linear-gradient(180deg, #1a3d2a 0%, #142a1f 100%);
		border-color: #50fa7b44;
		color: #50fa7b;
	}

	.key-label {
		position: absolute;
		top: 100%;
		left: 50%;
		transform: translateX(-50%);
		margin-top: 3px;
		font-size: 9px;
		color: #50fa7b;
		opacity: 0.7;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		white-space: nowrap;
	}

	.key-mode-label {
		font-size: 10px;
		color: #8be9fd;
		opacity: 0.8;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		white-space: nowrap;
	}

	.key.command-key {
		background: linear-gradient(180deg, #1a2d3d 0%, #141f2a 100%);
		border-color: #8be9fd44;
		color: #8be9fd;
	}

	.key-arrow {
		font-size: 14px;
		color: #555;
	}

	.key-divider {
		font-size: 12px;
		color: #555;
		font-weight: 300;
	}

	/* Skip Button */
	.skip-btn {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 5px 10px;
		background: transparent;
		border: 1px solid #333;
		border-radius: 5px;
		font-family: 'JetBrains Mono', monospace;
		font-size: 10px;
		color: #555;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.skip-btn:hover {
		background: rgba(255, 184, 108, 0.08);
		border-color: #ffb86c55;
		color: #ffb86c;
	}

	.skip-btn:hover .skip-shortcut {
		border-color: #ffb86c55;
		color: #ffb86c;
	}

	.skip-shortcut {
		padding: 2px 4px;
		background: #1a1a1a;
		border: 1px solid #333;
		border-radius: 3px;
		font-size: 8px;
		font-weight: 600;
		color: #444;
		transition: all 0.15s ease;
	}

	/* Completion Card */
	.completion-card {
		text-align: center;
		background: #1a1a1a;
		border: 1px solid #2d2d2d;
		border-radius: 12px;
		padding: 48px 24px;
	}

	.completion-icon {
		font-size: 64px;
		margin-bottom: 16px;
	}

	.completion-title {
		font-family: 'Space Grotesk', sans-serif;
		font-size: 28px;
		font-weight: 600;
		color: #ffffff;
		margin: 0 0 12px;
	}

	.completion-message {
		font-size: 15px;
		color: #a0a0a0;
		margin: 0 0 24px;
	}

	.action-btn {
		padding: 14px 28px;
		background: #50fa7b;
		border: none;
		border-radius: 8px;
		font-family: 'JetBrains Mono', monospace;
		font-size: 14px;
		font-weight: 600;
		color: #0d0d0d;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.action-btn:hover {
		background: #69fb92;
		transform: translateY(-2px);
	}

	/* Terminal Section */
	.terminal-section {
		height: 400px;
	}

	/* Help Text */
	.help-text {
		padding: 16px;
		background: rgba(139, 233, 253, 0.05);
		border-left: 3px solid #8be9fd;
		border-radius: 0 8px 8px 0;
		font-size: 13px;
		color: #a0a0a0;
	}

	.help-text p {
		margin: 0;
		line-height: 1.6;
	}

	.help-text code {
		font-family: 'JetBrains Mono', monospace;
		background: rgba(139, 233, 253, 0.1);
		padding: 2px 6px;
		border-radius: 3px;
		color: #8be9fd;
	}

	.help-text a {
		color: #50fa7b;
	}

	/* Responsive */
	@media (max-width: 640px) {
		.page-layout {
			padding: 20px 16px;
			gap: 16px;
		}

		.page-header {
			flex-wrap: wrap;
			gap: 12px;
		}

		.page-title {
			font-size: 20px;
		}

		.controls-bar {
			flex-direction: column;
			align-items: stretch;
		}

		.mode-toggle {
			width: 100%;
		}

		.mode-btn {
			flex: 1;
		}

		.command-name {
			font-size: 18px;
		}

		.command-row {
			flex-direction: column;
			align-items: stretch;
			gap: 14px;
		}

		.keybinding-area {
			align-items: flex-start;
		}

		.terminal-section {
			height: 350px;
		}
	}
</style>
