import { Player, PlayerAttributes, Position, PRIMARY_ATTRS, Formation, FORMATIONS, FORMATION_MODIFIERS, Team, SetPieceType } from './types';

// ─── Overall ponderado ────────────────────────────────────────────────────────
const PRIMARY_WEIGHTS: Record<Position, number[]> = {
  G: [1.3, 1.2, 1.0, 0.8, 0.7],
  D: [1.3, 1.2, 1.0, 0.8, 0.7],
  M: [1.3, 1.1, 1.0, 0.9, 0.7],
  A: [1.4, 1.2, 1.0, 0.8, 0.6],
};

export function computeOverall(attrs: PlayerAttributes, pos: Position): number {
  const keys = PRIMARY_ATTRS[pos];
  const weights = PRIMARY_WEIGHTS[pos];
  let total = 0, totalWeight = 0;
  for (let i = 0; i < keys.length; i++) {
    total += attrs[keys[i]] * weights[i];
    totalWeight += weights[i];
  }
  return Math.round(total / totalWeight);
}

export function getEffectiveStrength(player: Player, moraleMultiplier = 1.0): number {
  const energyFactor    = 0.5 + player.energy / 200;
  const moraleDeviation = (player.morale / 100 - 0.5) * 0.4 * moraleMultiplier;
  const moraleFactor    = 1.0 + moraleDeviation;
  const staminaBonus    = 1 + (player.attributes.stamina - 50) / 1000;
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

// ═══════════════════════════════════════════════════════════════════════════════
// BOLA PARADA — Sistema de escanteios, faltas e pênaltis
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Determina se um lance de bola parada acontece neste tick.
 * Faltas surgem de disputas (disciplina vs agressividade).
 * Escanteios surgem de ataques bloqueados pela defesa.
 * Pênaltis são faltas dentro da área (raras).
 */
export interface SetPieceResult {
  type: SetPieceType | null;
  foulingPlayerId?: string;  // quem cometeu a falta
  fouledPlayerId?: string;   // quem sofreu
}

export function checkSetPiece(
  attackers: Player[],
  defenders: Player[],
  chanceCreated: boolean,
  shotBlocked: boolean,
  rand: () => number,
): SetPieceResult {
  // ── Escanteio: chute bloqueado pela defesa → ~30% vira escanteio
  if (shotBlocked && rand() < 0.30) {
    return { type: 'corner' };
  }

  // ── Falta: disputas no meio/ataque → probabilidade baseada em disciplina
  const atkFielders = attackers.filter(p => p.position !== 'G');
  const defFielders = defenders.filter(p => p.position !== 'G');
  if (atkFielders.length === 0 || defFielders.length === 0) return { type: null };

  // Média de indisciplina dos defensores (quanto menor disciplina, mais falta)
  const avgDefDiscipline = defFielders.reduce((s, p) => s + p.attributes.disciplina, 0) / defFielders.length;
  const foulChance = 0.008 * (1.5 - avgDefDiscipline / 100);

  if (rand() < foulChance) {
    // Quem cometeu: defensor com menor disciplina
    const fouler = defFielders.sort((a, b) => a.attributes.disciplina - b.attributes.disciplina)[0];
    // Quem sofreu: atacante mais habilidoso (difícil de marcar)
    const fouled = atkFielders.sort((a, b) =>
      (b.attributes.drible + b.attributes.velocidade) - (a.attributes.drible + a.attributes.velocidade)
    )[0];

    // Pênalti: ~8% das faltas acontecem na área
    if (rand() < 0.08) {
      return { type: 'penalty', foulingPlayerId: fouler.id, fouledPlayerId: fouled.id };
    }

    // Falta perigosa (perto do gol): ~40%
    if (rand() < 0.40) {
      return { type: 'freekick', foulingPlayerId: fouler.id, fouledPlayerId: fouled.id };
    }
  }

  // ── Escanteio avulso: ataque pressionou mas defesa rebateu
  if (chanceCreated && rand() < 0.15) {
    return { type: 'corner' };
  }

  return { type: null };
}

/**
 * Resolve um escanteio.
 * Depende de: cruzamento do batedor, cabeceio + força dos atacantes/defensores, GK.
 */
export function resolveCorner(
  attackers: Player[],
  defenders: Player[],
  goalkeeper: Player | null,
  rand: () => number,
): { result: 'goal' | 'saved' | 'missed' | 'nothing'; scorer: Player | null; assister: Player | null } {
  // Batedor: melhor cruzamento do time
  const kicker = attackers
    .filter(p => p.position !== 'G')
    .sort((a, b) => b.attributes.cruzamento - a.attributes.cruzamento)[0];
  if (!kicker) return { result: 'nothing', scorer: null, assister: null };

  // Qualidade do cruzamento (0-1)
  const crossQuality = kicker.attributes.cruzamento / 100;

  // Cabeceadores: atacantes e zagueiros que sobem
  const headers = attackers
    .filter(p => p.position !== 'G')
    .sort((a, b) => (b.attributes.cabeceio + b.attributes.forca) - (a.attributes.cabeceio + a.attributes.forca));

  // Marcadores no escanteio
  const markers = defenders
    .filter(p => p.position !== 'G')
    .sort((a, b) => (b.attributes.cabeceio + b.attributes.marcacao) - (a.attributes.cabeceio + a.attributes.marcacao));

  // Chance de conectar no cruzamento: ~25-45% dependendo da qualidade
  const connectChance = 0.20 + crossQuality * 0.25;
  if (rand() > connectChance) return { result: 'nothing', scorer: null, assister: null };

  // Disputa aérea: melhor cabeceador atk vs melhor marcador def
  const bestHeader = headers[0];
  const bestMarker = markers[0];
  if (!bestHeader) return { result: 'nothing', scorer: null, assister: null };

  const atkAerial = bestHeader.attributes.cabeceio * 0.5 + bestHeader.attributes.forca * 0.3 + bestHeader.attributes.posicionamento * 0.2;
  const defAerial = bestMarker
    ? bestMarker.attributes.cabeceio * 0.4 + bestMarker.attributes.marcacao * 0.3 + bestMarker.attributes.forca * 0.3
    : 30;

  const winHeader = atkAerial / Math.max(1, atkAerial + defAerial);
  if (rand() > winHeader) return { result: 'missed', scorer: bestHeader, assister: kicker };

  // Cabeceio no gol: qualidade do cabeceio
  const shotOnTarget = (bestHeader.attributes.cabeceio * 0.6 + bestHeader.attributes.decisao * 0.4) / 120;
  if (rand() > shotOnTarget) return { result: 'missed', scorer: bestHeader, assister: kicker };

  // Defesa do goleiro (mais difícil em cabeceio)
  const saveProb = computeGoalkeeperSave(goalkeeper) * 0.75; // GK tem 25% menos chance em bola aérea
  if (rand() < saveProb) return { result: 'saved', scorer: bestHeader, assister: kicker };

  return { result: 'goal', scorer: bestHeader, assister: kicker };
}

/**
 * Resolve uma falta direta (cobrança de falta perigosa).
 * Depende de: chute + decisão do cobrador, posicionamento do GK.
 */
export function resolveFreeKick(
  attackers: Player[],
  goalkeeper: Player | null,
  rand: () => number,
): { result: 'goal' | 'saved' | 'missed'; scorer: Player | null } {
  // Cobrador: melhor chute (não goleiro)
  const kicker = attackers
    .filter(p => p.position !== 'G')
    .sort((a, b) => (b.attributes.chute + b.attributes.decisao * 0.3) - (a.attributes.chute + a.attributes.decisao * 0.3))[0];
  if (!kicker) return { result: 'missed', scorer: null };

  // Qualidade da cobrança
  const kickQuality = (kicker.attributes.chute * 0.6 + kicker.attributes.decisao * 0.25 + kicker.attributes.forca * 0.15) / 100;

  // Chute no gol: faltas são mais difíceis (~30-50% no gol)
  const onTarget = 0.25 + kickQuality * 0.25;
  if (rand() > onTarget) return { result: 'missed', scorer: kicker };

  // Defesa do GK (barreira já removida conceptualmente)
  const saveProb = computeGoalkeeperSave(goalkeeper) * 0.9; // barreira ajuda um pouco
  if (rand() < saveProb) return { result: 'saved', scorer: kicker };

  return { result: 'goal', scorer: kicker };
}

/**
 * Resolve um pênalti.
 * Alta conversão (~75-85%) mas depende de pressão/moral.
 */
export function resolvePenalty(
  attackers: Player[],
  goalkeeper: Player | null,
  rand: () => number,
): { result: 'goal' | 'saved' | 'missed'; scorer: Player | null } {
  // Cobrador: atacante com melhor chute + decisão + disciplina (sangue frio)
  const kicker = attackers
    .filter(p => p.position !== 'G')
    .sort((a, b) =>
      (b.attributes.chute * 0.5 + b.attributes.decisao * 0.3 + b.attributes.disciplina * 0.2) -
      (a.attributes.chute * 0.5 + a.attributes.decisao * 0.3 + a.attributes.disciplina * 0.2)
    )[0];
  if (!kicker) return { result: 'missed', scorer: null };

  // Pressão: moral baixa = mais chance de errar
  const pressureFactor = 0.85 + (kicker.morale / 100) * 0.15; // 85-100%

  // Conversão base: ~80%, modificada por habilidade e pressão
  const kickSkill = (kicker.attributes.chute * 0.6 + kicker.attributes.decisao * 0.4) / 100;
  const conversionChance = (0.70 + kickSkill * 0.15) * pressureFactor;

  // Perde o gol (chuta pra fora)
  if (rand() > conversionChance + 0.10) return { result: 'missed', scorer: kicker };

  // GK tenta defender (pênalti é muito difícil de defender, ~15-25%)
  const gkSaveBase = goalkeeper
    ? (goalkeeper.attributes.decisao * 0.5 + goalkeeper.attributes.posicionamento * 0.3 + goalkeeper.attributes.forca * 0.2) / 100
    : 0.10;
  const penaltySaveChance = gkSaveBase * 0.30; // muito reduzido para pênaltis

  if (rand() < penaltySaveChance) return { result: 'saved', scorer: kicker };

  return { result: 'goal', scorer: kicker };
}

// ═══════════════════════════════════════════════════════════════════════════════
// FASES DE JOGO (sistema existente + integração com bola parada)
// ═══════════════════════════════════════════════════════════════════════════════

export function computeMidfieldControl(attackers: Player[], defenders: Player[]): number {
  const atkMid = attackers.filter(p => p.position === 'M');
  const defMid = defenders.filter(p => p.position === 'M');
  if (atkMid.length === 0 && defMid.length === 0) return 0.5;

  const midScore = (players: Player[]) => {
    if (players.length === 0) return 30;
    return players.reduce((s, p) => {
      const a = p.attributes;
      return s + a.passe * 0.35 + a.decisao * 0.25 + a.posicionamento * 0.20 + a.stamina * 0.10 + a.drible * 0.10;
    }, 0) / players.length;
  };

  const atkScore = midScore(atkMid);
  const defScore = midScore(defMid);
  return atkScore / Math.max(1, atkScore + defScore);
}

export function computeChanceCreation(attackers: Player[], defenders: Player[]): number {
  const atkCreators = attackers.filter(p => p.position === 'A' || p.position === 'M');
  const defLine = defenders.filter(p => p.position === 'D' || p.position === 'M');

  if (atkCreators.length === 0) return 0.02;

  const atkScore = atkCreators.reduce((s, p) => {
    const a = p.attributes;
    if (p.position === 'A') return s + a.drible * 0.35 + a.velocidade * 0.30 + a.decisao * 0.20 + a.posicionamento * 0.15;
    return s + a.passe * 0.40 + a.decisao * 0.30 + a.cruzamento * 0.15 + a.drible * 0.15;
  }, 0) / atkCreators.length;

  const defScore = defLine.length > 0
    ? defLine.reduce((s, p) => {
        const a = p.attributes;
        if (p.position === 'D') return s + a.marcacao * 0.40 + a.posicionamento * 0.30 + a.forca * 0.15 + a.velocidade * 0.15;
        return s + a.marcacao * 0.30 + a.posicionamento * 0.30 + a.decisao * 0.25 + a.forca * 0.15;
      }, 0) / defLine.length
    : 30;

  const ratio = atkScore / Math.max(1, atkScore + defScore);
  return 0.01 + ratio * 0.04;
}

export function computeShotQuality(shooter: Player): number {
  const a = shooter.attributes;
  const base = a.chute * 0.50 + a.decisao * 0.25 + a.posicionamento * 0.15 + a.forca * 0.10;
  return Math.min(1, base / 120);
}

export function computeGoalkeeperSave(goalkeeper: Player | null): number {
  if (!goalkeeper || goalkeeper.position !== 'G') return 0.15;
  const a = goalkeeper.attributes;
  const base = a.posicionamento * 0.35 + a.decisao * 0.30 + a.forca * 0.20 + a.marcacao * 0.15;
  const energyPenalty = goalkeeper.energy < 30 ? 0.85 : goalkeeper.energy < 60 ? 0.93 : 1.0;
  return Math.min(0.85, (base / 140) * energyPenalty);
}

// ─── Ataque completo (agora retorna se chute foi bloqueado para gerar escanteio) ───

export type AttackResult = 'nothing' | 'chance_missed' | 'saved' | 'goal';

export interface AttackContext {
  attackers: Player[];
  defenders: Player[];
  goalkeeper: Player | null;
  midfieldControl: number;
  momentumBonus: number;
  homeAdvantage: number;
  formationAtkMod: number;
  formationDefMod: number;
  specAtkMod: number;
  specDefMod: number;
  rand: () => number;
}

export interface AttackOutcome {
  result: AttackResult;
  shooter: Player | null;
  assister: Player | null;
  /** true se o chute foi direto na defesa (pode gerar escanteio) */
  shotBlocked: boolean;
  /** true se uma chance clara foi criada (pode gerar falta/escanteio) */
  chanceCreated: boolean;
}

export function resolveAttack(ctx: AttackContext): AttackOutcome {
  const { attackers, defenders, goalkeeper, midfieldControl, momentumBonus, homeAdvantage, formationAtkMod, formationDefMod, specAtkMod, specDefMod, rand } = ctx;

  const possessionChance = 0.3 + midfieldControl * 0.4;
  if (rand() > possessionChance) return { result: 'nothing', shooter: null, assister: null, shotBlocked: false, chanceCreated: false };

  let chanceProb = computeChanceCreation(attackers, defenders);
  chanceProb *= formationAtkMod * specAtkMod * homeAdvantage;
  chanceProb /= Math.max(0.5, formationDefMod * specDefMod);
  chanceProb *= (1 + momentumBonus);
  chanceProb = Math.max(0.005, Math.min(0.15, chanceProb));

  if (rand() > chanceProb) return { result: 'nothing', shooter: null, assister: null, shotBlocked: false, chanceCreated: false };

  const shooter = pickWeightedPlayer(attackers, true, rand);
  if (!shooter) return { result: 'chance_missed', shooter: null, assister: null, shotBlocked: false, chanceCreated: true };
  const assister = pickWeightedPlayer(attackers.filter(p => p.id !== shooter.id), false, rand);

  const shotQuality = computeShotQuality(shooter);
  if (rand() > shotQuality) return { result: 'chance_missed', shooter, assister, shotBlocked: rand() < 0.4, chanceCreated: true };

  const saveProb = computeGoalkeeperSave(goalkeeper);
  if (rand() < saveProb) return { result: 'saved', shooter, assister, shotBlocked: false, chanceCreated: true };

  return { result: 'goal', shooter, assister, shotBlocked: false, chanceCreated: true };
}

// ─── Momentum ─────────────────────────────────────────────────────────────────

export function computeMomentum(
  teamScore: number, opponentScore: number, minute: number,
  recentGoalMinute: number | null, recentConcededMinute: number | null,
): number {
  let momentum = 0;
  const deficit = opponentScore - teamScore;
  if (deficit > 0) {
    const timePressure = minute > 70 ? 0.08 : minute > 50 ? 0.04 : 0.02;
    momentum += deficit * timePressure;
  } else if (deficit < 0) {
    momentum -= 0.03 * Math.abs(deficit);
  }
  if (recentGoalMinute !== null && minute - recentGoalMinute <= 5) momentum += 0.08;
  if (recentConcededMinute !== null && minute - recentConcededMinute <= 3) momentum -= 0.06;
  return Math.max(-0.15, Math.min(0.20, momentum));
}

export function getHomeAdvantage(isHome: boolean): number {
  return isHome ? 1.06 : 1.0;
}

// ─── Liderança: boost coletivo ────────────────────────────────────────────────

/**
 * Calcula o boost de liderança do time.
 * O jogador com maior liderança dá um pequeno bônus para todos
 * quando o time está perdendo (motivação nos momentos difíceis).
 */
export function computeLeadershipBoost(players: Player[], deficit: number, minute: number): number {
  if (players.length === 0 || deficit <= 0) return 0;
  const leader = players.reduce((best, p) =>
    p.attributes.lideranca > best.attributes.lideranca ? p : best,
    players[0],
  );
  const leaderFactor = leader.attributes.lideranca / 100;
  const urgency = minute > 70 ? 1.5 : minute > 50 ? 1.2 : 1.0;
  return leaderFactor * 0.03 * urgency * Math.min(deficit, 3);
}

// ═══════════════════════════════════════════════════════════════════════════════
// IA TÁTICA DINÂMICA — Mudanças durante a partida
// ═══════════════════════════════════════════════════════════════════════════════

export type AIStyle = 'ofensivo' | 'defensivo' | 'equilibrado' | 'contra-ataque';

export function getAITacticalStyle(team: Team, players: Player[]): AIStyle {
  const teamPlayers = players.filter(p => p.teamId === team.id && !p.redCard && p.injuryWeeksLeft === 0);
  const avgStr = teamPlayers.length > 0 ? teamPlayers.reduce((s, p) => s + p.strength, 0) / teamPlayers.length : 50;
  const atkCount = teamPlayers.filter(p => p.position === 'A').length;
  const defCount = teamPlayers.filter(p => p.position === 'D').length;

  const nameHash = team.name.split('').reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0);
  const personalitySeed = Math.abs(nameHash) % 100;

  if (team.reputation >= 65 && (atkCount >= 3 || personalitySeed < 30)) return 'ofensivo';
  if (team.reputation <= 35 || (avgStr < 55 && personalitySeed >= 70)) return 'contra-ataque';
  if (defCount >= 7 || personalitySeed >= 60) return 'defensivo';
  return 'equilibrado';
}

