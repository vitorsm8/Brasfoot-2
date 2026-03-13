import {
  GameState, Player, Team, Match, Formation, MatchReport,
  StaffRole, Specialization, FORMATIONS, TOTAL_SEASON_ROUNDS,
  TRANSFER_WINDOW_ROUNDS, CupRound, CUP_UNLOCK_AFTER,
  SeasonSummary, SeasonRecord, Objective,
  ACADEMY_INFO, STAFF_INFO,   // ← STAFF_INFO adicionado aqui (era require() antes)
} from './types';
import {
  computeOverall, getBestLineup, getEffectiveStrength,
  processTraining, applyAgeProgression, computeFormDelta,
  computeAttackXG, computeDefenseXG,
} from './engine';
import {
  generatePlayer, generateSquad, generateCup, generateObjectives,
  generateRoundRobin,
} from './data';

// ─── Action Types ─────────────────────────────────────────────────────────────

type GameAction =
  | { type: 'INIT_GAME'; payload: GameState }
  | { type: 'NEW_GAME' }
  | { type: 'SET_FORMATION'; payload: Formation }
  | { type: 'TOGGLE_LINEUP_PLAYER'; payload: { playerId: string } }
  | { type: 'TOGGLE_LIST_PLAYER'; payload: { playerId: string } }
  | { type: 'TRAIN_PLAYER'; payload: { playerId: string } }
  | { type: 'BUY_PLAYER'; payload: { playerId: string; amount: number } }
  | { type: 'NEGOTIATE_CONTRACT'; payload: { playerId: string; newSalary: number; years: number } }
  | { type: 'UPGRADE_STADIUM' }
  | { type: 'UPGRADE_ACADEMY' }
  | { type: 'HIRE_STAFF'; payload: { role: StaffRole } }
  | { type: 'SET_SPECIALIZATION'; payload: Specialization | null }
  | { type: 'UPDATE_MANAGER'; payload: { name: string; nationality: string } }
  | { type: 'MATCH_DAY_COMPLETE'; payload: { updatedMatches: Match[]; playerUpdates: Partial<Player>[]; report: MatchReport } }
  | { type: 'CUP_MATCH_COMPLETE'; payload: { cupMatchId: string; homeScore: number; awayScore: number; playerUpdates: Partial<Player>[] } }
  | { type: 'START_NEW_SEASON' };

// ─── Helpers ──────────────────────────────────────────────────────────────────

function addFinance(team: Team, round: number, type: 'income' | 'expense', category: string, amount: number, description: string): Team {
  const finances = [...team.finances, {
    id: `fin_${team.finances.length}_${round}`,
    round, type, category: category as any, amount, description,
  }];
  const trimmed = finances.length > 50 ? finances.slice(-50) : finances;
  return { ...team, finances: trimmed };
}

function computeStandings(teams: Team[], matches: Match[], league: number) {
  const table = teams.filter(t => t.league === league).map(t => ({
    ...t, pts: 0, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0,
  }));
  matches.filter(m => m.played && m.league === league).forEach(m => {
    const h = table.find(t => t.id === m.homeTeamId);
    const a = table.find(t => t.id === m.awayTeamId);
    if (!h || !a) return;
    h.p++; a.p++; h.gf += m.homeScore; h.ga += m.awayScore;
    a.gf += m.awayScore; a.ga += m.homeScore;
    if (m.homeScore > m.awayScore) { h.pts += 3; h.w++; a.l++; }
    else if (m.homeScore < m.awayScore) { a.pts += 3; a.w++; h.l++; }
    else { h.pts++; a.pts++; h.d++; a.d++; }
  });
  table.forEach(t => (t.gd = t.gf - t.ga));
  return table.sort((a, b) => b.pts - a.pts || b.w - a.w || b.gd - a.gd || b.gf - a.gf);
}

// ─── Simulate AI matches ─────────────────────────────────────────────────────

function simMatch(state: GameState, match: Match): Match {
  const homeP = state.players.filter(p => p.teamId === match.homeTeamId && !p.redCard && p.injuryWeeksLeft === 0);
  const awayP = state.players.filter(p => p.teamId === match.awayTeamId && !p.redCard && p.injuryWeeksLeft === 0);

  const homeAtk = computeAttackXG(homeP);
  const homeDef = computeDefenseXG(homeP);
  const awayAtk = computeAttackXG(awayP);
  const awayDef = computeDefenseXG(awayP);

  const homeXG = Math.max(0.3, (homeAtk - awayDef * 0.4) / 30 + 0.5 + Math.random() * 0.8);
  const awayXG = Math.max(0.2, (awayAtk - homeDef * 0.4) / 30 + 0.3 + Math.random() * 0.8);

  const homeScore = Math.max(0, Math.round(homeXG + (Math.random() - 0.5)));
  const awayScore = Math.max(0, Math.round(awayXG + (Math.random() - 0.5)));

  return { ...match, homeScore, awayScore, played: true };
}

