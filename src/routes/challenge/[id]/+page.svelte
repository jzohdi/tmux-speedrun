<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { ChallengeTerminal, type TmuxSignal } from '$lib/components/tmux';
	import PromptBox from '$lib/components/PromptBox.svelte';
	import { createChallengeStore } from '$lib/client/challenge-store.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Create challenge store
	const challenge = createChallengeStore();

	// Component refs
	let terminalRef = $state<ReturnType<typeof ChallengeTerminal> | null>(null);

	// Derived state for UI
	const statusMessage = $derived(getStatusMessage(challenge.status));
	const showInput = $derived(challenge.status === 'active');
	const progressPercent = $derived(
		challenge.totalSteps > 0 ? ((challenge.currentStepIndex + 1) / challenge.totalSteps) * 100 : 0
	);

	function getStatusMessage(status: string): string {
		switch (status) {
			case 'loading':
				return 'Starting challenge...';
			case 'submitting':
				return 'Submitting results...';
			case 'error':
				return challenge.error ?? 'An error occurred';
			default:
				return '';
		}
	}

	/**
	 * Handle signals from the terminal.
	 *
	 * The terminal emits structured signals including:
	 * - { type: 'command-executed', command: 'rename-window:my-name', commandName: 'rename-window' }
	 *   Recognized commands with:
	 *     - command: Full answer including input value for input commands
	 *     - commandName: Type-safe command ID (from CommandId)
	 * - { type: 'command', command: 'unknown-cmd' }
	 *   Unrecognized commands (raw string, not type-safe)
	 * - { type: 'tmux-entered' } when user types 'tmux'
	 */
	async function handleSignal(signal: TmuxSignal): Promise<void> {
		console.debug('[Signal] Received:', signal.type, signal);

		// Process recognized command signals for challenge verification
		if (signal.type === 'command-executed') {
			// Use signal.command which contains the full answer including input value
			// For simple commands: "split-vertical"
			// For input commands: "rename-window:swift-tiger-42"
			const answer = signal.command;
			console.debug(
				'[Signal] command-executed - answer:',
				answer,
				'commandName:',
				signal.commandName
			);

			if (!answer || challenge.status !== 'active') {
				console.debug('[Signal] Skipping - answer:', answer, 'status:', challenge.status);
				return;
			}

			// Submit the full command string for challenge verification
			// This includes the input value for commands that require it
			const wasCorrect = await challenge.submitAnswer(answer);
			console.debug('[Signal] Answer submitted, wasCorrect:', wasCorrect);

			// Clear input regardless of result
			terminalRef?.clearInput();

			// Focus terminal for next input
			if (challenge.status === 'active') {
				terminalRef?.focus();
			}
			return;
		}

		// Also handle raw 'command' signals for unrecognized commands
		// (These won't typically match challenge steps, but we process them for completeness)
		if (signal.type === 'command') {
			const command = signal.command;
			if (!command || challenge.status !== 'active') {
				return;
			}

			// Submit raw command (not type-safe, likely won't match)
			await challenge.submitAnswer(command);
			terminalRef?.clearInput();

			if (challenge.status === 'active') {
				terminalRef?.focus();
			}
		}
	}

	/**
	 * Handle returning to home page.
	 */
	function handleBackClick() {
		challenge.reset();
		goto('/');
	}

	/**
	 * Handle retry after error or completion.
	 */
	async function handleRetry() {
		challenge.reset();
		await challenge.start(data.challengeIndex);
		terminalRef?.focus();
	}

	// Start challenge on mount
	onMount(async () => {
		await challenge.start(data.challengeIndex);

		// Focus the terminal after a short delay to ensure DOM is ready
		// Use requestAnimationFrame to ensure the browser has rendered
		requestAnimationFrame(() => {
			terminalRef?.focus();
		});
	});

	onDestroy(() => {
		challenge.reset();
	});
</script>