export function getAIFormation(style: AIStyle): Formation {
  switch (style) {
    case 'ofensivo':       return Math.random() < 0.6 ? '4-3-3' : '3-5-2';
    case 'defensivo':      return Math.random() < 0.7 ? '5-3-2' : '4-5-1' as Formation;
    case 'contra-ataque':  return Math.random() < 0.5 ? '4-1-4-1' : '5-3-2';
    case 'equilibrado':    return Math.random() < 0.5 ? '4-4-2' : '4-3-3';
  }
}

/**
 * IA muda de formação durante a partida baseada no placar e minuto.
 * Retorna nova formação ou null se não muda.
 */
export function getAIMidMatchFormationChange(
  style: AIStyle,
  currentFormation: Formation,
  teamScore: number,
  oppScore: number,
  minute: number,
  rand: () => number,
): Formation | null {
  const deficit = oppScore - teamScore;

  // Só considera mudança em momentos-chave
  if (minute !== 55 && minute !== 65 && minute !== 75) return null;

  // Probabilidade de mudar (IA não muda sempre)
  if (rand() > 0.60) return null;

  // ── Perdendo por 2+ gols após os 65: qualquer estilo fica desesperado
  if (deficit >= 2 && minute >= 65) {
    if (currentFormation === '4-3-3') return null; // já ofensivo
    return '4-3-3'; // muda para formação ofensiva
  }

  // ── Perdendo por 1 após os 55: time ofensivo avança
  if (deficit === 1 && minute >= 55) {
    if (style === 'ofensivo' || style === 'equilibrado') {
      if (currentFormation !== '4-3-3' && currentFormation !== '3-5-2') {
        return rand() < 0.5 ? '4-3-3' : '3-5-2';
      }
    }
    // Defensivo/contra-ataque: só muda depois dos 70
    if ((style === 'defensivo' || style === 'contra-ataque') && minute >= 70) {
      return '4-4-2'; // sai da retranca
    }
  }

  // ── Ganhando por 2+: recua
  if (deficit <= -2 && minute >= 65) {
    if (style === 'defensivo' || style === 'contra-ataque') {
      if (currentFormation !== '5-3-2') return '5-3-2';
    }
    if (style === 'equilibrado') {
      if (currentFormation !== '4-1-4-1') return '4-1-4-1';
    }
  }

  // ── Ganhando por 1 depois dos 75: protege placar
  if (deficit === -1 && minute >= 75) {
    if (currentFormation !== '5-3-2' && currentFormation !== '4-1-4-1') {
      return style === 'ofensivo' ? '4-4-2' : '5-3-2';
    }
  }

  return null;
}