function simCupMatch(state: GameState, match: { homeTeamId: string; awayTeamId: string }): { homeScore: number; awayScore: number } {
  const homeP = state.players.filter(p => p.teamId === match.homeTeamId && !p.redCard && p.injuryWeeksLeft === 0);
  const awayP = state.players.filter(p => p.teamId === match.awayTeamId && !p.redCard && p.injuryWeeksLeft === 0);

  const homeAtk = computeAttackXG(homeP);
  const homeDef = computeDefenseXG(homeP);
  const awayAtk = computeAttackXG(awayP);
  const awayDef = computeDefenseXG(awayP);

  let homeScore = Math.max(0, Math.round((homeAtk - awayDef * 0.4) / 30 + 0.3 + (Math.random() - 0.3)));
  let awayScore = Math.max(0, Math.round((awayAtk - homeDef * 0.4) / 30 + 0.2 + (Math.random() - 0.3)));

  if (homeScore === awayScore) {
    if (Math.random() < 0.5) homeScore++; else awayScore++;
  }
  return { homeScore, awayScore };
}

// ─── AI Market Logic ──────────────────────────────────────────────────────────

function runAIMarket(state: GameState): GameState {
  let { teams, players } = state;
  teams = teams.map(t => ({ ...t }));
  players = players.map(p => ({ ...p }));

  const aiTeams = teams.filter(t => t.id !== state.userTeamId);

  for (const team of aiTeams) {
    const squad = players.filter(p => p.teamId === team.id);
    if (squad.length > 16) {
      const weakest = [...squad].sort((a, b) => a.strength - b.strength).slice(0, 2);
      weakest.forEach(p => {
        const idx = players.findIndex(pl => pl.id === p.id);
        if (idx >= 0) players[idx] = { ...players[idx], listedForSale: true };
      });
    }

    const avgStr = squad.length > 0 ? squad.reduce((s, p) => s + p.strength, 0) / squad.length : 50;
    if (team.money > 1_000_000 && squad.length < 18) {
      const available = players.filter(p =>
        p.teamId !== team.id && p.listedForSale && p.value <= team.money * 0.5 && p.strength > avgStr - 5
      );
      if (available.length > 0) {
        const target = available.sort((a, b) => b.strength - a.strength)[0];
        const price = Math.round(target.value * (0.9 + Math.random() * 0.3));
        if (price <= team.money) {
          const sellerIdx = teams.findIndex(t => t.id === target.teamId);
          const buyerIdx = teams.findIndex(t => t.id === team.id);
          if (sellerIdx >= 0 && buyerIdx >= 0) {
            teams[sellerIdx] = addFinance(
              { ...teams[sellerIdx], money: teams[sellerIdx].money + price },
              state.currentRound, 'income', 'transfer', price, `Venda: ${target.name}`,
            );
            teams[buyerIdx] = addFinance(
              { ...teams[buyerIdx], money: teams[buyerIdx].money - price },
              state.currentRound, 'expense', 'transfer', price, `Compra: ${target.name}`,
            );
            const pIdx = players.findIndex(p => p.id === target.id);
            if (pIdx >= 0) {
              players[pIdx] = { ...players[pIdx], teamId: team.id, listedForSale: false };
            }
          }
        }
      }
    }
  }

  return { ...state, teams, players };
}

// ─── Post-match processing ────────────────────────────────────────────────────

