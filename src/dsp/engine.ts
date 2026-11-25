/**
 * Motor de síntese independente do navegador: recebe mensagens, renderiza blocos.
 * O AudioWorklet só embrulha esta classe; os testes usam ela direto.
 *
 * Fase 1: uma voz, modos mono/legato com pilha de notas.
 */

import { PARAMS, PARAM_COUNT, PARAM_INDEX, defaultNormalized, toPhysical } from './params';
import { DcBlocker, onePoleCoef } from './util';
import { Voice, type VoiceParams } from './voice';

export type EngineMessage =
  | { t: 'param'; i: number; v: number }
  | { t: 'params'; v: ArrayLike<number> }
  | { t: 'on'; n: number; v: number }
  | { t: 'off'; n: number }
  | { t: 'panic' };

const P = PARAM_INDEX;
const MAX_STACK = 32;

export class Engine {
  readonly fs: number;
  /** Valores normalizados vindos da interface. */
  private readonly target: Float32Array = defaultNormalized();
  /** Valores normalizados suavizados (rampa ~12 ms). */
  private readonly current: Float32Array = defaultNormalized();
  private readonly voice: Voice;
  private readonly vp: VoiceParams;
  private readonly stack = new Int16Array(MAX_STACK);
  private stackLen = 0;
  private readonly mix: Float32Array;
  private readonly dc = new DcBlocker(0.9985);
  private limGain = 1;
  private readonly limRelease: number;
  private anatomyDirty = true;

  constructor(fs: number, maxBlock = 128) {
    this.fs = fs;
    this.voice = new Voice(fs, 1);
    this.mix = new Float32Array(Math.max(maxBlock, 128));
    this.limRelease = onePoleCoef(0.12, fs);
    this.vp = {
      fineTune: 0, transpose: 0, fry: 0, tractLength: 1, pitchAmt: 0, pitchAtk: 0.05, pitchDec: 0.5, pitchSus: 0, sacSize: 0, sacElastic: 0.5, sacDamp: 0.4, sacPos: 0.3, sacCouple: 0.6, rd: 1, aspiration: 0, jitter: 0, shimmer: 0, vibRate: 0, vibDepth: 0, vibDelay: 0,
      attack: 0.01, decay: 0.1, sustain: 1, release: 0.1, glide: 0,
      tonguePos: 0.5, tongueHeight: 0.5, jaw: 0.5, lipOpen: 0.5, lipProtrusion: 0, lipWidth: 0.5, teeth: 0,
    };
    this.updatePhysical();
    this.voice.setAnatomy(this.vp);
    this.voice.tract.snapToTarget();
  }

  handle(m: EngineMessage): void {
    switch (m.t) {
      case 'param':
        if (m.i >= 0 && m.i < PARAM_COUNT) this.target[m.i] = clamp01(m.v);
        break;
      case 'params':
        for (let i = 0; i < PARAM_COUNT && i < m.v.length; i++) this.target[i] = clamp01(m.v[i]);
        break;
      case 'on':
        this.noteOn(m.n, m.v);
        break;
      case 'off':
        this.noteOff(m.n);
        break;
      case 'panic':
        this.stackLen = 0;
        this.voice.kill();
        break;
    }
  }

  private noteOn(note: number, vel: number): void {
    this.removeFromStack(note);
    const legato = this.stackLen > 0 && !this.voice.releasing;
    if (this.stackLen < MAX_STACK) this.stack[this.stackLen++] = note;
    this.voice.noteOn(note, vel, legato);
  }

  private noteOff(note: number): void {
    const wasTop = this.stackLen > 0 && this.stack[this.stackLen - 1] === note;
    this.removeFromStack(note);
    if (!wasTop) return;
    if (this.stackLen > 0) {
      // Volta para a nota que ainda está apertada, ligada.
      this.voice.noteOn(this.stack[this.stackLen - 1], 0.8, true);
    } else {
      this.voice.noteOff();
    }
  }

  private removeFromStack(note: number): void {
    let w = 0;
    for (let r = 0; r < this.stackLen; r++) if (this.stack[r] !== note) this.stack[w++] = this.stack[r];
    this.stackLen = w;
  }

