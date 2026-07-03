/**
 * Hand-rolled arg parsing (no deps).
 *
 * TDD STUB — issue #35, interface §9.1. Recognizes --server <url>, --no-color,
 * --json, --verbose, --help/-h. Unknown command or --help → "help". Default
 * (no args) → "help".
 *
 * Body throws so tdd tests fail on the missing feature, not an import error.
 */

export type GlobalOptions = {
	server?: string;
	noColor: boolean;
	json: boolean;
	verbose: boolean;
};

export type ParsedArgs = {
	command: string;
	positionals: string[];
	options: GlobalOptions;
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function parseArgs(argv: string[]): ParsedArgs {
	throw new Error('args: parseArgs not implemented (tdd stub)');
}
