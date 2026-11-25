/**
 * Motor de síntese independente do navegador: recebe mensagens, renderiza blocos.
 * O AudioWorklet só embrulha esta classe; os testes usam ela direto.
 *
 * Fase 1: uma voz, modos mono/legato com pilha de notas.
 */

import { PARAMS, PARAM_COUNT, PARAM_INDEX, defaultNormalized, toPhysical } from './params';
import { HAT, InputListener, KICK, SNARE } from './listener';
import type { AnatomyShape } from './shape';
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
/** Ganhos do ruído das consoantes (calibrados para o ruído sair no mesmo nível da voz). */
const SNARE_GAIN = 3;
const HAT_GAIN = 2.4;
const KICK_BOOST = 4.5;

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

  // ----- Música enviada pelo usuário -----
  private readonly listener: InputListener;
  private readonly inBuf = new Float32Array(128);
  private readonly extBuf = new Float32Array(128);
  private readonly beat: Voice;
  private readonly beatVp: VoiceParams;
  private readonly beatMix = new Float32Array(128);
  private readonly followShape: AnatomyShape = { tonguePos: 0.5, tongueHeight: 0.5, jaw: 0.5, lipOpen: 0.5, lipProtrusion: 0, lipWidth: 0.5, teeth: 0, mouthLength: 1 };
  private readonly beatShape: AnatomyShape = { tonguePos: 0.5, tongueHeight: 0.5, jaw: 0.5, lipOpen: 0.5, lipProtrusion: 0, lipWidth: 0.5, teeth: 0, mouthLength: 1 };
  private singing = false;
  private quietFor = 0;
  private beatKind = -1;
  private beatT = 0;
  /** Para a interface: nível da música, contagem de batidas e a última. */
  meterIn = 0;
  hitCount = 0;
  lastHit = -1;
  inPitch = 0;
  meterBright = 0;

  constructor(fs: number, maxBlock = 128) {
    this.fs = fs;
    this.voice = new Voice(fs, 1);
    this.listener = new InputListener(fs);
    this.beat = new Voice(fs, 77);
    this.mix = new Float32Array(Math.max(maxBlock, 128));
    this.limRelease = onePoleCoef(0.12, fs);
    this.vp = {
      fineTune: 0, transpose: 0, fry: 0, tractLength: 1, pitchAmt: 0, pitchAtk: 0.05, pitchDec: 0.5, pitchSus: 0, sacSize: 0, sacElastic: 0.5, sacDamp: 0.4, sacPos: 0.3, sacCouple: 0.6, rd: 1, aspiration: 0, jitter: 0, shimmer: 0, vibRate: 0, vibDepth: 0, vibDelay: 0,
      attack: 0.01, decay: 0.1, sustain: 1, release: 0.1, glide: 0,
      tonguePos: 0.5, tongueHeight: 0.5, jaw: 0.5, lipOpen: 0.5, lipProtrusion: 0, lipWidth: 0.5, teeth: 0, mouthLength: 1,
    };
    this.beatVp = { ...this.vp };
    Object.assign(this.beatVp, {
      rd: 0.9, aspiration: 0.03, jitter: 0, shimmer: 0, fry: 0, vibRate: 0, vibDepth: 0, vibDelay: 0,
      sacSize: 0, teeth: 0.6, mouthLength: 1, transpose: 0, fineTune: 0, glide: 0,
      attack: 0.002, decay: 0.14, sustain: 0, release: 0.05,
      pitchAmt: 14, pitchAtk: 0.002, pitchDec: 0.07, pitchSus: 0,
    });
    this.updatePhysical();
    this.voice.setAnatomy(this.vp);
    this.voice.tract.snapToTarget();
    this.beat.setAnatomy(this.beatShape);
    this.beat.tract.snapToTarget();
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
        this.singing = false;
        this.voice.kill();
        this.beat.kill();
        this.beatKind = -1;
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
    v.mouthLength = ph(P.mouthLength);
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
  process(left: Float32Array, right: Float32Array | null, frames: number, input: Float32Array | null = null): void {
    const mix = this.mix;
    for (let off = 0; off < frames; off += 128) {
      const n = Math.min(128, frames - off);
      this.smoothParams(n);
      const cur = this.current;
      const inGain = toPhysical(PARAMS[P.inGain], cur[P.inGain]);
      const extMix = toPhysical(PARAMS[P.extMix], cur[P.extMix]);
      const singAmt = toPhysical(PARAMS[P.singAmt], cur[P.singAmt]);
      const beatAmt = toPhysical(PARAMS[P.beatAmt], cur[P.beatAmt]);
      const follow = toPhysical(PARAMS[P.mouthFollow], cur[P.mouthFollow]);
      const hasInput = input !== null && input.length >= off + n;
      let ext: Float32Array | null = null;
      let anatomyFollowing = false;

      if (hasInput) {
        const raw = this.inBuf;
        for (let s = 0; s < n; s++) raw[s] = input![off + s];
        this.listener.process(raw, n);
        this.meterIn = this.listener.level;
        this.inPitch = this.listener.voiced ? this.listener.pitchHz : 0;
        this.meterBright = this.listener.brightness;

        if (extMix > 0.02) {
          const e = this.extBuf;
          for (let s = 0; s < n; s++) {
            const v = raw[s] * inGain;
            // Compressão suave: o tubo ressoa e pode somar muito.
            e[s] = Math.tanh(v * 1.5) * 0.9;
          }
          ext = e;
        }
        if (beatAmt > 0.02 && this.listener.hitKind >= 0) this.triggerBeat(this.listener.hitKind, this.listener.hitStrength);
        if (extMix > 0.02 || singAmt > 0.02) {
          this.driveVoice(n, singAmt, extMix > 0.02);
          anatomyFollowing = follow > 0.01;
        }
      } else if (this.singing) {
        this.stopSinging();
      }

      if (anatomyFollowing) {
        const L = this.listener;
        const env = Math.min(1, L.level * 5);
        const f = this.followShape;
        const vp = this.vp;
        f.jaw = vp.jaw + (0.15 + 0.85 * env - vp.jaw) * follow;
        f.lipOpen = vp.lipOpen + (0.3 + 0.65 * env - vp.lipOpen) * follow;
        f.tonguePos = vp.tonguePos + (0.15 + 0.8 * L.brightness - vp.tonguePos) * follow;
        f.tongueHeight = vp.tongueHeight + (0.3 + 0.5 * L.brightness * (1 - 0.5 * env) - vp.tongueHeight) * follow;
        f.lipProtrusion = vp.lipProtrusion;
        f.lipWidth = vp.lipWidth;
        f.teeth = vp.teeth;
        f.mouthLength = vp.mouthLength;
        this.voice.setAnatomy(f);
        this.anatomyDirty = true;
      } else if (this.anatomyDirty) {
        this.voice.setAnatomy(this.vp);
        this.anatomyDirty = false;
      }

      mix.fill(0, 0, n);
      // Suavização do trato: ~15 ms para chegar à forma nova.
      const shapeCoef = 1 - Math.exp(-n / (0.015 * this.fs));
      this.voice.render(mix, 0, n, this.vp, shapeCoef, ext, extMix, 1);

      // Beatbox: uma segunda boca, só para os sons percussivos.
      if (this.beatKind >= 0 || !this.beat.idle) {
        this.updateBeatMouth(n);
        const bm = this.beatMix;
        bm.fill(0, 0, n);
        this.beatVp.tractLength = this.vp.tractLength;
        this.beat.render(bm, 0, n, this.beatVp, 1 - Math.exp(-n / (0.004 * this.fs)));
        const g = 1.4 * Math.max(beatAmt, 0.0001) * (this.beatKind === KICK ? KICK_BOOST : 1);
        for (let s = 0; s < n; s++) mix[s] += bm[s] * g;
      }

      const vol = toPhysical(PARAMS[P.volume], this.current[P.volume]) * 0.55;
      for (let s = 0; s < n; s++) {
        let x = this.dc.process(mix[s]) * vol;
        x = this.limit(x);
        left[off + s] = x;
        if (right) right[off + s] = x;
      }
    }
  }

  // ---------- Música: cantar, falar e beatbox ----------

  /** Liga e desliga a voz principal conforme a música soa, e a faz seguir a melodia. */
  private driveVoice(n: number, singAmt: number, speaking: boolean): void {
    if (this.stackLen > 0) return; // teclas têm prioridade
    const L = this.listener;
    const sing = singAmt > 0.02;
    const loud = L.level > 0.01;
    const want = sing ? loud && L.voiced : loud && speaking;
    if (want) {
      this.quietFor = 0;
      const vel = Math.min(1, 0.25 + L.level * 5);
      if (!this.singing || this.voice.idle) {
        const note = sing ? 69 + 12 * Math.log2(L.pitchHz / 440) : 48;
        this.voice.noteOn(Math.round(note), vel, false);
        this.singing = true;
      }
      if (sing) this.voice.setHz(L.pitchHz);
      this.voice.setVelocity(vel);
    } else if (this.singing) {
      this.quietFor += n / this.fs;
      if (this.quietFor > (sing ? 0.09 : 0.18)) this.stopSinging();
    }
  }

  private stopSinging(): void {
    this.voice.noteOff();
    this.singing = false;
    this.quietFor = 0;
  }

  /** Um som de boca para cada batida: "pum" (bumbo), "kss" (caixa), "ts" (chimbal). */
  private triggerBeat(kind: number, strength: number): void {
    this.beatKind = kind;
    this.beatT = 0;
    this.hitCount++;
    this.lastHit = kind;
    const s = 0.5 + 0.5 * strength;
    const b = this.beat;
    if (kind === KICK) {
      b.noteOn(Math.round(36 + 6 * strength), s, false);
    } else if (kind === SNARE) {
      b.startNoise(SNARE_GAIN * s, 0.085, 3200, 0.7);
    } else if (kind === HAT) {
      b.startNoise(HAT_GAIN * s, 0.028, 7800, 1.3);
    }
  }

  /** Posição da língua e dos lábios de cada batida, no tempo. */
  private updateBeatMouth(n: number): void {
    const a = this.beatShape;
    this.beatT += n / this.fs;
    const t = this.beatT;
    switch (this.beatKind) {
      case KICK:
        // "p/b": lábios fechados fazem pressão e depois abrem num "u" curto.
        if (t < 0.03) {
          a.lipOpen = 0;
          a.jaw = 0.3;
          a.tonguePos = 0.4;
          a.tongueHeight = 0.6;
          a.lipProtrusion = 0.2;
        } else {
          a.lipOpen = 0.6;
          a.jaw = 0.55;
          a.tonguePos = 0.25;
          a.tongueHeight = 0.5;
          a.lipProtrusion = 0.4;
        }
        break;
      case SNARE:
        // "kss/ch": língua alta atrás, boca meio aberta.
        a.tonguePos = 0.72;
        a.tongueHeight = 0.93;
        a.jaw = 0.25;
        a.lipOpen = 0.55;
        a.lipProtrusion = 0;
        break;
      case HAT:
        // "t/ts": ponta da língua nos dentes, quase fechado.
        a.tonguePos = 0.98;
        a.tongueHeight = 0.97;
        a.jaw = 0.12;
        a.lipOpen = 0.45;
        a.lipProtrusion = 0;
        break;
      default:
        break;
    }
    a.lipWidth = 0.7;
    this.beat.setAnatomy(a);
    // O bumbo é uma nota curta: solta depois de 40 ms (senão a voz fica "presa" em sustain zero).
    if (this.beatKind === KICK && t > 0.04) this.beat.noteOff();
    if (this.beat.idle && t > 0.4) this.beatKind = -1;
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
