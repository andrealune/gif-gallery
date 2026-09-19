import { describe, expect, it } from 'vitest';
import { CostTracker, estimateImageCostUsd } from '../../src/services/ai/costTracker';

describe('estimateImageCostUsd', () => {
  it('returns the known price for a standard dall-e-3 1024x1024 image', () => {
    expect(estimateImageCostUsd('dall-e-3', '1024x1024', 'standard')).toBe(0.04);
  });

  it('returns the higher price for hd quality', () => {
    expect(estimateImageCostUsd('dall-e-3', '1024x1024', 'hd')).toBe(0.08);
  });

  it('returns the known price for dall-e-2', () => {
    expect(estimateImageCostUsd('dall-e-2', '512x512')).toBe(0.018);
  });

  it('falls back to the highest known price for an unrecognized size on a known model', () => {
    expect(estimateImageCostUsd('dall-e-3', '4096x4096', 'hd')).toBe(0.12);
  });

  it('falls back to a conservative default for a completely unknown model', () => {
    expect(estimateImageCostUsd('some-future-model', '1024x1024')).toBe(0.04);
  });
});

describe('CostTracker', () => {
  it('accumulates cost and image count across calls', () => {
    const tracker = new CostTracker();

    const first = tracker.record('dall-e-3', '1024x1024', 'standard', 1, 1000);
    const second = tracker.record('dall-e-3', '1024x1024', 'hd', 2, 2000);

    expect(first.costUsd).toBeCloseTo(0.04);
    expect(second.costUsd).toBeCloseTo(0.16);
    expect(tracker.totalCostUsd).toBeCloseTo(0.2);
    expect(tracker.totalImages).toBe(3);
    expect(tracker.history).toHaveLength(2);
    expect(tracker.history[0].timestamp).toBe(1000);
  });

  it('reset() clears accumulated history', () => {
    const tracker = new CostTracker();
    tracker.record('dall-e-2', '256x256', undefined, 5);

    tracker.reset();

    expect(tracker.totalCostUsd).toBe(0);
    expect(tracker.totalImages).toBe(0);
    expect(tracker.history).toHaveLength(0);
  });
});
