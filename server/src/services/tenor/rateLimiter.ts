/** Serializes starts of requests to respect Tenor's default one request/second quota. */
export class IntervalRateLimiter {
  private nextStartAt = 0;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly intervalMs: number,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms))
  ) {}

  wait(): Promise<void> {
    const turn = this.queue.then(async () => {
      const now = Date.now();
      const delay = Math.max(0, this.nextStartAt - now);
      if (delay > 0) await this.sleep(delay);
      this.nextStartAt = Date.now() + this.intervalMs;
    });
    this.queue = turn.catch(() => undefined);
    return turn;
  }
}
