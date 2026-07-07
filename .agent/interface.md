# Interface — Improve site hero/top bar (issue #39)

This is a **frontend-only** change to a single Svelte component:
`src/routes/+page.svelte`. There are **no TypeScript API changes**, no new modules,
and no backend/route changes. The "interface" the implementation must satisfy is the
**DOM structure, CSS class contract, and behavioral invariants** below. The `tdd`
stage writes tests against these; the implementation must render exactly this shape.

## Unchanged contracts (must be preserved byte-for-byte in behavior)

The following existing `<script>` symbols and props are **not modified**:

- `let { data = { user: null } }: { data?: PageData } = $props();`
  - Default `data.user === null` (component still mounts standalone in tests).
  - `data.user.username: string` is the signed-in display name.
- `function signIn()` → sets `window.location.href = '/api/auth/github/login'`.
- `async function signOut()` → `await fetch('/api/auth/logout', { method: 'POST' })`
  then `window.location.reload()`.
- The `hints` array, `terminal` state, `<svelte:head>`, `<Terminal>` section, and
  footer are untouched.

Event bindings on the moved auth controls stay identical: `onclick={signIn}` on the
sign-in button, `onclick={signOut}` on the sign-out button.

## New DOM structure

Inside `<main class="landing-page">`, after the two decorative background divs
(`.bg-grid`, `.bg-glow`) and **before** `<section class="hero">`, add a top navbar:

```
<nav class="navbar">
  <div class="nav-inner">
    <!-- LEFT: brand / Open Source badge (moved verbatim from hero) -->
    <a
      href="https://github.com/jzohdi/tmux-speedrun"
      target="_blank"
      rel="noopener noreferrer"
      class="badge"
    >
      <svg …>…</svg>          <!-- GitHub icon, unchanged -->
      <span>Open Source</span>
    </a>

    <!-- RIGHT: auth control (moved verbatim from hero) -->
    <div class="nav-auth">
      {#if data.user}
        <span class="signed-in" title="Verified GitHub identity">
          <span class="dot" aria-hidden="true">●</span>
          signed in as {data.user.username}
        </span>
        <button type="button" class="auth-btn" onclick={signOut}>Sign out</button>
      {:else}
        <button type="button" class="auth-btn signin" onclick={signIn}>
          <svg …>…</svg>       <!-- GitHub icon, unchanged -->
          Sign in with GitHub
        </button>
      {/if}
    </div>
  </div>
</nav>
```

Then `<section class="hero"> → <div class="hero-content">` starts directly with
`<h1 class="title">` — the `.badge` `<a>` and the `.auth-bar` `<div>` are **removed**
from `.hero-content`.

### Class contract (what tests may assert)

| Selector | Role | Notes |
|---|---|---|
| `nav.navbar` | top navbar container | new; renders once, above `.hero` |
| `.nav-inner` | centered inner row | flex, space-between; max-width matches hero |
| `a.badge` | Open Source link | moved; same `href`/`target`/`rel`/icon/`<span>Open Source</span>` |
| `.nav-auth` | auth cell (right) | replaces `.auth-bar`; holds the `{#if data.user}` block |
| `.signed-in` | signed-in indicator | unchanged markup; contains `signed in as {username}` |
| `.auth-btn` | Sign out button | `onclick={signOut}` |
| `.auth-btn.signin` | Sign in button | `onclick={signIn}` |

`.badge` and `.auth-bar` must **not** appear inside `.hero-content` anymore. The
`.auth-bar` class is renamed to `.nav-auth` (or otherwise no longer forces
centering/bottom-margin); do not leave an orphaned `.auth-bar` selector.

## Layout & styling invariants

1. **Navbar layout**: `.nav-inner` is `display: flex; align-items: center;
   justify-content: space-between;` — brand left, auth right.
2. **Centering/width**: `.nav-inner` uses `margin: 0 auto` with a `max-width`
   consistent with the page (hero content is `max-width: 700px`; the navbar may be
   wider, but pick a deliberate value) and horizontal padding of **24px desktop**.
3. **Stacking**: `.navbar` renders above `.bg-grid`/`.bg-glow` (which are `z-index: 0`),
   so it needs `position: relative; z-index: 1;` to stay clickable.
4. **Theme**: reuse existing `.badge`, `.auth-btn`, `.signed-in` styles as-is (already
   dark/green). Optionally give `.navbar` a subtle bottom border
   (`1px solid rgba(255,255,255,0.05)`, matching `.footer`) or leave transparent.
5. **Remove hero-only spacing**: drop `.badge { margin-bottom: 24px }` and the
   `.auth-bar { justify-content: center; margin-bottom: 24px }` centering — the navbar
   right-aligns auth instead.
6. **Hero top padding**: reduce `.hero` top padding (currently `80px 24px 40px`) so the
   title isn't crowded now that nothing stacks above it; keep a comfortable gap below
   the navbar. (Exact value at implementer's discretion.)

## Responsiveness (≤640px) — acceptance-critical

- No horizontal overflow at ≤640px (page already has `overflow-x: hidden`, but the
  navbar content must not force width).
- `.nav-inner` should `flex-wrap: wrap` (with `gap`) so brand and auth wrap to two rows
  on narrow screens rather than overflowing.
- Long usernames must wrap/shrink within `.nav-auth` (e.g. `min-width: 0`, allow
  wrapping) and not push the layout wide.
- Preserve tap-target sizing: keep existing `.auth-btn` / `.badge` padding & font size.
- Extend the existing `@media (max-width: 640px)` block with navbar padding (16px to
  match hero mobile) and any wrap/alignment tweaks.

## Behavioral invariants (for tests)

- **Signed out** (`data.user == null`): navbar shows the Open Source link and a
  "Sign in with GitHub" button (`.auth-btn.signin`); no `.signed-in` element.
- **Signed in** (`data.user = { username }`): navbar shows the Open Source link, a
  `.signed-in` element containing the username, and a "Sign out" button (`.auth-btn`);
  no `.signin` button.
- Clicking Sign in triggers `signIn()` (navigates to `/api/auth/github/login`).
- Clicking Sign out triggers `signOut()` (POST `/api/auth/logout`, then reload).
- The Open Source `<a>` keeps `href="https://github.com/jzohdi/tmux-speedrun"`,
  `target="_blank"`, `rel="noopener noreferrer"`.
- No `.badge` or auth control remains inside `.hero-content`.

## Verification

- `npm run check` (svelte-check/tsc) passes with no new errors.
- Existing/added component tests for signed-in and signed-out states render correctly.
```