export function getAIMatchModifiers(
  style: AIStyle, formation: Formation,
  teamScore: number, oppScore: number, minute: number,
): { atkMod: number; defMod: number } {
  const fm = FORMATION_MODIFIERS[formation];
  let atkMod = fm.attack;
  let defMod = fm.defense;
  const deficit = oppScore - teamScore;

  switch (style) {
    case 'ofensivo':
      atkMod *= 1.08; defMod *= 0.95;
      if (deficit > 0 && minute > 60) { atkMod *= 1.12; defMod *= 0.90; }
      if (deficit < 0 && minute > 75) { atkMod *= 0.95; defMod *= 1.05; }
      break;
    case 'defensivo':
      atkMod *= 0.93; defMod *= 1.10;
      if (deficit < 0) { atkMod *= 0.90; defMod *= 1.08; }
      if (deficit > 0 && minute > 70) { atkMod *= 1.10; defMod *= 0.95; }
      break;
    case 'contra-ataque':
      atkMod *= 0.88; defMod *= 1.12;
      if (deficit <= 0) { atkMod *= 0.95; defMod *= 1.05; }
      if (deficit > 0 && minute > 55) { atkMod *= 1.15; }
      break;
    case 'equilibrado':
      if (deficit > 0 && minute > 65) { atkMod *= 1.06; defMod *= 0.97; }
      if (deficit < 0 && minute > 70) { atkMod *= 0.97; defMod *= 1.04; }
      break;
  }
  return { atkMod, defMod };
}

