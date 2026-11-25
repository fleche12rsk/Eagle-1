import { describe, expect, test } from 'vitest';
import { writeFileSync } from 'node:fs';
import { Engine } from '../src/dsp/engine';
import { HAT, InputListener, KICK, SNARE } from '../src/dsp/listener';
import { PARAMS, PARAM_INDEX, VOWELS, toNormalized, type ParamId } from '../src/dsp/params';
import { Rng } from '../src/dsp/util';
import { fft } from './analysis';

const FS = 48000;
const B = 128;

const set = (e: Engine, id: ParamId, v: number) => e.handle({ t: 'param', i: PARAM_INDEX[id], v: toNormalized(PARAMS[PARAM_INDEX[id]], v) });

/** Gera um sinal de `seconds` s e roda o motor, devolvendo a saída. */
function run(e: Engine, input: Float32Array): Float32Array {
  const total = Math.floor(input.length / B) * B;
  const out = new Float32Array(total);
  const buf = new Float32Array(B);
  for (let off = 0; off < total; off += B) {
    e.process(buf, null, B, input.subarray(off, off + B));
    out.set(buf, off);
  }
  return out;
}

const saw = (hz: number, n: number, amp = 0.4, start = 0): Float32Array => {
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const ph = ((i + start) * hz) / FS;
    x[i] = amp * (2 * (ph - Math.floor(ph + 0.5)));
  }
  return x;
};

const rms = (x: Float32Array, a = 0, b = x.length) => {
  let s = 0;
  for (let i = a; i < b; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, b - a));
};

/** f0 por autocorrelação normalizada na janela [a, b). */
function f0(x: Float32Array, a: number, b: number, fmin = 120, fmax = 900): number {
  const minLag = Math.floor(FS / fmax);
  const maxLag = Math.ceil(FS / fmin);
  let best = 0;
  let bl = minLag;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let num = 0;
    let e1 = 0;
    let e2 = 0;
    for (let i = a; i < b - maxLag; i++) {
      num += x[i] * x[i + lag];
      e1 += x[i] * x[i];
      e2 += x[i + lag] * x[i + lag];
    }
    const r = num / Math.sqrt(e1 * e2 + 1e-12);
    if (r > best) {
      best = r;
      bl = lag;
    }
  }
  return FS / bl;
}

/** Bateria sintética: bumbo (seno grave que cai), caixa (ruído médio) e chimbal (ruído agudo). */
function drums(seconds: number): { x: Float32Array; hits: [number, number][] } {
  const n = Math.floor(seconds * FS);
  const x = new Float32Array(n);
  const rng = new Rng(5);
  const hits: [number, number][] = [];
  const add = (t: number, kind: number) => {
    hits.push([t, kind]);
    const s0 = Math.floor(t * FS);
    const len = kind === KICK ? 0.18 : kind === SNARE ? 0.14 : 0.04;
    let lp = 0;
    let lp2 = 0;
    for (let i = 0; i < len * FS && s0 + i < n; i++) {
      const tt = i / FS;
      const env = Math.exp(-tt / (kind === KICK ? 0.06 : kind === SNARE ? 0.045 : 0.01));
      let v: number;
      if (kind === KICK) v = Math.sin(2 * Math.PI * (50 * tt + 40 * (1 - Math.exp(-tt / 0.03)) * 0.03 * 0 + 40 * tt * Math.exp(-tt / 0.05)));
      else {
        const w = rng.bipolar();
        lp += (w - lp) * 0.35; // tira os agudos extremos
        lp2 += (lp - lp2) * 0.35;
        v = kind === SNARE ? lp2 * 2.2 : w - lp * 0.8; // chimbal: passa-altas
      }
      x[s0 + i] += v * env * (kind === KICK ? 0.8 : kind === SNARE ? 0.7 : 0.5);
    }
  };
  [0.4, 1.2, 2.0].forEach((t) => add(t, KICK));
  [0.8, 1.6, 2.4].forEach((t) => add(t, SNARE));
  [0.6, 1.0, 1.4, 1.8, 2.2, 2.6].forEach((t) => add(t, HAT));
  hits.sort((a, b) => a[0] - b[0]);
  return { x, hits };
}

