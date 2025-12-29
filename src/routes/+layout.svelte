<script lang="ts">
	import './layout.css';
	import faviconSvg from '$lib/assets/favicon/favicon.svg';
	import appleIcon from '$lib/assets/favicon/apple-touch-icon.png';
	import favicon96 from '$lib/assets/favicon/favicon-96x96.png';

	let { children } = $props();
</script>

<svelte:head>
	<!-- Favicons -->
	<link rel="icon" type="image/svg+xml" href={faviconSvg} />
	<link rel="icon" type="image/png" sizes="96x96" href={favicon96} />
	<link rel="apple-touch-icon" sizes="180x180" href={appleIcon} />
	<link rel="manifest" href="/site.webmanifest" />
	
	<!-- Global SEO defaults -->
	<meta name="author" content="tmux-speedrun" />
	<meta name="theme-color" content="#0d0d0d" />
</svelte:head>
{@render children()}
