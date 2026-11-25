/**
 * Desenho do trato vocal como um tubo dobrado em corte: a faringe sobe,
 * faz a curva atrás da boca e segue até os lábios. A largura em cada ponto
 * é o diâmetro real do segmento. Na Fase 2 isto vira a criatura completa.
 */

import type { CreatureId } from '../dsp/creatures';
import { computeDiameters, stretchedLength, type AnatomyShape } from '../dsp/shape';

const N = 44;

const BASE_COLORS = {
  flesh: '#a8392a', fleshSoft: '#d98b73', cavity: '#3a1f1b', ink: '#211c17', ink2: '#5a5047', paper: '#f1ebe0',
  feather: '#b5824c', featherDark: '#5e3b22', featherLight: '#ead7b8', beak: '#3f4248', cere: '#e0b43a', iris: '#e2a51c',
  tooth: '#f6f1e4',
  pigeon: '#9aa1ab', pigeonDark: '#6b7380', pigeonIris: '#e8742a', pigeonCere: '#f1ece4', sheenA: '#3f8f6b', sheenB: '#7c4f93',
};
type Palette = typeof BASE_COLORS;

/** Paleta clara de prancha anatômica (o visual padrão): paredes pálidas, cavidade branca, língua rosa, bico amarelo-oliva. */
const PLATE: Partial<Palette> = {
  flesh: '#d8847a', fleshSoft: '#f1e4dc', cavity: '#fbf9f6', tooth: '#fffcf0',
  feather: '#efe2d2', featherDark: '#d9c6b2', featherLight: '#f7f0e6', beak: '#cbc47c', cere: '#d9d392', iris: '#8e6d35',
  pigeon: '#e3e3e3', pigeonDark: '#c4c4c8', pigeonIris: '#b4803a', pigeonCere: '#f2eee6', sheenA: '#a9c8b4', sheenB: '#c3b0d0',
};

/** Paleta macabra: pele machucada, carne crua, osso amarelado, olhos mortos. */
const MACABRE: Partial<Palette> = {
  flesh: '#5e0f12', fleshSoft: '#9b4f4c', cavity: '#0b0305', tooth: '#d8cc94',
  feather: '#4a3a30', featherDark: '#17110e', featherLight: '#8d8470', beak: '#2a2a28', cere: '#8a7a2e', iris: '#d6d04a',
  pigeon: '#6c6f72', pigeonDark: '#2d2f33', pigeonIris: '#d9d6c2', pigeonCere: '#a9a08c', sheenA: '#5d7a4f', sheenB: '#5a3a57',
};

export type DragKind = 'tongue' | 'jaw';

type BirdKind = 'gaviao' | 'pombo';

/** Diferenças de desenho entre as aves. As cores vêm do CSS. */
interface BirdStyle {
  feather: 'feather' | 'pigeon';
  crown: 'featherDark' | 'pigeonDark';
  throat: 'featherLight' | null;
  iris: 'iris' | 'pigeonIris';
  cere: 'cere' | 'pigeonCere';
  beakLen: number;
  hook: number;
  brow: boolean;
  sheen: boolean;
  extraR: number;
}

