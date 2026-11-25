import { describe, expect, test } from 'vitest';
import { writeFileSync } from 'node:fs';
import { Engine } from '../src/dsp/engine';
import { PARAMS, PARAM_INDEX, VOWELS, toNormalized, type ParamId } from '../src/dsp/params';
import { Voice } from '../src/dsp/voice';

const FS = 48000;
const BLOCK = 128;

function setParam(e: Engine, id: ParamId, physical: number) {
  e.handle({ t: 'param', i: PARAM_INDEX[id], v: toNormalized(PARAMS[PARAM_INDEX[id]], physical) });
}

function setVowel(e: Engine, v: keyof typeof VOWELS) {
  for (const [k, val] of Object.entries(VOWELS[v])) setParam(e, k as ParamId, val);
}

/** Renderiza `seconds` chamando `at(t)` no começo de cada bloco. */
function render(e: Engine, seconds: number, at: (blockIndex: number, t: number) => void = () => {}): Float32Array {
  const total = Math.floor((seconds * FS) / BLOCK) * BLOCK;
  const out = new Float32Array(total);
  const buf = new Float32Array(BLOCK);
  for (let b = 0; b * BLOCK < total; b++) {
    at(b, (b * BLOCK) / FS);
    e.process(buf, null, BLOCK);
    out.set(buf, b * BLOCK);
  }
  return out;
}

describe('motor', () => {
  test('sem NaN e nunca acima de 1 na saída, mesmo com parâmetros extremos', () => {
    const e = new Engine(FS);
    let i = 0;
    const out = render(e, 6, (b) => {
      if (b % 40 === 0) {
        e.handle({ t: 'on', n: 24 + ((i * 7) % 72), v: 1 });
        i++;
      }
      if (b % 40 === 30) e.handle({ t: 'off', n: 24 + (((i - 1) * 7) % 72) });
      if (b % 17 === 0) for (let p = 0; p < PARAMS.length; p++) e.handle({ t: 'param', i: p, v: Math.random() });
      if (b % 97 === 0) e.handle({ t: 'param', i: PARAM_INDEX.volume, v: 1 });
    });
    let peak = 0;
    for (const x of out) {
      expect(Number.isNaN(x)).toBe(false);
      peak = Math.max(peak, Math.abs(x));
    }
    expect(peak).toBeLessThanOrEqual(1);
    expect(peak).toBeGreaterThan(0.01);
  });

  test('trocar de vogal e de nota não gera estalos', () => {
    const e = new Engine(FS);
    setVowel(e, 'A');
    const seq: [number, () => void][] = [
      [0.0, () => e.handle({ t: 'on', n: 52, v: 0.9 })],
      [0.6, () => setVowel(e, 'I')],
      [1.0, () => setVowel(e, 'U')],
      [1.4, () => setVowel(e, 'E')],
      [1.8, () => setVowel(e, 'O')],
      [2.2, () => e.handle({ t: 'on', n: 59, v: 0.9 })],
      [2.6, () => e.handle({ t: 'off', n: 59 })],
      [2.8, () => e.handle({ t: 'off', n: 52 })],
      [3.4, () => e.handle({ t: 'on', n: 45, v: 1 })],
      [3.45, () => e.handle({ t: 'on', n: 64, v: 1 })], // roubo da voz com fade
    ];
    let k = 0;
    const out = render(e, 4, (_, t) => {
      while (k < seq.length && seq[k][0] <= t) seq[k++][1]();
    });
    // Estalo = salto de amostra muito maior que o maior salto típico do som.
    const diffs: number[] = [];
    for (let i = 1; i < out.length; i++) diffs.push(Math.abs(out[i] - out[i - 1]));
    const steady = diffs.slice(Math.floor(0.3 * FS), Math.floor(0.55 * FS));
    const steadyMax = steady.reduce((m, x) => Math.max(m, x), 0);
    const allMax = diffs.reduce((m, x) => Math.max(m, x), 0);
    expect(allMax).toBeLessThan(steadyMax * 2);
  });

  test('CPU: 1 voz e estimativa para 16 vozes', () => {
    const e = new Engine(FS);
    e.handle({ t: 'on', n: 48, v: 1 });
    const buf = new Float32Array(BLOCK);
    for (let i = 0; i < 200; i++) e.process(buf, null, BLOCK); // aquecimento do JIT
    const seconds = 10;
    const t0 = performance.now();
    for (let i = 0; i < (seconds * FS) / BLOCK; i++) e.process(buf, null, BLOCK);
    const oneVoice = (performance.now() - t0) / 1000 / seconds;

    const voices = Array.from({ length: 16 }, (_, i) => new Voice(FS, i + 1));
    const vp = {
      fineTune: 0, transpose: 0, fry: 0, tractLength: 1, pitchAmt: 0, pitchAtk: 0.05, pitchDec: 0.5, pitchSus: 0, sacSize: 0, sacElastic: 0.5, sacDamp: 0.4, sacPos: 0.3, sacCouple: 0.6, rd: 1.1, aspiration: 0.1, jitter: 0.2, shimmer: 0.1, vibRate: 5, vibDepth: 20, vibDelay: 0.3,
      attack: 0.01, decay: 0.2, sustain: 0.8, release: 0.3, glide: 0.05, ...VOWELS.A,
    };
    voices.forEach((v, i) => {
      v.setAnatomy(vp);
      v.noteOn(40 + i * 3, 1, false);
    });
    const mix = new Float32Array(BLOCK);
    for (let i = 0; i < 100; i++) for (const v of voices) v.render(mix, 0, BLOCK, vp, 0.1);
    const t1 = performance.now();
    const blocks = (2 * FS) / BLOCK;
    for (let i = 0; i < blocks; i++) {
      mix.fill(0);
      for (const v of voices) v.render(mix, 0, BLOCK, vp, 0.1);
    }
    const sixteen = (performance.now() - t1) / 1000 / 2;
    const report = `1 voz: ${(oneVoice * 100).toFixed(2)}% de um núcleo\n16 vozes: ${(sixteen * 100).toFixed(1)}% de um núcleo\n`;
    if (process.env.CPU_REPORT) writeFileSync(process.env.CPU_REPORT, report);
    expect(sixteen).toBeLessThan(0.5);
  }, 60000);
});
