<script lang="ts">
	import './layout.css';
	import { QueryClient, QueryClientProvider } from '@tanstack/svelte-query';
	import faviconSvg from '$lib/assets/favicon/favicon.svg';
	import appleIcon from '$lib/assets/favicon/apple-touch-icon.png';
	import favicon96 from '$lib/assets/favicon/favicon-96x96.png';
	import { dev } from '$app/environment';
	import { injectAnalytics } from '@vercel/analytics/sveltekit';	

	injectAnalytics({ mode: dev ? 'development' : 'production' });

	let { children } = $props();

	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {
				// Global defaults - can be overridden per-query
				staleTime: 60 * 1000, // Consider data fresh for 60 seconds
				gcTime: 5 * 60 * 1000 // Keep unused data in cache for 5 minutes
			}
		}
	});
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
<QueryClientProvider client={queryClient}>
	{@render children()}
</QueryClientProvider>
