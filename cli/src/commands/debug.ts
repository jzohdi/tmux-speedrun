/**
 * TDD placeholder for the `tmux-speedrun debug` command (issue #45 R3, plan
 * §9.4, interface §11.4).
 *
 * The implementation stage fills this in: a diagnostic that reuses the
 * server/observer/detector stack to dump env, the live/dead hook partition,
 * a config summary, and a live event→candidate trace. The pure assembly
 * pieces the unit tests pin here are `partitionHooks` and `formatDebugReport`;
 * `debugCommand` is the CLI entry (attach/trace path is integration/manual).
 *
 * Intentionally left unimplemented so `debug.test.ts` fails on missing
 * behavior rather than a module-resolution error.
 */

export {};
