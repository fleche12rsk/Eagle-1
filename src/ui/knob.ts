/**
 * <goela-knob param="tonguePos">: knob acessível (role="slider").
 * Arrasto vertical, Shift para ajuste fino, duplo clique volta ao padrão,
 * roda do mouse e setas do teclado.
 */

import { PARAM_INDEX, PARAMS, formatValue, toNormalized, toPhysical, type ParamDef, type ParamId } from '../dsp/params';

const SWEEP = 270; // graus de curso do knob
const R = 19;
const CX = 24;
const CY = 24;

const polar = (deg: number, r = R) => {
  const a = ((deg - 90) * Math.PI) / 180;
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
};

const arcPath = (from: number, to: number) => {
  if (Math.abs(to - from) < 0.01) return '';
  const [x0, y0] = polar(from);
  const [x1, y1] = polar(to);
  const large = Math.abs(to - from) > 180 ? 1 : 0;
  const sweep = to > from ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${R} ${R} 0 ${large} ${sweep} ${x1.toFixed(2)} ${y1.toFixed(2)}`;
};

let uid = 0;

export class GoelaKnob extends HTMLElement {
  private def!: ParamDef;
  private index = 0;
  /** Valor normalizado do parâmetro (0..1). */
  private n = 0;
  private dial!: HTMLDivElement;
  private valueArc!: SVGPathElement;
  private pointer!: SVGLineElement;
  private readout!: HTMLSpanElement;
  private dragStartY = 0;
  private dragStartN = 0;

  connectedCallback(): void {
    if (this.dial) return;
    const id = this.getAttribute('param') as ParamId;
    this.index = PARAM_INDEX[id];
    this.def = PARAMS[this.index];
    const def = this.def;
    const label = this.getAttribute('label') ?? def.label;
    const hintId = `knob-hint-${++uid}`;

    this.classList.add('knob');
    this.innerHTML = `
      <div class="knob-dial" role="slider" tabindex="0"
        aria-label="${label}" aria-describedby="${hintId}"
        aria-valuemin="0" aria-valuemax="100">
        <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">
          <path class="knob-track" d="${arcPath(-SWEEP / 2, SWEEP / 2)}"/>
          <path class="knob-value" d=""/>
          <circle class="knob-cap" cx="${CX}" cy="${CY}" r="13"/>
          <line class="knob-pointer" x1="${CX}" y1="${CY - 5}" x2="${CX}" y2="${CY - 12}"/>
        </svg>
      </div>
      <span class="knob-label">${label}</span>
      <output class="knob-readout"></output>
      <span class="knob-hint" id="${hintId}" role="tooltip">${def.hint}</span>`;
    this.dial = this.querySelector('.knob-dial')!;
    this.valueArc = this.querySelector('.knob-value')!;
    this.pointer = this.querySelector('.knob-pointer')!;
    this.readout = this.querySelector('.knob-readout')!;

    this.dial.addEventListener('pointerdown', this.onPointerDown);
    this.dial.addEventListener('dblclick', () => this.set(toNormalized(def, def.def), true));
    this.dial.addEventListener('wheel', this.onWheel, { passive: false });
    this.dial.addEventListener('keydown', this.onKey);
    this.render();
  }

  get paramIndex(): number {
    return this.index;
  }

  get value(): number {
    return this.n;
  }

  /** Atualiza o valor normalizado; `emit` dispara o evento de mudança. */
  set(n: number, emit = false): void {
    const v = Math.min(1, Math.max(0, n));
    if (v === this.n && !emit) return;
    this.n = v;
    this.render();
    if (emit) this.dispatchEvent(new CustomEvent('knob-change', { bubbles: true, detail: { index: this.index, value: v } }));
  }

  /** Posição visual (0..1), invertida para parâmetros como a tensão. */
  private get pos(): number {
    return this.def.invert ? 1 - this.n : this.n;
  }

  private setPos(pos: number): void {
    const p = Math.min(1, Math.max(0, pos));
    this.set(this.def.invert ? 1 - p : p, true);
  }

  private render(): void {
    if (!this.dial) return;
    const pos = this.pos;
    const angle = -SWEEP / 2 + pos * SWEEP;
    // Parâmetros bipolares acendem a partir do centro.
    const from = this.def.min < 0 && this.def.max > 0 ? 0 : -SWEEP / 2;
    this.valueArc.setAttribute('d', arcPath(Math.min(from, angle), Math.max(from, angle)));
    this.pointer.setAttribute('transform', `rotate(${angle.toFixed(1)} ${CX} ${CY})`);
    const text = formatValue(this.def, toPhysical(this.def, this.n));
    this.readout.textContent = text;
    this.dial.setAttribute('aria-valuenow', String(Math.round(pos * 100)));
    this.dial.setAttribute('aria-valuetext', text);
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    e.preventDefault();
    this.dial.focus();
    this.dial.setPointerCapture(e.pointerId);
    this.dragStartY = e.clientY;
    this.dragStartN = this.pos;
    this.classList.add('is-dragging');
    const move = (ev: PointerEvent) => {
      const range = ev.shiftKey ? 900 : 180;
      // Shift no meio do arrasto: recomeça a referência para não pular.
      if (ev.shiftKey !== (this.dataset.fine === '1')) {
        this.dataset.fine = ev.shiftKey ? '1' : '0';
        this.dragStartY = ev.clientY;
        this.dragStartN = this.pos;
      }
      this.setPos(this.dragStartN + (this.dragStartY - ev.clientY) / range);
    };
    const up = () => {
      this.classList.remove('is-dragging');
      this.dial.removeEventListener('pointermove', move);
      this.dial.removeEventListener('pointerup', up);
      this.dial.removeEventListener('pointercancel', up);
      delete this.dataset.fine;
    };
    this.dial.addEventListener('pointermove', move);
    this.dial.addEventListener('pointerup', up);
    this.dial.addEventListener('pointercancel', up);
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const step = e.shiftKey ? 0.002 : 0.01;
    this.setPos(this.pos + (e.deltaY < 0 ? step : -step) * Math.max(1, Math.min(4, Math.abs(e.deltaY) / 50)));
  };

  private onKey = (e: KeyboardEvent): void => {
    const fine = e.shiftKey ? 0.001 : 0.01;
    let next: number | null = null;
    switch (e.key) {
      case 'ArrowUp':
      case 'ArrowRight':
        next = this.pos + fine;
        break;
      case 'ArrowDown':
      case 'ArrowLeft':
        next = this.pos - fine;
        break;
      case 'PageUp':
        next = this.pos + 0.1;
        break;
      case 'PageDown':
        next = this.pos - 0.1;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = 1;
        break;
      case 'Enter':
      case 'Delete':
      case 'Backspace':
        this.set(toNormalized(this.def, this.def.def), true);
        e.preventDefault();
        e.stopPropagation();
        return;
    }
    if (next !== null) {
      e.preventDefault();
      e.stopPropagation();
      this.setPos(next);
    }
  };
}

customElements.define('goela-knob', GoelaKnob);
