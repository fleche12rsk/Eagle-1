/**
 * Desenho do trato vocal como um tubo dobrado em corte: a faringe sobe,
 * faz a curva atrás da boca e segue até os lábios. A largura em cada ponto
 * é o diâmetro real do segmento. Na Fase 2 isto vira a criatura completa.
 */

import type { CreatureId } from '../dsp/creatures';
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
  private colors = {
    flesh: '#a8392a', fleshSoft: '#d98b73', cavity: '#3a1f1b', ink: '#211c17', ink2: '#5a5047', paper: '#f1ebe0',
    feather: '#b5824c', featherDark: '#5e3b22', featherLight: '#ead7b8', beak: '#3f4248', cere: '#e0b43a', iris: '#e2a51c',
  };
  private creature: CreatureId = 'humano';
  private jawOpen = 0.5;
  private beakShown = 0.5;
  private morph = 0;

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
      feather: v('--feather', this.colors.feather),
      featherDark: v('--feather-dark', this.colors.featherDark),
      featherLight: v('--feather-light', this.colors.featherLight),
      beak: v('--beak', this.colors.beak),
      cere: v('--cere', this.colors.cere),
      iris: v('--iris', this.colors.iris),
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
    this.jawOpen = Math.min(1, a.jaw * 0.6 + a.lipOpen * 0.4);
  }

  setCreature(id: CreatureId): void {
    this.creature = id;
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
    // Transição suave entre criaturas (0 = humano, 1 = gavião).
    const hawkTarget = this.creature === 'gaviao' ? 1 : 0;
    this.morph += (hawkTarget - this.morph) * (still ? 1 : 0.12);
    if (Math.abs(this.morph - hawkTarget) < 0.002) this.morph = hawkTarget;
    const hawk = this.morph;

    const margin = 0.13; // espessura máxima de meio tubo + parede, em unidades de escala
    // O gavião precisa de espaço para o bico (direita) e a cabeça (em cima).
    const extraR = 0.26 * hawk;
    const extraT = 0.12 * hawk;
    const extraL = 0.1 * hawk;
    const padL = 78;
    const padR = 64;
    const padY = 34;
    const spanX = horiz + 2 * margin + extraR + extraL;
    const spanY = vert + 2 * margin + extraT;
    const scale = Math.min((w - padL - padR) / spanX, (h - 2 * padY) / spanY);
    const spareX = w - padL - padR - spanX * scale;
    const spareY = h - 2 * padY - spanY * scale;
    const ox = padL + (margin + extraL) * scale + spareX / 2;
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

    // Gavião: cabeça e pescoço emplumados atrás do corte do tubo.
    const lipPt = this.pts[N];
    this.beakShown += (this.jawOpen - this.beakShown) * 0.25;
    const lipHalf = Math.max(this.shown[N - 1], 0) * 0.5 * unit;
    let beakTip = { x: lipPt.x, y: lipPt.y };
    if (hawk > 0) {
      ctx.save();
      ctx.globalAlpha = hawk;
      beakTip = this.drawHawk(scale, wall, unit, lipHalf, t, still);
      ctx.restore();
    }

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

    // Ondas saindo pela boca (ou pela ponta do bico), proporcionais ao nível.
    const lip = hawk > 0.5 ? beakTip : this.pts[N];
    if (this.level > 0.01) {
      ctx.strokeStyle = c.flesh;
      ctx.lineWidth = 2;
      for (let k = 0; k < 3; k++) {
        const ph = still ? k / 3 : (t * 1.6 + k / 3) % 1;
        ctx.globalAlpha = Math.min(1, this.level * 3) * (1 - ph);
        ctx.beginPath();
        ctx.arc(lip.x, lip.y, 10 + ph * Math.min(padR - 6, scale * 0.12), -0.8 + 0.3 * hawk, 0.8 + 0.3 * hawk);
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
    const isHawk = hawk > 0.5;
    const back = -26 - 0.1 * hawk * scale;
    label(1, 1, isHawk ? 'siringe' : 'glote', back, 8, 'right');
    label(Math.round(N * 0.22), 1, 'faringe', back, 0, 'right');
    if (!isHawk) label(Math.round(N * 0.72), 1, 'palato', 0, -22, 'center');
    label(Math.round(N * 0.66), -1, 'língua', 0, 26, 'center');
    if (isHawk) {
      ctx.textAlign = 'left';
      ctx.fillText('bico', beakTip.x + 6, beakTip.y + 22);
    } else label(N, 1, 'lábios', 18, -18, 'left');
  }

  /**
   * Cabeça de gavião em vista lateral: pescoço, coroa escura, olho amarelo
   * com sobrancelha severa e bico em gancho que abre com a mandíbula.
   * Devolve a ponta do bico.
   */
  private drawHawk(scale: number, wall: number, unit: number, lipHalf: number, t: number, still: boolean): { x: number; y: number } {
    const ctx = this.ctx;
    const c = this.colors;
    const pts = this.pts;
    const lip = pts[N];
    const s = scale;
    const topY = lip.y - lipHalf - wall;

    // Pescoço e cabeça numa só silhueta.
    const glot = pts[0];
    const neckHalf = Math.max(this.shown[2], 1) * 0.5 * unit + wall + 0.07 * s;
    const hx = lip.x - 0.2 * s;
    const hy = lip.y - 0.02 * s;
    const head = new Path2D();
    head.moveTo(glot.x - neckHalf - 0.06 * s, glot.y + 0.04 * s);
    head.bezierCurveTo(glot.x - neckHalf, glot.y - 0.2 * s, glot.x - neckHalf - 0.04 * s, hy, hx - 0.26 * s, hy - 0.08 * s);
    // Nuca e coroa até a base do bico.
    head.bezierCurveTo(hx - 0.22 * s, hy - 0.3 * s, lip.x - 0.08 * s, hy - 0.3 * s, lip.x + 0.01 * s, topY - 0.05 * s);
    head.lineTo(lip.x + 0.01 * s, lip.y + lipHalf + wall + 0.04 * s);
    // Garganta clara descendo pela frente.
    head.bezierCurveTo(lip.x - 0.08 * s, hy + 0.2 * s, glot.x + neckHalf + 0.08 * s, hy + 0.14 * s, glot.x + neckHalf + 0.02 * s, glot.y - 0.18 * s);
    head.lineTo(glot.x + neckHalf + 0.08 * s, glot.y + 0.04 * s);
    head.closePath();
    ctx.fillStyle = c.feather;
    ctx.fill(head);
    ctx.save();
    ctx.clip(head);
    // Coroa escura e faixa da bochecha (o "bigode" das aves de rapina).
    ctx.fillStyle = c.featherDark;
    ctx.beginPath();
    ctx.ellipse(hx - 0.04 * s, hy - 0.24 * s, 0.3 * s, 0.14 * s, -0.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = c.featherLight;
    ctx.beginPath();
    ctx.ellipse(lip.x - 0.12 * s, hy + 0.17 * s, 0.13 * s, 0.1 * s, 0.4, 0, Math.PI * 2);
    ctx.fill();
    // Penas: escamas curtas em fileiras desencontradas.
    ctx.strokeStyle = c.featherDark;
    ctx.globalAlpha *= 0.45;
    ctx.lineWidth = 1;
    const step = Math.max(7, 0.028 * s);
    let row = 0;
    for (let y = hy - 0.4 * s; y < glot.y + 0.1 * s; y += step * 0.8, row++) {
      for (let x = glot.x - 0.4 * s + (row % 2) * step * 0.5; x < lip.x + 0.1 * s; x += step) {
        ctx.beginPath();
        ctx.arc(x, y, step * 0.42, 0.15 * Math.PI, 0.85 * Math.PI);
        ctx.stroke();
      }
    }
    ctx.restore();
    ctx.strokeStyle = c.ink;
    ctx.lineWidth = 1.25;
    ctx.stroke(head);

    // Olho com sobrancelha (o ar sério do gavião). Pisca de vez em quando.
    const ex = lip.x - 0.17 * s;
    const ey = topY - 0.075 * s;
    const er = 0.034 * s;
    const blink = still ? 1 : t % 4.3 < 0.12 ? 0.15 : 1;
    ctx.fillStyle = c.iris;
    ctx.beginPath();
    ctx.ellipse(ex, ey, er, er * blink, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = c.ink;
    ctx.lineWidth = 1.25;
    ctx.stroke();
    if (blink > 0.5) {
      ctx.fillStyle = '#120d0a';
      ctx.beginPath();
      ctx.arc(ex + er * 0.12, ey, er * 0.52, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(ex + er * 0.32, ey - er * 0.3, er * 0.16, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = c.featherDark;
    ctx.lineWidth = Math.max(2.5, 0.014 * s);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(ex - er * 1.5, ey - er * 1.25);
    ctx.quadraticCurveTo(ex, ey - er * 1.55, ex + er * 1.7, ey - er * 0.7);
    ctx.stroke();

    // Bico: maxila em gancho e mandíbula que gira para abrir.
    const open = this.beakShown;
    const baseTop = { x: lip.x - 0.015 * s, y: topY - 0.035 * s };
    const gapTop = lip.y - lipHalf * 0.6;
    const len = 0.21 * s;
    const lift = open * 0.12;
    const tip = {
      x: lip.x + len * Math.cos(lift),
      y: gapTop - len * Math.sin(lift) + 0.055 * s,
    };
    ctx.fillStyle = c.beak;
    ctx.strokeStyle = c.ink;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(baseTop.x, baseTop.y);
    ctx.bezierCurveTo(lip.x + 0.1 * s, baseTop.y - 0.02 * s, tip.x + 0.03 * s, gapTop - 0.04 * s, tip.x, tip.y);
    // Gancho voltando por baixo.
    ctx.quadraticCurveTo(tip.x - 0.02 * s, tip.y - 0.035 * s, tip.x - 0.05 * s, gapTop + 0.005 * s);
    ctx.lineTo(lip.x, gapTop);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    const jawAngle = 0.06 + open * 0.42;
    const gapBot = lip.y + lipHalf * 0.6;
    const lowLen = 0.15 * s;
    const lowTip = { x: lip.x + lowLen * Math.cos(jawAngle), y: gapBot + lowLen * Math.sin(jawAngle) };
    ctx.beginPath();
    ctx.moveTo(lip.x, gapBot);
    ctx.lineTo(lowTip.x, lowTip.y);
    ctx.quadraticCurveTo(lowTip.x - 0.04 * s, lowTip.y + 0.03 * s, lip.x - 0.01 * s, gapBot + 0.05 * s);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Cera amarela na base, com a narina.
    ctx.fillStyle = c.cere;
    ctx.beginPath();
    ctx.moveTo(baseTop.x - 0.005 * s, baseTop.y - 0.004 * s);
    ctx.quadraticCurveTo(lip.x + 0.05 * s, baseTop.y - 0.012 * s, lip.x + 0.065 * s, baseTop.y + 0.02 * s);
    ctx.lineTo(lip.x + 0.03 * s, gapTop);
    ctx.lineTo(lip.x, gapTop);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = c.ink;
    ctx.beginPath();
    ctx.ellipse(lip.x + 0.03 * s, baseTop.y + 0.018 * s, 0.009 * s, 0.006 * s, 0.4, 0, Math.PI * 2);
    ctx.fill();

    return tip;
  }
}
