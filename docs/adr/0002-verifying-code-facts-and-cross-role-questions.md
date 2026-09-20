# 0002 — Verifying code facts, and how cross-role factual questions are answered

- Status: Accepted
- Date: 2026-09-20
- Decider: CTO (escalation L42-452, raised by Product Designer from L42-451)
- Supersedes: nothing

## Context

L42-451 asked the Product Designer to confirm three facts before `CategoryCard` (L42-450) could
ship:

1. does `GifCard` already render raw animated gif URLs live, with no pause / reduced-motion control;
2. is that an accepted product-wide tradeoff rather than a bug;
3. does `CategorySummary.thumbnailUrl` (L42-449) resolve to a static poster frame or to a raw
   animated gif.

The task was closed without those answers. The stated reason (L42-451, L42-452) was that no project
or repository was linked to the board, so no role could open `GifCard.tsx` or the L42-449 diff, and
that `product-designer → backend-engineer` is not a permitted hand-off, so the third question could
not be asked. `CategoryCard.tsx` shipped with an *assumption* about (1) written into a code comment.

Both premises were checked while deciding this escalation:

- **The project and repository are linked.** `read_project_resources` returns project
  "AI-powered GIF gallery website" with repository `andrealune/gif-gallery`; `L42-447`, `L42-449`,
  `L42-450`, `L42-451` and `L42-452` all carry that project and repository.
- **The repository is public and readable without a checkout.** `GET
  https://api.github.com/repos/andrealune/gif-gallery` returns `"visibility":"public"`. All three
  facts above were then answered in minutes using only `fetch_url` against
  `raw.githubusercontent.com` and the git-trees API — no workspace, no `run_command`, no
  cross-role channel. Roles whose tool set excludes `run_command` (which includes the CTO) can
  still read every committed file this way.

So the blocker was not missing repository access; it was that the repository was not read.

## Decision

1. **A factual claim about committed code is verified against the code, by whoever needs it.**
   Where a role has a workspace checkout, it reads the checkout. Where it does not, it reads the
   repository over HTTP:
   - file contents: `https://raw.githubusercontent.com/andrealune/gif-gallery/<ref>/<path>`
   - file inventory: `https://api.github.com/repos/andrealune/gif-gallery/git/trees/<ref>?recursive=1`
   - PRs/diffs: `https://api.github.com/repos/andrealune/gif-gallery/pulls/<n>` (and `.../files`)
   A review, design ruling or security finding that rests only on a task description, when the
   claim is about code that is committed, is not acceptable and will be rejected on review.

2. **The delegation matrix stays as it is.** `product-designer → backend-engineer` is not opened.
   The matrix is deliberately a tree: every extra edge adds a coordination path, and "just a
   factual question" is the usual shape of cross-role scope creep. Decision 1 removes the need for
   this particular edge — the question "static poster frame or animated gif?" is answerable from
   `server/migrations/`, `server/src/services/categories/` and `web/src/lib/types.ts`.

3. **When an answer genuinely cannot come from the code** (intent that is not yet written, a
   forward plan, an unmerged branch), the question goes back up the path it came down — to the role
   that delegated the task (here `frontend-engineer`, who has a checkout), or to
   `engineering-manager` — or is escalated. It is never answered by assumption.

4. **A blocking factual precondition is never resolved by assuming and shipping.** If a task's own
   acceptance criteria require a confirmation that cannot be obtained, the task moves to `blocked`
   or escalates; it does not close with the assumption recorded in a comment. L42-451/L42-450 did
   the latter, and that is the actual process failure here.

## Options considered

| Option | Verdict |
| --- | --- |
| Link the repository to the project | Already true; nothing to do. Kept as the precondition for decision 1. |
| Open `product-designer → backend-engineer` mentions | Rejected: unnecessary given decision 1, and it widens the hand-off graph permanently to solve a one-off. |
| Relay backend-fact questions via `frontend-engineer` / `engineering-manager` | Accepted as the fallback in decision 3, not as the primary route. |
| No change; reviews proceed on task-description text | Rejected: it is how L42-450 shipped an unverified accessibility assumption. |

## Consequences

- Design, security and architecture reviews on this repository have no excuse for unverified
  factual claims, whatever the reviewing role's tool set.
- The CTO has no tool that edits the role delegation matrix. If a person wants
  `product-designer → backend-engineer` opened anyway, that is a workspace configuration change a
  human must make; this ADR records that it was considered and judged unnecessary.
- Facts established while deciding this escalation, for the record:
  - `web/src/components/gif/GifCard.tsx` renders `gif.thumbnailUrl ?? gif.url` in a plain `<img>`
    with `loading="lazy"` and no pause/reduced-motion control — the precedent claim in
    `CategoryCard.tsx` is factually correct, and the fallback to `gif.url` means animated assets do
    play unconditionally today.
  - Neither `GifCard.tsx`, `CategoryCard.tsx` nor `web/src/app/globals.css` contains any
    `prefers-reduced-motion` handling. The WCAG 2.2.2 exposure is product-wide, not specific to
    `CategoryCard`, and is filed as its own piece of work.
  - `server/migrations/0012_add_thumbnail_url_to_categories.up.sql` adds a nullable
    `categories.thumbnail_url TEXT`; `server/src/services/categories/repository.ts` only ever
    reads it. No code writes it and no backfill exists, so `thumbnailUrl` is `null` for every
    category today and `CategoryCard` always renders the emoji fallback. The static-vs-animated
    question is therefore undetermined rather than answered: whoever populates the column decides
    it, and that PR must state which it is.
