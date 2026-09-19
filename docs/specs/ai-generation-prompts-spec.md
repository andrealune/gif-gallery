# Functional Spec — AI Generation Prompts & Categories (L42-423)

## 1. Purpose
Define, in testable terms, how GIF **categories** map to **text prompts** used to
drive AI image generation (referred to in the issue as "DALL-E"), and the rules
governing how that mapping is stored and consumed by the batch generation
scheduler (L42-424).

This document is a specification only. No production code or database
migration is included here — schema/implementation is handed to
Software Architect / Database Engineer (see §8).

## 2. Actors
| Actor | Role in this process |
|---|---|
| **Category Taxonomy** (data, owned by L42-416) | Source of truth for which categories exist in the gallery. |
| **Prompt Mapping (this feature)** | Data set linking each category to one or more text prompts. |
| **Batch Generation Scheduler** (L42-424) | Reads the mapping, picks a category + prompt, calls the image-generation API, converts the result to a GIF, stores it. |
| **Image Generation API** ("DALL-E") | External service that turns a prompt into an image. |
| **Content Moderation** (implicit, see gap G4) | Filters/validates prompts and/or outputs before publishing. |
| **End user** | Browses gallery by category; never authors or edits prompts (no auth/accounts in scope per project brief). |

No human "prompt admin" role is implied by the issue or the PRD — see gap G3.

## 3. Process Description
1. The category list is read from the existing category taxonomy (L42-416).
2. Each category has one or more **active** prompt records associated with it.
3. When the scheduler runs (L42-424, out of scope here), it:
   a. Selects a category (per its own scheduling policy).
   b. Selects one active prompt mapped to that category.
   c. Sends the prompt text to the image-generation API.
   d. On success, converts the returned image to a GIF and stores it, tagged with that category.
   e. On failure, logs it and moves on (does not halt the batch run).
4. Prompts are seed/config data, versionable, and are **not** created or edited by end users (no end-user upload/authoring in scope, per project brief's out-of-scope list).

## 4. Data Model (functional requirements, not a migration)
A new entity, `generation_prompt`, is required with at least:

| Field | Type | Requirement |
|---|---|---|
| `id` | identifier | FR-1: unique per prompt. |
| `category_id` / `category_slug` | reference | FR-2: must reference an existing category from the L42-416 taxonomy. |
| `prompt_text` | string | FR-3: 1–1000 characters (DALL-E 3 prompt limit). |
| `is_active` | boolean | FR-4: only active prompts are eligible for selection. |
| `created_at` / `updated_at` | timestamp | FR-5: for auditing. |

Whether multiple prompts per category are supported, and how "weight"/rotation
is tracked, is an open question — see gap G2. The model above is written to
support 1..N prompts per category so that decision doesn't require a schema
rewrite either way.

## 5. Business Rules (if/then, testable)
- **BR-1**: If a category has zero active prompts, then the scheduler must skip
  generation for that category and log a warning; it must not error out the
  whole batch run.
- **BR-2**: If a category has more than one active prompt, then the scheduler
  must be able to pick among them (selection strategy = gap G2), so that
  repeated runs are not required to reuse the exact same prompt.
- **BR-3**: If a prompt's `is_active` is false, then it must never be selected
  by the scheduler, but must remain in the database (soft-disable, not delete),
  so history/audit is preserved.
- **BR-4**: If `prompt_text` exceeds 1000 characters, then it must be rejected
  at creation/seed time (validation), not discovered later at API-call time.
- **BR-5**: If a prompt references a `category_id` that does not exist in the
  taxonomy, then it must be rejected at creation time (referential integrity).
- **BR-6**: If a new category is added to the taxonomy, then it is **not**
  auto-enrolled in AI generation until a prompt is explicitly added for it
  (no implicit/default prompt is invented — see gap G1).
- **BR-7**: If the image-generation API rejects a prompt (e.g. content-policy
  violation), then that failure must be attributable to a specific
  `generation_prompt` row (for later review), and must not silently retry
  with a different, unrelated prompt.

## 6. Proposed Category → Prompt Mapping
No canonical category list or approved prompt wording was supplied in the PRD
or the issue. The table below is a **proposed default**, written to the style
shown in the issue example, for product-lead / product-designer sign-off
before it is seeded. It is not to be treated as an approved business rule
until confirmed (see gap G1).

| Category | Prompt |
|---|---|
| Animals | Cute animated animal doing something funny, colorful, looping GIF style, family-friendly |
| Reactions | Exaggerated, comedic human facial expression reacting in surprise or joy, looping GIF style |
| Sports | Dynamic, energetic moment from a fun sports scene, cartoon style, looping GIF style |
| Food | Playful, appetizing animated food or drink doing something whimsical, looping GIF style |
| Celebration | Joyful celebration scene with confetti, dancing, or fireworks, looping GIF style |
| Love | Sweet, wholesome animated scene expressing affection, looping GIF style |
| Memes | Absurd, comedic pop-culture-style scene, exaggerated expressions, looping GIF style |
| Nature | Serene or whimsical animated nature scene (weather, plants, landscapes), looping GIF style |
| Technology | Fun, futuristic animated scene with gadgets or robots, looping GIF style |
| Dance | Energetic animated character dancing, colorful background, looping GIF style |

Every prompt above deliberately appends a fixed style/safety suffix
("looping GIF style" / "family-friendly") — see gap G4 on moderation; this is
a **proposed** convention, not a confirmed rule.

## 7. Edge Cases
1. Category renamed/removed after prompts exist → orphaned `generation_prompt`
   rows; BR-5 prevents new orphans, but doesn't cover a category being
   deleted later. Needs an explicit on-delete policy (restrict, or cascade
   soft-disable of its prompts).
2. Duplicate/near-duplicate prompt text across categories → visually similar
   output; not a data-integrity issue but a content-quality one.
3. Prompt wording that triggers the image API's content-policy filter (e.g. a
   hypothetical "Weapons" or "Alcohol" category) → generation fails every run
   for that category. BR-7 makes the failure visible, but does not resolve it.
