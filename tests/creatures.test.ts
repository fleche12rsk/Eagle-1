import { describe, expect, test } from 'vitest';
import { writeFileSync } from 'node:fs';
import { Engine } from '../src/dsp/engine';
import { creatureNormalized, type CreatureId } from '../src/dsp/creatures';
import { PARAM_INDEX } from '../src/dsp/params';

const FS = 48000;

function renderNote(creature: CreatureId, note: number, holdS: number, totalS: number, tweak?: (v: Float32Array) => void): Float32Array {
  const e = new Engine(FS);
  const v = creatureNormalized(creature);
  tweak?.(v);
  e.handle({ t: 'params', v });
  const total = Math.floor((totalS * FS) / 128) * 128;
  const out = new Float32Array(total);
  const buf = new Float32Array(128);
  // Deixa os parâmetros assentarem antes da nota.
  for (let i = 0; i < 40; i++) e.process(buf, null, 128);
  e.handle({ t: 'on', n: note, v: 1 });
  for (let off = 0; off < total; off += 128) {
    if (off >= holdS * FS && off - 128 < holdS * FS) e.handle({ t: 'off', n: note });
    e.process(buf, null, 128);
    out.set(buf, off);
  }
  return out;
}

/** f0 por autocorrelação normalizada numa janela, entre fmin e fmax. */
function pitchAt(x: Float32Array, center: number, fmin: number, fmax: number): number {
  const w = 2048;
  const start = Math.max(0, center - w / 2);
  const minLag = Math.floor(FS / fmax);
  const maxLag = Math.ceil(FS / fmin);
  let best = 0;
  let bestLag = minLag;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let num = 0;
    let e1 = 0;
    let e2 = 0;
    for (let i = 0; i < w - maxLag; i++) {
      const a = x[start + i];
      const b = x[start + i + lag];
      num += a * b;
      e1 += a * a;
      e2 += b * b;
    }
    const r = num / Math.sqrt(e1 * e2 + 1e-12);
    if (r > best) {
      best = r;
      bestLag = lag;
    }
  }
  return FS / bestLag;
}

function wav(x: Float32Array): Buffer {
  const b = Buffer.alloc(44 + x.length * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + x.length * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(FS, 24);
  b.writeUInt32LE(FS * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(x.length * 2, 40);
  for (let i = 0; i < x.length; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x[i])) * 32767), 44 + i * 2);
  return b;
}

describe('gavião', () => {
  const scream = renderNote('gaviao', 60, 1.6, 2.2);

  test('grito seguro: sem NaN e abaixo de 1', () => {
    let peak = 0;
    for (const v of scream) {
      expect(Number.isNaN(v)).toBe(false);
      peak = Math.max(peak, Math.abs(v));
    }
    expect(peak).toBeLessThanOrEqual(1);
    expect(peak).toBeGreaterThan(0.05);
  });

  test('o grito sobe no começo e despenca abaixo da nota de partida', () => {
    // Dó4 + 2 oitavas = 1046,5 Hz. Pico ~+5 st (~1400 Hz), fim ~-3,5 st (~850 Hz).
    const early = pitchAt(scream, Math.round(0.1 * FS), 500, 2200);
    const late = pitchAt(scream, Math.round(1.4 * FS), 500, 2200);
    if (process.env.HAWK_OUT) {
      writeFileSync(`${process.env.HAWK_OUT}/gaviao.wav`, wav(scream));
      writeFileSync(`${process.env.HAWK_OUT}/gaviao-pitch.txt`, `inicio ${early.toFixed(0)} Hz, fim ${late.toFixed(0)} Hz\n`);
    }
    expect(early).toBeGreaterThan(1200);
    expect(early).toBeLessThan(1600);
    expect(late).toBeLessThan(early * 0.75);
  });

  test('é bem mais agudo e brilhante que a voz humana', () => {
    const human = renderNote('humano', 48, 1.0, 1.2);
    const centroid = (x: Float32Array) => {
      // Centróide aproximado pela taxa de cruzamentos por zero.
      let zc = 0;
      for (let i = 1; i < x.length; i++) if ((x[i - 1] < 0) !== (x[i] < 0)) zc++;
      return (zc / x.length) * FS * 0.5;
    };
    expect(centroid(scream.subarray(0, FS))).toBeGreaterThan(centroid(human.subarray(0, FS)) * 2);
  });
});

const rms = (x: Float32Array) => Math.sqrt(x.reduce((a, v) => a + v * v, 0) / x.length);

describe('pombo e saco vocal', () => {
  const coo = renderNote('pombo', 60, 1.2, 1.6);

  test('arrulho seguro e audível', () => {
    let peak = 0;
    for (const v of coo) {
      expect(Number.isNaN(v)).toBe(false);
      peak = Math.max(peak, Math.abs(v));
    }
    expect(peak).toBeLessThanOrEqual(1);
    expect(peak).toBeGreaterThan(0.05);
    if (process.env.HAWK_OUT) {
      writeFileSync(`${process.env.HAWK_OUT}/pombo.wav`, wav(coo));
      writeFileSync(`${process.env.HAWK_OUT}/pombo-level.txt`, `pico ${peak.toFixed(3)} rms ${rms(coo).toFixed(4)}\n`);
    }
  });

  test('de bico fechado, o som sai pelo papo: sem saco, quase silêncio', () => {
    const noSac = renderNote('pombo', 60, 1.2, 1.6, (v) => (v[PARAM_INDEX.sacSize] = 0));
    expect(rms(noSac)).toBeLessThan(rms(coo) * 0.1);
  });

  test('o saco muda o timbre de uma voz de boca aberta', () => {
    const plain = renderNote('humano', 48, 0.8, 1.0);
    const withSac = renderNote('humano', 48, 0.8, 1.0, (v) => {
      v[PARAM_INDEX.sacSize] = 0.8;
      v[PARAM_INDEX.sacCouple] = 1;
    });
    let diff = 0;
    for (let i = 0; i < plain.length; i++) diff += (plain[i] - withSac[i]) ** 2;
    expect(Math.sqrt(diff / plain.length)).toBeGreaterThan(rms(plain) * 0.2);
  });
});
