/**
 * Tmux Configuration - SINGLE SOURCE OF TRUTH
 *
 * This file contains the configuration for tmux behavior in the application.
 * All tmux-related settings that may be user-configurable in the future
 * should be defined here.
 */

/**
 * The default tmux prefix key combination.
 * In real tmux, this is Ctrl+b by default but can be configured.
 */
export const TMUX_PREFIX_KEY = {
	/** The key that must be pressed with Ctrl */
	key: 'b',
	/** Whether Ctrl must be held */
	withCtrl: true,
	/** Human-readable display string */
	display: 'Ctrl+b'
} as const;

/**
 * Check if a keyboard event matches the prefix key.
 *
 * @param event - The keyboard event to check
 * @returns true if the event matches the prefix key
 */
export function isPrefixKey(event: KeyboardEvent): boolean {
	return event.ctrlKey && event.key.toLowerCase() === TMUX_PREFIX_KEY.key;
}

/**
 * Get the display string for the prefix key.
 * This is used in UI to show users what the prefix key is.
 *
 * @returns The human-readable prefix key display string
 */
export function getPrefixKeyDisplay(): string {
	return TMUX_PREFIX_KEY.display;
}
