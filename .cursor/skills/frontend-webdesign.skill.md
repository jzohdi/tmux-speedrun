# skills.md — Award-Caliber Web Design + UI/UX Implementation (Tech-Agnostic)

> **Mandate:** Ship interfaces that feel premium, calm, and inevitable: high clarity, strong hierarchy, flawless states, accessible by default, and performant.  
> **Primary constraint:** Design decisions must be **consistent, reusable, and shippable**—not just pretty in a mock.

---

## 0) Operating Mode

### Always optimize for (in order)
1. **Comprehension** (users instantly understand what this is + what to do)
2. **Confidence** (users trust outcomes, states, and data)
3. **Efficiency** (minimal steps, minimal friction, minimal waiting)
4. **Delight** (tasteful polish that never harms #1–#3)

### Default assumptions when requirements are missing
- Choose **standard patterns** unless there’s a strong reason to break them.
- Prefer **progressive disclosure** and safe defaults.
- Implement **reversible actions** (undo) over risky confirmations when possible.
- Document assumptions at the end as “Assumptions / Tradeoffs”.

### Visual north star
“**Quiet confidence**”: generous spacing, crisp typography, restrained color, and micro-interactions that feel expensive (subtle, consistent, fast).

---

## 1) Input Contract (What the Agent Must Establish)

Before implementing UI, determine:
- **Primary user** + their **primary job-to-be-done**
- **Single primary action** for the screen
- **Information hierarchy** (what matters most, second, third)
- **Data states** (loading/empty/error/partial)
- **Success criteria** (how a user knows they completed the task)

If you can’t get this explicitly, infer the most likely intent and proceed.

---

## 2) Execution Workflow (Design → Build)

### The “7-pass” build loop
1. **Structure pass:** layout + landmarks + content order (no styling yet)
2. **Hierarchy pass:** headings, grouping, spacing rhythm
3. **Component pass:** select primitives, states, and variants
4. **Interaction pass:** focus behavior, keyboard flow, feedback, errors
5. **Responsive pass:** small → medium → large; spacing + density
6. **Polish pass:** microcopy, icons, subtle motion, empty states
7. **Quality pass:** accessibility + performance + consistency scan

> Rule: Don’t “polish” until structure and hierarchy are correct.

---

## 3) System Thinking (Tokens & Constraints)

### Treat the UI as a system (even if you don’t have one)
**Never invent random values.** Use a small set of tokens:
- **Spacing scale:** 4 / 8 / 12 / 16 / 24 / 32 / 48 / 64
- **Radii:** 8 / 12 / 16 (pick 1–2)
- **Elevation:** 0 / 1 / 2 (very restrained)
- **Typography:** 1–2 font families max; defined sizes + line-heights
- **Color roles (not raw colors):**
  - background, surface, surfaceRaised
  - text, textMuted
  - border, borderSubtle
  - primary, primaryHover
  - danger, warning, success, info

### Consistency rules
- If a pattern appears **twice**, consider extracting it.
- If a decision appears **three times**, it becomes a rule or token.

---

## 4) Layout, Composition, and Visual Rhythm (Award-Winning Basics)

### Page composition defaults
- Use a **single dominant column** for readability.
- Control line length: body text should rarely exceed ~70–80 characters per line.
- Use **intentional whitespace**: spacing communicates structure more than borders do.
- Prefer **grid alignment** over “floating” elements.

### Layout patterns that read as premium
- **Header zone:** Title + short supporting line + primary CTA
- **Content zone:** grouped sections with clear separators (space, not lines)
- **Action zone:** sticky actions only when needed and only on long flows
- **Data dense zone:** tables/lists with strong alignment and scannability

### Spacing rhythm checklist
- [ ] Sections separated by 24–48
- [ ] Related items grouped with 8–16
- [ ] Labels close to inputs (4–8)
- [ ] Lists use consistent row height + alignment
- [ ] No “one-off” margins/paddings

---

## 5) Typography (The Fastest Path to “Looks Expensive”)

### Hierarchy rules
- One **H1** per page, clearly dominant.
- Subheads guide scanning; avoid too many levels.
- Use **weight/size/spacing** for hierarchy before using color.

### Defaults
- Body text: comfortable line-height (avoid cramped).
- Small text: never too light; keep contrast high.
- Use **tabular numerals** for financial/data displays when available.
- Avoid ALL CAPS for long labels; use sparingly for badges.

### Micro-typography
- Use real punctuation and proper casing.
- Prefer sentence case for UI labels.
- Use consistent terminology across the product.

---

## 6) Color, Contrast, and “Taste”

### Color discipline
- Color is for **meaning** (state/priority), not decoration.
- Keep accent colors rare; let typography + spacing do most of the work.
- Prefer subtle tints and borders over loud fills.

### Contrast and legibility
- Text contrast should meet WCAG AA in normal usage.
- Don’t rely on color alone to convey state (add icon/text).

### Dark mode (if supported)
- Don’t invert blindly—use role tokens and tuned surfaces.
- Avoid pure black backgrounds; prefer near-black surfaces for comfort.

---

## 7) Components & Interaction Patterns (Product-Grade)

### Component selection rules
- Prefer proven primitives: button, input, select, checkbox, radio, toggle, tabs, tooltip, modal, toast, table, card.
- Choose one primary component pattern per job:
  - Navigation: tabs OR sidebar OR segmented control (not all)
  - Confirmation: inline success OR toast OR modal (not redundant)

### Button system (must be consistent)
- Variants: **primary**, **secondary**, **ghost/link**, **danger**
- Sizes: 2 max (default + compact)
- Rules:
  - Only **one** primary button per view (usually).
  - Primary actions are visually dominant and placed predictably.
  - Disabled states still readable; show why when possible.

### Forms
- Labels always visible (don’t rely on placeholder).
- Inline help text for constraints; examples beat rules.
- Validation:
  - Validate on blur or submit (avoid noisy “live errors”)
  - Errors must explain **how to fix**
  - Keep values on error; never wipe inputs
- For long forms: chunk into sections; consider autosave.

### Lists and tables
- Scannability is king: alignment, spacing, and consistent columns.
- Provide:
  - sorting (when valuable)
  - empty state guidance
  - row actions that don’t clutter (use kebab/overflow carefully)

---

## 8) State Design (Where Most UIs Fail)

Every interactive surface must support:
- **Initial loading** (skeleton preferred for structured content)
- **Background loading** (subtle, don’t block reading)
- **Empty** (explain why + show next step)
- **Error** (what happened + what user can do)
- **Success** (confirmation + suggested next action)
- **Partial data** (some sections load; show independent states)

### “Premium” state behaviors
- Skeletons match real layout (avoid generic gray blocks).
- Empty states use calm language + a single clear CTA.
- Errors never blame the user; always provide recovery.

---

## 9) Microcopy & Content Design (UI Words Matter)

### Writing rules
- Buttons use verbs: “Save”, “Create”, “Continue”, “Try again”.
- Avoid “Submit”.
- Replace vague messages:
  - Bad: “Something went wrong”
  - Good: “Couldn’t save changes. Check your connection and try again.”

### Tone
- Calm, concise, specific.
- No jokes in error states.
- Confirmations should be short, not celebratory unless brand demands it.

---

## 10) Motion & Micro-Interactions (Delight Without Noise)

### Motion principles
- Motion explains **cause → effect** and supports orientation.
- Keep durations short and consistent.
- Respect reduced motion preferences.

### Where motion helps most
- Hover/focus transitions (subtle)
- Expand/collapse (height + opacity, not chaos)
- Toasts + inline validation (gentle)
- Skeleton shimmer (optional; keep minimal)

### Avoid
- Big bouncy animations
- Unnecessary parallax
- Long easing that feels sluggish

---

## 11) Accessibility (Baseline, Not Optional)

### Must-pass checklist
- [ ] All controls reachable via keyboard
- [ ] Focus indicator is visible and consistent
- [ ] Correct semantics (buttons for actions, links for navigation)
- [ ] Inputs have labels; errors are announced and associated
- [ ] Headings in correct order
- [ ] Contrast sufficient for text, icons, focus rings
- [ ] Reduced motion respected

### Interaction a11y
- Modals: focus trap + escape closes + returns focus on close
- Menus: keyboard navigation works predictably

---

## 12) Responsiveness & Density

### Breakpoint strategy
- Mobile-first: ensure primary action is effortless at ~360–430px.
- Increase density carefully with screen size—don’t just add columns.

### Mobile UX rules
- Large enough tap targets.
- Avoid hover-only interactions.
- Sticky primary actions only when the flow is long and action is frequent.

---

## 13) Performance as UX

### Must-do behaviors
- Avoid layout shift: reserve space for images/async sections.
- Prefer progressive rendering (don’t block whole pages for one request).
- Defer non-critical visuals.
- Don’t ship heavy dependencies without clear benefit.

### Perceived speed
- Skeletons for content surfaces
- Instant feedback on click
- Optimistic UI where safe (with rollback)

---

## 14) Implementation Discipline (Engineering Decisions)

### Maintainability rules
- Prefer composable primitives over bespoke one-offs.
- Keep state minimal; derive when possible.
- Avoid boolean soup; use named states/enums conceptually.

### Data & errors
- Handle failures at boundaries (network/auth/validation).
- Provide user-recoverable paths (retry, re-auth, undo).
- Don’t leak sensitive info in UI errors.

### Consistency enforcement
- Reuse patterns; don’t create “near duplicates”.
- If styling differs, justify why (context, hierarchy, emphasis).

---

## 15) Design Review Gate (Final Pass Questions)

Answer “yes” to all:
1. **3-second test:** Can a new user tell what this is and what to do?
2. **Hierarchy:** Is there a clear primary action and visual order?
3. **States:** Are loading/empty/error/success intentional and helpful?
4. **A11y:** Can a keyboard-only user complete the main task?
5. **Responsiveness:** Does it feel designed (not merely “shrunk”)?
6. **Consistency:** Does it match existing patterns and tokens?
7. **Taste:** Is color restrained and typography doing the heavy lifting?
8. **Performance:** No jank, no major shifts, no unnecessary blocking?

---

## 16) Definition of Done (Ship Checklist)

### UI/UX
- [ ] Primary flow is minimal and clear
- [ ] Scannable layout with consistent spacing rhythm
- [ ] Components follow a consistent variant system
- [ ] Microcopy is specific and helpful

### States
- [ ] Loading/empty/error/success implemented
- [ ] No dead ends; recovery paths exist

### Accessibility
- [ ] Keyboard + focus + semantics + contrast pass

### Responsiveness
- [ ] Works cleanly at small/medium/large widths

### Quality
- [ ] No console errors in normal use
- [ ] No layout shift for key content
- [ ] Repeated patterns extracted or standardized

---

## 17) Anti-Patterns (Do Not Ship)

- Multiple competing primary CTAs on one screen
- Random spacing values or inconsistent radii
- Placeholder-as-label forms
- Spinners-only loading for structured content
- Hover-only critical controls
- Vague errors without recovery
- Overuse of borders/shadows to “separate” everything
- Decorative motion that slows the interface

---

## 18) Output Requirements (How the Agent Should Report Work)

When delivering a UI change, include:
- **Summary:** what changed
- **Why:** user impact (clarity / confidence / speed)
- **States covered:** loading/empty/error/success
- **A11y notes:** keyboard/focus/semantics/contrast
- **Assumptions / tradeoffs:** anything inferred

--- 

## 19) “If Unsure” Defaults

- Choose the simplest pattern that preserves power.
- Prefer inline clarity over documentation.
- Prefer fewer controls with better defaults.
- Prefer reusable patterns over one-off polish.
- Prefer calm typography + spacing over loud visuals.

