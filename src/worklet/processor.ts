/**
 * AudioWorkletProcessor do Bota Ultra-Garganta 3000. Só embrulha o Engine: toda a síntese
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
  private blocks = 0;
  private lastHits = 0;

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
    // Entrada: a música enviada pelo usuário (mono ou a média dos canais).
    const inp = _inputs[0];
    let input: Float32Array | null = null;
    if (inp && inp.length > 0 && inp[0].length >= left.length) input = inp[0];
    this.engine.process(left, right, left.length, input);
    // Avisa a interface uns 20 vezes por segundo (nível, altura, batidas).
    if (++this.blocks % 8 === 0) {
      const hits = this.engine.hitCount;
      this.port.postMessage({ t: 'meter', level: this.engine.meterIn, pitch: this.engine.inPitch, bright: this.engine.meterBright, hit: hits !== this.lastHits ? this.engine.lastHit : -1 });
      this.lastHits = hits;
    }
    return true;
  }
}

registerProcessor('goela', GoelaProcessor);
