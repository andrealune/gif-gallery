import { describe, expect, it } from 'vitest';
import { SlidingWindowRateLimiter } from '../../src/services/ai/rateLimiter';

/** Builds a limiter driven by a fake, manually-advanced clock instead of real timers. */
function createFakeClockLimiter(maxRequests: number, intervalMs: number) {
  let currentTime = 0;
  const now = () => currentTime;
  const sleep = async (ms: number): Promise<void> => {
    currentTime += ms;
  };
  const limiter = new SlidingWindowRateLimiter({ maxRequests, intervalMs, now, sleep });
  return { limiter, getTime: () => currentTime };
}

describe('SlidingWindowRateLimiter', () => {
  it('allows requests up to the limit without waiting', async () => {
    const { limiter, getTime } = createFakeClockLimiter(2, 1000);

    await limiter.acquire();
    await limiter.acquire();

    expect(getTime()).toBe(0);
    expect(limiter.currentUsage).toBe(2);
  });

  it('waits for the window to free up once the limit is reached', async () => {
    const { limiter, getTime } = createFakeClockLimiter(2, 1000);

    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire(); // must wait for the first slot to expire

    expect(getTime()).toBeGreaterThanOrEqual(1000);
    expect(limiter.currentUsage).toBe(1);
  });

  it('treats a non-positive maxRequests as "unlimited"', async () => {
    const { limiter, getTime } = createFakeClockLimiter(0, 1000);

    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();

    expect(getTime()).toBe(0);
  });
});