function processPostMatch(state: GameState, report: MatchReport, playerUpdates: Partial<Player>[]): GameState {
  let { players, teams } = state;
  players = players.map(p => ({ ...p }));
  teams = teams.map(t => ({ ...t }));

  const userTeamId = state.userTeamId!;
  const isHome = report.homeTeamId === userTeamId;
  const userScore = isHome ? report.homeScore : report.awayScore;
  const oppScore = isHome ? report.awayScore : report.homeScore;
  const teamWon = userScore > oppScore;
  const teamDrew = userScore === oppScore;
  const teamLost = userScore < oppScore;

  for (const update of playerUpdates) {
    const idx = players.findIndex(p => p.id === update.id);
    if (idx >= 0) {
      players[idx] = { ...players[idx], ...update };
    }
  }

  for (const p of players.filter(pl => pl.teamId === userTeamId)) {
    const played = playerUpdates.some(u => u.id === p.id);
    const goalsScored = report.goalEvents.filter(g => g.playerId === p.id).length;
    const assistsMade = report.goalEvents.filter(g => g.assistId === p.id).length;
    const gotRed = report.cards.some(c => c.playerId === p.id && c.type === 'red');
    const gotInjured = report.injuries.some(i => i.playerId === p.id);
    const cleanSheet = (isHome ? report.awayScore : report.homeScore) === 0;
    const moraleMultiplier = state.manager.specialization === 'motivador' ? 2.0 : 1.0;

    const delta = computeFormDelta(p, played, teamWon, teamDrew, teamLost, goalsScored, assistsMade, gotRed, gotInjured, cleanSheet);
    const idx = players.findIndex(pl => pl.id === p.id);
    if (idx >= 0) {
      const newMorale = Math.max(0, Math.min(100, players[idx].morale + delta * 3 * moraleMultiplier));
      const newForm = Math.max(-5, Math.min(5, players[idx].formStreak + delta));
      players[idx] = { ...players[idx], morale: Math.round(newMorale), formStreak: Math.round(newForm * 10) / 10 };
    }
  }

  if (isHome) {
    const team = teams.find(t => t.id === userTeamId)!;
    const attendance = Math.min(team.stadium.capacity, Math.round(team.stadium.capacity * (0.5 + team.fanSatisfaction / 200)));
    const income = attendance * team.stadium.ticketPrice;
    const tIdx = teams.findIndex(t => t.id === userTeamId);
    teams[tIdx] = addFinance(
      { ...teams[tIdx], money: teams[tIdx].money + income },
      state.currentRound, 'income', 'tickets', income, `Bilheteria R${state.currentRound} (${attendance.toLocaleString('pt-BR')})`,
    );
  }

  const manager = { ...state.manager };
  manager.matchesManaged++;
  if (teamWon) manager.wins++;
  else if (teamDrew) manager.draws++;
  else manager.losses++;

  const userTeamIdx = teams.findIndex(t => t.id === userTeamId);
  const fanDelta = teamWon ? 3 : teamDrew ? 0 : -4;
  teams[userTeamIdx] = {
    ...teams[userTeamIdx],
    fanSatisfaction: Math.max(0, Math.min(100, teams[userTeamIdx].fanSatisfaction + fanDelta)),
  };

  return { ...state, players, teams, manager, lastMatchReport: report };
}

// ─── Advance Cup ──────────────────────────────────────────────────────────────

function advanceCup(state: GameState): GameState {
  if (!state.cup || state.cup.currentRound === 'done') return state;

  const cup = { ...state.cup, matches: [...state.cup.matches] };
  const currentMatches = cup.matches.filter(m => m.round === cup.currentRound);

  if (!currentMatches.every(m => m.played)) return { ...state, cup };

  const roundOrder: CupRound[] = ['r16', 'qf', 'sf', 'final', 'done'];
  const currentIdx = roundOrder.indexOf(cup.currentRound);
  const nextRound = roundOrder[currentIdx + 1] as CupRound;

  if (nextRound === 'done') {
    const finalMatch = currentMatches[0];
    cup.winnerId = finalMatch.winnerId;
    cup.currentRound = 'done';
    if (finalMatch.winnerId === state.userTeamId) cup.userCupResult = 'Campeão';
    return { ...state, cup, pendingCupRound: null };
  }

  const winners = currentMatches.map(m => m.winnerId!);
  const nextMatches = [];
  for (let i = 0; i < winners.length; i += 2) {
    if (i + 1 < winners.length) {
      nextMatches.push({
        id: `cup_${nextRound}_${i / 2}`,
        homeTeamId: winners[i],
        awayTeamId: winners[i + 1],
        homeScore: 0, awayScore: 0, played: false,
        round: nextRound,
      });
    }
  }

  cup.matches = [...cup.matches, ...nextMatches];
  cup.currentRound = nextRound;

  const userInNext = nextMatches.some(m => m.homeTeamId === state.userTeamId || m.awayTeamId === state.userTeamId);
  if (!userInNext && !currentMatches.some(m => m.winnerId === state.userTeamId)) {
    const roundLabels: Record<CupRound, string> = { r16: 'Eliminado nas Oitavas', qf: 'Eliminado nas Quartas', sf: 'Eliminado na Semi', final: 'Vice-campeão', done: '' };
    cup.userCupResult = roundLabels[cup.currentRound] || 'Eliminado';
  }

  return { ...state, cup, pendingCupRound: null };
}

