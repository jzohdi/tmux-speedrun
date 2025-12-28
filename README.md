# tmux-speedrun

A lightning-fast, web-based game and tutorial for learning tmux. Race through
tmux challenges by entering the correct key sequences, master pane management,
and climb the global leaderboard.

This README explains the goals, architecture, tech stack, crypto protocol for
challenge unlocking, and key implementation considerations.

---

## Goals

- Teach tmux via interactive, speed-focused challenges.
- Emulate a terminal and tmux-like pane management with high fidelity.
- Keep the UI ultra-responsive even during rapid input.
- Support hundreds of challenges organized by difficulty.
- Provide a global leaderboard and future social login (GitHub).

---

## Feature Overview

- Home page
  - Global leaderboard with fastest times.
  - Mini terminal where you can:
    - Type `man tmux` to view the in-app “man page” (a curated guide to the
      commands used in the challenges).
    - Type `tmux` to start the first challenge (bootstraps a secure session).
- Challenge flow
  - Steps are randomly generated on the server at session start.
  - All encrypted steps are delivered upfront in a single response.
  - Each step is unlocked by deriving a key from the previous step's answer.
  - The only way to see the next step is by entering the correct key bindings.
  - No server round-trips needed during gameplay; pure client-side decryption.
- Sessions and times
  - All session state is stored in signed cookies (no server-side storage).
  - Completing the challenge produces a cryptographic proof.
  - Server validates the proof and records the time to the leaderboard.
- Roadmap
  - GitHub login for profiles and authenticated leaderboards.

---

## High-Level Architecture

- Frontend (SPA inside SvelteKit)
  - Svelte 5 + TypeScript.
  - A headless “tmux engine” models panes as a split tree and translates key
    sequences into actions.
  - A DOM-based terminal emulator (no shell execution) with precise keyboard
    input handling and tmux-like layout animations.
  - Challenge runner orchestrates steps, timers, and local validation.
- Backend (SvelteKit server routes)
  - Challenge generation: builds a sequence of steps per session.
  - Crypto handshake: ephemeral ECDH with the client to derive a session key.
  - Step encryption and layered key derivation: each subsequent step depends on
    the previous step’s correct answer.
  - Session cookies: httpOnly, secure, SameSite settings.
  - Leaderboard persistence.

This split keeps gameplay latency entirely on the client. The server is
stateless: session data lives in signed cookies, and proof validation requires
no database lookup beyond writing to the leaderboard.

---

## Tech Stack

- Core
  - Svelte 5 + TypeScript (SvelteKit, powered by Vite).
  - Svelte Runes for fine-grained reactivity (no external state lib needed).
- Styling & UX
  - Tailwind CSS for fast iteration and theming.
  - Svelte built-in transitions/motion for instant-feel layout animations.
  - Monospace Nerd Font (e.g., JetBrains Mono or MesloLGS NF) for terminal
    aesthetics.
- Crypto
  - Web Crypto API (browser and server):
    - ECDH P-256 for ephemeral key exchange.
    - HKDF-SHA-256 for key derivation.
    - AES-GCM for payload encryption.
- Backend & Data
  - SvelteKit server routes.
  - Postgres (managed or self-hosted) for leaderboards.
  - Drizzle ORM for type-safe DB access.
- Testing
  - Vitest + Testing Library (unit).
  - Playwright (E2E, keyboard sequences, focus, and timing).
- Deployment
  - Vercel or Netlify for SvelteKit.
  - Optionally, Cloudflare (Workers) if targeting edge runtimes (uses Web
    Crypto natively).

Optional desktop distribution: Tauri for a native app with full keyboard control
if you want to exactly mirror tmux shortcuts without browser limitations.

---

## Home Page

- Leaderboard
  - Displays global fastest times per challenge and aggregate stats.
  - Anonymous play supported; future GitHub login will attribute runs.
- Mini terminal (no real shell)
  - `man tmux`: shows the curated "man page" with the keys and commands used in
    challenges. This is a static, styled document bundled with the frontend.
  - `tmux`: starts a challenge session by calling the server to:
    - Randomly generate challenge steps.
    - Perform a key exchange (client-server ECDH).
    - Deliver all encrypted steps in a single response.
    - Set a signed cookie with session data and expected proof.

