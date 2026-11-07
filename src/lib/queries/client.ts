/**
 * The app's TanStack QueryClient, created once by the root layout.
 */

import { QueryClient } from '@tanstack/svelte-query';
import { browser } from '$app/environment';

export function createQueryClient(): QueryClient {
	return new QueryClient({
		defaultOptions: {
			queries: {
				// Queries run in the browser only. svelte-query 6.3+ also subscribes
				// during SSR, which would call the global fetch with a relative URL on
				// the server. Nothing is prefetched there, so stay client-only.
				enabled: browser,
				// Global defaults - can be overridden per-query
				staleTime: 60 * 1000, // Consider data fresh for 60 seconds
				gcTime: 5 * 60 * 1000 // Keep unused data in cache for 5 minutes
			}
		}
	});
}
