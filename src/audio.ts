/**
 * Ponte entre a interface e o AudioWorklet. Carregado sob demanda,
 * só depois do clique em "Acordar a criatura".
 */

import processorUrl from './worklet/processor.ts?worker&url';
import type { EngineMessage } from './dsp/engine';

export interface MeterEvent {
  level: number;
  pitch: number;
  bright: number;
  /** -1 nenhuma, 0 bumbo, 1 caixa, 2 chimbal. */
  hit: number;
}

export class AudioBridge {
  readonly ctx: AudioContext;
  readonly analyser: AnalyserNode;
  private node!: AudioWorkletNode;
  private readonly master: GainNode;
  private readonly dry: GainNode;
  private buffer: AudioBuffer | null = null;
  private source: AudioBufferSourceNode | null = null;
  private startedAt = 0;
  private offset = 0;
  loop = true;
  onMeter: ((m: MeterEvent) => void) | null = null;
  onEnded: (() => void) | null = null;

  private constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.dry = ctx.createGain();
    this.dry.gain.value = 0;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.6;
  }

  static async create(initial: ArrayLike<number>): Promise<AudioBridge> {
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    const bridge = new AudioBridge(ctx);
    await ctx.audioWorklet.addModule(processorUrl);
    bridge.node = new AudioWorkletNode(ctx, 'goela', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 1,
      channelCountMode: 'explicit',
    });
    bridge.node.port.onmessage = (e: MessageEvent) => {
      if (e.data?.t === 'meter') bridge.onMeter?.(e.data as MeterEvent);
    };
    bridge.node.connect(bridge.master);
    bridge.dry.connect(ctx.destination);
    bridge.master.connect(bridge.analyser);
    bridge.analyser.connect(ctx.destination);
    bridge.send({ t: 'params', v: Array.from(initial) });
    if (ctx.state !== 'running') await ctx.resume();
    return bridge;
  }

  send(m: EngineMessage): void {
    this.node.port.postMessage(m);
  }

  get running(): boolean {
    return this.ctx.state === 'running';
  }

  async setRunning(on: boolean): Promise<void> {
    if (on) await this.ctx.resume();
    else {
      this.send({ t: 'panic' });
      await this.ctx.suspend();
    }
  }

  // ---------- Música enviada pelo usuário ----------

  /** Lê e decodifica um arquivo de áudio. Devolve a duração em segundos. */
  async loadFile(file: File): Promise<number> {
    this.stopMusic();
    const data = await file.arrayBuffer();
    this.buffer = await this.ctx.decodeAudioData(data);
    this.offset = 0;
    return this.buffer.duration;
  }

  get duration(): number {
    return this.buffer?.duration ?? 0;
  }

  get hasMusic(): boolean {
    return this.buffer !== null;
  }

  get playing(): boolean {
    return this.source !== null;
  }

  get position(): number {
    if (!this.buffer) return 0;
    const t = this.source ? this.offset + (this.ctx.currentTime - this.startedAt) : this.offset;
    return this.loop ? t % this.buffer.duration : Math.min(t, this.buffer.duration);
  }

  playMusic(): void {
    if (!this.buffer || this.source) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.loop = this.loop;
    src.connect(this.node);
    src.connect(this.dry);
    src.onended = () => {
      if (this.source === src) {
        this.source = null;
        this.offset = 0;
        this.onEnded?.();
      }
    };
    this.startedAt = this.ctx.currentTime;
    src.start(0, this.offset % this.buffer.duration);
    this.source = src;
  }

  pauseMusic(): void {
    if (!this.source) return;
    this.offset = this.position;
    const s = this.source;
    this.source = null;
    s.onended = null;
    try {
      s.stop();
    } catch {
      /* já parou */
    }
    s.disconnect();
  }

  stopMusic(): void {
    this.pauseMusic();
    this.offset = 0;
  }

  setLoop(on: boolean): void {
    this.loop = on;
    if (this.source) this.source.loop = on;
  }

  /** Também toca a música original, sem passar pela criatura. */
  setDryLevel(v: number): void {
    this.dry.gain.value = v;
  }
}
