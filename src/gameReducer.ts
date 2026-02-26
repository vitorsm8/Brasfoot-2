import {
  GameState,Player,Match,Team,FinanceRecord,Cup,CupMatch,CupRound,
  Objective,ObjectiveType,SeasonRecord,SeasonSummary,MatchReport,
  Formation,Specialization,StaffRole,STAFF_INFO,PRIMARY_ATTRS,
  TOTAL_SEASON_ROUNDS,TRANSFER_WINDOW_ROUNDS,ACADEMY_INFO,
  CUP_UNLOCK_AFTER,CUP_ROUND_LABELS,
} from './types';
import { getBestLineup, computeOverall, applyAgeProgression, processTraining, computeFormDelta } from './engine';
import { generatePlayer, generateFixtures } from './data';
import { RNG } from './rng';

// ─── Actions ──────────────────────────────────────────────────────────────────
export type GameAction =
  | { type:'INIT_GAME';             payload:GameState }
  | { type:'MATCH_DAY_COMPLETE';    payload:{ updatedMatches:Match[]; playerUpdates:Partial<Player>[]; report:MatchReport } }
  | { type:'CUP_MATCH_COMPLETE';    payload:{ cupMatchId:string; homeScore:number; awayScore:number; playerUpdates:Partial<Player>[] } }
  | { type:'START_NEW_SEASON' }
  | { type:'UPGRADE_STADIUM' }
  | { type:'UPGRADE_ACADEMY' }
  | { type:'TRAIN_PLAYER';          payload:{ playerId:string; attribute?:keyof Player['attributes'] } }
  | { type:'TOGGLE_LINEUP_PLAYER';  payload:{ playerId:string } }
  | { type:'TOGGLE_LIST_PLAYER';    payload:{ playerId:string } }
  | { type:'BUY_PLAYER';            payload:{ playerId:string; amount:number } }
  | { type:'NEGOTIATE_CONTRACT';    payload:{ playerId:string; newSalary:number; years:number } }
  | { type:'UPDATE_MANAGER';        payload:{ name:string; nationality:string } }
  | { type:'SET_FORMATION';         payload:Formation }
  | { type:'SET_SPECIALIZATION';    payload:Specialization|null }
  | { type:'HIRE_STAFF';            payload:{ role:StaffRole } }
  | { type:'NEW_GAME' };

// ─── Utils ────────────────────────────────────────────────────────────────────
function rnd(min:number,max:number){return Math.floor(Math.random()*(max-min+1))+min;}

