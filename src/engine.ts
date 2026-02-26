import { Player, PlayerAttributes, Position, PRIMARY_ATTRS, Formation, FORMATIONS, FORMATION_MODIFIERS, Team } from './types';

// ─── Overall ponderado ────────────────────────────────────────────────────────
// Atributos mais altos da posição têm peso maior (evita nivelamento por média simples)
const PRIMARY_WEIGHTS: Record<Position, number[]> = {
  G: [1.3, 1.2, 1.0, 0.8, 0.7],  // posicionamento > decisao > marcacao > forca > disciplina
  D: [1.3, 1.2, 1.0, 0.8, 0.7],  // marcacao > forca > posicionamento > velocidade > decisao
  M: [1.3, 1.1, 1.0, 0.9, 0.7],  // passe > decisao > stamina > drible > posicionamento
  A: [1.4, 1.2, 1.0, 0.8, 0.6],  // chute > drible > velocidade > posicionamento > decisao
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

/**
 * Força efetiva em jogo.
 * moraleMultiplier = 2.0 para especialização "motivador".
 */
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

// ─── Fases de Jogo (novo sistema) ────────────────────────────────────────────

/**
 * FASE 1 — Posse / Build-up
 * Meio-campo decide quem controla a bola.
 * Retorna um score 0-1 representando domínio do time atacante.
 */
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
  // Retorna 0-1 onde >0.5 = atacante domina
  return atkScore / Math.max(1, atkScore + defScore);
}

/**
 * FASE 2 — Criação de chance
 * Atacantes + meias tentam criar oportunidade contra a defesa.
 * Retorna probabilidade base de chance clara (0-1).
 */
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

  // Diferença normalizada → probabilidade
  const ratio = atkScore / Math.max(1, atkScore + defScore);
  return 0.01 + ratio * 0.04; // range: ~0.01 a ~0.05 por tick
}

/**
 * FASE 3 — Finalização
 * Dado que uma chance foi criada, qual a probabilidade do chute ser no gol?
 */
export function computeShotQuality(shooter: Player): number {
  const a = shooter.attributes;
  const base = a.chute * 0.50 + a.decisao * 0.25 + a.posicionamento * 0.15 + a.forca * 0.10;
  // Normaliza pra 0-1 (base máxima ~99)
  return Math.min(1, base / 120);
}

/**
 * FASE 4 — Defesa do Goleiro
 * Probabilidade do goleiro fazer a defesa dado um chute no gol.
 * Quanto maior, mais difícil marcar.
 */
export function computeGoalkeeperSave(goalkeeper: Player | null): number {
  if (!goalkeeper || goalkeeper.position !== 'G') return 0.15; // sem goleiro = 15% de chance de defesa
  const a = goalkeeper.attributes;
  const base = a.posicionamento * 0.35 + a.decisao * 0.30 + a.forca * 0.20 + a.marcacao * 0.15;
  // Normaliza: GK com 80+ em tudo = ~65% de defesa; GK com 40 = ~30%
  const energyPenalty = goalkeeper.energy < 30 ? 0.85 : goalkeeper.energy < 60 ? 0.93 : 1.0;
  return Math.min(0.85, (base / 140) * energyPenalty);
}

/**
 * FASE COMPLETA — Resolução de um ataque
 * Encadeia: posse → chance → finalização → defesa GK
 * Retorna: 'nothing' | 'chance_missed' | 'saved' | 'goal'
 */
export type AttackResult = 'nothing' | 'chance_missed' | 'saved' | 'goal';

export interface AttackContext {
  attackers: Player[];
  defenders: Player[];
  goalkeeper: Player | null;
  midfieldControl: number;  // pré-calculado
  momentumBonus: number;    // -0.2 a +0.2
  homeAdvantage: number;    // 1.0 ou 1.05-1.08
  formationAtkMod: number;  // multiplicador da formação
  formationDefMod: number;
  specAtkMod: number;       // multiplicador de especialização
  specDefMod: number;
  rand: () => number;
}

