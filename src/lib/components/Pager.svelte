<script lang="ts">
	import type { Snippet } from 'svelte';

	type PagerProps = {
		onQuit: () => void;
		onToggleMaximize?: () => void;
		containerRef?: HTMLDivElement | null;
		ariaLabel: string;
		children: Snippet;
	};

	let {
		onQuit,
		onToggleMaximize,
		containerRef = $bindable(null),
		ariaLabel,
		children
	}: PagerProps = $props();

	let scrollContainer = $state<HTMLDivElement | null>(null);
	let containerElement = $state<HTMLDivElement | null>(null);
	let isFocused = $state(true); // Start focused since we auto-focus on mount
	const SCROLL_STEP = 24; // pixels per line (approx line height)

	// Sync containerElement to the bindable containerRef for parent access
	$effect(() => {
		containerRef = containerElement;
	});

	function scrollUp() {
		if (scrollContainer) {
			scrollContainer.scrollTop = Math.max(0, scrollContainer.scrollTop - SCROLL_STEP);
		}
	}

	function scrollDown() {
		if (scrollContainer) {
			const maxScroll = scrollContainer.scrollHeight - scrollContainer.clientHeight;
			scrollContainer.scrollTop = Math.min(maxScroll, scrollContainer.scrollTop + SCROLL_STEP);
		}
	}

	function scrollPageUp() {
		if (scrollContainer) {
			scrollContainer.scrollTop = Math.max(
				0,
				scrollContainer.scrollTop - scrollContainer.clientHeight
			);
		}
	}

	function scrollPageDown() {
		if (scrollContainer) {
			const maxScroll = scrollContainer.scrollHeight - scrollContainer.clientHeight;
			scrollContainer.scrollTop = Math.min(
				maxScroll,
				scrollContainer.scrollTop + scrollContainer.clientHeight
			);
		}
	}

	function scrollToTop() {
		if (scrollContainer) {
			scrollContainer.scrollTop = 0;
		}
	}

	function scrollToBottom() {
		if (scrollContainer) {
			scrollContainer.scrollTop = scrollContainer.scrollHeight - scrollContainer.clientHeight;
		}
	}

	function handleKeyDown(event: KeyboardEvent) {
		if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
			event.preventDefault();
			event.stopPropagation();
			if (onToggleMaximize) {
				onToggleMaximize();
			}
			return;
		}

		// Stop propagation to prevent parent Terminal from interfering
		event.stopPropagation();

		switch (event.key) {
			case 'ArrowUp':
			case 'k':
				event.preventDefault();
				scrollUp();
				break;
			case 'ArrowDown':
			case 'j':
				event.preventDefault();
				scrollDown();
				break;
			case 'PageUp':
			case 'b':
				event.preventDefault();
				scrollPageUp();
				break;
			case 'PageDown':
			case 'f':
			case ' ':
				event.preventDefault();
				scrollPageDown();
				break;
			case 'g':
				event.preventDefault();
				scrollToTop();
				break;
			case 'G':
				event.preventDefault();
				scrollToBottom();
				break;
			case 'q':
			case 'Escape':
				event.preventDefault();
				onQuit();
				break;
		}
	}

	function handleClick() {
		containerElement?.focus();
	}

	function handleFocus() {
		isFocused = true;
	}

	function handleBlur() {
		isFocused = false;
	}

	// Focus container on mount
	$effect(() => {
		if (containerElement) {
			// Use setTimeout to ensure focus happens after render cycle
			setTimeout(() => {
				containerElement?.focus();
			}, 0);
		}
	});
</script>

<!--
	The `manpage-container` / `manpage-content` class names are external API:
	PaneView.svelte overrides `:global(.manpage-container)` for the in-challenge
	pane-fill layout, and Terminal.browser.test.ts queries `.manpage-container`.
	Do not rename them.
-->
<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	class="manpage-container"
	bind:this={containerElement}
	onkeydown={handleKeyDown}
	onclick={handleClick}
	onfocus={handleFocus}
	onblur={handleBlur}
	tabindex="0"
	role="application"
	aria-label={ariaLabel}
>
	<div class="manpage-content" bind:this={scrollContainer}>
		{@render children()}

		<!-- Spacer to ensure content can scroll fully -->
		<div class="content-spacer"></div>
	</div>

	<!-- Status Bar -->
	<div class="status-bar">
		<span class="colon">:</span>
		<span class="cursor" class:visible={isFocused}></span>
	</div>
</div>

<style>
	.manpage-container {
		display: flex;
		flex-direction: column;
		background: #1c1c1c;
		color: #e0e0e0;
		font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', 'Menlo', monospace;
		font-size: 14px;
		line-height: 1.5;
		outline: none;
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		padding: 8px;
		overflow: hidden;
	}

	.manpage-content {
		flex: 1;
		overflow-y: auto;
		overflow-x: hidden;
		padding: 0 8px;
		/* Hide scrollbar but allow scrolling */
		scrollbar-width: none; /* Firefox */
		-ms-overflow-style: none; /* IE/Edge */
	}

	.manpage-content::-webkit-scrollbar {
		display: none; /* Chrome/Safari/Opera */
	}

	.content-spacer {
		height: 100px;
	}

	.status-bar {
		display: flex;
		align-items: center;
		padding: 0 8px;
		height: 24px;
		background: #1c1c1c;
		border-top: none;
		flex-shrink: 0;
	}

	.colon {
		color: #e0e0e0;
	}

	.cursor {
		display: inline-block;
		width: 8px;
		height: 18px;
		background: transparent;
		vertical-align: middle;
		margin-left: 1px;
	}

	.cursor.visible {
		background: #e0e0e0;
		animation: blink 1s step-end infinite;
	}

	@keyframes blink {
		0%,
		50% {
			opacity: 1;
		}
		50.01%,
		100% {
			opacity: 0;
		}
	}

	/* Responsive */
	@media (max-width: 640px) {
		.manpage-container {
			font-size: 12px;
		}
	}
</style>
