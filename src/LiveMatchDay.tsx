import React, { useReducer, useEffect, useRef, useState } from 'react';
import { GameState, Match, Player, MatchEvent, MatchReport, FORMATION_MODIFIERS } from './types';
import { getEffectiveStrength, getBestLineup, pickWeightedPlayer, computeAttackXG, computeDefenseXG } from './engine';
import { RNG } from './rng';
import { Play, Pause, FastForward, ArrowRightLeft, Check, AlertCircle, Activity, ChevronDown, Bandage, Trophy } from 'lucide-react';

export interface LiveMatch {
  match: Match;
  homeLineup: string[]; awayLineup: string[];
  homeBench: string[];  awayBench: string[];
  homeScore: number; awayScore: number;
  events: MatchEvent[];
  homeSubs: number; awaySubs: number;
}

interface MatchDayState {
  minute: number; isFinished: boolean;
  liveMatches: LiveMatch[];
  livePlayers: Record<string, Player>;
  injuredIds: string[];
}

type MatchDayAction =
  | { type: 'TICK'; tickSeed: number; minute: number; userTeamId: string; gameState: GameState }
  | { type: 'USER_SUB'; subOutId: string; subInId: string; userTeamId: string; minute: number };

function tryAutoSub(lineup: string[], bench: string[], subs: number, max: number, outId: string, minute: number, teamId: string, events: MatchEvent[]) {
  if (subs >= max || bench.length === 0) return null;
  const [subIn, ...rest] = bench;
  return { lineup: [...lineup.filter(id => id !== outId), subIn], bench: rest, subs: subs + 1, events: [...events, { id: `${minute}-as-${outId}`, minute, type: 'sub' as const, teamId, playerId: outId, subInId: subIn }] };
}

