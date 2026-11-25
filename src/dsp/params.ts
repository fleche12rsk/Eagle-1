/**
 * Definição única dos parâmetros. A interface e o worklet leem daqui.
 * Internamente todo parâmetro vive normalizado em 0..1; `toPhysical`
 * converte para a unidade que o DSP usa e que o usuário vê.
 */

export type Curve = 'lin' | 'sq' | 'exp';

export interface ParamDef {
  id: string;
  group: ParamGroup;
  label: string;
  labelEn: string;
  /** Dica curta, em português simples. */
  hint: string;
  min: number;
  max: number;
  /** Valor padrão na unidade física. */
  def: number;
  unit: string;
  curve: Curve;
  /** Se verdadeiro, o knob cresce para a esquerda (min físico no topo). */
  invert?: boolean;
  /** Casas decimais na exibição. */
  digits: number;
  /** Multiplicador só para exibição (ex.: 0..1 mostrado como 0..100%). */
  display?: number;
}

export type ParamGroup = 'glote' | 'lingua' | 'mandibula' | 'labios' | 'trato' | 'saco' | 'envelope' | 'pitch' | 'saida';

export const GROUP_LABELS: Record<ParamGroup, string> = {
  glote: 'Glote',
  lingua: 'Língua',
  mandibula: 'Mandíbula',
  labios: 'Lábios',
  trato: 'Trato',
  saco: 'Saco vocal',
  envelope: 'Envelope',
  pitch: 'Envelope de pitch',
  saida: 'Saída',
};

const p = (d: ParamDef) => d;