// ─── Substituições IA ─────────────────────────────────────────────────────────

export function getAISubstitutionTarget(
  style: AIStyle, lineup: Player[], bench: Player[],
  teamScore: number, oppScore: number, minute: number, injuredIds: string[],
): { outId: string; preferPosition: Position | null; reason: string } | null {
  if (bench.length === 0) return null;
  const healthy = lineup.filter(p => !injuredIds.includes(p.id) && !p.redCard);
  const deficit = oppScore - teamScore;

  const injured = lineup.find(p => injuredIds.includes(p.id));
  if (injured) return { outId: injured.id, preferPosition: injured.position, reason: 'injury' };

  const exhausted = healthy.filter(p => p.energy < 25).sort((a, b) => a.energy - b.energy)[0];
  if (exhausted && minute > 45) return { outId: exhausted.id, preferPosition: exhausted.position, reason: 'exhausted' };

  const tired = healthy.filter(p => p.energy < 45).sort((a, b) => a.energy - b.energy)[0];
  if (tired && minute > 55) return { outId: tired.id, preferPosition: tired.position, reason: 'tired' };

  if (minute > 60) {
    if (style === 'ofensivo' && deficit > 0) {
      const defToRemove = healthy.filter(p => p.position === 'D').sort((a, b) => a.strength - b.strength)[0];
      if (defToRemove && healthy.filter(p => p.position === 'D').length > 3)
        return { outId: defToRemove.id, preferPosition: 'A', reason: 'tactical_attack' };
    }
    if (style === 'defensivo' && deficit < 0 && minute > 70) {
      const atkToRemove = healthy.filter(p => p.position === 'A').sort((a, b) => a.strength - b.strength)[0];
      if (atkToRemove && healthy.filter(p => p.position === 'A').length > 1)
        return { outId: atkToRemove.id, preferPosition: 'D', reason: 'tactical_defend' };
    }
    if (style === 'contra-ataque' && deficit >= 0 && minute > 65) {
      const midToRemove = healthy.filter(p => p.position === 'M').sort((a, b) => a.energy - b.energy)[0];
      if (midToRemove && healthy.filter(p => p.position === 'M').length > 3)
        return { outId: midToRemove.id, preferPosition: 'D', reason: 'tactical_protect' };
    }
    if (deficit > 0 && minute > 75) {
      const defToRemove = healthy.filter(p => p.position === 'D').sort((a, b) => a.energy - b.energy)[0];
      if (defToRemove && healthy.filter(p => p.position === 'D').length > 3)
        return { outId: defToRemove.id, preferPosition: deficit >= 2 ? 'A' : 'M', reason: 'desperate_attack' };
    }
  }
  return null;
}

