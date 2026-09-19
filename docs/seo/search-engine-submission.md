# Search engine & LLM crawler submission (L42-435)

## What this covers

L42-435 asks to "register the site with Google Search Console, Bing Webmaster Tools, and any LLM
crawler services (e.g. Common Crawl)" and verify indexing status. Registering a *property* in
Google's/Microsoft's consoles is a one-time action inside their web UIs, gated on a Google/Microsoft
**account that a person on this team owns** - there is no API or code change that does it, and no
engineering agent has (or should be given) credentials to those accounts. This doc is the runbook
for the person who does that, plus a summary of what engineering already ships to make it work.

**Prerequisite the console step is blocked on today:** the site is not deployed to a public
domain yet - `SITE_URL`/`NEXT_PUBLIC_SITE_URL` both default to `http://localhost:3000`, and there is
no `vercel.json`/`netlify.toml`/deploy config in the repo. Search Console and Bing Webmaster Tools
both require a reachable HTTPS origin to verify against. Nothing below can be done for real until
that origin exists - flagging this as a separate, `operational` decision (hosting/domain) for
product-lead/CTO rather than assuming one here.

## Already in place (no action needed)

- `robots.txt` (`server/src/routes/robots.ts`) - `User-agent: * / Allow: /`, only `/api/` disallowed.
  This already permits Googlebot, Bingbot, and LLM/AI crawlers (GPTBot, Google-Extended, CCBot,
  anthropic-ai, PerplexityBot, ...) equally; there is no separate block on any of them.
- `sitemap.xml` (`server/src/routes/sitemap.ts`, `services/sitemap.ts`) - dynamic, includes every
  discovery/category/gif page, referenced from `robots.txt`'s `Sitemap:` line.
- Both are proxied from the Next.js app's own origin (`web/next.config.mjs` rewrites) so crawlers
  see them at the site's real origin, not the API's.
- `<title>`, `<meta name="description">`, `<meta name="keywords">`, Open Graph/Twitter tags, and
  JSON-LD structured data render correctly today - verified by starting `server` + `web` locally
  and inspecting the rendered homepage HTML (`<title>GIF Gallery</title>`, description, keywords,
  `og:*`, `twitter:*` all present; no unexpected `noindex` anywhere).
- `web/public/llms.txt` (added by this change) - a plain-language summary of the site per the
  [llms.txt](https://llmstxt.org/) convention, for LLM crawlers/assistants that read it.
- `<meta name="google-site-verification">` / `<meta name="msvalidate.01">` (added by this change,
  `web/src/app/layout.tsx` + `lib/config.ts`) - rendered automatically once the env vars below are
  set; omitted entirely otherwise, so this ships with zero effect today.
- IndexNow key-file route + submit script (added by this change, see below) - the one part of
  this ticket that is a real API rather than a console click.

## Manual steps (once a public origin exists)

### 1. Google Search Console
1. https://search.google.com/search-console → Add property → "URL prefix" → the production URL.
2. Verify ownership. Either:
   - **DNS TXT record** (preferred - survives a re-deploy/host change without a code change), or
   - **HTML tag**: copy the `content="..."` value Google gives you into `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION`
     in the `web` deployment's env vars and redeploy; the tag then renders on every page.
3. Sitemaps → submit `https://<site>/sitemap.xml`.
4. URL Inspection → request indexing for the homepage and a couple of category/gif pages.

### 2. Bing Webmaster Tools
1. https://www.bing.com/webmasters → Add a site.
2. Either import the already-verified Google Search Console property (fastest - one click, no
   separate code), or verify directly: DNS TXT record, or HTML tag → put the value in
   `NEXT_PUBLIC_BING_SITE_VERIFICATION` and redeploy.
3. Sitemaps → submit `https://<site>/sitemap.xml`.
4. **IndexNow** (Bing/Yandex/Seznam, no separate dashboards needed once set up):
   - Get a key at https://www.bing.com/indexnow (or generate any hex string yourself - all three
     engines accept a self-generated key).
   - Set `INDEXNOW_KEY` in the `server` deployment's env vars and redeploy. This automatically
     makes `https://<site>/<key>.txt` serve the key (`server/src/routes/indexnow.ts`) - IndexNow
     requires that file to be reachable before it accepts submissions from that key.
   - Run `npm run seo:submit-indexnow` (in `server/`) to push every sitemap URL immediately; safe
     to (re-)run any time content changes, e.g. from a post-deploy hook or a daily cron.

### 3. Common Crawl / other LLM indexing services
Common Crawl (and most large-scale LLM training crawlers) do not offer per-site registration -
they crawl the open web on their own schedule, and a site is included automatically as long as
it's public, reachable, permitted by `robots.txt` (already the case here - see above) and
discoverable (linked from elsewhere, or listed in `sitemap.xml`). There is nothing to "submit" to
Common Crawl specifically. `web/public/llms.txt` gives assistant-style crawlers that *do* read it
a short, accurate summary; it has no effect on Common Crawl's bulk crawl.

### 4. Verifying indexing status (do this ~1-2 weeks after the above, once crawled)
- Google Search Console → Coverage/Pages report: confirms pages are indexed vs. excluded, and why.
- Bing Webmaster Tools → Site Explorer / URL Inspection: same idea for Bing.
- `site:<domain>` search on Google and Bing as a quick manual spot-check.
- IndexNow submissions return `200`/`202` on success; a non-2xx from `npm run seo:submit-indexnow`
  most often means the key file isn't deployed/reachable yet (see the script's own error message).

## What's still open

- No production domain/hosting is configured yet, so none of the console steps above can actually
  be performed - that's a hosting/domain decision, not an engineering one; see the escalation
  filed on this ticket.
- Once a domain exists, a person with a Google and a Microsoft account needs to actually do steps
  1-2 above (this is inherently a human, credentialed action - not something an engineering agent
  can complete on your behalf).
