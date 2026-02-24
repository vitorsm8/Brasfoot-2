import { Team, Player, Match, GameState } from './types';

const TEAM_NAMES = [
  'Flamengo', 'Palmeiras', 'São Paulo', 'Corinthians',
  'Atlético Mineiro', 'Fluminense', 'Grêmio', 'Internacional',
  'Cruzeiro', 'Vasco da Gama'
];

const COLORS = [
  '#C90000', '#006437', '#FF0000', '#000000',
  '#000000', '#8A1538', '#0D80BF', '#E50000',
  '#003A94', '#000000'
];

const FIRST_NAMES = ['João', 'Pedro', 'Lucas', 'Mateus', 'Gabriel', 'Guilherme', 'Rafael', 'Felipe', 'Thiago', 'Bruno', 'Rodrigo', 'Eduardo', 'Diego', 'Leonardo', 'Daniel', 'Marcelo', 'Gustavo', 'Henrique', 'Ricardo', 'Alexandre'];
const LAST_NAMES = ['Silva', 'Santos', 'Oliveira', 'Souza', 'Rodrigues', 'Ferreira', 'Alves', 'Pereira', 'Lima', 'Gomes', 'Costa', 'Ribeiro', 'Martins', 'Carvalho', 'Almeida', 'Lopes', 'Soares', 'Fernandes', 'Vieira', 'Barbosa'];

function randomName() {
  return `${FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)]} ${LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)]}`;
}

function generatePlayersForTeam(teamId: string): Player[] {
  const players: Player[] = [];
  const positions: ('G' | 'D' | 'M' | 'A')[] = [
    'G', 'G', 
    'D', 'D', 'D', 'D', 'D', 'D', 
    'M', 'M', 'M', 'M', 'M', 'M', 
    'A', 'A', 'A', 'A'
  ];
  
  positions.forEach((pos, index) => {
    const strength = Math.floor(Math.random() * 40) + 60; // 60 to 99
    const age = Math.floor(Math.random() * 15) + 18; // 18 to 32
    const salary = Math.floor((strength - 50) * 10000); // Base salary calculation
    
    // Value calculation based on strength and age
    let baseValue = (strength - 50) * 500000;
    if (age < 23) baseValue *= 1.5;
    else if (age > 28) baseValue *= 0.7;
    const value = Math.floor(baseValue);

    players.push({
      id: `${teamId}-p${index}`,
      name: randomName(),
      position: pos,
      strength,
      age,
      teamId,
      energy: 100,
      yellowCards: 0,
      redCard: false,
      matchesPlayed: 0,
      goals: 0,
      assists: 0,
      trainingProgress: 0,
      morale: 80, // Initial morale
      salary,
      value,
      listedForSale: Math.random() < 0.1, // 10% chance to be listed initially
    });
  });
  return players;
}

export function generateInitialState(): Omit<GameState, 'userTeamId' | 'userLineup' | 'currentRound'> {
  const teams: Team[] = TEAM_NAMES.map((name, index) => ({
    id: `t${index}`,
    name,
    color: COLORS[index],
    money: 10000000,
    stadium: {
      level: 1,
      capacity: 20000 + Math.floor(Math.random() * 10000),
      ticketPrice: 50,
      maintenanceCost: 50000,
    },
    finances: [],
    sponsorshipIncome: 200000 + Math.floor(Math.random() * 100000),
  }));

  let players: Player[] = [];
  teams.forEach(team => {
    players = players.concat(generatePlayersForTeam(team.id));
  });

  // Generate Round-Robin Fixtures
  const matches: Match[] = [];
  const teamIds = teams.map(t => t.id);
  const numTeams = teamIds.length;
  let matchId = 0;

  for (let round = 0; round < numTeams - 1; round++) {
    for (let i = 0; i < numTeams / 2; i++) {
      const home = teamIds[i];
      const away = teamIds[numTeams - 1 - i];
      matches.push({
        id: `m${matchId++}`,
        homeTeamId: home,
        awayTeamId: away,
        homeScore: 0,
        awayScore: 0,
        played: false,
        round: round + 1
      });
    }
    // Rotate teams (except the first one)
    teamIds.splice(1, 0, teamIds.pop()!);
  }

  // Second half of the season
  const firstHalfMatches = [...matches];
  firstHalfMatches.forEach(m => {
    matches.push({
      id: `m${matchId++}`,
      homeTeamId: m.awayTeamId,
      awayTeamId: m.homeTeamId,
      homeScore: 0,
      awayScore: 0,
      played: false,
      round: m.round + numTeams - 1
    });
  });

  return { 
    teams, 
    players, 
    matches,
    manager: {
      name: 'Manager',
      nationality: 'Brasil',
      reputation: 50,
      matchesManaged: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      titles: 0
    }
  };
}
