export type Position = 'G' | 'D' | 'M' | 'A';

export interface MatchEvent {
  id: string;
  minute: number;
  type: 'goal' | 'yellow' | 'red' | 'sub' | 'foul' | 'chance';
  teamId: string;
  playerId: string;   // marcador / autor do evento
  assistId?: string;  // assistente (apenas em type === 'goal')
  subInId?: string;   // jogador que entra (apenas em type === 'sub')
}

export interface Player {
  id: string;
  name: string;
  position: Position;
  strength: number;
  age: number;
  teamId: string;
  energy: number;
  yellowCards: number;
  redCard: boolean;
  matchesPlayed: number;
  goals: number;
  assists: number;
  trainingProgress: number;
  morale: number;
  salary: number;
  value: number;
  listedForSale: boolean;
}

export interface Stadium {
  level: number;
  capacity: number;
  ticketPrice: number;
  maintenanceCost: number;
}

export interface FinanceRecord {
  id: string;
  round: number;
  type: 'income' | 'expense';
  category: 'tickets' | 'sponsorship' | 'salaries' | 'maintenance' | 'training' | 'stadium_upgrade' | 'transfer';
  amount: number;
  description: string;
}

export interface Team {
  id: string;
  name: string;
  color: string;
  money: number;
  stadium: Stadium;
  finances: FinanceRecord[];
  sponsorshipIncome: number;
}

export interface Match {
  id: string;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
  played: boolean;
  round: number;
}

export interface Manager {
  name: string;
  nationality: string;
  reputation: number;
  matchesManaged: number;
  wins: number;
  draws: number;
  losses: number;
  titles: number;
}

export interface GameState {
  teams: Team[];
  players: Player[];
  matches: Match[];
  currentRound: number;
  userTeamId: string | null;
  userLineup: string[];
  manager: Manager;
}