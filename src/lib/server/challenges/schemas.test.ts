/**
 * Tests for API request validation schemas.
 */

import { describe, it, expect } from 'vitest';
import {
	parseStartRequest,
	parseFinishRequest,
	parseSessionCookie,
	parseRecordRequest,
	startChallengeRequestSchema,
	finishChallengeRequestSchema,
	challengeSessionSchema
} from './schemas';

describe('Start Challenge Request Schema', () => {
	it('accepts valid request', () => {
		const validRequest = {
			challengeId: 0,
			clientPublicKeyJwk: {
				kty: 'EC',
				crv: 'P-256',
				x: 'abc123',
				y: 'def456'
			}
		};

		const parsed = parseStartRequest(validRequest);

		expect(parsed.challengeId).toBe(0);
		expect(parsed.clientPublicKeyJwk.kty).toBe('EC');
	});

	it('accepts all valid challenge IDs (0-5)', () => {
		for (let id = 0; id <= 5; id++) {
			const request = {
				challengeId: id,
				clientPublicKeyJwk: {
					kty: 'EC',
					crv: 'P-256',
					x: 'test',
					y: 'test'
				}
			};

			expect(() => parseStartRequest(request)).not.toThrow();
		}
	});

	it('rejects negative challenge ID', () => {
		const request = {
			challengeId: -1,
			clientPublicKeyJwk: {
				kty: 'EC',
				crv: 'P-256',
				x: 'test',
				y: 'test'
			}
		};

		expect(() => parseStartRequest(request)).toThrow();
	});

	it('rejects challenge ID > 5', () => {
		const request = {
			challengeId: 6,
			clientPublicKeyJwk: {
				kty: 'EC',
				crv: 'P-256',
				x: 'test',
				y: 'test'
			}
		};

		expect(() => parseStartRequest(request)).toThrow();
	});

	it('rejects non-integer challenge ID', () => {
		const request = {
			challengeId: 1.5,
			clientPublicKeyJwk: {
				kty: 'EC',
				crv: 'P-256',
				x: 'test',
				y: 'test'
			}
		};

		expect(() => parseStartRequest(request)).toThrow();
	});

	it('rejects wrong key type', () => {
		const request = {
			challengeId: 0,
			clientPublicKeyJwk: {
				kty: 'RSA', // Wrong!
				crv: 'P-256',
				x: 'test',
				y: 'test'
			}
		};

		expect(() => parseStartRequest(request)).toThrow();
	});

	it('rejects wrong curve', () => {
		const request = {
			challengeId: 0,
			clientPublicKeyJwk: {
				kty: 'EC',
				crv: 'P-384', // Wrong!
				x: 'test',
				y: 'test'
			}
		};

		expect(() => parseStartRequest(request)).toThrow();
	});

	it('rejects missing x coordinate', () => {
		const request = {
			challengeId: 0,
			clientPublicKeyJwk: {
				kty: 'EC',
				crv: 'P-256',
				y: 'test'
			}
		};

		expect(() => parseStartRequest(request)).toThrow();
	});

	it('rejects missing y coordinate', () => {
		const request = {
			challengeId: 0,
			clientPublicKeyJwk: {
				kty: 'EC',
				crv: 'P-256',
				x: 'test'
			}
		};

		expect(() => parseStartRequest(request)).toThrow();
	});

	it('rejects if private key component is present', () => {
		const request = {
			challengeId: 0,
			clientPublicKeyJwk: {
				kty: 'EC',
				crv: 'P-256',
				x: 'test',
				y: 'test',
				d: 'private-key-leaked!' // Should not be sent!
			}
		};

		expect(() => parseStartRequest(request)).toThrow();
	});

	it('rejects missing challengeId', () => {
		const request = {
			clientPublicKeyJwk: {
				kty: 'EC',
				crv: 'P-256',
				x: 'test',
				y: 'test'
			}
		};

		expect(() => parseStartRequest(request)).toThrow();
	});

	it('rejects missing clientPublicKeyJwk', () => {
		const request = {
			challengeId: 0
		};

		expect(() => parseStartRequest(request)).toThrow();
	});
});

describe('Finish Challenge Request Schema', () => {
	it('accepts valid request', () => {
		const validRequest = {
			proofB64: 'SGVsbG8gV29ybGQh'
		};

		const parsed = parseFinishRequest(validRequest);

		expect(parsed.proofB64).toBe('SGVsbG8gV29ybGQh');
	});

	it('rejects empty proof', () => {
		const request = {
			proofB64: ''
		};

		expect(() => parseFinishRequest(request)).toThrow();
	});

	it('rejects missing proof', () => {
		const request = {};

		expect(() => parseFinishRequest(request)).toThrow();
	});

	it('rejects non-string proof', () => {
		const request = {
			proofB64: 12345
		};

		expect(() => parseFinishRequest(request)).toThrow();
	});
});

