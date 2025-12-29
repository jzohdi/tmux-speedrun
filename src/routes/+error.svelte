<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	// Terminal typing animation state
	let typedLines = $state<string[]>([]);
	let cursorVisible = $state(true);
	let showContent = $state(false);
	let glitchActive = $state(false);

	const errorCode = $derived($page.status);
	const errorMessage = $derived($page.error?.message ?? 'An error occurred');

	// ASCII art for different error codes (using simple box drawing)
	const asciiArt: Record<number, string[]> = {
		404: [
			'┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓',
			'┃                                                        ┃',
			'┃   █   █   ████   █   █                                 ┃',
			'┃   █   █  █    █  █   █                                 ┃',
			'┃   █████  █    █  █████                                 ┃',
			'┃       █  █    █      █                                 ┃',
			'┃       █   ████       █                                 ┃',
			'┃                                                        ┃',
			'┃            PAGE NOT FOUND                              ┃',
			'┃                                                        ┃',
			'┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛'
		],
		500: [
			'┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓',
			'┃                                                        ┃',
			'┃   █████   ████    ████                                 ┃',
			'┃   █      █    █  █    █                                ┃',
			'┃   █████  █    █  █    █                                ┃',
			'┃       █  █    █  █    █                                ┃',
			'┃   █████   ████    ████                                 ┃',
			'┃                                                        ┃',
			'┃        INTERNAL SERVER ERROR                           ┃',
			'┃                                                        ┃',
			'┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛'
		]
	};

	// Terminal output lines - computed once in animation
	function getTerminalLines(): string[] {
		const path = $page.url.pathname;
		const code = $page.status;
		const msg = $page.error?.message ?? 'An error occurred';
		return [
			`$ cd ${path}`,
			`bash: cd: ${path}: No such file or directory`,
			'',
			`$ cat ${path}`,
			`cat: ${path}: No such file or directory`,
			'',
			`$ echo "Error ${code}: ${msg}"`,
			`Error ${code}: ${msg}`
		];
	}

	// Typing animation
	async function typeText(text: string, delay: number = 30): Promise<void> {
		return new Promise((resolve) => {
			let index = 0;
			const interval = setInterval(() => {
				if (index <= text.length) {
					typedLines = [...typedLines.slice(0, -1), text.slice(0, index)];
					index++;
				} else {
					clearInterval(interval);
					resolve();
				}
			}, delay);
		});
	}

	async function runTerminalAnimation(): Promise<void> {
		const lines = getTerminalLines();
		for (const line of lines) {
			typedLines = [...typedLines, ''];
			
			// Commands type slower, output appears instantly
			if (line.startsWith('$')) {
				await typeText(line, 25);
				await new Promise(r => setTimeout(r, 300));
			} else if (line.startsWith('bash:') || line.startsWith('cat:') || line.startsWith('Error')) {
				// Error messages appear with a slight delay
				await new Promise(r => setTimeout(r, 100));
				typedLines = [...typedLines.slice(0, -1), line];
				// Trigger glitch on error
				if (line.startsWith('bash:') || line.startsWith('cat:')) {
					glitchActive = true;
					setTimeout(() => glitchActive = false, 150);
				}
			} else {
				typedLines = [...typedLines.slice(0, -1), line];
			}
			
			await new Promise(r => setTimeout(r, 80));
		}
		
		// Show the main content after typing
		await new Promise(r => setTimeout(r, 500));
		showContent = true;
	}

	// Cursor blink effect
	onMount(() => {
		const cursorInterval = setInterval(() => {
			cursorVisible = !cursorVisible;
		}, 530);

		// Start typing animation
		runTerminalAnimation();

		return () => {
			clearInterval(cursorInterval);
		};
	});

	function handleGoHome(): void {
		goto('/');
	}

	function handleGoBack(): void {
		history.back();
	}
</script>