export function findBestSubIn(bench: Player[], preferPosition: Position | null, outPosition: Position): Player | null {
  if (bench.length === 0) return null;
  if (preferPosition) {
    const preferred = bench.filter(p => p.position === preferPosition).sort((a, b) => b.strength - a.strength)[0];
    if (preferred) return preferred;
  }
  const samePos = bench.filter(p => p.position === outPosition).sort((a, b) => b.strength - a.strength)[0];
  if (samePos) return samePos;
  const nonGK = bench.filter(p => p.position !== 'G').sort((a, b) => b.strength - a.strength)[0];
  return nonGK ?? bench[0];
}

// ─── Seleção ponderada ────────────────────────────────────────────────────────

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

// ═══════════════════════════════════════════════════════════════════════════════
// PROGRESSÃO POR TEMPO DE JOGO
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Fator de progressão baseado em minutos jogados na temporada.
 * Jogadores que jogam regularmente evoluem mais rápido.
 *
 * - 0 minutos: 0.3× (treina mas não joga)
 * - ~500 min (~6 jogos): 0.7×
 * - ~900 min (~10 jogos): 1.0× (baseline)
 * - ~1400 min (~16 jogos): 1.3× (titular indiscutível)
 * - 1620 min (todos): 1.4× (teto)
 */
