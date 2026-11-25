/**
 * Teclado na tela (mouse e toque, com glissando) e teclado do computador
 * (fileira ASDF; Z e X mudam a oitava).
 */

export interface NoteSink {
  noteOn(note: number, velocity: number): void;
  noteOff(note: number): void;
}

const NAMES = ['Dó', 'Dó♯', 'Ré', 'Ré♯', 'Mi', 'Fá', 'Fá♯', 'Sol', 'Sol♯', 'Lá', 'Lá♯', 'Si'];
const BLACK = new Set([1, 3, 6, 8, 10]);

/** Teclas do computador -> semitom a partir do Dó da oitava base. */
const KEYMAP: Record<string, number> = {
  KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11,
  KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16, Quote: 17,
};

export const noteName = (n: number) => `${NAMES[n % 12]}${Math.floor(n / 12) - 1}`;

export class Keyboard {
  private octave = 3;
  private readonly pointerNotes = new Map<number, number>();
  private readonly keyNotes = new Map<string, number>();
  private readonly keyEls = new Map<number, HTMLElement>();
  private readonly held = new Map<number, number>();

  constructor(
    private readonly root: HTMLElement,
    private readonly sink: NoteSink,
    private readonly octaveLabel: HTMLElement | null,
    private readonly first = 36,
    private readonly count = 37,
  ) {
    this.build();
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => this.releaseAll());
    this.updateOctaveLabel();
  }

  private build(): void {
    const list = document.createElement('ul');
    list.className = 'keys';
    let whiteIndex = 0;
    for (let n = this.first; n < this.first + this.count; n++) {
      const pc = n % 12;
      const li = document.createElement('li');
      const black = BLACK.has(pc);
      li.className = black ? 'key key-black' : 'key key-white';
      li.dataset.note = String(n);
      li.setAttribute('aria-label', noteName(n));
      if (black) li.style.setProperty('--white-index', String(whiteIndex));
      else {
        li.style.setProperty('--white-index', String(whiteIndex));
        whiteIndex++;
        if (pc === 0) {
          const tag = document.createElement('span');
          tag.className = 'key-tag';
          tag.textContent = noteName(n);
          tag.setAttribute('aria-hidden', 'true');
          li.append(tag);
        }
      }
      this.keyEls.set(n, li);
      list.append(li);
    }
    list.style.setProperty('--white-count', String(whiteIndex));
    this.root.append(list);

    list.addEventListener('pointerdown', this.onPointerDown);
    list.addEventListener('pointermove', this.onPointerMove);
    list.addEventListener('pointerup', this.onPointerUp);
    list.addEventListener('pointercancel', this.onPointerUp);
    list.addEventListener('lostpointercapture', this.onPointerUp);
    list.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private noteAt(x: number, y: number): number | null {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('.key');
    return el?.dataset.note ? Number(el.dataset.note) : null;
  }

  /** Velocity pela altura do toque na tecla: mais embaixo, mais forte. */
  private velocityAt(note: number, y: number): number {
    const el = this.keyEls.get(note);
    if (!el) return 0.8;
    const r = el.getBoundingClientRect();
    return Math.min(1, Math.max(0.3, 0.35 + ((y - r.top) / r.height) * 0.65));
  }

  private onPointerDown = (e: PointerEvent): void => {
    const note = this.noteAt(e.clientX, e.clientY);
    if (note === null) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    this.pointerNotes.set(e.pointerId, note);
    this.press(note, this.velocityAt(note, e.clientY));
  };

  private onPointerMove = (e: PointerEvent): void => {
    const current = this.pointerNotes.get(e.pointerId);
    if (current === undefined) return;
    const note = this.noteAt(e.clientX, e.clientY);
    if (note === null || note === current) return;
    // Glissando: entra na tecla nova antes de soltar a velha (fica ligado).
    this.pointerNotes.set(e.pointerId, note);
    this.press(note, 0.8);
    this.release(current);
  };

  private onPointerUp = (e: PointerEvent): void => {
    const note = this.pointerNotes.get(e.pointerId);
    if (note === undefined) return;
    this.pointerNotes.delete(e.pointerId);
    this.release(note);
  };

  private isTyping(e: KeyboardEvent): boolean {
    const t = e.target as HTMLElement | null;
    if (!t) return false;
    return t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || this.isTyping(e)) return;
    if (e.code === 'KeyZ' || e.code === 'KeyX') {
      this.octave = Math.min(7, Math.max(0, this.octave + (e.code === 'KeyX' ? 1 : -1)));
      this.updateOctaveLabel();
      return;
    }
    const semi = KEYMAP[e.code];
    if (semi === undefined || this.keyNotes.has(e.code)) return;
    const note = 12 * (this.octave + 1) + semi;
    this.keyNotes.set(e.code, note);
    this.press(note, 0.85);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    const note = this.keyNotes.get(e.code);
    if (note === undefined) return;
    this.keyNotes.delete(e.code);
    this.release(note);
  };

  private updateOctaveLabel(): void {
    if (this.octaveLabel) this.octaveLabel.textContent = `${noteName(12 * (this.octave + 1))}`;
  }

  /** Conta quantas fontes seguram a mesma nota (mouse + teclado). */
  private press(note: number, vel: number): void {
    const c = this.held.get(note) ?? 0;
    this.held.set(note, c + 1);
    if (c === 0) {
      this.keyEls.get(note)?.classList.add('is-down');
      this.sink.noteOn(note, vel);
    }
  }

  private release(note: number): void {
    const c = this.held.get(note) ?? 0;
    if (c <= 1) {
      this.held.delete(note);
      this.keyEls.get(note)?.classList.remove('is-down');
      this.sink.noteOff(note);
    } else this.held.set(note, c - 1);
  }

  releaseAll(): void {
    for (const note of [...this.held.keys()]) {
      this.held.set(note, 1);
      this.release(note);
    }
    this.pointerNotes.clear();
    this.keyNotes.clear();
  }
}
