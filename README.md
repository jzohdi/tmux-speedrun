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
  - Steps are generated on the server at session start.
  - Each step includes a prompt and validation logic.
  - Steps are encrypted and unlocked incrementally in a layered fashion using a
    public-key-derived session key and the previous step’s answer.
  - The only way to see the next step is by entering the correct key bindings.
- Sessions and times
  - Server uses session cookies to track a play session.
  - When the final answers for the session are submitted, the server saves the
    final time.
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

This split keeps gameplay latency entirely on the client while the server gates
content unlock and records trusted timings.

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
  - Postgres (via Supabase or a managed Postgres) for leaderboards.
  - ORM (e.g., Drizzle ORM) for type-safe DB access.
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
  - `man tmux`: shows the curated “man page” with the keys and commands used in
    challenges. This is a static, styled document bundled with the frontend.
  - `tmux`: starts a challenge session by calling the server to:
    - Create a session with a secure cookie.
    - Perform a key exchange (client-server ECDH).
    - Deliver the first encrypted step to the client.

Notes:
- The mini terminal supports basic line editing, prompt, and output rendering.
- It is not a sandboxed shell. Its purpose is discoverability and onboarding.

---

## The Challenge

- Steps generated server side
  - Each session receives a tailored list of steps (prompt + validation).
  - Steps are serialized server side and never sent in plaintext.
- Layered encryption
  - Step 1 is encrypted with a session key derived from ECDH (K0).
  - Step n+1 is encrypted with a key derived from K0 and the correct answer to
    step n. Without the correct answer, the client cannot derive the next key
    and therefore cannot see the next step.
- Client-side validation for responsiveness
  - The client’s tmux engine validates input immediately for snappy UX.
  - After solving, the client can derive the next key and decrypt the next step
    (after it is retrieved from the server encrypted with that derived key).
- Finalization
  - Upon completion, the client submits the final answers and the server stores
    the final time for the session.

---

## Keyboard Input Considerations

- Browser-reserved shortcuts (Ctrl+W, Ctrl+T, etc.) cannot be fully overridden.
- Default prefix recommendation
  - Use a safe default prefix (e.g., backtick `) to avoid conflicts.
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

Goal: Only a correct answer to step n can unlock step n+1. This is not a
bulletproof anti-cheat system, but it prevents trivial API scraping and keeps
gameplay fair enough for a casual leaderboard.

- Algorithms
  - ECDH: P-256.
  - KDF: HKDF-SHA-256.
  - Symmetric: AES-GCM-256 with 96-bit nonce.
  - Hash: SHA-256.

- Key chain
  - K0: derived from ECDH(sharedSecret) with a server-provided sessionSalt.
  - Kn+1: HKDF(Kn, salt = SHA256(canonicalAnswer_n), info = `step-${n + 1}`).

- Flow
  1. Start
     - Client generates ephemeral ECDH key pair.
     - Client POST /api/challenge/start with clientPublicKey and challengeId.
     - Server creates session, generates its ephemeral ECDH key pair, derives
       K0 with HKDF, sets httpOnly session cookie, and returns:
       - serverPublicKey
       - sessionSalt
       - ciphertext for step 1: Enc(K0, step1Payload, nonce1)
     - Client derives K0 and decrypts step 1.
  2. Solve step n locally
     - Client validates the user’s keystrokes, producing canonicalAnswer_n
       (e.g., 'split-horizontal' for %).
     - Client computes Kn+1 = HKDF(Kn, salt = SHA256(canonicalAnswer_n),
       info = `step-${n + 1}`).
     - Client requests next step:
       GET /api/challenge/next?n=n+1 (cookie attached)
     - Server computes Kn+1 using the known correct answer and returns
       ciphertext Enc(Kn+1, step(n+1), noncen+1).
     - If the client’s answer was wrong, it will not be able to decrypt.
  3. Finish
     - Client calls POST /api/challenge/finish with:
       - Summary (challengeId, totalStepsCompleted)
       - Optional proof material (e.g., hashes of per-step answers)
     - Server closes session, stores final server-side measured time, and
       writes to the leaderboard.

- Notes
  - To minimize round trips, the server may batch-return the next M encrypted
    steps on each request. The client can only decrypt them once it derives the
    required keys in order.
  - Avoid using raw keystrokes as secrets; use canonical actions (server-known,
    not user-configurable) for KDF salts to stay consistent across keybinding
    preferences.
  - This approach deters trivial scraping, but determined reverse engineering
    is still possible. Server-side timing and result verification mitigate
    cheating for casual leaderboards.

---

## Server Timing and Sessions

- Session cookie
  - httpOnly, Secure, SameSite=Lax or Strict, short TTL.
  - Contains only a session ID; all sensitive data stays server-side.
- Timing
  - Server records startTime when step 1 is issued.
  - Server records endTime when finish is called.
  - Leaderboard stores server-measured duration.
- Final answers
  - At finish, the client can send a compact summary of answers (e.g., hashed
    canonical actions per step). The server does not require it for timing but
    can store it for audits and basic anti-cheat checks.

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
  step1: {
    nonceB64: string;
    ciphertextB64: string; // Enc(K0, step1Payload)
  };
  // Optional: pre-batch of next steps, encrypted with derived keys
};

// GET /api/challenge/next?n={number}
type NextResponse = {
  step: {
    nonceB64: string;
    ciphertextB64: string; // Enc(Kn, stepPayload)
  };
};

// POST /api/challenge/finish
type FinishRequest = {
  challengeId: string;
  stepsCompleted: number;
  // Optional: per-step hashes to help audit (no plaintext answers)
  stepHashes?: Array<{ index: number; hAnswerB64: string }>;
};

type FinishResponse = {
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
  - Decrypts steps, displays prompts, tracks local progress.
  - Requests next encrypted step upon local success.
  - Handles timeouts and HUD messages.
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

- leaderboard
  - id (uuid)
  - challenge_id (text)
  - user_id (nullable, for GitHub in future)
  - username (nullable)
  - duration_ms (int)
  - created_at (timestamptz)

- sessions (optional persistence; can be in-memory cache)
  - session_id (uuid)
  - challenge_id (text)
  - start_time (timestamptz)
  - end_time (nullable)
  - steps_completed (int)
  - ephemeral_server_key (kept only in memory)

Supabase Postgres is a good default. Add RLS when enabling user accounts.

---

## Development

Prereqs
- Node.js 20+
- pnpm (recommended)

Install
```bash
pnpm install
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

Environment variables (examples)
- DATABASE_URL: Postgres connection string.
- SUPABASE_KEY / SUPABASE_URL: if using Supabase client.
- SESSION_SECRET: for signing cookies if needed.
- ORIGIN: allowed origin(s) for CORS and CSRF policies.

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
  const k0 = await importAesGcmKey(k0Raw);

  const step1Plain = await aesGcmDecrypt(
    k0,
    base64ToBytes(payload.step1.nonceB64),
    base64ToBytes(payload.step1.ciphertextB64)
  );

  // ... parse step 1 and render
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
    challenges/
      registry.ts      // server-side catalog, generation
    ui/
      Pane.svelte      // recursive pane renderer
      StatusBar.svelte
      TerminalMini.svelte
      ChallengeHUD.svelte
  routes/
    +page.svelte       // Home (leaderboard + mini terminal)
    api/
      challenge/
        start/+server.ts
        next/+server.ts
        finish/+server.ts
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

- GitHub login (via OAuth; Supabase Auth or Auth.js).
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