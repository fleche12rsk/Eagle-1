/**
 * Pad X/Y de vogais, no formato do trapézio do quadro vocálico:
 * esquerda = língua à frente, direita = atrás; em cima = alta, embaixo = baixa.
 */

import { VOWELS } from '../dsp/params';

export type PadChange = (tonguePos: number, tongueHeight: number) => void;

/** Borda frontal do trapézio (em %), para uma altura de tela y (0 = topo). */
const frontEdge = (y: number) => 2 + 34 * y;
const BACK = 98;

/** Converte (posição, altura) da língua em coordenadas % do pad. */
const toScreen = (pos: number, height: number) => {
  const y = 1 - height;
  const x0 = frontEdge(y);
  return { left: x0 + (1 - pos) * (BACK - x0), top: 2 + y * 96 };
};

export class VowelPad {
  private pos = 0.5;
  private height = 0.5;
  private readonly handle: HTMLElement;
  private readonly area: HTMLElement;

  constructor(
    private readonly root: HTMLElement,
    private readonly onChange: PadChange,
  ) {
    root.classList.add('pad');
    root.innerHTML = `
      <div class="pad-area">
        <svg class="pad-chart" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <path d="M2 2 L98 2 L98 98 L36 98 Z"/>
          <path class="pad-guide" d="M18 50 L98 50 M50 2 L67 98"/>
        </svg>
        <div class="pad-handle" role="slider" tabindex="0"
          aria-label="Língua: posição e altura" aria-valuemin="0" aria-valuemax="100"
          aria-describedby="pad-hint"></div>
      </div>
      <p class="pad-axes" aria-hidden="true"><span>frente</span><span>trás</span></p>
      <p id="pad-hint" class="visually-hidden">Setas esquerda e direita movem a língua para a frente e para trás; setas para cima e para baixo mudam a altura.</p>`;
    this.area = root.querySelector('.pad-area')!;
    this.handle = root.querySelector('.pad-handle')!;

    for (const [name, v] of Object.entries(VOWELS)) {
      const mark = document.createElement('span');
      mark.className = 'pad-vowel';
      mark.textContent = name.toLowerCase();
      mark.setAttribute('aria-hidden', 'true');
      const at = toScreen(v.tonguePos, v.tongueHeight);
      mark.style.left = `${at.left}%`;
      mark.style.top = `${at.top}%`;
      this.area.append(mark);
    }

    this.area.addEventListener('pointerdown', this.onDown);
    this.handle.addEventListener('keydown', this.onKey);
    this.render();
  }

  set(pos: number, height: number): void {
    this.pos = pos;
    this.height = height;
    this.render();
  }

  private emit(pos: number, height: number): void {
    this.set(Math.min(1, Math.max(0, pos)), Math.min(1, Math.max(0, height)));
    this.onChange(this.pos, this.height);
  }

  private render(): void {
    const at = toScreen(this.pos, this.height);
    this.handle.style.left = `${at.left}%`;
    this.handle.style.top = `${at.top}%`;
    const p = Math.round(this.pos * 100);
    const h = Math.round(this.height * 100);
    this.handle.setAttribute('aria-valuenow', String(p));
    this.handle.setAttribute('aria-valuetext', `posição ${p}%, altura ${h}%`);
  }

  private fromPointer(e: PointerEvent): void {
    const r = this.area.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 100;
    const y = Math.min(1, Math.max(0, ((e.clientY - r.top) / r.height * 100 - 2) / 96));
    const x0 = frontEdge(y);
    this.emit(1 - (x - x0) / (BACK - x0), 1 - y);
  }

  private onDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    this.handle.focus({ preventScroll: true });
    this.area.setPointerCapture(e.pointerId);
    this.root.classList.add('is-dragging');
    this.fromPointer(e);
    const move = (ev: PointerEvent) => this.fromPointer(ev);
    const up = () => {
      this.root.classList.remove('is-dragging');
      this.area.removeEventListener('pointermove', move);
      this.area.removeEventListener('pointerup', up);
      this.area.removeEventListener('pointercancel', up);
    };
    this.area.addEventListener('pointermove', move);
    this.area.addEventListener('pointerup', up);
    this.area.addEventListener('pointercancel', up);
  };

  private onKey = (e: KeyboardEvent): void => {
    const step = e.shiftKey ? 0.005 : 0.03;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [step, 0],
      ArrowRight: [-step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    e.stopPropagation();
    this.emit(this.pos + m[0], this.height + m[1]);
  };
}
