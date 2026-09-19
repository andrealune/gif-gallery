/**
 * A simple sliding-window rate limiter used to cap how many outgoing
 * requests we make to the OpenAI API per unit of time, independent of
 * whatever limit the API itself enforces for our account/tier.
 *
 * `acquire()` resolves as soon as a slot is available, sleeping first if the
 * window is currently full. `now`/`sleep` are injectable so tests can run
 * with a fake clock instead of real timers.
 */
export interface RateLimiterOptions {
  /** Maximum number of requests allowed within `intervalMs`. `<= 0` disables limiting. */
  maxRequests: number;
  /** Length of the sliding window, in milliseconds. */
  intervalMs: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export class SlidingWindowRateLimiter {
  private readonly maxRequests: number;
  private readonly intervalMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private timestamps: number[] = [];

  constructor(options: RateLimiterOptions) {
    this.maxRequests = options.maxRequests;
    this.intervalMs = options.intervalMs;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  private prune(): void {
    const cutoff = this.now() - this.intervalMs;
    while (this.timestamps.length > 0 && this.timestamps[0] <= cutoff) {
      this.timestamps.shift();
    }
  }

  /** Blocks until a slot is available within the window, then reserves it. */
  async acquire(): Promise<void> {
    if (this.maxRequests <= 0) {
      return; // limiting disabled
    }

    for (;;) {
      this.prune();
      if (this.timestamps.length < this.maxRequests) {
        this.timestamps.push(this.now());
        return;
      }
      const oldest = this.timestamps[0];
      const waitMs = Math.max(oldest + this.intervalMs - this.now(), 0) + 1;
      await this.sleep(waitMs);
    }
  }

  /** Number of requests currently counted within the active window. */
  get currentUsage(): number {
    this.prune();
    return this.timestamps.length;
  }
}
