import React, { useReducer, useEffect, useRef, useState } from 'react';
import { GameState, Match, Player, MatchEvent } from './types';
import { getEffectiveStrength, getBestLineup, pickWeightedPlayer } from './engine';
import { RNG } from './rng';
import {
  Play, Pause, FastForward, ArrowRightLeft,
  Check, AlertCircle, Activity, ChevronDown,
} from 'lucide-react';

// ─── Tipos internos ───────────────────────────────────────────────────────────

export interface LiveMatch {
  match: Match;
  homeLineup: string[];
  awayLineup: string[];
  homeBench: string[];
  awayBench: string[];
  homeScore: number;
  awayScore: number;
  events: MatchEvent[];
  homeSubs: number;
  awaySubs: number;
}

interface MatchDayState {
  minute: number;
  isFinished: boolean;
  liveMatches: LiveMatch[];
  livePlayers: Record<string, Player>;
}

type MatchDayAction =
  | { type: 'TICK'; tickSeed: number; minute: number; userTeamId: string }
  | { type: 'USER_SUB'; subOutId: string; subInId: string; userTeamId: string; minute: number };

// ─── Reducer ─────────────────────────────────────────────────────────────────

function matchDayReducer(state: MatchDayState, action: MatchDayAction): MatchDayState {
  switch (action.type) {

    case 'TICK': {
      if (state.isFinished) return state;
      const { tickSeed, minute, userTeamId } = action;
      const rng = new RNG(tickSeed);
      const rand = () => rng.next();

      const nextPlayers: Record<string, Player> = {};
      for (const id in state.livePlayers) nextPlayers[id] = { ...state.livePlayers[id] };

      const nextMatches = state.liveMatches.map(lm => {
        let homeScore = lm.homeScore, awayScore = lm.awayScore;
        const events = [...lm.events];
        let homeLineup = [...lm.homeLineup], awayLineup = [...lm.awayLineup];
        let homeBench = [...lm.homeBench], awayBench = [...lm.awayBench];
        let homeSubs = lm.homeSubs, awaySubs = lm.awaySubs;

        const homeOnPitch = homeLineup.map(id => nextPlayers[id]).filter((p): p is Player => !!p && !p.redCard);
        const awayOnPitch = awayLineup.map(id => nextPlayers[id]).filter((p): p is Player => !!p && !p.redCard);

        const homeStr = homeOnPitch.reduce((s, p) => s + getEffectiveStrength(p), 0) / (homeOnPitch.length || 1);
        const awayStr = awayOnPitch.reduce((s, p) => s + getEffectiveStrength(p), 0) / (awayOnPitch.length || 1);

        const hChance = 0.015 * (homeStr / 80);
        const aChance = 0.012 * (awayStr / 80);

        // Gol mandante
        if (rng.chance(hChance)) {
          homeScore++;
          const sc = pickWeightedPlayer(homeOnPitch, true, rand);
          const as = sc ? pickWeightedPlayer(homeOnPitch.filter(p => p.id !== sc.id), false, rand) : null;
          if (sc) events.push({ id: `${minute}-gh-${sc.id}`, minute, type: 'goal', teamId: lm.match.homeTeamId, playerId: sc.id, assistId: as?.id });
        } else if (rng.chance(hChance * 3)) {
          const p = pickWeightedPlayer(homeOnPitch, true, rand);
          if (p) events.push({ id: `${minute}-ch-${p.id}`, minute, type: 'chance', teamId: lm.match.homeTeamId, playerId: p.id });
        }

        // Gol visitante
        if (rng.chance(aChance)) {
          awayScore++;
          const sc = pickWeightedPlayer(awayOnPitch, true, rand);
          const as = sc ? pickWeightedPlayer(awayOnPitch.filter(p => p.id !== sc.id), false, rand) : null;
          if (sc) events.push({ id: `${minute}-ga-${sc.id}`, minute, type: 'goal', teamId: lm.match.awayTeamId, playerId: sc.id, assistId: as?.id });
        } else if (rng.chance(aChance * 3)) {
          const p = pickWeightedPlayer(awayOnPitch, true, rand);
          if (p) events.push({ id: `${minute}-ca-${p.id}`, minute, type: 'chance', teamId: lm.match.awayTeamId, playerId: p.id });
        }

        // Energia, faltas e cartões
        for (const p of [...homeOnPitch, ...awayOnPitch]) {
          const pid = p.id;
          if (rng.chance(0.3)) nextPlayers[pid] = { ...nextPlayers[pid], energy: Math.max(0, nextPlayers[pid].energy - 1) };
          if (rng.chance(0.01)) events.push({ id: `${minute}-fo-${pid}`, minute, type: 'foul', teamId: p.teamId, playerId: pid });
          if (rng.chance(0.002)) {
            if (rng.chance(0.1)) {
              nextPlayers[pid] = { ...nextPlayers[pid], redCard: true };
              events.push({ id: `${minute}-rd-${pid}`, minute, type: 'red', teamId: p.teamId, playerId: pid });
            } else {
              const y = nextPlayers[pid].yellowCards + 1;
              if (y >= 2) {
                nextPlayers[pid] = { ...nextPlayers[pid], yellowCards: 0, redCard: true };
                events.push({ id: `${minute}-r2y-${pid}`, minute, type: 'red', teamId: p.teamId, playerId: pid });
              } else {
                nextPlayers[pid] = { ...nextPlayers[pid], yellowCards: y };
                events.push({ id: `${minute}-yw-${pid}`, minute, type: 'yellow', teamId: p.teamId, playerId: pid });
              }
            }
          }
        }

        // Sub IA — mandante
        if (lm.match.homeTeamId !== userTeamId && homeSubs < 3 && minute > 60) {
          const tired = homeOnPitch.find(p => nextPlayers[p.id].energy < 40);
          if (tired && homeBench.length > 0) {
            const [subIn, ...rest] = homeBench;
            homeLineup = [...homeLineup.filter(id => id !== tired.id), subIn];
            homeBench = rest; homeSubs++;
            events.push({ id: `${minute}-sbh-${tired.id}`, minute, type: 'sub', teamId: lm.match.homeTeamId, playerId: tired.id, subInId: subIn });
          }
        }

        // Sub IA — visitante
        if (lm.match.awayTeamId !== userTeamId && awaySubs < 3 && minute > 60) {
          const tired = awayOnPitch.find(p => nextPlayers[p.id].energy < 40);
          if (tired && awayBench.length > 0) {
            const [subIn, ...rest] = awayBench;
            awayLineup = [...awayLineup.filter(id => id !== tired.id), subIn];
            awayBench = rest; awaySubs++;
            events.push({ id: `${minute}-sba-${tired.id}`, minute, type: 'sub', teamId: lm.match.awayTeamId, playerId: tired.id, subInId: subIn });
          }
        }

        return { ...lm, homeScore, awayScore, events, homeLineup, awayLineup, homeBench, awayBench, homeSubs, awaySubs };
      });

      const nextMinute = minute + 1;
      return { minute: nextMinute, isFinished: nextMinute >= 90, liveMatches: nextMatches, livePlayers: nextPlayers };
    }

    case 'USER_SUB': {
      const { subOutId, subInId, userTeamId, minute } = action;
      const nextMatches = state.liveMatches.map(lm => {
        const isHome = lm.match.homeTeamId === userTeamId;
        const isAway = lm.match.awayTeamId === userTeamId;
        if (!isHome && !isAway) return lm;

        let homeLineup = [...lm.homeLineup], awayLineup = [...lm.awayLineup];
        let homeBench = [...lm.homeBench], awayBench = [...lm.awayBench];
        let homeSubs = lm.homeSubs, awaySubs = lm.awaySubs;
        const events = [...lm.events];

        if (isHome && homeSubs < 5) {
          homeLineup = [...homeLineup.filter(id => id !== subOutId), subInId];
          homeBench = homeBench.filter(id => id !== subInId); homeSubs++;
          events.push({ id: `${minute}-sbu-${subOutId}`, minute, type: 'sub', teamId: lm.match.homeTeamId, playerId: subOutId, subInId });
        } else if (isAway && awaySubs < 5) {
          awayLineup = [...awayLineup.filter(id => id !== subOutId), subInId];
          awayBench = awayBench.filter(id => id !== subInId); awaySubs++;
          events.push({ id: `${minute}-sbu-${subOutId}`, minute, type: 'sub', teamId: lm.match.awayTeamId, playerId: subOutId, subInId });
        }

        return { ...lm, homeLineup, awayLineup, homeBench, awayBench, homeSubs, awaySubs, events };
      });
      return { ...state, liveMatches: nextMatches };
    }

    default: return state;
  }
}