export function resolveAttack(ctx: AttackContext): {
  result: AttackResult;
  shooter: Player | null;
  assister: Player | null;
} {
  const { attackers, defenders, goalkeeper, midfieldControl, momentumBonus, homeAdvantage, formationAtkMod, formationDefMod, specAtkMod, specDefMod, rand } = ctx;

  // Fase 1: Posse (já calculada como midfieldControl)
  // Se o meio-campo não domina, menor chance de avançar
  const possessionChance = 0.3 + midfieldControl * 0.4; // 30-70%
  if (rand() > possessionChance) return { result: 'nothing', shooter: null, assister: null };

  // Fase 2: Criação de chance
  let chanceProb = computeChanceCreation(attackers, defenders);
  chanceProb *= formationAtkMod * specAtkMod * homeAdvantage;
  chanceProb /= Math.max(0.5, formationDefMod * specDefMod);
  chanceProb *= (1 + momentumBonus);
  chanceProb = Math.max(0.005, Math.min(0.15, chanceProb));

  if (rand() > chanceProb) return { result: 'nothing', shooter: null, assister: null };

  // Chance criada! Escolhe finalizador e assistente
  const shooter = pickWeightedPlayer(attackers, true, rand);
  if (!shooter) return { result: 'chance_missed', shooter: null, assister: null };
  const assister = pickWeightedPlayer(attackers.filter(p => p.id !== shooter.id), false, rand);

  // Fase 3: Qualidade do chute
  const shotQuality = computeShotQuality(shooter);
  // Chute fora do gol
  if (rand() > shotQuality) return { result: 'chance_missed', shooter, assister };

  // Fase 4: Defesa do goleiro
  const saveProb = computeGoalkeeperSave(goalkeeper);
  if (rand() < saveProb) return { result: 'saved', shooter, assister };

  // GOL!
  return { result: 'goal', shooter, assister };
}

// ─── Momentum ─────────────────────────────────────────────────────────────────

/**
 * Calcula bônus de momentum baseado no placar e minuto.
 * Time perdendo ganha urgência; time ganhando recua.
 * Retorna valor entre -0.15 e +0.20
 */
export function computeMomentum(
  teamScore: number,
  opponentScore: number,
  minute: number,
  recentGoalMinute: number | null,  // último gol desse time
  recentConcededMinute: number | null,  // último gol sofrido
): number {
  let momentum = 0;

  // Urgência: time perdendo pressiona mais, especialmente no final
  const deficit = opponentScore - teamScore;
  if (deficit > 0) {
    const timePressure = minute > 70 ? 0.08 : minute > 50 ? 0.04 : 0.02;
    momentum += deficit * timePressure;
  } else if (deficit < 0) {
    // Time ganhando recua levemente
    momentum -= 0.03 * Math.abs(deficit);
  }

  // Boost pós-gol (moral alta por ~5 minutos)
  if (recentGoalMinute !== null && minute - recentGoalMinute <= 5) {
    momentum += 0.08;
  }

  // Abalo pós-gol sofrido (queda por ~3 minutos)
  if (recentConcededMinute !== null && minute - recentConcededMinute <= 3) {
    momentum -= 0.06;
  }

  return Math.max(-0.15, Math.min(0.20, momentum));
}

/**
 * Home advantage multiplier.
 * Mandante tem leve vantagem (~5-8%) simulando torcida, familiaridade, etc.
 */
export function getHomeAdvantage(isHome: boolean): number {
  return isHome ? 1.06 : 1.0;
}

// ─── XG legado (mantido para compatibilidade com standings/cups) ──────────────

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

// ─── Sistema de Progressão por Idade ──────────────────────────────────────────

