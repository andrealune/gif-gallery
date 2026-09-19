import { serializeJsonLd, type JsonLdObject } from '@/lib/structuredData';

/**
 * Renders one JSON-LD `<script>` block from one or more structured-data nodes (see
 * `lib/structuredData.ts` for the builders). Pure/server-only - safe to drop straight into a
 * Server Component page, e.g. `app/gif/[slug]/page.tsx` and `app/category/[slug]/page.tsx`.
 *
 * `dangerouslySetInnerHTML` is required here - JSON-LD must land in the document as raw text, not
 * HTML-entity-escaped text (React would otherwise render `"` as `&quot;` etc., breaking the JSON)
 * - and is safe because `serializeJsonLd` already escapes anything that could break out of the
 * `<script>` tag.
 */
export function JsonLd({ data }: { data: JsonLdObject | JsonLdObject[] }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }} />;
}