  /** Suaviza os parâmetros e converte para unidades físicas. */
  private smoothParams(frames: number): void {
    const coef = 1 - Math.exp(-frames / (0.012 * this.fs));
    for (let i = 0; i < PARAM_COUNT; i++) {
      const d = this.target[i] - this.current[i];
      if (d !== 0) {
        this.current[i] = Math.abs(d) < 1e-5 ? this.target[i] : this.current[i] + d * coef;
        if (i >= P.tonguePos && i <= P.teeth) this.anatomyDirty = true;
      }
    }
    this.updatePhysical();
  }

  private updatePhysical(): void {
    const c = this.current;
    const v = this.vp;
    const ph = (i: number) => toPhysical(PARAMS[i], c[i]);
    v.fineTune = ph(P.fineTune);
    v.transpose = ph(P.transpose);
    v.fry = ph(P.fry);
    v.tractLength = ph(P.tractLength);
    v.pitchAmt = ph(P.pitchAmt);
    v.pitchAtk = ph(P.pitchAtk);
    v.pitchDec = ph(P.pitchDec);
    v.pitchSus = ph(P.pitchSus);
    v.sacSize = ph(P.sacSize);
    v.sacElastic = ph(P.sacElastic);
    v.sacDamp = ph(P.sacDamp);
    v.sacPos = ph(P.sacPos);
    v.sacCouple = ph(P.sacCouple);
    v.rd = ph(P.tension);
    v.aspiration = ph(P.aspiration);
    v.jitter = ph(P.jitter);
    v.shimmer = ph(P.shimmer);
    v.vibRate = ph(P.vibRate);
    v.vibDepth = ph(P.vibDepth);
    v.vibDelay = ph(P.vibDelay);
    v.tonguePos = ph(P.tonguePos);
    v.tongueHeight = ph(P.tongueHeight);
    v.jaw = ph(P.jaw);
    v.lipOpen = ph(P.lipOpen);
    v.lipProtrusion = ph(P.lipProtrusion);
    v.lipWidth = ph(P.lipWidth);
    v.teeth = ph(P.teeth);
    v.attack = ph(P.attack);
    v.decay = ph(P.decay);
    v.sustain = ph(P.sustain);
    v.release = ph(P.release);
    v.glide = ph(P.glide);
  }

  /** Nível de pico recente (0..1), para medidores. */
  get level(): number {
    return this.voice.level;
  }

  /**
   * Renderiza um bloco estéreo. `left` e `right` podem ser o mesmo array.
   */
  process(left: Float32Array, right: Float32Array | null, frames: number): void {
    const mix = this.mix;
    for (let off = 0; off < frames; off += 128) {
      const n = Math.min(128, frames - off);
      this.smoothParams(n);
      if (this.anatomyDirty) {
        this.voice.setAnatomy(this.vp);
        this.anatomyDirty = false;
      }
      mix.fill(0, 0, n);
      // Suavização do trato: ~15 ms para chegar à forma nova.
      const shapeCoef = 1 - Math.exp(-n / (0.015 * this.fs));
      this.voice.render(mix, 0, n, this.vp, shapeCoef);

      const vol = toPhysical(PARAMS[P.volume], this.current[P.volume]) * 0.55;
      for (let s = 0; s < n; s++) {
        let x = this.dc.process(mix[s]) * vol;
        x = this.limit(x);
        left[off + s] = x;
        if (right) right[off + s] = x;
      }
    }
  }

  /** Limitador de segurança: ataque instantâneo, soltura de 120 ms, teto em 0,9. */
  private limit(x: number): number {
    if (x !== x) x = 0;
    const a = x < 0 ? -x : x;
    const ceiling = 0.89;
    const need = a * this.limGain > ceiling ? ceiling / a : 1;
    if (need < this.limGain) this.limGain = need;
    else this.limGain += (1 - this.limGain) * this.limRelease;
    let y = x * this.limGain;
    // Saturação suave por cima, e trava dura como última proteção.
    if (y > 0.8) y = 0.8 + 0.2 * Math.tanh((y - 0.8) / 0.2);
    else if (y < -0.8) y = -0.8 - 0.2 * Math.tanh((-y - 0.8) / 0.2);
    return y > 0.99 ? 0.99 : y < -0.99 ? -0.99 : y;
  }
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v === v ? v : 0);
