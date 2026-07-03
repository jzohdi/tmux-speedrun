import devtoolsJson from 'vite-plugin-devtools-json';
import tailwindcss from '@tailwindcss/vite';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit(), devtoolsJson()],

	test: {
		expect: { requireAssertions: true },

		projects: [
			{
				extends: './vite.config.ts',

				test: {
					name: 'server',
					environment: 'node',
					// Includes the `cli/` workspace package's node unit tests (issue #35) so
					// `npm run test:unit` covers them alongside the app's server-side tests.
					include: ['src/**/*.{test,spec}.{js,ts}', 'cli/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}', 'src/**/*.browser.{test,spec}.{js,ts}']
				}
			},
			{
				extends: './vite.config.ts',

				test: {
					name: 'browser',
					include: ['src/**/*.browser.{test,spec}.{js,ts}'],
					setupFiles: ['vitest-browser-svelte'],
					browser: {
						enabled: true,
						headless: true,
						provider: playwright(),
						instances: [{ browser: 'chromium' }]
					}
				}
			}
		]
	}
});
