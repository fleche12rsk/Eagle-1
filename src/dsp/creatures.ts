/**
 * Criaturas: conjuntos de valores físicos. O que uma criatura não define
 * volta ao padrão do parâmetro.
 */

import { PARAMS, PARAM_COUNT, toNormalized, type ParamId } from './params';

export type CreatureId = 'humano' | 'gaviao';

export interface Creature {
  id: CreatureId;
  name: string;
  /** Frase curta que aparece na interface. */
  blurb: string;
  values: Partial<Record<ParamId, number>>;
}

export const CREATURES: Record<CreatureId, Creature> = {
  humano: {
    id: 'humano',
    name: 'Humano',
    blurb: 'Voz adulta, trato de 17,5 cm.',
    values: {},
  },
  /**
   * Gavião: o grito "kiii-ahh" de ave de rapina. Nota alta (2 oitavas acima),
   * tubo curto como um bico, glote apertada e rouca, e um envelope de pitch
   * que sobe rápido e despenca abaixo da nota de partida.
   */
  gaviao: {
    id: 'gaviao',
    name: 'Gavião',
    blurb: 'Grito rouco e agudo que sobe e despenca. Segure a tecla.',
    values: {
      transpose: 24,
      tension: 0.55,
      aspiration: 0.5,
      jitter: 0.55,
      shimmer: 0.45,
      fry: 0.4,
      vibRate: 0,
      vibDepth: 0,
      tractLength: 0.42,
      tonguePos: 0.62,
      tongueHeight: 0.45,
      jaw: 0.85,
      lipOpen: 0.85,
      lipProtrusion: 0,
      lipWidth: 1,
      attack: 0.018,
      decay: 1.6,
      sustain: 0.3,
      release: 0.3,
      glide: 0.02,
      pitchAmt: 5,
      pitchAtk: 0.07,
      pitchDec: 1.1,
      pitchSus: -0.7,
      volume: 0.62,
    },
  },
};

/** Valores normalizados completos de uma criatura. */
export function creatureNormalized(id: CreatureId): Float32Array {
  const out = new Float32Array(PARAM_COUNT);
  const values = CREATURES[id].values;
  PARAMS.forEach((def, i) => {
    const v = values[def.id as ParamId];
    out[i] = toNormalized(def, v ?? def.def);
  });
  return out;
}
