/**
 * Uma voz completa: glote + trato + envelope + pitch.
 * Roda na taxa interna (oversampling 2x) e devolve amostras na taxa externa.
 */

import { Glottis } from './glottis';
import { VocalSac, type SacParams } from './sac';
import { computeDiameters, type AnatomyShape } from './shape';
import { Tract, type TractParams } from './tract';
import { Rng, SmoothNoise, midiToHz } from './util';

export const OVERSAMPLE = 2;
export const DEFAULT_SEGMENTS = 44;

/** Parâmetros físicos que a voz lê a cada bloco (já suavizados pelo motor). */
export interface VoiceParams extends AnatomyShape, SacParams {
  fineTune: number; // cents
  transpose: number; // semitons
  fry: number;
  tractLength: number; // 1 = adulto (44 segmentos)
  pitchAmt: number; // semitons
  pitchAtk: number; // s
  pitchDec: number; // s
  pitchSus: number; // -1..1, fração de pitchAmt
  rd: number;
  aspiration: number;
  jitter: number;
  shimmer: number;
  vibRate: number;
  vibDepth: number; // cents
  vibDelay: number; // s
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  glide: number;
}

const enum Stage {
  Idle,
  Attack,
  Decay,
  Sustain,
  Release,
  /** Fade curto para roubo de voz, sem estalo. */
  Steal,
}

export class Voice {
  readonly tract: Tract;
  private readonly glottis: Glottis;
  private readonly sac: VocalSac;
  private readonly rateInt: number;
  private readonly tractParams: TractParams = { glottalReflection: 0.75, lipReflection: -0.85, damping: 0.9995 };
  private readonly drift: SmoothNoise;

  note = -1;
  private velocity = 1;
  private stage = Stage.Idle;
  private env = 0;
  private noteAge = 0;
  /** log2 da frequência atual e alvo, para glide exponencial. */
  private logF = Math.log2(220);
  private logFTarget = Math.log2(220);
  private vibPhase = 0;
  private pendingNote = -1;
  private pendingVel = 0;
  private stealGain = 1;
  /** Envelope de pitch: valor (0..1, pode ficar negativo) e fase. */
  private pEnv = 0;
  private pAttacking = false;
  private anatomy: AnatomyShape | null = null;
  /** Nível de saída recente (para a interface). */
  level = 0;

  constructor(private readonly fs: number, seed = 1, segments = DEFAULT_SEGMENTS) {
    this.rateInt = fs * OVERSAMPLE;
    this.tract = new Tract(segments, this.rateInt);
    this.glottis = new Glottis(this.rateInt, seed);
    this.sac = new VocalSac(this.rateInt);
    this.drift = new SmoothNoise(new Rng(seed * 7919 + 13));
  }

  get active(): boolean {
    return this.stage !== Stage.Idle;
  }

  get releasing(): boolean {
    return this.stage === Stage.Release || this.stage === Stage.Steal;
  }

  /** Aplica a anatomia ao alvo do trato. */
  setAnatomy(a: AnatomyShape): void {
    this.anatomy = a;
    computeDiameters(a, this.tract.target);
  }

  /** Ajusta o comprimento do tubo. Só tem efeito com a voz em silêncio. */
  private applyLength(length: number): void {
    const n = DEFAULT_SEGMENTS * length;
    if (Math.round(n) === this.tract.n) return;
    this.tract.setSegments(n);
    if (this.anatomy) computeDiameters(this.anatomy, this.tract.target);
    this.tract.snapToTarget();
  }

  /** Começa uma nota. Se `legato`, só escorrega o pitch sem reiniciar o envelope. */
  noteOn(note: number, velocity: number, legato: boolean): void {
    const target = Math.log2(midiToHz(note));
    if (legato && this.stage !== Stage.Idle && this.stage !== Stage.Release && this.stage !== Stage.Steal) {
      this.note = note;
      this.logFTarget = target;
      this.velocity = velocity;
      return;
    }
    if (this.stage !== Stage.Idle && this.env > 0.0005) {
      // Voz ainda soando: faz um fade de 5 ms antes de reiniciar.
      this.pendingNote = note;
      this.pendingVel = velocity;
      this.stage = Stage.Steal;
      this.stealGain = 1;
      this.note = note;
      this.logFTarget = target;
      return;
    }
    this.start(note, velocity, !legato);
  }

  private start(note: number, velocity: number, jumpPitch: boolean): void {
    this.note = note;
    this.velocity = velocity;
    this.logFTarget = Math.log2(midiToHz(note));
    if (jumpPitch) this.logF = this.logFTarget;
    this.stage = Stage.Attack;
    this.noteAge = 0;
    this.vibPhase = 0;
    this.env = 0;
    this.stealGain = 1;
    this.pEnv = 0;
    this.pAttacking = true;
    this.needsLength = true;
  }

  private needsLength = true;

  noteOff(): void {
    if (this.stage === Stage.Idle || this.stage === Stage.Release) return;
    if (this.stage === Stage.Steal) {
      this.pendingNote = -1;
      return;
    }
    this.stage = Stage.Release;
  }

  /** Corte rápido (fade de ~5 ms). */
  kill(): void {
    if (this.stage === Stage.Idle) return;
    this.pendingNote = -1;
    this.stage = Stage.Steal;
    this.stealGain = 1;
  }

