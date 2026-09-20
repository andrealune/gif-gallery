# Reduced-motion & pause/stop for auto-playing thumbnails

Status: **Draft — pending product-lead scope decision (see "Open decision" below and L42-466).**
Owner: product-designer. Reviewers: product-lead, frontend-engineer, backend-engineer, cto.
Related: L42-466 (this spec's driving issue), L42-451, L42-450/L42-449, L42-462.

## 1. Problem this standardizes

`GifCard` and `CategoryCard` both render a live, indefinitely-looping animated GIF as their
thumbnail (`<img src={thumbnailUrl}>`), with no way for a user to pause, stop or hide it, and no
`prefers-reduced-motion` branch anywhere in `web/src/app/globals.css` or either component. That is
a WCAG 2.2.2 (Pause, Stop, Hide) exposure on every grid and the detail page, and `CategoryCard`'s
own review comment shows it was written by citing `GifCard` as precedent. This spec is the
standing rule so the *next* thumbnail surface has a real pattern to copy instead of the gap.

**Important technical constraint driving the design below:** an `<img>` pointed at an animated GIF
cannot be paused with CSS (there is no `animation-play-state` for native GIF playback). The only
way to stop the animation, for *any* user — not only those with `prefers-reduced-motion: reduce` —
is to swap the `src` to a static frame. This means both options the issue proposed converge on the
same technical prerequisite: **a static poster-frame asset**, and there is no CSS-only fix. This
is also why 2.2.2 needs a real solution and not a `@media (prefers-reduced-motion: reduce)` rule in
`globals.css` alone — 2.2.2 applies to every user; `prefers-reduced-motion` is an *additional*
constraint on top, not a substitute mechanism.

## 2. Pattern: `AnimatedThumbnail`

One component-level pattern, used identically by `GifCard`, `CategoryCard`, and the gif detail
page's hero image. Do not special-case any of the three.

### 2.1 Data contract (backend dependency)

Every surface needs a **static poster** alongside the animated asset:

- `GifSummary`/`GifDetail`: add `posterUrl: string | null` — the first frame of the gif, generated
  by `server/src/services/gif/converter.ts` (which already probes the output with ffprobe; adding
  a single-frame `-vframes 1` extraction alongside the existing conversion is the natural place).
- `CategorySummary.thumbnailUrl` already points at "the most recent active gif in the category" —
  it should resolve to that gif's `posterUrl`, not its animated `url`/`thumbnailUrl`.
- **Missing poster is a real state, not an excuse to fall back to the animated asset.** `GifCard`
  currently does `gif.thumbnailUrl ?? gif.url` — falling back to the full animated GIF when there's
  no thumbnail. That fallback must never resolve to an animated asset. If `posterUrl` is null,
  render the existing empty-state treatment (`CategoryCard`'s emoji-on-gradient placeholder is the
  established pattern here — reuse it for `GifCard` too rather than inventing a second one) and
  skip the play control entirely (nothing to play).

This is the backend dependency the issue calls out; it is required under **either** option (a) or
(b), so it is not itself the open decision — see §4.

### 2.2 States (grid card and detail-page hero alike)

| State | Rendering |
| --- | --- |
| Loading (list still fetching) | Unchanged — existing `<Skeleton>` components (`CategoryCardSkeleton`, gif grid skeleton). Out of scope for this spec. |
| **Poster available, not playing (default)** | `<img src={posterUrl}>`. Visible play control overlaid (see §2.3). This is the *only* default state — see §4, it does not vary by `prefers-reduced-motion` because 2.2.2 is universal; reduced-motion only removes the hover/focus preview in §2.4. |
| **Playing** | `<img src={animatedUrl}>` (the existing `thumbnailUrl`/`url`). Control shows a pause affordance. Returns to poster on: control activated again, the card unmounting (scrolled out — see §2.5), or navigation away. |
| No poster, no animated asset (`thumbnailUrl`/`posterUrl` both null) | Existing placeholder (emoji-on-gradient for category; add the same treatment to `GifCard` for parity — today `GifCard` has no placeholder at all and would otherwise render a broken `<img>`). No play control. |
| Poster image fails to load (`onError`) | Same placeholder as "no poster". `CategoryCard` already does this (`imageFailed` state) — carry the same `onError` handling into `GifCard`. |
| Animated asset fails to load mid-play | Fall back to the poster/placeholder and reset the control to "paused"; don't leave a broken `<img>` playing nothing. |

### 2.3 The play/pause control

- A real `<button>`, never a `div`/`span` with a click handler — must be independently focusable
  and operable with Enter/Space without relying on the card's hover state.
- Sits inside the card's image container, opposite corner from the existing duration badge
  (`GifCard` already places duration bottom-right; put the control bottom-left) so the two never
  collide.
- Size: 32×32 CSS px hit target (exceeds the 24×24 CSS px minimum in WCAG 2.2's target-size
  criterion), icon-only, `bg-black/70` matching the existing duration badge's treatment so this
  reads as one small "overlay chrome" family rather than a new visual language.
- Icon: ▶ (play) / ⏸ (pause), swapped by state — this is a new icon need; the design system has no
  icon set today (`CategoryCard` uses a raw emoji, not an icon component). Use inline SVG (two
  simple shapes) rather than pulling in an icon library for two glyphs — flag to frontend-engineer
  if the team already has an icon convention in flight elsewhere that this should match instead.
- Accessible name via `aria-label`, reflecting the *action*, not just the icon, and naming the
  gif so a screen-reader user tabbing through a grid of many cards can tell them apart:
  `aria-label="Play animation: {title}"` / `aria-label="Pause animation: {title}"`.
- `aria-pressed={isPlaying}` so assistive tech announces the toggle state.
- Focus style: reuse the existing global `:focus-visible` token (`outline-2 outline-offset-2
  outline-brand-600`) — do not invent a new focus treatment.
- **Must not be nested inside the card's `<Link>`.** `GifCard`'s own comment already establishes
  the "no `<a>`-in-`<a>`" constraint for the category link; the same reasoning applies here —
  activating play/pause must not also navigate. Render the button as a sibling overlay positioned
  absolutely over the image, same stacking approach as the duration badge, with
  `event.preventDefault()` / `stopPropagation()` on its click handler, or (cleaner) render the
  image + controls outside the `<Link>` and keep only the title/text as the link, matching how the
  category-link sibling is already handled below the image today.

### 2.4 Hover/focus preview (optional, supplementary — not the compliance mechanism)

Cards may *optionally* animate the poster→animated swap on pointer hover or keyboard focus, as a
lightweight "preview," in addition to the explicit control — this is a nice-to-have some catalog
products use, not a requirement. If implemented:

- It must respect `prefers-reduced-motion: reduce` by being disabled outright (poster stays static
  on hover/focus for those users) — this is the one place `@media (prefers-reduced-motion: reduce)`
  belongs in `globals.css`, gating the hover-preview behavior, not the explicit control.
- It is never a substitute for the explicit button in §2.3: touch users and many keyboard users
  never trigger `:hover`, and 2.2.2 requires the mechanism regardless of pointer type.
- Releasing hover/focus returns to the poster; it does not toggle the persistent playing state from
  §2.3 (hovering never leaves an animation "stuck on" after the pointer leaves, and never leaves it
  playing if the explicit control says paused).

### 2.5 Off-screen behaviour

Cards already lazy-load (`loading="lazy"`). Once a card has been explicitly set to "playing" and is
then scrolled off-screen, stop it (swap back to poster) rather than let dozens of off-screen GIFs
keep animating/decoding. Use the same `IntersectionObserver` mechanism already implicit in
`loading="lazy"` if the frontend already has one wired up; otherwise a simple viewport check on
scroll/visibility-change is acceptable — flag as an implementation detail for frontend-engineer,
not a compliance requirement (it's a performance/battery courtesy, not itself required by 2.2.2
since the explicit pause control already satisfies that).

### 2.6 Detail page hero image

Same control, same states, placed over the large hero image (`web/src/app/gif/[slug]/page.tsx`).
Today the hero always renders `gif.url` directly with no poster/pause at all — bring it in line
with the grid cards rather than leaving the detail page as a second ungated precedent once grids
are fixed.

## 3. What does *not* change

- `CategoryCard`'s existing emoji-on-gradient empty state and its `onError`→`imageFailed` pattern
  are correct and stay as the one placeholder pattern (`GifCard` should adopt the same one, not
  invent a second).
- The existing focus-visible token, duration-badge overlay styling, and card layout are unchanged;
  the play control is additive chrome in the unused corner.
- No new design tokens. The control reuses `--color-brand-600` (focus ring) and the existing
  `bg-black/70` overlay treatment; no new color/spacing scale entries are needed.

## 4. Open decision for product-lead (escalated separately on L42-466)

Two ways to sequence the rollout of §2, both converging on the same end-state pattern above:

- **(A) Poster-default, ship now with existing infra plus the new `posterUrl` field.** Grids and
  the detail hero default to the static poster everywhere, animate only on explicit
  play/hover-focus-preview. This is fully 2.2.2-conformant the moment it ships, and matches this
  spec exactly, but is a visible product change: catalog grids that browse "as animated tiles"
  today (a large part of a GIF gallery's appeal) become static-by-default.
- **(B) Same end pattern, staged:** ship the explicit pause control against the *animated* asset
  first (control present, default state = playing) while `posterUrl` is still rolling out
  category-by-category; a card without a poster yet keeps the placeholder-on-null-thumbnail
  behavior from §2.2 rather than autoplaying. This ships incrementally but means the product is
  only *partially* 2.2.2-conformant during the rollout (categories with `posterUrl` still null and
  falling back to the animated asset would need their own interim pause mechanism, which is more
  moving parts, not fewer).

Recommendation: (A). It's one rollout instead of two, it's unambiguously conformant on ship day
rather than "conformant once every category has backfilled," and it removes the fallback-to-full-
animated-GIF bug in `GifCard` in the same change instead of leaving it live during a transition.

This is a product scope/priority call (visual feel of the grids, launch timing against the
`posters` backend work, and whether to make an accessibility-conformance claim at launch), not a
UX-mechanics one — raised to product-lead on L42-466 rather than decided here.
