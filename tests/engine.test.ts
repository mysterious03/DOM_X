import { describe, it, expect, vi } from 'vitest';
import { DOMPulseEngine } from '../src/core/engine';

describe('DOMPulse Engine Integration', () => {
  it('manages observation lifecycle and calculates compression metrics', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const engine = new DOMPulseEngine({
      debounceMs: 20,
    });

    const batchSpy = vi.fn();
    engine.onBatch(batchSpy);

    engine.start(container);
    expect(engine.getMetrics().isActive).toBe(true);

    // 1. Add noisy script node (should be filtered)
    const script = document.createElement('script');
    script.textContent = 'var x = 1;';
    container.appendChild(script);

    // 2. Add meaningful button
    const btn = document.createElement('button');
    btn.id = 'checkout-btn';
    btn.textContent = 'Checkout';
    container.appendChild(btn);

    // Allow debounce timer or manually flush
    await new Promise((r) => setTimeout(r, 60));

    expect(batchSpy).toHaveBeenCalled();
    const metrics = engine.getMetrics();
    expect(metrics.rawMutations).toBeGreaterThan(0);
    expect(metrics.filteredMutations).toBeGreaterThan(0); // script node was filtered
    expect(metrics.meaningfulEvents).toBeGreaterThan(0);
    expect(metrics.compressionRatio).toBeGreaterThan(0);

    engine.stop();
    expect(engine.getMetrics().isActive).toBe(false);
  });

  it('tracks temporal difference (Δt) and calculates token waste prevented', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const engine = new DOMPulseEngine({ debounceMs: 15 });
    engine.start(container);

    // Initial temporal state
    const t0 = engine.getTemporalDiff();
    expect(t0.addedNodes).toBe(0);
    expect(t0.tokenWastePreventedPct).toBeGreaterThanOrEqual(90);

    // Add input element and trigger mutation
    const input = document.createElement('input');
    input.type = 'text';
    input.value = 'hello';
    container.appendChild(input);

    await new Promise((r) => setTimeout(r, 45));

    const t1 = engine.getTemporalDiff();
    expect(t1.addedNodes).toBeGreaterThan(0);
    expect(t1.recentDeltas.length).toBeGreaterThan(0);
    expect(t1.tokenWastePreventedPct).toBeGreaterThan(90);

    const metrics = engine.getMetrics();
    expect(metrics.temporalDiff).toBeDefined();
    expect(metrics.temporalDiff?.tokenWastePreventedPct).toBeGreaterThan(90);

    engine.stop();
  });
});
