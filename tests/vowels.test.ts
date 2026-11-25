import { describe, expect, test } from 'vitest';
import { VOWELS } from '../src/dsp/params';
import { computeDiameters, stretchedLength } from '../src/dsp/shape';
import { bark, formants, formantsOf, tractResponse } from './analysis';

/** F1 aceitável e F2 de referência para cada vogal (voz adulta, 17,5 cm). */
const REF = {
  A: { f1: [550, 850], f2: 1200 },
  E: { f1: [330, 560], f2: 2150 },
  I: { f1: [200, 350], f2: 2400 },
  O: { f1: [380, 600], f2: 870 },
  U: { f1: [200, 380], f2: 780 },
} as const;

describe('vogais', () => {
  for (const [name, shape] of Object.entries(VOWELS) as [keyof typeof REF, (typeof VOWELS)['A']][]) {
    test(`${name}: F1 e F2 perto da referência (com dentes)`, () => {
      const f = formants({ ...shape, teeth: 0.6 });
      const ref = REF[name];
      expect(f[0]).toBeGreaterThan(ref.f1[0]);
      expect(f[0]).toBeLessThan(ref.f1[1]);
      const f2 = f.slice(1).reduce((best, x) => (Math.abs(bark(x) - bark(ref.f2)) < Math.abs(bark(best) - bark(ref.f2)) ? x : best));
      expect(Math.abs(bark(f2) - bark(ref.f2))).toBeLessThan(1);
    });
  }

  test('as cinco vogais têm envelopes espectrais distintos', () => {
    const names = Object.keys(VOWELS) as (keyof typeof VOWELS)[];
    const spectra = names.map((n) => {
      const { db, binHz } = tractResponse(VOWELS[n]);
      // Média por bandas de 1 Bark entre 200 Hz e 4 kHz.
      const bands: number[] = [];
      for (let b = bark(200); b < bark(4000); b += 1) {
        let sum = 0;
        let c = 0;
        for (let i = 1; i < db.length; i++) {
          const z = bark(i * binHz);
          if (z >= b && z < b + 1) {
            sum += db[i];
            c++;
          }
        }
        bands.push(sum / c);
      }
      return bands;
    });
    for (let a = 0; a < names.length; a++) {
      for (let b = a + 1; b < names.length; b++) {
        let d = 0;
        for (let k = 0; k < spectra[a].length; k++) d += (spectra[a][k] - spectra[b][k]) ** 2;
        const rms = Math.sqrt(d / spectra[a].length);
        expect(rms, `${names[a]} x ${names[b]}`).toBeGreaterThan(4);
      }
    }
  });

  test('diâmetros sempre finitos e positivos fora dos lábios', () => {
    const out = new Float32Array(44);
    for (let i = 0; i < 500; i++) {
      const r = () => Math.random();
      computeDiameters({ tonguePos: r(), tongueHeight: r(), jaw: r(), lipOpen: r(), lipProtrusion: r(), lipWidth: r(), teeth: r() }, out);
      for (let k = 0; k < 38; k++) {
        expect(Number.isFinite(out[k])).toBe(true);
        expect(out[k]).toBeGreaterThan(0);
      }
    }
  });
});

describe('boca esticada', () => {
  test('esticar a boca alonga o tubo e abaixa F1 e F2', () => {
    const base = { ...VOWELS.A, teeth: 0.6 };
    const n = (m: number) => Math.round(44 * stretchedLength(m));
    const f = (m: number) => formantsOf(tractResponse({ ...base, mouthLength: m }, 88200, 16384, n(m)));
    const normal = f(1);
    const long = f(2);
    expect(n(2)).toBeGreaterThan(n(1) + 20);
    expect(long[0]).toBeLessThan(normal[0]);
    expect(long[1]).toBeLessThan(normal[1]);
  });
});
