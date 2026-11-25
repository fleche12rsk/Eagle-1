import './styles/main.css';
import { CREATURES, creatureNormalized, type CreatureId } from './dsp/creatures';
import { GROUP_LABELS, PARAM_INDEX, PARAMS, VOWELS, toNormalized, toPhysical, type ParamGroup, type ParamId, type VowelShape } from './dsp/params';
import type { AnatomyShape } from './dsp/shape';
import type { AudioBridge } from './audio';
import './ui/knob';
import type { GoelaKnob } from './ui/knob';
import { Keyboard, noteName } from './ui/keyboard';
import { Scope } from './ui/scope';
import { TractView } from './ui/tract-view';
import { VowelPad } from './ui/vowel-pad';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

/** Criatura inicial: o gavião, a menos que a URL peça outra (?criatura=humano). */
const askedCreature = new URLSearchParams(location.search).get('criatura');
let creature: CreatureId = askedCreature === 'humano' || askedCreature === 'pombo' ? askedCreature : 'gaviao';

/** Estado da interface: valores normalizados na ordem de PARAMS. */
const state = creatureNormalized(creature);
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
  teeth: phys('teeth'),
  mouthLength: phys('mouthLength'),
});

// ---------- Painéis de knobs, gerados a partir das definições ----------

const PANEL_GROUPS: ParamGroup[] = ['lingua', 'mandibula', 'labios', 'trato', 'saco', 'glote', 'pitch', 'envelope', 'saida', 'musica'];

function buildPanels(): void {
  const host = $('#controls');
  const musicHost = $('#music-controls');
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
    (group === 'musica' ? musicHost : host).append(fs);
  }
  const onKnob = (e: Event) => {
    const { index, value } = (e as CustomEvent<{ index: number; value: number }>).detail;
    setParam(index, value, false);
  };
  host.addEventListener('knob-change', onKnob);
  musicHost.addEventListener('knob-change', onKnob);
}

function setParam(index: number, value: number, updateKnob = true): void {
  state[index] = value;
  if (updateKnob) knobs.get(index)?.set(value);
  bridge?.send({ t: 'param', i: index, v: value });
  const id = PARAMS[index].id;
  if (id === 'tonguePos' || id === 'tongueHeight') pad.set(phys('tonguePos'), phys('tongueHeight'));
  if (index >= PARAM_INDEX.tonguePos && index <= PARAM_INDEX.teeth) {
    view.setShape(anatomy());
    markVowel();
  }
  if (id === 'sacSize' || id === 'sacPos') view.setSac(phys('sacSize'), phys('sacPos'));
  if (id === 'extMix' || id === 'singAmt' || id === 'beatAmt') markMode();
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
  const ids = Object.keys(target) as (keyof VowelShape)[];
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
    const close = (Object.keys(v) as (keyof VowelShape)[]).every((k) => Math.abs(v[k] - a[k]) < 0.02);
    btn.setAttribute('aria-pressed', String(close));
  }
}

// ---------- Criaturas ----------

function applyCreature(id: CreatureId): void {
  creature = id;
  state.set(creatureNormalized(id));
  for (const [i, k] of knobs) k.set(state[i]);
  bridge?.send({ t: 'params', v: Array.from(state) });
  view.setShape(anatomy());
  view.setCreature(id);
  view.setSac(phys('sacSize'), phys('sacPos'));
  pad.set(phys('tonguePos'), phys('tongueHeight'));
  markVowel();
  document.body.dataset.creature = id;
  for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-creature]')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.creature === id));
  }
  $('#creature-blurb').textContent = CREATURES[id].blurb;
  const kicker: Record<CreatureId, string> = {
    gaviao: 'O gavião está dormindo no poleiro',
    pombo: 'O pombo está cochilando na praça',
    humano: 'A criatura está dormindo',
  };
  $('#wake-kicker').textContent = kicker[id];
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
      wireBridge(bridge);
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

// ---------- Música: enviar, tocar e escolher o que a criatura faz ----------

