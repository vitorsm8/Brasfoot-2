import { GameState, Player, Match, FinanceRecord } from './types';
import { getBestLineup } from './engine';

// ---------------------------------------------------------------------------
// Action types — contratos explícitos entre UI e lógica de negócio
// ---------------------------------------------------------------------------

export type GameAction =
  | { type: 'INIT_GAME'; payload: GameState }
  | {
      type: 'MATCH_DAY_COMPLETE';
      payload: { updatedMatches: Match[]; playerUpdates: Partial<Player>[] };
    }
  | { type: 'UPGRADE_STADIUM' }
  | { type: 'TRAIN_PLAYER'; payload: { playerId: string } }
  | { type: 'TOGGLE_LINEUP_PLAYER'; payload: { playerId: string } }
  | { type: 'TOGGLE_LIST_PLAYER'; payload: { playerId: string } }
  | { type: 'BUY_PLAYER'; payload: { playerId: string; amount: number } }
  | { type: 'UPDATE_MANAGER'; payload: { name: string; nationality: string } };

// ---------------------------------------------------------------------------
// Helpers de finanças
// ---------------------------------------------------------------------------

function makeRecord(
  round: number,
  type: FinanceRecord['type'],
  category: FinanceRecord['category'],
  amount: number,
  description: string
): FinanceRecord {
  // Contador global simples — determinístico dentro de uma sessão
  return {
    id: `${round}-${category}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    round,
    type,
    category,
    amount,
    description,
  };
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export function gameReducer(state: GameState | null, action: GameAction): GameState | null {
  switch (action.type) {
    // -----------------------------------------------------------------------
    case 'INIT_GAME':
      return action.payload;

    // -----------------------------------------------------------------------
    case 'MATCH_DAY_COMPLETE': {
      if (!state) return null;
      const { updatedMatches, playerUpdates } = action.payload;

      const userTeam = state.teams.find(t => t.id === state.userTeamId)!;
      const userUpdatedMatch = updatedMatches.find(
        m => m.homeTeamId === userTeam.id || m.awayTeamId === userTeam.id
      )!;

      // Resultado do time do usuário
      const userIsHome = userUpdatedMatch.homeTeamId === userTeam.id;
      const userGoals = userIsHome ? userUpdatedMatch.homeScore : userUpdatedMatch.awayScore;
      const oppGoals = userIsHome ? userUpdatedMatch.awayScore : userUpdatedMatch.homeScore;
      const isWin = userGoals > oppGoals;
      const isDraw = userGoals === oppGoals;
      const isLoss = userGoals < oppGoals;

      // IDs dos jogadores que efetivamente jogaram (estavam no lineup)
      const playedIds = new Set(playerUpdates.map(u => u.id));

      // 1. Atualiza energia, suspensão e moral base
      let nextPlayers = state.players.map(p => {
        const newEnergy = Math.min(100, p.energy + 20);
        const redCard = p.redCard ? false : p.redCard; // suspensão cumprida

        let moraleChange = 0;
        if (p.teamId === userTeam.id) {
          if (isWin) moraleChange += 5;
          if (isLoss) moraleChange -= 5;
          moraleChange += playedIds.has(p.id) ? 2 : -2;
        }

        return {
          ...p,
          energy: newEnergy,
          redCard,
          morale: Math.max(0, Math.min(100, p.morale + moraleChange)),
        };
      });

      // 2. Aplica os updates vindos da simulação (energia, gols, cartões, etc.)
      playerUpdates.forEach(update => {
        const idx = nextPlayers.findIndex(p => p.id === update.id);
        if (idx !== -1) {
          nextPlayers[idx] = { ...nextPlayers[idx], ...update };
        }
      });

      // 3. Processa finanças por time
      const newTeams = state.teams.map(team => {
        const teamMatch = updatedMatches.find(
          m => m.homeTeamId === team.id || m.awayTeamId === team.id
        );
        if (!teamMatch) return team;

        let newMoney = team.money;
        const newFinances = [...team.finances];
        const round = state.currentRound;

        // Bilheteria (só mandante)
        if (teamMatch.homeTeamId === team.id) {
          const attendance = Math.floor(team.stadium.capacity * (0.5 + Math.random() * 0.5));
          const ticketIncome = attendance * team.stadium.ticketPrice;
          newMoney += ticketIncome;
          newFinances.push(
            makeRecord(round, 'income', 'tickets', ticketIncome, `Bilheteria (${attendance} pagantes)`)
          );
        }

        // Patrocínio proporcional
        const sponsorship = Math.floor(team.sponsorshipIncome / 38);
        newMoney += sponsorship;
        newFinances.push(makeRecord(round, 'income', 'sponsorship', sponsorship, 'Patrocínio'));

        // Salários
        const teamPlayers = nextPlayers.filter(p => p.teamId === team.id);
        const totalSalaries = teamPlayers.reduce((sum, p) => sum + p.salary, 0) / 4;
        newMoney -= totalSalaries;
        newFinances.push(
          makeRecord(round, 'expense', 'salaries', totalSalaries, 'Salários dos Jogadores')
        );

        // Manutenção
        newMoney -= team.stadium.maintenanceCost;
        newFinances.push(
          makeRecord(round, 'expense', 'maintenance', team.stadium.maintenanceCost, 'Manutenção do Estádio')
        );

        return { ...team, money: newMoney, finances: newFinances };
      });

      // 4. Mescla partidas simuladas
      const newMatches = state.matches.map(m => {
        const sim = updatedMatches.find(s => s.id === m.id);
        return sim ?? m;
      });

      // 5. Remove suspensos do lineup do usuário
      const newUserLineup = state.userLineup.filter(id => {
        const p = nextPlayers.find(p => p.id === id);
        return p && !p.redCard;
      });

      // 6. Atualiza manager
      const newManager = { ...state.manager, matchesManaged: state.manager.matchesManaged + 1 };
      if (isWin) {
        newManager.wins++;
        newManager.reputation = Math.min(100, newManager.reputation + 1);
      } else if (isDraw) {
        newManager.draws++;
      } else if (isLoss) {
        newManager.losses++;
        newManager.reputation = Math.max(0, newManager.reputation - 1);
      }

      return {
        ...state,
        players: nextPlayers,
        teams: newTeams,
        matches: newMatches,
        currentRound: state.currentRound + 1,
        userLineup: newUserLineup,
        manager: newManager,
      };
    }

    // -----------------------------------------------------------------------
    case 'UPGRADE_STADIUM': {
      if (!state) return null;
      const userTeam = state.teams.find(t => t.id === state.userTeamId)!;
      const cost = userTeam.stadium.level * 2_000_000;
      if (userTeam.money < cost) return state;

      const newTeams = state.teams.map(t => {
        if (t.id !== state.userTeamId) return t;
        const newStadium = {
          ...t.stadium,
          level: t.stadium.level + 1,
          capacity: t.stadium.capacity + 10_000,
          ticketPrice: t.stadium.ticketPrice + 10,
          maintenanceCost: t.stadium.maintenanceCost + 20_000,
        };
        return {
          ...t,
          money: t.money - cost,
          stadium: newStadium,
          finances: [
            ...t.finances,
            makeRecord(
              state.currentRound,
              'expense',
              'stadium_upgrade',
              cost,
              `Ampliação do Estádio (Nível ${newStadium.level})`
            ),
          ],
        };
      });

      return { ...state, teams: newTeams };
    }

    // -----------------------------------------------------------------------
    case 'TRAIN_PLAYER': {
      if (!state) return null;
      const TRAINING_COST = 50_000;
      const userTeam = state.teams.find(t => t.id === state.userTeamId)!;
      if (userTeam.money < TRAINING_COST) return state;

      const newTeams = state.teams.map(t =>
        t.id === state.userTeamId ? { ...t, money: t.money - TRAINING_COST } : t
      );

      const newPlayers = state.players.map(p => {
        if (p.id !== action.payload.playerId) return p;
        const newProgress = p.trainingProgress + 25;
        const leveledUp = newProgress >= 100;
        return {
          ...p,
          trainingProgress: leveledUp ? newProgress - 100 : newProgress,
          strength: leveledUp ? Math.min(99, p.strength + 1) : p.strength,
        };
      });

      return { ...state, teams: newTeams, players: newPlayers };
    }

    // -----------------------------------------------------------------------
    case 'TOGGLE_LINEUP_PLAYER': {
      if (!state) return null;
      const { playerId } = action.payload;
      const player = state.players.find(p => p.id === playerId);
      if (player?.redCard) return state; // suspenso não entra

      const isSelected = state.userLineup.includes(playerId);
      let newLineup = [...state.userLineup];

      if (isSelected) {
        newLineup = newLineup.filter(id => id !== playerId);
      } else if (newLineup.length < 11) {
        newLineup.push(playerId);
      }

      return { ...state, userLineup: newLineup };
    }

    // -----------------------------------------------------------------------
    case 'TOGGLE_LIST_PLAYER': {
      if (!state) return null;
      const newPlayers = state.players.map(p =>
        p.id === action.payload.playerId ? { ...p, listedForSale: !p.listedForSale } : p
      );
      return { ...state, players: newPlayers };
    }

    // -----------------------------------------------------------------------
    case 'BUY_PLAYER': {
      if (!state) return null;
      const { playerId, amount } = action.payload;
      const player = state.players.find(p => p.id === playerId);
      const userTeam = state.teams.find(t => t.id === state.userTeamId)!;
      const sellerTeam = state.teams.find(t => t.id === player?.teamId);

      if (!player || !sellerTeam || userTeam.money < amount || !player.listedForSale) return state;

      const newTeams = state.teams.map(t => {
        if (t.id === userTeam.id) {
          return {
            ...t,
            money: t.money - amount,
            finances: [
              ...t.finances,
              makeRecord(state.currentRound, 'expense', 'transfer', amount, `Compra de ${player.name}`),
            ],
          };
        }
        if (t.id === sellerTeam.id) {
          return {
            ...t,
            money: t.money + amount,
            finances: [
              ...t.finances,
              makeRecord(state.currentRound, 'income', 'transfer', amount, `Venda de ${player.name}`),
            ],
          };
        }
        return t;
      });

      const newPlayers = state.players.map(p =>
        p.id === playerId ? { ...p, teamId: userTeam.id, listedForSale: false } : p
      );

      return { ...state, teams: newTeams, players: newPlayers };
    }

    // -----------------------------------------------------------------------
    case 'UPDATE_MANAGER': {
      if (!state) return null;
      const { name, nationality } = action.payload;
      return { ...state, manager: { ...state.manager, name, nationality } };
    }

    // -----------------------------------------------------------------------
    default:
      return state;
  }
}