4. Category with only one active prompt used many times → repetitive-looking
   generated GIFs over time (BR-2 exists to allow, not require, a prompt pool).
5. Empty or overly generic prompt text → irrelevant or low-quality output.
6. High category count × frequent scheduler runs → API cost/rate-limit
   exposure; no cost ceiling stated anywhere (see gap G6).
7. "DALL-E" (per the issue title) generates a **static image**, not a GIF;
   L42-424's own description says the batch job "generates new GIFs via
   prompts, converts to GIF format" — implying a separate image→GIF
   conversion step (e.g., looping a still, or an animation pipeline) not
   covered by this issue. See gap G7.

## 8. Requirement Gaps (need a decision before/at implementation)
These are not invented as rules; they are listed as open questions for
**product-lead** (and, where technical, **software-architect**) to resolve.

- **G1 — Category list**: No definitive, approved category list exists in any
  brief or task read for this spec. §6 is a *proposed* draft only.
- **G2 — Multi-prompt strategy**: Is one prompt per category sufficient, or
  should each category have a pool of prompts with a defined selection
  strategy (random / round-robin / weighted / least-recently-used)? Affects
  the data model (§4) and the scheduler (L42-424).
- **G3 — Authoring/editing**: Are these prompts pure static seed data (set
  once by engineering), or does the business want an internal admin surface
  to edit them later? Project brief excludes end-user accounts but says
  nothing about an internal admin tool.
- **G4 — Content moderation / style conventions**: Should every prompt be
  required to carry a fixed safety/style suffix (as proposed in §6)? Who
  approves prompt wording before it goes live?
- **G5 — Category/prompt lifecycle on taxonomy change**: When a category is
  deleted or renamed (owned by L42-416/backend), what happens to its
  prompt(s)? (Cascade-disable is proposed in Edge Case 1 but unconfirmed.)
- **G6 — Cost/quota**: Is there a budget or rate limit for image-generation
  API calls that should cap how many categories/prompts run per batch (feeds
  L42-424's scheduling policy)?
- **G7 — Image → GIF conversion**: This issue only defines the *prompt*
  mapping; how the resulting static image becomes an animated GIF is not
  specified anywhere and directly affects whether prompts should be written
  to describe a static scene (current draft) or an implied motion/loop
  (e.g., "as a 2-second looping animation of ..."). This blocks L42-424 from
  being fully specified and should be confirmed before that task starts
  implementation.

## 9. Success Metrics (proposed, pending product-lead confirmation)
- ≥ 95% of scheduled generation attempts resolve to either a stored GIF or a
  clearly logged, categorized failure (no silent drops).
- 0 prompts stored that violate BR-4/BR-5 (length / referential integrity) —
  measurable via a validation check at seed/insert time.
- Every category exposed in the public gallery (from L42-416/L42-417) has at
  least one active prompt, OR is explicitly excluded from AI generation by
  design (no category silently gets no AI content without that being a
  deliberate decision).
- Qualitative: generated GIFs per category are not visually repetitive across
  N consecutive runs (needs a concrete N once G2 is decided).

## 10. User Stories
- As the **batch generation scheduler**, I need a reliable, queryable mapping
  of category → active prompt(s) so that I can generate on-theme content
  without hard-coding prompt text.
- As **product/content owner**, I need every prompt to be traceable to a
  category and reviewable before it goes live, so that inappropriate or
  off-brand content isn't generated at scale.
- As an **end user** browsing the gallery by category, I benefit indirectly:
  AI-generated GIFs in a category should look like they belong there.

## 11. Out of Scope (per project brief)
- Any UI for creating/editing prompts (no admin auth system is in scope).
- Any end-user–facing prompt customization (no user uploads/accounts).