function matchDayReducer(state: MatchDayState, action: MatchDayAction): MatchDayState {
  if (action.type === 'USER_SUB') {
    const { subOutId, subInId, userTeamId, minute } = action;
    return { ...state, liveMatches: state.liveMatches.map(lm => {
      const isHome = lm.match.homeTeamId === userTeamId, isAway = lm.match.awayTeamId === userTeamId;
      if (!isHome && !isAway) return lm;
      let hl = [...lm.homeLineup], al = [...lm.awayLineup], hb = [...lm.homeBench], ab = [...lm.awayBench], hs = lm.homeSubs, as2 = lm.awaySubs;
      const evts = [...lm.events];
      if (isHome && hs < 5) { hl = [...hl.filter(id => id !== subOutId), subInId]; hb = hb.filter(id => id !== subInId); hs++; evts.push({ id:`${minute}-sbu-${subOutId}`,minute,type:'sub',teamId:lm.match.homeTeamId,playerId:subOutId,subInId }); }
      else if (isAway && as2 < 5) { al = [...al.filter(id => id !== subOutId), subInId]; ab = ab.filter(id => id !== subInId); as2++; evts.push({ id:`${minute}-sbu-${subOutId}`,minute,type:'sub',teamId:lm.match.awayTeamId,playerId:subOutId,subInId }); }
      return { ...lm, homeLineup:hl, awayLineup:al, homeBench:hb, awayBench:ab, homeSubs:hs, awaySubs:as2, events:evts };
    })};
  }

  if (action.type === 'TICK') {
    if (state.isFinished) return state;
    const { tickSeed, minute, userTeamId, gameState } = action;
    const rng = new RNG(tickSeed), rand = () => rng.next();
    const spec = gameState.manager.specialization;
    const ufm = FORMATION_MODIFIERS[gameState.formation];
    const np: Record<string, Player> = {};
    for (const id in state.livePlayers) np[id] = { ...state.livePlayers[id] };
    const newInj = [...state.injuredIds];

    const nextMatches = state.liveMatches.map(lm => {
      let homeScore=lm.homeScore, awayScore=lm.awayScore, events=[...lm.events];
      let homeLineup=[...lm.homeLineup], awayLineup=[...lm.awayLineup];
      let homeBench=[...lm.homeBench], awayBench=[...lm.awayBench];
      let homeSubs=lm.homeSubs, awaySubs=lm.awaySubs;

      const isDown = (id: string) => np[id]?.redCard || newInj.includes(id);
      const hOn = homeLineup.map(id=>np[id]).filter((p): p is Player => !!p && !isDown(p.id));
      const aOn = awayLineup.map(id=>np[id]).filter((p): p is Player => !!p && !isDown(p.id));

      const hAtk=computeAttackXG(hOn), hDef=computeDefenseXG(hOn);
      const aAtk=computeAttackXG(aOn), aDef=computeDefenseXG(aOn);

      const isUH=lm.match.homeTeamId===userTeamId, isUA=lm.match.awayTeamId===userTeamId;
      const hAM=(isUH?ufm.attack:1)*(isUH&&spec==='ofensivo'?1.15:1);
      const hDM=(isUH?ufm.defense:1)*(isUH&&spec==='defensivo'?1.15:1);
      const aAM=(isUA?ufm.attack:1)*(isUA&&spec==='ofensivo'?1.15:1);
      const aDM=(isUA?ufm.defense:1)*(isUA&&spec==='defensivo'?1.15:1);

      const sd=(a:number,b:number)=>a/Math.max(40,b);
      const hC=0.012*sd(hAtk,aDef)*hAM/Math.max(1,aDM);
      const aC=0.010*sd(aAtk,hDef)*aAM/Math.max(1,hDM);

      if(rng.chance(hC)){
        homeScore++;
        const sc=pickWeightedPlayer(hOn,true,rand), as=sc?pickWeightedPlayer(hOn.filter(p=>p.id!==sc.id),false,rand):null;
        if(sc)events.push({id:`${minute}-gh-${sc.id}`,minute,type:'goal',teamId:lm.match.homeTeamId,playerId:sc.id,assistId:as?.id});
        homeLineup.forEach(id=>{if(np[id])np[id]={...np[id],morale:Math.min(100,np[id].morale+5)};});
        awayLineup.forEach(id=>{if(np[id])np[id]={...np[id],morale:Math.max(0,np[id].morale-4)};});
      } else if(rng.chance(hC*3)){const p=pickWeightedPlayer(hOn,true,rand);if(p)events.push({id:`${minute}-ch-${p.id}`,minute,type:'chance',teamId:lm.match.homeTeamId,playerId:p.id});}

      if(rng.chance(aC)){
        awayScore++;
        const sc=pickWeightedPlayer(aOn,true,rand), as=sc?pickWeightedPlayer(aOn.filter(p=>p.id!==sc.id),false,rand):null;
        if(sc)events.push({id:`${minute}-ga-${sc.id}`,minute,type:'goal',teamId:lm.match.awayTeamId,playerId:sc.id,assistId:as?.id});
        awayLineup.forEach(id=>{if(np[id])np[id]={...np[id],morale:Math.min(100,np[id].morale+5)};});
        homeLineup.forEach(id=>{if(np[id])np[id]={...np[id],morale:Math.max(0,np[id].morale-4)};});
      } else if(rng.chance(aC*3)){const p=pickWeightedPlayer(aOn,true,rand);if(p)events.push({id:`${minute}-ca-${p.id}`,minute,type:'chance',teamId:lm.match.awayTeamId,playerId:p.id});}

      for(const p of [...hOn,...aOn]){
        const pid=p.id;
        if(rng.chance(0.3))np[pid]={...np[pid],energy:Math.max(0,np[pid].energy-1)};
        if(rng.chance(0.002)){
          if(rng.chance(0.1)){np[pid]={...np[pid],redCard:true};events.push({id:`${minute}-rd-${pid}`,minute,type:'red',teamId:p.teamId,playerId:pid});}
          else{const y=np[pid].yellowCards+1;if(y>=2){np[pid]={...np[pid],yellowCards:0,redCard:true};events.push({id:`${minute}-r2y-${pid}`,minute,type:'red',teamId:p.teamId,playerId:pid});}else{np[pid]={...np[pid],yellowCards:y};events.push({id:`${minute}-yw-${pid}`,minute,type:'yellow',teamId:p.teamId,playerId:pid});}}
        }
        const injP=np[pid].energy<25?0.0009:0.0003;
        if(rng.chance(injP)&&!newInj.includes(pid)){newInj.push(pid);events.push({id:`${minute}-inj-${pid}`,minute,type:'injury',teamId:p.teamId,playerId:pid});}
      }

      // AI subs
      const aiSub=(l:string[],b:string[],s:number,tid:string,isUser:boolean)=>{
        if(isUser)return{lineup:l,bench:b,subs:s,events};
        let ll=l,bb=b,ss=s,ee=events;
        const injP=ll.find(id=>newInj.includes(id)&&!ee.some(ev=>ev.type==='sub'&&ev.playerId===id));
        if(injP){const r=tryAutoSub(ll,bb,ss,3,injP,minute,tid,ee);if(r){ll=r.lineup;bb=r.bench;ss=r.subs;ee=r.events;}}
        if(minute>60&&ss<3){const t=ll.map(id=>np[id]).filter((p):p is Player=>!!p&&!newInj.includes(p.id)).find(p=>p.energy<40);if(t){const r=tryAutoSub(ll,bb,ss,3,t.id,minute,tid,ee);if(r){ll=r.lineup;bb=r.bench;ss=r.subs;ee=r.events;}}}
        return{lineup:ll,bench:bb,subs:ss,events:ee};
      };
      const hr=aiSub(homeLineup,homeBench,homeSubs,lm.match.homeTeamId,lm.match.homeTeamId===userTeamId);
      homeLineup=hr.lineup;homeBench=hr.bench;homeSubs=hr.subs;events=hr.events;
      const ar=aiSub(awayLineup,awayBench,awaySubs,lm.match.awayTeamId,lm.match.awayTeamId===userTeamId);
      awayLineup=ar.lineup;awayBench=ar.bench;awaySubs=ar.subs;events=ar.events;

      return{...lm,homeScore,awayScore,events,homeLineup,awayLineup,homeBench,awayBench,homeSubs,awaySubs};
    });

    const nextMin=minute+1;
    return{minute:nextMin,isFinished:nextMin>=90,liveMatches:nextMatches,livePlayers:np,injuredIds:newInj};
  }
  return state;
}