// ─── Sim AI cup matches ──────────────────────────────────────────────────────

function simAICupMatches(state: GameState): GameState {
  if (!state.cup || state.cup.currentRound === 'done') return state;

  const cup = { ...state.cup, matches: state.cup.matches.map(m => ({ ...m })) };
  const currentMatches = cup.matches.filter(m => m.round === cup.currentRound && !m.played);

  for (const match of currentMatches) {
    if (match.homeTeamId === state.userTeamId || match.awayTeamId === state.userTeamId) continue;

    const result = simCupMatch(state, match);
    const idx = cup.matches.findIndex(m => m.id === match.id);
    if (idx >= 0) {
      cup.matches[idx] = {
        ...cup.matches[idx],
        homeScore: result.homeScore, awayScore: result.awayScore, played: true,
        winnerId: result.homeScore > result.awayScore ? match.homeTeamId : match.awayTeamId,
      };
    }
  }

  return { ...state, cup };
}

// ─── Season End ───────────────────────────────────────────────────────────────
// Dividida em subfunções para melhor legibilidade (melhoria #9 da análise)

function applyRetirements(players: Player[]): { players: Player[]; retired: string[] } {
  const retired: string[] = [];
  const remaining = players.filter(p => {
    if (p.age >= 37 && Math.random() < 0.6) { retired.push(p.name); return false; }
    if (p.age >= 39) { retired.push(p.name); return false; }
    return true;
  });
  return { players: remaining, retired };
}

function processPromoRelegation(teams: Team[], matches: Match[]): { teams: Team[]; promoted: string[]; relegated: string[] } {
  const promoted: string[] = [];
  const relegated: string[] = [];
  const updatedTeams = teams.map(t => ({ ...t }));

  for (const league of [1, 2, 3]) {
    const standings = computeStandings(updatedTeams, matches, league);
    if (league > 1) {
      standings.slice(0, 2).forEach(t => {
        promoted.push(t.id);
        const idx = updatedTeams.findIndex(tm => tm.id === t.id);
        if (idx >= 0) updatedTeams[idx] = { ...updatedTeams[idx], league: league - 1 };
      });
    }
    if (league < 3) {
      standings.slice(-2).forEach(t => {
        relegated.push(t.id);
        const idx = updatedTeams.findIndex(tm => tm.id === t.id);
        if (idx >= 0) updatedTeams[idx] = { ...updatedTeams[idx], league: league + 1 };
      });
    }
  }

  return { teams: updatedTeams, promoted, relegated };
}

function generateYouthPlayers(state: GameState, userTeamId: string): { players: Player[]; names: string[] } {
  const userTeam = state.teams.find(t => t.id === userTeamId)!;
  const academyLevel = userTeam.academyLevel;
  const generated: Player[] = [];
  const names: string[] = [];

  if (academyLevel > 0) {
    const info = ACADEMY_INFO[academyLevel];
    for (let i = 0; i < info.youthPerSeason; i++) {
      const pos: ('D' | 'M' | 'A')[] = ['D', 'M', 'A'];
      const rPos = pos[Math.floor(Math.random() * pos.length)];
      const baseStr = 30 + info.qualityBonus + Math.floor(Math.random() * 15);
      const youth = generatePlayer(userTeamId, rPos, baseStr, [16, 18], true);
      generated.push(youth);
      names.push(youth.name);
    }
  }

  return { players: generated, names };
}

function evaluateObjectives(
  objectives: Objective[],
  userPosition: number,
  cup: GameState['cup'],
  userTeamId: string,
  managerWins: number,
): Objective[] {
  return objectives.map(obj => {
    const o = { ...obj };
    if (o.type === 'league_position') o.achieved = userPosition <= o.target;
    if (o.type === 'no_relegation') o.achieved = userPosition < o.target;
    if (o.type === 'cup_round') {
      const cupRounds = ['r16', 'qf', 'sf', 'final'];
      const result = cup?.userCupResult ?? '';
      const cupIdx = result.includes('Quartas') ? 1
        : result.includes('Semi') ? 2
        : (result.includes('Campeão') || result.includes('Vice')) ? 3
        : 0;
      o.achieved = cupIdx >= o.target;
    }
    if (o.type === 'win_count') o.achieved = managerWins >= o.target;
    return o;
  });
}