const BIRDS: Record<BirdKind, BirdStyle> = {
  gaviao: { feather: 'feather', crown: 'featherDark', throat: 'featherLight', iris: 'iris', cere: 'cere', beakLen: 0.21, hook: 1, brow: true, sheen: false, extraR: 0.26 },
  pombo: { feather: 'pigeon', crown: 'pigeonDark', throat: null, iris: 'pigeonIris', cere: 'pigeonCere', beakLen: 0.13, hook: 0.3, brow: false, sheen: true, extraR: 0.18 },
};
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
  private colors: Palette = { ...BASE_COLORS };
  private creature: CreatureId = 'humano';
  private mc: Palette = { ...BASE_COLORS, ...MACABRE };
  private lp: Palette = { ...BASE_COLORS, ...PLATE };
  private macabre = false;
  private popups: { text: string; kind: number; t0: number }[] = [];
  private lowBeakTip = { x: 0, y: 0 };
  /** Veias fixas (sorteio determinístico) para o desenho não tremer a cada quadro. */
  private readonly veinSeeds = Array.from({ length: 10 }, (_, k) => ({
    i: 3 + ((k * 7) % 28),
    side: (k % 2 ? 1 : -1) as 1 | -1,
    off: 0.25 + ((k * 37) % 55) / 100,
    wob: 0.6 + (k % 4) * 0.35,
    ph: k * 1.7,
    len: 7 + (k % 5) * 3,
  }));
  /** Última ave escolhida: continua desenhada enquanto a transição some. */
  private birdKind: BirdKind = 'gaviao';
  private sacSize = 0;
  private sacPos = 0.3;
  private sacShown = 0;
  /** Tamanho dos dentes (0..1) e quanto deles está à mostra agora. */
  private teeth = 0;
  private teethTarget = 0;
  private teethShown = 0;
  /** Comprimento da boca (1 = normal) e o valor animado na tela. */
  private mouth = 1;
  private mouthShown = 1;
  private jawOpen = 0.5;
  private beakShown = 0.5;
  private morph = 0;

  /** Alças vermelhas desenhadas na última passada (px): corpo da língua e mandíbula. */
  private dots: { tongue: { x: number; y: number }; jaw: { x: number; y: number } } = { tongue: { x: -99, y: -99 }, jaw: { x: -99, y: -99 } };
  private lastScale = 300;
  private drag: { kind: DragKind; x0: number; y0: number } | null = null;
  private handler: { start: (k: DragKind) => void; move: (k: DragKind, dx: number, dy: number) => void } | null = null;

  setDragHandler(h: { start: (k: DragKind) => void; move: (k: DragKind, dx: number, dy: number) => void }): void {
    this.handler = h;
  }

  private dotAt(px: number, py: number): DragKind | null {
    const r = 16;
    for (const k of ['tongue', 'jaw'] as const) {
      const d = this.dots[k];
      if ((px - d.x) ** 2 + (py - d.y) ** 2 <= r * r) return k;
    }
    return null;
  }

  private wireDrag(): void {
    const cv = this.canvas;
    const pos = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    cv.addEventListener('pointerdown', (e) => {
      const p = pos(e);
      const k = this.dotAt(p.x, p.y);
      if (!k || e.button !== 0) return;
      e.preventDefault();
      cv.setPointerCapture(e.pointerId);
      this.drag = { kind: k, x0: p.x, y0: p.y };
      cv.style.cursor = 'grabbing';
      this.handler?.start(k);
    });
    cv.addEventListener('pointermove', (e) => {
      const p = pos(e);
      if (this.drag) {
        this.handler?.move(this.drag.kind, (p.x - this.drag.x0) / this.lastScale, (p.y - this.drag.y0) / this.lastScale);
      } else cv.style.cursor = this.dotAt(p.x, p.y) ? 'grab' : '';
    });
    const end = () => {
      this.drag = null;
      cv.style.cursor = '';
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
    // No toque, só impede a rolagem da página quando o dedo começa numa alça.
    cv.addEventListener(
      'touchstart',
      (e) => {
        const t = e.touches[0];
        const r = cv.getBoundingClientRect();
        if (t && this.dotAt(t.clientX - r.left, t.clientY - r.top)) e.preventDefault();
      },
      { passive: false },
    );
  }

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.wireDrag();
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
      tooth: v('--tooth', this.colors.tooth),
      pigeon: v('--pigeon', this.colors.pigeon),
      pigeonDark: v('--pigeon-dark', this.colors.pigeonDark),
      pigeonIris: v('--pigeon-iris', this.colors.pigeonIris),
      pigeonCere: v('--pigeon-cere', this.colors.pigeonCere),
      sheenA: v('--sheen-a', this.colors.sheenA),
      sheenB: v('--sheen-b', this.colors.sheenB),
    };
    this.mc = { ...this.colors, ...MACABRE };
    this.lp = { ...this.colors, ...PLATE };
  }

  private resize(): void {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
  }

  /** Última anatomia recebida (para posicionar as alças). */
  private anat: AnatomyShape = { tonguePos: 0.3, tongueHeight: 0.4, jaw: 0.8, lipOpen: 0.8, lipProtrusion: 0, lipWidth: 0.8 };

  setShape(a: AnatomyShape): void {
    this.anat = a;
    computeDiameters(a, this.target);
    this.jawOpen = Math.min(1, a.jaw * 0.6 + a.lipOpen * 0.4);
    this.teeth = a.teeth ?? 0;
    this.mouth = a.mouthLength ?? 1;
    // Os lábios cobrem os dentes; eles aparecem quando a boca abre.
    const t = Math.min(1, Math.max(0, (a.lipOpen - 0.15) / 0.4));
    this.teethTarget = this.teeth * t * t * (3 - 2 * t);
  }

  setMacabre(on: boolean): void {
    this.macabre = on;
  }

  /** A palavra da batida ("pum", "kss", "ts") sobe da boca. */
  hit(kind: number): void {
    this.popups.push({ text: ['PUM', 'KSS', 'TS'][kind] ?? '!', kind, t0: performance.now() });
    if (this.popups.length > 8) this.popups.shift();
  }

  private get pal(): Palette {
    return this.macabre ? this.mc : this.lp;
  }

  setCreature(id: CreatureId): void {
    this.creature = id;
    if (id !== 'humano') this.birdKind = id;
  }

  setSac(size: number, pos: number): void {
    this.sacSize = size;
    this.sacPos = pos;
  }

  setLevel(level: number, sounding: boolean): void {
    this.level = level;
    this.sounding = sounding;
  }

  /** Linha central do tubo: vertical, curva de 90° e horizontal. */
  private layout(scale: number, ox: number, oy: number, total: number): void {
    const vertLen = PHARYNX;
    const bendLen = BEND;
    const radius = (bendLen / (Math.PI / 2)) * scale;
    for (let i = 0; i <= N; i++) {
      const s = (i / N) * total;
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
    const c = this.pal;
    const still = this.reduced.matches;
    const t = (now - this.t0) / 1000;

    // Suavização visual dos diâmetros.
    for (let i = 0; i < N; i++) this.shown[i] += (this.target[i] - this.shown[i]) * 0.25;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Escala: o tubo inteiro (com paredes) cabe com folga para rótulos.
    const radiusFrac = BEND / (Math.PI / 2);
    // Boca esticada: o trecho horizontal cresce.
    this.mouthShown += (this.mouth - this.mouthShown) * (still ? 1 : 0.2);
    const mouth = this.mouthShown;
    const total = stretchedLength(mouth);
    const horiz = total - PHARYNX - BEND + radiusFrac;
    const vert = PHARYNX + radiusFrac;
    // Transição suave entre criaturas (0 = humano, 1 = gavião).
    const birdTarget = this.creature !== 'humano' ? 1 : 0;
    this.morph += (birdTarget - this.morph) * (still ? 1 : 0.12);
    if (Math.abs(this.morph - birdTarget) < 0.002) this.morph = birdTarget;
    const bird = this.morph;
    const style = BIRDS[this.birdKind];

    const margin = 0.13; // espessura máxima de meio tubo + parede, em unidades de escala
    // O gavião precisa de espaço para o bico (direita) e a cabeça (em cima).
    const beakStretch = 0.6 + 0.4 * mouth;
    // Quanto a boca esticada já revela dentes (0 até ~112%, 1 a partir de ~150%).
    const sm = Math.min(1, Math.max(0, (mouth - 1.12) / 0.38));
    const extraR = style.extraR * beakStretch * bird;
    const extraT = 0.12 * bird;
    const extraL = 0.1 * bird;
    const padL = 78;
    const padR = 64;
    const padY = 34;
    const spanX = horiz + 2 * margin + extraR + extraL;
    const spanY = vert + 2 * margin + extraT;
    const scale = Math.min((w - padL - padR) / spanX, (h - 2 * padY) / spanY);
    this.lastScale = scale;
    const spareX = w - padL - padR - spanX * scale;
    const spareY = h - 2 * padY - spanY * scale;
    const ox = padL + (margin + extraL) * scale + spareX / 2;
    const oy = h - padY - margin * scale - spareY / 2;
    this.layout(scale, ox, oy, total);

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
    if (bird > 0) {
      ctx.save();
      ctx.globalAlpha = bird;
      beakTip = this.drawBird(style, scale, wall, unit, lipHalf, t, still, beakStretch, sm);
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

    // Hachura de prancha antiga sobre a carne (ou, no modo macabro, fibras de músculo e veias).
    ctx.save();
    ctx.clip();
    if (this.macabre) {
      this.drawMuscle(unit, wall, t, still);
    } else {
      ctx.strokeStyle = c.flesh;
      ctx.globalAlpha = 0.28;
      ctx.lineWidth = 1;
      for (let x = -h; x < w + h; x += 7) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + h, h);
        ctx.stroke();
      }
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

    this.drawTongueAndSpine(outer, inner, unit, wall, scale, t, still, bird);
    if (this.macabre) this.drawStitchesAndUvula(outer, inner, unit, t, still, bird);

    // Dentes humanos: incisivos na frente e dois pré-molares atrás.
    this.teethShown += (this.teethTarget - this.teethShown) * (still ? 1 : 0.2);
    const toothShow = this.teethShown * (1 - bird);
    if (toothShow > 0.02) {
      const seg = scale / N;
      const tooth = (i: number, side: 1 | -1, lenFrac: number, w0: number, w1: number) => {
        const [x, y] = inner(i, side);
        const half = Math.max(this.shown[i], 0) * 0.5 * unit;
        const len = Math.min(half * 0.8, half * 1.25 * lenFrac * toothShow);
        const dir = side === 1 ? 1 : -1; // de cima para baixo ou de baixo para cima
        const r = Math.min(seg * 0.35, len * 0.5);
        ctx.beginPath();
        ctx.moveTo(x - seg * w0, y);
        ctx.lineTo(x - seg * w0, y + dir * (len - r));
        ctx.quadraticCurveTo(x - seg * w0, y + dir * len, x - seg * w0 + r, y + dir * len);
        ctx.lineTo(x + seg * w1 - r, y + dir * len);
        ctx.quadraticCurveTo(x + seg * w1, y + dir * len, x + seg * w1, y + dir * (len - r));
        ctx.lineTo(x + seg * w1, y);
        ctx.fill();
        ctx.stroke();
      };
      ctx.save();
      ctx.globalAlpha = Math.min(1, toothShow * 1.6);
      ctx.fillStyle = c.tooth;
      ctx.strokeStyle = c.ink;
      ctx.lineWidth = 1;
      tooth(N - 8, 1, 0.55, 0.6, 0.6);
      tooth(N - 8, -1, 0.5, 0.6, 0.6);
      tooth(N - 6, 1, 0.65, 0.7, 0.7);
      tooth(N - 6, -1, 0.6, 0.7, 0.7);
      tooth(N - 4, -1, 0.85, 0.5, 0.9);
      tooth(N - 4, 1, 1, 0.3, 1.5);
      ctx.restore();
    }

    // Focinho: esticando a boca, brota uma fileira de dentes de cima e de baixo.
    const rowShow = this.teeth * sm * sm * (3 - 2 * sm) * (1 - bird);
    if (rowShow > 0.02) {
      const at = (f: number, side: 1 | -1) => {
        const i0 = Math.max(0, Math.min(N - 1, Math.floor(f)));
        const t = f - i0;
        const [x0, y0] = inner(i0, side);
        const [x1, y1] = inner(i0 + 1, side);
        const half = Math.max(this.shown[Math.min(N - 1, i0)], 0) * 0.5 * unit;
        return { x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, half };
      };
      const count = Math.max(2, Math.min(14, Math.round(2 + 7 * (mouth - 1))));
      const span = ((0.12 + 0.33 * (mouth - 1)) / total) * N;
      const iEnd = N - 9.6;
      const step = span / count;
      const w = (scale * total * step) / N;
      ctx.save();
      ctx.globalAlpha = Math.min(1, rowShow * 1.6);
      ctx.fillStyle = c.tooth;
      ctx.strokeStyle = c.ink;
      ctx.lineWidth = 1;
      for (let k = 0; k < count; k++) {
        const f = iEnd - k * step;
        // Os da frente são presas; os de trás, molares mais baixos.
        const fang = k < 2;
        for (const side of [1, -1] as const) {
          const { x, y, half } = at(f, side);
          const dir = side === 1 ? 1 : -1;
          const len = half * (fang ? 0.62 : 0.4) * Math.min(1, rowShow * 1.4) * (0.85 + 0.15 * Math.sin(k * 1.7));
          const hw = w * (fang ? 0.36 : 0.42);
          ctx.beginPath();
          ctx.moveTo(x - hw, y);
          if (fang) {
            ctx.quadraticCurveTo(x - hw * 0.6, y + dir * len * 0.7, x, y + dir * len);
            ctx.quadraticCurveTo(x + hw * 0.6, y + dir * len * 0.7, x + hw, y);
          } else {
            ctx.lineTo(x - hw, y + dir * len * 0.75);
            ctx.quadraticCurveTo(x - hw, y + dir * len, x - hw * 0.4, y + dir * len);
            ctx.lineTo(x + hw * 0.4, y + dir * len);
            ctx.quadraticCurveTo(x + hw, y + dir * len, x + hw, y + dir * len * 0.75);
            ctx.lineTo(x + hw, y);
          }
          ctx.fill();
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    // Pregas vocais: vibram quando há som.
    const g = this.pts[0];
    const flutter = this.sounding && !still ? Math.sin(t * 90) * 2 * Math.min(1, this.level * 4) : 0;
    const gHalf = this.shown[0] * 0.5 * unit + wall;
    // Duas pregas vermelhas em bloco, com a abertura entre elas pulsando com o som.
    {
      const bw = Math.max(6, scale * 0.024);
      const bh = Math.max(14, scale * 0.05);
      const gap = Math.max(1.5, this.shown[0] * 0.5 * unit * 0.5) + Math.abs(flutter) * 0.4;
      ctx.fillStyle = '#b0302b';
      ctx.strokeStyle = '#4a0e0c';
      ctx.lineWidth = 1;
      for (const sd of [-1, 1]) {
        const x0 = sd < 0 ? g.x - gap - bw : g.x + gap;
        ctx.beginPath();
        ctx.roundRect(x0, g.y - bh * 0.45, bw, bh, 2);
        ctx.fill();
        ctx.stroke();
      }
      void gHalf;
    }

    // Saco vocal: bolsa na frente da garganta que infla com o som.
    const pouch = this.drawSac(scale, unit, wall, t, still);

    // Ondas saindo pela boca, pela ponta do bico, ou pelo papo quando o bico está fechado.
    const fromPouch = pouch !== null && this.jawOpen < 0.25;
    const lip = fromPouch ? { x: pouch.x + pouch.r, y: pouch.y } : bird > 0.5 ? beakTip : this.pts[N];
    if (this.level > 0.01) {
      ctx.strokeStyle = c.flesh;
      ctx.lineWidth = 2;
      for (let k = 0; k < 3; k++) {
        const ph = still ? k / 3 : (t * 1.6 + k / 3) % 1;
        ctx.globalAlpha = Math.min(1, this.level * 3) * (1 - ph);
        ctx.beginPath();
        const tilt = fromPouch ? 0 : 0.3 * bird;
        ctx.arc(lip.x, lip.y, 10 + ph * Math.min(padR - 6, scale * 0.12), -0.8 + tilt, 0.8 + tilt);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    if (this.macabre) {
      const lower = bird > 0.5 ? this.lowBeakTip : { x: outer(N - 1, -1)[0], y: outer(N - 1, -1)[1] };
      this.drawDrool(lower.x, lower.y, scale, Math.min(1, this.jawOpen * 1.4), t, still);
      this.drawPopups(now, lip.x, lip.y, scale);
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
    const isBird = bird > 0.5;
    const back = -26 - 0.1 * bird * scale;
    label(1, 1, isBird ? 'siringe' : 'glote', back, 8, 'right');
    label(Math.round(N * 0.22), 1, 'faringe', back, 0, 'right');
    if (!isBird) label(Math.round(N * 0.72), 1, 'palato', 0, -22, 'center');
    if (pouch) label(Math.round(N * 0.66), -1, 'língua', 0.13 * scale, 14, 'left');
    else label(Math.round(N * 0.66), -1, 'língua', 0, 26, 'center');
    if (isBird) {
      ctx.textAlign = 'left';
      ctx.fillText('bico', beakTip.x + 6, beakTip.y + 22);
    } else label(N, 1, 'lábios', 18, -18, 'left');
    if (pouch) {
      ctx.textAlign = 'left';
      ctx.fillText(isBird && this.birdKind === 'pombo' ? 'papo' : 'saco vocal', pouch.x + pouch.r + 8, pouch.y + pouch.r * 0.8 + 6);
    }
  }

  /**
   * Bolsa do saco vocal, presa ao tubo por um duto curto no ponto escolhido.
   * O raio cresce com o tamanho e infla com o nível do som.
   */
  private drawSac(scale: number, unit: number, wall: number, t: number, still: boolean): { x: number; y: number; r: number } | null {
    const target = this.sacSize;
    this.sacShown += (target - this.sacShown) * (still ? 1 : 0.15);
    if (this.sacShown < 0.02) return null;
    const ctx = this.ctx;
    const c = this.pal;
    const j = Math.min(N - 2, Math.max(2, Math.round(this.sacPos * (N - 1))));
    const p = this.pts[j];
    const d = Math.max(this.shown[j], 0) * 0.5 * unit + wall;
    // Lado da frente do tubo (oposto à nuca / ao palato).
    const ax = p.x - p.nx * d;
    const ay = p.y - p.ny * d;
    const pulse = still ? 0 : Math.sin(t * 2.1) * 0.03;
    const inflate = 1 + Math.min(1, this.level * 2.5) * 0.28 + pulse;
    const r = scale * (0.03 + 0.085 * this.sacShown) * inflate;
    const neck = scale * 0.035;
    const cx = ax - p.nx * (neck + r * 0.85);
    const cy = ay - p.ny * (neck + r * 0.85) + r * 0.35;
    const pigeon = false; // saco rosado e claro em todas as criaturas

    // Duto.
    ctx.strokeStyle = c.ink;
    ctx.lineWidth = Math.max(5, scale * 0.022);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(cx, cy);
    ctx.stroke();
    ctx.strokeStyle = c.cavity;
    ctx.lineWidth = Math.max(2.5, scale * 0.012);
    ctx.stroke();

    // Bolsa: pele esticada, com brilho iridescente no pombo.
    const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
    if (this.macabre) {
      g.addColorStop(0, '#c79aa4');
      g.addColorStop(0.45, '#84506a');
      g.addColorStop(1, '#3b1e33');
    } else if (pigeon) {
      g.addColorStop(0, c.pigeonCere);
      g.addColorStop(0.35, c.sheenA);
      g.addColorStop(1, c.sheenB);
    } else {
      g.addColorStop(0, c.paper);
      g.addColorStop(1, c.fleshSoft);
    }
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(cx, cy, r, r * 0.92, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = c.ink;
    ctx.lineWidth = 1.25;
    ctx.stroke();
    // Vincos que somem quando a bolsa enche.
    ctx.save();
    ctx.globalAlpha *= Math.max(0, 1.4 - inflate) * 0.8;
    ctx.strokeStyle = pigeon ? c.pigeonDark : c.flesh;
    ctx.lineWidth = 1;
    for (let k = -1; k <= 1; k++) {
      ctx.beginPath();
      ctx.arc(cx + k * r * 0.35, cy + r * 0.15, r * 0.55, 0.25 * Math.PI, 0.75 * Math.PI);
      ctx.stroke();
    }
    ctx.restore();
    if (this.macabre) {
      // Veias que pulsam sob a pele esticada, e bolhas.
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(cx, cy, r, r * 0.92, 0, 0, Math.PI * 2);
      ctx.clip();
      const pulse = (still ? 0 : Math.sin(t * 3.2) * 0.35) + Math.min(1, this.level * 3) * 1.1;
      ctx.strokeStyle = '#c3232b';
      ctx.lineCap = 'round';
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * Math.PI * 2 + 0.3;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const wig = Math.sin(k * 2.1) * r * 0.25;
        ctx.lineWidth = 1 + pulse * 0.6;
        ctx.beginPath();
        ctx.moveTo(cx + ca * r * 0.12, cy + sa * r * 0.12);
        ctx.quadraticCurveTo(cx + ca * r * 0.5 - sa * wig, cy + sa * r * 0.5 + ca * wig, cx + ca * r * 0.98, cy + sa * r * 0.9);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,225,230,0.28)';
      for (let k = 0; k < 3; k++) {
        ctx.beginPath();
        ctx.arc(cx + Math.cos(k * 2.4 + 1) * r * 0.5, cy + Math.sin(k * 2.4 + 1) * r * 0.45, r * (0.1 + 0.03 * k), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    return { x: cx, y: cy, r };
  }

  /**
   * Cabeça de ave em vista lateral: pescoço, coroa, olho e bico que abre com a
   * mandíbula. O gavião tem sobrancelha severa e bico em gancho; o pombo tem
   * cabeça cinza, pescoço furta-cor, olho laranja e bico curto com cera branca.
   * Devolve a ponta do bico.
   */
  private drawBird(st: BirdStyle, scale: number, wall: number, unit: number, lipHalf: number, t: number, still: boolean, stretch: number, stretchReveal: number): { x: number; y: number } {
    const ctx = this.ctx;
    const c = this.pal;
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
    ctx.fillStyle = c[st.feather];
    ctx.fill(head);
    ctx.save();
    ctx.clip(head);
    // Coroa mais escura.
    ctx.fillStyle = c[st.crown];
    ctx.beginPath();
    ctx.ellipse(hx - 0.04 * s, hy - 0.24 * s, 0.3 * s, 0.14 * s, -0.12, 0, Math.PI * 2);
    ctx.fill();
    // Gavião: garganta clara. Pombo: faixa furta-cor no pescoço.
    if (st.throat) {
      ctx.fillStyle = c[st.throat];
      ctx.beginPath();
      ctx.ellipse(lip.x - 0.12 * s, hy + 0.17 * s, 0.13 * s, 0.1 * s, 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
    if (st.sheen) {
      const band = ctx.createLinearGradient(glot.x - 0.2 * s, 0, glot.x + 0.25 * s, 0);
      band.addColorStop(0, c.sheenB);
      band.addColorStop(0.5, c.sheenA);
      band.addColorStop(1, c.sheenB);
      ctx.fillStyle = band;
      ctx.beginPath();
      ctx.ellipse(glot.x + 0.02 * s, glot.y - 0.2 * s, 0.32 * s, 0.13 * s, -0.1, 0, Math.PI * 2);
      ctx.fill();
    }
    // Penas: escamas curtas em fileiras desencontradas.
    ctx.strokeStyle = c[st.crown];
    const ga = ctx.globalAlpha;
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
    if (this.macabre) {
      ctx.globalAlpha = ga;
      this.drawHeadDecay(st, s, hx, hy, glot, lip);
    }
    ctx.restore();
    ctx.strokeStyle = c.ink;
    ctx.lineWidth = 1.25;
    ctx.stroke(head);

    // Olho (com sobrancelha severa no gavião). Pisca de vez em quando.
    const ex = lip.x - 0.17 * s;
    const ey = topY - 0.075 * s;
    const er = 0.034 * s;
    const blink = still ? 1 : t % 4.3 < 0.12 ? 0.15 : 1;
    if (!st.brow) {
      // Anel claro em volta do olho do pombo.
      ctx.fillStyle = c[st.cere];
      ctx.beginPath();
      ctx.ellipse(ex, ey, er * 1.35, er * 1.35 * blink, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = c[st.iris];
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
    if (this.macabre) this.drawDeadEye(st, ex, ey, er, blink, s, t, still);
    if (st.brow) {
      ctx.strokeStyle = c.featherDark;
      ctx.lineWidth = Math.max(2.5, 0.014 * s);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(ex - er * 1.5, ey - er * 1.25);
      ctx.quadraticCurveTo(ex, ey - er * 1.55, ex + er * 1.7, ey - er * 0.7);
      ctx.stroke();
    }

    // Bico: maxila (em gancho no gavião) e mandíbula que gira para abrir.
    const open = this.beakShown;
    const baseTop = { x: lip.x - 0.015 * s, y: topY - 0.035 * s };
    const gapTop = lip.y - lipHalf * 0.6;
    const len = st.beakLen * stretch * s;
    const lift = open * 0.12;
    const tip = {
      x: lip.x + len * Math.cos(lift),
      y: gapTop - len * Math.sin(lift) + 0.055 * s * st.hook,
    };
    ctx.fillStyle = c.beak;
    ctx.strokeStyle = c.ink;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.moveTo(baseTop.x, baseTop.y);
    ctx.bezierCurveTo(lip.x + len * 0.48, baseTop.y - 0.02 * s, tip.x + 0.03 * s * st.hook, gapTop - 0.04 * s * st.hook, tip.x, tip.y);
    // Ponta voltando por baixo (o gancho, no gavião).
    ctx.quadraticCurveTo(tip.x - 0.02 * s, tip.y - 0.035 * s * st.hook, tip.x - 0.05 * s * st.hook - 0.01 * s, gapTop + 0.005 * s);
    ctx.lineTo(lip.x, gapTop);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    const jawAngle = 0.06 + open * 0.42;
    const gapBot = lip.y + lipHalf * 0.6;
    const lowLen = st.beakLen * stretch * 0.72 * s;
    const lowTip = { x: lip.x + lowLen * Math.cos(jawAngle), y: gapBot + lowLen * Math.sin(jawAngle) };
    ctx.beginPath();
    ctx.moveTo(lip.x, gapBot);
    ctx.lineTo(lowTip.x, lowTip.y);
    ctx.quadraticCurveTo(lowTip.x - 0.04 * s, lowTip.y + 0.03 * s, lip.x - 0.01 * s, gapBot + 0.05 * s);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Dentes no bico (ave mutante): serrilhado que só aparece com o bico aberto.
    const o = Math.min(1, Math.max(0, (open - 0.08) / 0.3));
    const beakTeeth = this.teeth * Math.max(o, stretchReveal);
    if (beakTeeth > 0.02) {
      const size = (0.01 + 0.022 * this.teeth) * s;
      const row = (x0: number, y0: number, x1: number, y1: number, up: boolean, count: number) => {
        const dx = x1 - x0;
        const dy = y1 - y0;
        const L = Math.hypot(dx, dy) || 1;
        const nx = (up ? dy : -dy) / L;
        const ny = (up ? -dx : dx) / L;
        const w = L / count;
        for (let k = 0; k < count; k++) {
          const f0 = k / count;
          const ax = x0 + dx * f0;
          const ay = y0 + dy * f0;
          const bx = ax + (dx / count);
          const by = ay + (dy / count);
          const h = size * (0.75 + 0.5 * Math.sin(k * 2.3 + 1)) * (k === 0 ? 0.7 : 1);
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.lineTo((ax + bx) / 2 + nx * h + (dx / L) * w * 0.15, (ay + by) / 2 + ny * h + (dy / L) * w * 0.15);
          ctx.lineTo(bx, by);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
      };
      ctx.save();
      ctx.globalAlpha *= Math.min(1, beakTeeth * 1.8);
      ctx.fillStyle = c.tooth;
      ctx.strokeStyle = c.ink;
      ctx.lineWidth = 1;
      const upEnd = tip.x - 0.05 * s * st.hook - 0.01 * s;
      row(lip.x + 0.012 * s, gapTop, upEnd, gapTop + 0.005 * s, false, Math.max(3, Math.round((upEnd - lip.x) / (0.03 * s))));
      row(lip.x + 0.012 * s, gapBot + 0.002 * s, lowTip.x - 0.015 * s, lowTip.y - 0.004 * s, true, Math.max(3, Math.round(lowLen / (0.032 * s))));
      ctx.restore();
    }

    this.lowBeakTip = { x: lowTip.x, y: lowTip.y };
    if (this.macabre) {
      // Bico rachado e sangue seco na ponta.
      ctx.save();
      ctx.strokeStyle = '#0d0a0a';
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(lip.x + len * 0.5, baseTop.y + 0.025 * s);
      ctx.lineTo(lip.x + len * 0.56, baseTop.y + 0.04 * s);
      ctx.lineTo(lip.x + len * 0.52, baseTop.y + 0.052 * s);
      ctx.lineTo(lip.x + len * 0.6, gapTop - 0.006 * s);
      ctx.stroke();
      ctx.fillStyle = '#7a141a';
      ctx.beginPath();
      ctx.arc(tip.x - 0.01 * s, tip.y - 0.004 * s, 0.011 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Cera na base (amarela no gavião, branca e carnuda no pombo), com a narina.
    ctx.fillStyle = c[st.cere];
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

  // ---------- Modo macabro ----------

  /** Fibras de músculo ao longo do tubo e veias que pulsam. Chamado já recortado na carne. */
  private drawMuscle(unit: number, wall: number, t: number, still: boolean): void {
    const ctx = this.ctx;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#2a0709';
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1;
    for (const side of [1, -1] as const) {
      for (let f = 0.1; f < 1; f += 0.22) {
        ctx.beginPath();
        for (let i = 0; i <= N; i++) {
          const p = this.pts[i];
          const d = Math.max(this.shown[Math.min(i, N - 1)], 0) * 0.5 * unit + wall * f;
          const x = p.x + p.nx * d * side;
          const y = p.y + p.ny * d * side;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 0.95;
    ctx.strokeStyle = '#b3141c';
    for (const v of this.veinSeeds) {
      const pulse = (still ? 0 : Math.sin(t * 3 + v.ph) * 0.35) + Math.min(1, this.level * 3) * 1.1;
      ctx.lineWidth = 1.1 + pulse * 0.7;
      ctx.beginPath();
      for (let i = v.i; i <= Math.min(N, v.i + v.len); i++) {
        const p = this.pts[i];
        const half = Math.max(this.shown[Math.min(i, N - 1)], 0) * 0.5 * unit;
        const d = half + wall * (v.off + Math.sin(i * v.wob + v.ph) * 0.22);
        const x = p.x + p.nx * d * v.side;
        const y = p.y + p.ny * d * v.side;
        if (i === v.i) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  /** Costura grosseira no pescoço e a campainha (úvula) pendurada no céu da boca. */
  private drawStitchesAndUvula(
    outer: (i: number, side: 1 | -1) => readonly [number, number],
    inner: (i: number, side: 1 | -1) => readonly [number, number],
    unit: number,
    t: number,
    still: boolean,
    bird: number,
  ): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.lineCap = 'round';
    const a = 6;
    const b = 19;
    ctx.strokeStyle = '#150405';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    for (let i = a; i <= b; i++) {
      const [x, y] = outer(i, 1);
      if (i === a) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.strokeStyle = '#d7ccb0';
    ctx.lineWidth = 1.7;
    for (let i = a + 1; i < b; i += 2) {
      const [x, y] = outer(i, 1);
      const p = this.pts[i];
      const q = this.pts[i + 1];
      const tx = q.x - this.pts[i - 1].x;
      const ty = q.y - this.pts[i - 1].y;
      const tl = Math.hypot(tx, ty) || 1;
      const ux = tx / tl;
      const uy = ty / tl;
      ctx.beginPath();
      ctx.moveTo(x - p.nx * 6 - ux * 2.5, y - p.ny * 6 - uy * 2.5);
      ctx.lineTo(x + p.nx * 6 + ux * 2.5, y + p.ny * 6 + uy * 2.5);
      ctx.stroke();
    }
    ctx.restore();

    if (bird < 0.5) {
      // Úvula: balança com o som.
      const u = Math.round(N * 0.4);
      const [ux0, uy0] = inner(u, 1);
      const half = Math.max(this.shown[u], 0) * 0.5 * unit;
      const len = Math.min(half * 0.85, unit * 0.9);
      const sway = still ? 0 : Math.sin(t * 6) * Math.min(1, this.level * 4) * 4;
      ctx.save();
      ctx.fillStyle = '#7a1a20';
      ctx.strokeStyle = '#150405';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(ux0 - 3, uy0);
      ctx.quadraticCurveTo(ux0 - 4 + sway, uy0 + len * 0.7, ux0 + sway, uy0 + len);
      ctx.quadraticCurveTo(ux0 + 4 + sway, uy0 + len * 0.7, ux0 + 3, uy0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  /** Baba com sangue escorrendo da boca, e gotas que caem. */
  private drawDrool(x: number, y: number, scale: number, open: number, t: number, still: boolean): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.lineCap = 'round';
    for (let k = 0; k < 3; k++) {
      const len = scale * (0.03 + 0.1 * open) * (0.6 + 0.4 * k * 0.5) + (still ? 0 : Math.sin(t * 1.7 + k * 2) * scale * 0.012);
      const ox = x - k * scale * 0.035;
      const sway = still ? 0 : Math.sin(t * 2.2 + k) * 2.5;
      ctx.strokeStyle = k === 1 ? 'rgba(140,22,30,0.8)' : 'rgba(215,205,185,0.55)';
      ctx.lineWidth = k === 1 ? 2.4 : 1.6;
      ctx.beginPath();
      ctx.moveTo(ox, y);
      ctx.quadraticCurveTo(ox + sway, y + len * 0.5, ox + sway * 0.5, y + len);
      ctx.stroke();
      ctx.fillStyle = k === 1 ? 'rgba(150,24,32,0.9)' : 'rgba(215,205,185,0.7)';
      ctx.beginPath();
      ctx.ellipse(ox + sway * 0.5, y + len + 2.5, 2.2, 3.4, 0, 0, Math.PI * 2);
      ctx.fill();
      if (!still && open > 0.2) {
        const ph = (t * 0.8 + k * 0.37) % 1;
        ctx.globalAlpha = 1 - ph;
        ctx.beginPath();
        ctx.ellipse(ox + sway * 0.5, y + len + 6 + ph * scale * 0.22, 1.8, 2.8, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
  }

  /** "PUM", "KSS" e "TS" sobem da boca e somem. */
  private drawPopups(now: number, x: number, y: number, scale: number): void {
    const ctx = this.ctx;
    this.popups = this.popups.filter((p) => now - p.t0 < 650);
    if (this.popups.length === 0) return;
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const p of this.popups) {
      const age = (now - p.t0) / 650;
      const size = Math.max(16, scale * (p.kind === 0 ? 0.075 : p.kind === 1 ? 0.065 : 0.05));
      ctx.font = `italic 700 ${size}px "Iowan Old Style", Palatino, Georgia, serif`;
      const px = x + 16 + age * 34 + p.kind * 8;
      const py = y - 14 - age * 46 - p.kind * 10;
      ctx.globalAlpha = 1 - age * age;
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#150405';
      ctx.strokeText(p.text, px, py);
      ctx.fillStyle = '#d3252d';
      ctx.fillText(p.text, px, py);
    }
    ctx.restore();
  }

  /** Dentro do recorte da cabeça: crânio à mostra (gavião) ou pele depenada (pombo). */
  private drawHeadDecay(st: BirdStyle, s: number, hx: number, hy: number, glot: { x: number; y: number }, lip: { x: number; y: number }): void {
    const ctx = this.ctx;
    if (st.brow) {
      const cx = hx - 0.02 * s;
      const cy = hy - 0.23 * s;
      ctx.fillStyle = '#d8cdb2';
      ctx.beginPath();
      ctx.ellipse(cx, cy, 0.1 * s, 0.045 * s, -0.12, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#150405';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.strokeStyle = '#2b2118';
      for (let k = 0; k < 4; k++) {
        const a = k * 1.7 + 0.5;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(a) * 0.05 * s, cy + Math.sin(a) * 0.022 * s);
        ctx.lineTo(cx + Math.cos(a + 0.35) * 0.095 * s, cy + Math.sin(a + 0.35) * 0.04 * s);
        ctx.stroke();
      }
    } else {
      const cx = hx - 0.05 * s;
      const cy = hy - 0.2 * s;
      ctx.fillStyle = '#a5857f';
      ctx.beginPath();
      ctx.ellipse(cx, cy, 0.12 * s, 0.06 * s, 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#5a3f3c';
      for (let k = 0; k < 14; k++) {
        const a = k * 2.399;
        const rr = Math.sqrt((k + 1) / 14);
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * 0.1 * s * rr, cy + Math.sin(a) * 0.045 * s * rr, 1.3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Mancha de apodrecimento no peito.
    ctx.fillStyle = 'rgba(40,60,35,0.35)';
    ctx.beginPath();
    ctx.ellipse(glot.x + 0.1 * s, glot.y - 0.05 * s, 0.12 * s, 0.08 * s, 0.4, 0, Math.PI * 2);
    ctx.fill();
    void lip;
  }

  /** Olho morto: órbita afundada, vasos estourados, pupila de fenda (gavião) ou leitosa (pombo), e uma lágrima de sangue. */
  private drawDeadEye(st: BirdStyle, ex: number, ey: number, er: number, blink: number, s: number, t: number, still: boolean): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(12,4,5,0.8)';
    ctx.lineWidth = er * 0.9;
    ctx.beginPath();
    ctx.ellipse(ex, ey, er * 1.55, er * 1.55, 0, 0, Math.PI * 2);
    ctx.stroke();
    if (blink > 0.5) {
      if (st.brow) {
        ctx.fillStyle = '#050202';
        ctx.beginPath();
        ctx.ellipse(ex + er * 0.1, ey, er * 0.17, er * 0.78, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = 'rgba(228,226,208,0.82)';
        ctx.beginPath();
        ctx.ellipse(ex, ey, er * 0.92, er * 0.92, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#2a2420';
        ctx.beginPath();
        ctx.arc(ex + er * 0.1, ey, er * 0.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.strokeStyle = '#b0141c';
    ctx.lineWidth = 1;
    for (let k = 0; k < 9; k++) {
      const a = k * 0.72 + 0.3;
      const r0 = er * 0.35;
      const r1 = er * (0.95 + 0.22 * Math.sin(k * 3.1));
      ctx.beginPath();
      ctx.moveTo(ex + Math.cos(a) * r0, ey + Math.sin(a) * r0);
      ctx.lineTo(ex + Math.cos(a + 0.12) * (r0 + r1) * 0.5, ey + Math.sin(a + 0.12) * (r0 + r1) * 0.5);
      ctx.lineTo(ex + Math.cos(a) * r1, ey + Math.sin(a) * r1);
      ctx.stroke();
    }
    // Lágrima de sangue.
    const len = 0.1 * s + (still ? 0 : Math.sin(t * 1.3) * 0.01 * s);
    ctx.strokeStyle = 'rgba(150,20,28,0.9)';
    ctx.lineWidth = Math.max(1.6, 0.007 * s);
    ctx.beginPath();
    ctx.moveTo(ex - er * 0.3, ey + er * 1.2);
    ctx.quadraticCurveTo(ex - er * 0.7, ey + er * 1.2 + len * 0.5, ex - er * 0.5, ey + er * 1.2 + len);
    ctx.stroke();
    ctx.fillStyle = 'rgba(150,20,28,0.95)';
    ctx.beginPath();
    ctx.ellipse(ex - er * 0.5, ey + er * 1.2 + len + 3, 2.2, 3.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /**
   * A língua como órgão: um bloco rosa que forma o piso da boca e sobe quando a
   * língua sobe. Também: vértebras ao longo do pescoço, a aba da laringe e a mira
   * "TONGUE" com as alças vermelhas arrastáveis (língua e mandíbula).
   */
  private drawTongueAndSpine(
    outer: (i: number, side: 1 | -1) => readonly [number, number],
    inner: (i: number, side: 1 | -1) => readonly [number, number],
    unit: number,
    wall: number,
    scale: number,
    t: number,
    still: boolean,
    bird: number,
  ): void {
    const ctx = this.ctx;
    const c = this.pal;
    const a = this.anat;

    // Vértebras: caixinhas arredondadas ao longo da nuca.
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineWidth = 1;
    const vw = Math.max(9, scale * 0.052);
    const vh = Math.max(7, scale * 0.032);
    for (let i = 4; i <= Math.round(N * 0.4); i += 2) {
      const [x, y] = outer(i, 1);
      const p = this.pts[i];
      const cx = x + p.nx * vw * 0.2 + (p.nx < -0.2 ? -vw * 0.05 : 0);
      const cy = y + p.ny * vw * 0.2;
      ctx.save();
      ctx.translate(cx - (p.nx < -0.5 ? vw * 0.35 : 0), cy);
      ctx.rotate(Math.atan2(p.ny, p.nx) + Math.PI / 2);
      ctx.fillStyle = '#f6efdf';
      ctx.strokeStyle = '#7d6e60';
      ctx.beginPath();
      ctx.roundRect(-vw / 2, -vh / 2, vw, vh, 3);
      ctx.fill();
      ctx.stroke();
      // Espinho para trás.
      ctx.beginPath();
      ctx.moveTo(-vw / 2, -vh * 0.25);
      ctx.lineTo(-vw / 2 - vw * 0.22, 0);
      ctx.lineTo(-vw / 2, vh * 0.25);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();

    // Aba cinza da laringe (epiglote), junto à base da língua.
    {
      const [fx, fy] = inner(7, -1);
      ctx.save();
      ctx.translate(fx, fy - scale * 0.01);
      ctx.rotate(-0.5 + (still ? 0 : Math.sin(t * 3) * 0.04 * Math.min(1, this.level * 4)));
      ctx.fillStyle = '#b9b7bf';
      ctx.strokeStyle = '#6d6b75';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(0, -scale * 0.035, scale * 0.016, scale * 0.045, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    // Língua: o piso da boca, do fundo até perto da ponta. O topo segue o ar (muda com altura e posição).
    const iBack = Math.round(N * 0.45);
    const iTip = N - 7;
    const bulk = scale * 0.075;
    ctx.beginPath();
    for (let i = iBack; i <= iTip; i++) {
      const [x, y] = inner(i, -1);
      if (i === iBack) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    for (let i = iTip; i >= iBack; i--) {
      const f = (i - iBack) / (iTip - iBack);
      const bump = Math.pow(Math.sin(Math.PI * Math.min(1, f * 1.08)), 0.65);
      const [x, y] = outer(i, -1);
      const pp = this.pts[i];
      ctx.lineTo(x - pp.nx * bump * bulk, y - pp.ny * bump * bulk);
    }
    ctx.closePath();
    const tg = ctx.createLinearGradient(0, 0, 0, this.h);
    tg.addColorStop(0, '#efb0a8');
    tg.addColorStop(1, c.flesh);
    ctx.fillStyle = this.macabre ? '#a9423c' : tg;
    ctx.fill();
    ctx.strokeStyle = this.macabre ? '#2a0709' : '#a8554d';
    ctx.lineWidth = 1.4;
    ctx.stroke();

    // Mira "TONGUE" e alças arrastáveis.
    const cT = 0.24 + 0.4 * a.tonguePos + 0.06 * a.tongueHeight * (1 - a.tonguePos);
    const ci = Math.max(iBack + 2, Math.min(iTip - 3, Math.round(cT * N)));
    const [tx, ty0] = inner(ci, -1);
    const ty = ty0 + 5;
    this.dots.tongue = { x: tx, y: ty };
    const jaw = bird > 0.5 ? this.lowBeakTip : { x: outer(N - 1, -1)[0], y: outer(N - 1, -1)[1] };
    this.dots.jaw = { x: jaw.x, y: jaw.y + 2 };

    ctx.save();
    ctx.strokeStyle = 'rgba(60,50,45,0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(tx, 30);
    ctx.lineTo(tx, this.h - 14);
    ctx.moveTo(10, ty);
    ctx.lineTo(this.w - 10, ty);
    ctx.stroke();
    ctx.fillStyle = 'rgba(60,50,45,0.6)';
    ctx.font = '600 11px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('TONGUE', tx, 22);
    for (const k of ['tongue', 'jaw'] as const) {
      const d = this.dots[k];
      const active = this.drag?.kind === k;
      ctx.fillStyle = '#b8261f';
      ctx.strokeStyle = active ? '#ffffff' : 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(d.x, d.y, active ? 8.5 : 6.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = '#4a0e0c';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();
    void unit;
    void wall;
  }
}