Notes:
- The mini terminal supports basic line editing, prompt, and output rendering.
- It is not a sandboxed shell. Its purpose is discoverability and onboarding.

---

## The Challenge

- Randomly generated steps
  - At session start, the server randomly generates a sequence of steps.
  - Steps vary per session, preventing memorization of step order.
  - All steps are encrypted and delivered upfront in a single response.
- Layered encryption
  - Step 1 is encrypted with a session key derived from ECDH (K0).
  - Step n+1 is encrypted with a key derived from K0 and the correct answer to
    step n. Without the correct answer, the client cannot derive the next key
    and therefore cannot see the next step.
- Client-side validation for responsiveness
  - The client's tmux engine validates input immediately for snappy UX.
  - After solving, the client derives the next key and decrypts the next step
    locally. No server round-trip is needed between steps.
- Proof-based finalization
  - Solving all steps produces a final derived key (Kfinal) as proof.
  - The client submits this proof to the server.
  - The server validates the proof against the expected value stored (encrypted)
    in the session cookie.
  - If valid, the server records the time to the leaderboard.
  - No server-side session state is required; the cookie is the session.

---

## Keyboard Input Considerations

- Browser-reserved shortcuts (Ctrl+W, Ctrl+T, etc.) cannot be fully overridden.
- Default prefix recommendation
  - Use a safe default prefix (e.g., backtick `` ` ``) to avoid conflicts.
  - Make prefix configurable in Settings; map answers to canonical tmux commands
    (not raw keystrokes) so custom prefixes still pass validation.
- Prefix timing
  - Implement “escape-time” (default 500 ms) for prefix sequences.
  - States: NORMAL → PREFIX_ACTIVE → COMMAND or timeout back to NORMAL.
- Accessibility and focus
  - Ensure the game screen captures focus and uses `preventDefault()` for
    critical keys that browsers allow overriding.

---

## Data Model (Core Types)

```ts
// src/lib/engine/types.ts

export type TerminalPane = {
  id: string;
  type: 'terminal';
  buffer: string[]; // visual lines (rendering purposes)
  focused: boolean;
};

export type SplitContainer = {
  id: string;
  type: 'container';
  direction: 'horizontal' | 'vertical';
  children: Array<SplitContainer | TerminalPane>;
};

export type SessionTree = SplitContainer | TerminalPane;

export type TmuxSessionState = {
  root: SessionTree;
  activePaneId: string;
  mode: 'normal' | 'prefix';
};

export type CanonicalAction =
  | 'split-horizontal' // %
  | 'split-vertical' // "
  | 'focus-left'
  | 'focus-right'
  | 'focus-up'
  | 'focus-down'
  | 'kill-pane'
  | 'resize-left'
  | 'resize-right'
  | 'resize-up'
  | 'resize-down';

export type ChallengeStep = {
  index: number;
  prompt: string;
  // Do not send expected answer to the client in plaintext.
  expectedAction: CanonicalAction; // server-side only
  timeLimitMs?: number | null;
};

export type ChallengeSpec = {
  id: string;
  title: string;
  steps: ChallengeStep[];
};
```

---

## Challenge Unlock Protocol (Crypto)

Goal: Only a correct answer to step n can unlock step n+1. Upon completion, the
client produces a cryptographic proof that the server can validate statelessly.
This is not a bulletproof anti-cheat system, but it prevents trivial API
scraping and keeps gameplay fair enough for a casual leaderboard.

- Algorithms
  - ECDH: P-256.
  - KDF: HKDF-SHA-256.
  - Symmetric: AES-GCM-256 with 96-bit nonce.
  - Hash: SHA-256.

- Key chain
  - K0: derived from ECDH(sharedSecret) with a server-provided sessionSalt.
  - Kn+1: HKDF(Kn, salt = SHA256(canonicalAnswer_n), info = `step-${n + 1}`).
  - Kfinal: the key derived after solving the last step, used as the proof.

- Stateless proof scheme
  - At challenge start, the server:
    - Randomly generates the challenge steps.
    - Computes the expected Kfinal by chaining all correct answers.
    - Encrypts the expected Kfinal (the "expectedProof") using the server's
      secret key and a unique sessionKey.
    - Stores sessionKey, expectedProof, startTime, and challengeId in a signed
      cookie. No database write occurs.
  - At challenge finish, the server:
    - Reads sessionKey and expectedProof from the cookie.
    - Decrypts expectedProof using the server's secret key.
    - Compares the client-submitted proof (Kfinal) to the expected value.
    - If they match, the challenge is valid. Records time to leaderboard.
  - This allows fully stateless validation: the cookie is the session.

- Flow
  1. Start
     - Client generates ephemeral ECDH key pair.
     - Client POST /api/challenge/start with clientPublicKey and challengeId.
     - Server randomly generates challenge steps for this session.
     - Server generates ephemeral ECDH key pair, derives K0 with HKDF.
     - Server computes Kfinal by chaining HKDF through all correct answers.
     - Server encrypts expectedProof = Enc(serverSecretKey, Kfinal || sessionKey).
     - Server sets signed cookie containing: sessionKey, expectedProof,
       startTime, challengeId.
     - Server returns:
       - serverPublicKey
       - sessionSalt
       - All encrypted steps: Enc(K0, step1), Enc(K1, step2), ..., Enc(Kn-1, stepN)
     - Client derives K0 and decrypts step 1.
  2. Solve steps locally
     - Client validates the user's keystrokes, producing canonicalAnswer_n
       (e.g., 'split-horizontal' for %).
     - Client computes Kn+1 = HKDF(Kn, salt = SHA256(canonicalAnswer_n),
       info = `step-${n + 1}`).
     - Client decrypts the next step using Kn+1.
     - If the answer was wrong, decryption fails (garbage output).
     - No server round-trip needed between steps.
  3. Finish
     - Client calls POST /api/challenge/finish with:
       - proof: the final derived key (Kfinal) after solving all steps.
     - Server reads cookie, decrypts expectedProof using server secret.
     - Server verifies client proof matches expected Kfinal.
     - If valid: server records (endTime - startTime) to leaderboard.
     - Returns duration and leaderboard position.

- Notes
  - All encrypted steps are delivered upfront, but the client can only decrypt
    them in order as it derives each key. No mid-challenge API calls needed.
  - Avoid using raw keystrokes as secrets; use canonical actions (server-known,
    not user-configurable) for KDF salts to stay consistent across keybinding
    preferences.
  - The cookie is tamper-proof (signed) and contains encrypted server data.
    Modifying it invalidates the session.
  - This approach deters trivial scraping. Server-side timing and proof
    verification provide the source of truth for leaderboards.

---

## Server Timing and Sessions

All session state is stored in a signed, httpOnly cookie. No server-side session
storage is required.

- Session cookie contents (signed with server secret)
  - challengeId: which challenge is being attempted.
  - sessionKey: unique per-session key used in proof validation.
  - expectedProof: server-computed proof commitment (encrypted).
  - startTime: timestamp when the challenge was issued.
  - Cookie settings: httpOnly, Secure, SameSite=Lax or Strict, short TTL.
- Timing
  - startTime is embedded in the cookie at challenge start.
  - endTime is recorded when the client submits their proof.
  - Leaderboard stores server-measured duration (endTime - startTime).
- Stateless validation
  - The client submits a proof derived from solving all steps.
  - The server decrypts the expectedProof from the cookie using its secret key.
  - If the client's proof matches the expected proof, the solution is valid.
  - No database lookup or server-side session state is required.

---

## API Contracts (Sketch)

```ts
// POST /api/challenge/start
type StartRequest = {
  challengeId: string;
  clientPublicKeyJwk: JsonWebKey;
};

type StartResponse = {
  serverPublicKeyJwk: JsonWebKey;
  sessionSaltB64: string;
  // All steps delivered upfront, encrypted with chained keys
  steps: Array<{
    index: number;
    nonceB64: string;
    ciphertextB64: string; // Enc(Kn, stepPayload)
  }>;
  // Cookie is set with sessionKey, expectedProof, startTime, challengeId
};

// POST /api/challenge/finish
type FinishRequest = {
  // Proof is the final derived key after solving all steps
  proofB64: string;
};

type FinishResponse = {
  valid: boolean;
  durationMs: number;
  leaderboardPosition?: number;
};
```

---

## Frontend Architecture

- Tmux Engine (headless)
  - Maintains a split tree (containers and panes).
  - Applies actions (split, focus, kill, resize) from input sequences.
  - Exposes derived state for rendering (active pane, borders, sizes).
- Input Handler
  - Captures keydown events, manages a prefix FSM and escape-time.
  - Translates keystrokes into canonical actions.
  - Prevents browser defaults where possible.
- Renderer
  - Recursive component renders the split tree using flex/grid.
  - Smooth transitions for splits/resizes using Svelte transitions.
- Challenge Runner
  - Decrypts steps locally using derived keys, displays prompts.
  - Tracks progress and derives the next key upon each correct answer.
  - No server requests between steps; pure client-side progression.
  - Submits final proof to server upon completion.
- Home Terminal
  - Simple line editor with static outputs for `man tmux` and `tmux`.
  - Triggers the start API and navigates to the play screen.

---

## UI/UX and Styling

- Terminal aesthetic
  - Monospace font with powerline glyphs.
  - Themes (Dracula, Gruvbox) via Tailwind CSS variables.
  - Crisp borders for active/focused panes.
- Animations
  - Use Svelte’s `slide`, `crossfade`, and spring-based motions for splits and
    focus changes.
- Performance
  - Svelte 5 reactivity updates only affected nodes.
  - Avoid re-rendering entire trees; derive minimal reactive slices.
  - Throttle repeated resizes using `requestAnimationFrame`.

---

## Security Considerations

- Use TLS everywhere (https).
- Cookies: httpOnly, Secure, SameSite, minimal scope.
- CSRF: SameSite or double-submit token for mutating routes.
- Crypto pitfalls
  - AES-GCM requires unique nonces per key. Generate fresh random nonces for
    every step payload.
  - Use HKDF to derive per-step keys from the previous key and the canonical
    answer.
  - Never store plaintext steps in the client; never send plaintext answers.
- Cheating
  - This system prevents trivial scraping of steps.
  - For stricter anti-cheat, add server-side replay validation: submit the full
    timestamped keystroke sequence; server replays against a headless engine.

---

## Database Model (Minimal)

The only persisted model is the leaderboard. All session state lives in signed
cookies; no server-side session storage is required.

- leaderboard
  - id (uuid)
  - challenge_id (text)
  - user_id (nullable, for GitHub in future)
  - username (nullable)
  - duration_ms (int)
  - created_at (timestamptz)

Postgres (managed or self-hosted). Add RLS when enabling user accounts.

---

## Development

Prereqs
- Node.js 20+
- pnpm (recommended)
- Docker and Docker Compose (for local PostgreSQL)

Install
```bash
pnpm install
```

Start PostgreSQL (local development)
```bash
docker-compose up -d
```

This starts a PostgreSQL container with:
- User: `tmux`
- Password: `tmux`
- Database: `tmux_speedrun`
- Port: `5432`

The database schema is automatically initialized from `docker/init.sql` on first startup.

Stop PostgreSQL
```bash
docker-compose down
```

Recreate database (if you get "role does not exist" errors)
```bash
docker-compose down -v  # Removes volumes
docker-compose up -d     # Recreates with fresh database
```

Run dev
```bash
pnpm dev
```

Build
```bash
pnpm build
```

Preview
```bash
pnpm preview
```

Environment variables
- DATABASE_URL: Postgres connection string.
  - Local development: `postgresql://tmux:tmux@localhost:5432/tmux_speedrun`
  - Production (Neon): Your Neon serverless connection string (automatically detected if URL contains 'neon.tech' or 'neon')
- SESSION_SECRET: required for signing session cookies and encrypting proofs.
- ORIGIN: allowed origin(s) for CORS and CSRF policies.

The database client automatically selects the appropriate driver:
- Uses `postgres-js` for local PostgreSQL connections
- Uses `@neondatabase/serverless` for Neon serverless connections (detected automatically)

---

## Example Crypto Helpers (Browser)

```ts
// src/lib/crypto/hkdf.ts
export async function hkdf(
  ikm: ArrayBuffer,
  salt: ArrayBuffer,
  info: string,
  length = 32
): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    'raw',
    ikm,
    { name: 'HKDF' },
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt,
      info: new TextEncoder().encode(info),
    },
    key,
    length * 8
  );
  return bits;
}
```

```ts
// src/lib/crypto/aes-gcm.ts
export async function importAesGcmKey(raw: ArrayBuffer) {
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
}

export async function aesGcmEncrypt(
  key: CryptoKey,
  nonce: Uint8Array,
  data: Uint8Array
) {
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    key,
    data
  );
  return new Uint8Array(ct);
}

export async function aesGcmDecrypt(
  key: CryptoKey,
  nonce: Uint8Array,
  data: Uint8Array
) {
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce },
    key,
    data
  );
  return new Uint8Array(pt);
}
```

```ts
// Start flow (sketch)
async function startChallenge(challengeId: string) {
  const client = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  );
  const clientJwk = await crypto.subtle.exportKey('jwk', client.publicKey);

  const res = await fetch('/api/challenge/start', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ challengeId, clientPublicKeyJwk: clientJwk }),
  });
  const payload = await res.json();
  // Cookie with sessionKey, expectedProof, startTime is now set

  const serverPub = await crypto.subtle.importKey(
    'jwk',
    payload.serverPublicKeyJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );

  const shared = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: serverPub },
    (client as CryptoKeyPair).privateKey,
    256
  );

  const k0Raw = await hkdf(
    shared,
    base64ToBytes(payload.sessionSaltB64).buffer,
    'k0'
  );

  // All steps are delivered upfront; decrypt step 1 with k0
  const k0 = await importAesGcmKey(k0Raw);
  const step1 = payload.steps[0];
  const step1Plain = await aesGcmDecrypt(
    k0,
    base64ToBytes(step1.nonceB64),
    base64ToBytes(step1.ciphertextB64)
  );

  // Store all encrypted steps and k0; derive keys as user solves
  return { k0Raw, encryptedSteps: payload.steps, step1Plain };
}

// Derive next key after solving a step
async function deriveNextKey(
  currentKeyRaw: ArrayBuffer,
  canonicalAnswer: string,
  stepIndex: number
): Promise<ArrayBuffer> {
  const answerHash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonicalAnswer)
  );
  return hkdf(currentKeyRaw, answerHash, `step-${stepIndex + 1}`);
}

// Finish flow (sketch)
async function finishChallenge(finalKeyRaw: ArrayBuffer) {
  const proofB64 = bytesToBase64(new Uint8Array(finalKeyRaw));

  const res = await fetch('/api/challenge/finish', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ proofB64 }),
  });
  const result = await res.json();
  // result.valid, result.durationMs, result.leaderboardPosition
  return result;
}
```

---

## Project Structure

```
src/
  lib/
    engine/
      types.ts
      tree.ts          // split/merge, resize, focus utilities
      tmux.ts          // headless engine
    crypto/
      hkdf.ts
      aes-gcm.ts
    input/
      bindings.ts      // key → canonical action mapping, prefix FSM
    server/
      db/
        index.ts       // Drizzle client
        schema.ts      // leaderboard table definition
      challenges/
        registry.ts    // challenge catalog, random generation
        crypto.ts      // server-side proof encryption/validation
    ui/
      Pane.svelte      // recursive pane renderer
      StatusBar.svelte
      TerminalMini.svelte
      ChallengeHUD.svelte
  routes/
    +page.svelte       // Home (leaderboard + mini terminal)
    api/
      challenge/
        start/+server.ts   // generates challenge, returns encrypted steps
        finish/+server.ts  // validates proof, records to leaderboard
    play/
      [id]/+page.svelte
```

---

## Performance Notes

- Use DOM for panes; avoid canvas unless rendering massive text buffers.
- Use Svelte’s transitions for split animations (fast and tiny).
- Keep the engine pure and headless; derive minimal reactive slices.
- Throttle pane resize repeat keys to `requestAnimationFrame`.
- Test on Chrome, Firefox, and Safari; modifier key handling differs.

---

## Roadmap

- GitHub login (via OAuth; Auth.js or similar).
- Replay verification for top leaderboard submissions.
- PWA install for standalone mode (better keyboard capture).
- Tauri desktop build to remove browser shortcut conflicts entirely.
- Advanced tmux features (windows/sessions, copy mode) as optional packs.

---

## Caveats

- Some OS/browser shortcuts cannot be captured. Default prefix is a safe key
  (backtick) and can be customized. Canonical action mapping keeps challenges
  agnostic to user keybindings.
- Client crypto is a deterrent, not a vault. Server-side gating and timing are
  the source of truth for leaderboards.

---

## License

MIT (provisional). Update as needed for content packs and community
contributions.