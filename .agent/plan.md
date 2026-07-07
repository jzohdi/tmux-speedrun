# Plan — Improve site hero/top bar (issue #39)

## Goal

Move the **Open Source** badge and the auth controls (GitHub sign-in / signed-in
username + sign-out) out of the hero body (`.hero-content`) and into a dedicated
top **navbar** so the landing page has a cleaner header. Brand/Open Source on the
left, auth control on the right. The navbar must be mobile-friendly (no horizontal
overflow at ≤640px) and stay on-theme (dark/green). No auth-logic or backend changes.

## Where the code lives

Everything is in a single file: `src/routes/+page.svelte`.

- Lines 87–105: the `<a class="badge">` Open Source link (GitHub icon + "Open Source").
- Lines 107–131: the `<div class="auth-bar">` with the `{#if data.user}` branch
  (signed-in indicator + Sign out) and the `{:else}` branch (Sign in with GitHub).
- Lines 11–20: `signIn()` (full navigation to `/api/auth/github/login`) and
  `signOut()` (POST `/api/auth/logout` then `window.location.reload()`). **Unchanged.**
- `data.user` comes from `+layout.server.ts`; `data.user.username` is the display name.
- CSS for `.badge`, `.auth-bar`, `.signed-in`, `.auth-btn` etc. lives in the `<style>`
  block (lines ~240–328), plus the `@media (max-width: 640px)` block (lines ~428–447).

## Approach

1. **Add a `<nav class="navbar">` as the first child of `<main class="landing-page">`**,
   rendered above the `.hero` section (after the `bg-grid`/`bg-glow` decorative divs so
   it sits in the normal flow with `z-index: 1`). Structure:
   - `.navbar` is a flex row: `justify-content: space-between; align-items: center`.
   - Left side (`.nav-brand`): the existing Open Source `<a class="badge">` markup,
     moved verbatim (keeps its GitHub `href`, `target`, `rel`, icon, and label).
   - Right side (`.nav-auth`): the existing auth markup — the whole `{#if data.user} …
     {:else} … {/if}` block moved verbatim, keeping `onclick={signOut}` / `onclick={signIn}`
     and the `data.user` / `data.user.username` bindings.
2. **Remove** the badge (`<a class="badge">`) and the `<div class="auth-bar">` from inside
   `.hero-content`. The hero then starts directly with the `<h1 class="title">`.
3. **Constrain the navbar width** to match the page content: give the navbar an inner
   container (or `max-width` + `margin: 0 auto`) consistent with the hero's centering, with
   horizontal padding matching the hero (24px desktop / 16px mobile). Keep the hero title
   centered as it is today; the navbar content is left/right aligned within its own row.
4. **Styling**: reuse the existing `.badge`, `.auth-btn`, `.signed-in` styles as-is (they
   already match the theme). Remove the now-unused `margin-bottom` centering rules that made
   sense only inside the hero:
   - `.badge` had `margin-bottom: 24px` — drop/neutralize inside the navbar.
   - `.auth-bar` used `justify-content: center` + `margin-bottom: 24px` — the navbar's
     right cell should right-align instead; rename to `.nav-auth` or restyle so it no longer
     forces centering/bottom margin.
   Give `.navbar` a subtle bottom border or transparent background consistent with the theme
   (e.g. a thin `rgba(255,255,255,0.05)` border-bottom like `.footer`, or leave transparent).
5. **Adjust hero top padding** so the title isn't crowded now that the badge/auth no longer
   occupy vertical space above it (the hero currently has `padding: 80px 24px 40px`). Keep a
   comfortable gap below the navbar.

## Responsiveness (≤640px)

- `.navbar` uses `flex-wrap: wrap` and/or `gap` so the brand and auth controls wrap to two
  rows rather than overflowing on narrow screens. Verify no horizontal scrollbar appears.
- Keep tap targets readable: preserve existing `.auth-btn` / `.badge` padding and font sizes.
- The "signed in as {username}" text can be long; ensure it wraps or truncates within the
  auth cell rather than pushing the layout wide (e.g. allow wrapping, `min-width: 0`).
- Extend the existing `@media (max-width: 640px)` block with navbar padding (16px) and any
  wrap/alignment tweaks (e.g. center the wrapped rows or keep space-between as appropriate).

## Risks & edge cases

- **Long usernames** overflowing the navbar on mobile — mitigate with wrapping / `min-width: 0`.
- **z-index / stacking**: navbar must render above `.bg-grid`/`.bg-glow` (`z-index: 1`) like the
  hero, so it's clickable.
- **Signed-out vs signed-in** both branches must render correctly in the new right cell.
- Ensure the moved markup keeps the same event handlers and `data.user` guards so sign-in /
  sign-out behavior is byte-for-byte unchanged.
- Don't leave orphaned/unused CSS selectors that could confuse future edits — rename or reuse
  the `.auth-bar` styles cleanly.

## Testing

- **Build/typecheck**: run the project's `npm run check` / lint / build to confirm no Svelte
  or TS errors after the markup move.
- **Manual (dev server)** at desktop and ≤640px widths:
  - Signed-out: navbar shows Open Source (left) + "Sign in with GitHub" (right); clicking
    sign-in navigates to `/api/auth/github/login`; hero title is no longer preceded by the
    stacked badge/auth.
  - Signed-in (mock `data.user`): navbar shows Open Source + "signed in as <username>" +
    Sign out; clicking Sign out POSTs `/api/auth/logout` and reloads.
  - Resize to ≤640px: confirm no horizontal overflow, controls wrap and stay tappable/readable.
  - Open Source link still points to the GitHub repo and opens in a new tab.
- If a component/browser test renders `+page.svelte` standalone (default `data = { user: null }`),
  confirm it still mounts.

## Scope flags

- `needs_frontend`: true (Svelte markup + CSS only).
- `needs_backend`: false (no auth logic, routes, or server code touched).
