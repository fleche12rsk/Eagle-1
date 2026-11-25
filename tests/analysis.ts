/** Ferramentas de análise usadas pelos testes do DSP. */

import { computeDiameters, type AnatomyShape } from '../src/dsp/shape';
import { Tract } from '../src/dsp/tract';

/** FFT radix-2 in-place (re, im). */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const ar = re[i + j];
        const ai = im[i + j];
        const br = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci;
        const bi = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr;
        re[i + j] = ar + br;
        im[i + j] = ai + bi;
        re[i + j + len / 2] = ar - br;
        im[i + j + len / 2] = ai - bi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

/** Resposta em frequência (dB) do trato para uma forma, na taxa interna `fsInt`. */
export function tractResponse(shape: AnatomyShape, fsInt = 88200, size = 16384, segments = 44): { db: Float64Array; binHz: number } {
  const tract = new Tract(segments, fsInt);
  computeDiameters(shape, tract.target);
  tract.snapToTarget();
  const params = { glottalReflection: 0.75, lipReflection: -0.85, damping: 0.9995 };
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let i = 0; i < size; i++) re[i] = tract.step(i === 0 ? 1 : 0, params);
  fft(re, im);
  const db = new Float64Array(size / 2);
  for (let i = 0; i < size / 2; i++) db[i] = 10 * Math.log10(re[i] * re[i] + im[i] * im[i] + 1e-20);
  return { db, binHz: fsInt / size };
}

/** Picos de ressonância (formantes) abaixo de `maxHz`. */
export function formants(shape: AnatomyShape, maxHz = 4500): number[] {
  return formantsOf(tractResponse(shape), maxHz);
}

/** Picos de uma resposta já calculada. */
export function formantsOf({ db, binHz }: { db: Float64Array; binHz: number }, maxHz = 4500): number[] {
  // Suavização leve (3 pontos): F1 e F2 de vogais posteriores ficam muito próximos.
  const sm = new Float64Array(db.length);
  for (let i = 1; i < db.length - 1; i++) sm[i] = (db[i - 1] + 2 * db[i] + db[i + 1]) / 4;
  const peaks: number[] = [];
  const lo = Math.ceil(150 / binHz);
  const hi = Math.floor(maxHz / binHz);
  for (let i = lo; i < hi; i++) {
    if (sm[i] > sm[i - 1] && sm[i] >= sm[i + 1]) {
      // Proeminência mínima de 1 dB em relação aos vales vizinhos (janela de 120 Hz).
      const w = Math.round(120 / binHz);
      let minL = Infinity;
      let minR = Infinity;
      for (let k = Math.max(0, i - w); k < i; k++) minL = Math.min(minL, sm[k]);
      for (let k = i + 1; k <= Math.min(sm.length - 1, i + w); k++) minR = Math.min(minR, sm[k]);
      if (sm[i] - Math.max(minL, minR) > 1) peaks.push(i * binHz);
    }
  }
  return peaks;
}

/** Escala Bark (Traunmüller). */
export const bark = (f: number) => (26.81 * f) / (1960 + f) - 0.53;
