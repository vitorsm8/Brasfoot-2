export type Position = 'G' | 'D' | 'M' | 'A';

export interface MatchEvent {
  id: string;
  minute: number;
  type: 'goal' | 'yellow' | 'red' | 'sub';
  teamId: string;
  playerId: string;
  subInId?: string;
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
  trainingProgress: number; // 0 to 100, when 100 strength increases
}

export interface Team {
  id: string;
  name: string;
  color: string;
  money: number;
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

export interface GameState {
  teams: Team[];
  players: Player[];
  matches: Match[];
  currentRound: number;
  userTeamId: string | null;
  userLineup: string[];
}

