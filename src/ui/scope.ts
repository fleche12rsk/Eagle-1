/** Osciloscópio com gatilho em cruzamento por zero, e medidor de nível. */

export class Scope {
  private readonly ctx: CanvasRenderingContext2D;
  private data: Float32Array<ArrayBuffer> = new Float32Array(2048);
  private analyser: AnalyserNode | null = null;
  private stroke = '#a8392a';
  private grid = '#c9bba5';

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    const read = () => {
      const cs = getComputedStyle(canvas);
      this.stroke = cs.getPropertyValue('--flesh').trim() || this.stroke;
      this.grid = cs.getPropertyValue('--rule').trim() || this.grid;
    };
    read();
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', read);
  }

  attach(analyser: AnalyserNode): void {
    this.analyser = analyser;
    this.data = new Float32Array(analyser.fftSize);
  }

  /** Desenha e devolve o nível RMS (0..1). */
  draw(): number {
    const c = this.canvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (c.width !== Math.round(w * dpr)) c.width = Math.round(w * dpr);
    if (c.height !== Math.round(h * dpr)) c.height = Math.round(h * dpr);
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    ctx.strokeStyle = this.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    if (!this.analyser) return 0;
    const d = this.data;
    this.analyser.getFloatTimeDomainData(d);
    let rms = 0;
    for (let i = 0; i < d.length; i++) rms += d[i] * d[i];
    rms = Math.sqrt(rms / d.length);

    // Gatilho: primeiro cruzamento ascendente na primeira metade.
    let start = 0;
    for (let i = 1; i < d.length / 2; i++) {
      if (d[i - 1] < 0 && d[i] >= 0) {
        start = i;
        break;
      }
    }
    const span = Math.min(900, d.length - start);
    const gain = rms > 0.0005 ? Math.min(6, 0.35 / (rms * 1.8)) : 1;
    ctx.strokeStyle = this.stroke;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i < span; i++) {
      const x = (i / (span - 1)) * w;
      const y = h / 2 - d[start + i] * gain * (h / 2);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
    return rms;
  }
}
