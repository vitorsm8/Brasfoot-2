import { Player } from './types';

/**
 * Força efetiva de um jogador considerando energia e moral.
 *
 * energyFactor: [0.5, 1.0] — jogador zerado opera a 50%, não a 0%.
 * moraleFactor: [0.8, 1.2] — moral afeta em até ±20%.
 *
 * Janela total: strength * [0.40, 1.20]
 */
export function getEffectiveStrength(player: Player): number {
  const energyFactor = 0.5 + player.energy / 200;
  const moraleFactor = 0.8 + (player.morale / 100) * 0.4;
  return Math.round(player.strength * energyFactor * moraleFactor);
}

/**
 * Seleciona os 11 melhores jogadores disponíveis no esquema 1-4-4-2.
 * Exclui jogadores com cartão vermelho (suspensos).
 */
export function getBestLineup(players: Player[]): Player[] {
  const available = players.filter(p => !p.redCard);
  const sorted = (pos: Player['position'], count: number) =>
    available
      .filter(p => p.position === pos)
      .sort((a, b) => getEffectiveStrength(b) - getEffectiveStrength(a))
      .slice(0, count);

  return [
    ...sorted('G', 1),
    ...sorted('D', 4),
    ...sorted('M', 4),
    ...sorted('A', 2),
  ];
}

/**
 * Seleciona um jogador aleatório de um array usando pesos posicionais.
 * isScorer=true favorece atacantes; isScorer=false favorece meias (assistências).
 *
 * @param players - jogadores elegíveis
 * @param isScorer - se true, peso para gol; se false, peso para assistência
 * @param random - função de aleatoriedade injetada (permite PRNG seedável)
 */
export function pickWeightedPlayer(
  players: Player[],
  isScorer: boolean,
  random: () => number
): Player | null {
  if (players.length === 0) return null;

  const weights = players.map(p => {
    if (p.position === 'G') return 0;
    if (p.position === 'A') return isScorer ? 10 : 5;
    if (p.position === 'M') return isScorer ? 4 : 8;
    if (p.position === 'D') return isScorer ? 1 : 2;
    return 1;
  });

  const total = weights.reduce((a, b) => a + b, 0);
  if (total === 0) return players[0];

  let roll = random() * total;
  for (let i = 0; i < players.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return players[i];
  }
  return players[0];
}