describe('ouvinte', () => {
  test.each([196, 262, 330, 440, 660])('detecta a altura de %f Hz', (hz) => {
    const L = new InputListener(FS);
    const x = saw(hz, FS);
    for (let off = 0; off + B <= x.length; off += B) L.process(x.subarray(off, off + B), B);
    expect(L.voiced).toBe(true);
    expect(Math.abs(L.pitchHz / hz - 1)).toBeLessThan(0.03);
  });

  test('ruído branco não tem altura', () => {
    const L = new InputListener(FS);
    const r = new Rng(3);
    const x = new Float32Array(FS);
    for (let i = 0; i < x.length; i++) x[i] = r.bipolar() * 0.3;
    for (let off = 0; off + B <= x.length; off += B) L.process(x.subarray(off, off + B), B);
    expect(L.voiced).toBe(false);
  });

  test('acha e classifica bumbo, caixa e chimbal', () => {
    const { x, hits } = drums(3);
    const L = new InputListener(FS);
    const found: [number, number][] = [];
    for (let off = 0; off + B <= x.length; off += B) {
      L.process(x.subarray(off, off + B), B);
      if (L.hitKind >= 0) found.push([off / FS, L.hitKind]);
    }
    let correct = 0;
    const log: string[] = [];
    for (const [t, k] of hits) {
      const m = found.find(([ft]) => ft >= t - 0.01 && ft <= t + 0.06);
      if (m && m[1] === k) correct++;
      log.push(`${t}s esperado ${k} achou ${m ? m[1] : 'nada'}`);
    }
    if (process.env.MUSIC_OUT) writeFileSync(`${process.env.MUSIC_OUT}/hits.txt`, log.join('\n') + `\nextras ${found.length}\n`);
    // Pelo menos 80% das batidas certas, e quase nenhuma batida inventada.
    expect(correct / hits.length).toBeGreaterThanOrEqual(0.8);
    expect(found.length).toBeLessThanOrEqual(hits.length + 2);
  });
});

describe('ouvinte numa música cheia', () => {
  test('acha as batidas mesmo com uma melodia por cima', () => {
    const { x, hits } = drums(3);
    const mel = new Float32Array(x.length);
    const notes = [220, 262, 330, 262, 196, 247];
    for (let i = 0; i < mel.length; i++) {
      const hz = notes[Math.floor(i / (0.5 * FS)) % notes.length];
      const ph = (i * hz) / FS;
      mel[i] = 0.22 * (2 * (ph - Math.floor(ph + 0.5)));
      x[i] += mel[i];
    }
    const L = new InputListener(FS);
    const found: [number, number][] = [];
    for (let off = 0; off + B <= x.length; off += B) {
      L.process(x.subarray(off, off + B), B);
      if (L.hitKind >= 0) found.push([off / FS, L.hitKind]);
    }
    let any = 0;
    let right = 0;
    for (const [t, k] of hits) {
      const m = found.find(([ft]) => ft >= t - 0.01 && ft <= t + 0.06);
      if (m) any++;
      if (m && m[1] === k) right++;
    }
    if (process.env.MUSIC_OUT) writeFileSync(`${process.env.MUSIC_OUT}/mixed.txt`, `achou ${any}/${hits.length}, tipo certo ${right}, total ${found.length}\n`);
    expect(any / hits.length).toBeGreaterThanOrEqual(0.75);
    expect(right / hits.length).toBeGreaterThanOrEqual(0.6);
    expect(found.length).toBeLessThanOrEqual(hits.length + 4);
  });
});

