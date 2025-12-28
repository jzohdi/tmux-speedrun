<script lang="ts">
	type Props = {
		/** The instruction/prompt text to display */
		prompt: string;
		/** Current step number (0-based) */
		currentStep?: number;
		/** Total steps */
		totalSteps?: number;
	};

	let { prompt, currentStep, totalSteps }: Props = $props();

	const hasProgress = $derived(
		typeof currentStep === 'number' && typeof totalSteps === 'number'
	);
</script>

<div class="prompt-box">
	{#if hasProgress}
		<div class="step-indicator">
			{currentStep} / {totalSteps}
		</div>
	{/if}

	<p class="prompt-text">{prompt}</p>
</div>

<style>
	.prompt-box {
		display: flex;
		align-items: center;
		gap: 24px;
		padding: 24px 32px;
		background: #151515;
		border-left: 3px solid #50fa7b;
	}

	.step-indicator {
		font-family: 'JetBrains Mono', monospace;
		font-size: 13px;
		font-weight: 500;
		color: #666;
		white-space: nowrap;
		min-width: 48px;
	}

	.prompt-text {
		margin: 0;
		font-family: 'Space Grotesk', sans-serif;
		font-size: 22px;
		font-weight: 500;
		line-height: 1.4;
		color: #ffffff;
		letter-spacing: -0.01em;
	}
</style>
