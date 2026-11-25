/**
 * Desenho do trato vocal como um tubo dobrado em corte: a faringe sobe,
 * faz a curva atrás da boca e segue até os lábios. A largura em cada ponto
 * é o diâmetro real do segmento. Na Fase 2 isto vira a criatura completa.
 */

import { computeDiameters, type AnatomyShape } from '../dsp/shape';

const N = 44;
const PHARYNX = 0.4; // fração do comprimento na vertical
const BEND = 0.16; // fração na curva

interface Pt {
  x: number;
  y: number;
  nx: number;
  ny: number;
}

export class TractView {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly target = new Float32Array(N);
  private readonly shown = new Float32Array(N).fill(1.4);
  private readonly pts: Pt[] = Array.from({ length: N + 1 }, () => ({ x: 0, y: 0, nx: 0, ny: 0 }));
  private w = 0;
  private h = 0;
  private dpr = 1;
  private level = 0;
  private sounding = false;
  private t0 = performance.now();
  private readonly reduced = matchMedia('(prefers-reduced-motion: reduce)');
  private colors = { flesh: '#a8392a', fleshSoft: '#d98b73', cavity: '#3a1f1b', ink: '#211c17', ink2: '#5a5047', paper: '#f1ebe0' };

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    new ResizeObserver(() => this.resize()).observe(canvas);
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.readColors());
    this.readColors();
    this.resize();
  }

  private readColors(): void {
    const cs = getComputedStyle(this.canvas);
    const v = (name: string, fb: string) => cs.getPropertyValue(name).trim() || fb;
    this.colors = {
      flesh: v('--flesh', this.colors.flesh),
      fleshSoft: v('--flesh-soft', this.colors.fleshSoft),
      cavity: v('--cavity', this.colors.cavity),
      ink: v('--ink', this.colors.ink),
      ink2: v('--ink-2', this.colors.ink2),
      paper: v('--paper', this.colors.paper),
    };
  }

  private resize(): void {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
  }

  setShape(a: AnatomyShape): void {
    computeDiameters(a, this.target);
  }

  setLevel(level: number, sounding: boolean): void {
    this.level = level;
    this.sounding = sounding;
  }

  /** Linha central do tubo: vertical, curva de 90° e horizontal. */
  private layout(scale: number, ox: number, oy: number): void {
    const total = 1;
    const vertLen = PHARYNX * total;
    const bendLen = BEND * total;
    const radius = (bendLen / (Math.PI / 2)) * scale;
    for (let i = 0; i <= N; i++) {
      const s = i / N;
      const p = this.pts[i];
      if (s <= PHARYNX) {
        p.x = ox;
        p.y = oy - s * scale;
        p.nx = -1;
        p.ny = 0;
      } else if (s <= PHARYNX + BEND) {
        const a = ((s - PHARYNX) / BEND) * (Math.PI / 2);
        const cx = ox + radius;
        const cy = oy - vertLen * scale;
        p.x = cx - radius * Math.cos(a);
        p.y = cy - radius * Math.sin(a);
        p.nx = -Math.cos(a);
        p.ny = -Math.sin(a);
      } else {
        p.x = ox + radius + (s - PHARYNX - BEND) * scale;
        p.y = oy - vertLen * scale - radius;
        p.nx = 0;
        p.ny = -1;
      }
    }
  }

  draw(now: number): void {
    const ctx = this.ctx;
    const { w, h, dpr } = this;
    if (w === 0 || h === 0) return;
    const c = this.colors;
    const still = this.reduced.matches;
    const t = (now - this.t0) / 1000;

    // Suavização visual dos diâmetros.
    for (let i = 0; i < N; i++) this.shown[i] += (this.target[i] - this.shown[i]) * 0.25;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Escala: o tubo inteiro (com paredes) cabe com folga para rótulos.
    const radiusFrac = BEND / (Math.PI / 2);
    const horiz = 1 - PHARYNX - BEND + radiusFrac;
    const vert = PHARYNX + radiusFrac;
    const margin = 0.13; // espessura máxima de meio tubo + parede, em unidades de escala
    const padL = 78;
    const padR = 64;
    const padY = 34;
    const scale = Math.min((w - padL - padR) / (horiz + 2 * margin), (h - 2 * padY) / (vert + 2 * margin));
    const spareX = w - padL - padR - (horiz + 2 * margin) * scale;
    const spareY = h - 2 * padY - (vert + 2 * margin) * scale;
    const ox = padL + margin * scale + spareX / 2;
    const oy = h - padY - margin * scale - spareY / 2;
    this.layout(scale, ox, oy);

    // Respiração em repouso e pulsação com o som.
    const breathe = still ? 0 : Math.sin(t * 1.3) * 0.035 * (this.sounding ? 0.3 : 1);
    const pulse = 1 + breathe + this.level * 0.12;
    const unit = scale * 0.036 * pulse; // px por unidade de diâmetro
    const wall = scale * 0.045;

    const inner = (i: number, side: 1 | -1) => {
      const k = Math.min(i, N - 1);
      const d = Math.max(this.shown[k], 0) * 0.5 * unit;
      const p = this.pts[i];
      return [p.x + p.nx * d * side, p.y + p.ny * d * side] as const;
    };
    const outer = (i: number, side: 1 | -1) => {
      const k = Math.min(i, N - 1);
      const d = Math.max(this.shown[k], 0) * 0.5 * unit + wall;
      const p = this.pts[i];
      return [p.x + p.nx * d * side, p.y + p.ny * d * side] as const;
    };

    // Carne em volta do tubo.
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const [x, y] = outer(i, 1);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    for (let i = N; i >= 0; i--) {
      const [x, y] = outer(i, -1);
      ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = c.fleshSoft;
    ctx.fill();
    ctx.lineWidth = 1.25;
    ctx.strokeStyle = c.ink;
    ctx.stroke();

    // Hachura de prancha antiga sobre a carne.
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = c.flesh;
    ctx.globalAlpha = 0.28;
    ctx.lineWidth = 1;
    for (let x = -h; x < w + h; x += 7) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + h, h);
      ctx.stroke();
    }
    ctx.restore();

    // Cavidade de ar.
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const [x, y] = inner(i, 1);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    for (let i = N; i >= 0; i--) {
      const [x, y] = inner(i, -1);
      ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = c.cavity;
    ctx.fill();
    ctx.strokeStyle = c.ink;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Pregas vocais: vibram quando há som.
    const g = this.pts[0];
    const flutter = this.sounding && !still ? Math.sin(t * 90) * 2 * Math.min(1, this.level * 4) : 0;
    const gHalf = this.shown[0] * 0.5 * unit + wall;
    ctx.strokeStyle = c.flesh;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(g.x - gHalf, g.y + 2);
    ctx.lineTo(g.x - 2 + flutter, g.y - 3);
    ctx.moveTo(g.x + gHalf, g.y + 2);
    ctx.lineTo(g.x + 2 - flutter, g.y - 3);
    ctx.stroke();

    // Ondas saindo pela boca, proporcionais ao nível.
    const lip = this.pts[N];
    if (this.level > 0.01) {
      ctx.strokeStyle = c.flesh;
      ctx.lineWidth = 2;
      for (let k = 0; k < 3; k++) {
        const ph = still ? k / 3 : (t * 1.6 + k / 3) % 1;
        ctx.globalAlpha = Math.min(1, this.level * 3) * (1 - ph);
        ctx.beginPath();
        ctx.arc(lip.x, lip.y, 10 + ph * Math.min(padR - 6, scale * 0.12), -0.8, 0.8);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // Rótulos com linhas de chamada.
    ctx.font = `italic ${Math.max(12, Math.min(15, w / 48))}px "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif`;
    ctx.fillStyle = c.ink2;
    ctx.strokeStyle = c.ink2;
    ctx.lineWidth = 0.75;
    const label = (i: number, side: 1 | -1, text: string, dx: number, dy: number, align: CanvasTextAlign) => {
      const [x, y] = outer(i, side);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + dx, y + dy);
      ctx.stroke();
      ctx.textAlign = align;
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x + dx + (align === 'left' ? 4 : align === 'right' ? -4 : 0), y + dy + (align === 'center' ? (dy < 0 ? -8 : 8) : 0));
    };
    label(1, 1, 'glote', -26, 8, 'right');
    label(Math.round(N * 0.22), 1, 'faringe', -26, 0, 'right');
    label(Math.round(N * 0.72), 1, 'palato', 0, -22, 'center');
    label(Math.round(N * 0.66), -1, 'língua', 0, 26, 'center');
    label(N, 1, 'lábios', 18, -18, 'left');
  }
}