  /**
   * Renderiza `frames` amostras somando em `out`.
   * @param shapeCoef suavização dos diâmetros neste bloco
   */
  render(out: Float32Array, offset: number, frames: number, p: VoiceParams, shapeCoef: number): void {
    if (this.stage === Stage.Idle) {
      this.level *= 0.9;
      return;
    }
    const fs = this.fs;
    const tract = this.tract;
    if (this.needsLength) {
      // Início de nota: o tubo está em silêncio, dá para trocar o comprimento.
      this.applyLength(p.tractLength);
      this.needsLength = false;
    }
    tract.beginBlock(shapeCoef, frames);

    // Saco vocal: ponto de ligação, quanto irradia e quanto rouba do tubo.
    const sac = this.sac;
    const sacOn = p.sacSize > 0.002;
    if (sacOn) sac.configure(p);
    const sacJ = Math.min(tract.n - 2, Math.max(1, Math.round(p.sacPos * (tract.n - 1))));
    const sacRad = sacOn ? p.sacCouple * (2 + 8 * p.sacSize) * Math.min(1, p.sacSize * 8) : 0;
    const sacFb = sacOn ? 0.4 * p.sacCouple * Math.min(1, p.sacSize * 8) : 0;

    const dt = 1 / fs;
    const glideCoef = p.glide <= 0.0005 ? 1 : 1 - Math.exp(-dt / (p.glide * 0.35));
    const atkInc = dt / Math.max(p.attack, 0.001);
    const decCoef = 1 - Math.exp(-dt / Math.max(p.decay * 0.3, 0.001));
    const relCoef = 1 - Math.exp(-dt / Math.max(p.release * 0.3, 0.001));
    const stealDec = dt / 0.005;
    const pAtkInc = dt / Math.max(p.pitchAtk, 0.001);
    const pDecCoef = 1 - Math.exp(-dt / Math.max(p.pitchDec * 0.3, 0.001));
    const baseCents = p.fineTune + p.transpose * 100;
    const tp = this.tractParams;
    const glottis = this.glottis;
    const amp = 0.35 + 0.65 * this.velocity;
    let peak = 0;

    for (let s = 0; s < frames; s++) {
      // Envelope de amplitude.
      switch (this.stage) {
        case Stage.Attack:
          this.env += atkInc;
          if (this.env >= 1) {
            this.env = 1;
            this.stage = Stage.Decay;
          }
          break;
        case Stage.Decay:
          this.env += (p.sustain - this.env) * decCoef;
          if (Math.abs(this.env - p.sustain) < 1e-4) this.stage = Stage.Sustain;
          break;
        case Stage.Sustain:
          this.env += (p.sustain - this.env) * 0.001;
          break;
        case Stage.Release:
          this.env -= this.env * relCoef;
          if (this.env < 1e-4) {
            this.env = 0;
            this.stage = Stage.Idle;
          }
          break;
        case Stage.Steal:
          this.stealGain -= stealDec;
          if (this.stealGain <= 0) {
            this.stealGain = 0;
            if (this.pendingNote >= 0) {
              tract.reset();
              glottis.reset();
              sac.reset();
              this.start(this.pendingNote, this.pendingVel, true);
              this.pendingNote = -1;
            } else {
              this.env = 0;
              this.stage = Stage.Idle;
            }
          }
          break;
        default:
          break;
      }

      // Pitch: glide + vibrato com atraso + deriva lenta.
      this.logF += (this.logFTarget - this.logF) * glideCoef;
      this.noteAge += dt;
      const vibRamp = p.vibDelay <= 0 ? 1 : Math.min(1, Math.max(0, (this.noteAge - p.vibDelay * 0.5) / (p.vibDelay * 0.5 + 1e-3)));
      this.vibPhase += p.vibRate * dt;
      if (this.vibPhase >= 1) this.vibPhase -= 1;
      const vib = Math.sin(2 * Math.PI * this.vibPhase) * p.vibDepth * vibRamp;
      const drift = this.drift.next(3 * dt) * 4 * (0.3 + p.jitter);
      // Envelope de pitch: sobe até 1 e escorrega até pitchSus.
      if (this.pAttacking) {
        this.pEnv += pAtkInc;
        if (this.pEnv >= 1) {
          this.pEnv = 1;
          this.pAttacking = false;
        }
      } else {
        this.pEnv += (p.pitchSus - this.pEnv) * pDecCoef;
      }
      const cents = baseCents + vib + drift + p.pitchAmt * this.pEnv * 100;
      let freq = Math.pow(2, this.logF + cents / 1200);
      // Teto bem abaixo do Nyquist interno, para o pulso não serrilhar.
      if (freq > 6000) freq = 6000;

      tract.advance();

      // Oversampling 2x: duas passadas no tubo, média simples como decimação.
      const g1 = glottis.next(freq, p);
      let y1 = tract.step(g1, tp);
      if (sacOn) {
        const sv = sac.process(tract.pressureAt(sacJ));
        tract.inject(sacJ, -sacFb * (sv > 1 ? 1 : sv < -1 ? -1 : sv));
        y1 += sacRad * sv;
      }
      const g2 = glottis.next(freq, p);
      let y2 = tract.step(g2, tp);
      if (sacOn) {
        const sv = sac.process(tract.pressureAt(sacJ));
        tract.inject(sacJ, -sacFb * (sv > 1 ? 1 : sv < -1 ? -1 : sv));
        y2 += sacRad * sv;
      }
      const y = 0.5 * (y1 + y2) * this.env * this.stealGain * amp;

      out[offset + s] += y;
      const a = y < 0 ? -y : y;
      if (a > peak) peak = a;
    }
    this.level = Math.max(peak, this.level * 0.85);
  }
}
