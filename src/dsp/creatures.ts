/**
 * Criaturas: conjuntos de valores físicos. O que uma criatura não define
 * volta ao padrão do parâmetro.
 */

import { PARAMS, PARAM_COUNT, toNormalized, type ParamId } from './params';

export type CreatureId = 'humano' | 'gaviao' | 'pombo' | 'sapo';

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
      teeth: 0,
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
  /**
   * Pombo: o arrulho "hu-RRUU-u" sai de bico fechado. O som enche o papo
   * (saco vocal grande e mole, ligado no fundo da garganta) e é ele que soa.
   * A nota sobe devagar e cai no fim; um vibrato rápido dá o rolado.
   */
  pombo: {
    id: 'pombo',
    name: 'Pombo',
    blurb: 'Arrulho de bico fechado: o som sai pelo papo inflado.',
    values: {
      transpose: 5,
      tension: 1.5,
      aspiration: 0.12,
      jitter: 0.25,
      shimmer: 0.2,
      fry: 0.12,
      vibRate: 11,
      vibDepth: 22,
      vibDelay: 0.05,
      tractLength: 0.5,
      tonguePos: 0.4,
      tongueHeight: 0.55,
      jaw: 0.1,
      lipOpen: 0,
      lipProtrusion: 0,
      lipWidth: 0.4,
      teeth: 0,
      sacSize: 0.75,
      sacElastic: 0.4,
      sacDamp: 0.35,
      sacPos: 0.3,
      sacCouple: 0.85,
      attack: 0.09,
      decay: 0.7,
      sustain: 0.55,
      release: 0.3,
      glide: 0.08,
      pitchAmt: 4,
      pitchAtk: 0.2,
      pitchDec: 0.5,
      pitchSus: -0.4,
      volume: 0.68,
    },
  },
  /**
   * Sapo: um coaxar grave e rouco ("rrribbit"). Voz áspera e irregular, boca
   * larga com cristas no céu da boca, e o saco vocal enorme e mole que ressoa.
   */
  sapo: {
    id: 'sapo',
    name: 'Sapo',
    blurb: 'Coaxar grave e áspero, com o saco vocal enorme ressoando.',
    values: {
      transpose: 0,
      tension: 1.7,
      aspiration: 0.1,
      jitter: 0.4,
      shimmer: 0.35,
      fry: 0.5,
      rough: 0.75,
      vibRate: 0,
      vibDepth: 0,
      tractLength: 0.72,
      tonguePos: 0.5,
      tongueHeight: 0.35,
      jaw: 0.8,
      lipOpen: 0.9,
      lipProtrusion: 0,
      lipWidth: 1,
      mouthLength: 1.15,
      teeth: 0,
      ridges: 0.5,
      rings: 0.3,
      sacSize: 0.9,
      sacElastic: 0.25,
      sacDamp: 0.25,
      sacPos: 0.32,
      sacCouple: 1,
      attack: 0.03,
      decay: 0.35,
      sustain: 0.6,
      release: 0.25,
      glide: 0.05,
      pitchAmt: 2,
      pitchAtk: 0.06,
      pitchDec: 0.25,
      pitchSus: -0.3,
      volume: 0.6,
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