describe('música no motor', () => {
  test('Falar: ruído pela garganta ganha formantes (I mais agudo que U) e fica seguro', () => {
    const r = new Rng(11);
    const input = new Float32Array(FS);
    for (let i = 0; i < input.length; i++) input[i] = r.bipolar() * 0.35;
    const band = (v: keyof typeof VOWELS) => {
      const e = new Engine(FS);
      set(e, 'extMix', 1);
      set(e, 'mouthFollow', 0);
      for (const [k, val] of Object.entries(VOWELS[v])) set(e, k as ParamId, val);
      const out = run(e, input);
      let peak = 0;
      for (const s of out) {
        expect(Number.isNaN(s)).toBe(false);
        peak = Math.max(peak, Math.abs(s));
      }
      expect(peak).toBeLessThanOrEqual(1);
      const size = 8192;
      const re = new Float64Array(size);
      const im = new Float64Array(size);
      for (let i = 0; i < size; i++) re[i] = out[FS / 2 + i];
      fft(re, im);
      const energy = (lo: number, hi: number) => {
        let s = 0;
        for (let k = Math.floor((lo * size) / FS); k < Math.floor((hi * size) / FS); k++) s += re[k] ** 2 + im[k] ** 2;
        return s;
      };
      return { ratio: energy(2000, 3200) / (energy(200, 1000) + 1e-9), rms: rms(out, FS / 2) };
    };
    const i = band('I');
    const u = band('U');
    expect(i.rms).toBeGreaterThan(0.005);
    expect(u.rms).toBeGreaterThan(0.005);
    expect(i.ratio).toBeGreaterThan(u.ratio * 2);
  });

  test('Cantar: a criatura segue a melodia (330 Hz e depois 440 Hz)', () => {
    const half = FS * 1.2;
    const input = new Float32Array(half * 2);
    input.set(saw(330, half), 0);
    input.set(saw(440, half, 0.4, half), half);
    const e = new Engine(FS);
    set(e, 'singAmt', 1);
    const out = run(e, input);
    for (const s of out) expect(Number.isNaN(s)).toBe(false);
    const a = f0(out, Math.floor(0.6 * FS), Math.floor(1.0 * FS));
    const b = f0(out, Math.floor(1.8 * FS), Math.floor(2.2 * FS));
    expect(Math.abs(a / 330 - 1)).toBeLessThan(0.06);
    expect(Math.abs(b / 440 - 1)).toBeLessThan(0.06);
    expect(rms(out, Math.floor(0.6 * FS), Math.floor(1.0 * FS))).toBeGreaterThan(0.01);
  });

  test('Cantar: em silêncio a voz para', () => {
    const input = new Float32Array(FS * 2);
    input.set(saw(262, FS * 0.8), 0);
    const e = new Engine(FS);
    set(e, 'singAmt', 1);
    set(e, 'release', 0.05);
    const out = run(e, input);
    expect(rms(out, Math.floor(1.6 * FS), Math.floor(2 * FS))).toBeLessThan(0.002);
  });

  test('Beatbox: cada batida vira um som de boca e a saída é segura', () => {
    const { x, hits } = drums(3);
    const e = new Engine(FS);
    set(e, 'beatAmt', 1);
    const out = run(e, x);
    let peak = 0;
    for (const s of out) {
      expect(Number.isNaN(s)).toBe(false);
      peak = Math.max(peak, Math.abs(s));
    }
    expect(peak).toBeLessThanOrEqual(1);
    expect(e.hitCount).toBeGreaterThanOrEqual(Math.floor(hits.length * 0.8));
    // Entre as batidas (ex.: 0,25–0,38 s) quase silêncio; logo depois de cada batida, som.
    expect(rms(out, Math.floor(0.2 * FS), Math.floor(0.36 * FS))).toBeLessThan(0.01);
    const lv: string[] = [];
    for (const [t, k] of hits) {
      const w = rms(out, Math.floor((t + 0.005) * FS), Math.floor((t + (k === HAT ? 0.04 : 0.1)) * FS));
      lv.push(`${k} ${t} ${w.toFixed(4)}`);
      if (process.env.MUSIC_OUT) writeFileSync(`${process.env.MUSIC_OUT}/levels.txt`, lv.join('\n'));
      expect(w, `batida ${k} em ${t}s`).toBeGreaterThan(0.004);
    }
    if (process.env.MUSIC_OUT) writeFileSync(`${process.env.MUSIC_OUT}/beatbox.txt`, `hits ${e.hitCount}/${hits.length} peak ${peak.toFixed(3)}\n`);
  });

  test('sem música, nada muda: a saída é silêncio sem notas', () => {
    const e = new Engine(FS);
    const out = run(e, new Float32Array(FS / 2));
    expect(rms(out)).toBeLessThan(1e-6);
  });

  test('CPU: música com Falar + Cantar + Beatbox ligados', () => {
    const { x } = drums(3);
    const mel = saw(330, x.length, 0.3);
    for (let i = 0; i < x.length; i++) x[i] += mel[i];
    const e = new Engine(FS);
    set(e, 'extMix', 0.5);
    set(e, 'singAmt', 1);
    set(e, 'beatAmt', 1);
    run(e, x.subarray(0, FS)); // aquecimento
    const t0 = performance.now();
    run(e, x);
    const used = (performance.now() - t0) / 1000 / (x.length / FS);
    if (process.env.MUSIC_OUT) writeFileSync(`${process.env.MUSIC_OUT}/music-cpu.txt`, `${(used * 100).toFixed(1)}% de um núcleo\n`);
    expect(used).toBeLessThan(0.3);
  }, 60000);
});
