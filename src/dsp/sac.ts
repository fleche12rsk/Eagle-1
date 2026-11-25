/**
 * Saco vocal: um ressonador lateral elástico, como o papo de um pombo ou o
 * saco de um sapo. Ele escuta a pressão num ponto do tubo, ressoa numa
 * frequência própria (tamanho e elasticidade) e:
 *  - irradia som para fora (a pele do saco vibra e soa);
 *  - devolve ao tubo uma pequena parte com sinal invertido, roubando energia
 *    na própria frequência (um antiformante, como faz um ramo lateral real).
 */

export interface SacParams {
  sacSize: number;
  sacElastic: number;
  sacDamp: number;
  sacPos: number;
  sacCouple: number;
}

export class VocalSac {
  private b0 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  /** Envoltória da saída, para a interface "inflar" o saco. */
  energy = 0;
  private lastF = -1;
  private lastQ = -1;

  constructor(private readonly fs: number) {}

  /** Frequência de ressonância em Hz. */
  static frequency(p: SacParams): number {
    return (90 + 1100 * (1 - p.sacSize) ** 1.6) * (0.55 + 0.9 * p.sacElastic);
  }

  /** Atualiza o filtro (uma vez por bloco). */
  configure(p: SacParams): void {
    const f = VocalSac.frequency(p);
    const q = 0.8 + (1 - p.sacDamp) * 11;
    if (Math.abs(f - this.lastF) < 0.05 && Math.abs(q - this.lastQ) < 0.001) return;
    this.lastF = f;
    this.lastQ = q;
    const w = (2 * Math.PI * f) / this.fs;
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    this.b0 = alpha / a0;
    this.b2 = -alpha / a0;
    this.a1 = (-2 * Math.cos(w)) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  reset(): void {
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
    this.energy = 0;
  }

  process(x: number): number {
    const y = this.b0 * x + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y === y ? y : 0;
    const a = y < 0 ? -y : y;
    this.energy += (a - this.energy) * 0.0005;
    return this.y1;
  }
}
