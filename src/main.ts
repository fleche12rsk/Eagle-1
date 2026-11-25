import './styles/main.css';
import { GROUP_LABELS, PARAM_INDEX, PARAMS, VOWELS, defaultNormalized, toNormalized, toPhysical, type ParamGroup, type ParamId } from './dsp/params';
import type { AnatomyShape } from './dsp/shape';
import type { AudioBridge } from './audio';
import './ui/knob';
import type { GoelaKnob } from './ui/knob';
import { Keyboard, noteName } from './ui/keyboard';
import { Scope } from './ui/scope';
import { TractView } from './ui/tract-view';
import { VowelPad } from './ui/vowel-pad';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

/** Estado da interface: valores normalizados na ordem de PARAMS. */
const state = defaultNormalized();
const knobs = new Map<number, GoelaKnob>();
let bridge: AudioBridge | null = null;
let waking: Promise<AudioBridge | null> | null = null;
const held = new Set<number>();

const phys = (id: ParamId) => toPhysical(PARAMS[PARAM_INDEX[id]], state[PARAM_INDEX[id]]);
const anatomy = (): AnatomyShape => ({
  tonguePos: phys('tonguePos'),
  tongueHeight: phys('tongueHeight'),
  jaw: phys('jaw'),
  lipOpen: phys('lipOpen'),
  lipProtrusion: phys('lipProtrusion'),
  lipWidth: phys('lipWidth'),
});

// ---------- Painéis de knobs, gerados a partir das definições ----------

const PANEL_GROUPS: ParamGroup[] = ['lingua', 'mandibula', 'labios', 'glote', 'envelope', 'saida'];

function buildPanels(): void {
  const host = $('#controls');
  for (const group of PANEL_GROUPS) {
    const fs = document.createElement('fieldset');
    fs.className = `group group-${group}`;
    const lg = document.createElement('legend');
    lg.textContent = GROUP_LABELS[group];
    fs.append(lg);
    const row = document.createElement('div');
    row.className = 'knob-row';
    PARAMS.forEach((def, i) => {
      if (def.group !== group) return;
      const k = document.createElement('goela-knob') as GoelaKnob;
      k.setAttribute('param', def.id);
      row.append(k);
      knobs.set(i, k);
      k.set(state[i]);
    });
    fs.append(row);
    host.append(fs);
  }
  host.addEventListener('knob-change', (e) => {
    const { index, value } = (e as CustomEvent<{ index: number; value: number }>).detail;
    setParam(index, value, false);
  });
}

function setParam(index: number, value: number, updateKnob = true): void {
  state[index] = value;
  if (updateKnob) knobs.get(index)?.set(value);
  bridge?.send({ t: 'param', i: index, v: value });
  const id = PARAMS[index].id;
  if (id === 'tonguePos' || id === 'tongueHeight') pad.set(phys('tonguePos'), phys('tongueHeight'));
  if (index >= PARAM_INDEX.tonguePos && index <= PARAM_INDEX.lipWidth) {
    view.setShape(anatomy());
    markVowel();
  }
}

function setPhysical(id: ParamId, v: number): void {
  const i = PARAM_INDEX[id];
  setParam(i, toNormalized(PARAMS[i], v));
}

// ---------- Vogais ----------

/** Transição suave até a vogal (em ~120 ms), além da rampa do motor. */
let vowelAnim = 0;
function goToVowel(name: keyof typeof VOWELS): void {
  const target = VOWELS[name];
  const ids = Object.keys(target) as (keyof AnatomyShape)[];
  const from = ids.map((id) => phys(id));
  const t0 = performance.now();
  const dur = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 120;
  cancelAnimationFrame(vowelAnim);
  const step = (now: number) => {
    const f = dur === 0 ? 1 : Math.min(1, (now - t0) / dur);
    const e = f * f * (3 - 2 * f);
    ids.forEach((id, k) => setPhysical(id, from[k] + (target[id] - from[k]) * e));
    if (f < 1) vowelAnim = requestAnimationFrame(step);
  };
  vowelAnim = requestAnimationFrame(step);
}

function markVowel(): void {
  const a = anatomy();
  for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-vowel]')) {
    const v = VOWELS[btn.dataset.vowel as keyof typeof VOWELS];
    const close = (Object.keys(v) as (keyof AnatomyShape)[]).every((k) => Math.abs(v[k] - a[k]) < 0.02);
    btn.setAttribute('aria-pressed', String(close));
  }
}

// ---------- Áudio sob demanda ----------

async function wake(): Promise<AudioBridge | null> {
  if (bridge) return bridge;
  if (waking) return waking;
  const status = $('#wake-status');
  const btn = $<HTMLButtonElement>('#wake');
  btn.disabled = true;
  status.textContent = 'Acordando…';
  waking = (async () => {
    try {
      const { AudioBridge } = await import('./audio');
      bridge = await AudioBridge.create(state);
      scope.attach(bridge.analyser);
      document.body.classList.add('is-awake');
      const screen = $('#wake-screen');
      screen.classList.add('is-leaving');
      setTimeout(() => screen.setAttribute('hidden', ''), 480);
      updatePower();
      status.textContent = '';
      return bridge;
    } catch (err) {
      console.error(err);
      status.textContent = 'Não consegui ligar o áudio neste navegador. Tente um Chrome, Edge, Firefox ou Safari atualizados.';
      btn.disabled = false;
      waking = null;
      return null;
    }
  })();
  return waking;
}

function updatePower(): void {
  const btn = $<HTMLButtonElement>('#power');
  const on = !!bridge?.running;
  btn.setAttribute('aria-pressed', String(on));
  btn.querySelector('.power-text')!.textContent = on ? 'Áudio ligado' : 'Áudio desligado';
}

// ---------- Montagem ----------

buildPanels();

const view = new TractView($<HTMLCanvasElement>('#tract'));
view.setShape(anatomy());

const pad = new VowelPad($('#vowel-pad'), (pos, height) => {
  setPhysical('tonguePos', pos);
  setPhysical('tongueHeight', height);
});
pad.set(phys('tonguePos'), phys('tongueHeight'));

for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-vowel]')) {
  btn.addEventListener('click', () => goToVowel(btn.dataset.vowel as keyof typeof VOWELS));
}
markVowel();

const scope = new Scope($<HTMLCanvasElement>('#scope'));
const noteOut = $('#note-out');

new Keyboard(
  $('#keyboard'),
  {
    noteOn(note, vel) {
      held.add(note);
      noteOut.textContent = noteName(note);
      document.body.classList.add('is-playing');
      void wake().then((b) => {
        // Só envia se a tecla ainda estiver apertada depois de acordar.
        if (b && held.has(note)) b.send({ t: 'on', n: note, v: vel });
      });
    },
    noteOff(note) {
      held.delete(note);
      if (held.size === 0) document.body.classList.remove('is-playing');
      bridge?.send({ t: 'off', n: note });
    },
  },
  $('#octave-out'),
);

$('#wake').addEventListener('click', () => void wake());
$('#power').addEventListener('click', async () => {
  if (!bridge) {
    await wake();
    return;
  }
  await bridge.setRunning(!bridge.running);
  updatePower();
});

// Laço de desenho.
const meter = $('#meter');
let level = 0;
const frame = (now: number) => {
  const rms = scope.draw();
  level += (Math.min(1, rms * 4) - level) * 0.3;
  meter.style.setProperty('--level', level.toFixed(3));
  view.setLevel(level, held.size > 0 || level > 0.02);
  view.draw(now);
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