// ─── Inicializador ────────────────────────────────────────────────────────────

function buildInitialState(gameState: GameState, matches: Match[], userLineup: string[]): MatchDayState {
  const livePlayers: Record<string, Player> = {};
  gameState.players.forEach(p => { livePlayers[p.id] = { ...p }; });

  const liveMatches: LiveMatch[] = matches.map(m => {
    const hp = gameState.players.filter(p => p.teamId === m.homeTeamId);
    const ap = gameState.players.filter(p => p.teamId === m.awayTeamId);
    const homeLineupIds = m.homeTeamId === gameState.userTeamId ? [...userLineup] : getBestLineup(hp).map(p => p.id);
    const awayLineupIds = m.awayTeamId === gameState.userTeamId ? [...userLineup] : getBestLineup(ap).map(p => p.id);
    return {
      match: m,
      homeLineup: homeLineupIds,
      awayLineup: awayLineupIds,
      homeBench: hp.filter(p => !homeLineupIds.includes(p.id) && !p.redCard).map(p => p.id),
      awayBench: ap.filter(p => !awayLineupIds.includes(p.id) && !p.redCard).map(p => p.id),
      homeScore: 0, awayScore: 0, events: [], homeSubs: 0, awaySubs: 0,
    };
  });

  return { minute: 0, isFinished: false, liveMatches, livePlayers };
}

