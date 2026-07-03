import { defineConfig } from 'tsup';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Bundle the CLI into a single self-contained ESM file with a Node shebang.
 * The `$lib` alias is resolved at build time so the reused app modules
 * (`src/lib/crypto`, `challenge-core`, bundled practice data) are inlined and
 * the published package has no `$lib` runtime dependency (plan §3.1, R7).
 */
export default defineConfig({
	entry: ['src/index.ts'],
	format: ['esm'],
	target: 'node20',
	platform: 'node',
	clean: true,
	sourcemap: true,
	banner: { js: '#!/usr/bin/env node' },
	esbuildOptions(options) {
		options.alias = { $lib: resolve(here, '../src/lib') };
	}
});