function buildInitialState(gameState: GameState, matches: Match[], userLineup: string[]): MatchDayState {
  const lp: Record<string,Player>={};
  gameState.players.forEach(p=>{lp[p.id]={...p};});
  const gkB=gameState.staff.goleiros??0;
  if(gkB>0)gameState.players.filter(p=>p.teamId===gameState.userTeamId&&p.position==='G').forEach(p=>{lp[p.id]={...lp[p.id],strength:Math.min(99,lp[p.id].strength+gkB*2)};});
  const liveMatches: LiveMatch[]=matches.map(m=>{
    const hp=gameState.players.filter(p=>p.teamId===m.homeTeamId);
    const ap=gameState.players.filter(p=>p.teamId===m.awayTeamId);
    const hl=m.homeTeamId===gameState.userTeamId?[...userLineup]:getBestLineup(hp,'4-4-2').map(p=>p.id);
    const al=m.awayTeamId===gameState.userTeamId?[...userLineup]:getBestLineup(ap,'4-4-2').map(p=>p.id);
    return{match:m,homeLineup:hl,awayLineup:al,homeBench:hp.filter(p=>!hl.includes(p.id)&&!p.redCard&&p.injuryWeeksLeft===0).map(p=>p.id),awayBench:ap.filter(p=>!al.includes(p.id)&&!p.redCard&&p.injuryWeeksLeft===0).map(p=>p.id),homeScore:0,awayScore:0,events:[],homeSubs:0,awaySubs:0};
  });
  return{minute:0,isFinished:false,liveMatches,livePlayers:lp,injuredIds:[]};
}

