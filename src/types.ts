export type Position = 'G' | 'D' | 'M' | 'A';

export interface PlayerAttributes {
  passe: number; chute: number; drible: number; cruzamento: number;
  velocidade: number; stamina: number; forca: number;
  posicionamento: number; decisao: number; marcacao: number;
  disciplina: number; lideranca: number;
  /** Novo: habilidade de cabeceio — afeta bola parada */
  cabeceio: number;
}

export const ATTR_LABELS: Record<keyof PlayerAttributes, string> = {
  passe:'Passe',chute:'Chute',drible:'Drible',cruzamento:'Cruzamento',
  velocidade:'Velocidade',stamina:'Stamina',forca:'Força',
  posicionamento:'Posicionamento',decisao:'Decisão',marcacao:'Marcação',
  disciplina:'Disciplina',lideranca:'Liderança',
  cabeceio:'Cabeceio',
};

export const ATTR_GROUPS: { label: string; keys: (keyof PlayerAttributes)[] }[] = [
  { label:'Técnico',     keys:['passe','chute','drible','cruzamento','cabeceio'] },
  { label:'Físico',      keys:['velocidade','stamina','forca'] },
  { label:'Tático',      keys:['posicionamento','decisao','marcacao'] },
  { label:'Psicológico', keys:['disciplina','lideranca'] },
];

export const PRIMARY_ATTRS: Record<Position, (keyof PlayerAttributes)[]> = {
  G:['posicionamento','decisao','marcacao','forca','disciplina'],
  D:['marcacao','forca','posicionamento','velocidade','cabeceio'],
  M:['passe','decisao','stamina','drible','posicionamento'],
  A:['chute','drible','velocidade','posicionamento','cabeceio'],
};

// ─── Formações ────────────────────────────────────────────────────────────────
export type Formation = '4-4-2'|'4-3-3'|'3-5-2'|'4-2-3-1'|'5-3-2'|'4-1-4-1';
export interface FormationSlots { G:number; D:number; M:number; A:number; }

export const FORMATIONS: Record<Formation, FormationSlots> = {
  '4-4-2':{G:1,D:4,M:4,A:2},'4-3-3':{G:1,D:4,M:3,A:3},'3-5-2':{G:1,D:3,M:5,A:2},
  '4-2-3-1':{G:1,D:4,M:5,A:1},'5-3-2':{G:1,D:5,M:3,A:2},'4-1-4-1':{G:1,D:4,M:5,A:1},
};
export const FORMATION_MODIFIERS: Record<Formation,{attack:number;defense:number}> = {
  '4-4-2':{attack:1.00,defense:1.00},'4-3-3':{attack:1.10,defense:0.93},'3-5-2':{attack:1.05,defense:0.95},
  '4-2-3-1':{attack:1.05,defense:1.00},'5-3-2':{attack:0.88,defense:1.15},'4-1-4-1':{attack:1.00,defense:1.05},
};
export const FORMATION_LABELS: Record<Formation, string> = {
  '4-4-2':'4-4-2 Clássico','4-3-3':'4-3-3 Ofensivo','3-5-2':'3-5-2 Meias',
  '4-2-3-1':'4-2-3-1 Posse','5-3-2':'5-3-2 Defensivo','4-1-4-1':'4-1-4-1 Equilíbrio',
};

// ─── Staff ────────────────────────────────────────────────────────────────────
export type StaffRole = 'medico'|'preparador'|'goleiros'|'olheiro';
export const STAFF_INFO: Record<StaffRole,{label:string;desc:string;hireCost:[number,number,number];effect:[string,string,string]}> = {
  medico:    {label:'Médico',      desc:'Reduz duração das lesões',       hireCost:[500_000,1_000_000,2_000_000],effect:['-1 rodada',   '-2 rodadas',   '-3 rodadas']},
  preparador:{label:'Prep. Físico',desc:'Recuperação de energia extra',   hireCost:[400_000,  800_000,1_500_000],effect:['+5 energia/r','+10 energia/r','+15 energia/r']},
  goleiros:  {label:'T. Goleiros', desc:'Boost no goleiro titular',       hireCost:[300_000,  600_000,1_200_000],effect:['+2 força GK', '+4 força GK',  '+6 força GK']},
  olheiro:   {label:'Olheiro',     desc:'Revela potencial dos jogadores', hireCost:[200_000,  400_000,  800_000],effect:['Top 6',       'Top 12',       'Elenco todo']},
};

