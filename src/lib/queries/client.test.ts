/**
 * The app QueryClient must only run queries in the browser. svelte-query 6.3+
 * subscribes observers during SSR as well, so without `enabled: browser` every
 * server render would call the leaderboard's `fetch('/api/leaderboard')`.
 * Subscribing a QueryObserver here is what svelte-query's `createQuery` does.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryObserver } from '@tanstack/svelte-query';

const env = vi.hoisted(() => ({ browser: false }));
vi.mock('$app/environment', () => ({
	get browser() {
		return env.browser;
	}
}));

import { createQueryClient } from './client';

function subscribeQuery() {
	const client = createQueryClient();
	const queryFn = vi.fn(async () => 'data');
	const observer = new QueryObserver(client, { queryKey: ['test'], queryFn });
	const unsubscribe = observer.subscribe(() => {});
	return { client, queryFn, unsubscribe };
}

describe('createQueryClient', () => {
	afterEach(() => {
		env.browser = false;
	});

	it('does not run queries on the server', () => {
		const { client, queryFn, unsubscribe } = subscribeQuery();
		expect(queryFn).not.toHaveBeenCalled();
		unsubscribe();
		client.clear();
	});

	it('runs queries in the browser', () => {
		env.browser = true;
		const { client, queryFn, unsubscribe } = subscribeQuery();
		expect(queryFn).toHaveBeenCalledTimes(1);
		unsubscribe();
		client.clear();
	});
});
