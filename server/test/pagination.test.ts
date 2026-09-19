import { describe, expect, it } from 'vitest';
import { HttpError } from '../src/middleware/errorHandler';
import { parsePagination } from '../src/utils/pagination';

describe('parsePagination', () => {
  it('defaults to limit=20, offset=0 when nothing is given', () => {
    expect(parsePagination({})).toEqual({ limit: 20, offset: 0 });
  });

  it('honors a custom default limit', () => {
    expect(parsePagination({}, { defaultLimit: 50 })).toEqual({ limit: 50, offset: 0 });
  });

  it('parses valid numeric strings', () => {
    expect(parsePagination({ limit: '5', offset: '15' })).toEqual({ limit: 5, offset: 15 });
  });

  it('rejects a limit of 0 or below', () => {
    expect(() => parsePagination({ limit: '0' })).toThrow(HttpError);
    expect(() => parsePagination({ limit: '-1' })).toThrow(HttpError);
  });

  it('rejects a limit above maxLimit', () => {
    expect(() => parsePagination({ limit: '101' })).toThrow(HttpError);
    expect(() => parsePagination({ limit: '500' }, { maxLimit: 500 })).not.toThrow();
  });

  it('rejects a negative offset', () => {
    expect(() => parsePagination({ offset: '-1' })).toThrow(HttpError);
  });

  it('rejects non-numeric values', () => {
    expect(() => parsePagination({ limit: 'abc' })).toThrow(HttpError);
    expect(() => parsePagination({ offset: 'abc' })).toThrow(HttpError);
  });

  it('rejects fractional values', () => {
    expect(() => parsePagination({ limit: '1.5' })).toThrow(HttpError);
  });

  it('produces a 400 HttpError', () => {
    try {
      parsePagination({ limit: 'abc' });
      throw new Error('expected parsePagination to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).status).toBe(400);
    }
  });
});