// ─── Especialização ───────────────────────────────────────────────────────────
export type Specialization = 'ofensivo'|'defensivo'|'desenvolvedor'|'motivador';
export const SPEC_INFO: Record<Specialization,{label:string;desc:string;color:string}> = {
  ofensivo:     {label:'Ofensivo',     desc:'+15% poder de ataque',    color:'text-red-400    border-red-500/30    bg-red-500/10'},
  defensivo:    {label:'Defensivo',    desc:'+15% poder de defesa',    color:'text-blue-400   border-blue-500/30   bg-blue-500/10'},
  desenvolvedor:{label:'Desenvolvedor',desc:'Treino 2× mais eficiente',color:'text-emerald-400 border-emerald-500/30 bg-emerald-500/10'},
  motivador:    {label:'Motivador',    desc:'Moral com efeito dobrado', color:'text-amber-400  border-amber-500/30  bg-amber-500/10'},
};

// ─── Academia ─────────────────────────────────────────────────────────────────
export const ACADEMY_INFO: {label:string;desc:string;cost:number;youthPerSeason:number;qualityBonus:number}[] = [
  {label:'Sem Academia',   desc:'Sem geração de jovens',           cost:0,         youthPerSeason:0,qualityBonus:0},
  {label:'Academia Básica',desc:'1 jovem/temporada · Base 30–45',  cost:500_000,   youthPerSeason:1,qualityBonus:0},
  {label:'Academia Média', desc:'2 jovens/temporada · Base 38–53', cost:1_000_000, youthPerSeason:2,qualityBonus:8},
  {label:'Academia Elite', desc:'3 jovens/temporada · Base 45–62', cost:2_000_000, youthPerSeason:3,qualityBonus:15},
];

// ─── Copa ─────────────────────────────────────────────────────────────────────
export type CupRound = 'r16'|'qf'|'sf'|'final'|'done';
export const CUP_ROUND_LABELS: Record<CupRound, string> = {
  r16:'Oitavas',qf:'Quartas',sf:'Semi-final',final:'Final',done:'Encerrada',
};
export const CUP_UNLOCK_AFTER: Partial<Record<CupRound,number>> = {
  r16:3,qf:7,sf:12,final:16,
};
export interface CupMatch {
  id:string; homeTeamId:string; awayTeamId:string;
  homeScore:number; awayScore:number; played:boolean;
  round:CupRound; winnerId?:string;
}
export interface Cup {
  season:number; matches:CupMatch[];
  currentRound:CupRound; winnerId?:string;
  userCupResult:string;
}

// ─── Relatório pós-jogo ───────────────────────────────────────────────────────
export interface MatchReport {
  homeTeamId:string; awayTeamId:string;
  homeScore:number; awayScore:number;
  homeShots:number; awayShots:number;
  homePossession:number;
  goalEvents:{playerId:string;teamId:string;minute:number;assistId?:string;isSetPiece?:boolean;setPieceType?:SetPieceType}[];
  cards:{playerId:string;teamId:string;minute:number;type:'yellow'|'red'}[];
  injuries:{playerId:string;teamId:string;minute:number}[];
  topPerformers:{playerId:string;teamId:string;rating:number}[];
  isCup:boolean;
}

// ─── Bola Parada ──────────────────────────────────────────────────────────────
export type SetPieceType = 'corner' | 'freekick' | 'penalty';

