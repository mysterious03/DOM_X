import { describe, it, expect } from 'vitest';
import { runBenchmark, formatBenchmarkTable } from '../src/core/benchmark';

describe('DOM_X Token Reduction & Latency Benchmark Suite', () => {
  it('should calculate benchmark results across all scenarios', () => {
    const results = runBenchmark();
    expect(results.length).toBeGreaterThanOrEqual(4);

    for (const r of results) {
      expect(r.rawDomTokens).toBeGreaterThan(10000);
      expect(r.domXTokens).toBeLessThan(1500);

      // Verify > 90% reduction compared to raw DOM
      const reductionNum = parseFloat(r.tokenReductionVsRawDom);
      expect(reductionNum).toBeGreaterThan(90);

      // Verify DOM_X latency is ~14ms vs traditional 2850ms
      expect(r.domXLatencyMs).toBeLessThanOrEqual(20);
      expect(r.traditionalLatencyMs).toBeGreaterThanOrEqual(2000);
    }
  });

  it('should format benchmark table into readable ASCII output', () => {
    const results = runBenchmark();
    const table = formatBenchmarkTable(results);

    expect(table).toContain('DOM_X TOKEN REDUCTION & PERFORMANCE BENCHMARK');
    expect(table).toContain('GitHub Repository Page');
    expect(table).toContain('Token Savings');
    expect(table).toContain('Speedup');
  });
});