export function getMinutesPlayedFactor(minutesPlayed: number): number {
  const maxMinutes = 18 * 90; // 1620
  const ratio = Math.min(1, minutesPlayed / maxMinutes);
  // Curva sigmoide suave
  return 0.3 + ratio * 1.1; // range: 0.3 a 1.4
}

// ─── Progressão por idade (atualizado com cabeceio) ──────────────────────────

const PHYSICAL_ATTRS: (keyof PlayerAttributes)[] = ['velocidade', 'stamina', 'forca'];
const MENTAL_ATTRS: (keyof PlayerAttributes)[] = ['decisao', 'posicionamento', 'lideranca', 'disciplina'];
const TECHNICAL_ATTRS: (keyof PlayerAttributes)[] = ['passe', 'chute', 'drible', 'cruzamento', 'cabeceio'];

export function applyAgeProgression(player: Player): { attributes: PlayerAttributes; strength: number; potential: number } {
  const attrs = { ...player.attributes };
  let pot = player.potential;
  const age = player.age;
  const minutesFactor = getMinutesPlayedFactor(player.minutesPlayed ?? 0);

  const roll = () => Math.random();
  const clamp = (v: number) => Math.max(1, Math.min(99, v));

  if (age <= 21) {
    for (const k of PHYSICAL_ATTRS) {
      if (roll() < 0.35 * minutesFactor && attrs[k] < pot) attrs[k] = clamp(attrs[k] + 1);
    }
    for (const k of TECHNICAL_ATTRS) {
      if (roll() < 0.25 * minutesFactor && attrs[k] < pot) attrs[k] = clamp(attrs[k] + 1);
    }
    for (const k of MENTAL_ATTRS) {
      if (roll() < 0.20 * minutesFactor && attrs[k] < pot) attrs[k] = clamp(attrs[k] + 1);
    }
    if (roll() < 0.08 * minutesFactor && pot < 99) pot = Math.min(99, pot + 1);
  } else if (age <= 27) {
    for (const k of PHYSICAL_ATTRS) {
      if (roll() < 0.08 * minutesFactor && attrs[k] < pot) attrs[k] = clamp(attrs[k] + 1);
    }
    for (const k of TECHNICAL_ATTRS) {
      if (roll() < 0.10 * minutesFactor && attrs[k] < pot) attrs[k] = clamp(attrs[k] + 1);
    }
    for (const k of MENTAL_ATTRS) {
      if (roll() < 0.18 * minutesFactor && attrs[k] < pot) attrs[k] = clamp(attrs[k] + 1);
    }
  } else if (age <= 29) {
    for (const k of MENTAL_ATTRS) {
      if (roll() < 0.12 * minutesFactor && attrs[k] < pot) attrs[k] = clamp(attrs[k] + 1);
    }
    for (const k of PHYSICAL_ATTRS) {
      if (roll() < 0.08) attrs[k] = clamp(attrs[k] - 1);
    }
  } else if (age <= 33) {
    const severity = age <= 31 ? 0.12 : 0.22;
    for (const k of PHYSICAL_ATTRS) {
      if (roll() < severity) {
        const loss = age >= 32 && roll() < 0.3 ? 2 : 1;
        attrs[k] = clamp(attrs[k] - loss);
      }
    }
    for (const k of TECHNICAL_ATTRS) {
      if (roll() < 0.08) attrs[k] = clamp(attrs[k] - 1);
    }
    for (const k of MENTAL_ATTRS) {
      if (roll() < 0.08 && attrs[k] < pot) attrs[k] = clamp(attrs[k] + 1);
    }
  } else {
    const severity = age <= 36 ? 0.35 : 0.50;
    for (const k of PHYSICAL_ATTRS) {
      if (roll() < severity) {
        const loss = roll() < 0.4 ? 2 : 1;
        attrs[k] = clamp(attrs[k] - loss);
      }
    }
    for (const k of TECHNICAL_ATTRS) {
      if (roll() < 0.20) attrs[k] = clamp(attrs[k] - 1);
    }
    for (const k of MENTAL_ATTRS) {
      if (roll() < 0.05) attrs[k] = clamp(attrs[k] - 1);
    }
  }

  const strength = computeOverall(attrs, player.position);
  return { attributes: attrs, strength, potential: pot };
}

