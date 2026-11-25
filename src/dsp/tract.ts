/**
 * Trato oral como guia de onda Kelly-Lochbaum.
 *
 * Cada segmento é um atraso de uma amostra na taxa interna (2x a taxa do
 * contexto). Nas junções, o coeficiente de reflexão sai da diferença de áreas:
 *   k = (A[i-1] - A[i]) / (A[i-1] + A[i]).
 *
 * Os coeficientes são recalculados por bloco e interpolados amostra a amostra,
 * para que mudanças de forma não estalem.
 */

export const MAX_SEGMENTS = 64;

export interface TractParams {
  glottalReflection: number;
  lipReflection: number;
  /** Perda por atrito por segmento (1 = sem perda). */
  damping: number;
}

export class Tract {
  readonly n: number;
  private readonly R: Float64Array;
  private readonly L: Float64Array;
  private readonly k: Float64Array;
  private readonly kInc: Float64Array;
  private readonly kTo: Float64Array;
  /** Diâmetros atuais (suavizados). */
  readonly diameter: Float32Array;
  /** Diâmetros-alvo vindos da anatomia. */
  readonly target: Float32Array;
  private lipLp = 0;
  private readonly lipCoef: number;
  private lipOut = 0;

  constructor(n: number, fs: number) {
    this.n = n;
    this.R = new Float64Array(n);
    this.L = new Float64Array(n);
    this.k = new Float64Array(n);
    this.kInc = new Float64Array(n);
    this.kTo = new Float64Array(n);
    this.diameter = new Float32Array(n).fill(1.5);
    this.target = new Float32Array(n).fill(1.5);
    // Reflexão labial depende da frequência: graves voltam, agudos irradiam.
    this.lipCoef = 1 - Math.exp((-2 * Math.PI * 4000) / fs);
    this.snapToTarget();
  }

  reset(): void {
    this.R.fill(0);
    this.L.fill(0);
    this.lipLp = 0;
    this.lipOut = 0;
  }

  /** Copia o alvo direto para o estado atual (sem suavização). */
  snapToTarget(): void {
    this.diameter.set(this.target);
    this.computeK(this.kTo);
    this.k.set(this.kTo);
    this.kInc.fill(0);
  }

  /**
   * Início de bloco: move os diâmetros em direção ao alvo e prepara a rampa
   * linear dos coeficientes ao longo de `steps` passos de `advance()`.
   * @param coef fração do caminho percorrida neste bloco (0..1)
   */
  beginBlock(coef: number, steps: number): void {
    const d = this.diameter;
    const t = this.target;
    for (let i = 0; i < this.n; i++) d[i] += (t[i] - d[i]) * coef;
    // Começa do ponto onde a rampa anterior terminou, sem degrau.
    this.computeK(this.kTo);
    const inv = 1 / steps;
    const k = this.k;
    const kTo = this.kTo;
    const inc = this.kInc;
    for (let i = 1; i < this.n; i++) inc[i] = (kTo[i] - k[i]) * inv;
  }

  private computeK(out: Float64Array): void {
    const d = this.diameter;
    out[0] = 0;
    for (let i = 1; i < this.n; i++) {
      const a0 = d[i - 1] * d[i - 1];
      const a1 = d[i] * d[i];
      const sum = a0 + a1;
      out[i] = sum < 1e-6 ? 0.999 : (a0 - a1) / sum;
    }
  }

  /** Avança a rampa dos coeficientes um passo. */
  advance(): void {
    const k = this.k;
    const inc = this.kInc;
    for (let i = 1; i < this.n; i++) k[i] += inc[i];
  }

  /**
   * Um passo do guia de onda, feito in-place num único laço.
   * @param input excitação injetada na glote
   * @returns pressão irradiada pelos lábios
   */
  step(input: number, p: TractParams): number {
    const n = this.n;
    const R = this.R;
    const L = this.L;
    const k = this.k;
    const damp = p.damping;

    // Reflexão labial filtrada: a parte grave da onda volta para dentro.
    const atLips = R[n - 1];
    this.lipLp += (atLips - this.lipLp) * this.lipCoef;
    const backFromLips = this.lipLp * p.lipReflection;

    let rPrev = R[0];
    R[0] = (L[0] * p.glottalReflection + input) * damp;
    for (let i = 1; i < n; i++) {
      const li = L[i];
      const w = k[i] * (rPrev + li);
      const rOld = R[i];
      R[i] = (rPrev - w) * damp;
      L[i - 1] = (li + w) * damp;
      rPrev = rOld;
    }
    L[n - 1] = backFromLips * damp;

    // Radiação: o que não voltou sai pela boca (agudos mais que graves).
    const out = atLips - this.lipLp * 0.5;
    this.lipOut = out;
    return out;
  }

  get lastOutput(): number {
    return this.lipOut;
  }
}
