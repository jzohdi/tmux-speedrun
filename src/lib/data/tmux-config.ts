/**
 * Runtime tmux configuration helpers.
 *
 * The user-facing tmux config file is client-side and can override the prefix
 * key at runtime, so these helpers intentionally delegate to the shared
 * keybinding/runtime-config layer instead of exposing compile-time constants.
 */

import {
	getCurrentPrefixKey,
	getPrefixKeyDisplay as getDisplay,
	isPrefixKey as matchesPrefix
} from './keybindings';

export const TMUX_PREFIX_KEY = {
	get key() {
		return getCurrentPrefixKey().key;
	},
	get withCtrl() {
		return getCurrentPrefixKey().withCtrl ?? false;
	},
	get display() {
		return getDisplay();
	}
};

export function isPrefixKey(event: KeyboardEvent): boolean {
	return matchesPrefix(event);
}

export function getPrefixKeyDisplay(): string {
	return getDisplay();
}