/** Atributos físicos que declinam com idade */
const PHYSICAL_ATTRS: (keyof PlayerAttributes)[] = ['velocidade', 'stamina', 'forca'];
/** Atributos mentais que podem melhorar com experiência */
const MENTAL_ATTRS: (keyof PlayerAttributes)[] = ['decisao', 'posicionamento', 'lideranca', 'disciplina'];
/** Atributos técnicos — estáveis mais tempo, declinam tarde */
const TECHNICAL_ATTRS: (keyof PlayerAttributes)[] = ['passe', 'chute', 'drible', 'cruzamento'];

/**
 * Aplica regressão/progressão por idade a um jogador.
 * Chamado uma vez por temporada no processEndOfSeason.
 *
 * Curva de desenvolvimento:
 * - 16-21: Crescimento rápido (físicos e técnicos podem subir)
 * - 22-27: Pico / estável
 * - 28-29: Mentais ainda crescem, físicos começam a platear
 * - 30-33: Declínio físico gradual, mentais no auge
 * - 34+: Declínio geral
 *
 * Retorna novo objeto de atributos e novo overall.
 */
export function applyAgeProgression(player: Player): { attributes: PlayerAttributes; strength: number; potential: number } {
  const attrs = { ...player.attributes };
  let pot = player.potential;
  const age = player.age; // já incrementado antes de chamar esta função

  const roll = () => Math.random();
  const clamp = (v: number) => Math.max(1, Math.min(99, v));

  // ── Crescimento jovem (16-21) ──
  if (age <= 21) {
    // Físicos: boa chance de crescer naturalmente
    for (const k of PHYSICAL_ATTRS) {
      if (roll() < 0.35 && attrs[k] < pot) {
        attrs[k] = clamp(attrs[k] + 1);
      }
    }
    // Técnicos: chance moderada
    for (const k of TECHNICAL_ATTRS) {
      if (roll() < 0.25 && attrs[k] < pot) {
        attrs[k] = clamp(attrs[k] + 1);
      }
    }
    // Mentais: crescem com experiência de jogo
    for (const k of MENTAL_ATTRS) {
      if (roll() < 0.20 && attrs[k] < pot) {
        attrs[k] = clamp(attrs[k] + 1);
      }
    }
    // Potencial pode crescer para jovens promissores
    if (roll() < 0.08 && pot < 99) {
      pot = Math.min(99, pot + 1);
    }
  }

  // ── Desenvolvimento médio (22-27) ──
  else if (age <= 27) {
    // Físicos: estáveis, rara melhora
    for (const k of PHYSICAL_ATTRS) {
      if (roll() < 0.08 && attrs[k] < pot) {
        attrs[k] = clamp(attrs[k] + 1);
      }
    }
    // Técnicos: ainda podem melhorar levemente
    for (const k of TECHNICAL_ATTRS) {
      if (roll() < 0.10 && attrs[k] < pot) {
        attrs[k] = clamp(attrs[k] + 1);
      }
    }
    // Mentais: crescimento pela experiência
    for (const k of MENTAL_ATTRS) {
      if (roll() < 0.18 && attrs[k] < pot) {
        attrs[k] = clamp(attrs[k] + 1);
      }
    }
  }

  // ── Início do declínio (28-29) ──
  else if (age <= 29) {
    // Mentais ainda crescem
    for (const k of MENTAL_ATTRS) {
      if (roll() < 0.12 && attrs[k] < pot) {
        attrs[k] = clamp(attrs[k] + 1);
      }
    }
    // Físicos: chance pequena de declínio
    for (const k of PHYSICAL_ATTRS) {
      if (roll() < 0.08) {
        attrs[k] = clamp(attrs[k] - 1);
      }
    }
  }

  // ── Declínio gradual (30-33) ──
  else if (age <= 33) {
    const severity = age <= 31 ? 0.12 : 0.22;
    for (const k of PHYSICAL_ATTRS) {
      if (roll() < severity) {
        const loss = age >= 32 && roll() < 0.3 ? 2 : 1;
        attrs[k] = clamp(attrs[k] - loss);
      }
    }
    // Técnicos começam a sofrer leve queda
    for (const k of TECHNICAL_ATTRS) {
      if (roll() < 0.08) {
        attrs[k] = clamp(attrs[k] - 1);
      }
    }
    // Mentais: auge, última chance de crescer
    for (const k of MENTAL_ATTRS) {
      if (roll() < 0.08 && attrs[k] < pot) {
        attrs[k] = clamp(attrs[k] + 1);
      }
    }
  }

  // ── Declínio acentuado (34+) ──
  else {
    const severity = age <= 36 ? 0.35 : 0.50;
    for (const k of PHYSICAL_ATTRS) {
      if (roll() < severity) {
        const loss = roll() < 0.4 ? 2 : 1;
        attrs[k] = clamp(attrs[k] - loss);
      }
    }
    for (const k of TECHNICAL_ATTRS) {
      if (roll() < 0.20) {
        attrs[k] = clamp(attrs[k] - 1);
      }
    }
    // Mentais estabilizam
    for (const k of MENTAL_ATTRS) {
      if (roll() < 0.05) {
        attrs[k] = clamp(attrs[k] - 1);
      }
    }
  }

  const strength = computeOverall(attrs, player.position);
  return { attributes: attrs, strength, potential: pot };
}

