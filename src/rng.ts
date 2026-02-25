/**
 * Mulberry32 — PRNG seedável de 32 bits.
 * Referência: Tommy Ettinger, 2017. Estatisticamente adequado para simulação de jogos.
 * Propriedade crítica: dado o mesmo seed, produz a mesma sequência — bugs de simulação
 * são reproduzíveis e partidas podem ser replicadas.
 */
export class RNG {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0; // garante unsigned 32-bit
  }

  /** Retorna float uniforme em [0, 1) */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Inteiro em [min, max] inclusive */
  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  /** Retorna true com probabilidade p */
  chance(p: number): boolean {
    return this.next() < p;
  }

  /**
   * Seed derivada de round + índice do jogo.
   * Garante seeds distintas por partida sem colisão entre rodadas.
   */
  static fromMatch(round: number, matchIndex: number): RNG {
    // Cantor pairing function para mapear (round, index) → inteiro único
    const seed = ((round + matchIndex) * (round + matchIndex + 1)) / 2 + matchIndex;
    return new RNG(seed);
  }
}