/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { generateInitialState } from './data';
import { GameState, Team, Player, Match } from './types';
import { simulateMatch, getBestLineup } from './engine';
import { Trophy, Users, Calendar, Play, Activity, Shield, Sword, Goal, Dumbbell } from 'lucide-react';
import LiveMatchDay from './LiveMatchDay';

export default function App() {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [activeTab, setActiveTab] = useState<'squad' | 'standings' | 'fixtures' | 'training'>('squad');
  const [matchResult, setMatchResult] = useState<Match | null>(null);
  const [isLiveMatchMode, setIsLiveMatchMode] = useState(false);

  const startGame = (teamId: string) => {
    const initialState = generateInitialState();
    const userTeamPlayers = initialState.players.filter(p => p.teamId === teamId);
    const bestLineup = getBestLineup(userTeamPlayers).map(p => p.id);
    
    setGameState({
      ...initialState,
      currentRound: 1,
      userTeamId: teamId,
      userLineup: bestLineup,
    });
  };

  if (!gameState) {
    const tempState = generateInitialState();
    return (
      <div className="min-h-screen bg-zinc-900 text-zinc-100 p-8 font-sans">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h1 className="text-5xl font-black tracking-tighter text-emerald-400 mb-4">BRASMANAGER</h1>
            <p className="text-zinc-400 text-lg">Escolha seu time e leve-o à glória.</p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {tempState.teams.map(team => (
              <button
                key={team.id}
                onClick={() => startGame(team.id)}
                className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-xl p-6 transition-all flex flex-col items-center gap-4 group"
              >
                <div 
                  className="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold shadow-lg group-hover:scale-110 transition-transform"
                  style={{ backgroundColor: team.color, color: '#fff' }}
                >
                  {team.name.charAt(0)}
                </div>
                <span className="font-semibold text-lg">{team.name}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const userTeam = gameState.teams.find(t => t.id === gameState.userTeamId)!;
  const userPlayers = gameState.players.filter(p => p.teamId === userTeam.id).sort((a, b) => {
    const posOrder = { 'G': 1, 'D': 2, 'M': 3, 'A': 4 };
    if (posOrder[a.position] !== posOrder[b.position]) return posOrder[a.position] - posOrder[b.position];
    return b.strength - a.strength;
  });

  const currentRoundMatches = gameState.matches.filter(m => m.round === gameState.currentRound);
  const userMatch = currentRoundMatches.find(m => m.homeTeamId === userTeam.id || m.awayTeamId === userTeam.id);

  const playRound = () => {
    if (!userMatch) return;
    setIsLiveMatchMode(true);
  };

  const handleMatchDayComplete = (updatedMatches: Match[], playerUpdates: Partial<Player>[]) => {
    let nextPlayers = gameState!.players.map(p => {
      // Default: rest and recover energy, clear red card if they were suspended
      let newEnergy = Math.min(100, p.energy + 20);
      let newRedCard = p.redCard ? false : p.redCard; // served suspension
      return { ...p, energy: newEnergy, redCard: newRedCard };
    });

    // Apply updates to nextPlayers
    playerUpdates.forEach(update => {
      const pIndex = nextPlayers.findIndex(p => p.id === update.id);
      if (pIndex !== -1) {
        nextPlayers[pIndex] = { ...nextPlayers[pIndex], ...update };
      }
    });

    const newMatches = gameState!.matches.map(m => {
      const sim = updatedMatches.find(sm => sm.id === m.id);
      return sim ? sim : m;
    });

    const userSimMatch = updatedMatches.find(m => m.id === userMatch.id);
    setMatchResult(userSimMatch || null);

    // Remove suspended players from user lineup
    const newUserLineup = gameState!.userLineup.filter(id => {
      const p = nextPlayers.find(p => p.id === id);
      return p && !p.redCard;
    });

    setGameState(prev => ({
      ...prev!,
      players: nextPlayers,
      matches: newMatches,
      currentRound: prev!.currentRound + 1,
      userLineup: newUserLineup
    }));
    setIsLiveMatchMode(false);
  };

  if (isLiveMatchMode) {
    return <LiveMatchDay gameState={gameState!} matches={currentRoundMatches} userLineup={gameState!.userLineup} onComplete={handleMatchDayComplete} />;
  }

  const trainPlayer = (playerId: string) => {
    setGameState(prev => {
      if (!prev) return prev;
      const cost = 50000; // Cost to train
      const userTeam = prev.teams.find(t => t.id === prev.userTeamId);
      if (!userTeam || userTeam.money < cost) return prev;

      const newTeams = prev.teams.map(t => 
        t.id === prev.userTeamId ? { ...t, money: t.money - cost } : t
      );

      const newPlayers = prev.players.map(p => {
        if (p.id === playerId) {
          let newProgress = p.trainingProgress + 25;
          let newStrength = p.strength;
          if (newProgress >= 100) {
            newStrength = Math.min(99, newStrength + 1);
            newProgress -= 100;
          }
          return { ...p, trainingProgress: newProgress, strength: newStrength };
        }
        return p;
      });

      return { ...prev, teams: newTeams, players: newPlayers };
    });
  };

  const togglePlayerInLineup = (playerId: string) => {
    setGameState(prev => {
      if (!prev) return prev;
      const player = prev.players.find(p => p.id === playerId);
      if (player?.redCard) return prev; // Cannot select suspended player

      const isSelected = prev.userLineup.includes(playerId);
      let newLineup = [...prev.userLineup];
      
      if (isSelected) {
        newLineup = newLineup.filter(id => id !== playerId);
      } else {
        if (newLineup.length < 11) {
          newLineup.push(playerId);
        }
      }
      return { ...prev, userLineup: newLineup };
    });
  };

  const calculateStandings = () => {
    const standings = gameState.teams.map(team => ({
      ...team,
      pts: 0, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0
    }));

    gameState.matches.filter(m => m.played).forEach(match => {
      const home = standings.find(t => t.id === match.homeTeamId)!;
      const away = standings.find(t => t.id === match.awayTeamId)!;

      home.p++; away.p++;
      home.gf += match.homeScore; home.ga += match.awayScore;
      away.gf += match.awayScore; away.ga += match.homeScore;

      if (match.homeScore > match.awayScore) {
        home.pts += 3; home.w++; away.l++;
      } else if (match.homeScore < match.awayScore) {
        away.pts += 3; away.w++; home.l++;
      } else {
        home.pts += 1; away.pts += 1; home.d++; away.d++;
      }
    });

    standings.forEach(t => t.gd = t.gf - t.ga);
    standings.sort((a, b) => b.pts - a.pts || b.w - a.w || b.gd - a.gd || b.gf - a.gf);
    return standings;
  };

  const standings = calculateStandings();

  return (
    <div className="min-h-screen bg-zinc-900 text-zinc-100 font-sans flex flex-col">
      {/* Header */}
      <header className="bg-zinc-950 border-b border-zinc-800 p-4 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div 
              className="w-10 h-10 rounded-full flex items-center justify-center font-bold"
              style={{ backgroundColor: userTeam.color, color: '#fff' }}
            >
              {userTeam.name.charAt(0)}
            </div>
            <div>
              <h2 className="font-bold text-lg leading-tight">{userTeam.name}</h2>
              <div className="text-xs text-zinc-400 flex items-center gap-2">
                <span>Rodada {gameState.currentRound}</span>
                <span>•</span>
                <span className="text-emerald-400 font-mono">R$ {(userTeam.money / 1000000).toFixed(1)}M</span>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            {userMatch && !matchResult && (
              <div className="text-right hidden sm:block">
                <div className="text-xs text-zinc-400 uppercase tracking-wider">Próximo Jogo</div>
                <div className="font-medium">
                  {gameState.teams.find(t => t.id === userMatch.homeTeamId)?.name} x {gameState.teams.find(t => t.id === userMatch.awayTeamId)?.name}
                </div>
              </div>
            )}
            <button 
              onClick={playRound}
              disabled={gameState.userLineup.length !== 11 || matchResult !== null || !userMatch}
              className="bg-emerald-500 hover:bg-emerald-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-zinc-950 font-bold py-2 px-6 rounded-full flex items-center gap-2 transition-colors"
            >
              <Play size={18} className={matchResult ? "opacity-0" : ""} />
              {gameState.userLineup.length !== 11 ? `Escale 11 (${gameState.userLineup.length})` : 'Jogar'}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-6xl mx-auto w-full p-4 grid grid-cols-1 lg:grid-cols-4 gap-6">
        
        {/* Sidebar Navigation */}
        <div className="lg:col-span-1 flex flex-row lg:flex-col gap-2 overflow-x-auto pb-2 lg:pb-0">
          <button 
            onClick={() => setActiveTab('squad')}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-colors whitespace-nowrap ${activeTab === 'squad' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:bg-zinc-800/50'}`}
          >
            <Users size={20} />
            <span className="font-medium">Elenco</span>
          </button>
          <button 
            onClick={() => setActiveTab('standings')}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-colors whitespace-nowrap ${activeTab === 'standings' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:bg-zinc-800/50'}`}
          >
            <Trophy size={20} />
            <span className="font-medium">Classificação</span>
          </button>
          <button 
            onClick={() => setActiveTab('fixtures')}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-colors whitespace-nowrap ${activeTab === 'fixtures' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:bg-zinc-800/50'}`}
          >
            <Calendar size={20} />
            <span className="font-medium">Calendário</span>
          </button>
          <button 
            onClick={() => setActiveTab('training')}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-colors whitespace-nowrap ${activeTab === 'training' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:bg-zinc-800/50'}`}
          >
            <Dumbbell size={20} />
            <span className="font-medium">Treino</span>
          </button>
        </div>

        {/* Content Area */}
        <div className="lg:col-span-3">
          
          {/* Match Result Modal/Overlay */}
          {matchResult && (
            <div className="mb-6 bg-zinc-800 border border-zinc-700 rounded-2xl p-6 text-center animate-in fade-in slide-in-from-top-4">
              <h3 className="text-zinc-400 text-sm uppercase tracking-widest mb-4">Fim de Jogo</h3>
              <div className="flex items-center justify-center gap-8 mb-8">
                <div className="text-right flex-1">
                  <div className="text-2xl font-bold">{gameState.teams.find(t => t.id === matchResult.homeTeamId)?.name}</div>
                </div>
                <div className="text-5xl font-black font-mono bg-zinc-900 px-6 py-3 rounded-xl border border-zinc-700">
                  {matchResult.homeScore} - {matchResult.awayScore}
                </div>
                <div className="text-left flex-1">
                  <div className="text-2xl font-bold">{gameState.teams.find(t => t.id === matchResult.awayTeamId)?.name}</div>
                </div>
              </div>
              <button 
                onClick={() => setMatchResult(null)}
                className="bg-zinc-100 text-zinc-900 hover:bg-white font-bold py-2 px-8 rounded-full transition-colors"
              >
                Continuar
              </button>
            </div>
          )}

          {activeTab === 'squad' && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
              <div className="p-4 border-b border-zinc-800 flex justify-between items-center bg-zinc-950/50">
                <h3 className="font-bold text-lg flex items-center gap-2">
                  <Shield size={20} className="text-zinc-400" />
                  Seu Elenco
                </h3>
                <div className="text-sm">
                  Selecionados: <span className={gameState.userLineup.length === 11 ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>{gameState.userLineup.length}/11</span>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-zinc-900 text-zinc-400 border-b border-zinc-800">
                    <tr>
                      <th className="p-4 font-medium w-12">Pos</th>
                      <th className="p-4 font-medium">Nome</th>
                      <th className="p-4 font-medium text-center">Força</th>
                      <th className="p-4 font-medium text-center">Idade</th>
                      <th className="p-4 font-medium text-center">J</th>
                      <th className="p-4 font-medium text-center">G</th>
                      <th className="p-4 font-medium text-center">A</th>
                      <th className="p-4 font-medium text-center">Energia</th>
                      <th className="p-4 font-medium text-center">Cartões</th>
                      <th className="p-4 font-medium text-right">Escalar</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/50">
                    {userPlayers.map(player => {
                      const isSelected = gameState.userLineup.includes(player.id);
                      const isSuspended = player.redCard;
                      return (
                        <tr 
                          key={player.id} 
                          className={`hover:bg-zinc-800/50 transition-colors ${isSuspended ? 'opacity-50' : 'cursor-pointer'} ${isSelected ? 'bg-zinc-800/30' : ''}`}
                          onClick={() => !isSuspended && togglePlayerInLineup(player.id)}
                        >
                          <td className="p-4">
                            <span className={`inline-flex items-center justify-center w-8 h-8 rounded-lg font-bold text-xs
                              ${player.position === 'G' ? 'bg-amber-500/20 text-amber-400' : ''}
                              ${player.position === 'D' ? 'bg-blue-500/20 text-blue-400' : ''}
                              ${player.position === 'M' ? 'bg-emerald-500/20 text-emerald-400' : ''}
                              ${player.position === 'A' ? 'bg-red-500/20 text-red-400' : ''}
                            `}>
                              {player.position}
                            </span>
                          </td>
                          <td className="p-4 font-medium">
                            {player.name}
                            {isSuspended && <span className="ml-2 text-xs text-red-500 font-bold uppercase">Suspenso</span>}
                          </td>
                          <td className="p-4 text-center">
                            <span className="font-mono bg-zinc-950 px-2 py-1 rounded text-zinc-300 border border-zinc-800">{player.strength}</span>
                          </td>
                          <td className="p-4 text-center text-zinc-400">{player.age}</td>
                          <td className="p-4 text-center text-zinc-400">{player.matchesPlayed}</td>
                          <td className="p-4 text-center text-zinc-400">{player.goals}</td>
                          <td className="p-4 text-center text-zinc-400">{player.assists}</td>
                          <td className="p-4 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <span className="text-xs text-zinc-400 w-8">{player.energy}%</span>
                              <div className="w-16 bg-zinc-800 rounded-full h-2">
                                <div className={`h-2 rounded-full ${player.energy > 70 ? 'bg-emerald-500' : player.energy > 30 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${player.energy}%` }}></div>
                              </div>
                            </div>
                          </td>
                          <td className="p-4 text-center">
                            <div className="flex items-center justify-center gap-1">
                              {player.redCard && <div className="w-3 h-4 bg-red-500 rounded-sm"></div>}
                              {!player.redCard && Array.from({ length: player.yellowCards }).map((_, i) => (
                                <div key={i} className="w-3 h-4 bg-amber-400 rounded-sm"></div>
                              ))}
                            </div>
                          </td>
                          <td className="p-4 text-right">
                            <div className={`w-6 h-6 rounded-full border-2 inline-flex items-center justify-center transition-colors
                              ${isSelected ? 'bg-emerald-500 border-emerald-500' : isSuspended ? 'border-zinc-800 bg-zinc-900' : 'border-zinc-600'}
                            `}>
                              {isSelected && <div className="w-2 h-2 bg-zinc-950 rounded-full" />}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'standings' && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
              <div className="p-4 border-b border-zinc-800 bg-zinc-950/50">
                <h3 className="font-bold text-lg flex items-center gap-2">
                  <Trophy size={20} className="text-zinc-400" />
                  Tabela do Campeonato
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-zinc-900 text-zinc-400 border-b border-zinc-800">
                    <tr>
                      <th className="p-4 font-medium w-12 text-center">#</th>
                      <th className="p-4 font-medium">Time</th>
                      <th className="p-4 font-medium text-center">Pts</th>
                      <th className="p-4 font-medium text-center">J</th>
                      <th className="p-4 font-medium text-center">V</th>
                      <th className="p-4 font-medium text-center">E</th>
                      <th className="p-4 font-medium text-center">D</th>
                      <th className="p-4 font-medium text-center">SG</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/50">
                    {standings.map((team, index) => (
                      <tr key={team.id} className={`hover:bg-zinc-800/50 ${team.id === userTeam.id ? 'bg-zinc-800/30' : ''}`}>
                        <td className="p-4 text-center text-zinc-500 font-mono">{index + 1}</td>
                        <td className="p-4 font-medium flex items-center gap-3">
                          <div className="w-6 h-6 rounded-full flex-shrink-0" style={{ backgroundColor: team.color }}></div>
                          {team.name}
                        </td>
                        <td className="p-4 text-center font-bold text-white">{team.pts}</td>
                        <td className="p-4 text-center text-zinc-400">{team.p}</td>
                        <td className="p-4 text-center text-zinc-400">{team.w}</td>
                        <td className="p-4 text-center text-zinc-400">{team.d}</td>
                        <td className="p-4 text-center text-zinc-400">{team.l}</td>
                        <td className="p-4 text-center text-zinc-400">{team.gd > 0 ? `+${team.gd}` : team.gd}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'fixtures' && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden p-6">
              <h3 className="font-bold text-lg flex items-center gap-2 mb-6">
                <Calendar size={20} className="text-zinc-400" />
                Rodada {gameState.currentRound}
              </h3>
              <div className="grid gap-3">
                {currentRoundMatches.map(match => {
                  const home = gameState.teams.find(t => t.id === match.homeTeamId)!;
                  const away = gameState.teams.find(t => t.id === match.awayTeamId)!;
                  const isUserMatch = home.id === userTeam.id || away.id === userTeam.id;
                  
                  return (
                    <div key={match.id} className={`flex items-center justify-between p-4 rounded-xl border ${isUserMatch ? 'bg-zinc-800 border-zinc-600' : 'bg-zinc-950/50 border-zinc-800'}`}>
                      <div className="flex items-center justify-end gap-3 flex-1">
                        <span className={`font-medium ${isUserMatch && home.id === userTeam.id ? 'text-emerald-400' : ''}`}>{home.name}</span>
                        <div className="w-6 h-6 rounded-full" style={{ backgroundColor: home.color }}></div>
                      </div>
                      
                      <div className="px-6 font-mono font-bold text-lg min-w-[80px] text-center">
                        {match.played ? `${match.homeScore} - ${match.awayScore}` : 'vs'}
                      </div>
                      
                      <div className="flex items-center justify-start gap-3 flex-1">
                        <div className="w-6 h-6 rounded-full" style={{ backgroundColor: away.color }}></div>
                        <span className={`font-medium ${isUserMatch && away.id === userTeam.id ? 'text-emerald-400' : ''}`}>{away.name}</span>
                      </div>
                    </div>
                  );
                })}
                {currentRoundMatches.length === 0 && (
                  <div className="text-center text-zinc-500 py-8">
                    Fim da temporada!
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'training' && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
              <div className="p-4 border-b border-zinc-800 flex justify-between items-center bg-zinc-950/50">
                <h3 className="font-bold text-lg flex items-center gap-2">
                  <Dumbbell size={20} className="text-zinc-400" />
                  Centro de Treinamento
                </h3>
                <div className="text-sm">
                  Custo por treino: <span className="text-amber-400 font-bold font-mono">R$ 0.05M</span>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-zinc-900 text-zinc-400 border-b border-zinc-800">
                    <tr>
                      <th className="p-4 font-medium w-12">Pos</th>
                      <th className="p-4 font-medium">Nome</th>
                      <th className="p-4 font-medium text-center">Força</th>
                      <th className="p-4 font-medium text-center">Progresso</th>
                      <th className="p-4 font-medium text-right">Ação</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/50">
                    {userPlayers.map(player => (
                      <tr key={player.id} className="hover:bg-zinc-800/50 transition-colors">
                        <td className="p-4">
                          <span className={`inline-flex items-center justify-center w-8 h-8 rounded-lg font-bold text-xs
                            ${player.position === 'G' ? 'bg-amber-500/20 text-amber-400' : ''}
                            ${player.position === 'D' ? 'bg-blue-500/20 text-blue-400' : ''}
                            ${player.position === 'M' ? 'bg-emerald-500/20 text-emerald-400' : ''}
                            ${player.position === 'A' ? 'bg-red-500/20 text-red-400' : ''}
                          `}>
                            {player.position}
                          </span>
                        </td>
                        <td className="p-4 font-medium">{player.name}</td>
                        <td className="p-4 text-center">
                          <span className="font-mono bg-zinc-950 px-2 py-1 rounded text-zinc-300 border border-zinc-800">{player.strength}</span>
                        </td>
                        <td className="p-4 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <span className="text-xs text-zinc-400 w-8">{player.trainingProgress}%</span>
                            <div className="w-24 bg-zinc-800 rounded-full h-2">
                              <div className="h-2 rounded-full bg-emerald-500 transition-all" style={{ width: `${player.trainingProgress}%` }}></div>
                            </div>
                          </div>
                        </td>
                        <td className="p-4 text-right">
                          <button 
                            onClick={() => trainPlayer(player.id)}
                            disabled={userTeam.money < 50000 || player.strength >= 99}
                            className="bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed border border-zinc-700 text-xs font-bold py-1 px-3 rounded-lg transition-colors"
                          >
                            Treinar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </div>
      </main>
    </div>
  );
}

