/** Utilitários de DSP sem alocação no caminho de áudio. */

/** Gerador pseudoaleatório xorshift32: rápido e determinístico (útil para seeds). */
export class Rng {
  private s: number;
  constructor(seed = 0x9e3779b9) {
    this.s = seed >>> 0 || 1;
  }
  seed(seed: number): void {
    this.s = seed >>> 0 || 1;
  }
  /** Inteiro de 32 bits sem sinal. */
  nextU32(): number {
    let x = this.s;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.s = x >>> 0;
    return this.s;
  }
  /** Uniforme em [0, 1). */
  next(): number {
    return this.nextU32() / 4294967296;
  }
  /** Uniforme em [-1, 1). */
  bipolar(): number {
    return this.next() * 2 - 1;
  }
}

/**
 * Ruído suave: valor aleatório novo a cada `rate` Hz, interpolado por cosseno.
 * Serve para jitter/shimmer e deriva orgânica.
 */
export class SmoothNoise {
  private a = 0;
  private b = 0;
  private phase = 1;
  constructor(private rng: Rng) {}
  next(inc: number): number {
    this.phase += inc;
    if (this.phase >= 1) {
      this.phase -= Math.floor(this.phase);
      this.a = this.b;
      this.b = this.rng.bipolar();
    }
    const t = 0.5 - 0.5 * Math.cos(Math.PI * this.phase);
    return this.a + (this.b - this.a) * t;
  }
}

/** Biquad passa-banda (RBJ, ganho de pico constante 0 dB). */
export class Bandpass {
  private b0 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  set(freq: number, q: number, fs: number): void {
    const w = (2 * Math.PI * freq) / fs;
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    this.b0 = alpha / a0;
    this.b2 = -alpha / a0;
    this.a1 = (-2 * Math.cos(w)) / a0;
    this.a2 = (1 - alpha) / a0;
  }
  process(x: number): number {
    const y = this.b0 * x + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
  reset(): void {
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
  }
}

/** Bloqueador de DC de primeira ordem. */
export class DcBlocker {
  private x1 = 0;
  private y1 = 0;
  constructor(private r = 0.995) {}
  process(x: number): number {
    const y = x - this.x1 + this.r * this.y1;
    this.x1 = x;
    this.y1 = y;
    return y;
  }
  reset(): void {
    this.x1 = this.y1 = 0;
  }
}

export const midiToHz = (n: number): number => 440 * Math.pow(2, (n - 69) / 12);

/** Coeficiente de um suavizador de um polo para uma constante de tempo `tau` (s). */
export const onePoleCoef = (tau: number, rate: number): number =>
  tau <= 0 ? 1 : 1 - Math.exp(-1 / (tau * rate));

/** Remove denormais e NaN de um estado de filtro. */
export const sanitize = (x: number): number => (x > 1e-20 || x < -1e-20 ? (x === x ? x : 0) : 0);