// ─── Props ────────────────────────────────────────────────────────────────────
interface Props {
  gameState: GameState; matches: Match[]; userLineup: string[];
  onComplete: (matches: Match[], playerUpdates: Partial<Player>[], report: MatchReport) => void;
  isCupMatch?: boolean;
}

export default function LiveMatchDay({ gameState, matches, userLineup, onComplete, isCupMatch=false }: Props) {
  const [state, dispatch] = useReducer(matchDayReducer, undefined, () => buildInitialState(gameState, matches, userLineup));
  const [isPlaying, setIsPlaying] = useState(true);
  const [speed, setSpeed] = useState(300);
  const [selectedSubOut, setSelectedSubOut] = useState<string|null>(null);
  const [showOther, setShowOther] = useState(false);
  const masterRng = useRef(new RNG(gameState.currentRound*1000003^(Date.now()&0xffffffff)));
  const prevInj = useRef(0);

  useEffect(()=>{
    const n=state.injuredIds.filter(id=>state.livePlayers[id]?.teamId===gameState.userTeamId).length;
    if(n>prevInj.current){setIsPlaying(false);prevInj.current=n;}
  },[state.injuredIds.length]);

  useEffect(()=>{
    if(!isPlaying||state.isFinished)return;
    const t=setTimeout(()=>dispatch({type:'TICK',tickSeed:masterRng.current.nextInt(0,0xffffffff),minute:state.minute,userTeamId:gameState.userTeamId!,gameState}),speed);
    return()=>clearTimeout(t);
  },[state.minute,state.isFinished,isPlaying,speed]);

  const finishMatch = () => {
    const um=state.liveMatches.map(lm=>({...lm.match,homeScore:lm.homeScore,awayScore:lm.awayScore,played:true}));
    const allEv=state.liveMatches.flatMap(lm=>lm.events);
    const playerUpdates: Partial<Player>[]=Object.values(state.livePlayers).map(p=>({
      id:p.id,energy:p.energy,yellowCards:p.yellowCards,redCard:p.redCard,morale:p.morale,
      injuryWeeksLeft:state.injuredIds.includes(p.id)?(Math.random()<0.7?Math.floor(Math.random()*2)+1:Math.floor(Math.random()*3)+3):p.injuryWeeksLeft,
      goals:p.goals+allEv.filter(e=>e.type==='goal'&&e.playerId===p.id).length,
      assists:p.assists+allEv.filter(e=>e.type==='goal'&&e.assistId===p.id).length,
      matchesPlayed:p.matchesPlayed+1,
    }));

    // Relatório
    const uid=gameState.userTeamId!;
    const ulm=state.liveMatches.find(lm=>lm.match.homeTeamId===uid||lm.match.awayTeamId===uid)!;
    const hStr=ulm.homeLineup.reduce((s,id)=>s+(state.livePlayers[id]?.strength??0),0)/Math.max(1,ulm.homeLineup.length);
    const aStr=ulm.awayLineup.reduce((s,id)=>s+(state.livePlayers[id]?.strength??0),0)/Math.max(1,ulm.awayLineup.length);
    const homePoss=Math.round((hStr/Math.max(1,hStr+aStr))*100);
    const ratings: Record<string,number>={};
    [...ulm.homeLineup,...ulm.awayLineup].forEach(id=>{ratings[id]=6+Math.random()*1.5;});
    ulm.events.forEach(e=>{
      if(e.type==='goal'){ratings[e.playerId]=Math.min(10,(ratings[e.playerId]??7)+1.5);if(e.assistId)ratings[e.assistId]=Math.min(10,(ratings[e.assistId]??7)+0.8);}
      if(e.type==='red')ratings[e.playerId]=Math.max(3,(ratings[e.playerId]??6)-2);
      if(e.type==='injury')ratings[e.playerId]=Math.max(4,(ratings[e.playerId]??6)-1);
    });
    const topPerformers=Object.entries(ratings).map(([pid,r])=>({playerId:pid,teamId:state.livePlayers[pid]?.teamId??'',rating:Math.round(r*10)/10})).sort((a,b)=>b.rating-a.rating).slice(0,8);
    const report: MatchReport={
      homeTeamId:ulm.match.homeTeamId,awayTeamId:ulm.match.awayTeamId,
      homeScore:ulm.homeScore,awayScore:ulm.awayScore,
      homeShots:ulm.events.filter(e=>(e.type==='goal'||e.type==='chance')&&e.teamId===ulm.match.homeTeamId).length,
      awayShots:ulm.events.filter(e=>(e.type==='goal'||e.type==='chance')&&e.teamId===ulm.match.awayTeamId).length,
      homePossession:homePoss,
      goalEvents:ulm.events.filter(e=>e.type==='goal').map(e=>({playerId:e.playerId,teamId:e.teamId,minute:e.minute,assistId:e.assistId})),
      cards:ulm.events.filter(e=>e.type==='yellow'||e.type==='red').map(e=>({playerId:e.playerId,teamId:e.teamId,minute:e.minute,type:e.type as 'yellow'|'red'})),
      injuries:ulm.events.filter(e=>e.type==='injury').map(e=>({playerId:e.playerId,teamId:e.teamId,minute:e.minute})),
      topPerformers,isCup:isCupMatch,
    };
    onComplete(um,playerUpdates,report);
  };

  const userTeam=gameState.teams.find(t=>t.id===gameState.userTeamId)!;
  const userMatch=state.liveMatches.find(m=>m.match.homeTeamId===userTeam.id||m.match.awayTeamId===userTeam.id);
  if(!userMatch)return null;
  const otherMatches=state.liveMatches.filter(m=>m.match.id!==userMatch.match.id);
  const isHome=userMatch.match.homeTeamId===userTeam.id;
  const oppTeam=gameState.teams.find(t=>t.id===(isHome?userMatch.match.awayTeamId:userMatch.match.homeTeamId))!;
  const leftTeam=isHome?userTeam:oppTeam, rightTeam=isHome?oppTeam:userTeam;
  const uLIds=isHome?userMatch.homeLineup:userMatch.awayLineup;
  const uBIds=isHome?userMatch.homeBench:userMatch.awayBench;
  const uSubs=isHome?userMatch.homeSubs:userMatch.awaySubs;
  const lp=state.livePlayers;
  const isDown=(id:string)=>lp[id]?.redCard||state.injuredIds.includes(id);
  const uInjPend=uLIds.filter(id=>state.injuredIds.includes(id)&&!userMatch.events.some(e=>e.type==='sub'&&e.playerId===id));
  const pct=Math.min(100,(state.minute/90)*100);
  const ce=(type:MatchEvent['type'],tid:string)=>userMatch.events.filter(e=>e.type===type&&e.teamId===tid).length;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans flex flex-col">
      <header className="bg-zinc-900 border-b border-zinc-800 sticky top-0 z-20">
        <div className="h-0.5 bg-zinc-800"><div className="h-full bg-emerald-500 transition-all duration-300" style={{width:`${pct}%`}}/></div>
        <div className="px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              {isCupMatch&&<span className="flex items-center gap-1 text-amber-400 text-[10px] font-black bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded-full"><Trophy size={9}/>COPA</span>}
              <div className="font-black font-mono text-emerald-400 text-2xl w-14">{state.minute}'</div>
            </div>
            <div className="flex gap-1.5">
              <button onClick={()=>setIsPlaying(p=>!p)} disabled={state.isFinished} className="p-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg disabled:opacity-40">{isPlaying?<Pause size={18}/>:<Play size={18}/>}</button>
              <button onClick={()=>setSpeed(s=>s===300?50:300)} disabled={state.isFinished} className={`p-2 rounded-lg disabled:opacity-40 ${speed===50?'bg-emerald-500/20 text-emerald-400':'bg-zinc-800 hover:bg-zinc-700'}`}><FastForward size={18}/></button>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            <span className="font-bold text-sm hidden sm:block truncate max-w-[100px]">{leftTeam.name}</span>
            <div className="font-black font-mono text-xl sm:text-2xl bg-zinc-950 border border-zinc-800 px-3 py-1 rounded-xl">{userMatch.homeScore} - {userMatch.awayScore}</div>
            <span className="font-bold text-sm hidden sm:block truncate max-w-[100px]">{rightTeam.name}</span>
          </div>
          {state.isFinished
            ?<button onClick={finishMatch} className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold py-2 px-4 rounded-full flex items-center gap-1.5 text-sm"><Check size={16}/> Continuar</button>
            :<div className="w-24 hidden sm:block"/>}
        </div>
      </header>

      <div className="flex-1 flex flex-col lg:flex-row max-w-7xl mx-auto w-full">
        <div className="flex-1 min-w-0 flex flex-col gap-4 p-3 sm:p-5">

          {/* Scoreboard */}
          <div className="hidden sm:block bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-5">
              {[leftTeam,rightTeam].map(t=>(
                <div key={t.id} className="flex-1 flex flex-col items-center gap-2">
                  <div className="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-black" style={{backgroundColor:t.color,color:'#fff'}}>{t.name.charAt(0)}</div>
                  <span className="font-bold text-center text-sm">{t.name}</span>
                </div>
              ))}
            </div>
            <div className="text-5xl font-black font-mono tabular-nums text-center -mt-16 mb-5">{userMatch.homeScore} - {userMatch.awayScore}</div>
            <div className="grid grid-cols-3 gap-2 text-xs text-center max-w-xs mx-auto">
              {(['chance','foul','yellow'] as MatchEvent['type'][]).map(type=>(
                <React.Fragment key={type}>
                  <div className={`font-bold ${type==='yellow'?'text-amber-400':''}`}>{ce(type,leftTeam.id)}</div>
                  <div className="text-zinc-500 uppercase tracking-wider">{type==='chance'?'Chances':type==='foul'?'Faltas':'Amarelos'}</div>
                  <div className={`font-bold ${type==='yellow'?'text-amber-400':''}`}>{ce(type,rightTeam.id)}</div>
                </React.Fragment>
              ))}
            </div>
          </div>

          {/* Lesão alert */}
          {uInjPend.length>0&&<div className="bg-orange-500/10 border border-orange-500/30 rounded-xl px-4 py-3 flex items-start gap-3"><Bandage size={18} className="text-orange-400 flex-shrink-0 mt-0.5"/><div><p className="text-orange-400 font-bold text-sm">{uInjPend.map(id=>lp[id]?.name).join(', ')} se lesionou!</p><p className="text-orange-400/70 text-xs mt-0.5">Jogo pausado. Faça a substituição.</p></div></div>}

          {/* Outros (mobile) */}
          {otherMatches.length>0&&<div className="sm:hidden bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden"><button onClick={()=>setShowOther(s=>!s)} className="w-full flex items-center justify-between px-4 py-2.5 text-sm"><span className="flex items-center gap-2 text-zinc-400">{isCupMatch?<Trophy size={15} className="text-amber-400"/>:<Activity size={15}/>}{isCupMatch?'Copa — outros jogos':'Outros placares'}</span><ChevronDown size={16} className={`text-zinc-500 transition-transform ${showOther?'rotate-180':''}`}/></button>{showOther&&<div className="border-t border-zinc-800 divide-y divide-zinc-800/50">{otherMatches.map(lm=>{const h=gameState.teams.find(t=>t.id===lm.match.homeTeamId)!,a=gameState.teams.find(t=>t.id===lm.match.awayTeamId)!;return<div key={lm.match.id} className="flex items-center px-4 py-2 text-xs gap-2"><span className="flex-1 text-right truncate">{h.name}</span><span className="font-mono font-bold bg-zinc-950 px-2 py-0.5 rounded border border-zinc-800">{lm.homeScore}-{lm.awayScore}</span><span className="flex-1 truncate">{a.name}</span></div>;})}</div>}</div>}

          {/* Eventos */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-800 text-xs text-zinc-500 font-medium uppercase tracking-wider">Eventos</div>
            <div className="overflow-y-auto max-h-48 sm:max-h-60 flex flex-col-reverse px-3 py-2 gap-1.5">
              {userMatch.events.length===0?<div className="text-center text-zinc-600 py-4 text-sm">Nenhum evento ainda.</div>:[...userMatch.events].reverse().map(ev=>{
                if(ev.type==='foul'||ev.type==='chance')return null;
                const player=lp[ev.playerId],assist=ev.assistId?lp[ev.assistId]:null,subIn=ev.subInId?lp[ev.subInId]:null;
                const isU=ev.teamId===userTeam.id;
                return(<div key={ev.id} className={`flex items-center gap-2 text-xs ${isU?'flex-row':'flex-row-reverse'}`}><span className="font-mono text-zinc-600 w-6 text-center flex-shrink-0">{ev.minute}'</span><div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg max-w-[85%] ${isU?'bg-zinc-800/60':'bg-zinc-800/30'}`}>{ev.type==='goal'&&<span className="text-emerald-400 font-bold">⚽ GOL!</span>}{ev.type==='yellow'&&<div className="w-2 h-3 bg-amber-400 rounded-sm"/>}{ev.type==='red'&&<div className="w-2 h-3 bg-red-500 rounded-sm"/>}{ev.type==='sub'&&<ArrowRightLeft size={12} className="text-blue-400"/>}{ev.type==='injury'&&<Bandage size={12} className="text-orange-400"/>}<span className="font-medium truncate">{player?.name}</span>{ev.type==='goal'&&assist&&<span className="text-zinc-500 truncate hidden sm:inline">(ass: {assist.name})</span>}{ev.type==='sub'&&subIn&&<><span className="text-zinc-600">↔</span><span className="font-medium truncate">{subIn.name}</span></>}{ev.type==='injury'&&<span className="text-orange-400/70 text-[10px]">lesionado</span>}</div></div>);
              })}
            </div>
          </div>

          {/* Gestão */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between"><span className="font-bold text-sm">Seu Time</span><span className="text-xs text-zinc-500">Subs: <span className="text-white font-bold">{uSubs}/5</span></span></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-zinc-800">
              <div className="p-3">
                <div className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Titulares</div>
                <div className="flex flex-col gap-1">
                  {uLIds.map(id=>{const p=lp[id];if(!p)return null;const sel=selectedSubOut===id,inj=state.injuredIds.includes(id),down=isDown(id);return(<div key={id} onClick={()=>{if(!down||inj){setSelectedSubOut(prev=>prev===id?null:id);}}} className={`flex items-center gap-2 p-2 rounded-lg transition-colors ${down&&!inj?'opacity-40 cursor-not-allowed':'cursor-pointer'} ${sel?'bg-blue-500/15 border border-blue-500/40':inj?'bg-orange-500/10 border border-orange-500/25':'hover:bg-zinc-800/60'}`}><span className="text-[10px] font-bold text-zinc-500 w-4">{p.position}</span><span className={`font-medium text-xs flex-1 truncate ${inj?'text-orange-400':''}`}>{p.name}</span>{inj&&<Bandage size={11} className="text-orange-400"/>}{p.redCard&&!inj&&<div className="w-2 h-3 bg-red-500 rounded-sm"/>}{!p.redCard&&!inj&&p.yellowCards>0&&<div className="w-2 h-3 bg-amber-400 rounded-sm"/>}<div className="flex items-center gap-1.5"><div className="w-10 h-1 bg-zinc-800 rounded-full overflow-hidden"><div className={`h-full ${p.energy>60?'bg-emerald-500':p.energy>30?'bg-amber-500':'bg-red-500'}`} style={{width:`${p.energy}%`}}/></div><span className="text-[10px] font-mono text-zinc-500 w-5">{p.strength}</span></div></div>);})}
                </div>
              </div>
              <div className="p-3">
                <div className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Banco</div>
                {uBIds.length===0?<p className="text-xs text-zinc-600 p-2">Sem reservas.</p>:<div className="flex flex-col gap-1">{uBIds.map(id=>{const p=lp[id];if(!p)return null;return(<div key={id} onClick={()=>selectedSubOut&&(()=>{dispatch({type:'USER_SUB',subOutId:selectedSubOut,subInId:id,userTeamId:userTeam.id,minute:state.minute});setSelectedSubOut(null);})()} className={`flex items-center gap-2 p-2 rounded-lg ${selectedSubOut?'cursor-pointer hover:bg-zinc-800/80 border border-zinc-700':'opacity-40'}`}><span className="text-[10px] font-bold text-zinc-500 w-4">{p.position}</span><span className="font-medium text-xs flex-1 truncate">{p.name}</span><div className="flex items-center gap-1.5"><div className="w-10 h-1 bg-zinc-800 rounded-full overflow-hidden"><div className={`h-full ${p.energy>60?'bg-emerald-500':p.energy>30?'bg-amber-500':'bg-red-500'}`} style={{width:`${p.energy}%`}}/></div><span className="text-[10px] font-mono text-zinc-500 w-5">{p.strength}</span></div></div>);})}</div>}
                {selectedSubOut&&<div className="mt-2 p-2 bg-blue-500/10 border border-blue-500/20 rounded-lg flex items-start gap-1.5 text-xs text-blue-400"><AlertCircle size={13} className="mt-0.5"/><p>Escolha reserva para <strong>{lp[selectedSubOut]?.name}</strong>.</p></div>}
              </div>
            </div>
          </div>

          {state.isFinished&&<button onClick={finishMatch} className="sm:hidden w-full bg-emerald-500 text-zinc-950 font-bold py-4 rounded-xl flex items-center justify-center gap-2"><Check size={20}/> Continuar</button>}
        </div>

        {/* Sidebar */}
        <aside className="hidden lg:flex flex-col w-56 flex-shrink-0 border-l border-zinc-800 p-4 gap-3">
          <div className="flex items-center gap-2 text-sm font-bold text-zinc-400">{isCupMatch?<><Trophy size={16} className="text-amber-400"/>Copa</>:<><Activity size={16} className="text-emerald-400"/>Ao Vivo</>}</div>
          {otherMatches.map(lm=>{const h=gameState.teams.find(t=>t.id===lm.match.homeTeamId)!,a=gameState.teams.find(t=>t.id===lm.match.awayTeamId)!;return(<div key={lm.match.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-2.5 text-xs"><div className="flex items-center justify-between mb-1"><div className="flex items-center gap-1.5 min-w-0"><div className="w-3 h-3 rounded-full flex-shrink-0" style={{backgroundColor:h.color}}/><span className="truncate">{h.name}</span></div><span className="font-mono font-bold ml-1">{lm.homeScore}</span></div><div className="flex items-center justify-between"><div className="flex items-center gap-1.5 min-w-0"><div className="w-3 h-3 rounded-full flex-shrink-0" style={{backgroundColor:a.color}}/><span className="truncate">{a.name}</span></div><span className="font-mono font-bold ml-1">{lm.awayScore}</span></div></div>);})}
        </aside>
      </div>
    </div>
  );
}