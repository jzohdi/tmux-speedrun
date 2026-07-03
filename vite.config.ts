import path from 'node:path';
import { createRequire } from 'node:module';
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
const require = createRequire(import.meta.url);
const dependencyWorkspaceRoot = getDependencyWorkspaceRoot('@sveltejs/kit/package.json');

// Vitest browser mode currently leaks its dynamic-import wrapper into SvelteKit's
// SSR environment. Mirror the upstream workaround until the upstream fix lands.
vitestBrowserRunner.__vitest_browser_runner__ ??= {
	wrapDynamicImport: <T>(load: () => Promise<T> | T) => load()
};

export default defineConfig({
	plugins: [tailwindcss(), sveltekit(), devtoolsJson()],
	server: {
		fs: {
			allow: [dependencyWorkspaceRoot]
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

function getDependencyWorkspaceRoot(moduleId: string): string {
	const resolvedModulePath = require.resolve(moduleId);
	const pathSegments = resolvedModulePath.split(path.sep);
	const nodeModulesIndex = pathSegments.indexOf('node_modules');

	if (nodeModulesIndex <= 0) {
		throw new Error(`Could not determine workspace root for ${moduleId}`);
	}

	return pathSegments.slice(0, nodeModulesIndex).join(path.sep) || path.sep;
}
