# gif-gallery-web

Next.js (App Router) frontend for the AI-powered GIF gallery. Talks to the API in `../server`.

## Getting started

```bash
cd web
npm install
cp .env.example .env.local   # point NEXT_PUBLIC_API_BASE_URL at your running server if not localhost:3001
npm run dev                  # http://localhost:3000
```

Other scripts: `npm run build`, `npm run start`, `npm run lint`, `npm run typecheck`, `npm test` /
`npm run test:watch` (Vitest + React Testing Library).

## Structure

```
src/
  app/                     # App Router pages
    page.tsx               # Home: hero + search + category grid
    category/[slug]/       # Category browse: category header + paginated gif grid
    search/                 # Search results: query box + paginated gif grid
    layout.tsx, globals.css, loading.tsx, error.tsx, not-found.tsx
  components/
    layout/                # Header, Footer, Container - shared page shell
    category/               # CategoryCard, CategoryGrid
    gif/                     # GifCard, GifGrid
    search/                  # SearchForm (progressive-enhancement search box)
    ui/                      # Pagination, EmptyState, ErrorState, Skeleton (loading placeholders)
  lib/
    api.ts                  # Typed fetch client for the gallery API (+ ApiError)
    types.ts                 # CategorySummary/GifSummary/Page - mirrors server/src/services/categories/types.ts
    config.ts                 # API_BASE_URL / site copy / DEFAULT_PAGE_SIZE
```

Every list/detail fetch goes through `lib/api.ts`; no component calls `fetch` directly. Components
are split so `L42-427` (category browsing UI) and `L42-428` (search autocomplete) can extend
`CategoryPage`/`SearchPage` and `SearchForm` without touching the shared layout, grid or card
components.

## Styling

Tailwind CSS v4 (`@import "tailwindcss"` in `globals.css`, no separate `tailwind.config.*` needed -
v4 auto-detects template files). Brand colors and the body font are defined once via `@theme` in
`globals.css`. Layouts are mobile-first and responsive (`grid-cols-2` up to `grid-cols-5` for gif
grids, `grid-cols-1` up to `grid-cols-4` for category cards, a stacking header on narrow
viewports).

## Accessibility

- Skip-to-content link, semantic landmarks (`header`/`main`/`footer`/`nav`), visible focus rings
  (`focus-visible:outline-*`) everywhere interactive.
- The search box is a real `<form role="search">` with a `<label>` (visually hidden but present)
  and works via a plain GET even without JavaScript; `SearchForm`'s `onSubmit` only takes over to
  keep the URL clean.
- Grids use `<ul role="list">`/`<li>` with `<article>` cards so screen readers get one item per
  gif/category, and `Pagination`'s Prev/Next are disabled via `aria-disabled` (not just visually)
  when there's nowhere to go.
- Error/empty states use `role="alert"` (`ErrorState`) so failures are announced.

## Known gaps / follow-ups (tracked separately, not in scope here)

- **`GET /api/search`** doesn't exist on the backend yet (`server/src/routes/index.ts` lists it as
  a later task). `lib/api.ts#searchGifs` already speaks the same `{ data, pagination }` contract
  every other list endpoint uses, and the search page renders a "search is coming soon" empty
  state instead of an error until that route ships - no frontend change needed once it does.
- **Category browsing polish** (lazy-loading beyond the first page, richer empty/loading states) -
  `L42-427`.
- **Search autocomplete** - `L42-428`. `SearchForm` is deliberately just submit-to-navigate today.
- **Dynamic OG/meta tags per GIF** - `L42-431`.
- `next/image` isn't used for GIF thumbnails because remote hosts (Tenor today, our own
  storage/CDN once `L42-425` lands) aren't finalized - see the comment in `next.config.mjs`.
