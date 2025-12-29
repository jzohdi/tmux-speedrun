/**
 * Random meaningful string generator.
 *
 * Generates strings in the format: word1-word2-digits
 * Example: "cosmic-elephant-42"
 *
 * Used for rename-style commands to expand the answer space
 * and prevent brute-force attacks.
 */

/**
 * Curated word list for memorable, easy-to-type strings.
 * Words are chosen to be:
 * - Common and recognizable
 * - Easy to spell
 * - Varied in character composition
 */
const ADJECTIVES = [
	'swift',
	'bright',
	'calm',
	'dark',
	'eager',
	'fair',
	'grand',
	'happy',
	'keen',
	'light',
	'mild',
	'noble',
	'proud',
	'quick',
	'rare',
	'sharp',
	'tall',
	'vast',
	'warm',
	'wise',
	'bold',
	'cool',
	'deep',
	'fast',
	'gold',
	'kind',
	'loud',
	'neat',
	'pure',
	'rich',
	'soft',
	'true',
	'wild',
	'young',
	'blue',
	'green',
	'red',
	'silver',
	'amber',
	'coral'
];

const NOUNS = [
	'tiger',
	'eagle',
	'river',
	'stone',
	'flame',
	'cloud',
	'storm',
	'ocean',
	'forest',
	'mountain',
	'falcon',
	'wolf',
	'bear',
	'hawk',
	'lion',
	'raven',
	'phoenix',
	'dragon',
	'thunder',
	'crystal',
	'shadow',
	'breeze',
	'meadow',
	'canyon',
	'glacier',
	'comet',
	'nebula',
	'cosmos',
	'orbit',
	'pulse',
	'spark',
	'frost',
	'bloom',
	'wave',
	'peak',
	'vale',
	'grove',
	'marsh',
	'delta',
	'reef'
];

/**
 * Generate a random integer in range [min, max] (inclusive).
 */
function randomInt(min: number, max: number): number {
	return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Pick a random element from an array.
 */
function randomPick<T>(array: readonly T[]): T {
	return array[Math.floor(Math.random() * array.length)];
}

/**
 * Generate a random meaningful string.
 *
 * Format: adjective-noun-digits
 * Example: "swift-tiger-42"
 *
 * @param minDigits - Minimum value for the number suffix (default: 10)
 * @param maxDigits - Maximum value for the number suffix (default: 99)
 * @returns A random string like "bright-falcon-73"
 */
export function generateMeaningfulString(minDigits = 10, maxDigits = 99): string {
	const adjective = randomPick(ADJECTIVES);
	const noun = randomPick(NOUNS);
	const digits = randomInt(minDigits, maxDigits);

	return `${adjective}-${noun}-${digits}`;
}

/**
 * Calculate the total number of possible combinations.
 * Useful for understanding the security implications.
 *
 * With default settings:
 * 40 adjectives × 40 nouns × 90 numbers = 144,000 combinations
 */
export function getCombinationCount(minDigits = 10, maxDigits = 99): number {
	const digitRange = maxDigits - minDigits + 1;

	return ADJECTIVES.length * NOUNS.length * digitRange;
}

/**
 * Validate that a string matches the expected format.
 * Used for testing and debugging.
 *
 * @param str - The string to validate
 * @returns true if the string matches the adjective-noun-digits format
 */
export function isValidMeaningfulString(str: string): boolean {
	const pattern = /^[a-z]+-[a-z]+-\d{2}$/;

	return pattern.test(str);
}

