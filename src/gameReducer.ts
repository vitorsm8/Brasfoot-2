import {
  GameState,Player,Match,Team,FinanceRecord,Cup,CupMatch,CupRound,
  Objective,ObjectiveType,SeasonRecord,SeasonSummary,MatchReport,
  Formation,Specialization,StaffRole,STAFF_INFO,PRIMARY_ATTRS,
  TOTAL_SEASON_ROUNDS,TRANSFER_WINDOW_ROUNDS,ACADEMY_INFO,
  CUP_UNLOCK_AFTER,CUP_ROUND_LABELS,
} from './types';
import { getBestLineup, computeOverall } from './engine';
import { generatePlayer, generateFixtures } from './data';

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
    h.gf+=m.homeScore;h.ga+=m.awayScore;a.gf+=m.awayScore;a.ga+=m.homeScore;
    if(m.homeScore>m.awayScore){h.pts+=3;h.w++;a.l++;}
    else if(m.homeScore<m.awayScore){a.pts+=3;a.w++;h.l++;}
    else{h.pts++;a.pts++;h.d++;a.d++;}
  });
  return table.sort((a,b)=>b.pts-a.pts||(b.w-a.w)||(b.gf-b.ga)-(a.gf-a.ga));
}

// ─── Copa ─────────────────────────────────────────────────────────────────────
function simCupMatch(homeId:string,awayId:string,players:Player[]):{homeScore:number;awayScore:number;winnerId:string}{
  const str=(tid:string)=>{const ps=players.filter(p=>p.teamId===tid);return ps.length?ps.reduce((s,p)=>s+p.strength,0)/ps.length:50;};
  const ha=str(homeId),aa=str(awayId),total=ha+aa;
  const hGoals=Math.round((ha/total)*Math.random()*4),aGoals=Math.round((aa/total)*Math.random()*4);
  const winnerId=hGoals>aGoals?homeId:aGoals>hGoals?awayId:Math.random()<0.5?homeId:awayId;
  return{homeScore:hGoals,awayScore:aGoals,winnerId};
}