export const PARAMS = [
  // Glote
  p({ id: 'fineTune', group: 'glote', label: 'Pitch fino', labelEn: 'Fine pitch', hint: 'Afinação fina, em cents.', min: -100, max: 100, def: 0, unit: 'ct', curve: 'lin', digits: 0 }),
  p({ id: 'transpose', group: 'glote', label: 'Transpor', labelEn: 'Transpose', hint: 'Sobe ou desce todas as notas, em semitons.', min: -36, max: 36, def: 0, unit: 'st', curve: 'lin', digits: 0 }),
  p({ id: 'tension', group: 'glote', label: 'Tensão', labelEn: 'Tension', hint: 'Rd da glote. Baixo soa apertado, alto soa soproso.', min: 0.3, max: 2.7, def: 1.1, unit: 'Rd', curve: 'lin', invert: true, digits: 2 }),
  p({ id: 'aspiration', group: 'glote', label: 'Aspiração', labelEn: 'Aspiration', hint: 'Ruído de sopro junto com a voz.', min: 0, max: 1, def: 0.12, unit: '%', curve: 'lin', digits: 0, display: 100 }),
  p({ id: 'jitter', group: 'glote', label: 'Jitter', labelEn: 'Jitter', hint: 'Pequenas variações de altura, ciclo a ciclo.', min: 0, max: 1, def: 0.15, unit: '%', curve: 'lin', digits: 0, display: 100 }),
  p({ id: 'shimmer', group: 'glote', label: 'Shimmer', labelEn: 'Shimmer', hint: 'Pequenas variações de volume, ciclo a ciclo.', min: 0, max: 1, def: 0.1, unit: '%', curve: 'lin', digits: 0, display: 100 }),
  p({ id: 'fry', group: 'glote', label: 'Fry', labelEn: 'Fry', hint: 'Sub-harmônico: um ciclo forte, outro fraco. Deixa a voz rouca, rasgada.', min: 0, max: 1, def: 0, unit: '%', curve: 'lin', digits: 0, display: 100 }),
  p({ id: 'vibRate', group: 'glote', label: 'Vibrato taxa', labelEn: 'Vibrato rate', hint: 'Velocidade do vibrato.', min: 0, max: 12, def: 5.2, unit: 'Hz', curve: 'lin', digits: 1 }),
  p({ id: 'vibDepth', group: 'glote', label: 'Vibrato prof.', labelEn: 'Vibrato depth', hint: 'Quanto o vibrato sobe e desce a nota.', min: 0, max: 100, def: 18, unit: 'ct', curve: 'sq', digits: 0 }),
  p({ id: 'vibDelay', group: 'glote', label: 'Vibrato atraso', labelEn: 'Vibrato delay', hint: 'Tempo até o vibrato aparecer na nota.', min: 0, max: 2, def: 0.35, unit: 's', curve: 'sq', digits: 2 }),

  // Língua
  p({ id: 'tonguePos', group: 'lingua', label: 'Posição', labelEn: 'Position', hint: 'Língua para trás (garganta) ou para a frente (dentes).', min: 0, max: 1, def: 0.12, unit: '%', curve: 'lin', digits: 0, display: 100 }),
  p({ id: 'tongueHeight', group: 'lingua', label: 'Altura', labelEn: 'Height', hint: 'Língua baixa (boca aberta) ou alta (perto do céu da boca).', min: 0, max: 1, def: 0.3, unit: '%', curve: 'lin', digits: 0, display: 100 }),

  // Mandíbula
  p({ id: 'jaw', group: 'mandibula', label: 'Abertura', labelEn: 'Opening', hint: 'Abre ou fecha a mandíbula.', min: 0, max: 1, def: 1, unit: '%', curve: 'lin', digits: 0, display: 100 }),

  // Lábios
  p({ id: 'lipOpen', group: 'labios', label: 'Abertura', labelEn: 'Opening', hint: 'Zero fecha a boca de vez (sons de p, b, m).', min: 0, max: 1, def: 0.9, unit: '%', curve: 'lin', digits: 0, display: 100 }),
  p({ id: 'lipProtrusion', group: 'labios', label: 'Protrusão', labelEn: 'Protrusion', hint: 'Faz bico e alonga o tubo (u, ô).', min: 0, max: 1, def: 0, unit: '%', curve: 'lin', digits: 0, display: 100 }),
  p({ id: 'lipWidth', group: 'labios', label: 'Largura', labelEn: 'Width', hint: 'Sorriso largo ou boca estreita.', min: 0, max: 1, def: 0.9, unit: '%', curve: 'lin', digits: 0, display: 100 }),

  // Trato
  p({ id: 'tractLength', group: 'trato', label: 'Comprimento', labelEn: 'Length', hint: 'Tamanho do tubo: curto como um bico ou longo como um gigante. Vale a partir da próxima nota.', min: 0.4, max: 3, def: 1, unit: '%', curve: 'exp', digits: 0, display: 100 }),

  // Saco vocal
  p({ id: 'sacSize', group: 'saco', label: 'Tamanho', labelEn: 'Size', hint: 'Zero desliga o saco. Maior = ressonância mais grave e mais som saindo por ele.', min: 0, max: 1, def: 0, unit: '%', curve: 'lin', digits: 0, display: 100 }),
  p({ id: 'sacElastic', group: 'saco', label: 'Elasticidade', labelEn: 'Elasticity', hint: 'Pele mais esticada afina a ressonância para cima.', min: 0, max: 1, def: 0.5, unit: '%', curve: 'lin', digits: 0, display: 100 }),
  p({ id: 'sacDamp', group: 'saco', label: 'Amortecimento', labelEn: 'Damping', hint: 'Pouco amortecimento faz o saco continuar vibrando depois do som.', min: 0, max: 1, def: 0.4, unit: '%', curve: 'lin', digits: 0, display: 100 }),
  p({ id: 'sacPos', group: 'saco', label: 'Posição', labelEn: 'Position', hint: 'Onde o saco se liga ao tubo: perto da garganta ou da boca.', min: 0, max: 1, def: 0.3, unit: '%', curve: 'lin', digits: 0, display: 100 }),
  p({ id: 'sacCouple', group: 'saco', label: 'Acoplamento', labelEn: 'Coupling', hint: 'Quanto som passa pelo saco.', min: 0, max: 1, def: 0.6, unit: '%', curve: 'lin', digits: 0, display: 100 }),

  // Envelope de amplitude
  p({ id: 'attack', group: 'envelope', label: 'Ataque', labelEn: 'Attack', hint: 'Tempo para a voz chegar ao volume cheio.', min: 0.002, max: 3, def: 0.04, unit: 's', curve: 'exp', digits: 3 }),
  p({ id: 'decay', group: 'envelope', label: 'Queda', labelEn: 'Decay', hint: 'Tempo para cair até o nível de sustentação.', min: 0.005, max: 4, def: 0.3, unit: 's', curve: 'exp', digits: 3 }),
  p({ id: 'sustain', group: 'envelope', label: 'Sustentação', labelEn: 'Sustain', hint: 'Volume enquanto a tecla fica apertada.', min: 0, max: 1, def: 0.85, unit: '%', curve: 'lin', digits: 0, display: 100 }),
  p({ id: 'release', group: 'envelope', label: 'Soltura', labelEn: 'Release', hint: 'Tempo para a voz sumir depois de soltar a tecla.', min: 0.01, max: 6, def: 0.25, unit: 's', curve: 'exp', digits: 3 }),
  p({ id: 'glide', group: 'envelope', label: 'Glide', labelEn: 'Glide', hint: 'Escorregar de uma nota para outra quando tocadas ligadas.', min: 0, max: 1.5, def: 0.06, unit: 's', curve: 'sq', digits: 3 }),

  // Envelope de pitch
  p({ id: 'pitchAmt', group: 'pitch', label: 'Quantidade', labelEn: 'Amount', hint: 'Quanto o envelope empurra a nota, em semitons.', min: -24, max: 24, def: 0, unit: 'st', curve: 'lin', digits: 1 }),
  p({ id: 'pitchAtk', group: 'pitch', label: 'Ataque', labelEn: 'Attack', hint: 'Tempo para a nota chegar ao pico do envelope.', min: 0.001, max: 2, def: 0.05, unit: 's', curve: 'exp', digits: 3 }),
  p({ id: 'pitchDec', group: 'pitch', label: 'Queda', labelEn: 'Decay', hint: 'Tempo para a nota escorregar até o nível final.', min: 0.01, max: 4, def: 0.5, unit: 's', curve: 'exp', digits: 3 }),
  p({ id: 'pitchSus', group: 'pitch', label: 'Final', labelEn: 'Sustain', hint: 'Onde a nota termina: acima, no tom, ou abaixo (negativo).', min: -1, max: 1, def: 0, unit: '%', curve: 'lin', digits: 0, display: 100 }),

  // Saída
  p({ id: 'volume', group: 'saida', label: 'Volume', labelEn: 'Volume', hint: 'Volume da voz.', min: 0, max: 1, def: 0.7, unit: '%', curve: 'sq', digits: 0, display: 100 }),
] as const satisfies readonly ParamDef[];

