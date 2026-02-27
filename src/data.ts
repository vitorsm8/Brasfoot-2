import {
  Player, Team, Match, PlayerAttributes, Position,
  Stadium, GameState, Formation, Manager, Cup, CupMatch, CupRound,
  Objective, ObjectiveType, TOTAL_SEASON_ROUNDS,
} from './types';
import { computeOverall } from './engine';

// ─── Brazilian Names ──────────────────────────────────────────────────────────

const FIRST_NAMES = [
  'Lucas','Gabriel','Matheus','Pedro','Rafael','Bruno','Felipe','Gustavo','André','Thiago',
  'Leandro','Diego','Carlos','Marcos','Ricardo','Vinícius','Igor','Henrique','João','Daniel',
  'Caio','Leonardo','Arthur','Enzo','Nícolas','Samuel','Ryan','Miguel','Bernardo','Davi',
  'Kaio','Renan','Willian','Ronaldo','Fabrício','Edson','Adriano','Márcio','Luan','Wesley',
  'Pablo','Kevin','Yuri','Alex','Breno','Cauã','Hugo','Ruan','Nathan','Ítalo',
  'Murilo','Otávio','Emerson','Janderson','Talles','Claudinho','Raphinha','Luiz','Rodrygo','Antony',
];

const LAST_NAMES = [
  'Silva','Santos','Oliveira','Souza','Rodrigues','Ferreira','Almeida','Nascimento','Lima','Araújo',
  'Ribeiro','Costa','Carvalho','Gomes','Martins','Pereira','Barbosa','Melo','Nunes','Cardoso',
  'Moreira','Teixeira','Vieira','Monteiro','Mendes','Cavalcanti','Pinto','Cunha','Correia','Lopes',
  'Freitas','Azevedo','Campos','Ramos','Rocha','Dias','Reis','Batista','Moura','Castro',
];

function randomName(): string {
  const first = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
  const last = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
  return `${first} ${last}`;
}

// ─── Teams ────────────────────────────────────────────────────────────────────

interface TeamDef { name: string; color: string; league: number; rep: number; budget: number; }

const TEAM_DEFS: TeamDef[] = [
  // Série A
  { name:'Flamengo',      color:'#c42b2b', league:1, rep:85, budget:25_000_000 },
  { name:'Palmeiras',     color:'#006d32', league:1, rep:83, budget:23_000_000 },
  { name:'Corinthians',   color:'#1a1a1a', league:1, rep:78, budget:18_000_000 },
  { name:'São Paulo',     color:'#bf0811', league:1, rep:76, budget:17_000_000 },
  { name:'Fluminense',    color:'#7b2d3c', league:1, rep:70, budget:14_000_000 },
  { name:'Atlético-MG',   color:'#1a1a1a', league:1, rep:72, budget:15_000_000 },
  { name:'Botafogo',      color:'#2d2d2d', league:1, rep:68, budget:13_000_000 },
  { name:'Grêmio',        color:'#0a6eb4', league:1, rep:74, budget:16_000_000 },
  { name:'Internacional', color:'#d40000', league:1, rep:73, budget:15_000_000 },
  { name:'Cruzeiro',      color:'#0051a5', league:1, rep:69, budget:13_000_000 },
  // Série B
  { name:'Vasco',         color:'#1a1a1a', league:2, rep:62, budget:9_000_000 },
  { name:'Santos',        color:'#f5f5f5', league:2, rep:65, budget:10_000_000 },
  { name:'Bahia',         color:'#004a93', league:2, rep:55, budget:7_000_000 },
  { name:'Sport',         color:'#c42b2b', league:2, rep:48, budget:5_000_000 },
  { name:'Ceará',         color:'#1a1a1a', league:2, rep:45, budget:4_500_000 },
  { name:'Fortaleza',     color:'#1a3c7b', league:2, rep:58, budget:8_000_000 },
  { name:'Coritiba',      color:'#006d32', league:2, rep:42, budget:4_000_000 },
  { name:'Goiás',         color:'#006d32', league:2, rep:40, budget:3_500_000 },
  { name:'Vitória',       color:'#c42b2b', league:2, rep:44, budget:4_000_000 },
  { name:'Ponte Preta',   color:'#1a1a1a', league:2, rep:38, budget:3_000_000 },
  // Série C
  { name:'Remo',          color:'#003d7a', league:3, rep:32, budget:2_000_000 },
  { name:'Paysandu',      color:'#0a6eb4', league:3, rep:34, budget:2_200_000 },
  { name:'ABC',           color:'#1a1a1a', league:3, rep:28, budget:1_500_000 },
  { name:'Santa Cruz',    color:'#c42b2b', league:3, rep:30, budget:1_800_000 },
  { name:'Guarani',       color:'#006d32', league:3, rep:30, budget:1_800_000 },
  { name:'Vila Nova',     color:'#c42b2b', league:3, rep:28, budget:1_500_000 },
  { name:'Náutico',       color:'#c42b2b', league:3, rep:29, budget:1_600_000 },
  { name:'CRB',           color:'#c42b2b', league:3, rep:27, budget:1_400_000 },
  { name:'CSA',           color:'#003d7a', league:3, rep:26, budget:1_300_000 },
  { name:'Ituano',        color:'#c42b2b', league:3, rep:25, budget:1_200_000 },
];

