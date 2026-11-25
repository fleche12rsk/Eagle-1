/**
 * Ouvinte: analisa o áudio que o usuário mandou (música, bateria, voz).
 *  - nível e brilho (graves x agudos), que animam a boca;
 *  - altura (autocorrelação), para a criatura cantar a melodia;
 *  - batidas classificadas em bumbo, caixa e chimbal, para o beatbox.
 * Sem alocação depois do construtor.
 */

export const KICK = 0;
export const SNARE = 1;
export const HAT = 2;

const DECIM = 4;
const RING = 512;
const HOP = 64; // em amostras decimadas
const MIN_HZ = 80;
const MAX_HZ = 900;

export class InputListener {
  /** Nível suave (0..1+). */
  level = 0;
  /** 0 = só grave, 1 = só agudo. */
  brightness = 0.4;
  /** Última altura detectada, em Hz, e se há altura clara agora. */
  pitchHz = 0;
  voiced = false;
  /** Batida do último bloco: -1 nenhuma, ou KICK/SNARE/HAT. */
  hitKind = -1;
  hitStrength = 0;

  private readonly fs: number;
  private readonly aLow: number;
  private readonly aHigh: number;
  private lowA = 0;
  private lowB = 0;
  private lpHigh = 0;
  private readonly fast = new Float64Array(3);
  private readonly slow = new Float64Array(3);
  private readonly cFastA: number;
  private readonly cFastR: number;
  private readonly cSlowA: number;
  private readonly cSlowR: number;
  private readonly cLvl: number;
  private readonly cBright: number;
  private hold = 0;
  /** Janela depois do gatilho em que se espera o grave chegar antes de classificar. */
  private pending = 0;
  private readonly pk = new Float64Array(3);
  private readonly settle: number;
  private readonly holdSamples: number;
  private readonly warm: number;
  private seen = 0;

  private readonly ring = new Float32Array(RING);
  private readonly lin = new Float32Array(RING);
  private readonly corr = new Float32Array(RING);
  private ringPos = 0;
  private decCount = 0;
  private decAcc = 0;
  private hopCount = 0;
  private unvoicedFor = 0;
  private pitchSmooth = 0;

  constructor(fs: number) {
    this.fs = fs;
    this.aLow = 1 - Math.exp((-2 * Math.PI * 150) / fs);
    this.aHigh = 1 - Math.exp((-2 * Math.PI * 4000) / fs);
    const c = (t: number) => 1 - Math.exp(-1 / (t * fs));
    this.cFastA = c(0.001);
    this.cFastR = c(0.012);
    this.cSlowA = c(0.06);
    this.cSlowR = c(0.25);
    this.cLvl = c(0.03);
    this.cBright = c(0.12);
    this.holdSamples = Math.round(0.075 * fs);
    this.settle = Math.round(0.007 * fs);
    this.warm = Math.round(0.15 * fs);
  }

  reset(): void {
    this.level = 0;
    this.voiced = false;
    this.pitchHz = 0;
    this.hitKind = -1;
    this.fast.fill(0);
    this.slow.fill(0);
    this.ring.fill(0);
    this.seen = 0;
  }