// ─── Objetivos da diretoria ───────────────────────────────────────────────────
export type ObjectiveType = 'league_position'|'cup_round'|'no_relegation'|'win_count';
export interface Objective {
  id:string; description:string; type:ObjectiveType;
  target:number; rewardMoney:number; rewardRep:number;
  achieved:boolean|null;
}

// ─── Histórico de temporadas ──────────────────────────────────────────────────
export interface SeasonRecord {
  season:number; league:number; position:number;
  wins:number; draws:number; losses:number;
  goalsFor:number; goalsAgainst:number;
  cupResult:string; promoted:boolean; relegated:boolean; champion:boolean;
  objectivesAchieved:number; objectivesTotal:number;
  moneyEnd:number;
}

// ─── Entidades principais ─────────────────────────────────────────────────────
export interface MatchEvent {
  id:string; minute:number;
  type:'goal'|'yellow'|'red'|'sub'|'foul'|'chance'|'injury'|'corner'|'freekick'|'penalty'|'penalty_miss'|'tactical_change';
  teamId:string; playerId:string; assistId?:string; subInId?:string;
  /** Detalhes extras para bola parada */
  setPieceType?:SetPieceType;
  /** Nova formação (para tactical_change events) */
  newFormation?:string;
}

export interface Player {
  id:string; name:string; position:Position;
  strength:number; attributes:PlayerAttributes; potential:number;
  age:number; teamId:string; energy:number;
  yellowCards:number; redCard:boolean; injuryWeeksLeft:number;
  matchesPlayed:number; goals:number; assists:number;
  trainingProgress:number; morale:number;
  salary:number; value:number; listedForSale:boolean;
  formStreak:number; isYouth:boolean;
  contractYears:number;
  releaseClause?: number;
  /** Minutos jogados na temporada — afeta progressão */
  minutesPlayed?: number;
}

export interface Stadium { level:number; capacity:number; ticketPrice:number; maintenanceCost:number; }

export interface FinanceRecord {
  id:string; round:number; type:'income'|'expense';
  category:'tickets'|'sponsorship'|'salaries'|'maintenance'|'training'|'stadium_upgrade'|'transfer'|'staff'|'academy'|'objective';
  amount:number; description:string;
}

export interface Team {
  id:string; name:string; color:string; money:number;
  stadium:Stadium; finances:FinanceRecord[]; sponsorshipIncome:number; league:number;
  fanSatisfaction:number; academyLevel:number;
  reputation:number;
}

export interface Match {
  id:string; homeTeamId:string; awayTeamId:string;
  homeScore:number; awayScore:number; played:boolean; round:number; league?:number;
  isCup?:boolean;
}

export interface Manager {
  name:string; nationality:string; reputation:number;
  matchesManaged:number; wins:number; draws:number; losses:number; titles:number;
  specialization:Specialization|null;
}

export type GamePhase = 'season'|'offseason';
export const TRANSFER_WINDOW_ROUNDS = new Set([1,2,3,10,11,12]);
export const TOTAL_SEASON_ROUNDS = 18;

export interface SeasonSummary {
  season:number; userLeague:number; userPosition:number;
  promoted:string[]; relegated:string[];
  topScorer:{name:string;goals:number;team:string}|null;
  retired:string[]; youthGenerated:string[];
  cupResult:string;
  objectivesAchieved:number; objectivesTotal:number;
}

export interface GameState {
  teams:Team[]; players:Player[]; matches:Match[];
  currentRound:number; userTeamId:string|null;
  userLineup:string[]; manager:Manager;
  formation:Formation;
  staff:Partial<Record<StaffRole,number>>;
  season:number; phase:GamePhase;
  lastSeasonSummary:SeasonSummary|null;
  cup:Cup|null;
  objectives:Objective[];
  seasonHistory:SeasonRecord[];
  lastMatchReport:MatchReport|null;
  pendingCupRound:CupRound|null;
}