import { Match, Player } from './types';

export function getEffectiveStrength(player: Player): number {
  const energyFactor = 0.5 + player.energy / 200; // 0.5 to 1.0
  const moraleFactor = 0.8 + (player.morale / 100) * 0.4; // 0.8 to 1.2
  return Math.round(player.strength * energyFactor * moraleFactor);
}

export function getBestLineup(players: Player[]): Player[] {
  const available = players.filter(p => !p.redCard);
  const g = available.filter(p => p.position === 'G').sort((a, b) => getEffectiveStrength(b) - getEffectiveStrength(a)).slice(0, 1);
  const d = available.filter(p => p.position === 'D').sort((a, b) => getEffectiveStrength(b) - getEffectiveStrength(a)).slice(0, 4);
  const m = available.filter(p => p.position === 'M').sort((a, b) => getEffectiveStrength(b) - getEffectiveStrength(a)).slice(0, 4);
  const a = available.filter(p => p.position === 'A').sort((a, b) => getEffectiveStrength(b) - getEffectiveStrength(a)).slice(0, 2);
  return [...g, ...d, ...m, ...a];
}

export function simulateMatch(match: Match, homePlayers: Player[], awayPlayers: Player[]): { match: Match, playerUpdates: Partial<Player>[] } {
  const homeStrength = homePlayers.reduce((sum, p) => sum + getEffectiveStrength(p), 0) / (homePlayers.length || 1);
  const awayStrength = awayPlayers.reduce((sum, p) => sum + getEffectiveStrength(p), 0) / (awayPlayers.length || 1);

  // Home advantage
  const homeAdvantage = 3;
  
  const homeChance = homeStrength + homeAdvantage + Math.random() * 20;
  const awayChance = awayStrength + Math.random() * 20;

  let homeScore = 0;
  let awayScore = 0;

  const totalChances = Math.floor(Math.random() * 6) + 1; // 1 to 6 goals max usually
  
  const homeScorers: string[] = [];
  const homeAssisters: string[] = [];
  const awayScorers: string[] = [];
  const awayAssisters: string[] = [];

  const pickPlayer = (players: Player[], isScorer: boolean) => {
    // Attackers and Midfielders are more likely to score/assist
    const weights = players.map(p => {
      let w = 1;
      if (p.position === 'A') w = isScorer ? 10 : 5;
      if (p.position === 'M') w = isScorer ? 4 : 8;
      if (p.position === 'D') w = isScorer ? 1 : 2;
      if (p.position === 'G') w = 0;
      return w;
    });
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    if (totalWeight === 0) return null;
    let roll = Math.random() * totalWeight;
    for (let i = 0; i < players.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return players[i].id;
    }
    return players[0].id;
  };

  for (let i = 0; i < totalChances; i++) {
    const roll = Math.random() * (homeChance + awayChance);
    if (roll < homeChance) {
      if (Math.random() > 0.5) {
        homeScore++;
        const scorer = pickPlayer(homePlayers, true);
        if (scorer) homeScorers.push(scorer);
        if (Math.random() > 0.3) {
          const assister = pickPlayer(homePlayers, false);
          if (assister && assister !== scorer) homeAssisters.push(assister);
        }
      }
    } else {
      if (Math.random() > 0.6) {
        awayScore++;
        const scorer = pickPlayer(awayPlayers, true);
        if (scorer) awayScorers.push(scorer);
        if (Math.random() > 0.3) {
          const assister = pickPlayer(awayPlayers, false);
          if (assister && assister !== scorer) awayAssisters.push(assister);
        }
      }
    }
  }

  const playerUpdates: Partial<Player>[] = [];
  const allPlayers = [...homePlayers, ...awayPlayers];
  
  allPlayers.forEach(p => {
    // Energy loss
    const energyLoss = Math.floor(Math.random() * 10) + 15; // 15 to 24
    let newEnergy = Math.max(0, p.energy - energyLoss);
    
    // Cards
    let newYellows = p.yellowCards;
    let newRed = p.redCard;
    
    if (Math.random() < 0.1) { // 10% chance of a card
      if (Math.random() < 0.1) { // 10% of cards are direct red
        newRed = true;
      } else {
        newYellows++;
        if (newYellows >= 3) {
          newRed = true;
          newYellows = 0;
        }
      }
    }
    
    const goalsScored = (homeScorers.filter(id => id === p.id).length) + (awayScorers.filter(id => id === p.id).length);
    const assistsMade = (homeAssisters.filter(id => id === p.id).length) + (awayAssisters.filter(id => id === p.id).length);

    // Natural training progress from playing
    let newTrainingProgress = p.trainingProgress + Math.floor(Math.random() * 3) + 1;
    let newStrength = p.strength;
    if (newTrainingProgress >= 100) {
      newStrength = Math.min(99, newStrength + 1);
      newTrainingProgress -= 100;
    }

    playerUpdates.push({
      id: p.id,
      energy: newEnergy,
      yellowCards: newYellows,
      redCard: newRed,
      matchesPlayed: p.matchesPlayed + 1,
      goals: p.goals + goalsScored,
      assists: p.assists + assistsMade,
      strength: newStrength,
      trainingProgress: newTrainingProgress
    });
  });

  return {
    match: {
      ...match,
      homeScore,
      awayScore,
      played: true
    },
    playerUpdates
  };
}
