/**
 * Ponte entre a interface e o AudioWorklet. Carregado sob demanda,
 * só depois do clique em "Acordar a criatura".
 */

import processorUrl from './worklet/processor.ts?worker&url';
import type { EngineMessage } from './dsp/engine';

export class AudioBridge {
  readonly ctx: AudioContext;
  readonly analyser: AnalyserNode;
  private node!: AudioWorkletNode;
  private readonly master: GainNode;

  private constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.6;
  }

  static async create(initial: ArrayLike<number>): Promise<AudioBridge> {
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    const bridge = new AudioBridge(ctx);
    await ctx.audioWorklet.addModule(processorUrl);
    bridge.node = new AudioWorkletNode(ctx, 'goela', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    bridge.node.connect(bridge.master);
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
}
