import { describe, expect, it } from 'vitest';
import { capitalize, formatDate, formatDuration, formatFileSize } from './format';

describe('formatDuration', () => {
  it('renders sub-10s durations with one decimal place', () => {
    expect(formatDuration(2500)).toBe('2.5s');
  });

  it('rounds durations of 10s or more to whole seconds', () => {
    expect(formatDuration(12345)).toBe('12s');
  });

  it('returns null for null or zero', () => {
    expect(formatDuration(null)).toBeNull();
    expect(formatDuration(0)).toBeNull();
  });
});

describe('formatFileSize', () => {
  it('renders bytes without decimals', () => {
    expect(formatFileSize(512)).toBe('512 B');
  });

  it('renders kilobytes/megabytes with one decimal place', () => {
    expect(formatFileSize(1536)).toBe('1.5 KB');
    expect(formatFileSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  it('returns null for null, zero or negative values', () => {
    expect(formatFileSize(null)).toBeNull();
    expect(formatFileSize(0)).toBeNull();
    expect(formatFileSize(-10)).toBeNull();
  });
});

describe('formatDate', () => {
  it('renders an ISO timestamp as a long date', () => {
    expect(formatDate('2024-01-05T00:00:00.000Z')).toBe('January 5, 2024');
  });

  it('falls back to the raw string when it cannot parse', () => {
    expect(formatDate('not-a-date')).toBe('not-a-date');
  });
});

describe('capitalize', () => {
  it('uppercases the first letter only', () => {
    expect(capitalize('tenor')).toBe('Tenor');
  });

  it('returns empty strings unchanged', () => {
    expect(capitalize('')).toBe('');
  });
});
