import React, { useState, useEffect, useRef } from 'react';
import { GameState, Match, Player, MatchEvent } from './types';
import { getEffectiveStrength, getBestLineup } from './engine';
import { Play, Pause, FastForward, ArrowRightLeft, Check, AlertCircle, Activity } from 'lucide-react';

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

interface Props {
  gameState: GameState;
  matches: Match[];
  userLineup: string[];
  onComplete: (matches: Match[], playerUpdates: Partial<Player>[]) => void;
}

export default function LiveMatchDay({ gameState, matches, userLineup, onComplete }: Props) {
  const [minute, setMinute] = useState(0);
  const [isPlaying, setIsPlaying] = useState(true);
  const [speed, setSpeed] = useState(300); // ms per minute
  const [isFinished, setIsFinished] = useState(false);

  const [liveMatches, setLiveMatches] = useState<LiveMatch[]>(() => {
    return matches.map(m => {
      let homePlayers = gameState.players.filter(p => p.teamId === m.homeTeamId);
      let awayPlayers = gameState.players.filter(p => p.teamId === m.awayTeamId);

      let homeLineupIds: string[] = [];
      let awayLineupIds: string[] = [];

      if (m.homeTeamId === gameState.userTeamId) {
        homeLineupIds = [...userLineup];
      } else {
        homeLineupIds = getBestLineup(homePlayers).map(p => p.id);
      }

      if (m.awayTeamId === gameState.userTeamId) {
        awayLineupIds = [...userLineup];
      } else {
        awayLineupIds = getBestLineup(awayPlayers).map(p => p.id);
      }

      const homeBenchIds = homePlayers.filter(p => !homeLineupIds.includes(p.id) && !p.redCard).map(p => p.id);
      const awayBenchIds = awayPlayers.filter(p => !awayLineupIds.includes(p.id) && !p.redCard).map(p => p.id);

      return {
        match: m,
        homeLineup: homeLineupIds,
        awayLineup: awayLineupIds,
        homeBench: homeBenchIds,
        awayBench: awayBenchIds,
        homeScore: 0,
        awayScore: 0,
        events: [],
        homeSubs: 0,
        awaySubs: 0
      };
    });
  });

  const [livePlayers, setLivePlayers] = useState<Record<string, Player>>(() => {
    const map: Record<string, Player> = {};
    gameState.players.forEach(p => {
      map[p.id] = { ...p };
    });
    return map;
  });

  const [selectedSubOut, setSelectedSubOut] = useState<string | null>(null);

  useEffect(() => {
    if (!isPlaying || isFinished) return;

    const timer = setTimeout(() => {
      if (minute >= 90) {
        setIsFinished(true);
        setIsPlaying(false);
        return;
      }

      setMinute(m => m + 1);
      
      setLiveMatches(prevMatches => prevMatches.map(lm => {
        let newHomeScore = lm.homeScore;
        let newAwayScore = lm.awayScore;
        const newEvents = [...lm.events];
        let newHomeLineup = [...lm.homeLineup];
        let newAwayLineup = [...lm.awayLineup];
        let newHomeBench = [...lm.homeBench];
        let newAwayBench = [...lm.awayBench];
        let newHomeSubs = lm.homeSubs;
        let newAwaySubs = lm.awaySubs;

        const homePlayersOnPitch = newHomeLineup.map(id => livePlayers[id]).filter(p => !p.redCard);
        const awayPlayersOnPitch = newAwayLineup.map(id => livePlayers[id]).filter(p => !p.redCard);

        const homeStrength = homePlayersOnPitch.reduce((sum, p) => sum + getEffectiveStrength(p), 0) / (homePlayersOnPitch.length || 1);
        const awayStrength = awayPlayersOnPitch.reduce((sum, p) => sum + getEffectiveStrength(p), 0) / (awayPlayersOnPitch.length || 1);

        const homeChance = 0.015 * (homeStrength / 80);
        const awayChance = 0.012 * (awayStrength / 80);

        const pickPlayer = (players: Player[], isScorer: boolean) => {
          const weights = players.map(p => {
            let w = 1;
            if (p.position === 'A') w = isScorer ? 10 : 5;
            if (p.position === 'M') w = isScorer ? 4 : 8;
            if (p.position === 'D') w = isScorer ? 1 : 2;
            if (p.position === 'G') w = 0;
            return w;
          });
          const totalWeight = weights.reduce((a, b) => a + b, 0);
          if (totalWeight === 0) return players[0];
          let roll = Math.random() * totalWeight;
          for (let i = 0; i < players.length; i++) {
            roll -= weights[i];
            if (roll <= 0) return players[i];
          }
          return players[0];
        };

        if (Math.random() < homeChance) {
          newHomeScore++;
          const scorer = pickPlayer(homePlayersOnPitch, true);
          if (scorer) newEvents.push({ id: Math.random().toString(), minute: minute + 1, type: 'goal', teamId: lm.match.homeTeamId, playerId: scorer.id });
        }
        if (Math.random() < awayChance) {
          newAwayScore++;
          const scorer = pickPlayer(awayPlayersOnPitch, true);
          if (scorer) newEvents.push({ id: Math.random().toString(), minute: minute + 1, type: 'goal', teamId: lm.match.awayTeamId, playerId: scorer.id });
        }

        // Cards and Energy
        setLivePlayers(prevPlayers => {
          const nextPlayers = { ...prevPlayers };
          [...homePlayersOnPitch, ...awayPlayersOnPitch].forEach(p => {
            // Energy drops by ~0.2 to 0.4 per minute
            if (Math.random() < 0.3) {
              nextPlayers[p.id] = { ...nextPlayers[p.id], energy: Math.max(0, nextPlayers[p.id].energy - 1) };
            }
            // Cards
            if (Math.random() < 0.002) {
              if (Math.random() < 0.1) {
                nextPlayers[p.id] = { ...nextPlayers[p.id], redCard: true };
                newEvents.push({ id: Math.random().toString(), minute: minute + 1, type: 'red', teamId: p.teamId, playerId: p.id });
              } else {
                const yellows = nextPlayers[p.id].yellowCards + 1;
                if (yellows >= 2) {
                  nextPlayers[p.id] = { ...nextPlayers[p.id], yellowCards: 0, redCard: true };
                  newEvents.push({ id: Math.random().toString(), minute: minute + 1, type: 'red', teamId: p.teamId, playerId: p.id });
                } else {
                  nextPlayers[p.id] = { ...nextPlayers[p.id], yellowCards: yellows };
                  newEvents.push({ id: Math.random().toString(), minute: minute + 1, type: 'yellow', teamId: p.teamId, playerId: p.id });
                }
              }
            }
          });
          return nextPlayers;
        });

        // AI Substitutions (simple logic: if energy < 40 and subs < 3, sub out)
        if (lm.match.homeTeamId !== gameState.userTeamId && newHomeSubs < 3 && minute > 60) {
          const tired = homePlayersOnPitch.find(p => livePlayers[p.id].energy < 40);
          if (tired && newHomeBench.length > 0) {
            const subIn = newHomeBench[0];
            newHomeLineup = newHomeLineup.filter(id => id !== tired.id);
            newHomeLineup.push(subIn);
            newHomeBench = newHomeBench.filter(id => id !== subIn);
            newHomeSubs++;
            newEvents.push({ id: Math.random().toString(), minute: minute + 1, type: 'sub', teamId: lm.match.homeTeamId, playerId: tired.id, subInId: subIn });
          }
        }
        if (lm.match.awayTeamId !== gameState.userTeamId && newAwaySubs < 3 && minute > 60) {
          const tired = awayPlayersOnPitch.find(p => livePlayers[p.id].energy < 40);
          if (tired && newAwayBench.length > 0) {
            const subIn = newAwayBench[0];
            newAwayLineup = newAwayLineup.filter(id => id !== tired.id);
            newAwayLineup.push(subIn);
            newAwayBench = newAwayBench.filter(id => id !== subIn);
            newAwaySubs++;
            newEvents.push({ id: Math.random().toString(), minute: minute + 1, type: 'sub', teamId: lm.match.awayTeamId, playerId: tired.id, subInId: subIn });
          }
        }

        return {
          ...lm,
          homeScore: newHomeScore,
          awayScore: newAwayScore,
          events: newEvents,
          homeLineup: newHomeLineup,
          awayLineup: newAwayLineup,
          homeBench: newHomeBench,
          awayBench: newAwayBench,
          homeSubs: newHomeSubs,
          awaySubs: newAwaySubs
        };
      }));

    }, speed);

    return () => clearTimeout(timer);
  }, [minute, isPlaying, isFinished, speed, livePlayers, gameState.userTeamId]);

  const handleSub = (subInId: string) => {
    if (!selectedSubOut) return;
    
    setLiveMatches(prev => prev.map(lm => {
      const isHome = lm.match.homeTeamId === gameState.userTeamId;
      const isAway = lm.match.awayTeamId === gameState.userTeamId;
      if (!isHome && !isAway) return lm;

      let newHomeLineup = [...lm.homeLineup];
      let newAwayLineup = [...lm.awayLineup];
      let newHomeBench = [...lm.homeBench];
      let newAwayBench = [...lm.awayBench];
      let newHomeSubs = lm.homeSubs;
      let newAwaySubs = lm.awaySubs;
      const newEvents = [...lm.events];

      if (isHome && newHomeSubs < 5) {
        newHomeLineup = newHomeLineup.filter(id => id !== selectedSubOut);
        newHomeLineup.push(subInId);
        newHomeBench = newHomeBench.filter(id => id !== subInId);
        newHomeSubs++;
        newEvents.push({ id: Math.random().toString(), minute, type: 'sub', teamId: lm.match.homeTeamId, playerId: selectedSubOut, subInId });
      } else if (isAway && newAwaySubs < 5) {
        newAwayLineup = newAwayLineup.filter(id => id !== selectedSubOut);
        newAwayLineup.push(subInId);
        newAwayBench = newAwayBench.filter(id => id !== subInId);
        newAwaySubs++;
        newEvents.push({ id: Math.random().toString(), minute, type: 'sub', teamId: lm.match.awayTeamId, playerId: selectedSubOut, subInId });
      }

      return {
        ...lm,
        homeLineup: newHomeLineup,
        awayLineup: newAwayLineup,
        homeBench: newHomeBench,
        awayBench: newAwayBench,
        homeSubs: newHomeSubs,
        awaySubs: newAwaySubs,
        events: newEvents
      };
    }));
    setSelectedSubOut(null);
  };

  const finishMatch = () => {
    const updatedMatches = liveMatches.map(lm => ({
      ...lm.match,
      homeScore: lm.homeScore,
      awayScore: lm.awayScore,
      played: true
    }));

    const playerUpdates: Partial<Player>[] = [];
    Object.values(livePlayers).forEach((p: Player) => {
      let goals = 0;
      liveMatches.forEach(lm => {
        goals += lm.events.filter(e => e.type === 'goal' && e.playerId === p.id).length;
      });

      playerUpdates.push({
        id: p.id,
        energy: p.energy,
        yellowCards: p.yellowCards,
        redCard: p.redCard,
        goals: p.goals + goals,
        matchesPlayed: p.matchesPlayed + 1
      });
    });

    onComplete(updatedMatches, playerUpdates);
  };

  const userMatch = liveMatches.find(m => m.match.homeTeamId === gameState.userTeamId || m.match.awayTeamId === gameState.userTeamId);
  const otherMatches = liveMatches.filter(m => m.match.id !== userMatch?.match.id);
  const userTeam = gameState.teams.find(t => t.id === gameState.userTeamId)!;
  
  if (!userMatch) return null;

  const isHome = userMatch.match.homeTeamId === userTeam.id;
  const opponentId = isHome ? userMatch.match.awayTeamId : userMatch.match.homeTeamId;
  const opponentTeam = gameState.teams.find(t => t.id === opponentId)!;

  const userLineupIds = isHome ? userMatch.homeLineup : userMatch.awayLineup;
  const userBenchIds = isHome ? userMatch.homeBench : userMatch.awayBench;
  const userSubs = isHome ? userMatch.homeSubs : userMatch.awaySubs;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans flex flex-col">
      {/* Top Bar */}
      <header className="bg-zinc-900 border-b border-zinc-800 p-4 sticky top-0 z-10 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="text-3xl font-black font-mono text-emerald-400 w-16 text-center">
            {minute}'
          </div>
          <div className="flex gap-2">
            <button 
              onClick={() => setIsPlaying(!isPlaying)}
              disabled={isFinished}
              className="p-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors disabled:opacity-50"
            >
              {isPlaying ? <Pause size={20} /> : <Play size={20} />}
            </button>
            <button 
              onClick={() => setSpeed(s => s === 300 ? 50 : 300)}
              disabled={isFinished}
              className={`p-2 rounded-lg transition-colors disabled:opacity-50 ${speed === 50 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-800 hover:bg-zinc-700'}`}
            >
              <FastForward size={20} />
            </button>
          </div>
        </div>
        
        {isFinished && (
          <button 
            onClick={finishMatch}
            className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold py-2 px-6 rounded-full flex items-center gap-2 transition-colors animate-in fade-in"
          >
            <Check size={18} />
            Continuar
          </button>
        )}
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full p-4 grid grid-cols-1 lg:grid-cols-4 gap-6">
        
        {/* Main Match Area */}
        <div className="lg:col-span-3 flex flex-col gap-6">
          
          {/* Scoreboard */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 flex items-center justify-between">
            <div className="flex-1 flex flex-col items-center gap-4">
              <div className="w-24 h-24 rounded-full flex items-center justify-center text-4xl font-bold shadow-lg" style={{ backgroundColor: isHome ? userTeam.color : opponentTeam.color, color: '#fff' }}>
                {(isHome ? userTeam.name : opponentTeam.name).charAt(0)}
              </div>
              <h2 className="text-xl font-bold text-center">{isHome ? userTeam.name : opponentTeam.name}</h2>
            </div>
            
            <div className="px-8 text-6xl font-black font-mono tabular-nums tracking-tighter">
              {userMatch.homeScore} - {userMatch.awayScore}
            </div>
            
            <div className="flex-1 flex flex-col items-center gap-4">
              <div className="w-24 h-24 rounded-full flex items-center justify-center text-4xl font-bold shadow-lg" style={{ backgroundColor: !isHome ? userTeam.color : opponentTeam.color, color: '#fff' }}>
                {(!isHome ? userTeam.name : opponentTeam.name).charAt(0)}
              </div>
              <h2 className="text-xl font-bold text-center">{!isHome ? userTeam.name : opponentTeam.name}</h2>
            </div>
          </div>

          {/* Events Log */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 flex-1 overflow-y-auto max-h-[300px]">
            <h3 className="font-bold text-lg mb-4 text-zinc-400">Eventos da Partida</h3>
            <div className="flex flex-col gap-3">
              {userMatch.events.slice().reverse().map(event => {
                const player = livePlayers[event.playerId];
                const isUserEvent = event.teamId === userTeam.id;
                return (
                  <div key={event.id} className={`flex items-center gap-4 ${isUserEvent ? 'flex-row' : 'flex-row-reverse'}`}>
                    <div className="font-mono text-zinc-500 w-8 text-center">{event.minute}'</div>
                    <div className={`flex items-center gap-2 px-4 py-2 rounded-lg ${isUserEvent ? 'bg-zinc-800/50' : 'bg-zinc-800/20'}`}>
                      {event.type === 'goal' && <span className="text-emerald-400 font-bold">⚽ GOL!</span>}
                      {event.type === 'yellow' && <div className="w-3 h-4 bg-amber-400 rounded-sm"></div>}
                      {event.type === 'red' && <div className="w-3 h-4 bg-red-500 rounded-sm"></div>}
                      {event.type === 'sub' && <ArrowRightLeft size={16} className="text-blue-400" />}
                      
                      <span className="font-medium">{player?.name}</span>
                      
                      {event.type === 'sub' && event.subInId && (
                        <>
                          <span className="text-zinc-500">saiu para a entrada de</span>
                          <span className="font-medium">{livePlayers[event.subInId]?.name}</span>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
              {userMatch.events.length === 0 && (
                <div className="text-center text-zinc-600 py-8">Nenhum evento importante ainda.</div>
              )}
            </div>
          </div>

          {/* User Team Management */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
            <div className="p-4 border-b border-zinc-800 flex justify-between items-center bg-zinc-950/50">
              <h3 className="font-bold text-lg">Seu Time (Em Campo)</h3>
              <div className="text-sm text-zinc-400">
                Substituições: <span className="font-bold text-white">{userSubs}/5</span>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4">
              <div>
                <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Titulares</h4>
                <div className="flex flex-col gap-1">
                  {userLineupIds.map(id => {
                    const p = livePlayers[id];
                    if (!p) return null;
                    const isSelected = selectedSubOut === id;
                    return (
                      <div 
                        key={id} 
                        onClick={() => {
                          if (userSubs < 5 && !p.redCard) {
                            setSelectedSubOut(isSelected ? null : id);
                          }
                        }}
                        className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-colors ${isSelected ? 'bg-blue-500/20 border border-blue-500/50' : 'bg-zinc-800/50 hover:bg-zinc-800'} ${p.redCard ? 'opacity-50 cursor-not-allowed' : ''}`}
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-bold w-4">{p.position}</span>
                          <span className="font-medium">{p.name}</span>
                          {p.redCard && <div className="w-2 h-3 bg-red-500 rounded-sm"></div>}
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-zinc-400">{p.energy}%</span>
                            <div className="w-12 h-1.5 bg-zinc-900 rounded-full overflow-hidden">
                              <div className={`h-full ${p.energy > 60 ? 'bg-emerald-500' : p.energy > 30 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${p.energy}%` }}></div>
                            </div>
                          </div>
                          <span className="font-mono text-xs bg-zinc-950 px-1.5 py-0.5 rounded text-zinc-400">{p.strength}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              
              <div>
                <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Banco de Reservas</h4>
                <div className="flex flex-col gap-1">
                  {userBenchIds.map(id => {
                    const p = livePlayers[id];
                    if (!p) return null;
                    return (
                      <div 
                        key={id} 
                        onClick={() => {
                          if (selectedSubOut) {
                            handleSub(id);
                          }
                        }}
                        className={`flex items-center justify-between p-2 rounded-lg transition-colors ${selectedSubOut ? 'bg-zinc-800 hover:bg-zinc-700 cursor-pointer border border-zinc-700' : 'bg-zinc-900/50 opacity-50'}`}
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-bold w-4">{p.position}</span>
                          <span className="font-medium">{p.name}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-zinc-400">{p.energy}%</span>
                          <span className="font-mono text-xs bg-zinc-950 px-1.5 py-0.5 rounded text-zinc-400">{p.strength}</span>
                        </div>
                      </div>
                    );
                  })}
                  {userBenchIds.length === 0 && (
                    <div className="text-sm text-zinc-500 p-2">Sem reservas disponíveis.</div>
                  )}
                </div>
                {selectedSubOut && (
                  <div className="mt-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg flex items-start gap-2 text-sm text-blue-400">
                    <AlertCircle size={16} className="mt-0.5 shrink-0" />
                    <p>Selecione um jogador do banco para entrar no lugar de {livePlayers[selectedSubOut]?.name}.</p>
                  </div>
                )}
              </div>
            </div>
          </div>

        </div>

        {/* Sidebar: Other Matches */}
        <div className="lg:col-span-1">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden sticky top-24">
            <div className="p-4 border-b border-zinc-800 bg-zinc-950/50">
              <h3 className="font-bold flex items-center gap-2">
                <Activity size={18} className="text-emerald-400" />
                Placar ao Vivo
              </h3>
            </div>
            <div className="divide-y divide-zinc-800/50">
              {otherMatches.map(lm => {
                const home = gameState.teams.find(t => t.id === lm.match.homeTeamId)!;
                const away = gameState.teams.find(t => t.id === lm.match.awayTeamId)!;
                return (
                  <div key={lm.match.id} className="p-3 flex items-center justify-between text-sm">
                    <div className="flex-1 text-right truncate font-medium">{home.name}</div>
                    <div className="px-3 font-mono font-bold bg-zinc-950 rounded mx-2 py-0.5 border border-zinc-800">
                      {lm.homeScore} - {lm.awayScore}
                    </div>
                    <div className="flex-1 truncate font-medium">{away.name}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

      </main>
    </div>
  );
}