// ─── Treino com Variância ─────────────────────────────────────────────────────

export interface TrainingResult {
  /** Novo progresso acumulado (pode restar se passou de 100) */
  trainingProgress: number;
  /** Atributos atualizados (ou null se nada mudou) */
  attributes: PlayerAttributes | null;
  /** Novo overall (ou null se não mudou) */
  strength: number | null;
  /** Novo potencial (ou null se não mudou) */
  potential: number | null;
  /** Tipo de resultado para feedback visual */
  outcome: 'progress' | 'improved' | 'breakthrough' | 'failed' | 'at_cap';
}

/**
 * Fator de velocidade de treino baseado na idade.
 * Jovens treinam muito mais rápido que veteranos.
 */
export function getTrainingSpeedFactor(age: number): number {
  if (age <= 19) return 1.6;
  if (age <= 21) return 1.4;
  if (age <= 25) return 1.15;
  if (age <= 29) return 1.0;
  if (age <= 32) return 0.75;
  if (age <= 35) return 0.55;
  return 0.35;
}

/**
 * Processa uma sessão de treino com variância.
 *
 * @param player - Jogador sendo treinado
 * @param baseProgress - Progresso base (25 normal, 50 para especialização desenvolvedor)
 * @param targetAttr - Atributo alvo (opcional, senão usa o mais fraco)
 */
