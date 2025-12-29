/**
 * Challenge system exports.
 *
 * This module provides:
 * - Pool configuration for each challenge level
 * - Instruction generation with randomization
 * - Prompt variations for natural language variety
 * - Random string generation for input commands
 * - Cryptographic operations for step encryption and proof validation
 * - Type definitions for the challenge protocol
 */

// Types
export type {
	Instruction,
	StepPayload,
	EncryptedStep,
	StartChallengeRequest,
	StartChallengeResponse,
	FinishChallengeRequest,
	FinishChallengeResponse,
	ChallengeSession
} from './types';

// Pool configuration
export {
	CHALLENGE_POOLS,
	getPoolConfig,
	getPoolForChallenge,
	getInputCommandsForChallenge,
	getSimpleCommandsForChallenge,
	getInstructionCount,
	getMinInputCommands,
	getChallengePoolCount,
	isValidChallengeId,
	getAllChallengeCommands,
	getChallengeDifficultyLabel,
	getAllChallengeMetadata
} from './pools';
export type { PoolConfig, ChallengeMetadata } from './pools';

// Instruction generation
export {
	generateInstructions,
	getExpectedActions,
	countCommandOccurrences,
	countInputInstructions,
	meetsInputRequirement
} from './generator';

// Prompt variations
export {
	PROMPT_VARIATIONS,
	getRandomPrompt,
	getRandomPromptWithInput,
	hasPromptVariations,
	getCommandsWithVariations
} from './prompt-variations';

// Random string generation
export {
	generateMeaningfulString,
	getCombinationCount,
	isValidMeaningfulString
} from './random-string';

// Cryptographic operations
export {
	SESSION_SALT_SIZE,
	generateSessionSalt,
	generateSessionId,
	deriveK0,
	deriveNextKey,
	deriveKeyChain,
	deriveKfinal,
	encryptStep,
	decryptStep,
	encryptAllSteps,
	encryptProof,
	decryptProof,
	verifyProof,
	prepareChallenge,
	validateChallenge
} from './crypto';

// Request validation schemas
export {
	startChallengeRequestSchema,
	finishChallengeRequestSchema,
	challengeSessionSchema,
	parseStartRequest,
	parseFinishRequest,
	parseSessionCookie
} from './schemas';
export type {
	StartChallengeRequestBody,
	FinishChallengeRequestBody,
	ChallengeSessionCookie
} from './schemas';
