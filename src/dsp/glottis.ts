/**
 * Fonte glotal pelo modelo LF (Liljencrants-Fant), parametrizado por Rd.
 *
 * Referências:
 *  - G. Fant, J. Liljencrants, Q. Lin, "A four-parameter model of glottal flow" (1985).
 *  - G. Fant, "The LF-model revisited. Transformations and frequency domain analysis" (1995),
 *    de onde vêm as fórmulas Rd -> (Ra, Rk, Rg).
 *  - O Pink Trombone (Neil Thapen, licença MIT) foi estudado como referência de como
 *    usar a derivada do fluxo LF para excitar um guia de onda. Este código é uma
 *    implementação própria: aqui o expoente de crescimento `alpha` é resolvido pela
 *    integral exata do ciclo (fluxo líquido zero) com bissecção.
 *
 * A saída é a derivada do fluxo glotal, normalizada para que o pico negativo
 * (instante de excitação principal, Te) valha -1.
 */

import { Bandpass, Rng, SmoothNoise } from './util';

interface LfShape {
  Te: number;
  omega: number;
  alpha: number;
  E0: number;
  epsilon: number;
  shift: number;
  delta: number;
}

/** Calcula a forma de onda LF para um Rd. Pura, usada também pelos testes. */
export function lfShape(rdIn: number, out: LfShape): LfShape {
  const Rd = rdIn < 0.3 ? 0.3 : rdIn > 2.7 ? 2.7 : rdIn;
  const Ra = (-1 + 4.8 * Rd) / 100;
  const Rk = (22.4 + 11.8 * Rd) / 100;
  const Rg = ((Rk / 4) * (0.5 + 1.2 * Rk)) / (0.11 * Rd - Ra * (0.5 + 1.2 * Rk));

  const Ta = Ra;
  const Tp = 1 / (2 * Rg);
  let Te = Tp * (1 + Rk);
  if (Te > 0.97 - Ta) Te = 0.97 - Ta;

  // Constante de retorno: eps*Ta = 1 - exp(-eps*(1 - Te)), por ponto fixo.
  let epsilon = 1 / Ta;
  for (let i = 0; i < 6; i++) epsilon = (1 - Math.exp(-epsilon * (1 - Te))) / Ta;

  const shift = Math.exp(-epsilon * (1 - Te));
  const delta = 1 - shift;
  // Integral da fase de retorno, onde a derivada vai de -1 até 0.
  const returnIntegral = (shift * (1 - Te)) / delta - 1 / epsilon;

  const omega = Math.PI / Tp;
  const sinTe = Math.sin(omega * Te);

  // Integral da fase aberta para um alpha, com E0 escolhido para valer -1 em Te.
  const openIntegral = (alpha: number): number => {
    const E0 = -1 / (sinTe * Math.exp(alpha * Te));
    const k = alpha * alpha + omega * omega;
    const at = Math.exp(alpha * Te) * (alpha * sinTe - omega * Math.cos(omega * Te));
    return (E0 * (at + omega)) / k;
  };

  // Fluxo líquido zero: openIntegral(alpha) + returnIntegral = 0. A função é decrescente em alpha.
  let lo = -40;
  let hi = 120;
  for (let i = 0; i < 48; i++) {
    const mid = 0.5 * (lo + hi);
    if (openIntegral(mid) + returnIntegral > 0) lo = mid;
    else hi = mid;
  }
  const alpha = 0.5 * (lo + hi);

  out.Te = Te;
  out.omega = omega;
  out.alpha = alpha;
  out.E0 = -1 / (sinTe * Math.exp(alpha * Te));
  out.epsilon = epsilon;
  out.shift = shift;
  out.delta = delta;
  return out;
}

/** Derivada do fluxo glotal num instante t em [0, 1) do período. */
export function lfSample(s: LfShape, t: number): number {
  if (t > s.Te) return (s.shift - Math.exp(-s.epsilon * (t - s.Te))) / s.delta;
  return s.E0 * Math.exp(s.alpha * t) * Math.sin(s.omega * t);
}

export function newLfShape(): LfShape {
  return { Te: 0.6, omega: Math.PI / 0.4, alpha: 0, E0: 1, epsilon: 10, shift: 0, delta: 1 };
}

export interface GlottisParams {
  rd: number;
  aspiration: number;
  jitter: number;
  shimmer: number;
}

/**
 * Fonte glotal de uma voz: pulso LF + aspiração modulada pelo ciclo,
 * com jitter e shimmer por ruído suave.
 */
export class Glottis {
  private shape = newLfShape();
  private nextShape = newLfShape();
  private shapeRd = -1;
  private t = 0;
  private cycleGain = 1;
  private cycleFreqMul = 1;
  private readonly rng: Rng;
  private readonly jitterNoise: SmoothNoise;
  private readonly shimmerNoise: SmoothNoise;
  private readonly aspFilter = new Bandpass();
  private readonly aspFilter2 = new Bandpass();
  /** Abertura instantânea da glote (0..1), útil para modular a aspiração. */
  openness = 0;

  constructor(private readonly fs: number, seed = 1) {
    this.rng = new Rng(seed * 2654435761);
    this.jitterNoise = new SmoothNoise(this.rng);
    this.shimmerNoise = new SmoothNoise(this.rng);
    this.aspFilter.set(900, 0.6, fs);
    this.aspFilter2.set(2600, 0.9, fs);
    lfShape(1, this.shape);
    this.shapeRd = 1;
  }

  reset(): void {
    this.t = 0;
    this.aspFilter.reset();
    this.aspFilter2.reset();
  }

  /**
   * Gera uma amostra na taxa interna.
   * @param freq frequência fundamental em Hz
   */
  next(freq: number, p: GlottisParams): number {
    this.t += (freq * this.cycleFreqMul) / this.fs;
    if (this.t >= 1) {
      this.t -= Math.floor(this.t);
      this.newCycle(freq, p);
    }
    const s = this.shape;
    const v = lfSample(s, this.t) * this.cycleGain;

    // Abertura aproximada: meia senoide durante a fase aberta.
    const open = this.t < s.Te ? Math.sin((Math.PI * this.t) / s.Te) : 0;
    this.openness = open;

    const white = this.rng.bipolar();
    const noise = this.aspFilter.process(white) + 0.5 * this.aspFilter2.process(white);
    const asp = p.aspiration * noise * (0.15 + 0.85 * open) * 1.6;
    return v + asp;
  }

  private newCycle(freq: number, p: GlottisParams): void {
    // Recalcula a forma só quando Rd mudou o bastante.
    if (Math.abs(p.rd - this.shapeRd) > 0.002) {
      lfShape(p.rd, this.nextShape);
      const tmp = this.shape;
      this.shape = this.nextShape;
      this.nextShape = tmp;
      this.shapeRd = p.rd;
    }
    // Jitter: até ~3% de variação de período; shimmer: até ~45% de amplitude.
    const inc = Math.min(1, 9 / Math.max(freq, 1));
    const j = this.jitterNoise.next(inc) * 0.4 + this.rng.bipolar() * 0.6;
    this.cycleFreqMul = 1 + p.jitter * p.jitter * 0.03 * j;
    const sh = this.shimmerNoise.next(inc) * 0.5 + this.rng.bipolar() * 0.5;
    this.cycleGain = 1 - p.shimmer * p.shimmer * 0.45 * (0.5 + 0.5 * sh);
  }
}
