import { Player, PlayerAttributes, Position, PRIMARY_ATTRS, Formation, FORMATIONS } from './types';

export function computeOverall(attrs: PlayerAttributes, pos: Position): number {
  const keys = PRIMARY_ATTRS[pos];
  return Math.round(keys.reduce((s, k) => s + attrs[k], 0) / keys.length);
}

/**
 * Força efetiva em jogo.
 * Inclui energia, moral, stamina e forma (formStreak).
 * moraleMultiplier = 2.0 para especialização "motivador".
 */
export function getEffectiveStrength(player: Player, moraleMultiplier = 1.0): number {
  const energyFactor    = 0.5 + player.energy / 200;
  const moraleDeviation = (player.morale / 100 - 0.5) * 0.4 * moraleMultiplier;
  const moraleFactor    = 1.0 + moraleDeviation;
  const staminaBonus    = 1 + (player.attributes.stamina - 50) / 1000;
  // Forma: ±5 → ±10% de bônus/penalidade
  const formFactor      = 1 + (player.formStreak / 50);
  return Math.round(player.strength * energyFactor * moraleFactor * staminaBonus * formFactor);
}

export function getBestLineup(players: Player[], formation: Formation = '4-4-2'): Player[] {
  const slots = FORMATIONS[formation];
  const available = players.filter(p => !p.redCard && p.injuryWeeksLeft === 0);
  const sorted = (pos: Position, count: number) =>
    available
      .filter(p => p.position === pos)
      .sort((a, b) => getEffectiveStrength(b) - getEffectiveStrength(a))
      .slice(0, count);
  return [...sorted('G', slots.G), ...sorted('D', slots.D), ...sorted('M', slots.M), ...sorted('A', slots.A)];
}

export function computeAttackXG(players: Player[]): number {
  const fielders = players.filter(p => p.position !== 'G');
  if (fielders.length === 0) return 50;
  const total = fielders.reduce((s, p) => {
    const a = p.attributes;
    if (p.position === 'A') return s + a.chute * 0.45 + a.drible * 0.30 + a.velocidade * 0.15 + a.decisao * 0.10;
    if (p.position === 'M') return s + a.passe  * 0.40 + a.chute  * 0.25 + a.decisao   * 0.20 + a.drible  * 0.15;
    if (p.position === 'D') return s + a.cruzamento * 0.40 + a.forca * 0.35 + a.passe  * 0.25;
    return s + 50;
  }, 0);
  return total / fielders.length;
}

export function computeDefenseXG(players: Player[]): number {
  const defenders = players.filter(p => p.position !== 'A');
  if (defenders.length === 0) return 50;
  const total = defenders.reduce((s, p) => {
    const a = p.attributes;
    if (p.position === 'G') return s + a.posicionamento * 0.40 + a.decisao  * 0.35 + a.forca    * 0.25;
    if (p.position === 'D') return s + a.marcacao       * 0.45 + a.forca    * 0.30 + a.velocidade * 0.25;
    if (p.position === 'M') return s + a.marcacao       * 0.35 + a.decisao  * 0.35 + a.posicionamento * 0.30;
    return s + 50;
  }, 0);
  return total / defenders.length;
}

export function pickWeightedPlayer(players: Player[], isScorer: boolean, random: () => number): Player | null {
  if (players.length === 0) return null;
  const weights = players.map(p => {
    const a = p.attributes;
    if (p.position === 'G') return 0;
    if (isScorer) {
      const base = p.position === 'A' ? 10 : p.position === 'M' ? 4 : 1;
      return base * (0.5 + a.chute / 199);
    } else {
      const base = p.position === 'M' ? 8 : p.position === 'A' ? 5 : 2;
      return base * (0.5 + a.passe / 199);
    }
  });
  const total = weights.reduce((a, b) => a + b, 0);
  if (total === 0) return players[0];
  let roll = random() * total;
  for (let i = 0; i < players.length; i++) { roll -= weights[i]; if (roll <= 0) return players[i]; }
  return players[0];
}