describe('Challenge Session Cookie Schema', () => {
	it('accepts valid session data', () => {
		const validSession = {
			challengeId: 0,
			sessionId: 'abc123',
			encryptedProof: 'encrypted-data',
			startTime: Date.now()
		};

		const parsed = parseSessionCookie(validSession);

		expect(parsed.challengeId).toBe(0);
		expect(parsed.sessionId).toBe('abc123');
	});

	it('rejects negative challenge ID', () => {
		const session = {
			challengeId: -1,
			sessionId: 'abc123',
			encryptedProof: 'encrypted-data',
			startTime: Date.now()
		};

		expect(() => parseSessionCookie(session)).toThrow();
	});

	it('rejects empty session ID', () => {
		const session = {
			challengeId: 0,
			sessionId: '',
			encryptedProof: 'encrypted-data',
			startTime: Date.now()
		};

		expect(() => parseSessionCookie(session)).toThrow();
	});

	it('rejects empty encrypted proof', () => {
		const session = {
			challengeId: 0,
			sessionId: 'abc123',
			encryptedProof: '',
			startTime: Date.now()
		};

		expect(() => parseSessionCookie(session)).toThrow();
	});

	it('rejects negative start time', () => {
		const session = {
			challengeId: 0,
			sessionId: 'abc123',
			encryptedProof: 'encrypted-data',
			startTime: -1
		};

		expect(() => parseSessionCookie(session)).toThrow();
	});

	it('rejects zero start time', () => {
		const session = {
			challengeId: 0,
			sessionId: 'abc123',
			encryptedProof: 'encrypted-data',
			startTime: 0
		};

		expect(() => parseSessionCookie(session)).toThrow();
	});

	it('rejects non-integer start time', () => {
		const session = {
			challengeId: 0,
			sessionId: 'abc123',
			encryptedProof: 'encrypted-data',
			startTime: 1.5
		};

		expect(() => parseSessionCookie(session)).toThrow();
	});

	it('rejects missing fields', () => {
		expect(() => parseSessionCookie({})).toThrow();
		expect(() => parseSessionCookie({ challengeId: 0 })).toThrow();
		expect(() => parseSessionCookie({ challengeId: 0, sessionId: 'test' })).toThrow();
	});
});

describe('Record Challenge Request (free-text username)', () => {
	// Iteration 2 (PR #36 feedback): the record endpoint lets a signed-out user
	// attach an optional free-text name to a deferred result. Signed-in users
	// always use their verified identity — the body username is ignored server-side.
	// See `.agent/interface.md` §I4.

	it('returns a trimmed username', () => {
		expect(parseRecordRequest({ username: '  octocat  ' })).toEqual({ username: 'octocat' });
	});

	it('normalizes a blank / whitespace-only name to undefined (→ Anonymous)', () => {
		expect(parseRecordRequest({ username: '   ' })).toEqual({ username: undefined });
		expect(parseRecordRequest({ username: '' })).toEqual({ username: undefined });
	});

	it('treats a missing username (empty body) as undefined', () => {
		expect(parseRecordRequest({})).toEqual({ username: undefined });
	});

	it('strips embedded control characters, preserving the visible text', () => {
		// A trailing newline and an embedded NUL are removed; letters survive.
		expect(parseRecordRequest({ username: 'octo\u0000cat\n' })).toEqual({ username: 'octocat' });
	});

	it('caps the sanitized username at 32 characters', () => {
		const parsed = parseRecordRequest({ username: 'a'.repeat(100) });
		expect(parsed.username).toBeDefined();
		expect((parsed.username as string).length).toBeLessThanOrEqual(32);
	});

	it('rejects a non-string username', () => {
		expect(() => parseRecordRequest({ username: 12345 })).toThrow();
	});
});

describe('Schema Type Inference', () => {
	it('startChallengeRequestSchema has correct shape', () => {
		const shape = startChallengeRequestSchema.shape;

		expect(shape.challengeId).toBeDefined();
		expect(shape.clientPublicKeyJwk).toBeDefined();
	});

	it('finishChallengeRequestSchema has correct shape', () => {
		const shape = finishChallengeRequestSchema.shape;

		expect(shape.proofB64).toBeDefined();
	});

	it('challengeSessionSchema has correct shape', () => {
		const shape = challengeSessionSchema.shape;

		expect(shape.challengeId).toBeDefined();
		expect(shape.sessionId).toBeDefined();
		expect(shape.encryptedProof).toBeDefined();
		expect(shape.startTime).toBeDefined();
	});
});
