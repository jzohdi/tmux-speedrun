<script lang="ts">
	import Terminal from '$lib/components/Terminal.svelte';
	import type { PageData } from './$types';

	// `data` is always supplied by +layout.server.ts in the app; default it so the
	// component can also be rendered standalone (e.g. in unit/browser tests).
	let { data = { user: null } }: { data?: PageData } = $props();

	type Hint = { command: string; description: string };

	function signIn() {
		// Full navigation — this is a server redirect to an external origin (GitHub).
		window.location.href = '/api/auth/github/login';
	}

	async function signOut() {
		await fetch('/api/auth/logout', { method: 'POST' });
		// Reload so the layout re-loads without a session (anonymous state).
		window.location.reload();
	}

	// Single source of truth for the command-hint row: the string shown IS the
	// string executed when the hint is clicked — no separate mapping (per #31).
	const hints: Hint[] = [
		{ command: 'tsr ls', description: 'list challenges' },
		{ command: 'tsr lb', description: 'view leaderboards' },
		{ command: 'tsr start <id>', description: 'begin a challenge' },
		{ command: 'tsr practice', description: 'learn step by step' },
		{ command: 'tsr config', description: 'customize tmux.conf' },
		{ command: 'man tmux', description: 'command reference' }
	];

	let terminal: Terminal | undefined = $state();

	// The published CLI. The blurb/install command point people who'd rather run
	// against their own native tmux at the npm package (see cli/README.md).
	const NPM_URL = 'https://www.npmjs.com/package/tmux-speedrun';
	const INSTALL_CMD = 'npm install -g tmux-speedrun';

	let copied = $state(false);
	let copyResetTimer: ReturnType<typeof setTimeout> | undefined;

	async function copyInstall() {
		try {
			await navigator.clipboard.writeText(INSTALL_CMD);
			copied = true;
			clearTimeout(copyResetTimer);
			copyResetTimer = setTimeout(() => (copied = false), 1600);
		} catch {
			// Clipboard unavailable (insecure context / denied) — the command is
			// still fully visible for manual selection, so fail silently.
		}
	}
</script>