  /** Analisa um bloco. Zera `hitKind` no começo, então leia depois de cada chamada. */
  process(x: Float32Array, n: number): void {
    this.hitKind = -1;
    this.hitStrength = 0;
    const fast = this.fast;
    const slow = this.slow;
    let midS = 0;
    let highS = 0;
    let lowS = 0;

    for (let i = 0; i < n; i++) {
      const v = x[i];
      this.lowA += (v - this.lowA) * this.aLow;
      this.lowB += (this.lowA - this.lowB) * this.aLow;
      this.lpHigh += (v - this.lpHigh) * this.aHigh;
      const low = this.lowB;
      const mid = this.lpHigh - this.lowA;
      const high = v - this.lpHigh;

      const b0 = low < 0 ? -low : low;
      const b1 = mid < 0 ? -mid : mid;
      const b2 = high < 0 ? -high : high;
      fast[0] += (b0 - fast[0]) * (b0 > fast[0] ? this.cFastA : this.cFastR);
      fast[1] += (b1 - fast[1]) * (b1 > fast[1] ? this.cFastA : this.cFastR);
      fast[2] += (b2 - fast[2]) * (b2 > fast[2] ? this.cFastA : this.cFastR);
      slow[0] += (b0 - slow[0]) * (b0 > slow[0] ? this.cSlowA : this.cSlowR);
      slow[1] += (b1 - slow[1]) * (b1 > slow[1] ? this.cSlowA : this.cSlowR);
      slow[2] += (b2 - slow[2]) * (b2 > slow[2] ? this.cSlowA : this.cSlowR);

      const a = v < 0 ? -v : v;
      this.level += (a - this.level) * this.cLvl;

      if (this.seen < this.warm) this.seen++;
      else if (this.pending > 0) {
        // Espera ~7 ms: o grave de um bumbo chega depois do estalo inicial.
        // Mede a SUBIDA (rápida menos lenta): numa música cheia, o que importa é o que acabou de chegar.
        for (let b = 0; b < 3; b++) {
          const rise = fast[b] - slow[b];
          if (rise > this.pk[b]) this.pk[b] = rise;
        }
        if (--this.pending === 0) {
          const tot = this.pk[0] + this.pk[1] + this.pk[2] + 1e-9;
          // Bumbo tem prioridade: se um grave sobe junto com um chimbal (comum), a boca faz o "pum".
          this.hitKind = this.pk[0] > 0.025 && this.pk[0] / tot > 0.25 ? KICK : this.pk[2] / tot > 0.5 ? HAT : SNARE;
          const s = tot * 3;
          this.hitStrength = s > 1 ? 1 : s;
        }
      } else if (this.hold > 0) this.hold--;
      else {
        // Gatilho: alguma faixa sobe de repente em relação ao seu passado recente.
        let up = false;
        for (let b = 0; b < 3; b++) {
          if (fast[b] < 0.015) continue;
          const r = fast[b] / (slow[b] + 0.012);
          if (fast[b] - slow[b] > 0.02 && (b === 2 ? r * 1.25 : r) > 2.4) up = true;
        }
        if (up) {
          this.pending = this.settle;
          this.pk.fill(0);
          this.hold = this.holdSamples;
        }
      }

      lowS = slow[0];
      midS = slow[1];
      highS = slow[2];

      // Decimação por média simples para a busca de altura.
      this.decAcc += v;
      if (++this.decCount === DECIM) {
        this.ring[this.ringPos] = this.decAcc / DECIM;
        this.ringPos = (this.ringPos + 1) % RING;
        this.decAcc = 0;
        this.decCount = 0;
        if (++this.hopCount === HOP) {
          this.hopCount = 0;
          this.estimatePitch();
        }
      }
    }

    const tot = lowS + midS + highS + 1e-4;
    const br = Math.min(1, ((0.5 * midS + 1.6 * highS) / tot) * 1.4);
    this.brightness += (br - this.brightness) * Math.min(1, this.cBright * n);
  }

  private estimatePitch(): void {
    const lin = this.lin;
    for (let i = 0; i < RING; i++) lin[i] = this.ring[(this.ringPos + i) % RING];
    const fsd = this.fs / DECIM;
    const minLag = Math.max(2, Math.floor(fsd / MAX_HZ));
    const maxLag = Math.min(RING / 2 - 1, Math.ceil(fsd / MIN_HZ));
    const len = RING - maxLag;
    let e0 = 0;
    for (let i = 0; i < len; i++) e0 += lin[i] * lin[i];
    if (e0 < 1e-4) {
      this.markUnvoiced();
      return;
    }
    let gmax = 0;
    const corr = this.corr;
    for (let lag = minLag; lag <= maxLag; lag++) {
      let num = 0;
      let e1 = 0;
      for (let i = 0; i < len; i++) {
        const b = lin[i + lag];
        num += lin[i] * b;
        e1 += b * b;
      }
      const r = num / Math.sqrt(e0 * e1 + 1e-12);
      corr[lag] = r;
      if (r > gmax) gmax = r;
    }
    if (gmax < 0.72) {
      this.markUnvoiced();
      return;
    }
    // Primeiro pico forte (evita pular uma oitava abaixo).
    let pick = -1;
    for (let lag = minLag + 1; lag < maxLag; lag++) {
      if (corr[lag] >= 0.9 * gmax && corr[lag] >= corr[lag - 1] && corr[lag] >= corr[lag + 1]) {
        pick = lag;
        break;
      }
    }
    if (pick < 0) {
      this.markUnvoiced();
      return;
    }
    // Interpolação parabólica.
    const a = corr[pick - 1];
    const b = corr[pick];
    const c = corr[pick + 1];
    const den = a - 2 * b + c;
    const shift = den !== 0 ? (0.5 * (a - c)) / den : 0;
    const hz = fsd / (pick + shift);
    this.pitchSmooth = this.pitchSmooth > 0 && Math.abs(Math.log2(hz / this.pitchSmooth)) < 0.5 ? this.pitchSmooth + (hz - this.pitchSmooth) * 0.5 : hz;
    this.pitchHz = this.pitchSmooth;
    this.voiced = true;
    this.unvoicedFor = 0;
  }

  private markUnvoiced(): void {
    if (++this.unvoicedFor > 3) this.voiced = false;
  }
}