function processSeasonEnd(state: GameState): GameState {
  let s = { ...state };
  s.teams = s.teams.map(t => ({ ...t }));
  s.players = s.players.map(p => ({ ...p }));

  const userTeamId = s.userTeamId!;

  // 1. Progressão por idade
  for (let i = 0; i < s.players.length; i++) {
    const p = s.players[i];
    const prog = applyAgeProgression(p);
    s.players[i] = { ...p, ...prog, age: p.age + 1 };
  }

  // 2. Recuperação de energia
  for (let i = 0; i < s.players.length; i++) {
    const prepLevel = s.staff.preparador ?? 0;
    const energyBoost = 80 + prepLevel * 5;
    s.players[i] = {
      ...s.players[i],
      energy: Math.min(100, energyBoost + Math.floor(Math.random() * 15)),
      yellowCards: 0, redCard: false,
      matchesPlayed: 0, goals: 0, assists: 0,
      minutesPlayed: 0,
      formStreak: 0, trainingProgress: 0,
    };
  }

  // 3. Aposentadorias
  const { players: remainingPlayers, retired } = applyRetirements(s.players);
  s.players = remainingPlayers;

  // 4. Promoção/rebaixamento
  const { teams: updatedTeams, promoted, relegated } = processPromoRelegation(s.teams, s.matches);
  s.teams = updatedTeams;

  // 5. Posição final do usuário (usa liga original antes do recálculo)
  const userLeague = state.teams.find(t => t.id === userTeamId)!.league;
  const userStandings = computeStandings(
    s.teams.map(t => {
      const original = state.teams.find(ot => ot.id === t.id);
      return original ? { ...t, league: original.league } : t;
    }),
    s.matches,
    userLeague,
  );
  const userPosition = userStandings.findIndex(t => t.id === userTeamId) + 1;

  // 6. Artilheiro
  const scorers = state.players.filter(p => p.goals > 0).sort((a, b) => b.goals - a.goals);
  const topScorer = scorers[0] ? {
    name: scorers[0].name, goals: scorers[0].goals,
    team: state.teams.find(t => t.id === scorers[0].teamId)?.name ?? '',
  } : null;

  // 7. Copa
  const cupResult = s.cup?.winnerId === userTeamId ? 'Campeão'
    : s.cup?.userCupResult ?? 'Não participou';

  // 8. Academia
  const { players: youthPlayers, names: youthGenerated } = generateYouthPlayers(s, userTeamId);
  s.players = [...s.players, ...youthPlayers];

  // 9. Financeiro: patrocínio, salários, manutenção
  let tIdx = s.teams.findIndex(t => t.id === userTeamId);
  s.teams[tIdx] = addFinance(
    { ...s.teams[tIdx], money: s.teams[tIdx].money + s.teams[tIdx].sponsorshipIncome },
    TOTAL_SEASON_ROUNDS, 'income', 'sponsorship',
    s.teams[tIdx].sponsorshipIncome, 'Patrocínio anual',
  );

  const totalSalary = s.players.filter(p => p.teamId === userTeamId).reduce((sum, p) => sum + p.salary, 0);
  s.teams[tIdx] = addFinance(
    { ...s.teams[tIdx], money: s.teams[tIdx].money - totalSalary },
    TOTAL_SEASON_ROUNDS, 'expense', 'salaries', totalSalary, 'Folha salarial anual',
  );

  s.teams[tIdx] = addFinance(
    { ...s.teams[tIdx], money: s.teams[tIdx].money - s.teams[tIdx].stadium.maintenanceCost },
    TOTAL_SEASON_ROUNDS, 'expense', 'maintenance', s.teams[tIdx].stadium.maintenanceCost, 'Manutenção estádio',
  );

  // 10. Objetivos
  const objectives = evaluateObjectives(
    state.objectives, userPosition, s.cup, userTeamId, state.manager.wins,
  );

  let objAchieved = 0;
  tIdx = s.teams.findIndex(t => t.id === userTeamId); // re-fetch após mutações
  for (const obj of objectives) {
    if (obj.achieved) {
      objAchieved++;
      s.teams[tIdx] = addFinance(
        { ...s.teams[tIdx], money: s.teams[tIdx].money + obj.rewardMoney },
        TOTAL_SEASON_ROUNDS, 'income', 'objective', obj.rewardMoney, `Objetivo: ${obj.description}`,
      );
      s.teams[tIdx] = { ...s.teams[tIdx], reputation: Math.min(99, s.teams[tIdx].reputation + obj.rewardRep) };
    }
  }

  // 11. Reputação do técnico
  const isChampion = userPosition === 1;
  const manager = { ...s.manager };
  if (isChampion) {
    manager.titles++;
    manager.reputation = Math.min(99, manager.reputation + 10);
  } else if (promoted.includes(userTeamId)) {
    manager.reputation = Math.min(99, manager.reputation + 5);
  } else if (relegated.includes(userTeamId)) {
    manager.reputation = Math.max(1, manager.reputation - 8);
  }

  // 12. Registro da temporada
  const record: SeasonRecord = {
    season: state.season, league: userLeague, position: userPosition,
    wins: state.manager.wins, draws: state.manager.draws, losses: state.manager.losses,
    goalsFor: state.players.filter(p => p.teamId === userTeamId).reduce((acc, p) => acc + p.goals, 0),
    goalsAgainst: 0,
    cupResult,
    promoted: promoted.includes(userTeamId),
    relegated: relegated.includes(userTeamId),
    champion: isChampion,
    objectivesAchieved: objAchieved,
    objectivesTotal: objectives.length,
    moneyEnd: s.teams[tIdx].money,
  };

  const summary: SeasonSummary = {
    season: state.season, userLeague, userPosition,
    promoted, relegated,
    topScorer, retired, youthGenerated,
    cupResult, objectivesAchieved: objAchieved, objectivesTotal: objectives.length,
  };

  // 13. Expiração de contratos
  for (let i = 0; i < s.players.length; i++) {
    s.players[i] = { ...s.players[i], contractYears: Math.max(0, s.players[i].contractYears - 1) };
  }
  s.players = s.players.filter(p => p.contractYears > 0 || p.teamId === userTeamId);

  return {
    ...s,
    phase: 'offseason',
    season: state.season + 1,
    manager,
    lastSeasonSummary: summary,
    seasonHistory: [...state.seasonHistory, record],
    objectives,
  };
}

