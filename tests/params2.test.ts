import { describe, expect, test } from 'vitest';
import { Engine } from '../src/dsp/engine';
import { PARAMS, PARAM_INDEX, VOWELS, toNormalized, type ParamId } from '../src/dsp/params';
import { formants } from './analysis';
import { fft } from './analysis';

const FS = 48000;
const set = (e: Engine, id: ParamId, v: number) => e.handle({ t: 'param', i: PARAM_INDEX[id], v: toNormalized(PARAMS[PARAM_INDEX[id]], v) });

function play(setup: (e: Engine) => void, note = 48, seconds = 1.2): Float32Array {
  const e = new Engine(FS);
  for (const [k, v] of Object.entries(VOWELS.A)) set(e, k as ParamId, v);
  setup(e);
  const buf = new Float32Array(128);
  for (let i = 0; i < 40; i++) e.process(buf, null, 128);
  e.handle({ t: 'on', n: note, v: 1 });
  const n = Math.floor((seconds * FS) / 128) * 128;
  const out = new Float32Array(n);
  for (let off = 0; off < n; off += 128) {
    e.process(buf, null, 128);
    out.set(buf, off);
  }
  return out;
}
const rms = (x: Float32Array, a = 0, b = x.length) => Math.sqrt(x.slice(a, b).reduce((s, v) => s + v * v, 0) / Math.max(1, b - a));
function bandEnergy(x: Float32Array, lo: number, hi: number, start = FS / 2): number {
  const size = 16384;
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let i = 0; i < size; i++) re[i] = x[start + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size));
  fft(re, im);
  let s = 0;
  for (let k = Math.floor((lo * size) / FS); k < Math.floor((hi * size) / FS); k++) s += re[k] ** 2 + im[k] ** 2;
  return s;
}

describe('parâmetros novos do trato', () => {
  test('afunilamento, cristas e anéis mudam as ressonâncias', () => {
    const base = formants({ ...VOWELS.A, teeth: 0.6 });
    for (const extra of [{ taper: 0.8 }, { taper: -0.8 }, { ridges: 1 }, { rings: 1 }]) {
      const f = formants({ ...VOWELS.A, teeth: 0.6, ...extra });
      const moved = f.length !== base.length || f.some((hz, i) => Math.abs(hz - base[i]) > 12);
      expect(moved, JSON.stringify(extra)).toBe(true);
    }
  });

  test('valores extremos continuam seguros', () => {
    const out = play((e) => {
      for (const id of ['taper', 'ridges', 'rings', 'rough', 'click', 'twoVoices'] as ParamId[]) set(e, id, id === 'taper' ? -1 : 1);
    });
    let peak = 0;
    for (const s of out) {
      expect(Number.isNaN(s)).toBe(false);
      peak = Math.max(peak, Math.abs(s));
    }
    expect(peak).toBeLessThanOrEqual(1);
    expect(rms(out, FS / 2)).toBeGreaterThan(0.005);
  });
});

describe('fonte', () => {
  test('2 vozes: aparece energia uma quinta acima', () => {
    const f0 = 130.81; // Dó3
    const fifth = f0 * 1.4983;
    const a = play(() => {});
    const b = play((e) => set(e, 'twoVoices', 1));
    const near = (x: Float32Array) => bandEnergy(x, fifth - 4, fifth + 4) / bandEnergy(x, f0 * 2 - 4, f0 * 2 + 4);
    expect(near(b)).toBeGreaterThan(near(a) * 3);
  });

  test('aspereza deixa a onda menos periódica', () => {
    const steady = (e: Engine) => {
      set(e, 'vibDepth', 0);
      set(e, 'jitter', 0);
      set(e, 'shimmer', 0);
      set(e, 'aspiration', 0);
    };
    // Periodicidade: pico da autocorrelação normalizada entre 80 e 300 Hz.
    const periodicity = (x: Float32Array) => {
      const a = Math.floor(0.5 * FS);
      const n = 8192;
      let best = 0;
      for (let lag = Math.floor(FS / 300); lag <= Math.floor(FS / 80); lag++) {
        let num = 0;
        let e1 = 0;
        let e2 = 0;
        for (let i = 0; i < n; i++) {
          num += x[a + i] * x[a + i + lag];
          e1 += x[a + i] ** 2;
          e2 += x[a + i + lag] ** 2;
        }
        best = Math.max(best, num / Math.sqrt(e1 * e2 + 1e-12));
      }
      return best;
    };
    const regular = periodicity(play((e) => steady(e)));
    const rough = periodicity(play((e) => { steady(e); set(e, 'rough', 1); }));
    expect(regular).toBeGreaterThan(0.9);
    expect(rough).toBeLessThan(regular - 0.12);
  });

  test('estalo: sopro de ruído nos primeiros milissegundos da nota', () => {
    const without = play(() => {}, 48, 0.3);
    const withClick = play((e) => set(e, 'click', 1), 48, 0.3);
    const early = (x: Float32Array) => rms(x, 0, Math.floor(0.025 * FS));
    expect(early(withClick)).toBeGreaterThan(early(without) * 3);
    // E o estalo não fica pelo resto da nota.
    expect(rms(withClick, Math.floor(0.2 * FS))).toBeLessThan(rms(without, Math.floor(0.2 * FS)) * 1.5);
  });
});
