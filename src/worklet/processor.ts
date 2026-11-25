/**
 * AudioWorkletProcessor do bleh 3. Só embrulha o Engine: toda a síntese
 * acontece ali, sem alocar memória dentro de process().
 */

import { Engine, type EngineMessage } from '../dsp/engine';

declare const sampleRate: number;
declare function registerProcessor(name: string, ctor: unknown): void;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

class GoelaProcessor extends AudioWorkletProcessor {
  private readonly engine = new Engine(sampleRate, 128);

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<EngineMessage | EngineMessage[]>) => {
      const d = e.data;
      if (Array.isArray(d)) for (const m of d) this.engine.handle(m);
      else this.engine.handle(d);
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const left = out[0];
    const right = out.length > 1 ? out[1] : null;
    this.engine.process(left, right, left.length);
    return true;
  }
}

registerProcessor('goela', GoelaProcessor);
