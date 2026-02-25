import { Team, Player, Match, GameState } from './types';

const TEAM_NAMES_L1 = [
  'Flamengo', 'Palmeiras', 'São Paulo', 'Corinthians',
  'Atlético Mineiro', 'Fluminense', 'Grêmio', 'Internacional',
  'Cruzeiro', 'Vasco da Gama'
];

const TEAM_NAMES_L2 = [
  'Santos', 'Botafogo', 'Bahia', 'Athletico Paranaense',
  'Fortaleza', 'Ceará', 'Goiás', 'Coritiba',
  'Sport Recife', 'Vitória'
];

const TEAM_NAMES_L3 = [
  'Ponte Preta', 'Guarani', 'Juventude', 'Criciúma',
  'Vila Nova', 'CRB', 'Avaí', 'Chapecoense',
  'Figueirense', 'Paysandu'
];

const ALL_TEAM_NAMES = [...TEAM_NAMES_L1, ...TEAM_NAMES_L2, ...TEAM_NAMES_L3];

const COLORS = [
  '#C90000', '#006437', '#FF0000', '#000000',
  '#000000', '#8A1538', '#0D80BF', '#E50000',
  '#003A94', '#000000',
  '#FFFFFF', '#000000', '#0054A6', '#C8102E',
  '#0033A0', '#000000', '#008000', '#006400',
  '#CC0000', '#FF0000',
  '#000000', '#008000', '#006400', '#FFFF00',
  '#FF0000', '#FF0000', '#0000FF', '#008000',
  '#000000', '#0000FF'
];

const FIRST_NAMES = ['João', 'Pedro', 'Lucas', 'Mateus', 'Gabriel', 'Guilherme', 'Rafael', 'Felipe', 'Thiago', 'Bruno', 'Rodrigo', 'Eduardo', 'Diego', 'Leonardo', 'Daniel', 'Marcelo', 'Gustavo', 'Henrique', 'Ricardo', 'Alexandre'];
const LAST_NAMES = ['Silva', 'Santos', 'Oliveira', 'Souza', 'Rodrigues', 'Ferreira', 'Alves', 'Pereira', 'Lima', 'Gomes', 'Costa', 'Ribeiro', 'Martins', 'Carvalho', 'Almeida', 'Lopes', 'Soares', 'Fernandes', 'Vieira', 'Barbosa'];

function randomName() {
  return `${FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)]} ${LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)]}`;
}

function generatePlayersForTeam(teamId: string, league: number): Player[] {
  const players: Player[] = [];
  const positions: ('G' | 'D' | 'M' | 'A')[] = [
    'G', 'G', 
    'D', 'D', 'D', 'D', 'D', 'D', 
    'M', 'M', 'M', 'M', 'M', 'M', 
    'A', 'A', 'A', 'A'
  ];
  
  positions.forEach((pos, index) => {
    // Lower leagues have weaker players
    const baseStrength = 60 - (league - 1) * 10;
    const strength = Math.floor(Math.random() * 30) + baseStrength; // e.g. L1: 60-89, L2: 50-79, L3: 40-69
    const age = Math.floor(Math.random() * 15) + 18; // 18 to 32
    const salary = Math.max(1000, Math.floor((strength - 40) * 8000)); // Base salary calculation
    
    // Value calculation based on strength and age
    let baseValue = Math.max(10000, (strength - 40) * 400000);
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

export function generateFixtures(teams: Team[]): Match[] {
  const matches: Match[] = [];
  let matchId = Date.now(); // Use timestamp to ensure unique IDs across seasons

  for (let league = 1; league <= 3; league++) {
    const leagueTeams = teams.filter(t => t.league === league);
    const teamIds = leagueTeams.map(t => t.id);
    const numTeams = teamIds.length;

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
          round: round + 1,
          league
        });
      }
      // Rotate teams (except the first one)
      teamIds.splice(1, 0, teamIds.pop()!);
    }

    // Second half of the season
    const firstHalfMatches = matches.filter(m => m.league === league && m.round <= numTeams - 1);
    firstHalfMatches.forEach(m => {
      matches.push({
        id: `m${matchId++}`,
        homeTeamId: m.awayTeamId,
        awayTeamId: m.homeTeamId,
        homeScore: 0,
        awayScore: 0,
        played: false,
        round: m.round + numTeams - 1,
        league
      });
    });
  }
  return matches;
}

export function generateInitialState(): Omit<GameState, 'userTeamId' | 'userLineup' | 'currentRound'> {
  const teams: Team[] = ALL_TEAM_NAMES.map((name, index) => {
    const league = Math.floor(index / 10) + 1;
    return {
      id: `t${index}`,
      name,
      color: COLORS[index % COLORS.length],
      money: 10000000 / league,
      stadium: {
        level: 1,
        capacity: Math.floor((20000 + Math.floor(Math.random() * 10000)) / league),
        ticketPrice: Math.max(10, 50 - (league - 1) * 15),
        maintenanceCost: Math.floor(50000 / league),
      },
      finances: [],
      sponsorshipIncome: Math.floor((200000 + Math.floor(Math.random() * 100000)) / league),
      league,
    };
  });

  let players: Player[] = [];
  teams.forEach(team => {
    players = players.concat(generatePlayersForTeam(team.id, team.league));
  });

  const matches = generateFixtures(teams);

  return { 
    teams, 
    players, 
    matches,
    currentRound: 1,
    userTeamId: null,
    userLineup: [],
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
