<script lang="ts">
	import { COMMAND_CATEGORIES, getCommandsByCategory } from '$lib/data/tmux-commands';

	type ManpageProps = {
		onQuit: () => void;
		containerRef?: HTMLDivElement | null;
	};

	let { onQuit, containerRef = $bindable(null) }: ManpageProps = $props();

	let scrollContainer = $state<HTMLDivElement | null>(null);
	let containerElement = $state<HTMLDivElement | null>(null);
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
			scrollContainer.scrollTop = Math.max(0, scrollContainer.scrollTop - scrollContainer.clientHeight);
		}
	}

	function scrollPageDown() {
		if (scrollContainer) {
			const maxScroll = scrollContainer.scrollHeight - scrollContainer.clientHeight;
			scrollContainer.scrollTop = Math.min(maxScroll, scrollContainer.scrollTop + scrollContainer.clientHeight);
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

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	class="manpage-container"
	bind:this={containerElement}
	onkeydown={handleKeyDown}
	onclick={handleClick}
	tabindex="0"
	role="application"
	aria-label="Manual page viewer - use arrow keys or j/k to scroll, q to quit"
>
	<div class="manpage-content" bind:this={scrollContainer}>
		<!-- Header -->
		<div class="manpage-header">
			<span>TMUX(1)</span>
			<span>General Commands Manual</span>
			<span>TMUX(1)</span>
		</div>

		<!-- NAME Section -->
		<section class="manpage-section">
			<h2 class="section-title">NAME</h2>
			<p class="section-body indented">
				<span class="bold">tmux</span> – terminal multiplexer
			</p>
		</section>

		<!-- SYNOPSIS Section -->
		<section class="manpage-section">
			<h2 class="section-title">SYNOPSIS</h2>
			<p class="section-body indented">
				<span class="bold">tmux</span> [<span class="bold">-2CDhlNuVv</span>] [<span class="bold">-c</span> <span class="underline">shell-command</span>] [<span class="bold">-f</span> <span class="underline">file</span>] [<span class="bold">-L</span> <span class="underline">socket-name</span>] [<span class="bold">-S</span> <span class="underline">socket-path</span>]
			</p>
			<p class="section-body indented continued">
				[<span class="bold">-T</span> <span class="underline">features</span>] [<span class="underline">command</span> [<span class="underline">flags</span>]]
			</p>
		</section>

		<!-- DESCRIPTION Section -->
		<section class="manpage-section">
			<h2 class="section-title">DESCRIPTION</h2>
			<p class="section-body indented">
				<span class="bold">tmux</span> is a terminal multiplexer: it enables a number of terminals to be created, accessed, and controlled from a single screen. <span class="bold">tmux</span> may be detached from a screen and continue running in the background, then later reattached.
			</p>
			<p class="section-body indented">
				When <span class="bold">tmux</span> is started, it creates a new <span class="underline">session</span> with a single <span class="underline">window</span> and displays it on screen. A status line at the bottom of the screen shows information on the current session and is used to enter interactive commands.
			</p>
			<p class="section-body indented">
				A session is a single collection of <span class="underline">pseudo terminals</span> under the management of <span class="bold">tmux</span>. Each session has one or more windows linked to it. A window occupies the entire screen and may be split into rectangular panes, each of which is a separate pseudo terminal (the pty(4) manual page documents the technical details of pseudo terminals). Any number of <span class="bold">tmux</span> instances may connect to the same session, and any number of windows may be present in the same session. Once all sessions are killed, <span class="bold">tmux</span> exits.
			</p>
			<p class="section-body indented">
				Each session is persistent and will survive accidental disconnection (such as ssh(1) connection timeout) or intentional detaching (with the 'C-b d' key strokes). <span class="bold">tmux</span> may be reattached using:
			</p>
			<p class="section-body indented-more">
				$ tmux attach
			</p>
			<p class="section-body indented">
				In <span class="bold">tmux</span>, a session is displayed on screen by a <span class="underline">client</span> and all sessions are managed by a single <span class="underline">server</span>. The server and each client are separate processes which communicate through a socket in /tmp.
			</p>
		</section>

		<!-- DEFAULT KEY BINDINGS Section -->
		<section class="manpage-section">
			<h2 class="section-title">DEFAULT KEY BINDINGS</h2>
			<p class="section-body indented">
				<span class="bold">tmux</span> may be controlled from an attached client by using a key combination of a prefix key, 'C-b' (Ctrl-b) by default, followed by a command key.
			</p>
			<p class="section-body indented">
				The default command key bindings are:
			</p>

			{#each COMMAND_CATEGORIES as category}
				{@const commands = getCommandsByCategory(category.key)}
				{#if commands.length > 0}
					<div class="command-category">
						<p class="category-label">{category.label}:</p>
						{#each commands as cmd}
							<div class="command-entry">
								<span class="command-shortcut">{cmd.shortcut}</span>
								<span class="command-desc">{cmd.description}</span>
							</div>
						{/each}
					</div>
				{/if}
			{/each}
		</section>

		<!-- COPY MODE Section -->
		<section class="manpage-section">
			<h2 class="section-title">COPY MODE</h2>
			<p class="section-body indented">
				A pane may be entered into copy mode with 'C-b ['. This allows text to be copied from the pane history and is also used for scrolling. Copy mode uses vi-style key bindings by default.
			</p>
		</section>

		<!-- SEE ALSO Section -->
		<section class="manpage-section">
			<h2 class="section-title">SEE ALSO</h2>
			<p class="section-body indented">
				pty(4)
			</p>
		</section>

		<!-- AUTHORS Section -->
		<section class="manpage-section">
			<h2 class="section-title">AUTHORS</h2>
			<p class="section-body indented">
				<span class="underline">Nicholas Marriott</span> &lt;nicholas.marriott@gmail.com&gt;
			</p>
		</section>

		<!-- Spacer to ensure content can scroll fully -->
		<div class="content-spacer"></div>
	</div>

	<!-- Status Bar -->
	<div class="status-bar">
		<span class="colon">:</span>
		<span class="cursor"></span>
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

	.manpage-header {
		display: flex;
		justify-content: space-between;
		font-weight: bold;
		padding: 8px 0;
		border-bottom: none;
	}

	.manpage-section {
		margin: 16px 0;
	}

	.section-title {
		font-size: 14px;
		font-weight: bold;
		color: #e0e0e0;
		margin: 0 0 8px 0;
	}

	.section-body {
		margin: 8px 0;
		color: #e0e0e0;
	}

	.section-body.indented {
		padding-left: 56px;
		text-indent: 0;
	}

	.section-body.indented-more {
		padding-left: 96px;
		font-family: monospace;
	}

	.section-body.continued {
		margin-top: 0;
		padding-left: 72px;
	}

	.bold {
		font-weight: bold;
	}

	.underline {
		text-decoration: underline;
	}

	.command-category {
		margin: 16px 0 16px 56px;
	}

	.category-label {
		font-weight: bold;
		color: #8be9fd;
		margin-bottom: 8px;
	}

	.command-entry {
		display: flex;
		gap: 16px;
		margin: 4px 0;
		padding-left: 16px;
	}

	.command-shortcut {
		min-width: 200px;
		color: #50fa7b;
		font-family: monospace;
	}

	.command-desc {
		color: #e0e0e0;
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
		background: #e0e0e0;
		animation: blink 1s step-end infinite;
		vertical-align: middle;
		margin-left: 1px;
	}

	@keyframes blink {
		0%, 50% {
			opacity: 1;
		}
		50.01%, 100% {
			opacity: 0;
		}
	}

	/* Responsive */
	@media (max-width: 640px) {
		.manpage-container {
			font-size: 12px;
		}

		.section-body.indented {
			padding-left: 24px;
		}

		.section-body.indented-more {
			padding-left: 48px;
		}

		.command-category {
			margin-left: 24px;
		}

		.command-entry {
			flex-direction: column;
			gap: 4px;
		}

		.command-shortcut {
			min-width: auto;
		}
	}
</style>