export function processTraining(
  player: Player,
  baseProgress: number,
  targetAttr?: keyof PlayerAttributes,
): TrainingResult {
  const ageFactor = getTrainingSpeedFactor(player.age);
  const adjustedProgress = Math.round(baseProgress * ageFactor);
  const newProgress = player.trainingProgress + adjustedProgress;

  // Ainda não completou 100%
  if (newProgress < 100) {
    return {
      trainingProgress: newProgress,
      attributes: null,
      strength: null,
      potential: null,
      outcome: 'progress',
    };
  }

  // Completou ciclo de treino — resolve resultado
  const remainder = newProgress - 100;
  const primaries = PRIMARY_ATTRS[player.position];

  // Determina atributo alvo
  const target = targetAttr ?? primaries.reduce(
    (w, k) => player.attributes[k] < player.attributes[w] ? k : w,
    primaries[0],
  );

  // Check: já no cap
  if (player.attributes[target] >= player.potential) {
    return {
      trainingProgress: remainder,
      attributes: null,
      strength: null,
      potential: null,
      outcome: 'at_cap',
    };
  }

  const roll = Math.random();
  const attrs = { ...player.attributes };
  let pot = player.potential;

  // ── Resultado do treino (com variância) ──
  if (roll < 0.05 && player.age <= 25) {
    // 5% — BREAKTHROUGH: +2 no atributo alvo (só jovens ≤25)
    attrs[target] = Math.min(pot, attrs[target] + 2);

    // Jovens <21 podem ter o potencial aumentado em breakthrough
    if (player.age <= 21 && Math.random() < 0.15 && pot < 99) {
      pot = Math.min(99, pot + 1);
    }

    const strength = computeOverall(attrs, player.position);
    return { trainingProgress: remainder, attributes: attrs, strength, potential: pot, outcome: 'breakthrough' };
  }

  if (roll < 0.72) {
    // 67% — Normal: +1 no atributo alvo
    attrs[target] = Math.min(pot, attrs[target] + 1);
    const strength = computeOverall(attrs, player.position);
    return { trainingProgress: remainder, attributes: attrs, strength, potential: null, outcome: 'improved' };
  }

  if (roll < 0.87) {
    // 15% — Treino desviou: +1 em um primário aleatório
    const randomPrimary = primaries[Math.floor(Math.random() * primaries.length)];
    if (attrs[randomPrimary] < pot) {
      attrs[randomPrimary] = Math.min(pot, attrs[randomPrimary] + 1);
      const strength = computeOverall(attrs, player.position);
      return { trainingProgress: remainder, attributes: attrs, strength, potential: null, outcome: 'improved' };
    }
    // Se o aleatório também está no cap, falha
    return { trainingProgress: remainder, attributes: null, strength: null, potential: null, outcome: 'failed' };
  }

  // 13% — Falha: nenhuma melhora (treino não rendeu)
  return { trainingProgress: remainder, attributes: null, strength: null, potential: null, outcome: 'failed' };
}

// ─── Forma baseada em Performance ─────────────────────────────────────────────

/**
 * Calcula o delta de forma de um jogador baseado na performance individual,
 * não apenas no resultado do time.
 *
 * @returns delta de formStreak (pode ser fracionário, arredondado no fim)
 */
export function computeFormDelta(
  player: Player,
  played: boolean,
  teamWon: boolean,
  teamDrew: boolean,
  teamLost: boolean,
  goalsScored: number,
  assistsMade: number,
  gotRedCard: boolean,
  gotInjured: boolean,
  cleanSheet: boolean,  // time não levou gol
): number {
  let delta = 0;

  // Base do resultado do time (menor peso que antes)
  if (played) {
    if (teamWon) delta += 0.5;
    else if (teamDrew) delta += 0.1;
    else if (teamLost) delta -= 0.5;
  } else {
    // Banco: efeito menor
    if (teamWon) delta += 0.2;
    else if (teamLost) delta -= 0.1;
  }

  // Performance individual (peso maior)
  if (played) {
    delta += goalsScored * 1.0;
    delta += assistsMade * 0.5;

    // Clean sheet para goleiros e defensores
    if (cleanSheet && (player.position === 'G' || player.position === 'D')) {
      delta += 0.5;
    }

    // Penalidades
    if (gotRedCard) delta -= 2.0;
    if (gotInjured) delta -= 1.0;
  }

  return delta;
}

// ─── Sistema de IA Tática ─────────────────────────────────────────────────────

export type AIStyle = 'ofensivo' | 'defensivo' | 'equilibrado' | 'contra-ataque';

/**
 * Determina o estilo tático de um time da IA baseado em reputação,
 * composição do elenco e liga.
 *
 * Times de alta reputação tendem a ser ofensivos.
 * Times de baixa reputação tendem a jogar no contra-ataque.
 * Times medianos são equilibrados ou defensivos.
 */