// ─── Player Generation ────────────────────────────────────────────────────────

let playerIdCounter = 0;

function generateAttributes(position: Position, baseStr: number): PlayerAttributes {
  const vary = (base: number, range: number) => Math.max(1, Math.min(99, base + Math.floor((Math.random() - 0.5) * range)));
  const high = (b: number) => vary(b, 14);
  const med = (b: number) => vary(b - 8, 16);
  const low = (b: number) => vary(b - 15, 18);

  const base: PlayerAttributes = {
    passe: med(baseStr), chute: med(baseStr), drible: med(baseStr),
    cruzamento: med(baseStr), velocidade: med(baseStr), stamina: med(baseStr),
    forca: med(baseStr), posicionamento: med(baseStr), decisao: med(baseStr),
    marcacao: low(baseStr), disciplina: vary(55, 30), lideranca: vary(40, 30),
    cabeceio: med(baseStr),
  };

  // Position specialization
  switch (position) {
    case 'G':
      base.posicionamento = high(baseStr);
      base.decisao = high(baseStr);
      base.marcacao = high(baseStr);
      base.forca = high(baseStr);
      base.chute = low(baseStr - 15);
      base.drible = low(baseStr - 20);
      base.cabeceio = low(baseStr - 20);
      break;
    case 'D':
      base.marcacao = high(baseStr);
      base.forca = high(baseStr);
      base.posicionamento = high(baseStr);
      base.velocidade = high(baseStr);
      base.cabeceio = high(baseStr); // Zagueiros geralmente bons de cabeça
      base.chute = low(baseStr);
      base.drible = low(baseStr);
      break;
    case 'M':
      base.passe = high(baseStr);
      base.decisao = high(baseStr);
      base.stamina = high(baseStr);
      base.drible = high(baseStr);
      base.posicionamento = high(baseStr);
      base.cabeceio = med(baseStr - 5);
      break;
    case 'A':
      base.chute = high(baseStr);
      base.drible = high(baseStr);
      base.velocidade = high(baseStr);
      base.posicionamento = high(baseStr);
      base.cabeceio = high(baseStr); // Centroavantes bom de cabeça
      base.marcacao = low(baseStr - 10);
      break;
  }
  return base;
}