<svelte:head>
	<title>Challenge {data.challengeIndex} | tmux-speedrun</title>
	<meta
		name="description"
		content="Complete tmux Challenge {data.challengeIndex}. Race against the clock and master tmux keybindings."
	/>

	<!-- Open Graph -->
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="tmux-speedrun" />
	<meta property="og:title" content="Challenge {data.challengeIndex} | tmux-speedrun" />
	<meta
		property="og:description"
		content="Complete tmux Challenge {data.challengeIndex}. Race against the clock and master tmux keybindings."
	/>
	<meta property="og:image" content="/og-image.png" />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />

	<!-- Twitter Card -->
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content="Challenge {data.challengeIndex} | tmux-speedrun" />
	<meta
		name="twitter:description"
		content="Complete tmux Challenge {data.challengeIndex}. Race against the clock and master tmux keybindings."
	/>
	<meta name="twitter:image" content="/og-image.png" />

	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<main class="challenge-page">
	<div class="bg-grid"></div>

	<div class="challenge-layout">
		<!-- Header -->
		<header class="challenge-header">
			<button class="back-link" onclick={handleBackClick}>← Back</button>
			<span class="challenge-label">Challenge {data.challengeIndex}</span>
			<span class="help-hint">
				<code>man tmux</code> for help
			</span>
			<span class="timer">{challenge.formattedTime}</span>
		</header>

		<!-- Progress Bar -->
		<div class="progress-container">
			<div class="progress-bar" style="width: {progressPercent}%"></div>
		</div>

		<!-- Status Messages -->
		{#if statusMessage}
			<div class="status-message" class:error={challenge.status === 'error'}>
				{statusMessage}
				{#if challenge.status === 'error'}
					<button class="retry-button" onclick={handleRetry}>Retry</button>
				{/if}
			</div>
		{/if}

		<!-- Feedback -->
		{#if challenge.lastFeedback}
			<div
				class="feedback"
				class:correct={challenge.lastFeedback.correct}
				class:incorrect={!challenge.lastFeedback.correct}
			>
				{challenge.lastFeedback.message}
			</div>
		{/if}

		<!-- Prompt Box -->
		{#if challenge.currentPrompt}
			<section class="prompt-section">
				<PromptBox
					prompt={challenge.currentPrompt}
					currentStep={challenge.currentStepIndex + 1}
					totalSteps={challenge.totalSteps}
				/>
			</section>
		{/if}

		<!-- Terminal -->
		<section class="terminal-section">
			<ChallengeTerminal
				bind:this={terminalRef}
				onSignal={handleSignal}
				disabled={!showInput}
				expectedInput={challenge.currentRequiredInput ?? undefined}
			/>
		</section>

		<!-- Completion Screen -->
		{#if challenge.status === 'complete' && challenge.result}
			<div class="completion-overlay">
				<div class="completion-card">
					<div class="completion-icon">🎉</div>
					<h2 class="completion-title">
						{challenge.result.valid ? 'Challenge Complete!' : 'Challenge Failed'}
					</h2>

					{#if challenge.result.valid}
						<div class="completion-stats">
							<div class="stat">
								<span class="stat-label">Time</span>
								<span class="stat-value">{challenge.formattedTime}</span>
							</div>
							{#if challenge.result.leaderboardPosition}
								<div class="stat">
									<span class="stat-label">Rank</span>
									<span class="stat-value">#{challenge.result.leaderboardPosition}</span>
								</div>
							{/if}
						</div>
					{:else}
						<p class="completion-message">{challenge.result.message}</p>
					{/if}

					<div class="completion-actions">
						<button class="action-button secondary" onclick={handleBackClick}>
							Back to Home
						</button>
						<button class="action-button primary" onclick={handleRetry}> Try Again </button>
					</div>
				</div>
			</div>
		{/if}
	</div>
</main>

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

	.challenge-page {
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

	.challenge-layout {
		position: relative;
		z-index: 1;
		max-width: 800px;
		margin: 0 auto;
		padding: 32px 24px;
		display: flex;
		flex-direction: column;
		gap: 20px;
	}

	.challenge-header {
		display: flex;
		align-items: center;
		gap: 24px;
	}

	.back-link {
		font-size: 14px;
		color: #50fa7b;
		background: transparent;
		border: none;
		cursor: pointer;
		font-family: 'JetBrains Mono', monospace;
		transition: opacity 0.2s ease;
		padding: 0;
	}

	.back-link:hover {
		opacity: 0.7;
	}

	.challenge-label {
		font-family: 'JetBrains Mono', monospace;
		font-size: 14px;
		font-weight: 500;
		color: #666;
	}

	.help-hint {
		margin-left: auto;
		font-size: 12px;
		color: #666;
	}

	.help-hint code {
		color: #8be9fd;
		background: rgba(139, 233, 253, 0.08);
		padding: 2px 6px;
		border-radius: 3px;
		font-family: 'JetBrains Mono', monospace;
	}

	.timer {
		font-family: 'JetBrains Mono', monospace;
		font-size: 18px;
		font-weight: 600;
		color: #50fa7b;
	}

	.progress-container {
		height: 4px;
		background: #2d2d2d;
		border-radius: 2px;
		overflow: hidden;
	}

	.progress-bar {
		height: 100%;
		background: linear-gradient(90deg, #50fa7b, #27ca40);
		transition: width 0.3s ease;
	}

	.status-message {
		padding: 12px 16px;
		background: rgba(139, 233, 253, 0.1);
		border-left: 3px solid #8be9fd;
		font-size: 14px;
		display: flex;
		align-items: center;
		gap: 16px;
	}

	.status-message.error {
		background: rgba(255, 85, 85, 0.1);
		border-left-color: #ff5555;
		color: #ff5555;
	}

	.retry-button {
		background: #ff5555;
		color: #fff;
		border: none;
		padding: 6px 12px;
		border-radius: 4px;
		font-size: 13px;
		cursor: pointer;
		font-family: inherit;
	}

	.retry-button:hover {
		background: #ff6e6e;
	}

	.feedback {
		padding: 12px 16px;
		font-size: 14px;
		font-weight: 500;
		text-align: center;
		border-radius: 4px;
		animation: fadeIn 0.2s ease;
	}

	.feedback.correct {
		background: rgba(80, 250, 123, 0.15);
		color: #50fa7b;
	}

	.feedback.incorrect {
		background: rgba(255, 85, 85, 0.15);
		color: #ff5555;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.terminal-section {
		height: 500px;
	}

	/* Completion Overlay */
	.completion-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.85);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 100;
		animation: fadeIn 0.3s ease;
	}

	.completion-card {
		background: #1c1c1c;
		border: 1px solid #3d3d3d;
		border-radius: 16px;
		padding: 48px;
		text-align: center;
		max-width: 400px;
		width: 90%;
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
		margin: 0 0 24px;
	}

	.completion-stats {
		display: flex;
		justify-content: center;
		gap: 48px;
		margin-bottom: 32px;
	}

	.stat {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.stat-label {
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		color: #666;
	}

	.stat-value {
		font-family: 'JetBrains Mono', monospace;
		font-size: 24px;
		font-weight: 600;
		color: #50fa7b;
	}

	.completion-message {
		color: #a0a0a0;
		margin-bottom: 32px;
	}

	.completion-actions {
		display: flex;
		gap: 12px;
		justify-content: center;
	}

	.action-button {
		padding: 12px 24px;
		border-radius: 8px;
		font-size: 14px;
		font-weight: 500;
		cursor: pointer;
		font-family: inherit;
		transition: all 0.2s ease;
	}

	.action-button.primary {
		background: #50fa7b;
		color: #0d0d0d;
		border: none;
	}

	.action-button.primary:hover {
		background: #69fb92;
	}

	.action-button.secondary {
		background: transparent;
		color: #a0a0a0;
		border: 1px solid #3d3d3d;
	}

	.action-button.secondary:hover {
		border-color: #50fa7b;
		color: #50fa7b;
	}

	@media (max-width: 640px) {
		.challenge-layout {
			padding: 20px 16px;
			gap: 16px;
		}

		.completion-card {
			padding: 32px 24px;
		}

		.completion-stats {
			gap: 32px;
		}
	}
</style>