export function getAITacticalStyle(team: Team, players: Player[]): AIStyle {
  const teamPlayers = players.filter(p => p.teamId === team.id && !p.redCard && p.injuryWeeksLeft === 0);
  const avgStr = teamPlayers.length > 0 ? teamPlayers.reduce((s, p) => s + p.strength, 0) / teamPlayers.length : 50;
  const atkCount = teamPlayers.filter(p => p.position === 'A').length;
  const defCount = teamPlayers.filter(p => p.position === 'D').length;

  // Hash determinístico do nome do time para consistência entre partidas
  const nameHash = team.name.split('').reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0);
  const personalitySeed = Math.abs(nameHash) % 100;

  // Alta reputação + muitos atacantes → ofensivo
  if (team.reputation >= 65 && (atkCount >= 3 || personalitySeed < 30)) return 'ofensivo';
  // Baixa reputação → contra-ataque (retranca e saída rápida)
  if (team.reputation <= 35 || (avgStr < 55 && personalitySeed >= 70)) return 'contra-ataque';
  // Time defensivo por natureza (muitos zagueiros ou seed defensivo)
  if (defCount >= 7 || personalitySeed >= 60) return 'defensivo';
  // Default
  return 'equilibrado';
}

/**
 * Escolhe a formação baseada no estilo tático da IA.
 */
export function getAIFormation(style: AIStyle): Formation {
  switch (style) {
    case 'ofensivo':       return Math.random() < 0.6 ? '4-3-3' : '3-5-2';
    case 'defensivo':      return Math.random() < 0.7 ? '5-3-2' : '4-5-1';
    case 'contra-ataque':  return Math.random() < 0.5 ? '4-5-1' : '5-3-2';
    case 'equilibrado':    return Math.random() < 0.5 ? '4-4-2' : '4-3-3';
  }
}

/**
 * Modificadores dinâmicos de ataque/defesa da IA baseados no estilo,
 * placar e minuto do jogo.
 *
 * Times ofensivos atacam mais quando perdendo.
 * Times defensivos recuam quando ganhando.
 * Contra-ataque tem defesa alta e ataque explosivo em transições.
 */
export function getAIMatchModifiers(
  style: AIStyle,
  formation: Formation,
  teamScore: number,
  oppScore: number,
  minute: number,
): { atkMod: number; defMod: number } {
  const fm = FORMATION_MODIFIERS[formation];
  let atkMod = fm.attack;
  let defMod = fm.defense;
  const deficit = oppScore - teamScore;

  switch (style) {
    case 'ofensivo':
      atkMod *= 1.08; // Sempre pressiona um pouco
      defMod *= 0.95;
      if (deficit > 0 && minute > 60) { atkMod *= 1.12; defMod *= 0.90; }  // Desespero ofensivo
      if (deficit < 0 && minute > 75) { atkMod *= 0.95; defMod *= 1.05; }  // Protege placar no final
      break;

    case 'defensivo':
      atkMod *= 0.93;
      defMod *= 1.10;
      if (deficit < 0) { atkMod *= 0.90; defMod *= 1.08; }  // Trinco total quando na frente
      if (deficit > 0 && minute > 70) { atkMod *= 1.10; defMod *= 0.95; }  // Arrisca um pouco no final
      break;

    case 'contra-ataque':
      atkMod *= 0.88;  // Pouca pressão no geral
      defMod *= 1.12;
      if (deficit <= 0) { atkMod *= 0.95; defMod *= 1.05; }  // Resultado bom → retranca total
      if (deficit > 0 && minute > 55) { atkMod *= 1.15; }     // Obrigado a sair → perde identidade
      break;

    case 'equilibrado':
      // Usa os modificadores da formação sem alteração drástica
      if (deficit > 0 && minute > 65) { atkMod *= 1.06; defMod *= 0.97; }
      if (deficit < 0 && minute > 70) { atkMod *= 0.97; defMod *= 1.04; }
      break;
  }

  return { atkMod, defMod };
}

/**
 * Lógica de substituição inteligente da IA baseada no estilo.
 *
 * Retorna null se não deve fazer sub, ou {outId, reason} se deve.
 */