export type ParamId = (typeof PARAMS)[number]['id'];

export const PARAM_COUNT = PARAMS.length;

export const PARAM_INDEX: Record<ParamId, number> = Object.fromEntries(
  PARAMS.map((d, i) => [d.id, i]),
) as Record<ParamId, number>;

export function getDef(id: ParamId): ParamDef {
  return PARAMS[PARAM_INDEX[id]];
}

export function toPhysical(def: ParamDef, n: number): number {
  const x = n < 0 ? 0 : n > 1 ? 1 : n;
  switch (def.curve) {
    case 'lin':
      return def.min + x * (def.max - def.min);
    case 'sq':
      return def.min + x * x * (def.max - def.min);
    case 'exp':
      return def.min * Math.pow(def.max / def.min, x);
  }
}

export function toNormalized(def: ParamDef, v: number): number {
  let n: number;
  switch (def.curve) {
    case 'lin':
      n = (v - def.min) / (def.max - def.min);
      break;
    case 'sq':
      n = Math.sqrt(Math.max(0, (v - def.min) / (def.max - def.min)));
      break;
    case 'exp':
      n = Math.log(v / def.min) / Math.log(def.max / def.min);
      break;
  }
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/** Valor normalizado de um knob, levando em conta `invert`. */
export function knobToNormalized(def: ParamDef, knob: number): number {
  return def.invert ? 1 - knob : knob;
}

export function formatValue(def: ParamDef, physical: number): string {
  const v = physical * (def.display ?? 1);
  const s = v.toFixed(def.digits).replace('.', ',');
  if (def.unit === 's' && physical < 1) return `${Math.round(physical * 1000)} ms`;
  if (def.unit === 'Rd') return `Rd ${s}`;
  if ((def.unit === 'ct' || def.unit === 'st' || def.unit === '%') && v > 0 && def.min < 0) return `+${s} ${def.unit}`.replace(' %', '%');
  return `${s} ${def.unit}`.replace(' %', '%');
}

/** Valores normalizados padrão, na ordem de PARAMS. */
export function defaultNormalized(): Float32Array {
  const out = new Float32Array(PARAM_COUNT);
  PARAMS.forEach((d, i) => (out[i] = toNormalized(d, d.def)));
  return out;
}

/** Vogais rápidas: posições anatômicas na unidade física (todas 0..1). */
export interface VowelShape {
  tonguePos: number;
  tongueHeight: number;
  jaw: number;
  lipOpen: number;
  lipProtrusion: number;
  lipWidth: number;
}

/**
 * Calibradas por análise de formantes (tests/vowels.test.ts). Referência aproximada
 * de F1/F2 em voz adulta: A 700/1200, E 450/2100, I 290/2400, O 470/870, U 320/780 Hz.
 */
export const VOWELS: Record<'A' | 'E' | 'I' | 'O' | 'U', VowelShape> = {
  A: { tonguePos: 0.12, tongueHeight: 0.3, jaw: 1, lipOpen: 0.9, lipProtrusion: 0, lipWidth: 0.9 },
  E: { tonguePos: 0.97, tongueHeight: 0.6, jaw: 0.7, lipOpen: 0.8, lipProtrusion: 0, lipWidth: 0.75 },
  I: { tonguePos: 0.9, tongueHeight: 0.85, jaw: 0.25, lipOpen: 0.45, lipProtrusion: 0, lipWidth: 1 },
  O: { tonguePos: 0.28, tongueHeight: 0.6, jaw: 0.5, lipOpen: 0.8, lipProtrusion: 0.25, lipWidth: 0.5 },
  U: { tonguePos: 0.18, tongueHeight: 0.75, jaw: 0.45, lipOpen: 0.5, lipProtrusion: 0.5, lipWidth: 0.25 },
};