const MODES: Record<string, { extMix: number; singAmt: number; beatAmt: number; hint: string }> = {
  cantar: { extMix: 0, singAmt: 1, beatAmt: 0, hint: 'A criatura segue a altura da melodia com a própria voz. Funciona melhor com uma voz ou um instrumento só.' },
  falar: { extMix: 1, singAmt: 0, beatAmt: 0, hint: 'O som da música passa pela garganta dela: cada instrumento ganha a boca, a língua e o bico da criatura.' },
  beat: { extMix: 0, singAmt: 0, beatAmt: 1, hint: 'Bumbo vira "pum", caixa vira "kss", chimbal vira "ts". Quanto mais batida na música, melhor.' },
  tudo: { extMix: 0.5, singAmt: 1, beatAmt: 1, hint: 'Canta a melodia, deixa o timbre da música passar pela garganta e faz o beatbox, tudo ao mesmo tempo.' },
  off: { extMix: 0, singAmt: 0, beatAmt: 0, hint: 'A música não afeta a criatura. As teclas funcionam normalmente.' },
};

function applyMode(name: string): void {
  const m = MODES[name];
  if (!m) return;
  setPhysical('extMix', m.extMix);
  setPhysical('singAmt', m.singAmt);
  setPhysical('beatAmt', m.beatAmt);
  $('#mode-hint').textContent = m.hint;
}

function markMode(): void {
  const cur = { extMix: phys('extMix'), singAmt: phys('singAmt'), beatAmt: phys('beatAmt') };
  for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-mode]')) {
    const m = MODES[btn.dataset.mode!];
    const on = Math.abs(m.extMix - cur.extMix) < 0.03 && Math.abs(m.singAmt - cur.singAmt) < 0.03 && Math.abs(m.beatAmt - cur.beatAmt) < 0.03;
    btn.setAttribute('aria-pressed', String(on));
  }
}

const musicName = $('#music-name');
const musicPlay = $<HTMLButtonElement>('#music-play');
const HIT_NAMES = ['bumbo', 'caixa', 'chimbal'];
const NOTE_NAMES = ['Dó', 'Dó♯', 'Ré', 'Ré♯', 'Mi', 'Fá', 'Fá♯', 'Sol', 'Sol♯', 'Lá', 'Lá♯', 'Si'];
let hitTimer = 0;
let musicBright = 0.4;
let musicLevel = 0;