function generateCup(teams:Team[],userTeamId:string,season:number):Cup{
  // 16 teams: user + 5 L1 random + 6 L2 random + 4 L3 random
  const others=teams.filter(t=>t.id!==userTeamId);
  const l1=others.filter(t=>t.league===1).sort(()=>Math.random()-0.5).slice(0,5).map(t=>t.id);
  const l2=others.filter(t=>t.league===2).sort(()=>Math.random()-0.5).slice(0,6).map(t=>t.id);
  const l3=others.filter(t=>t.league===3).sort(()=>Math.random()-0.5).slice(0,4).map(t=>t.id);
  const participants=[userTeamId,...l1,...l2,...l3].slice(0,16);
  while(participants.length<16)participants.push(others[rnd(0,others.length-1)].id);
  // Gera R16 (8 jogos)
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
  // Auto-sim all unplayed AI matches in current round
  let updatedMatches=[...cup.matches];
  updatedMatches=updatedMatches.map(m=>{
    if(m.round!==cup.currentRound||m.played||m.homeTeamId===userTeamId||m.awayTeamId===userTeamId)return m;
    const{homeScore,awayScore,winnerId}=simCupMatch(m.homeTeamId,m.awayTeamId,players);
    return{...m,homeScore,awayScore,played:true,winnerId};
  });
  // Check if all current round matches played
  const currentMatches=updatedMatches.filter(m=>m.round===cup.currentRound);
  if(currentMatches.some(m=>!m.played))return{...cup,matches:updatedMatches};
  // All played → generate next round
  const nextRound=roundOrder[currentIdx+1];
  if(!nextRound||nextRound==='done'){
    const winner=currentMatches[0]?.winnerId;
    return{...cup,matches:updatedMatches,currentRound:'done',winnerId:winner,
      userCupResult:currentMatches.find(m=>m.winnerId===userTeamId)?'Campeão':'Vice'};
  }
  // Build next round matches from winners
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

function checkPendingCupRound(cup:Cup|null,currentRound:number):CupRound|null{
  if(!cup||cup.currentRound==='done')return null;
  const unlock=CUP_UNLOCK_AFTER[cup.currentRound];
  if(unlock===undefined||currentRound<=unlock)return null;
  const userMatch=cup.matches.find(m=>m.round===cup.currentRound&&(m.homeTeamId||m.awayTeamId));
  const hasUnplayedUserMatch=cup.matches.some(m=>m.round===cup.currentRound&&!m.played&&(m.homeTeamId===cup.matches[0]?.homeTeamId||true));
  const allPlayed=cup.matches.filter(m=>m.round===cup.currentRound).every(m=>m.played);
  if(allPlayed)return null;
  return cup.currentRound;
}

// ─── Objetivos ────────────────────────────────────────────────────────────────
function generateObjectives(league:number,season:number):Objective[]{
  const objs:Objective[]=[];
  // 1. Liga
  const posTarget=league===1?3:2;
  objs.push({id:`obj-${season}-pos`,description:`Terminar entre os ${posTarget} primeiros`,type:'league_position',target:posTarget,rewardMoney:posTarget*500_000,rewardRep:10,achieved:null});
  // 2. Copa
  const cupTargets:Record<number,{round:string;val:number}>=  {1:{round:'Semi-final',val:3},2:{round:'Quartas',val:2},3:{round:'Oitavas',val:1}};
  const ct=cupTargets[Math.min(league,3)];
  objs.push({id:`obj-${season}-cup`,description:`Alcançar as ${ct.round} da Copa`,type:'cup_round',target:ct.val,rewardMoney:500_000,rewardRep:8,achieved:null});
  // 3. Vitórias
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

// ─── Mercado IA ───────────────────────────────────────────────────────────────
function runAIMarket(players:Player[],teams:Team[],userTeamId:string):{players:Player[];teams:Team[]}{
  let np=players.map(p=>{
    if(p.teamId===userTeamId||p.listedForSale)return p;
    const ts=players.filter(q=>q.teamId===p.teamId).length;
    return(p.age>=32&&p.strength<65||ts>19)&&Math.random()<0.2?{...p,listedForSale:true}:p;
  });
  let nt=[...teams];
  for(const team of nt){
    if(team.id===userTeamId||team.money<2_000_000||Math.random()>0.25)continue;
    if(np.filter(p=>p.teamId===team.id).length>=20)continue;
    const budget=team.money*0.25;
    const cands=np.filter(p=>p.listedForSale&&p.teamId!==team.id&&p.value<=budget).sort((a,b)=>b.strength-a.strength);
    if(!cands[0])continue;
    const target=cands[0],seller=target.teamId;
    np=np.map(p=>p.id===target.id?{...p,teamId:team.id,listedForSale:false}:p);
    nt=nt.map(t=>t.id===team.id?{...t,money:t.money-target.value}:t.id===seller?{...t,money:t.money+target.value}:t);
  }
  return{players:np,teams:nt};
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

  // Avalia objetivos
  const evaluatedObjs=evaluateObjectives(state.objectives,state,userPos,userChampion,userPromoted,totalWins,state.cup);
  const objAchieved=evaluatedObjs.filter(o=>o.achieved).length;
  const objTotal=evaluatedObjs.length;

  // Fan satisfaction
  nextTeams=nextTeams.map(t=>{
    if(t.id!==uid)return t;
    let fs=t.fanSatisfaction;
    if(userChampion)fs+=20;else if(userPromoted)fs+=15;else if(userRelegated)fs-=25;else if(userPos<=3)fs+=8;else if(userPos>=8)fs-=5;
    return{...t,fanSatisfaction:Math.max(0,Math.min(100,fs))};
  });

  // Reputação por resultado
  nextTeams=nextTeams.map(t=>{
    if(t.id!==uid)return t;
    let rep=t.reputation;
    if(userChampion)rep+=15;else if(userPromoted)rep+=8;else if(userRelegated)rep-=12;else if(userPos<=3)rep+=5;else if(userPos>=8)rep-=3;
    if(state.cup?.winnerId===uid)rep+=10;
    return{...t,reputation:Math.max(0,Math.min(100,rep))};
  });

  // Recompensas de objetivos
  let finTeams=nextTeams;
  if(objAchieved>0){
    const totalRewardMoney=evaluatedObjs.filter(o=>o.achieved).reduce((s,o)=>s+o.rewardMoney,0);
    const totalRewardRep=evaluatedObjs.filter(o=>o.achieved).reduce((s,o)=>s+o.rewardRep,0);
    finTeams=finTeams.map(t=>t.id!==uid?t:{...t,money:t.money+totalRewardMoney,finances:[...t.finances,makeRecord(state.currentRound,'income','objective',totalRewardMoney,`Bônus de objetivos (${objAchieved}/${objTotal})`)]});
    // (rep do manager)
  }

  // Envelhecimento, contratos, aposentadoria
  let nextPlayers=state.players.map(p=>({...p,age:p.age+1,yellowCards:0,redCard:false,injuryWeeksLeft:0,contractYears:Math.max(0,p.contractYears-1)}));
  const retiredNames:string[]=[];
  nextPlayers=nextPlayers.filter(p=>{
    const retire=p.age>=39||(p.age>=35&&p.strength<60);
    if(retire)retiredNames.push(p.name);
    return!retire;
  });
  // Contratos expirados → free agents
  nextPlayers=nextPlayers.map(p=>p.contractYears===0&&p.teamId!==uid?{...p,listedForSale:true}:p);

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

  // Top scorer
  const allGoals=state.players.map(p=>({name:p.name,goals:p.goals,team:state.teams.find(t=>t.id===p.teamId)?.name??''})).sort((a,b)=>b.goals-a.goals);
  const topScorer=allGoals[0]?.goals>0?allGoals[0]:null;

  // Manager
  const newManager={...state.manager};
  if(userChampion){newManager.titles++;newManager.reputation=Math.min(100,newManager.reputation+10);}
  if(userRelegated)newManager.reputation=Math.max(0,newManager.reputation-5);
  newManager.reputation=Math.max(0,Math.min(100,newManager.reputation+evaluatedObjs.filter(o=>o.achieved).reduce((s,o)=>s+o.rewardRep,0)));

  const cupResult=state.cup?.userCupResult??'Não participou';

  // Histórico
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
      const formDelta=isWin?1:isLoss?-1:0;
      const playedIds=new Set(playerUpdates.map(u=>u.id));
      const medicoLevel=state.staff.medico??0,prepLevel=state.staff.preparador??0;

      let np=state.players.map(p=>{
        const isUser=p.teamId===uid;
        let moraleChange=0;
        if(isUser){if(isWin)moraleChange+=5;if(isLoss)moraleChange-=5;moraleChange+=playedIds.has(p.id)?2:-2;}
        const newForm=isUser&&playedIds.has(p.id)?Math.max(-5,Math.min(5,p.formStreak+formDelta)):p.formStreak;
        return{...p,energy:Math.min(100,p.energy+20+(isUser?prepLevel*5:0)),injuryWeeksLeft:Math.max(0,p.injuryWeeksLeft-1-(isUser?medicoLevel:0)),morale:Math.max(0,Math.min(100,p.morale+moraleChange)),formStreak:newForm};
      });
      playerUpdates.forEach(u=>{const idx=np.findIndex(p=>p.id===u.id);if(idx!==-1)np[idx]={...np[idx],...u};});

      let nt=state.teams.map(team=>{
        const tm=updatedMatches.find(m=>m.homeTeamId===team.id||m.awayTeamId===team.id);
        if(!tm)return team;
        let money=team.money;const finances=[...team.finances];const round=state.currentRound;
        const repMult=0.7+(team.reputation/333);
        if(tm.homeTeamId===team.id){
          const fanMult=team.id===uid?0.6+(team.fanSatisfaction/250):0.75;
          const att=Math.floor(team.stadium.capacity*(0.4+Math.random()*0.6)*fanMult);
          const inc=att*team.stadium.ticketPrice;money+=inc;
          finances.push(makeRecord(round,'income','tickets',inc,`Bilheteria (${att.toLocaleString('pt-BR')} pagantes)`));
        }
        const spon=Math.floor(team.sponsorshipIncome/TOTAL_SEASON_ROUNDS*repMult);
        money+=spon;finances.push(makeRecord(round,'income','sponsorship',spon,'Patrocínio'));
        const sal=Math.floor(np.filter(p=>p.teamId===team.id).reduce((s,p)=>s+p.salary,0)/4);
        money-=sal;finances.push(makeRecord(round,'expense','salaries',sal,'Salários'));
        money-=team.stadium.maintenanceCost;finances.push(makeRecord(round,'expense','maintenance',team.stadium.maintenanceCost,'Manutenção'));
        return{...team,money,finances};
      });

      // Fan sat + reputation por resultado
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

      // Check cup pending
      let nextCup=state.cup;
      if(nextCup&&!seasonOver){
        const unlock=CUP_UNLOCK_AFTER[nextCup.currentRound];
        if(unlock!==undefined&&nextRound>unlock){
          // Auto-sim AI cup matches if user already eliminated or no pending user match
          const userInCup=nextCup.matches.filter(m=>m.round===nextCup!.currentRound).some(m=>m.homeTeamId===uid||m.awayTeamId===uid);
          if(!userInCup)nextCup=advanceCupRound(nextCup,np,uid);
        }
      }
      const pendingCup=nextCup?checkPendingCupRound(nextCup,nextRound):null;

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

      // Update the user's cup match
      let updatedCupMatches=state.cup.matches.map(m=>{
        if(m.id!==cupMatchId)return m;
        const winnerId=homeScore>awayScore?m.homeTeamId:awayScore>homeScore?m.awayTeamId:Math.random()<0.5?m.homeTeamId:m.awayTeamId;
        return{...m,homeScore,awayScore,played:true,winnerId};
      });
      let updatedCup={...state.cup,matches:updatedCupMatches};
      // Auto-sim remaining AI cup matches, then advance round
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
      const prog=state.manager.specialization==='desenvolvedor'?50:25;
      return{...state,teams:state.teams.map(t=>t.id===state.userTeamId?{...t,money:t.money-50_000}:t),
        players:state.players.map(p=>{if(p.id!==action.payload.playerId)return p;
          const np2=p.trainingProgress+prog;if(np2<100)return{...p,trainingProgress:np2};
          const ak=weakestPrimary(p,action.payload.attribute);
          if(p.attributes[ak]>=p.potential)return{...p,trainingProgress:np2-100};
          const na={...p.attributes,[ak]:Math.min(p.potential,p.attributes[ak]+1)};
          return{...p,trainingProgress:np2-100,attributes:na,strength:computeOverall(na,p.position)};
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
      // Signing bonus if salary increase
      const bonus=newSalary>player.salary?newSalary*0.5:0;
      if(ut.money<bonus)return state;
      return{...state,
        teams:state.teams.map(t=>t.id!==state.userTeamId?t:{...t,money:t.money-bonus,finances:[...t.finances,makeRecord(state.currentRound,'expense','transfer',bonus,`Renovação de ${player.name}`)]}),
        players:state.players.map(p=>p.id===playerId?{...p,salary:newSalary,contractYears:years}:p),
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
      // Preço pode ser inflado pela reputação do vendedor
      return{...state,teams:state.teams.map(t=>{if(t.id===ut.id)return{...t,money:t.money-amount,finances:[...t.finances,makeRecord(state.currentRound,'expense','transfer',amount,`Compra de ${player.name}`)]};if(t.id===st.id)return{...t,money:t.money+amount,finances:[...t.finances,makeRecord(state.currentRound,'income','transfer',amount,`Venda de ${player.name}`)]};return t;}),players:state.players.map(p=>p.id===playerId?{...p,teamId:ut.id,listedForSale:false,contractYears:rnd(1,3)}:p)};
    }

    case 'UPDATE_MANAGER':
      if(!state)return null;
      return{...state,manager:{...state.manager,...action.payload}};

    default: return state;
  }
}