export function getAISubstitutionTarget(
  style: AIStyle,
  lineup: Player[],
  bench: Player[],
  teamScore: number,
  oppScore: number,
  minute: number,
  injuredIds: string[],
): { outId: string; preferPosition: Position | null; reason: string } | null {
  if (bench.length === 0) return null;
  const healthy = lineup.filter(p => !injuredIds.includes(p.id) && !p.redCard);
  const deficit = oppScore - teamScore;

  // 1. PRIORIDADE: lesionados
  const injured = lineup.find(p => injuredIds.includes(p.id));
  if (injured) return { outId: injured.id, preferPosition: injured.position, reason: 'injury' };

  // 2. Cansaço extremo
  const exhausted = healthy.filter(p => p.energy < 25).sort((a, b) => a.energy - b.energy)[0];
  if (exhausted && minute > 45) return { outId: exhausted.id, preferPosition: exhausted.position, reason: 'exhausted' };

  // 3. Cansaço moderado (depois do min 55)
  const tired = healthy.filter(p => p.energy < 45).sort((a, b) => a.energy - b.energy)[0];
  if (tired && minute > 55) return { outId: tired.id, preferPosition: tired.position, reason: 'tired' };

  // 4. Sub tática por estilo e placar
  if (minute > 60) {
    if (style === 'ofensivo' && deficit > 0) {
      // Time ofensivo perdendo: troca defensor por atacante
      const defToRemove = healthy.filter(p => p.position === 'D').sort((a, b) => a.strength - b.strength)[0];
      if (defToRemove && healthy.filter(p => p.position === 'D').length > 3) {
        return { outId: defToRemove.id, preferPosition: 'A', reason: 'tactical_attack' };
      }
    }

    if (style === 'defensivo' && deficit < 0 && minute > 70) {
      // Time defensivo ganhando: troca atacante por defensor
      const atkToRemove = healthy.filter(p => p.position === 'A').sort((a, b) => a.strength - b.strength)[0];
      if (atkToRemove && healthy.filter(p => p.position === 'A').length > 1) {
        return { outId: atkToRemove.id, preferPosition: 'D', reason: 'tactical_defend' };
      }
    }

    if (style === 'contra-ataque' && deficit >= 0 && minute > 65) {
      // Contra-ataque com resultado bom: entra mais um zagueiro/volante
      const midToRemove = healthy.filter(p => p.position === 'M').sort((a, b) => a.energy - b.energy)[0];
      if (midToRemove && healthy.filter(p => p.position === 'M').length > 3) {
        return { outId: midToRemove.id, preferPosition: 'D', reason: 'tactical_protect' };
      }
    }

    // Qualquer estilo perdendo no final: troca defensor por atacante/meia
    if (deficit > 0 && minute > 75) {
      const defToRemove = healthy.filter(p => p.position === 'D').sort((a, b) => a.energy - b.energy)[0];
      if (defToRemove && healthy.filter(p => p.position === 'D').length > 3) {
        return { outId: defToRemove.id, preferPosition: deficit >= 2 ? 'A' : 'M', reason: 'desperate_attack' };
      }
    }
  }

  return null;
}

/**
 * Encontra o melhor reserva para entrar na substituição da IA.
 * Prioriza posição desejada, depois a posição do que saiu, depois o mais forte.
 */
export function findBestSubIn(
  bench: Player[],
  preferPosition: Position | null,
  outPosition: Position,
): Player | null {
  if (bench.length === 0) return null;

  // 1. Posição preferida (tática)
  if (preferPosition) {
    const preferred = bench.filter(p => p.position === preferPosition).sort((a, b) => b.strength - a.strength)[0];
    if (preferred) return preferred;
  }

  // 2. Mesma posição do que saiu
  const samePos = bench.filter(p => p.position === outPosition).sort((a, b) => b.strength - a.strength)[0];
  if (samePos) return samePos;

  // 3. O mais forte disponível (exceto goleiro, a não ser que precise)
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