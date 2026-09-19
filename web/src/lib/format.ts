/**
 * Small formatting helpers shared by anything that renders gif metadata (cards, the detail page,
 * embed snippets, ...). Kept framework-free and pure so they're trivial to unit test.
 */

/** `2500` -> `'2.5s'`, `12000` -> `'12s'`. `null`/`0` (no known duration) -> `null`. */
export function formatDuration(ms: number | null): string | null {
  if (!ms) return null;
  const seconds = ms / 1000;
  return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`;
}

const FILE_SIZE_UNITS = ['B', 'KB', 'MB', 'GB'] as const;

/** `1536` -> `'1.5 KB'`. `null`/`0`/negative (no known size) -> `null`. */
export function formatFileSize(bytes: number | null): string | null {
  if (!bytes || bytes <= 0) return null;

  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < FILE_SIZE_UNITS.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const precision = unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${FILE_SIZE_UNITS[unitIndex]}`;
}

/** ISO timestamp -> `'January 5, 2024'`. Falls back to the raw string if it doesn't parse. */
export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

/** `'tenor'` -> `'Tenor'`. Used for the free-text `source` field, which is stored lowercase. */
export function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}
