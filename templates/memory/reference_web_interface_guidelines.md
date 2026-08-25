---
name: Web Interface Guidelines (vendored)
description: Vercel's Web Interface Guidelines, pinned and vendored — the static UI rule set publisher runs in its Step 5 self-check, covering a11y, focus, forms, animation, performance and i18n
type: reference
---

## ⚡ Key Rules Summary

- ✅ DO: Run this rule set in **publisher Step 5** (static self-check), on the files publisher just authored — every publish, no `base_url` needed
- ✅ DO: Treat a hit as a **self-fix**, not a user-facing finding — same as the token/naming checks it sits beside
- ✅ DO: Respect `quality_flags` — apply the **i18n**, **Dark Mode & Theming**, and responsive rules only when the matching flag is true (§ Flag-gated rules)
- ✅ DO: Report `file:line — issue`, terse, no preamble
- ❌ DON'T: Re-report a violation axe-core already flagged in Step 6 — static runs first, runtime wins on duplicates (§ Overlap with axe-core)
- ❌ DON'T: Re-run this in code-reviewer or e2e-tester — publisher owns it, per the de-duplication matrix in `reference_agent_pipeline.md`
- ❌ DON'T: Fetch the rules over the network at review time — this file **is** the pinned copy; a QA gate whose rules can change under it is not a gate
- ❌ DON'T: Edit the vendored block below by hand — refresh it wholesale (§ Provenance) so the pin stays honest

---

## Provenance