function wireBridge(b: AudioBridge): void {
  b.onMeter = (m) => {
    musicLevel = m.level;
    musicBright = m.bright;
    const pitch = $('#music-pitch');
    if (m.pitch > 0) {
      const midi = Math.round(69 + 12 * Math.log2(m.pitch / 440));
      pitch.textContent = `${NOTE_NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
    } else pitch.textContent = '–';
    if (m.hit >= 0) {
      const out = $('#music-hit');
      out.textContent = HIT_NAMES[m.hit];
      clearTimeout(hitTimer);
      hitTimer = window.setTimeout(() => (out.textContent = '–'), 220);
      view.hit(m.hit);
    }
  };
  b.onEnded = () => {
    musicPlay.textContent = 'Tocar';
  };
}

async function loadMusic(file: File): Promise<void> {
  musicName.textContent = `Lendo ${file.name}…`;
  const b = await wake();
  if (!b) {
    musicName.textContent = 'Não consegui ligar o áudio. Clique em "Acordar a criatura" e tente de novo.';
    return;
  }
  try {
    const dur = await b.loadFile(file);
    const mm = Math.floor(dur / 60);
    const ss = String(Math.floor(dur % 60)).padStart(2, '0');
    musicName.textContent = `${file.name} (${mm}:${ss})`;
    musicPlay.disabled = false;
    // Primeira vez: já liga tudo e toca, para a criatura reagir logo.
    if (phys('extMix') < 0.03 && phys('singAmt') < 0.03 && phys('beatAmt') < 0.03) applyMode('tudo');
    b.playMusic();
    musicPlay.textContent = 'Pausar';
  } catch (err) {
    console.error(err);
    musicName.textContent = 'Esse arquivo não abriu. Tente um MP3, WAV, OGG ou M4A.';
    musicPlay.disabled = true;
  }
}

$('#music-pick').addEventListener('click', () => $<HTMLInputElement>('#music-file').click());
$<HTMLInputElement>('#music-file').addEventListener('change', (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) void loadMusic(f);
});
musicPlay.addEventListener('click', () => {
  if (!bridge?.hasMusic) return;
  if (bridge.playing) {
    bridge.pauseMusic();
    musicPlay.textContent = 'Tocar';
  } else {
    void bridge.ctx.resume();
    bridge.playMusic();
    musicPlay.textContent = 'Pausar';
  }
});
$<HTMLInputElement>('#music-loop').addEventListener('change', (e) => bridge?.setLoop((e.target as HTMLInputElement).checked));
$<HTMLInputElement>('#music-dry').addEventListener('change', (e) => bridge?.setDryLevel((e.target as HTMLInputElement).checked ? 0.7 : 0));
for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-mode]')) btn.addEventListener('click', () => applyMode(btn.dataset.mode!));

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

for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-creature]')) {
  btn.addEventListener('click', () => applyCreature(btn.dataset.creature as CreatureId));
}
applyCreature(creature);

// Arrastar as alças vermelhas no desenho: língua (X = frente/trás, Y = altura) e mandíbula (Y = abre/fecha).
{
  let start = { pos: 0, h: 0, jaw: 0, lip: 0 };
  view.setDragHandler({
    start() {
      start = { pos: phys('tonguePos'), h: phys('tongueHeight'), jaw: phys('jaw'), lip: phys('lipOpen') };
    },
    move(kind, dx, dy) {
      const clamp = (v: number) => Math.min(1, Math.max(0, v));
      if (kind === 'tongue') {
        setPhysical('tonguePos', clamp(start.pos + dx * 1.7));
        setPhysical('tongueHeight', clamp(start.h - dy * 2.4));
      } else {
        setPhysical('jaw', clamp(start.jaw + dy * 2.6));
        setPhysical('lipOpen', clamp(start.lip + dy * 2.2));
      }
    },
  });
}

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
const macabreBtn = $<HTMLButtonElement>('#macabre');
const setMacabre = (on: boolean) => {
  view.setMacabre(on);
  macabreBtn.setAttribute('aria-pressed', String(on));
  document.body.classList.toggle('is-macabre', on);
  try {
    localStorage.setItem('macabre', on ? '1' : '0');
  } catch {
    /* sem armazenamento */
  }
};
macabreBtn.addEventListener('click', () => setMacabre(macabreBtn.getAttribute('aria-pressed') !== 'true'));
{
  let saved: string | null = null;
  try {
    saved = localStorage.getItem('macabre');
  } catch {
    /* ignora */
  }
  setMacabre(saved === '1');
}
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
const meterPos = $('#music-pos');
const bridgeDuration = () => bridge?.duration ?? 1;
let level = 0;
let following = false;
const frame = (now: number) => {
  const follow = !!bridge?.playing && phys('mouthFollow') > 0.01 && (phys('extMix') > 0.02 || phys('singAmt') > 0.02);
  if (!follow && following) view.setShape(anatomy());
  following = follow;
  if (follow) {
    // Mesma regra do motor: a boca do desenho acompanha o volume e o brilho da música.
    const f = phys('mouthFollow');
    const a = anatomy();
    const env = Math.min(1, musicLevel * 5);
    a.jaw += (0.15 + 0.85 * env - a.jaw) * f;
    a.lipOpen += (0.3 + 0.65 * env - a.lipOpen) * f;
    a.tonguePos += (0.15 + 0.8 * musicBright - a.tonguePos) * f;
    a.tongueHeight += (0.3 + 0.5 * musicBright * (1 - 0.5 * env) - a.tongueHeight) * f;
    view.setShape(a);
  }
  if (bridge?.hasMusic) meterPos.style.setProperty('--pos', (bridge.position / Math.max(1, bridgeDuration())).toFixed(3));
  const rms = scope.draw();
  level += (Math.min(1, rms * 4) - level) * 0.3;
  meter.style.setProperty('--level', level.toFixed(3));
  view.setLevel(level, held.size > 0 || level > 0.02);
  view.draw(now);
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