// ─── Treino ───────────────────────────────────────────────────────────────────

export interface TrainingResult {
  trainingProgress: number;
  attributes: PlayerAttributes | null;
  strength: number | null;
  potential: number | null;
  outcome: 'progress' | 'improved' | 'breakthrough' | 'failed' | 'at_cap';
}

export function getTrainingSpeedFactor(age: number): number {
  if (age <= 19) return 1.6;
  if (age <= 21) return 1.4;
  if (age <= 25) return 1.15;
  if (age <= 29) return 1.0;
  if (age <= 32) return 0.75;
  if (age <= 35) return 0.55;
  return 0.35;
}

export function processTraining(
  player: Player, baseProgress: number, targetAttr?: keyof PlayerAttributes,
): TrainingResult {
  const ageFactor = getTrainingSpeedFactor(player.age);
  const adjustedProgress = Math.round(baseProgress * ageFactor);
  const newProgress = player.trainingProgress + adjustedProgress;

  if (newProgress < 100) {
    return { trainingProgress: newProgress, attributes: null, strength: null, potential: null, outcome: 'progress' };
  }

  const remainder = newProgress - 100;
  const primaries = PRIMARY_ATTRS[player.position];

  const target = targetAttr ?? primaries.reduce(
    (w, k) => player.attributes[k] < player.attributes[w] ? k : w,
    primaries[0],
  );

  if (player.attributes[target] >= player.potential) {
    return { trainingProgress: remainder, attributes: null, strength: null, potential: null, outcome: 'at_cap' };
  }

  const roll = Math.random();
  const attrs = { ...player.attributes };
  let pot = player.potential;

  if (roll < 0.05 && player.age <= 25) {
    attrs[target] = Math.min(pot, attrs[target] + 2);
    if (player.age <= 21 && Math.random() < 0.15 && pot < 99) pot = Math.min(99, pot + 1);
    const strength = computeOverall(attrs, player.position);
    return { trainingProgress: remainder, attributes: attrs, strength, potential: pot, outcome: 'breakthrough' };
  }

  if (roll < 0.72) {
    attrs[target] = Math.min(pot, attrs[target] + 1);
    const strength = computeOverall(attrs, player.position);
    return { trainingProgress: remainder, attributes: attrs, strength, potential: null, outcome: 'improved' };
  }

  if (roll < 0.87) {
    const randomPrimary = primaries[Math.floor(Math.random() * primaries.length)];
    if (attrs[randomPrimary] < pot) {
      attrs[randomPrimary] = Math.min(pot, attrs[randomPrimary] + 1);
      const strength = computeOverall(attrs, player.position);
      return { trainingProgress: remainder, attributes: attrs, strength, potential: null, outcome: 'improved' };
    }
    return { trainingProgress: remainder, attributes: null, strength: null, potential: null, outcome: 'failed' };
  }

  return { trainingProgress: remainder, attributes: null, strength: null, potential: null, outcome: 'failed' };
}