function makeRecord(round:number,type:FinanceRecord['type'],category:FinanceRecord['category'],amount:number,description:string):FinanceRecord{
  return{id:`${round}-${category}-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,round,type,category,amount,description};
}

function weakestPrimary(player:Player,attribute?:keyof Player['attributes']):keyof Player['attributes']{
  if(attribute)return attribute;
  const p=PRIMARY_ATTRS[player.position];
  return p.reduce((w,k)=>player.attributes[k]<player.attributes[w]?k:w,p[0]);
}

function computeStandings(teams:Team[],matches:Match[],league:number){
  const table=teams.filter(t=>t.league===league).map(t=>({id:t.id,pts:0,w:0,d:0,l:0,gf:0,ga:0}));
  matches.filter(m=>m.played&&m.league===league).forEach(m=>{
    const h=table.find(t=>t.id===m.homeTeamId)!,a=table.find(t=>t.id===m.awayTeamId)!;
    if(!h||!a)return;
    h.gf+=m.homeScore;h.ga+=m.awayScore;a.gf+=m.awayScore;a.ga+=m.homeScore;
    if(m.homeScore>m.awayScore){h.pts+=3;h.w++;a.l++;}
    else if(m.homeScore<m.awayScore){a.pts+=3;a.w++;h.l++;}
    else{h.pts++;a.pts++;h.d++;a.d++;}
  });
  return table.sort((a,b)=>b.pts-a.pts||(b.w-a.w)||(b.gf-b.ga)-(a.gf-a.ga));
}

// ─── Copa (com RNG seedável) ──────────────────────────────────────────────────

/**
 * BUGFIX: Usa RNG seedável em vez de Math.random() para partidas de copa da IA.
 * Garante que resultados sejam mais consistentes e reproduzíveis.
 */
function simCupMatch(homeId:string,awayId:string,players:Player[],seed:number):{homeScore:number;awayScore:number;winnerId:string}{
  const rng = new RNG(seed);
  const str=(tid:string)=>{
    const ps=players.filter(p=>p.teamId===tid&&!p.redCard&&p.injuryWeeksLeft===0);
    return ps.length?ps.reduce((s,p)=>s+p.strength,0)/ps.length:50;
  };
  const ha=str(homeId),aa=str(awayId),total=ha+aa;
  // Home advantage na copa também
  const homeAdv = 1.06;
  const hProb = (ha * homeAdv) / (ha * homeAdv + aa);
  const hGoals = Math.round(hProb * rng.next() * 4);
  const aGoals = Math.round((1 - hProb) * rng.next() * 4);
  const winnerId = hGoals > aGoals ? homeId : aGoals > hGoals ? awayId : (rng.next() < 0.5 ? homeId : awayId);
  return { homeScore: hGoals, awayScore: aGoals, winnerId };
}

function generateCup(teams:Team[],userTeamId:string,season:number):Cup{
  const others=teams.filter(t=>t.id!==userTeamId);
  const l1=others.filter(t=>t.league===1).sort(()=>Math.random()-0.5).slice(0,5).map(t=>t.id);
  const l2=others.filter(t=>t.league===2).sort(()=>Math.random()-0.5).slice(0,6).map(t=>t.id);
  const l3=others.filter(t=>t.league===3).sort(()=>Math.random()-0.5).slice(0,4).map(t=>t.id);
  const participants=[userTeamId,...l1,...l2,...l3].slice(0,16);
  while(participants.length<16)participants.push(others[rnd(0,others.length-1)].id);
  const shuffled=[...participants].sort(()=>Math.random()-0.5);
  const matches:CupMatch[]=[];
  for(let i=0;i<8;i++){
    matches.push({id:`cup-r16-${i}`,homeTeamId:shuffled[i*2],awayTeamId:shuffled[i*2+1],homeScore:0,awayScore:0,played:false,round:'r16'});
  }
  return{season,matches,currentRound:'r16',userCupResult:'Oitavas'};
}

function advanceCupRound(cup:Cup,players:Player[],userTeamId:string):Cup{
  const roundOrder:CupRound[]=['r16','qf','sf','final','done'];
  const currentIdx=roundOrder.indexOf(cup.currentRound);
  if(currentIdx<0||cup.currentRound==='done')return cup;

  // Auto-sim AI matches com RNG seedável
  let updatedMatches=[...cup.matches];
  let matchSeed = cup.season * 10000 + currentIdx * 100;
  updatedMatches=updatedMatches.map((m,i)=>{
    if(m.round!==cup.currentRound||m.played||m.homeTeamId===userTeamId||m.awayTeamId===userTeamId)return m;
    const{homeScore,awayScore,winnerId}=simCupMatch(m.homeTeamId,m.awayTeamId,players,matchSeed+i);
    return{...m,homeScore,awayScore,played:true,winnerId};
  });

  const currentMatches=updatedMatches.filter(m=>m.round===cup.currentRound);
  if(currentMatches.some(m=>!m.played))return{...cup,matches:updatedMatches};

  const nextRound=roundOrder[currentIdx+1];
  if(!nextRound||nextRound==='done'){
    const winner=currentMatches[0]?.winnerId;
    return{...cup,matches:updatedMatches,currentRound:'done',winnerId:winner,
      userCupResult:currentMatches.find(m=>m.winnerId===userTeamId)?'Campeão':'Vice'};
  }

  const winners=currentMatches.map(m=>m.winnerId!).filter(Boolean);
  const userEliminated=!winners.includes(userTeamId);
  const newMatches:CupMatch[]=[];
  for(let i=0;i<winners.length;i+=2){
    if(i+1<winners.length){
      newMatches.push({id:`cup-${nextRound}-${i/2}`,homeTeamId:winners[i],awayTeamId:winners[i+1],homeScore:0,awayScore:0,played:false,round:nextRound});
    }
  }
  let userResult=cup.userCupResult;
  if(userEliminated)userResult=CUP_ROUND_LABELS[cup.currentRound];
  return{...cup,matches:[...updatedMatches,...newMatches],currentRound:nextRound,userCupResult:userResult};
}

/**
 * BUGFIX: Removido código morto (variáveis não usadas) e condição ||true.
 * Lógica simplificada para apenas checar se há partidas não jogadas na rodada atual.
 */
function checkPendingCupRound(cup:Cup|null,currentRound:number,userTeamId:string):CupRound|null{
  if(!cup||cup.currentRound==='done')return null;
  const unlock=CUP_UNLOCK_AFTER[cup.currentRound];
  if(unlock===undefined||currentRound<=unlock)return null;

  // Checa se há partida do usuário pendente nessa rodada
  const hasUnplayedUserMatch = cup.matches.some(m =>
    m.round === cup.currentRound &&
    !m.played &&
    (m.homeTeamId === userTeamId || m.awayTeamId === userTeamId)
  );
  return hasUnplayedUserMatch ? cup.currentRound : null;
}

// ─── Objetivos ────────────────────────────────────────────────────────────────
function generateObjectives(league:number,season:number):Objective[]{
  const objs:Objective[]=[];
  const posTarget=league===1?3:2;
  objs.push({id:`obj-${season}-pos`,description:`Terminar entre os ${posTarget} primeiros`,type:'league_position',target:posTarget,rewardMoney:posTarget*500_000,rewardRep:10,achieved:null});
  const cupTargets:Record<number,{round:string;val:number}>={1:{round:'Semi-final',val:3},2:{round:'Quartas',val:2},3:{round:'Oitavas',val:1}};
  const ct=cupTargets[Math.min(league,3)];
  objs.push({id:`obj-${season}-cup`,description:`Alcançar as ${ct.round} da Copa`,type:'cup_round',target:ct.val,rewardMoney:500_000,rewardRep:8,achieved:null});
  const winTarget=league===1?8:10;
  objs.push({id:`obj-${season}-wins`,description:`Vencer ${winTarget} jogos na temporada`,type:'win_count',target:winTarget,rewardMoney:winTarget*100_000,rewardRep:5,achieved:null});
  return objs;
}

function evaluateObjectives(objectives:Objective[],state:GameState,userPos:number,userChampion:boolean,userPromoted:boolean,totalWins:number,cup:Cup|null):Objective[]{
  const cupRoundValue=(r:string)=>({Campeão:4,Vice:4,'Semi-final':3,Quartas:2,Oitavas:1}[r]??0);
  return objectives.map(o=>{
    if(o.achieved!==null)return o;
    let achieved=false;
    if(o.type==='league_position')achieved=userPos<=o.target;
    if(o.type==='no_relegation')achieved=!state.teams.find(t=>t.id===state.userTeamId&&t.league>1);
    if(o.type==='win_count')achieved=totalWins>=o.target;
    if(o.type==='cup_round')achieved=cup?cupRoundValue(cup.userCupResult)>=o.target:false;
    return{...o,achieved};
  });
}

// ─── Mercado IA (sistema estratégico) ─────────────────────────────────────────

/**
 * IA de mercado profunda:
 * 1. Venda inteligente: lista jogadores por custo-benefício, idade, excesso de elenco
 * 2. Compra estratégica: prioriza posições carentes, preferências de idade por estratégia
 * 3. Múltiplas transferências por janela
 * 4. Gestão de contratos: libera salários altos de jogadores fracos
 */
function runAIMarket(players: Player[], teams: Team[], userTeamId: string): { players: Player[]; teams: Team[] } {
  let np = [...players];
  let nt = [...teams];

  // ─── Fase 1: IA lista jogadores à venda ───
  np = np.map(p => {
    if (p.teamId === userTeamId || p.listedForSale) return p;

    const teamPlayers = np.filter(q => q.teamId === p.teamId);
    const squadSize = teamPlayers.length;
    const posPlayers = teamPlayers.filter(q => q.position === p.position);
    const team = nt.find(t => t.id === p.teamId);
    if (!team) return p;

    // Razões para listar:
    let shouldList = false;

    // 1. Elenco inchado (>19 jogadores) → vende os mais fracos
    if (squadSize > 19) {
      const sorted = teamPlayers.sort((a, b) => b.strength - a.strength);
      const rank = sorted.indexOf(p);
      if (rank >= 16 && Math.random() < 0.4) shouldList = true;
    }

    // 2. Muitos na mesma posição (>4 para D/M, >3 para A, >2 para G)
    const maxPerPos = p.position === 'G' ? 2 : p.position === 'A' ? 3 : 4;
    if (posPlayers.length > maxPerPos) {
      const weakestInPos = posPlayers.sort((a, b) => b.strength - a.strength);
      if (p.id === weakestInPos[weakestInPos.length - 1]?.id && Math.random() < 0.5) shouldList = true;
    }

    // 3. Veterano caro: salário alto, performance baixa
    if (p.age >= 31 && p.salary > 30_000 && p.strength < 65 && Math.random() < 0.35) shouldList = true;

    // 4. Jogador envelhecendo com contrato expirando
    if (p.age >= 30 && p.contractYears <= 1 && Math.random() < 0.3) shouldList = true;

    // 5. Time com pouco dinheiro precisa vender
    if (team.money < 1_000_000 && p.value > 2_000_000 && Math.random() < 0.2) shouldList = true;

    return shouldList ? { ...p, listedForSale: true } : p;
  });

  // ─── Fase 2: IA compra jogadores ───
  // Cada time pode fazer até 2 transferências por rodada
  const shuffledTeams = [...nt].sort(() => Math.random() - 0.5);

  for (const team of shuffledTeams) {
    if (team.id === userTeamId) continue;
    const teamPlayers = np.filter(p => p.teamId === team.id);
    if (teamPlayers.length >= 20) continue;

    // Budget baseado em reputação e dinheiro disponível
    const budgetRatio = team.reputation >= 60 ? 0.35 : team.reputation >= 40 ? 0.25 : 0.20;
    let remainingBudget = team.money * budgetRatio;
    if (remainingBudget < 500_000) continue;
    if (Math.random() > 0.35) continue; // Nem todo time compra toda rodada

    // Analisa necessidades
    const posCounts: Record<string, number> = { G: 0, D: 0, M: 0, A: 0 };
    teamPlayers.forEach(p => { posCounts[p.position]++; });
    const avgStr = teamPlayers.reduce((s, p) => s + p.strength, 0) / Math.max(1, teamPlayers.length);

    // Prioridades de posição
    const posNeeds: { pos: string; priority: number }[] = [];
    if (posCounts.G < 2) posNeeds.push({ pos: 'G', priority: 3 });
    if (posCounts.D < 4) posNeeds.push({ pos: 'D', priority: 2 });
    if (posCounts.M < 4) posNeeds.push({ pos: 'M', priority: 2 });
    if (posCounts.A < 2) posNeeds.push({ pos: 'A', priority: 2 });

    // Se elenco fraco, prioriza fortalecimento geral
    if (posNeeds.length === 0 && avgStr < 60) {
      posNeeds.push({ pos: 'M', priority: 1 }, { pos: 'A', priority: 1 });
    }

    // Estratégia de idade baseada na reputação
    // Times fortes: compram experientes (win-now) — times fracos: investem em jovens
    const preferYoung = team.reputation < 45;
    const preferExperienced = team.reputation >= 65;

    let purchases = 0;
    const maxPurchases = Math.random() < 0.3 ? 2 : 1;

    for (const need of posNeeds.sort((a, b) => b.priority - a.priority)) {
      if (purchases >= maxPurchases || remainingBudget < 500_000) break;

      let candidates = np.filter(p => {
        const clause = (p as any).releaseClause ?? Math.floor(p.value * (1 + p.contractYears * 0.5));
        return p.listedForSale && p.teamId !== team.id && p.position === need.pos && clause <= remainingBudget;
      });

      if (candidates.length === 0) {
        // Fallback: qualquer posição
        candidates = np.filter(p => {
          const clause = (p as any).releaseClause ?? Math.floor(p.value * (1 + p.contractYears * 0.5));
          return p.listedForSale && p.teamId !== team.id && clause <= remainingBudget;
        });
      }

      if (candidates.length === 0) break;

      // Score de candidato: strength + ajustes por idade/valor/contrato
      candidates = candidates.map(c => {
        let score = c.strength;
        if (c.position === need.pos) score += 5;
        if (preferYoung && c.age <= 23) score += 4;
        if (preferYoung && c.age >= 30) score -= 6;
        if (preferExperienced && c.age >= 26 && c.age <= 31) score += 3;
        if (preferExperienced && c.age >= 33) score -= 3;
        // Custo-benefício usando multa rescisória
        const clause = (c as any).releaseClause ?? Math.floor(c.value * (1 + c.contractYears * 0.5));
        score += (c.strength / (clause / 1_000_000 + 1)) * 0.5;
        // Contrato curto = mais barato (paga menos multa)
        if (c.contractYears <= 1) score += 2;
        if (preferYoung && c.potential - c.strength > 10) score += 3;
        return { ...c, _score: score };
      }).sort((a, b) => (b as any)._score - (a as any)._score);

      const target = candidates[0];
      if (!target) break;

      // Paga a multa rescisória (ou o valor se não tiver multa definida)
      const price = (target as any).releaseClause ?? Math.floor(target.value * (1 + target.contractYears * 0.5));
      np = np.map(p => p.id === target.id ? { ...p, teamId: team.id, listedForSale: false, contractYears: rnd(2, 4) } : p);
      nt = nt.map(t =>
        t.id === team.id ? { ...t, money: t.money - price } :
        t.id === target.teamId ? { ...t, money: t.money + price } : t,
      );
      remainingBudget -= price;
      purchases++;
    }
  }

  // ─── Fase 3: IA libera jogadores com salário desproporcional ───
  for (const team of nt) {
    if (team.id === userTeamId) continue;
    const teamPlayers = np.filter(p => p.teamId === team.id);
    const totalSalary = teamPlayers.reduce((s, p) => s + p.salary, 0);

    // Se folha salarial > 30% do dinheiro, libera os piores
    if (totalSalary * 4 > team.money && teamPlayers.length > 16) {
      const overpaid = teamPlayers
        .filter(p => p.salary > 20_000 && p.strength < 55)
        .sort((a, b) => (b.salary / Math.max(1, b.strength)) - (a.salary / Math.max(1, a.strength)));
      if (overpaid[0] && Math.random() < 0.3) {
        np = np.map(p => p.id === overpaid[0].id ? { ...p, listedForSale: true } : p);
      }
    }
  }

  return { players: np, teams: nt };
}

// ─── Fim de temporada ─────────────────────────────────────────────────────────
function processEndOfSeason(state:GameState):GameState{
  const promoted:string[]=[],relegated:string[]=[];
  let nextTeams=[...state.teams];
  for(let league=1;league<=2;league++){
    const table=computeStandings(nextTeams,state.matches,league);
    const tableNext=computeStandings(nextTeams,state.matches,league+1);
    tableNext.slice(-3).forEach(t=>{promoted.push(t.id);nextTeams=nextTeams.map(x=>x.id===t.id?{...x,league}:x);});
    table.slice(-3).forEach(t=>{relegated.push(t.id);nextTeams=nextTeams.map(x=>x.id===t.id?{...x,league:league+1}:x);});
  }
  const uid=state.userTeamId!;
  const userLeague=state.teams.find(t=>t.id===uid)!.league;
  const userTable=computeStandings(state.teams,state.matches,userLeague);
  const userPos=userTable.findIndex(t=>t.id===uid)+1;
  const userPromoted=promoted.includes(uid),userRelegated=relegated.includes(uid),userChampion=userPos===1;
  const userStats=userTable.find(t=>t.id===uid)!;
  const totalWins=userStats.w;

  const evaluatedObjs=evaluateObjectives(state.objectives,state,userPos,userChampion,userPromoted,totalWins,state.cup);
  const objAchieved=evaluatedObjs.filter(o=>o.achieved).length;
  const objTotal=evaluatedObjs.length;

  nextTeams=nextTeams.map(t=>{
    if(t.id!==uid)return t;
    let fs=t.fanSatisfaction;
    if(userChampion)fs+=20;else if(userPromoted)fs+=15;else if(userRelegated)fs-=25;else if(userPos<=3)fs+=8;else if(userPos>=8)fs-=5;
    return{...t,fanSatisfaction:Math.max(0,Math.min(100,fs))};
  });

  nextTeams=nextTeams.map(t=>{
    if(t.id!==uid)return t;
    let rep=t.reputation;
    if(userChampion)rep+=15;else if(userPromoted)rep+=8;else if(userRelegated)rep-=12;else if(userPos<=3)rep+=5;else if(userPos>=8)rep-=3;
    if(state.cup?.winnerId===uid)rep+=10;
    return{...t,reputation:Math.max(0,Math.min(100,rep))};
  });

  let finTeams=nextTeams;
  if(objAchieved>0){
    const totalRewardMoney=evaluatedObjs.filter(o=>o.achieved).reduce((s,o)=>s+o.rewardMoney,0);
    finTeams=finTeams.map(t=>t.id!==uid?t:{...t,money:t.money+totalRewardMoney,finances:[...t.finances,makeRecord(state.currentRound,'income','objective',totalRewardMoney,`Bônus de objetivos (${objAchieved}/${objTotal})`)]});
  }

  // ── Premiação por posição final (todos os times) ──
  const PRIZE_MONEY: Record<number, number[]> = {
    1: [5_000_000, 3_500_000, 2_500_000, 2_000_000, 1_500_000, 1_000_000, 750_000, 500_000, 300_000, 200_000],
    2: [2_000_000, 1_500_000, 1_000_000, 750_000, 500_000, 400_000, 300_000, 200_000, 150_000, 100_000],
    3: [800_000, 600_000, 400_000, 300_000, 200_000, 150_000, 100_000, 75_000, 50_000, 50_000],
  };
  for (let league = 1; league <= 3; league++) {
    const table = computeStandings(state.teams, state.matches, league);
    const prizes = PRIZE_MONEY[league];
    table.forEach((entry, idx) => {
      const prize = prizes[Math.min(idx, prizes.length - 1)];
      finTeams = finTeams.map(t => t.id !== entry.id ? t : {
        ...t,
        money: t.money + prize,
        finances: [...t.finances, makeRecord(state.currentRound, 'income', 'objective', prize, `Premiação ${idx + 1}º lugar`)],
      });
    });
  }

  // ── Renegociação de patrocínio (todos os times, por liga/reputação/resultado) ──
  finTeams = finTeams.map(t => {
    const leagueMult = t.league === 1 ? 1.0 : t.league === 2 ? 0.55 : 0.25;
    const repMult = 0.5 + (t.reputation / 100);
    const baseSponsor = 200_000 + Math.floor(Math.random() * 80_000);
    const newSponsorship = Math.floor(baseSponsor * leagueMult * repMult);

    // Times promovidos ganham boost de patrocínio
    const wasPromoted = promoted.includes(t.id);
    const wasRelegated = relegated.includes(t.id);
    const promoBonus = wasPromoted ? 1.3 : wasRelegated ? 0.7 : 1.0;

    return {
      ...t,
      sponsorshipIncome: Math.floor(newSponsorship * promoBonus),
    };
  });

  // ── Inflação salarial (3-6% por temporada, realista) ──
  const inflationRate = 1 + (0.03 + Math.random() * 0.03); // 3-6%

  // Envelhecimento com progressão/regressão por idade + inflação salarial
  let nextPlayers = state.players.map(p => {
    const aged = { ...p, age: p.age + 1, yellowCards: 0, redCard: false, injuryWeeksLeft: 0, contractYears: Math.max(0, p.contractYears - 1) };
    const progression = applyAgeProgression(aged);

    // Salário inflaciona naturalmente
    const newSalary = Math.floor(aged.salary * inflationRate);

    return {
      ...aged,
      attributes: progression.attributes,
      strength: progression.strength,
      potential: progression.potential,
      salary: newSalary,
      goals: 0, assists: 0, matchesPlayed: 0, formStreak: 0, trainingProgress: 0,
    };
  });
  const retiredNames: string[] = [];
  nextPlayers = nextPlayers.filter(p => {
    const retire = p.age >= 39 || (p.age >= 35 && p.strength < 55) || (p.age >= 37 && p.strength < 60);
    if (retire) retiredNames.push(p.name);
    return !retire;
  });
  nextPlayers = nextPlayers.map(p => p.contractYears === 0 && p.teamId !== uid ? { ...p, listedForSale: true } : p);

  // ── Atualiza valor de mercado e multa rescisória ──
  nextPlayers = nextPlayers.map(p => {
    const team = finTeams.find(t => t.id === p.teamId);
    const leagueMult = team ? (team.league === 1 ? 1.2 : team.league === 2 ? 0.8 : 0.5) : 1;

    let value = Math.max(10_000, (p.strength - 40) * 400_000 * leagueMult);

    // Ajustes por idade e potencial
    if (p.age < 21) value *= 1.8;
    else if (p.age < 23) value *= 1.5;
    else if (p.age > 30) value *= 0.6;
    else if (p.age > 32) value *= 0.35;
    if (p.potential - p.strength > 15) value *= 1.4;

    // Inflação acumulada por temporada
    value *= Math.pow(inflationRate, 0.5);

    // Multa rescisória: valor base × (1 + anos restantes × 0.5)
    // Jogador com 3 anos de contrato tem multa 2.5× o valor
    // Jogador com 0 anos (livre): multa = valor base (vai embora por pouco)
    const releaseClause = Math.floor(value * (1 + p.contractYears * 0.5));

    return { ...p, value: Math.floor(value), releaseClause };
  });

  // ── Normalização econômica da IA (evita times da IA quebrarem ou acumularem infinito) ──
  finTeams = finTeams.map(t => {
    if (t.id === uid) return t; // Não toca no time do jogador
    const leagueBaseMoney = t.league === 1 ? 10_000_000 : t.league === 2 ? 5_000_000 : 2_500_000;
    const minMoney = leagueBaseMoney * 0.3;
    const maxMoney = leagueBaseMoney * 3;

    let money = t.money;
    // Se muito pobre, recebe injeção (simulando novos investidores/reforço da federação)
    if (money < minMoney) money = minMoney + rnd(0, Math.floor(leagueBaseMoney * 0.2));
    // Se acumulou demais, gasta em infraestrutura (não aparece pro jogador)
    if (money > maxMoney) money = maxMoney - rnd(0, Math.floor(leagueBaseMoney * 0.3));

    // Manutenção escala com nível do estádio (1-3% de aumento por temporada)
    const newMaintenance = Math.floor(t.stadium.maintenanceCost * (1 + 0.02));

    return { ...t, money, stadium: { ...t.stadium, maintenanceCost: newMaintenance } };
  });

  // Reposição
  for(const team of finTeams){
    const count=nextPlayers.filter(p=>p.teamId===team.id).length;
    if(count<16){
      const pos:('G'|'D'|'M'|'A')[]=['G','D','D','M','M','A'];
      for(let i=0;i<16-count;i++)nextPlayers.push(generatePlayer(team.id,pos[i%pos.length],team.league,rnd(18,26)));
    }
  }

  // Academia
  const userTeamObj=finTeams.find(t=>t.id===uid)!;
  const youthNames:string[]=[];
  if(userTeamObj.academyLevel>0){
    const academyInfo=ACADEMY_INFO[userTeamObj.academyLevel];
    const pos:('G'|'D'|'M'|'A')[]=['M','A','D','G','M','A'];
    for(let i=0;i<academyInfo.youthPerSeason;i++){
      const youth=generatePlayer(uid,pos[i%pos.length],userTeamObj.league,rnd(16,19),true);
      nextPlayers.push(youth);youthNames.push(youth.name);
    }
  }

  const allGoals=state.players.map(p=>({name:p.name,goals:p.goals,team:state.teams.find(t=>t.id===p.teamId)?.name??''})).sort((a,b)=>b.goals-a.goals);
  const topScorer=allGoals[0]?.goals>0?allGoals[0]:null;

  const newManager={...state.manager};
  if(userChampion){newManager.titles++;newManager.reputation=Math.min(100,newManager.reputation+10);}
  if(userRelegated)newManager.reputation=Math.max(0,newManager.reputation-5);
  newManager.reputation=Math.max(0,Math.min(100,newManager.reputation+evaluatedObjs.filter(o=>o.achieved).reduce((s,o)=>s+o.rewardRep,0)));

  const cupResult=state.cup?.userCupResult??'Não participou';

  const record:SeasonRecord={
    season:state.season,league:userLeague,position:userPos,
    wins:userStats.w,draws:userStats.d,losses:userStats.l,
    goalsFor:userStats.gf,goalsAgainst:userStats.ga,
    cupResult,promoted:userPromoted,relegated:userRelegated,champion:userChampion,
    objectivesAchieved:objAchieved,objectivesTotal:objTotal,
    moneyEnd:userTeamObj.money,
  };

  const summary:SeasonSummary={
    season:state.season,userLeague,userPosition:userPos,promoted,relegated,
    topScorer,retired:retiredNames,youthGenerated:youthNames,cupResult,
    objectivesAchieved:objAchieved,objectivesTotal:objTotal,
  };

  const newMatches=generateFixtures(finTeams);
  const newCup=generateCup(finTeams,uid,state.season+1);
  const newObjectives=generateObjectives(finTeams.find(t=>t.id===uid)!.league,state.season+1);

  return{
    ...state,teams:finTeams,players:nextPlayers,matches:newMatches,
    currentRound:1,season:state.season+1,phase:'offseason',
    lastSeasonSummary:summary,cup:newCup,objectives:newObjectives,
    seasonHistory:[...state.seasonHistory,record],manager:newManager,
    userLineup:[],pendingCupRound:null,
  };
}

// ─── Reducer ──────────────────────────────────────────────────────────────────
export function gameReducer(state:GameState|null,action:GameAction):GameState|null{
  switch(action.type){

    case 'INIT_GAME': {
      const s=action.payload;
      const uid=s.userTeamId!;
      const ut=s.teams.find(t=>t.id===uid)!;
      const cup=s.cup??generateCup(s.teams,uid,1);
      const objectives=s.objectives.length>0?s.objectives:generateObjectives(ut.league,1);
      return{...s,cup,objectives};
    }
    case 'NEW_GAME':  return null;
    case 'START_NEW_SEASON': {
      if(!state)return null;
      return{...state,phase:'season'};
    }

    // ── MATCH DAY COMPLETE ──────────────────────────────────────────────────
    case 'MATCH_DAY_COMPLETE': {
      if(!state)return null;
      const{updatedMatches,playerUpdates,report}=action.payload;
      const uid=state.userTeamId!;
      const userUpdated=updatedMatches.find(m=>m.homeTeamId===uid||m.awayTeamId===uid)!;
      const isHome=userUpdated.homeTeamId===uid;
      const ug=isHome?userUpdated.homeScore:userUpdated.awayScore;
      const og=isHome?userUpdated.awayScore:userUpdated.homeScore;
      const isWin=ug>og,isDraw=ug===og,isLoss=ug<og;
      const playedIds=new Set(playerUpdates.map(u=>u.id));
      const medicoLevel=state.staff.medico??0,prepLevel=state.staff.preparador??0;

      // Dados do relatório para forma individual
      const cleanSheet = (isHome ? report.awayScore : report.homeScore) === 0;
      const goalsByPlayer = new Map<string, number>();
      const assistsByPlayer = new Map<string, number>();
      const redCardPlayers = new Set<string>();
      const injuredPlayers = new Set<string>();

      report.goalEvents.forEach(g => {
        if (g.teamId === uid) {
          goalsByPlayer.set(g.playerId, (goalsByPlayer.get(g.playerId) ?? 0) + 1);
          if (g.assistId) assistsByPlayer.set(g.assistId, (assistsByPlayer.get(g.assistId) ?? 0) + 1);
        }
      });
      report.cards.filter(c => c.type === 'red' && c.teamId === uid).forEach(c => redCardPlayers.add(c.playerId));
      report.injuries.filter(i => i.teamId === uid).forEach(i => injuredPlayers.add(i.playerId));

      let np=state.players.map(p=>{
        const isUser=p.teamId===uid;
        const played = playedIds.has(p.id);

        // Moral
        let moraleChange=0;
        if(isUser){
          if(isWin)moraleChange+=5;
          if(isLoss)moraleChange-=5;
          moraleChange+=played?2:-2;
        }

        // Forma baseada em performance individual (novo sistema)
        let newForm = p.formStreak;
        if (isUser) {
          const formDelta = computeFormDelta(
            p, played, isWin, isDraw, isLoss,
            goalsByPlayer.get(p.id) ?? 0,
            assistsByPlayer.get(p.id) ?? 0,
            redCardPlayers.has(p.id),
            injuredPlayers.has(p.id),
            cleanSheet,
          );
          newForm = Math.max(-5, Math.min(5, p.formStreak + formDelta));
        }

        // Energia variável
        let energyRecovery: number;
        if (p.injuryWeeksLeft > 0) {
          energyRecovery = 5;
        } else if (played) {
          energyRecovery = 15 + (isUser ? prepLevel * 5 : 0);
        } else {
          energyRecovery = 30 + (isUser ? prepLevel * 3 : 0);
        }

        return{
          ...p,
          energy:Math.min(100,p.energy+energyRecovery),
          injuryWeeksLeft:Math.max(0,p.injuryWeeksLeft-1-(isUser?medicoLevel:0)),
          morale:Math.max(0,Math.min(100,p.morale+moraleChange)),
          formStreak:Math.round(newForm * 10) / 10,  // mantém 1 casa decimal
        };
      });
      playerUpdates.forEach(u=>{const idx=np.findIndex(p=>p.id===u.id);if(idx!==-1)np[idx]={...np[idx],...u};});

      let nt=state.teams.map(team=>{
        const tm=updatedMatches.find(m=>m.homeTeamId===team.id||m.awayTeamId===team.id);
        if(!tm)return team;
        let money=team.money;const finances=[...team.finances];const round=state.currentRound;
        const repMult=0.7+(team.reputation/333);
        const leagueMult = team.league === 1 ? 1.0 : team.league === 2 ? 0.6 : 0.35;

        // ── RECEITAS ──

        // 1. Bilheteria (só mandante) — público varia com: capacidade, fanSatisfaction, liga, reputação do oponente
        if(tm.homeTeamId===team.id){
          const opp = state.teams.find(t => t.id === tm.awayTeamId);
          const oppRepBoost = opp ? 1 + (opp.reputation - 50) / 500 : 1; // rival forte atrai mais público
          const fanMult=team.id===uid? 0.5+(team.fanSatisfaction/200) : 0.6+(team.reputation/250);
          const baseFill = 0.35 + Math.random() * 0.55;
          const att=Math.floor(team.stadium.capacity * baseFill * fanMult * oppRepBoost);
          const inc=att*team.stadium.ticketPrice;money+=inc;
          finances.push(makeRecord(round,'income','tickets',inc,`Bilheteria (${att.toLocaleString('pt-BR')} pagantes)`));
        }

        // 2. Patrocínio (proporcional à rodada, escalado por liga e reputação)
        const spon=Math.floor(team.sponsorshipIncome/TOTAL_SEASON_ROUNDS*repMult);
        money+=spon;finances.push(makeRecord(round,'income','sponsorship',spon,'Patrocínio'));

        // 3. Cotas de TV (receita fixa por liga, distribuída por rodada)
        const tvRights = Math.floor((team.league === 1 ? 150_000 : team.league === 2 ? 60_000 : 20_000) * repMult);
        money += tvRights;
        finances.push(makeRecord(round, 'income', 'sponsorship', tvRights, 'Cotas de TV'));

        // ── DESPESAS ──

        // 4. Salários do elenco
        const sal=Math.floor(np.filter(p=>p.teamId===team.id).reduce((s,p)=>s+p.salary,0)/4);
        money-=sal;finances.push(makeRecord(round,'expense','salaries',sal,'Salários do elenco'));

        // 5. Manutenção do estádio (escala com nível)
        money-=team.stadium.maintenanceCost;
        finances.push(makeRecord(round,'expense','maintenance',team.stadium.maintenanceCost,'Manutenção do estádio'));

        // 6. Salários do staff (novo custo recorrente)
        if (team.id === uid) {
          const staffCost = Object.entries(state.staff).reduce((s, [_, level]) => {
            return s + (level as number) * 15_000; // R$15k por nível de staff por rodada
          }, 0);
          if (staffCost > 0) {
            money -= staffCost;
            finances.push(makeRecord(round, 'expense', 'staff', staffCost, `Staff (${Object.keys(state.staff).length} funcionários)`));
          }
        }

        // 7. Custos operacionais da liga (viagens, arbitragem, etc.)
        const opsCost = Math.floor(25_000 * leagueMult);
        money -= opsCost;
        finances.push(makeRecord(round, 'expense', 'maintenance', opsCost, 'Custos operacionais'));

        return{...team,money,finances};
      });

      nt=nt.map(t=>{
        if(t.id!==uid)return t;
        const fsDelta=isWin?5:isDraw?1:-4;
        const repDelta=isWin?0.5:isDraw?0:-0.5;
        return{...t,fanSatisfaction:Math.max(0,Math.min(100,t.fanSatisfaction+fsDelta)),reputation:Math.max(0,Math.min(100,t.reputation+repDelta))};
      });

      const aiRes=runAIMarket(np,nt,uid);np=aiRes.players;nt=aiRes.teams;
      const nm=state.matches.map(m=>updatedMatches.find(s=>s.id===m.id)??m);
      const nl=state.userLineup.filter(id=>{const p=np.find(p=>p.id===id);return p&&!p.redCard&&p.injuryWeeksLeft===0&&p.teamId===uid;});
      const newMgr={...state.manager,matchesManaged:state.manager.matchesManaged+1};
      if(isWin){newMgr.wins++;newMgr.reputation=Math.min(100,newMgr.reputation+1);}
      if(isDraw)newMgr.draws++;
      if(isLoss){newMgr.losses++;newMgr.reputation=Math.max(0,newMgr.reputation-1);}

      const nextRound=state.currentRound+1;
      const seasonOver=nextRound>TOTAL_SEASON_ROUNDS;

      let nextCup=state.cup;
      if(nextCup&&!seasonOver){
        const unlock=CUP_UNLOCK_AFTER[nextCup.currentRound];
        if(unlock!==undefined&&nextRound>unlock){
          const userInCup=nextCup.matches.filter(m=>m.round===nextCup!.currentRound).some(m=>m.homeTeamId===uid||m.awayTeamId===uid);
          if(!userInCup)nextCup=advanceCupRound(nextCup,np,uid);
        }
      }
      // BUGFIX: passa userTeamId para checkPendingCupRound
      const pendingCup=nextCup?checkPendingCupRound(nextCup,nextRound,uid):null;

      const intermediate:GameState={...state,players:np,teams:nt,matches:nm,currentRound:nextRound,userLineup:nl,manager:newMgr,cup:nextCup,lastMatchReport:report,pendingCupRound:pendingCup};
      return seasonOver?processEndOfSeason(intermediate):intermediate;
    }

    // ── CUP MATCH COMPLETE ──────────────────────────────────────────────────
    case 'CUP_MATCH_COMPLETE': {
      if(!state||!state.cup)return state;
      const{cupMatchId,homeScore,awayScore,playerUpdates}=action.payload;
      const uid=state.userTeamId!;
      let np=[...state.players];
      playerUpdates.forEach(u=>{const idx=np.findIndex(p=>p.id===u.id);if(idx!==-1)np[idx]={...np[idx],...u};});

      let updatedCupMatches=state.cup.matches.map(m=>{
        if(m.id!==cupMatchId)return m;
        const winnerId=homeScore>awayScore?m.homeTeamId:awayScore>homeScore?m.awayTeamId:Math.random()<0.5?m.homeTeamId:m.awayTeamId;
        return{...m,homeScore,awayScore,played:true,winnerId};
      });
      let updatedCup={...state.cup,matches:updatedCupMatches};
      updatedCup=advanceCupRound(updatedCup,np,uid);

      return{...state,players:np,cup:updatedCup,pendingCupRound:null};
    }

    // ── STADIUM ─────────────────────────────────────────────────────────────
    case 'UPGRADE_STADIUM': {
      if(!state)return null;
      const ut=state.teams.find(t=>t.id===state.userTeamId)!;
      const cost=ut.stadium.level*2_000_000;
      if(ut.money<cost)return state;
      return{...state,teams:state.teams.map(t=>{if(t.id!==state.userTeamId)return t;const s={...t.stadium,level:t.stadium.level+1,capacity:t.stadium.capacity+10_000,ticketPrice:t.stadium.ticketPrice+10,maintenanceCost:t.stadium.maintenanceCost+20_000};return{...t,money:t.money-cost,stadium:s,finances:[...t.finances,makeRecord(state.currentRound,'expense','stadium_upgrade',cost,`Ampliação Nível ${s.level}`)]};})};
    }

    case 'UPGRADE_ACADEMY': {
      if(!state)return null;
      const ut=state.teams.find(t=>t.id===state.userTeamId)!;
      if(ut.academyLevel>=3)return state;
      const nl=ut.academyLevel+1,cost=ACADEMY_INFO[nl].cost;
      if(ut.money<cost)return state;
      return{...state,teams:state.teams.map(t=>t.id!==state.userTeamId?t:{...t,academyLevel:nl,money:t.money-cost,finances:[...t.finances,makeRecord(state.currentRound,'expense','academy',cost,`Academia Nível ${nl}`)]})};
    }

    case 'TRAIN_PLAYER': {
      if(!state)return null;
      const ut=state.teams.find(t=>t.id===state.userTeamId)!;
      if(ut.money<50_000)return state;
      const baseProgress=state.manager.specialization==='desenvolvedor'?50:25;
      return{...state,teams:state.teams.map(t=>t.id===state.userTeamId?{...t,money:t.money-50_000}:t),
        players:state.players.map(p=>{
          if(p.id!==action.payload.playerId)return p;
          const result = processTraining(p, baseProgress, action.payload.attribute);
          return{
            ...p,
            trainingProgress: result.trainingProgress,
            attributes: result.attributes ?? p.attributes,
            strength: result.strength ?? p.strength,
            potential: result.potential ?? p.potential,
          };
        })};
    }

    case 'TOGGLE_LINEUP_PLAYER': {
      if(!state)return null;
      const p=state.players.find(p=>p.id===action.payload.playerId);
      if(p?.redCard||(p?.injuryWeeksLeft??0)>0)return state;
      const sel=state.userLineup.includes(action.payload.playerId);
      return{...state,userLineup:sel?state.userLineup.filter(id=>id!==action.payload.playerId):state.userLineup.length<11?[...state.userLineup,action.payload.playerId]:state.userLineup};
    }

    case 'SET_FORMATION': {
      if(!state)return null;
      const f=action.payload;
      const up=state.players.filter(p=>p.teamId===state.userTeamId&&!p.redCard&&p.injuryWeeksLeft===0);
      return{...state,formation:f,userLineup:getBestLineup(up,f).map(p=>p.id)};
    }

    case 'SET_SPECIALIZATION':
      if(!state)return null;
      return{...state,manager:{...state.manager,specialization:action.payload}};

    case 'HIRE_STAFF': {
      if(!state)return null;
      const{role}=action.payload;
      const ut=state.teams.find(t=>t.id===state.userTeamId)!;
      const cl=state.staff[role]??0;if(cl>=3)return state;
      const nl=cl+1,cost=STAFF_INFO[role].hireCost[nl-1];
      if(ut.money<cost)return state;
      return{...state,staff:{...state.staff,[role]:nl},teams:state.teams.map(t=>t.id!==state.userTeamId?t:{...t,money:t.money-cost,finances:[...t.finances,makeRecord(state.currentRound,'expense','staff',cost,`${STAFF_INFO[role].label} Nível ${nl}`)]})};
    }

    case 'NEGOTIATE_CONTRACT': {
      if(!state)return null;
      const{playerId,newSalary,years}=action.payload;
      const player=state.players.find(p=>p.id===playerId);
      const ut=state.teams.find(t=>t.id===state.userTeamId)!;
      if(!player||player.teamId!==state.userTeamId)return state;
      const bonus=newSalary>player.salary?newSalary*0.5:0;
      if(ut.money<bonus)return state;
      const newReleaseClause = Math.floor(player.value * (1 + years * 0.5));
      return{...state,
        teams:state.teams.map(t=>t.id!==state.userTeamId?t:{...t,money:t.money-bonus,finances:[...t.finances,makeRecord(state.currentRound,'expense','transfer',bonus,`Renovação de ${player.name}`)]}),
        players:state.players.map(p=>p.id===playerId?{...p,salary:newSalary,contractYears:years,releaseClause:newReleaseClause}:p),
      };
    }

    case 'TOGGLE_LIST_PLAYER':
      if(!state)return null;
      return{...state,players:state.players.map(p=>p.id===action.payload.playerId?{...p,listedForSale:!p.listedForSale}:p)};

    case 'BUY_PLAYER': {
      if(!state)return null;
      if(!TRANSFER_WINDOW_ROUNDS.has(state.currentRound))return state;
      const{playerId,amount}=action.payload;
      const player=state.players.find(p=>p.id===playerId);
      const ut=state.teams.find(t=>t.id===state.userTeamId)!;
      const st=state.teams.find(t=>t.id===player?.teamId);
      if(!player||!st||ut.money<amount||!player.listedForSale)return state;

      // Preço mínimo baseado na multa rescisória (valor × contrato restante)
      // Se não tem releaseClause calculada, calcula na hora
      const releaseClause = (player as any).releaseClause ?? Math.floor(player.value * (1 + player.contractYears * 0.5));
      const minAcceptable = Math.floor(releaseClause * (0.85 + Math.random() * 0.15));

      if (amount < minAcceptable) return state; // Oferta insuficiente

      return{...state,teams:state.teams.map(t=>{
        if(t.id===ut.id)return{...t,money:t.money-amount,finances:[...t.finances,makeRecord(state.currentRound,'expense','transfer',amount,`Compra de ${player.name}`)]};
        if(t.id===st.id)return{...t,money:t.money+amount,finances:[...t.finances,makeRecord(state.currentRound,'income','transfer',amount,`Venda de ${player.name}`)]};
        return t;
      }),players:state.players.map(p=>p.id===playerId?{...p,teamId:ut.id,listedForSale:false,contractYears:rnd(2,4)}:p)};
    }

    case 'UPDATE_MANAGER':
      if(!state)return null;
      return{...state,manager:{...state.manager,...action.payload}};

    default: return state;
  }
}