import { fileURLToPath } from 'node:url';
import devtoolsJson from 'vite-plugin-devtools-json';
import tailwindcss from '@tailwindcss/vite';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';

const vitestBrowserRunner = globalThis as typeof globalThis & {
	__vitest_browser_runner__?: {
		wrapDynamicImport<T>(load: () => Promise<T> | T): Promise<T> | T;
	};
};

// Vitest browser mode currently leaks its dynamic-import wrapper into SvelteKit's
// SSR environment. Mirror the upstream workaround until the upstream fix lands.
vitestBrowserRunner.__vitest_browser_runner__ ??= {
	wrapDynamicImport: <T>(load: () => Promise<T> | T) => load()
};

const repoRootPath = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
	plugins: [tailwindcss(), sveltekit(), devtoolsJson()],
	server: {
		fs: {
			allow: [repoRootPath]
		}
	},

	test: {
		expect: { requireAssertions: true },

		projects: [
			{
				extends: './vite.config.ts',

				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
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