| | |
|---|---|
| Source | [vercel-labs/web-interface-guidelines](https://github.com/vercel-labs/web-interface-guidelines) — `command.md` |
| Pinned commit | `e3d624baaf29dc1fc645aff3e38f03e564d2d6b1` (2026-08-18) |
| Vendored on | 2026-08-26 |
| License | MIT © 2025 Vercel Labs |

**Why vendored rather than fetched.** The upstream skill fetches `command.md` fresh on every run. That makes the rule set a moving target: the same code reviewed twice can produce different results, the gate needs network to work at all, and an upstream edit silently changes what the harness enforces. A QA gate has to be reproducible, so the rules are pinned here instead.

**To refresh:**

```bash
curl -s https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md
# diff against the vendored block below, replace it wholesale, and update the
# pinned commit + vendored-on dates above in the same commit
```

---

## Integration

### Where it runs

publisher **Step 5 (Self-Verification)**, alongside token compliance, naming compliance, and the static a11y check. It is a source-level review of the markup publisher just wrote — no browser, no running server, so it is the **only** UI quality gate available on a greenfield project before a dev server exists.

### Overlap with axe-core (Step 6)

The two overlap on a handful of a11y rules (`aria-label` on icon buttons, `alt` on images, label association) and are otherwise disjoint — axe-core cannot see keyboard handlers that were never written, `transition: all`, missing `prefers-reduced-motion`, or hardcoded copy.

- Static (Step 5) runs first and fixes what it finds.
- If Step 6 runs and axe-core reports the same violation, **report it once** — the runtime finding is the authoritative one. Do not list both.
- If Step 6 is skipped (`visual_status: skipped`), this check stands alone and is the entire a11y gate for that publish.

### Flag-gated rules

Some rules assume scope publisher only takes on when told to. Apply them **only** when the matching `quality_flags` is true:

| Rule section | Gate |
|---|---|
| `Locale & i18n` | `quality_flags.i18n` |
| `Dark Mode & Theming` | `quality_flags.dark_mode` |
| Viewport/breakpoint-dependent rules in `Safe Areas & Layout` | `quality_flags.responsive` |

All other sections are **always** enforced, the same way a11y and UI-state coverage always are.

---

<!-- BEGIN vendored: vercel-labs/web-interface-guidelines @ e3d624ba — do not hand-edit, refresh wholesale -->

## Rules

### Accessibility

- Icon-only buttons need `aria-label`
- Form controls need `<label>` or `aria-label`
- Interactive elements need keyboard handlers (`onKeyDown`/`onKeyUp`)
- `<button>` for actions, `<a>`/`<Link>` for navigation (not `<div onClick>`)
- Images need `alt` (or `alt=""` if decorative)
- Decorative icons need `aria-hidden="true"`
- Async updates (toasts, validation) need `aria-live="polite"`
- Use semantic HTML (`<button>`, `<a>`, `<label>`, `<table>`) before ARIA
- Headings hierarchical `<h1>`–`<h6>`; include skip link for main content
- `scroll-margin-top` on heading anchors
- Meaningful media needs captions, transcripts, or descriptions as applicable
- Media controls need keyboard support; decorative media needs assistive-tech hiding

### Focus States

- Interactive elements need visible focus: `focus-visible:ring-*` or equivalent
- Never `outline-none` / `outline: none` without focus replacement
- Use `:focus-visible` over `:focus` (avoid focus ring on click)
- Group focus with `:focus-within` for compound controls
- Sticky headers/footers/overlays must not cover the focused element

### Forms

- Inputs need `autocomplete` and meaningful `name`
- Use correct `type` (`email`, `tel`, `url`, `number`) and `inputmode`
- Never block paste (`onPaste` + `preventDefault`)
- Labels clickable (`htmlFor` or wrapping control)
- Disable spellcheck on emails, codes, usernames (`spellCheck={false}`)
- Checkboxes/radios: label + control share single hit target (no dead zones)
- Submit button stays enabled until request starts; spinner during request
- Errors inline next to fields; focus first error on submit
- Placeholders end with `…` and show example pattern
- `autocomplete="off"` on non-auth fields to avoid password manager triggers
- Warn before navigation with unsaved changes (`beforeunload` or router guard)

### Animation

- Honor `prefers-reduced-motion` (provide reduced variant or disable)
- Animate `transform`/`opacity` only (compositor-friendly)
- Never `transition: all`—list properties explicitly
- Set correct `transform-origin`
- SVG: transforms on `<g>` wrapper with `transform-box: fill-box; transform-origin: center`
- Animations interruptible—respond to user input mid-animation
- Autoplay motion >5 seconds alongside other content needs pause, stop, or hide controls
- Muted decorative loops must stop under `prefers-reduced-motion`

### Typography

- `…` not `...`
- Curly quotes `“` `”` not straight `"`
- Non-breaking spaces: `10&nbsp;MB`, `⌘&nbsp;K`, brand names
- Loading states end with `…`: `"Loading…"`, `"Saving…"`
- `font-variant-numeric: tabular-nums` for number columns/comparisons
- Use `text-wrap: balance` or `text-pretty` on headings (prevents widows)

### Content Handling

- Text containers handle long content: `truncate`, `line-clamp-*`, or `break-words`
- Flex children need `min-w-0` to allow text truncation
- Handle empty states—don't render broken UI for empty strings/arrays
- User-generated content: anticipate short, average, and very long inputs

### Images

- `<img>` needs explicit `width` and `height` (prevents CLS)
- Below-fold images: `loading="lazy"`
- Above-fold critical images: `priority` or `fetchpriority="high"`

### Performance

- Large lists (>50 items): virtualize (`virtua`, `content-visibility: auto`)
- No layout reads in render (`getBoundingClientRect`, `offsetHeight`, `offsetWidth`, `scrollTop`)
- Batch DOM reads/writes; avoid interleaving
- Prefer uncontrolled inputs; controlled inputs must be cheap per keystroke
- Add `<link rel="preconnect">` for CDN/asset domains
- Critical fonts: `<link rel="preload" as="font">` with `font-display: swap`
- Prefer `<video autoplay muted loop playsinline>` over animated GIF; provide a still alternative
- Short non-essential loops: Safari H.264 MP4 `<picture>` source, `prefers-reduced-motion` media condition, and still fallback

### Navigation & State

- URL reflects state—filters, tabs, pagination, expanded panels in query params
- Links use `<a>`/`<Link>` (Cmd/Ctrl+click, middle-click support)
- Deep-link all stateful UI (if uses `useState`, consider URL sync via nuqs or similar)
- Destructive actions need confirmation modal or undo window—never immediate

### Touch & Interaction

- `touch-action: manipulation` (prevents double-tap zoom delay)
- `-webkit-tap-highlight-color` set intentionally
- `overscroll-behavior: contain` in modals/drawers/sheets
- During drag: disable text selection, `inert` on dragged elements
- Drag/swipe/pinch/path gestures need tap/click and keyboard alternatives unless essential
- `autoFocus` sparingly—desktop only, single primary input; avoid on mobile

### Safe Areas & Layout

- Full-bleed layouts need `env(safe-area-inset-*)` for notches
- Avoid unwanted scrollbars: `overflow-x-hidden` on containers, fix content overflow
- Flex/grid over JS measurement for layout

### Dark Mode & Theming

- `color-scheme: dark` on `<html>` for dark themes (fixes scrollbar, inputs)
- `<meta name="theme-color">` matches page background
- Native `<select>`: explicit `background-color` and `color` (Windows dark mode)

### Locale & i18n

- Dates/times: use `Intl.DateTimeFormat` not hardcoded formats
- Numbers/currency: use `Intl.NumberFormat` not hardcoded formats
- Detect language via `Accept-Language` / `navigator.languages`, not IP
- Brand names, code tokens, identifiers: wrap with `translate="no"` to prevent garbled auto-translation

### Hydration Safety

- Inputs with `value` need `onChange` (or use `defaultValue` for uncontrolled)
- Date/time rendering: guard against hydration mismatch (server vs client)
- `suppressHydrationWarning` only where truly needed

### Hover & Interactive States

- Buttons/links need `hover:` state (visual feedback)
- Interactive states increase contrast: hover/active/focus more prominent than rest

### Content & Copy

- Active voice: "Install the CLI" not "The CLI will be installed"
- Title Case for headings/buttons (Chicago style)
- Numerals for counts: "8 deployments" not "eight"
- Specific button labels: "Save API Key" not "Continue"
- Error messages include fix/next step, not just problem
- Second person; avoid first person
- `&` over "and" where space-constrained

### Anti-patterns (flag these)

- `user-scalable=no` or `maximum-scale=1` disabling zoom
- `onPaste` with `preventDefault`
- `transition: all`
- `outline-none` without focus-visible replacement
- Inline `onClick` navigation without `<a>`
- `<div>` or `<span>` with click handlers (should be `<button>`)
- Images without dimensions
- Large arrays `.map()` without virtualization
- Form inputs without labels
- Icon buttons without `aria-label`
- Hardcoded date/number formats (use `Intl.*`)
- `autoFocus` without clear justification
- Animated GIF when compressed video is suitable
- Gesture-only action without tap/click and keyboard alternative

<!-- END vendored -->

---

## Output Format

Report each hit as `file:line — issue`, grouped by file, terse. State the issue and its location; skip the explanation unless the fix is non-obvious. No preamble.

```text
src/pages/UserList.tsx:42 — icon button missing aria-label
src/pages/UserList.tsx:55 — animation missing prefers-reduced-motion
src/pages/UserList.tsx:67 — transition: all → list properties
```

A file with no hits needs no line at all. In publisher's report these land in `self_check` as fixed items, not in the user-facing findings list.

---

## ✅ Checklist (publisher, Step 5)

- [ ] Ran against the files authored in **this** publish, not the whole project
- [ ] `Locale & i18n` / `Dark Mode & Theming` / responsive rules applied **iff** the matching `quality_flags` is true
- [ ] Every hit self-fixed before reporting (not surfaced as a user-facing finding)
- [ ] Violations also caught by axe-core in Step 6 reported **once**, not twice
- [ ] Rules read from this vendored file — no network fetch at review time
- [ ] `self_check.web_interface_guidelines` set to `pass | fixed | fail` in the publish report