// ─── Reducer ──────────────────────────────────────────────────────────────────

export function gameReducer(state: GameState | null, action: GameAction): GameState | null {
  if (action.type === 'NEW_GAME') return null;

  if (action.type === 'INIT_GAME') {
    const gs = action.payload;
    const userTeam = gs.teams.find(t => t.id === gs.userTeamId)!;
    const objectives = generateObjectives(userTeam, userTeam.league);
    return { ...gs, objectives };
  }

  if (!state) return null;

  switch (action.type) {
    case 'SET_FORMATION': {
      const formation = action.payload;
      const teamPlayers = state.players.filter(p => p.teamId === state.userTeamId && !p.redCard && p.injuryWeeksLeft === 0);
      const best = getBestLineup(teamPlayers, formation);
      return { ...state, formation, userLineup: best.map(p => p.id) };
    }

    case 'TOGGLE_LINEUP_PLAYER': {
      const { playerId } = action.payload;
      const player = state.players.find(p => p.id === playerId);
      if (!player || player.redCard || player.injuryWeeksLeft > 0) return state;

      let lineup = [...state.userLineup];
      if (lineup.includes(playerId)) {
        lineup = lineup.filter(id => id !== playerId);
      } else {
        if (lineup.length >= 11) return state;
        const slots = FORMATIONS[state.formation];
        const currentCount: Record<string, number> = { G: 0, D: 0, M: 0, A: 0 };
        for (const id of lineup) {
          const p = state.players.find(pl => pl.id === id);
          if (p) currentCount[p.position]++;
        }
        if (currentCount[player.position] >= slots[player.position]) return state;
        lineup.push(playerId);
      }
      return { ...state, userLineup: lineup };
    }

    case 'TOGGLE_LIST_PLAYER': {
      const { playerId } = action.payload;
      return {
        ...state,
        players: state.players.map(p =>
          p.id === playerId ? { ...p, listedForSale: !p.listedForSale } : p
        ),
      };
    }

    case 'TRAIN_PLAYER': {
      const { playerId } = action.payload;
      const player = state.players.find(p => p.id === playerId);
      if (!player) return state;

      const userTeam = state.teams.find(t => t.id === state.userTeamId)!;
      const cost = 50_000;
      if (userTeam.money < cost) return state;

      const devMultiplier = state.manager.specialization === 'desenvolvedor' ? 2.0 : 1.0;
      const result = processTraining(player, Math.round(25 * devMultiplier));

      const updatedPlayer = {
        ...player,
        trainingProgress: result.trainingProgress,
        ...(result.attributes ? { attributes: result.attributes } : {}),
        ...(result.strength != null ? { strength: result.strength } : {}),
        ...(result.potential != null ? { potential: result.potential } : {}),
      };

      return {
        ...state,
        players: state.players.map(p => p.id === playerId ? updatedPlayer : p),
        teams: state.teams.map(t =>
          t.id === state.userTeamId
            ? addFinance({ ...t, money: t.money - cost }, state.currentRound, 'expense', 'training', cost, `Treino: ${player.name}`)
            : t
        ),
      };
    }

    case 'BUY_PLAYER': {
      const { playerId, amount } = action.payload;
      const player = state.players.find(p => p.id === playerId);
      if (!player) return state;

      const sellerTeamId = player.teamId;
      return {
        ...state,
        players: state.players.map(p =>
          p.id === playerId ? { ...p, teamId: state.userTeamId!, listedForSale: false, contractYears: 3 } : p
        ),
        teams: state.teams.map(t => {
          if (t.id === state.userTeamId) {
            return addFinance({ ...t, money: t.money - amount }, state.currentRound, 'expense', 'transfer', amount, `Compra: ${player.name}`);
          }
          if (t.id === sellerTeamId) {
            return addFinance({ ...t, money: t.money + amount }, state.currentRound, 'income', 'transfer', amount, `Venda: ${player.name}`);
          }
          return t;
        }),
      };
    }

    case 'NEGOTIATE_CONTRACT': {
      const { playerId, newSalary, years } = action.payload;
      const player = state.players.find(p => p.id === playerId);
      if (!player) return state;

      const bonus = newSalary > player.salary ? Math.round(newSalary * 0.5) : 0;
      const userTeam = state.teams.find(t => t.id === state.userTeamId)!;
      if (userTeam.money < bonus) return state;

      return {
        ...state,
        players: state.players.map(p =>
          p.id === playerId ? { ...p, salary: newSalary, contractYears: years, releaseClause: Math.round(p.value * (1.5 + Math.random())) } : p
        ),
        teams: bonus > 0 ? state.teams.map(t =>
          t.id === state.userTeamId
            ? addFinance({ ...t, money: t.money - bonus }, state.currentRound, 'expense', 'transfer', bonus, `Bônus renovação: ${player.name}`)
            : t
        ) : state.teams,
      };
    }

    case 'UPGRADE_STADIUM': {
      const team = state.teams.find(t => t.id === state.userTeamId)!;
      const cost = team.stadium.level * 2_000_000;
      if (team.money < cost) return state;
      return {
        ...state,
        teams: state.teams.map(t =>
          t.id === state.userTeamId
            ? addFinance({
                ...t, money: t.money - cost,
                stadium: {
                  ...t.stadium,
                  level: t.stadium.level + 1,
                  capacity: t.stadium.capacity + 10_000,
                  ticketPrice: t.stadium.ticketPrice + 10,
                  maintenanceCost: t.stadium.maintenanceCost + 50_000,
                },
              }, state.currentRound, 'expense', 'stadium_upgrade', cost, 'Ampliação do estádio')
            : t
        ),
      };
    }

    case 'UPGRADE_ACADEMY': {
      const team = state.teams.find(t => t.id === state.userTeamId)!;
      const nextLevel = team.academyLevel + 1;
      if (nextLevel >= ACADEMY_INFO.length) return state;
      const cost = ACADEMY_INFO[nextLevel].cost;
      if (team.money < cost) return state;
      return {
        ...state,
        teams: state.teams.map(t =>
          t.id === state.userTeamId
            ? addFinance({ ...t, money: t.money - cost, academyLevel: nextLevel }, state.currentRound, 'expense', 'academy', cost, `Academia → ${ACADEMY_INFO[nextLevel].label}`)
            : t
        ),
      };
    }

    case 'HIRE_STAFF': {
      const { role } = action.payload;
      // ✅ STAFF_INFO agora vem do import estático no topo do arquivo (não mais require())
      const info = STAFF_INFO[role];
      const currentLevel = state.staff[role] ?? 0;
      if (currentLevel >= 3) return state;
      const cost = info.hireCost[currentLevel];
      const team = state.teams.find(t => t.id === state.userTeamId)!;
      if (team.money < cost) return state;
      return {
        ...state,
        staff: { ...state.staff, [role]: currentLevel + 1 },
        teams: state.teams.map(t =>
          t.id === state.userTeamId
            ? addFinance({ ...t, money: t.money - cost }, state.currentRound, 'expense', 'staff', cost, `Staff: ${info.label} Nv${currentLevel + 1}`)
            : t
        ),
      };
    }

    case 'SET_SPECIALIZATION':
      return { ...state, manager: { ...state.manager, specialization: action.payload } };

    case 'UPDATE_MANAGER':
      return { ...state, manager: { ...state.manager, name: action.payload.name, nationality: action.payload.nationality } };

    case 'MATCH_DAY_COMPLETE': {
      const { updatedMatches, playerUpdates, report } = action.payload;

      let newMatches = state.matches.map(m => {
        const updated = updatedMatches.find(u => u.id === m.id);
        return updated ?? m;
      });

      const aiMatches = newMatches.filter(m => m.round === state.currentRound && !m.played);
      newMatches = newMatches.map(m => {
        if (aiMatches.includes(m)) return simMatch(state, m);
        return m;
      });

      let newState = { ...state, matches: newMatches };
      newState = processPostMatch(newState, report, playerUpdates);

      if (TRANSFER_WINDOW_ROUNDS.has(state.currentRound)) {
        newState = runAIMarket(newState);
      }

      const prepLevel = state.staff.preparador ?? 0;
      newState = {
        ...newState,
        players: newState.players.map(p => ({
          ...p,
          injuryWeeksLeft: Math.max(0, p.injuryWeeksLeft - 1),
          energy: p.teamId === state.userTeamId
            ? Math.min(100, p.energy + 8 + prepLevel * 5)
            : Math.min(100, p.energy + 10),
          redCard: p.redCard ? false : p.redCard,
        })),
      };

      let pendingCupRound: CupRound | null = null;
      if (newState.cup && newState.cup.currentRound !== 'done') {
        const unlockRound = CUP_UNLOCK_AFTER[newState.cup.currentRound];
        if (unlockRound && state.currentRound >= unlockRound) {
          newState = simAICupMatches(newState);
          const userCupMatch = newState.cup!.matches.find(m =>
            m.round === newState.cup!.currentRound && !m.played &&
            (m.homeTeamId === state.userTeamId || m.awayTeamId === state.userTeamId)
          );
          if (userCupMatch) {
            pendingCupRound = newState.cup!.currentRound;
          } else {
            newState = advanceCup(newState);
          }
        }
      }

      const nextRound = state.currentRound + 1;
      if (nextRound > TOTAL_SEASON_ROUNDS) {
        newState = processSeasonEnd(newState);
      } else {
        newState = { ...newState, currentRound: nextRound, pendingCupRound };
      }

      return newState;
    }

    case 'CUP_MATCH_COMPLETE': {
      const { cupMatchId, homeScore, awayScore, playerUpdates } = action.payload;
      if (!state.cup) return state;

      const cup = { ...state.cup, matches: state.cup.matches.map(m => ({ ...m })) };
      const idx = cup.matches.findIndex(m => m.id === cupMatchId);
      if (idx >= 0) {
        cup.matches[idx] = {
          ...cup.matches[idx],
          homeScore, awayScore, played: true,
          winnerId: homeScore > awayScore ? cup.matches[idx].homeTeamId : cup.matches[idx].awayTeamId,
        };
      }

      let newState = {
        ...state,
        cup,
        players: state.players.map(p => {
          const update = playerUpdates.find(u => u.id === p.id);
          return update ? { ...p, ...update } : p;
        }),
      };

      newState = advanceCup(newState);
      return { ...newState, pendingCupRound: null };
    }

    case 'START_NEW_SEASON': {
      const newMatches: Match[] = [];
      for (const league of [1, 2, 3]) {
        const leagueTeams = state.teams.filter(t => t.league === league).map(t => t.id);
        newMatches.push(...generateRoundRobin(leagueTeams, league));
      }

      const cup = generateCup(state.teams, state.season);
      const userTeam = state.teams.find(t => t.id === state.userTeamId)!;
      const objectives = generateObjectives(userTeam, userTeam.league);

      return {
        ...state,
        phase: 'season',
        currentRound: 1,
        matches: newMatches,
        cup,
        objectives,
        lastSeasonSummary: null,
        lastMatchReport: null,
        pendingCupRound: null,
      };
    }

    default:
      return state;
  }
}