<svelte:head>
	<title>tmux-speedrun | Master tmux with timed challenges</title>
	<meta
		name="description"
		content="Practice tmux commands in timed challenges. Compete on leaderboards and become a terminal power user."
	/>

	<!-- Open Graph -->
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="tmux-speedrun" />
	<meta property="og:title" content="tmux-speedrun | Master tmux with timed challenges" />
	<meta
		property="og:description"
		content="Practice tmux commands in timed challenges. Compete on leaderboards and become a terminal power user."
	/>
	<meta property="og:image" content="/og-image.png" />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />

	<!-- Twitter Card -->
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content="tmux-speedrun | Master tmux with timed challenges" />
	<meta
		name="twitter:description"
		content="Practice tmux commands in timed challenges. Compete on leaderboards and become a terminal power user."
	/>
	<meta name="twitter:image" content="/og-image.png" />

	<!-- Additional SEO -->
	<meta name="theme-color" content="#0d0d0d" />
	<meta
		name="keywords"
		content="tmux, terminal, multiplexer, speedrun, challenges, keyboard shortcuts, cli, command line"
	/>

	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<main class="landing-page">
	<!-- Animated background grid -->
	<div class="bg-grid"></div>
	<div class="bg-glow"></div>

	<!-- Top Navbar -->
	<nav class="navbar">
		<div class="nav-inner">
			<div class="nav-brand">
				<a
					href="https://github.com/jzohdi/tmux-speedrun"
					target="_blank"
					rel="noopener noreferrer"
					class="badge"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="currentColor"
					>
						<path
							d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"
						/>
					</svg>
					<span>Open Source</span>
				</a>

				<a
					href={NPM_URL}
					target="_blank"
					rel="noopener noreferrer"
					class="badge badge-npm"
					aria-label="tmux-speedrun on npm"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="currentColor"
						aria-hidden="true"
					>
						<path
							d="M1.763 0C.786 0 0 .786 0 1.763v20.474C0 23.214.786 24 1.763 24h20.474c.977 0 1.763-.786 1.763-1.763V1.763C24 .786 23.214 0 22.237 0zM5.13 5.323l13.837.019-.009 13.836h-3.464l.01-10.382h-3.456L12.04 19.17H5.113z"
						/>
					</svg>
					<span>npm</span>
				</a>
			</div>

			<div class="nav-auth">
				{#if data.user}
					<span class="signed-in" title="Verified GitHub identity">
						<span class="dot" aria-hidden="true">●</span>
						signed in as {data.user.username}
					</span>
					<button type="button" class="auth-btn" onclick={signOut}>Sign out</button>
				{:else}
					<button type="button" class="auth-btn signin" onclick={signIn}>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							width="16"
							height="16"
							viewBox="0 0 24 24"
							fill="currentColor"
							aria-hidden="true"
						>
							<path
								d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"
							/>
						</svg>
						Sign in with GitHub
					</button>
				{/if}
			</div>
		</div>
	</nav>

	<!-- Hero Section -->
	<section class="hero">
		<div class="hero-content">
			<h1 class="title">
				<span class="title-accent">tmux</span>-speedrun
			</h1>

			<p class="description">Practice tmux commands in timed challenges.</p>

			<div class="npm-cta">
				<p class="npm-cta__text">
					Prefer your native terminal? Get the
					<a
						href={NPM_URL}
						target="_blank"
						rel="noopener noreferrer"
						class="npm-cta__link">CLI on npm</a
					>.
				</p>
				<div class="install">
					<code class="install__cmd"
						><span class="install__prompt" aria-hidden="true">$</span>{INSTALL_CMD}</code
					>
					<button
						type="button"
						class="install__copy"
						class:is-copied={copied}
						onclick={copyInstall}
						aria-label="Copy install command"
					>
						{copied ? 'copied' : 'copy'}
					</button>
				</div>
			</div>

			<div class="command-hints">
				{#each hints as hint (hint.command)}
					<button
						type="button"
						class="hint"
						aria-label={`Run command: ${hint.command}`}
						onclick={() => terminal?.runCommand(hint.command)}
					>
						<code>{hint.command}</code>
						<span>{hint.description}</span>
					</button>
				{/each}
			</div>
		</div>
	</section>

	<!-- Terminal Section -->
	<section class="terminal-section">
		<Terminal bind:this={terminal} user={data.user} />
	</section>

	<!-- Features Section -->
	<!-- <section class="features">
		<div class="feature">
			<div class="feature-icon">⚡</div>
			<h3>Speed Challenges</h3>
			<p>Race against the clock to complete tmux tasks. Every millisecond counts.</p>
		</div>
		<div class="feature">
			<div class="feature-icon">🏆</div>
			<h3>Global Leaderboards</h3>
			<p>Compete with terminal enthusiasts worldwide. Can you reach #1?</p>
		</div>
		<div class="feature">
			<div class="feature-icon">📚</div>
			<h3>Learn by Doing</h3>
			<p>No boring tutorials. Learn tmux through hands-on challenges.</p>
		</div>
	</section> -->

	<!-- Footer -->
	<footer class="footer"></footer>
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

	.landing-page {
		min-height: 100vh;
		position: relative;
		overflow-x: hidden;
	}

	/* Animated grid background */
	.bg-grid {
		position: fixed;
		inset: 0;
		background-image:
			linear-gradient(rgba(50, 255, 150, 0.03) 1px, transparent 1px),
			linear-gradient(90deg, rgba(50, 255, 150, 0.03) 1px, transparent 1px);
		background-size: 50px 50px;
		pointer-events: none;
		z-index: 0;
	}

	.bg-glow {
		position: fixed;
		top: -50%;
		left: 50%;
		transform: translateX(-50%);
		width: 150%;
		height: 100%;
		background: radial-gradient(ellipse at center, rgba(50, 255, 150, 0.08) 0%, transparent 60%);
		pointer-events: none;
		z-index: 0;
	}

	/* Top Navbar */
	.navbar {
		position: relative;
		z-index: 1;
		border-bottom: 1px solid rgba(255, 255, 255, 0.05);
	}

	.nav-inner {
		max-width: 1100px;
		margin: 0 auto;
		padding: 16px 24px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 12px;
	}

	.nav-auth {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 12px;
		min-width: 0;
		font-family: 'JetBrains Mono', monospace;
		font-size: 13px;
	}

	/* Hero Section */
	.hero {
		position: relative;
		z-index: 1;
		padding: 56px 24px 40px;
		text-align: center;
	}

	.hero-content {
		max-width: 700px;
		margin: 0 auto;
	}

	.badge {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 6px 14px;
		background: rgba(50, 255, 150, 0.1);
		border: 1px solid rgba(50, 255, 150, 0.2);
		border-radius: 20px;
		font-size: 12px;
		font-weight: 500;
		color: #50fa7b;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		text-decoration: none;
		transition:
			background 0.2s ease,
			border-color 0.2s ease,
			transform 0.2s ease;
	}

	.badge:hover {
		background: rgba(50, 255, 150, 0.18);
		border-color: rgba(50, 255, 150, 0.4);
		transform: translateY(-1px);
	}

	.badge svg {
		flex-shrink: 0;
	}

	/* Left brand cell: Open Source + npm badges sit side by side. */
	.nav-brand {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}

	/* npm badge: neutral pill so it doesn't clash with the green Open Source
	   badge; the iconic npm-red mark carries the brand recognition. */
	.badge-npm {
		background: rgba(255, 255, 255, 0.03);
		border-color: rgba(255, 255, 255, 0.12);
		color: #e0e0e0;
		text-transform: lowercase;
		letter-spacing: 0;
	}

	.badge-npm svg {
		color: #ff5252;
	}

	.badge-npm:hover {
		background: rgba(255, 82, 82, 0.1);
		border-color: rgba(255, 82, 82, 0.4);
	}

	.signed-in {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
		color: #a0a0a0;
		word-break: break-word;
	}

	.signed-in .dot {
		color: #50fa7b;
		font-size: 10px;
		line-height: 1;
	}

	.auth-btn {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 6px 14px;
		border-radius: 8px;
		border: 1px solid rgba(255, 255, 255, 0.12);
		background: rgba(255, 255, 255, 0.03);
		color: #e0e0e0;
		font-family: inherit;
		font-size: 13px;
		cursor: pointer;
		text-decoration: none;
		transition:
			background 0.2s ease,
			border-color 0.2s ease,
			transform 0.2s ease;
	}

	.auth-btn:hover {
		background: rgba(50, 255, 150, 0.1);
		border-color: rgba(50, 255, 150, 0.3);
		transform: translateY(-1px);
	}

	.auth-btn.signin {
		color: #50fa7b;
		border-color: rgba(50, 255, 150, 0.25);
	}

	.auth-btn.signin svg {
		flex-shrink: 0;
	}

	.title {
		font-family: 'JetBrains Mono', monospace;
		font-size: clamp(2.5rem, 8vw, 4.5rem);
		font-weight: 700;
		margin: 0 0 16px;
		letter-spacing: -0.02em;
		color: #ffffff;
	}

	.title-accent {
		color: #50fa7b;
	}

	.description {
		font-size: 1.05rem;
		line-height: 1.7;
		color: #a0a0a0;
		margin: 0 0 28px;
		max-width: 550px;
		margin-left: auto;
		margin-right: auto;
	}

	/* npm CLI callout: one-line blurb + copyable install command. */
	.npm-cta {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		margin: 0 0 36px;
	}

	.npm-cta__text {
		margin: 0;
		font-size: 0.9rem;
		color: #808080;
	}

	.npm-cta__link {
		color: #50fa7b;
		text-decoration: none;
		border-bottom: 1px solid rgba(80, 250, 123, 0.35);
		transition: border-color 0.2s ease;
	}

	.npm-cta__link:hover {
		border-bottom-color: #50fa7b;
	}

	.install {
		display: inline-flex;
		align-items: stretch;
		gap: 0;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 10px;
		overflow: hidden;
		max-width: 100%;
	}

	.install__cmd {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		padding: 10px 14px;
		font-family: 'JetBrains Mono', monospace;
		font-size: 13px;
		color: #e0e0e0;
		white-space: nowrap;
		overflow-x: auto;
		scrollbar-width: none;
	}

	.install__cmd::-webkit-scrollbar {
		display: none;
	}

	.install__prompt {
		color: #50fa7b;
		user-select: none;
		flex-shrink: 0;
	}

	.install__copy {
		flex-shrink: 0;
		padding: 0 16px;
		border: none;
		border-left: 1px solid rgba(255, 255, 255, 0.08);
		background: transparent;
		color: #808080;
		font-family: 'JetBrains Mono', monospace;
		font-size: 12px;
		cursor: pointer;
		transition:
			background 0.2s ease,
			color 0.2s ease;
	}

	.install__copy:hover {
		background: rgba(50, 255, 150, 0.08);
		color: #50fa7b;
	}

	.install__copy:focus-visible {
		outline: none;
		background: rgba(50, 255, 150, 0.08);
		color: #50fa7b;
	}

	.install__copy.is-copied {
		color: #50fa7b;
	}

	/* Command Hints */
	.command-hints {
		display: flex;
		flex-wrap: wrap;
		/* justify-content: center; */
		gap: 16px;
		margin-bottom: 40px;
	}

	.hint {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 16px;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 8px;
		/* Button reset so the <button> matches the old <div> appearance */
		margin: 0;
		font-family: inherit;
		color: inherit;
		text-align: left;
		/* Interactivity affordance (clickable hint) */
		cursor: pointer;
		transition:
			background 0.2s ease,
			border-color 0.2s ease,
			transform 0.2s ease;
	}

	.hint:hover {
		background: rgba(255, 255, 255, 0.06);
		border-color: rgba(50, 255, 150, 0.3);
		transform: translateY(-1px);
	}

	.hint:focus-visible {
		outline: none;
		border-color: rgba(50, 255, 150, 0.5);
		background: rgba(255, 255, 255, 0.06);
	}

	.hint code {
		font-family: 'JetBrains Mono', monospace;
		font-size: 13px;
		color: #50fa7b;
		font-weight: 500;
	}

	.hint span {
		font-size: 13px;
		color: #666;
	}

	/* Terminal Section */
	.terminal-section {
		position: relative;
		z-index: 1;
		padding: 0 24px 60px;
		display: flex;
		justify-content: center;
		min-height: 400px;
	}

	/* Features Section */
	/* Footer */
	.footer {
		position: relative;
		z-index: 0;
		text-align: center;
		padding: 40px 24px;
		border-top: 1px solid rgba(255, 255, 255, 0.05);
	}

	/* Responsive */
	@media (max-width: 640px) {
		.nav-inner {
			padding: 12px 16px;
		}

		.hero {
			padding: 40px 16px 30px;
		}

		.command-hints {
			flex-direction: column;
			align-items: center;
		}

		.hint {
			width: 100%;
			max-width: 280px;
			justify-content: center;
		}

		.terminal-section {
			padding: 0 0 40px;
		}
	}
</style>