// ─── Forma ────────────────────────────────────────────────────────────────────

export function computeFormDelta(
  player: Player, played: boolean, teamWon: boolean, teamDrew: boolean, teamLost: boolean,
  goalsScored: number, assistsMade: number, gotRedCard: boolean, gotInjured: boolean, cleanSheet: boolean,
): number {
  let delta = 0;
  if (played) {
    if (teamWon) delta += 0.5;
    else if (teamDrew) delta += 0.1;
    else if (teamLost) delta -= 0.5;
  } else {
    if (teamWon) delta += 0.2;
    else if (teamLost) delta -= 0.1;
  }
  if (played) {
    delta += goalsScored * 1.0;
    delta += assistsMade * 0.5;
    if (cleanSheet && (player.position === 'G' || player.position === 'D')) delta += 0.5;
    if (gotRedCard) delta -= 2.0;
    if (gotInjured) delta -= 1.0;
  }
  return delta;
}

// ─── XG legado ────────────────────────────────────────────────────────────────

export function computeAttackXG(players: Player[]): number {
  const fielders = players.filter(p => p.position !== 'G');
  if (fielders.length === 0) return 50;
  const total = fielders.reduce((s, p) => {
    const a = p.attributes;
    if (p.position === 'A') return s + a.chute * 0.45 + a.drible * 0.30 + a.velocidade * 0.15 + a.decisao * 0.10;
    if (p.position === 'M') return s + a.passe * 0.40 + a.chute * 0.25 + a.decisao * 0.20 + a.drible * 0.15;
    if (p.position === 'D') return s + a.cruzamento * 0.40 + a.forca * 0.35 + a.passe * 0.25;
    return s + 50;
  }, 0);
  return total / fielders.length;
}

export function computeDefenseXG(players: Player[]): number {
  const defenders = players.filter(p => p.position !== 'A');
  if (defenders.length === 0) return 50;
  const total = defenders.reduce((s, p) => {
    const a = p.attributes;
    if (p.position === 'G') return s + a.posicionamento * 0.40 + a.decisao * 0.35 + a.forca * 0.25;
    if (p.position === 'D') return s + a.marcacao * 0.45 + a.forca * 0.30 + a.velocidade * 0.25;
    if (p.position === 'M') return s + a.marcacao * 0.35 + a.decisao * 0.35 + a.posicionamento * 0.30;
    return s + 50;
  }, 0);
  return total / defenders.length;
}