// ─── Componente ───────────────────────────────────────────────────────────────

interface Props {
  gameState: GameState;
  matches: Match[];
  userLineup: string[];
  onComplete: (matches: Match[], playerUpdates: Partial<Player>[]) => void;
}

export default function LiveMatchDay({ gameState, matches, userLineup, onComplete }: Props) {
  const [state, dispatch] = useReducer(
    matchDayReducer, undefined,
    () => buildInitialState(gameState, matches, userLineup)
  );

  const [isPlaying, setIsPlaying] = useState(true);
  const [speed, setSpeed] = useState(300);
  const [selectedSubOut, setSelectedSubOut] = useState<string | null>(null);
  const [showOtherScores, setShowOtherScores] = useState(false);

  const masterRng = useRef(RNG.fromMatch(gameState.currentRound, matches[0]?.round ?? 0));

  useEffect(() => {
    if (!isPlaying || state.isFinished) return;
    const timer = setTimeout(() => {
      dispatch({ type: 'TICK', tickSeed: masterRng.current.nextInt(0, 0xffff_ffff), minute: state.minute, userTeamId: gameState.userTeamId! });
    }, speed);
    return () => clearTimeout(timer);
  }, [state.minute, state.isFinished, isPlaying, speed, gameState.userTeamId]);

  const finishMatch = () => {
    const updatedMatches = state.liveMatches.map(lm => ({ ...lm.match, homeScore: lm.homeScore, awayScore: lm.awayScore, played: true }));
    const allEvents = state.liveMatches.flatMap(lm => lm.events);
    const playerUpdates: Partial<Player>[] = Object.values(state.livePlayers).map(p => ({
      id: p.id,
      energy: p.energy,
      yellowCards: p.yellowCards,
      redCard: p.redCard,
      goals: p.goals + allEvents.filter(e => e.type === 'goal' && e.playerId === p.id).length,
      assists: p.assists + allEvents.filter(e => e.type === 'goal' && e.assistId === p.id).length,
      matchesPlayed: p.matchesPlayed + 1,
    }));
    onComplete(updatedMatches, playerUpdates);
  };

  // Derivações
  const userTeam = gameState.teams.find(t => t.id === gameState.userTeamId)!;
  const userMatch = state.liveMatches.find(m => m.match.homeTeamId === userTeam.id || m.match.awayTeamId === userTeam.id);
  if (!userMatch) return null;

  const otherMatches = state.liveMatches.filter(m => m.match.id !== userMatch.match.id);
  const isHome = userMatch.match.homeTeamId === userTeam.id;
  const oppTeam = gameState.teams.find(t => t.id === (isHome ? userMatch.match.awayTeamId : userMatch.match.homeTeamId))!;
  const leftTeam = isHome ? userTeam : oppTeam;
  const rightTeam = isHome ? oppTeam : userTeam;

  const userLineupIds = isHome ? userMatch.homeLineup : userMatch.awayLineup;
  const userBenchIds = isHome ? userMatch.homeBench : userMatch.awayBench;
  const userSubs = isHome ? userMatch.homeSubs : userMatch.awaySubs;
  const lp = state.livePlayers;

  const handleSubSelect = (id: string) => {
    const p = lp[id];
    if (!p || p.redCard || userSubs >= 5) return;
    setSelectedSubOut(prev => prev === id ? null : id);
  };

  const handleSubIn = (subInId: string) => {
    if (!selectedSubOut) return;
    dispatch({ type: 'USER_SUB', subOutId: selectedSubOut, subInId, userTeamId: userTeam.id, minute: state.minute });
    setSelectedSubOut(null);
  };

  const countEvt = (type: MatchEvent['type'], teamId: string) =>
    userMatch.events.filter(e => e.type === type && e.teamId === teamId).length;

  // Minuto formatado com barra de progresso
  const pct = Math.min(100, (state.minute / 90) * 100);

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans flex flex-col">

      {/* Header compacto */}
      <header className="bg-zinc-900 border-b border-zinc-800 sticky top-0 z-20">
        {/* Barra de progresso da partida */}
        <div className="h-0.5 bg-zinc-800">
          <div className="h-full bg-emerald-500 transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>
        <div className="px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="font-black font-mono text-emerald-400 text-2xl w-14">{state.minute}'</div>
            <div className="flex gap-1.5">
              <button onClick={() => setIsPlaying(p => !p)} disabled={state.isFinished}
                className="p-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors disabled:opacity-40">
                {isPlaying ? <Pause size={18} /> : <Play size={18} />}
              </button>
              <button onClick={() => setSpeed(s => s === 300 ? 50 : 300)} disabled={state.isFinished}
                className={`p-2 rounded-lg transition-colors disabled:opacity-40 ${speed === 50 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-800 hover:bg-zinc-700'}`}>
                <FastForward size={18} />
              </button>
            </div>
          </div>

          {/* Placar no header para poupar espaço no mobile */}
          <div className="flex items-center gap-2 sm:gap-4">
            <span className="font-bold text-sm hidden sm:block truncate max-w-[100px]">{leftTeam.name}</span>
            <div className="font-black font-mono text-xl sm:text-2xl bg-zinc-950 border border-zinc-800 px-3 py-1 rounded-xl">
              {userMatch.homeScore} - {userMatch.awayScore}
            </div>
            <span className="font-bold text-sm hidden sm:block truncate max-w-[100px]">{rightTeam.name}</span>
          </div>

          {state.isFinished
            ? <button onClick={finishMatch} className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold py-2 px-4 rounded-full flex items-center gap-1.5 text-sm transition-colors">
                <Check size={16} /> Continuar
              </button>
            : <div className="w-24 hidden sm:block" /> /* placeholder para alinhar */
          }
        </div>
      </header>

      <div className="flex-1 flex flex-col lg:flex-row max-w-7xl mx-auto w-full">

        {/* ── Área principal ── */}
        <div className="flex-1 min-w-0 flex flex-col gap-4 p-3 sm:p-5">

          {/* Scoreboard expandido — só sm+ */}
          <div className="hidden sm:block bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-5">
              <div className="flex-1 flex flex-col items-center gap-2">
                <div className="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-black" style={{ backgroundColor: leftTeam.color, color: '#fff' }}>
                  {leftTeam.name.charAt(0)}
                </div>
                <span className="font-bold text-center text-sm">{leftTeam.name}</span>
              </div>
              <div className="px-6 text-5xl font-black font-mono tabular-nums">
                {userMatch.homeScore} - {userMatch.awayScore}
              </div>
              <div className="flex-1 flex flex-col items-center gap-2">
                <div className="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-black" style={{ backgroundColor: rightTeam.color, color: '#fff' }}>
                  {rightTeam.name.charAt(0)}
                </div>
                <span className="font-bold text-center text-sm">{rightTeam.name}</span>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs text-center max-w-xs mx-auto">
              {(['chance','foul','yellow'] as MatchEvent['type'][]).map(type => (
                <React.Fragment key={type}>
                  <div className={`font-bold ${type === 'yellow' ? 'text-amber-400' : ''}`}>{countEvt(type, leftTeam.id)}</div>
                  <div className="text-zinc-500 uppercase tracking-wider">{type === 'chance' ? 'Chances' : type === 'foul' ? 'Faltas' : 'Amarelos'}</div>
                  <div className={`font-bold ${type === 'yellow' ? 'text-amber-400' : ''}`}>{countEvt(type, rightTeam.id)}</div>
                </React.Fragment>
              ))}
            </div>
          </div>

          {/* Outros resultados — accordion no mobile */}
          {otherMatches.length > 0 && (
            <div className="sm:hidden bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
              <button onClick={() => setShowOtherScores(s => !s)}
                className="w-full flex items-center justify-between px-4 py-2.5 text-sm">
                <span className="flex items-center gap-2 text-zinc-400"><Activity size={15} /> Outros placares</span>
                <ChevronDown size={16} className={`text-zinc-500 transition-transform ${showOtherScores ? 'rotate-180' : ''}`} />
              </button>
              {showOtherScores && (
                <div className="border-t border-zinc-800 divide-y divide-zinc-800/50">
                  {otherMatches.map(lm => {
                    const h = gameState.teams.find(t => t.id === lm.match.homeTeamId)!;
                    const a = gameState.teams.find(t => t.id === lm.match.awayTeamId)!;
                    return (
                      <div key={lm.match.id} className="flex items-center px-4 py-2 text-xs gap-2">
                        <span className="flex-1 text-right truncate">{h.name}</span>
                        <span className="font-mono font-bold bg-zinc-950 px-2 py-0.5 rounded border border-zinc-800">{lm.homeScore}-{lm.awayScore}</span>
                        <span className="flex-1 truncate">{a.name}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Eventos */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl sm:rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-800 text-xs text-zinc-500 font-medium uppercase tracking-wider">
              Eventos da partida
            </div>
            <div className="overflow-y-auto max-h-48 sm:max-h-60 flex flex-col-reverse px-3 py-2 gap-1.5">
              {userMatch.events.length === 0
                ? <div className="text-center text-zinc-600 py-4 text-sm">Nenhum evento ainda.</div>
                : [...userMatch.events].reverse().map(event => {
                  const player = lp[event.playerId];
                  const assister = event.assistId ? lp[event.assistId] : null;
                  const subIn = event.subInId ? lp[event.subInId] : null;
                  const isUser = event.teamId === userTeam.id;
                  return (
                    <div key={event.id} className={`flex items-center gap-2 text-xs ${isUser ? 'flex-row' : 'flex-row-reverse'}`}>
                      <span className="font-mono text-zinc-600 w-6 text-center flex-shrink-0">{event.minute}'</span>
                      <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg max-w-[85%] ${isUser ? 'bg-zinc-800/60' : 'bg-zinc-800/30'}`}>
                        {event.type === 'goal'   && <span className="text-emerald-400 font-bold">⚽ GOL!</span>}
                        {event.type === 'yellow' && <div className="w-2 h-3 bg-amber-400 rounded-sm flex-shrink-0" />}
                        {event.type === 'red'    && <div className="w-2 h-3 bg-red-500 rounded-sm flex-shrink-0" />}
                        {event.type === 'sub'    && <ArrowRightLeft size={12} className="text-blue-400 flex-shrink-0" />}
                        {event.type === 'foul'   && <span className="text-zinc-500 font-bold uppercase text-[10px]">Falta</span>}
                        {event.type === 'chance' && <span className="text-blue-400 font-bold uppercase text-[10px]">Perigo</span>}
                        <span className="font-medium truncate">{player?.name}</span>
                        {event.type === 'goal' && assister && <span className="text-zinc-500 truncate hidden sm:inline">(ass: {assister.name})</span>}
                        {event.type === 'sub' && subIn && <><span className="text-zinc-600">↔</span><span className="font-medium truncate">{subIn.name}</span></>}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>

          {/* Gestão do time */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl sm:rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
              <span className="font-bold text-sm">Seu Time</span>
              <span className="text-xs text-zinc-500">Subs: <span className="text-white font-bold">{userSubs}/5</span></span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-zinc-800">
              {/* Titulares */}
              <div className="p-3">
                <div className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Titulares</div>
                <div className="flex flex-col gap-1">
                  {userLineupIds.map(id => {
                    const p = lp[id];
                    if (!p) return null;
                    const sel = selectedSubOut === id;
                    return (
                      <div key={id} onClick={() => handleSubSelect(id)}
                        className={`flex items-center gap-2 p-2 rounded-lg transition-colors
                          ${p.redCard ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer active:scale-[0.98]'}
                          ${sel ? 'bg-blue-500/15 border border-blue-500/40' : 'hover:bg-zinc-800/60'}`}>
                        <span className="text-[10px] font-bold text-zinc-500 w-4 flex-shrink-0">{p.position}</span>
                        <span className="font-medium text-xs flex-1 truncate">{p.name}</span>
                        {p.redCard && <div className="w-2 h-3 bg-red-500 rounded-sm flex-shrink-0" />}
                        {!p.redCard && p.yellowCards > 0 && <div className="w-2 h-3 bg-amber-400 rounded-sm flex-shrink-0" />}
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <div className="w-10 h-1 bg-zinc-800 rounded-full overflow-hidden">
                            <div className={`h-full ${p.energy > 60 ? 'bg-emerald-500' : p.energy > 30 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${p.energy}%` }} />
                          </div>
                          <span className="text-[10px] font-mono text-zinc-500 w-5">{p.strength}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Banco */}
              <div className="p-3">
                <div className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Banco</div>
                {userBenchIds.length === 0
                  ? <p className="text-xs text-zinc-600 p-2">Sem reservas.</p>
                  : <div className="flex flex-col gap-1">
                    {userBenchIds.map(id => {
                      const p = lp[id];
                      if (!p) return null;
                      return (
                        <div key={id} onClick={() => selectedSubOut && handleSubIn(id)}
                          className={`flex items-center gap-2 p-2 rounded-lg transition-colors
                            ${selectedSubOut ? 'cursor-pointer hover:bg-zinc-800/80 border border-zinc-700 active:scale-[0.98]' : 'opacity-40'}`}>
                          <span className="text-[10px] font-bold text-zinc-500 w-4 flex-shrink-0">{p.position}</span>
                          <span className="font-medium text-xs flex-1 truncate">{p.name}</span>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <div className="w-10 h-1 bg-zinc-800 rounded-full overflow-hidden">
                              <div className={`h-full ${p.energy > 60 ? 'bg-emerald-500' : p.energy > 30 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${p.energy}%` }} />
                            </div>
                            <span className="text-[10px] font-mono text-zinc-500 w-5">{p.strength}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                }
                {selectedSubOut && (
                  <div className="mt-2 p-2 bg-blue-500/10 border border-blue-500/20 rounded-lg flex items-start gap-1.5 text-xs text-blue-400">
                    <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />
                    <p>Escolha um reserva para substituir <strong>{lp[selectedSubOut]?.name}</strong>.</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Botão continuar — mobile, aparece ao fim */}
          {state.isFinished && (
            <button onClick={finishMatch}
              className="sm:hidden w-full bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold py-4 rounded-xl flex items-center justify-center gap-2 transition-colors">
              <Check size={20} /> Continuar
            </button>
          )}
        </div>

        {/* ── Sidebar: outros resultados — só desktop ── */}
        <aside className="hidden lg:flex flex-col w-56 flex-shrink-0 border-l border-zinc-800 p-4 gap-3">
          <div className="flex items-center gap-2 text-sm font-bold text-zinc-400">
            <Activity size={16} className="text-emerald-400" /> Ao Vivo
          </div>
          <div className="flex flex-col gap-2">
            {otherMatches.map(lm => {
              const h = gameState.teams.find(t => t.id === lm.match.homeTeamId)!;
              const a = gameState.teams.find(t => t.id === lm.match.awayTeamId)!;
              return (
                <div key={lm.match.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-2.5 text-xs">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: h.color }} />
                      <span className="truncate">{h.name}</span>
                    </div>
                    <span className="font-mono font-bold ml-1">{lm.homeScore}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: a.color }} />
                      <span className="truncate">{a.name}</span>
                    </div>
                    <span className="font-mono font-bold ml-1">{lm.awayScore}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>
      </div>
    </div>
  );
}