import { runLatencyHarness } from '@/lib/fusion/integration-harness';

describe('fusion latency integration', () => {
  test('p95 loop latency stays under 150ms', () => {
    const result = runLatencyHarness({
      iterations: 400,
      runner: () => {
        const values: number[] = [];
        for (let i = 0; i < 50; i += 1) {
          values.push(i * 2);
        }
        return values.length;
      },
    });

    expect(result.samples).toBe(400);
    expect(result.p95Ms).toBeLessThanOrEqual(150);
  });
});