function generatePlayer(teamId: string, position: Position, baseStr: number, ageRange: [number, number], isYouth = false): Player {
  const age = ageRange[0] + Math.floor(Math.random() * (ageRange[1] - ageRange[0] + 1));
  const attrs = generateAttributes(position, baseStr);
  const strength = computeOverall(attrs, position);

  // Potential: young players have more room to grow
  let potential = strength;
  if (age <= 19) potential = strength + Math.floor(Math.random() * 20) + 8;
  else if (age <= 23) potential = strength + Math.floor(Math.random() * 12) + 3;
  else if (age <= 27) potential = strength + Math.floor(Math.random() * 5) + 1;
  else potential = strength + Math.floor(Math.random() * 2);
  potential = Math.min(99, potential);

  const salary = Math.round((strength * strength * 8 + Math.random() * 20_000) / 1000) * 1000;
  const value = Math.round(salary * (3 + (potential - strength) * 0.5));

  playerIdCounter++;
  return {
    id: `p_${playerIdCounter}_${Date.now().toString(36)}`,
    name: randomName(),
    position, strength, attributes: attrs, potential,
    age, teamId, energy: 85 + Math.floor(Math.random() * 15),
    yellowCards: 0, redCard: false, injuryWeeksLeft: 0,
    matchesPlayed: 0, goals: 0, assists: 0,
    trainingProgress: 0, morale: 55 + Math.floor(Math.random() * 30),
    salary, value, listedForSale: Math.random() < 0.15,
    formStreak: 0, isYouth,
    contractYears: isYouth ? 3 : 1 + Math.floor(Math.random() * 3),
    releaseClause: Math.round(value * (1.5 + Math.random())),
    minutesPlayed: 0,
  };
}

function generateSquad(teamId: string, league: number, rep: number): Player[] {
  const baseStr = league === 1 ? 58 + rep * 0.3 : league === 2 ? 45 + rep * 0.25 : 35 + rep * 0.2;
  const squad: Player[] = [];

  // GK: 2
  squad.push(generatePlayer(teamId, 'G', baseStr + 3, [24, 32]));
  squad.push(generatePlayer(teamId, 'G', baseStr - 8, [19, 25]));

  // D: 5-6
  for (let i = 0; i < 4; i++) squad.push(generatePlayer(teamId, 'D', baseStr + 2 - i * 2, [22, 32]));
  squad.push(generatePlayer(teamId, 'D', baseStr - 6, [18, 22]));

  // M: 5-6
  for (let i = 0; i < 4; i++) squad.push(generatePlayer(teamId, 'M', baseStr + 3 - i * 2, [22, 30]));
  squad.push(generatePlayer(teamId, 'M', baseStr - 4, [18, 23]));

  // A: 3-4
  squad.push(generatePlayer(teamId, 'A', baseStr + 5, [22, 30]));
  squad.push(generatePlayer(teamId, 'A', baseStr + 1, [20, 28]));
  squad.push(generatePlayer(teamId, 'A', baseStr - 5, [18, 24]));

  // Youth extras
  if (Math.random() < 0.4) squad.push(generatePlayer(teamId, 'M', baseStr - 12, [16, 18], true));
  if (Math.random() < 0.3) squad.push(generatePlayer(teamId, 'A', baseStr - 14, [16, 18], true));

  return squad;
}

// ─── Fixture Generation ───────────────────────────────────────────────────────

function generateRoundRobin(teamIds: string[], league: number): Match[] {
  const n = teamIds.length;
  const rounds: Match[] = [];
  const teams = [...teamIds];
  if (n % 2 !== 0) teams.push('BYE');
  const total = teams.length;
  let matchId = 0;

  for (let round = 0; round < total - 1; round++) {
    for (let i = 0; i < total / 2; i++) {
      const home = teams[i], away = teams[total - 1 - i];
      if (home === 'BYE' || away === 'BYE') continue;
      matchId++;
      rounds.push({
        id: `m_${league}_${matchId}`,
        homeTeamId: round % 2 === 0 ? home : away,
        awayTeamId: round % 2 === 0 ? away : home,
        homeScore: 0, awayScore: 0, played: false,
        round: round + 1, league,
      });
    }
    // Rotate (keep first fixed)
    teams.splice(1, 0, teams.pop()!);
  }
  return rounds;
}

// ─── Cup Generation ───────────────────────────────────────────────────────────

function generateCup(teams: Team[], season: number): Cup {
  // Pick 16 teams from all leagues (weighted towards higher leagues)
  const sorted = [...teams].sort((a, b) => b.reputation - a.reputation);
  const cupTeams = sorted.slice(0, 16);
  const shuffled = cupTeams.sort(() => Math.random() - 0.5);

  const matches: CupMatch[] = [];
  for (let i = 0; i < 8; i++) {
    matches.push({
      id: `cup_r16_${i}`, homeTeamId: shuffled[i * 2].id, awayTeamId: shuffled[i * 2 + 1].id,
      homeScore: 0, awayScore: 0, played: false, round: 'r16',
    });
  }

  return { season, matches, currentRound: 'r16', userCupResult: 'Em andamento' };
}

