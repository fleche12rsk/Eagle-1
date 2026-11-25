/**
 * Gera o perfil de diâmetros do trato oral a partir de parâmetros anatômicos.
 * Função pura: o worklet usa para o som e a interface usa para desenhar.
 *
 * Coordenada x vai de 0 (glote) a 1 (lábios). Diâmetros em "unidades de trato"
 * (~1 unidade ≈ 1 cm). A área de cada segmento é proporcional a d².
 */

export interface AnatomyShape {
  tonguePos: number; // 0 = trás (faringe) .. 1 = frente (dentes)
  tongueHeight: number; // 0 = baixa .. 1 = alta
  jaw: number; // 0 = fechada .. 1 = aberta
  lipOpen: number; // 0 = fechados .. 1 = abertos
  lipProtrusion: number; // 0 = neutro .. 1 = bico
  lipWidth: number; // 0 = estreito .. 1 = sorriso
  teeth?: number; // 0 = sem dentes .. 1 = dentes grandes
  mouthLength?: number; // 1 = normal; >1 estica a boca como um focinho
  taper?: number; // -1 funil .. +1 cone
  ridges?: number; // 0..1 cristas no céu da boca
  rings?: number; // 0..1 anéis na garganta
}

/** Fração do trato (em repouso) que é faringe; o resto é boca e pode esticar. */
export const PHARYNX_FRACTION = 0.42;

/** Comprimento total relativo do trato quando a boca é esticada por `m`. */
export const stretchedLength = (m: number) => PHARYNX_FRACTION + (1 - PHARYNX_FRACTION) * m;

/** Limites das regiões, em fração do comprimento do trato. */
export const REGIONS = {
  larynxEnd: 0.08,
  pharynxEnd: 0.42,
  velum: 0.39,
  teeth: 0.86,
} as const;

const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Sino de cosseno com meia largura `w`, centrado em `c`. */
const bell = (x: number, c: number, w: number): number => {
  const d = (x - c) / w;
  return d <= -1 || d >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * d);
};

/** Diâmetro mínimo permitido fora dos lábios (evita fechar o trato pela língua). */
export const MIN_DIAMETER = 0.05;

export function computeDiameters(a: AnatomyShape, out: Float32Array): Float32Array {
  const n = out.length;
  const jaw = a.jaw;

  // Lábios: 2 a 6 segmentos finais, conforme a protrusão.
  const lipSegs = 2 + a.lipProtrusion * 4;
  const lipIdx = n - lipSegs;
  // Boca esticada: os segmentos depois da faringe cobrem a mesma anatomia, só que mais longa.
  const m = a.mouthLength ?? 1;
  const total = stretchedLength(m);
  // Abertura labial: a mandíbula ajuda a abrir; largura escala o diâmetro equivalente.
  const lipD =
    a.lipOpen <= 0
      ? 0
      : (0.15 + 1.55 * a.lipOpen) * (0.55 + 0.45 * jaw) * (0.75 + 0.45 * a.lipWidth) * (1 - 0.25 * a.lipProtrusion);

  // Corpo da língua: o ponto de constrição desliza da faringe até o palato.
  const c = 0.24 + 0.4 * a.tonguePos + 0.06 * a.tongueHeight * (1 - a.tonguePos);
  const w = 0.2 + 0.04 * (1 - a.tongueHeight);
  // Diâmetro na constrição: língua alta aperta mais; a mandíbula aberta alivia.
  const constriction = 0.22 + 1.25 * (1 - a.tongueHeight) + 0.25 * jaw * (1 - a.tongueHeight);
  // Conservação de volume: língua à frente abre a faringe; língua atrás abre a boca.
  const pharynxWiden = 0.9 * a.tonguePos * (0.4 + 0.6 * a.tongueHeight);
  const oralWiden = 0.7 * (1 - a.tonguePos) * (0.5 + 0.5 * jaw);

  for (let i = 0; i < n; i++) {
    const pos = ((i + 0.5) / n) * total;
    const x = pos <= PHARYNX_FRACTION ? pos : PHARYNX_FRACTION + (pos - PHARYNX_FRACTION) / m;
    const k = i + 0.5; // posição em segmentos, para lábios e dentes

    // Paredes em repouso.
    let d: number;
    if (x < REGIONS.larynxEnd) {
      // Tubo da epilaringe, estreito logo acima das cordas vocais.
      d = 0.6 + 0.9 * smooth(0, REGIONS.larynxEnd, x);
    } else {
      const pharynx = 1.5 + pharynxWiden * bell(x, 0.24, 0.2);
      const oral = 1.9 + 0.9 * jaw * smooth(0.55, 0.88, x) + oralWiden * bell(x, 0.74, 0.18);
      const t = smooth(REGIONS.pharynxEnd - 0.08, REGIONS.pharynxEnd + 0.08, x);
      d = pharynx * (1 - t) + oral * t;
    }

    // Língua: puxa o diâmetro em direção à constrição.
    if (x >= REGIONS.larynxEnd && k < lipIdx) {
      const b = bell(x, c, w);
      if (b > 0 && d > constriction) d = d - (d - constriction) * b;
    }

    // Afunilamento, cristas do palato e anéis da faringe.
    if (k < lipIdx) {
      const tp = a.taper ?? 0;
      if (tp !== 0 && x >= REGIONS.larynxEnd) d *= 1 + 0.55 * tp * (x - 0.5) * 2;
      const rg = a.ridges ?? 0;
      if (rg > 0 && x > REGIONS.pharynxEnd) d *= 1 - 0.55 * rg * (0.5 + 0.5 * Math.cos(k * 2.4));
      const rn = a.rings ?? 0;
      if (rn > 0 && x < REGIONS.pharynxEnd && x > REGIONS.larynxEnd) d *= 1 - 0.5 * rn * (0.5 + 0.5 * Math.cos(k * 1.9));
    }

    // Dentes: logo atrás dos lábios, estreitam a passagem quando a mandíbula fecha.
    const teeth = a.teeth ?? 0;
    if (teeth > 0 && k < lipIdx && k >= lipIdx - 1.5) {
      const gap = 0.12 + 1.9 * jaw;
      if (d > gap) d -= (d - gap) * teeth * 0.6;
    }

    // Lábios.
    if (k >= lipIdx) {
      const frac = Math.min(1, k - lipIdx);
      d = d * (1 - frac) + lipD * frac;
    } else if (d < MIN_DIAMETER) {
      d = MIN_DIAMETER;
    }

    out[i] = d;
  }
  return out;
}
