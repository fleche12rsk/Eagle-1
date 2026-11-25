import { describe, expect, test } from 'vitest';
import { Glottis, lfSample, lfShape, newLfShape } from '../src/dsp/glottis';

describe('fonte glotal LF', () => {
  test.each([0.3, 0.5, 0.8, 1, 1.4, 2, 2.4, 2.7])('Rd %f: fluxo líquido zero e pico em -1', (rd) => {
    const s = lfShape(rd, newLfShape());
    const N = 20000;
    let sum = 0;
    let min = 0;
    for (let i = 0; i < N; i++) {
      const v = lfSample(s, i / N);
      expect(Number.isFinite(v)).toBe(true);
      sum += v / N;
      min = Math.min(min, v);
    }
    expect(Math.abs(sum)).toBeLessThan(1e-4);
    expect(min).toBeCloseTo(-1, 2);
  });

  test('Rd fora da faixa é limitado, sem NaN', () => {
    for (const rd of [-5, 0, 0.1, 3, 100]) {
      const s = lfShape(rd, newLfShape());
      for (let t = 0; t < 1; t += 0.01) expect(Number.isFinite(lfSample(s, t))).toBe(true);
    }
  });

  test('gerador com jitter, shimmer e aspiração no máximo continua finito', () => {
    const g = new Glottis(96000, 7);
    const p = { rd: 2.7, aspiration: 1, jitter: 1, shimmer: 1 };
    let peak = 0;
    for (let i = 0; i < 96000; i++) {
      const v = g.next(30 + (i % 2000), p);
      expect(Number.isFinite(v)).toBe(true);
      peak = Math.max(peak, Math.abs(v));
    }
    expect(peak).toBeLessThan(6);
  });
});