<svelte:head>
	<title>{errorCode} | tmux-speedrun</title>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<main class="error-page" class:glitch={glitchActive}>
	<!-- Animated background -->
	<div class="bg-grid"></div>
	<div class="bg-scanlines"></div>
	<div class="bg-glow"></div>
	<div class="bg-noise"></div>

	<div class="error-container">
		<!-- ASCII Art Header -->
		<div class="ascii-section" class:visible={showContent}>
			{#each (asciiArt[errorCode] ?? asciiArt[404]) as line}
				<pre class="ascii-line">{line}</pre>
			{/each}
		</div>

		<!-- Terminal Window -->
		<div class="terminal-window">
			<div class="terminal-header">
				<div class="terminal-buttons">
					<span class="btn close"></span>
					<span class="btn minimize"></span>
					<span class="btn maximize"></span>
				</div>
				<span class="terminal-title">bash — error</span>
				<div class="terminal-buttons invisible">
					<span class="btn"></span>
					<span class="btn"></span>
					<span class="btn"></span>
				</div>
			</div>

			<div class="terminal-body">
				{#each typedLines as line, i}
					<div class="terminal-line" class:command={line.startsWith('$')} class:error={line.startsWith('bash:') || line.startsWith('cat:') || line.startsWith('Error')}>
						{line}
						{#if i === typedLines.length - 1 && !showContent}
							<span class="cursor" class:visible={cursorVisible}>▋</span>
						{/if}
					</div>
				{/each}

				{#if showContent}
					<div class="terminal-line command">
						$ <span class="cursor blink">▋</span>
					</div>
				{/if}
			</div>
		</div>

		<!-- Action Section -->
		<div class="actions-section" class:visible={showContent}>
			<p class="help-text">
				<span class="hint-icon">💡</span>
				The page you're looking for doesn't exist or has been moved.
			</p>

			<div class="command-suggestions">
				<span class="suggestion-label">Try one of these:</span>
				<div class="suggestions">
					<button class="suggestion-btn" onclick={handleGoHome}>
						<code>cd ~</code>
						<span>Go home</span>
					</button>
					<button class="suggestion-btn" onclick={handleGoBack}>
						<code>cd ..</code>
						<span>Go back</span>
					</button>
				</div>
			</div>

			<div class="quick-links">
				<a href="/" class="quick-link">
					<span class="link-icon">🏠</span>
					<span>Home</span>
				</a>
				<a href="/free-play" class="quick-link">
					<span class="link-icon">🎮</span>
					<span>Free Play</span>
				</a>
			</div>
		</div>
	</div>

	<!-- Decorative Elements -->
	<div class="corner-decoration top-left"></div>
	<div class="corner-decoration top-right"></div>
	<div class="corner-decoration bottom-left"></div>
	<div class="corner-decoration bottom-right"></div>
</main>

<style>
	:global(body) {
		margin: 0;
		padding: 0;
		background: #0a0a0a;
		color: #e0e0e0;
		font-family: 'Space Grotesk', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
		overflow-x: hidden;
	}

	.error-page {
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		position: relative;
		padding: 40px 24px;
		box-sizing: border-box;
	}

	.error-page.glitch {
		animation: screenGlitch 0.15s ease;
	}

	@keyframes screenGlitch {
		0% { transform: translate(0); filter: hue-rotate(0deg); }
		20% { transform: translate(-2px, 1px); filter: hue-rotate(90deg); }
		40% { transform: translate(2px, -1px); filter: hue-rotate(-90deg); }
		60% { transform: translate(-1px, 2px); filter: hue-rotate(180deg); }
		80% { transform: translate(1px, -2px); filter: hue-rotate(-180deg); }
		100% { transform: translate(0); filter: hue-rotate(0deg); }
	}

	/* Background Effects */
	.bg-grid {
		position: fixed;
		inset: 0;
		background-image:
			linear-gradient(rgba(50, 255, 150, 0.03) 1px, transparent 1px),
			linear-gradient(90deg, rgba(50, 255, 150, 0.03) 1px, transparent 1px);
		background-size: 40px 40px;
		pointer-events: none;
		z-index: 0;
	}

	.bg-scanlines {
		position: fixed;
		inset: 0;
		background: repeating-linear-gradient(
			0deg,
			transparent,
			transparent 2px,
			rgba(0, 0, 0, 0.1) 2px,
			rgba(0, 0, 0, 0.1) 4px
		);
		pointer-events: none;
		z-index: 1;
		opacity: 0.3;
	}

	.bg-glow {
		position: fixed;
		top: -30%;
		left: 50%;
		transform: translateX(-50%);
		width: 120%;
		height: 80%;
		background: radial-gradient(ellipse at center, rgba(50, 255, 150, 0.06) 0%, transparent 70%);
		pointer-events: none;
		z-index: 0;
	}

	.bg-noise {
		position: fixed;
		inset: 0;
		opacity: 0.015;
		background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E");
		pointer-events: none;
		z-index: 2;
	}

	/* Corner Decorations */
	.corner-decoration {
		position: fixed;
		width: 100px;
		height: 100px;
		border: 1px solid rgba(50, 255, 150, 0.1);
		pointer-events: none;
		z-index: 0;
	}

	.corner-decoration.top-left {
		top: 20px;
		left: 20px;
		border-right: none;
		border-bottom: none;
	}

	.corner-decoration.top-right {
		top: 20px;
		right: 20px;
		border-left: none;
		border-bottom: none;
	}

	.corner-decoration.bottom-left {
		bottom: 20px;
		left: 20px;
		border-right: none;
		border-top: none;
	}

	.corner-decoration.bottom-right {
		bottom: 20px;
		right: 20px;
		border-left: none;
		border-top: none;
	}

	/* Main Container */
	.error-container {
		position: relative;
		z-index: 10;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 32px;
		max-width: 700px;
		width: 100%;
	}

	/* ASCII Art Section */
	.ascii-section {
		opacity: 0;
		transform: translateY(-20px);
		transition: all 0.6s cubic-bezier(0.16, 1, 0.3, 1);
	}

	.ascii-section.visible {
		opacity: 1;
		transform: translateY(0);
	}

	.ascii-line {
		font-family: 'JetBrains Mono', monospace;
		font-size: clamp(5px, 1vw, 9px);
		line-height: 1.15;
		margin: 0;
		color: #50fa7b;
		text-shadow: 0 0 10px rgba(50, 255, 150, 0.3);
		white-space: pre;
	}

	/* Terminal Window */
	.terminal-window {
		width: 100%;
		background: #1a1a1a;
		border: 1px solid #2d2d2d;
		overflow: hidden;
		box-shadow:
			0 25px 50px -12px rgba(0, 0, 0, 0.6),
			0 0 0 1px rgba(50, 255, 150, 0.05),
			inset 0 1px 0 rgba(255, 255, 255, 0.03);
	}

	.terminal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 14px;
		background: #252525;
		border-bottom: 1px solid #2d2d2d;
	}

	.terminal-buttons {
		display: flex;
		gap: 6px;
	}

	.terminal-buttons.invisible {
		visibility: hidden;
	}

	.btn {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: #3d3d3d;
	}

	.btn.close { background: #ff5f56; }
	.btn.minimize { background: #ffbd2e; }
	.btn.maximize { background: #27ca40; }

	.terminal-title {
		font-family: 'JetBrains Mono', monospace;
		font-size: 12px;
		color: #666;
	}

	.terminal-body {
		padding: 16px 20px;
		min-height: 140px;
		max-height: 220px;
		overflow-y: auto;
		font-family: 'JetBrains Mono', monospace;
		font-size: 12px;
		line-height: 1.6;
	}

	.terminal-line {
		color: #a0a0a0;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.terminal-line.command {
		color: #50fa7b;
	}

	.terminal-line.error {
		color: #ff5555;
	}

	.cursor {
		color: #50fa7b;
		opacity: 0;
		margin-left: 2px;
	}

	.cursor.visible {
		opacity: 1;
	}

	.cursor.blink {
		animation: cursorBlink 1s step-end infinite;
	}

	@keyframes cursorBlink {
		0%, 50% { opacity: 1; }
		51%, 100% { opacity: 0; }
	}

	/* Actions Section */
	.actions-section {
		width: 100%;
		opacity: 0;
		transform: translateY(20px);
		transition: all 0.6s cubic-bezier(0.16, 1, 0.3, 1);
		transition-delay: 0.2s;
	}

	.actions-section.visible {
		opacity: 1;
		transform: translateY(0);
	}

	.help-text {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 14px;
		color: #666;
		margin: 0 0 24px;
		text-align: center;
		justify-content: center;
	}

	.hint-icon {
		font-size: 16px;
	}

	.command-suggestions {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		margin-bottom: 32px;
	}

	.suggestion-label {
		font-size: 12px;
		color: #4d4d4d;
		text-transform: uppercase;
		letter-spacing: 1px;
	}

	.suggestions {
		display: flex;
		gap: 16px;
		flex-wrap: wrap;
		justify-content: center;
	}

	.suggestion-btn {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 20px;
		background: rgba(50, 255, 150, 0.05);
		border: 1px solid rgba(50, 255, 150, 0.15);
		cursor: pointer;
		font-family: inherit;
		transition: all 0.2s ease;
	}

	.suggestion-btn:hover {
		background: rgba(50, 255, 150, 0.1);
		border-color: rgba(50, 255, 150, 0.3);
		transform: translateY(-2px);
	}

	.suggestion-btn code {
		font-family: 'JetBrains Mono', monospace;
		font-size: 14px;
		color: #50fa7b;
		font-weight: 500;
	}

	.suggestion-btn span {
		font-size: 13px;
		color: #666;
	}

	.quick-links {
		display: flex;
		justify-content: center;
		gap: 24px;
	}

	.quick-link {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
		color: #4d4d4d;
		text-decoration: none;
		transition: color 0.2s ease;
	}

	.quick-link:hover {
		color: #50fa7b;
	}

	.link-icon {
		font-size: 14px;
	}

	/* Responsive */
	@media (max-width: 640px) {
		.error-page {
			padding: 16px;
		}

		.ascii-line {
			font-size: clamp(5px, 2vw, 8px);
		}

		.terminal-body {
			padding: 12px 14px;
			font-size: 11px;
			min-height: 150px;
		}

		.corner-decoration {
			width: 50px;
			height: 50px;
		}

		.suggestions {
			flex-direction: column;
			width: 100%;
		}

		.suggestion-btn {
			width: 100%;
			justify-content: center;
		}
	}
</style>