// ─── Objectives Generation ────────────────────────────────────────────────────

function generateObjectives(team: Team, league: number): Objective[] {
  const objectives: Objective[] = [];
  let id = 0;

  if (league === 1) {
    objectives.push({
      id: `obj_${++id}`, description: `Top 4 na Série A`, type: 'league_position',
      target: 4, rewardMoney: 3_000_000, rewardRep: 5, achieved: null,
    });
    if (team.reputation >= 70) {
      objectives.push({
        id: `obj_${++id}`, description: `Título da Série A`, type: 'league_position',
        target: 1, rewardMoney: 8_000_000, rewardRep: 10, achieved: null,
      });
    }
  } else if (league === 2) {
    objectives.push({
      id: `obj_${++id}`, description: `Acesso à Série A (Top 2)`, type: 'league_position',
      target: 2, rewardMoney: 5_000_000, rewardRep: 8, achieved: null,
    });
  } else {
    objectives.push({
      id: `obj_${++id}`, description: `Acesso à Série B (Top 2)`, type: 'league_position',
      target: 2, rewardMoney: 3_000_000, rewardRep: 6, achieved: null,
    });
  }

  objectives.push({
    id: `obj_${++id}`, description: 'Chegar às quartas da Copa', type: 'cup_round',
    target: 2, rewardMoney: 1_500_000, rewardRep: 3, achieved: null,
  });

  objectives.push({
    id: `obj_${++id}`, description: `Evitar rebaixamento`, type: 'no_relegation',
    target: 9, rewardMoney: 500_000, rewardRep: 1, achieved: null,
  });

  return objectives;
}

// ─── Generate Initial State ───────────────────────────────────────────────────

export function generateInitialState(): Omit<GameState, 'userTeamId' | 'userLineup' | 'formation' | 'staff' | 'season' | 'phase' | 'lastSeasonSummary'> {
  const teams: Team[] = TEAM_DEFS.map((def, i) => ({
    id: `team_${i}`,
    name: def.name,
    color: def.color,
    money: def.budget,
    stadium: {
      level: def.league === 1 ? 3 : def.league === 2 ? 2 : 1,
      capacity: def.league === 1 ? 40000 : def.league === 2 ? 20000 : 10000,
      ticketPrice: def.league === 1 ? 50 : def.league === 2 ? 30 : 15,
      maintenanceCost: def.league === 1 ? 200000 : def.league === 2 ? 100000 : 50000,
    },
    finances: [],
    sponsorshipIncome: def.league === 1 ? 4_000_000 : def.league === 2 ? 1_500_000 : 500_000,
    league: def.league,
    fanSatisfaction: 55 + Math.floor(Math.random() * 20),
    academyLevel: def.league === 1 ? 2 : def.league === 2 ? 1 : 0,
    reputation: def.rep,
  }));

  const players: Player[] = [];
  for (const team of teams) {
    const def = TEAM_DEFS.find(d => d.name === team.name)!;
    const squad = generateSquad(team.id, team.league, def.rep);
    players.push(...squad);
  }

  // Generate fixtures per league
  const matches: Match[] = [];
  for (const league of [1, 2, 3]) {
    const leagueTeams = teams.filter(t => t.league === league).map(t => t.id);
    matches.push(...generateRoundRobin(leagueTeams, league));
  }

  const cup = generateCup(teams, 1);
  const objectives: Objective[] = []; // Will be generated per user team in INIT_GAME

  return {
    teams, players, matches, currentRound: 1,
    manager: {
      name: 'Técnico', nationality: 'Brasil', reputation: 30,
      matchesManaged: 0, wins: 0, draws: 0, losses: 0, titles: 0,
      specialization: null,
    },
    cup, objectives, seasonHistory: [], lastMatchReport: null,
    pendingCupRound: null,
  };
}

export { generatePlayer, generateSquad, generateCup, generateObjectives, generateRoundRobin };