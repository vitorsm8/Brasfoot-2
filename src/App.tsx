import React, { useState, useMemo, useReducer, useEffect, useCallback } from 'react';
import { generateInitialState } from './data';
import {
  GameState, Player, Match, Formation, MatchReport, CupRound,
  ATTR_LABELS, ATTR_GROUPS, PRIMARY_ATTRS,
  FORMATION_LABELS, FORMATION_MODIFIERS,
  StaffRole, STAFF_INFO,
  Specialization, SPEC_INFO,
  TRANSFER_WINDOW_ROUNDS, TOTAL_SEASON_ROUNDS,
  ACADEMY_INFO, CUP_ROUND_LABELS,
} from './types';
import { getBestLineup } from './engine';
import { gameReducer } from './gameReducer';
import {
  Trophy, Users, Calendar, Play, Dumbbell,
  User, DollarSign, Home, ShoppingCart, Shield,
  ChevronRight, Zap, Heart, ChevronDown, ChevronUp,
  Bandage, Briefcase, Star, GraduationCap, TrendingUp,
  TrendingDown, Lock, Unlock, Smile, Frown, Target,
  History, Award, BarChart2, FileText, ArrowUpDown,
  CheckCircle2, XCircle, Clock, Swords,
} from 'lucide-react';
import LiveMatchDay from './LiveMatchDay';

// ─── Helpers UI ───────────────────────────────────────────────────────────────

const posColor: Record<string, string> = {
  G: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  D: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  M: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  A: 'bg-red-500/20 text-red-400 border-red-500/30',
};

function MiniBar({ value, color }: { value: number; color: string }) {
  return (
    <div className="w-12 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} />
    </div>
  );
}

function AttrBar({ label, value, isPrimary }: { label: string; value: number; isPrimary?: boolean }) {
  const color = value >= 75 ? 'bg-emerald-500' : value >= 55 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <span className={`text-[10px] w-20 flex-shrink-0 truncate ${isPrimary ? 'text-zinc-300 font-semibold' : 'text-zinc-500'}`}>{label}</span>
      <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} />
      </div>
      <span className={`font-mono text-[10px] w-6 text-right flex-shrink-0 ${isPrimary ? 'text-zinc-300 font-bold' : 'text-zinc-500'}`}>{value}</span>
    </div>
  );
}

function FormBadge({ streak }: { streak: number }) {
  if (streak === 0) return null;
  const color = streak > 0 ? 'text-emerald-400' : 'text-red-400';
  const arrow = streak > 0 ? '↑' : '↓';
  return <span className={`text-[10px] font-bold ${color}`}>{arrow}{Math.abs(streak)}</span>;
}

function RepBadge({ rep }: { rep: number }) {
  const color = rep >= 70 ? 'text-amber-400' : rep >= 45 ? 'text-zinc-400' : 'text-zinc-600';
  return (
    <span className={`flex items-center gap-0.5 text-[10px] font-bold ${color}`}>
      <Star size={9} />{rep}
    </span>
  );
}

type Tab = 'squad' | 'standings' | 'fixtures' | 'training' | 'finances' | 'stadium' | 'manager' | 'market' | 'staff' | 'academy' | 'copa' | 'objetivos' | 'historico';

const NAV: { key: Tab; icon: React.ReactNode; label: string }[] = [
  { key: 'squad',     icon: <Users size={20} />,        label: 'Elenco'    },
  { key: 'standings', icon: <Trophy size={20} />,       label: 'Tabela'    },
  { key: 'copa',      icon: <Swords size={20} />,       label: 'Copa'      },
  { key: 'objetivos', icon: <Target size={20} />,       label: 'Objetivos' },
  { key: 'fixtures',  icon: <Calendar size={20} />,     label: 'Rodada'    },
  { key: 'training',  icon: <Dumbbell size={20} />,     label: 'Treino'    },
  { key: 'finances',  icon: <DollarSign size={20} />,   label: 'Finanças'  },
  { key: 'stadium',   icon: <Home size={20} />,         label: 'Estádio'   },
  { key: 'staff',     icon: <Briefcase size={20} />,    label: 'Staff'     },
  { key: 'academy',   icon: <GraduationCap size={20} />,label: 'Academia'  },
  { key: 'manager',   icon: <User size={20} />,         label: 'Técnico'   },
  { key: 'market',    icon: <ShoppingCart size={20} />, label: 'Mercado'   },
  { key: 'historico', icon: <History size={20} />,      label: 'Histórico' },
];

const STORAGE_KEY = 'brasmanager_save_v7';

// ─── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [gameState, dispatch] = useReducer(gameReducer, null, () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw) as GameState;
    } catch {}
    return null;
  });

  const [activeTab, setActiveTab]                     = useState<Tab>('squad');
  const [matchResult, setMatchResult]                 = useState<Match | null>(null);
  const [isLiveMatchMode, setIsLiveMatchMode]         = useState(false);
  const [isCupMatchMode, setIsCupMatchMode]           = useState(false);
  const [negotiatingPlayer, setNegotiatingPlayer]     = useState<Player | null>(null);
  const [offerAmount, setOfferAmount]                 = useState<number>(0);
  const [negotiationMessage, setNegotiationMessage]   = useState<string>('');
  const [expandedPlayerId, setExpandedPlayerId]       = useState<string | null>(null);
  const [showOffseasonModal, setShowOffseasonModal]   = useState(false);
  const [showMatchReport, setShowMatchReport]         = useState(false);
  const [lastSeenReport, setLastSeenReport]           = useState<MatchReport | null>(null);

  // Contract negotiation state
  const [contractPlayer, setContractPlayer]           = useState<Player | null>(null);
  const [contractSalary, setContractSalary]           = useState<number>(0);
  const [contractYears, setContractYears]             = useState<number>(2);
  const [contractMsg, setContractMsg]                 = useState<string>('');

  const tempState = useMemo(() => generateInitialState(), []);

  // Persistência
  useEffect(() => {
    if (gameState) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(gameState)); } catch {} }
    else { try { localStorage.removeItem(STORAGE_KEY); } catch {} }
  }, [gameState]);

  // Abre modal fim de temporada
  useEffect(() => {
    if (gameState?.phase === 'offseason') setShowOffseasonModal(true);
  }, [gameState?.phase]);

  // Mostra relatório pós-jogo quando muda
  useEffect(() => {
    if (gameState?.lastMatchReport && gameState.lastMatchReport !== lastSeenReport) {
      setLastSeenReport(gameState.lastMatchReport);
      setShowMatchReport(true);
    }
  }, [gameState?.lastMatchReport]);

  // Derivações
  const userTeam   = gameState?.teams.find(t => t.id === gameState.userTeamId) ?? null;
  const userPlayers = useMemo(() => {
    if (!gameState || !userTeam) return [];
    const o: Record<string, number> = { G: 1, D: 2, M: 3, A: 4 };
    return [...gameState.players].filter(p => p.teamId === userTeam.id)
      .sort((a, b) => o[a.position] !== o[b.position] ? o[a.position] - o[b.position] : b.strength - a.strength);
  }, [gameState?.players, userTeam?.id]);

  const currentRoundMatches = useMemo(() =>
    gameState ? gameState.matches.filter(m => m.round === gameState.currentRound) : [],
    [gameState?.matches, gameState?.currentRound]);

  const userMatch = userTeam
    ? currentRoundMatches.find(m => m.homeTeamId === userTeam.id || m.awayTeamId === userTeam.id)
    : undefined;

  const standings = useMemo(() => {
    if (!gameState) return [];
    const table = gameState.teams.map(t => ({ ...t, pts: 0, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0 }));
    gameState.matches.filter(m => m.played).forEach(m => {
      const h = table.find(t => t.id === m.homeTeamId)!, a = table.find(t => t.id === m.awayTeamId)!;
      h.p++; a.p++; h.gf += m.homeScore; h.ga += m.awayScore; a.gf += m.awayScore; a.ga += m.homeScore;
      if (m.homeScore > m.awayScore) { h.pts += 3; h.w++; a.l++; }
      else if (m.homeScore < m.awayScore) { a.pts += 3; a.w++; h.l++; }
      else { h.pts++; a.pts++; h.d++; a.d++; }
    });
    table.forEach(t => (t.gd = t.gf - t.ga));
    return table.sort((a, b) => b.pts - a.pts || b.w - a.w || b.gd - a.gd || b.gf - a.gf);
  }, [gameState?.matches, gameState?.teams]);

  const transferWindowOpen = gameState ? TRANSFER_WINDOW_ROUNDS.has(gameState.currentRound) : false;

  // Copa: achar a partida do usuário no round atual da copa
  const userCupMatch = useMemo(() => {
    if (!gameState?.cup || !userTeam) return null;
    return gameState.cup.matches.find(m =>
      m.round === gameState.cup!.currentRound &&
      !m.played &&
      (m.homeTeamId === userTeam.id || m.awayTeamId === userTeam.id)
    ) ?? null;
  }, [gameState?.cup, userTeam?.id]);

  const hasPendingCup = !!userCupMatch && gameState?.pendingCupRound !== null;

  // Handlers
  const startGame = (teamId: string) => {
    const formation: Formation = '4-4-2';
    const teamPlayers = tempState.players.filter(p => p.teamId === teamId);
    const bestLineup = getBestLineup(teamPlayers, formation).map(p => p.id);
    dispatch({
      type: 'INIT_GAME',
      payload: {
        ...tempState, currentRound: 1, userTeamId: teamId,
        userLineup: bestLineup, formation, staff: {},
        season: 1, phase: 'season', lastSeasonSummary: null,
      } as GameState,
    });
  };

  const handleMatchDayComplete = useCallback((updatedMatches: Match[], playerUpdates: Partial<Player>[], report: MatchReport) => {
    const userUpdated = updatedMatches.find(m => m.homeTeamId === userTeam!.id || m.awayTeamId === userTeam!.id)!;
    dispatch({ type: 'MATCH_DAY_COMPLETE', payload: { updatedMatches, playerUpdates, report } });
    setMatchResult(userUpdated);
    setIsLiveMatchMode(false);
  }, [userTeam?.id]);

  const handleCupMatchComplete = useCallback((_updatedMatches: Match[], playerUpdates: Partial<Player>[], report: MatchReport) => {
    if (!gameState?.cup || !userCupMatch) return;
    const isHome = userCupMatch.homeTeamId === userTeam!.id;
    const homeScore = isHome ? _updatedMatches[0]?.homeScore ?? 0 : _updatedMatches[0]?.awayScore ?? 0;
    const awayScore = isHome ? _updatedMatches[0]?.awayScore ?? 0 : _updatedMatches[0]?.homeScore ?? 0;
    // Actually the report has the right scores directly
    dispatch({
      type: 'CUP_MATCH_COMPLETE',
      payload: { cupMatchId: userCupMatch.id, homeScore: report.homeScore, awayScore: report.awayScore, playerUpdates },
    });
    setIsCupMatchMode(false);
    setActiveTab('copa');
  }, [gameState?.cup, userCupMatch, userTeam?.id]);

  const submitOffer = () => {
    if (!negotiatingPlayer || !gameState) return;
    if (!transferWindowOpen) { setNegotiationMessage('Janela de transferências fechada.'); return; }
    const t = gameState.teams.find(t => t.id === gameState.userTeamId)!;
    if (t.money < offerAmount) { setNegotiationMessage('Saldo insuficiente.'); return; }
    if (offerAmount >= negotiatingPlayer.value * (0.9 + Math.random() * 0.15)) {
      dispatch({ type: 'BUY_PLAYER', payload: { playerId: negotiatingPlayer.id, amount: offerAmount } });
      setNegotiatingPlayer(null);
    } else {
      setNegotiationMessage('Oferta recusada. Tente um valor maior.');
    }
  };

  const submitContract = () => {
    if (!contractPlayer || !gameState) return;
    dispatch({ type: 'NEGOTIATE_CONTRACT', payload: { playerId: contractPlayer.id, newSalary: contractSalary, years: contractYears } });
    setContractMsg('✓ Contrato renovado!');
    setTimeout(() => { setContractPlayer(null); setContractMsg(''); }, 1500);
  };

  // ── Tela inicial ─────────────────────────────────────────────────────────────

  if (!gameState) return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans">
      <div className="max-w-4xl mx-auto px-4 py-12">
        <div className="text-center mb-12">
          <h1 className="text-5xl sm:text-7xl font-black tracking-tighter text-emerald-400 mb-3">BRASMANAGER</h1>
          <p className="text-zinc-500">Escolha seu time e leve-o ao título.</p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
          {[1, 2, 3].map(league => (
            <div key={league} className="col-span-full">
              <div className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2">
                {league === 1 ? 'Série A' : league === 2 ? 'Série B' : 'Série C'}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {tempState.teams.filter(t => t.league === league).map(team => (
                  <button key={team.id} onClick={() => startGame(team.id)}
                    className="bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-600 rounded-2xl p-4 transition-all flex flex-col items-center gap-2 group active:scale-95">
                    <div className="w-12 h-12 rounded-full flex items-center justify-center text-xl font-black shadow-lg group-hover:scale-110 transition-transform"
                      style={{ backgroundColor: team.color, color: '#fff' }}>{team.name.charAt(0)}</div>
                    <span className="font-bold text-xs text-center leading-tight">{team.name}</span>
                    <span className="text-[10px] text-zinc-600"><Star size={8} className="inline" /> {team.reputation}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  // ── Live Match ────────────────────────────────────────────────────────────────

  if (isLiveMatchMode && userTeam) return (
    <LiveMatchDay gameState={gameState} matches={currentRoundMatches}
      userLineup={gameState.userLineup} onComplete={handleMatchDayComplete} />
  );

  if (isCupMatchMode && userTeam && userCupMatch) {
    const cupMatchAsList: Match[] = [{
      id: userCupMatch.id,
      homeTeamId: userCupMatch.homeTeamId,
      awayTeamId: userCupMatch.awayTeamId,
      homeScore: 0, awayScore: 0, played: false, round: gameState.currentRound,
    }];
    const opponentId = userCupMatch.homeTeamId === userTeam.id ? userCupMatch.awayTeamId : userCupMatch.homeTeamId;
    return (
      <LiveMatchDay gameState={gameState} matches={cupMatchAsList}
        userLineup={gameState.userLineup} onComplete={handleCupMatchComplete} isCupMatch />
    );
  }

  const team = userTeam!;

  // ── Render principal ──────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans flex flex-col">

      {/* Header */}
      <header className="bg-zinc-900 border-b border-zinc-800 sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center font-black text-sm"
              style={{ backgroundColor: team.color, color: '#fff' }}>{team.name.charAt(0)}</div>
            <div className="min-w-0">
              <div className="font-bold leading-tight truncate">{team.name}</div>
              <div className="text-xs text-zinc-500 flex items-center gap-2 flex-wrap">
                <span>T{gameState.season} R{gameState.currentRound}/{TOTAL_SEASON_ROUNDS}</span>
                <span>·</span>
                <span className="text-emerald-400 font-mono">R${(team.money / 1_000_000).toFixed(1)}M</span>
                <span>·</span>
                <span className={`flex items-center gap-0.5 ${team.fanSatisfaction >= 70 ? 'text-emerald-400' : team.fanSatisfaction >= 40 ? 'text-amber-400' : 'text-red-400'}`}>
                  {team.fanSatisfaction >= 60 ? <Smile size={11} /> : <Frown size={11} />}
                  {team.fanSatisfaction}%
                </span>
                <span>·</span>
                <RepBadge rep={team.reputation} />
                <span>·</span>
                <span className={`flex items-center gap-0.5 text-[10px] font-bold ${transferWindowOpen ? 'text-emerald-400' : 'text-zinc-600'}`}>
                  {transferWindowOpen ? <Unlock size={10} /> : <Lock size={10} />}
                  {transferWindowOpen ? 'Janela' : 'Fechada'}
                </span>
                {hasPendingCup && (
                  <span className="flex items-center gap-0.5 text-[10px] font-bold text-amber-400">
                    <Trophy size={10} />Copa pendente
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => { if (confirm('Apagar jogo salvo?')) dispatch({ type: 'NEW_GAME' }); }}
              className="hidden sm:block text-xs text-zinc-600 hover:text-zinc-400 px-2">Novo jogo</button>
            {hasPendingCup ? (
              <button onClick={() => setIsCupMatchMode(true)}
                disabled={gameState.userLineup.length !== 11}
                className="flex-shrink-0 bg-amber-500 hover:bg-amber-400 active:bg-amber-600 disabled:bg-zinc-800 disabled:text-zinc-600 text-zinc-950 font-bold py-2 px-4 sm:px-6 rounded-full flex items-center gap-2 transition-colors text-sm">
                <Trophy size={16} />
                <span className="hidden sm:inline">Jogar Copa</span>
                <span className="sm:hidden">Copa</span>
              </button>
            ) : (
              <button onClick={() => setIsLiveMatchMode(true)}
                disabled={gameState.userLineup.length !== 11 || matchResult !== null || !userMatch || gameState.phase === 'offseason'}
                className="flex-shrink-0 bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 disabled:bg-zinc-800 disabled:text-zinc-600 text-zinc-950 font-bold py-2 px-4 sm:px-6 rounded-full flex items-center gap-2 transition-colors text-sm">
                <Play size={16} />
                <span className="hidden sm:inline">
                  {gameState.phase === 'offseason' ? 'Fim de Temporada' : gameState.userLineup.length !== 11 ? `Escale (${gameState.userLineup.length}/11)` : 'Jogar'}
                </span>
                <span className="sm:hidden">{gameState.userLineup.length !== 11 ? `${gameState.userLineup.length}/11` : 'Jogar'}</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Resultado */}
      {matchResult && (
        <div className="bg-zinc-900 border-b border-zinc-800 px-4 py-4">
          <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center gap-4">
            <div className="flex items-center gap-4 flex-1 justify-center">
              <span className="font-bold text-sm">{gameState.teams.find(t => t.id === matchResult.homeTeamId)?.name}</span>
              <div className="text-3xl font-black font-mono bg-zinc-950 px-4 py-1.5 rounded-xl border border-zinc-700">
                {matchResult.homeScore} - {matchResult.awayScore}
              </div>
              <span className="font-bold text-sm">{gameState.teams.find(t => t.id === matchResult.awayTeamId)?.name}</span>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowMatchReport(true)}
                className="bg-zinc-800 text-zinc-300 hover:bg-zinc-700 font-bold py-1.5 px-4 rounded-full text-sm flex items-center gap-1.5">
                <FileText size={14} />Relatório
              </button>
              <button onClick={() => setMatchResult(null)}
                className="bg-zinc-100 text-zinc-900 hover:bg-white font-bold py-1.5 px-6 rounded-full text-sm">
                Continuar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Alerta offseason */}
      {gameState.phase === 'offseason' && !showOffseasonModal && (
        <div className="bg-amber-500/10 border-b border-amber-500/30 px-4 py-3">
          <div className="max-w-6xl mx-auto flex items-center justify-between gap-3">
            <span className="text-amber-400 text-sm font-bold">🏆 Temporada {gameState.season - 1} encerrada!</span>
            <button onClick={() => setShowOffseasonModal(true)}
              className="text-xs bg-amber-500 text-zinc-950 font-bold px-4 py-1.5 rounded-full">Ver Resumo</button>
          </div>
        </div>
      )}

      <div className="flex flex-1 max-w-6xl mx-auto w-full">

        {/* Sidebar desktop */}
        <nav className="hidden lg:flex flex-col gap-1 w-52 flex-shrink-0 p-4 border-r border-zinc-800">
          {NAV.map(({ key, icon, label }) => (
            <button key={key} onClick={() => setActiveTab(key)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors text-sm relative
                ${activeTab === key ? 'bg-zinc-800 text-white font-semibold' : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'}`}>
              {icon}{label}
              {key === 'copa' && hasPendingCup && <span className="ml-auto w-2 h-2 bg-amber-400 rounded-full" />}
              {key === 'objetivos' && gameState.objectives.some(o => o.achieved === null) && (
                <span className="ml-auto text-[9px] bg-zinc-700 text-zinc-300 rounded-full px-1.5 py-0.5">
                  {gameState.objectives.filter(o => o.achieved === null).length}
                </span>
              )}
            </button>
          ))}
          <div className="mt-auto pt-4 border-t border-zinc-800">
            <button onClick={() => { if (confirm('Apagar jogo salvo?')) dispatch({ type: 'NEW_GAME' }); }}
              className="w-full text-xs text-zinc-600 hover:text-zinc-400 py-1">Novo jogo</button>
          </div>
        </nav>

        <main className="flex-1 min-w-0 p-3 sm:p-5 pb-24 lg:pb-5">

          {/* ── SQUAD ── */}
          {activeTab === 'squad' && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold text-lg flex items-center gap-2"><Shield size={18} className="text-zinc-400" /> Elenco</h2>
                <span className={`text-sm font-bold px-3 py-1 rounded-full ${gameState.userLineup.length === 11 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`}>
                  {gameState.userLineup.length}/11 escalados
                </span>
              </div>

              {/* Formação */}
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 mb-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Formação Tática</span>
                  <button onClick={() => dispatch({ type: 'SET_FORMATION', payload: gameState.formation })}
                    className="text-xs text-emerald-400 hover:text-emerald-300">Auto-escalar</button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {(Object.keys(FORMATION_LABELS) as Formation[]).map(f => {
                    const mod = FORMATION_MODIFIERS[f], active = gameState.formation === f;
                    return (
                      <button key={f} onClick={() => dispatch({ type: 'SET_FORMATION', payload: f })}
                        className={`rounded-xl p-3 border transition-all text-left ${active ? 'border-emerald-500/50 bg-emerald-500/10 ring-1 ring-emerald-500/20' : 'border-zinc-800 bg-zinc-800/30 hover:border-zinc-600'}`}>
                        <div className={`font-bold text-sm mb-1 ${active ? 'text-emerald-400' : 'text-zinc-200'}`}>{f}</div>
                        <div className="text-[10px] text-zinc-500 leading-tight">{FORMATION_LABELS[f].replace(f + ' ', '')}</div>
                        <div className="flex gap-2 mt-2">
                          <span className={`text-[10px] font-mono ${mod.attack >= 1.05 ? 'text-red-400' : mod.attack < 1 ? 'text-zinc-600' : 'text-zinc-500'}`}>ATK {mod.attack >= 1 ? '+' : ''}{((mod.attack - 1) * 100).toFixed(0)}%</span>
                          <span className={`text-[10px] font-mono ${mod.defense >= 1.05 ? 'text-blue-400' : mod.defense < 1 ? 'text-zinc-600' : 'text-zinc-500'}`}>DEF {mod.defense >= 1 ? '+' : ''}{((mod.defense - 1) * 100).toFixed(0)}%</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Cards jogadores */}
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
                {userPlayers.map(player => {
                  const sel = gameState.userLineup.includes(player.id);
                  const susp = player.redCard, injured = player.injuryWeeksLeft > 0;
                  const expanded = expandedPlayerId === player.id;
                  const primaries = PRIMARY_ATTRS[player.position];
                  const olheiroLevel = gameState.staff.olheiro ?? 0;
                  const showPotential = (olheiroLevel === 1 && userPlayers.indexOf(player) < 6) || (olheiroLevel === 2 && userPlayers.indexOf(player) < 12) || olheiroLevel === 3;
                  const contractExpiring = player.contractYears <= 1;
                  return (
                    <div key={player.id} className={`rounded-xl border transition-all ${susp || injured ? 'opacity-60 border-zinc-800 bg-zinc-900/50' : sel ? 'border-emerald-500/50 bg-emerald-500/5 ring-1 ring-emerald-500/30' : 'border-zinc-800 bg-zinc-900 hover:border-zinc-700'}`}>
                      <div onClick={() => !susp && !injured && dispatch({ type: 'TOGGLE_LINEUP_PLAYER', payload: { playerId: player.id } })}
                        className={`p-3 ${!susp && !injured ? 'cursor-pointer' : 'cursor-not-allowed'}`}>
                        <div className="flex items-start gap-3 pr-6 relative">
                          <div className={`absolute top-0 right-0 w-5 h-5 rounded-full border-2 flex items-center justify-center ${sel ? 'bg-emerald-500 border-emerald-500' : 'border-zinc-600'}`}>
                            {sel && <div className="w-2 h-2 bg-zinc-950 rounded-full" />}
                          </div>
                          <span className={`inline-flex items-center justify-center w-9 h-9 rounded-lg font-bold text-xs border flex-shrink-0 ${posColor[player.position]}`}>{player.position}</span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="font-semibold text-sm truncate">{player.name}</span>
                              {player.isYouth && <span className="text-[9px] text-emerald-400 font-bold bg-emerald-500/10 px-1 rounded">BASE</span>}
                              <FormBadge streak={player.formStreak} />
                            </div>
                            <div className="text-xs text-zinc-500">
                              {player.age}a · <span className="font-mono font-bold text-zinc-300">{player.strength}</span> ovr
                              {showPotential && <span className="text-amber-400 ml-1">/ {player.potential}</span>}
                              {contractExpiring && <span className="text-orange-400 ml-1.5">· {player.contractYears}a contrato</span>}
                            </div>
                            {susp && <span className="text-xs text-red-500 font-bold">Suspenso</span>}
                            {injured && <span className="text-xs text-orange-500 font-bold flex items-center gap-1"><Bandage size={10} />{player.injuryWeeksLeft}r lesionado</span>}
                          </div>
                        </div>
                        <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1">
                          <div className="flex items-center gap-1.5"><Zap size={9} className="text-zinc-500" /><MiniBar value={player.energy} color={player.energy > 60 ? 'bg-emerald-500' : player.energy > 30 ? 'bg-amber-500' : 'bg-red-500'} /><span className="text-[10px] font-mono text-zinc-500">{player.energy}%</span></div>
                          <div className="flex items-center gap-1.5"><Heart size={9} className="text-zinc-500" /><MiniBar value={player.morale} color={player.morale > 60 ? 'bg-blue-500' : player.morale > 30 ? 'bg-amber-500' : 'bg-red-500'} /><span className="text-[10px] font-mono text-zinc-500">{player.morale}%</span></div>
                          <div className="flex gap-3 text-xs text-zinc-600 col-span-2">
                            <span><span className="text-zinc-300 font-bold">{player.goals}</span> G</span>
                            <span><span className="text-zinc-300 font-bold">{player.assists}</span> A</span>
                            <span><span className="text-zinc-300 font-bold">{player.matchesPlayed}</span> J</span>
                            {player.yellowCards > 0 && !player.redCard && <span className="inline-flex gap-0.5">{Array.from({ length: player.yellowCards }).map((_, i) => <span key={i} className="inline-block w-2 h-3 bg-amber-400 rounded-sm" />)}</span>}
                          </div>
                        </div>
                      </div>
                      <div className="border-t border-zinc-800/60">
                        <button onClick={() => setExpandedPlayerId(expanded ? null : player.id)}
                          className="w-full flex items-center justify-between px-3 py-1.5 text-[10px] text-zinc-500 hover:text-zinc-300">
                          <span className="flex items-center gap-2">
                            {primaries.slice(0, 3).map(k => (
                              <span key={k} className="font-mono">
                                <span className="text-zinc-600">{ATTR_LABELS[k].slice(0, 3).toUpperCase()}</span>{' '}
                                <span className={player.attributes[k] >= 75 ? 'text-emerald-400 font-bold' : player.attributes[k] >= 55 ? 'text-amber-400' : 'text-red-400'}>{player.attributes[k]}</span>
                              </span>
                            ))}
                          </span>
                          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                        </button>
                        {expanded && (
                          <div className="px-3 pb-3 space-y-3">
                            {ATTR_GROUPS.map(group => (
                              <div key={group.label}>
                                <div className="text-[9px] font-bold text-zinc-600 uppercase tracking-widest mb-1">{group.label}</div>
                                <div className="space-y-0.5">{group.keys.map(k => <AttrBar key={k} label={ATTR_LABELS[k]} value={player.attributes[k]} isPrimary={primaries.includes(k)} />)}</div>
                              </div>
                            ))}
                            <div className="text-[9px] text-zinc-700 font-mono pt-1 border-t border-zinc-800">POT {player.potential} · {player.age}a</div>
                          </div>
                        )}
                      </div>
                      <div className="border-t border-zinc-800/60 px-3 py-2 flex items-center justify-between gap-2">
                        <span className={`text-[10px] font-mono ${contractExpiring ? 'text-orange-400' : 'text-zinc-600'}`}>
                          R${(player.salary / 1000).toFixed(0)}k/mês · {player.contractYears}a
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button onClick={e => {
                            e.stopPropagation();
                            setContractPlayer(player);
                            setContractSalary(player.salary);
                            setContractYears(player.contractYears);
                            setContractMsg('');
                          }} className="text-xs font-bold py-0.5 px-2 rounded-lg border bg-zinc-800 text-zinc-400 border-zinc-700 hover:text-zinc-200">
                            Renovar
                          </button>
                          <button onClick={e => { e.stopPropagation(); dispatch({ type: 'TOGGLE_LIST_PLAYER', payload: { playerId: player.id } }); }}
                            className={`text-xs font-bold py-0.5 px-2.5 rounded-lg border transition-colors ${player.listedForSale ? 'bg-amber-500/20 text-amber-400 border-amber-500/30' : 'bg-zinc-800 text-zinc-500 border-zinc-700 hover:text-zinc-300'}`}>
                            {player.listedForSale ? 'À Venda' : 'Vender'}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── STANDINGS ── */}
          {activeTab === 'standings' && (
            <div>
              <h2 className="font-bold text-lg flex items-center gap-2 mb-4"><Trophy size={18} className="text-zinc-400" /> Classificação · Temporada {gameState.season}</h2>
              {[1, 2, 3].map(league => {
                const ls = standings.filter(t => t.league === league);
                return (
                  <div key={league} className="mb-6">
                    <div className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2">
                      {league === 1 ? 'Série A' : league === 2 ? 'Série B' : 'Série C'}
                    </div>
                    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
                      <div className="grid grid-cols-[auto_1fr_auto_auto_auto_auto_auto_auto] gap-x-2 px-4 py-2 border-b border-zinc-800 text-xs text-zinc-500 font-medium uppercase tracking-wider">
                        <span className="w-6 text-center">#</span><span>Time</span>
                        <span className="w-8 text-center">Pts</span><span className="w-6 text-center">J</span>
                        <span className="w-6 text-center hidden sm:block">V</span><span className="w-6 text-center hidden sm:block">E</span>
                        <span className="w-6 text-center">D</span><span className="w-8 text-center">SG</span>
                      </div>
                      {ls.map((t, i) => (
                        <div key={t.id} className={`grid grid-cols-[auto_1fr_auto_auto_auto_auto_auto_auto] gap-x-2 items-center px-4 py-3 border-b border-zinc-800/50 last:border-0 ${t.id === team.id ? 'bg-zinc-800/40' : 'hover:bg-zinc-800/20'}`}>
                          <span className="w-6 text-center text-zinc-500 text-sm font-mono">{i + 1}</span>
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="w-5 h-5 rounded-full flex-shrink-0" style={{ backgroundColor: t.color }} />
                            <span className={`text-sm font-medium truncate ${t.id === team.id ? 'text-emerald-400' : ''}`}>{t.name}</span>
                            <RepBadge rep={t.reputation} />
                          </div>
                          <span className="w-8 text-center font-bold text-sm">{t.pts}</span>
                          <span className="w-6 text-center text-zinc-400 text-sm">{t.p}</span>
                          <span className="w-6 text-center text-zinc-400 text-sm hidden sm:block">{t.w}</span>
                          <span className="w-6 text-center text-zinc-400 text-sm hidden sm:block">{t.d}</span>
                          <span className="w-6 text-center text-zinc-400 text-sm">{t.l}</span>
                          <span className="w-8 text-center text-zinc-400 text-sm">{t.gd > 0 ? `+${t.gd}` : t.gd}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── COPA ── */}
          {activeTab === 'copa' && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold text-lg flex items-center gap-2"><Swords size={18} className="text-amber-400" /> Copa · {gameState.cup ? `Temporada ${gameState.cup.season}` : '—'}</h2>
                {gameState.cup && (
                  <span className="text-xs font-bold px-3 py-1 rounded-full bg-amber-500/20 text-amber-400">
                    {CUP_ROUND_LABELS[gameState.cup.currentRound]}
                  </span>
                )}
              </div>

              {!gameState.cup ? (
                <div className="text-center py-12 text-zinc-500">Copa não iniciada.</div>
              ) : (
                <>
                  {/* Progresso do usuário */}
                  <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 mb-6">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Meu Progresso</span>
                      <span className={`font-bold text-sm ${gameState.cup.winnerId === team.id ? 'text-amber-400' : gameState.cup.currentRound === 'done' ? 'text-zinc-500' : 'text-emerald-400'}`}>
                        {gameState.cup.winnerId === team.id ? '🏆 Campeão!' : gameState.cup.userCupResult}
                      </span>
                    </div>
                    {/* Rounds progress */}
                    <div className="flex items-center gap-1">
                      {(['r16', 'qf', 'sf', 'final'] as CupRound[]).map((r, i) => {
                        const roundOrder: CupRound[] = ['r16', 'qf', 'sf', 'final', 'done'];
                        const currentIdx = roundOrder.indexOf(gameState.cup!.currentRound);
                        const rIdx = roundOrder.indexOf(r);
                        const done = rIdx < currentIdx;
                        const current = r === gameState.cup!.currentRound;
                        const userActive = done || current;
                        const eliminated = gameState.cup!.userCupResult && !['Campeão', 'Vice'].includes(gameState.cup!.userCupResult) &&
                          gameState.cup!.userCupResult === CUP_ROUND_LABELS[r];
                        return (
                          <React.Fragment key={r}>
                            {i > 0 && <div className={`flex-1 h-0.5 ${done ? 'bg-emerald-600' : 'bg-zinc-800'}`} />}
                            <div className={`flex flex-col items-center ${userActive && !eliminated ? '' : 'opacity-40'}`}>
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2
                                ${gameState.cup!.winnerId === team.id && r === 'final' ? 'bg-amber-500 border-amber-400 text-zinc-950' :
                                  done ? 'bg-emerald-600 border-emerald-500 text-white' :
                                    current ? 'bg-zinc-800 border-emerald-500 text-emerald-400' :
                                      'bg-zinc-900 border-zinc-700 text-zinc-600'}`}>
                                {done || (gameState.cup!.winnerId === team.id && r === 'final') ? '✓' : i + 1}
                              </div>
                              <span className="text-[9px] text-zinc-500 mt-1">{CUP_ROUND_LABELS[r]}</span>
                            </div>
                          </React.Fragment>
                        );
                      })}
                    </div>

                    {/* Botão jogar copa se há partida pendente */}
                    {hasPendingCup && gameState.userLineup.length === 11 && (
                      <button onClick={() => setIsCupMatchMode(true)}
                        className="mt-4 w-full bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold py-2.5 rounded-xl flex items-center justify-center gap-2">
                        <Play size={16} />Jogar {CUP_ROUND_LABELS[gameState.cup.currentRound]}
                      </button>
                    )}
                    {hasPendingCup && gameState.userLineup.length !== 11 && (
                      <p className="mt-3 text-xs text-center text-amber-400">Escale 11 jogadores para disputar a copa</p>
                    )}
                  </div>

                  {/* Partidas do round atual */}
                  {(['r16', 'qf', 'sf', 'final'] as CupRound[]).map(r => {
                    const roundMatches = gameState.cup!.matches.filter(m => m.round === r);
                    if (roundMatches.length === 0) return null;
                    return (
                      <div key={r} className="mb-6">
                        <div className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2">{CUP_ROUND_LABELS[r]}</div>
                        <div className="grid gap-2">
                          {roundMatches.map(m => {
                            const home = gameState.teams.find(t => t.id === m.homeTeamId);
                            const away = gameState.teams.find(t => t.id === m.awayTeamId);
                            const isUser = m.homeTeamId === team.id || m.awayTeamId === team.id;
                            return (
                              <div key={m.id} className={`flex items-center p-3 rounded-xl border ${isUser ? 'border-amber-500/40 bg-amber-500/5' : 'border-zinc-800 bg-zinc-900'}`}>
                                <div className="flex-1 flex items-center justify-end gap-2 min-w-0">
                                  {m.winnerId === m.homeTeamId && m.played && <Trophy size={10} className="text-amber-400 flex-shrink-0" />}
                                  <span className={`font-semibold text-sm truncate ${isUser && m.homeTeamId === team.id ? 'text-amber-400' : ''}`}>{home?.name ?? '?'}</span>
                                  <div className="w-5 h-5 rounded-full flex-shrink-0" style={{ backgroundColor: home?.color ?? '#666' }} />
                                </div>
                                <div className="mx-3 font-mono font-bold text-base px-3 py-1 bg-zinc-950 rounded-lg border border-zinc-800 min-w-[64px] text-center">
                                  {m.played ? `${m.homeScore}–${m.awayScore}` : 'vs'}
                                </div>
                                <div className="flex-1 flex items-center gap-2 min-w-0">
                                  <div className="w-5 h-5 rounded-full flex-shrink-0" style={{ backgroundColor: away?.color ?? '#666' }} />
                                  <span className={`font-semibold text-sm truncate ${isUser && m.awayTeamId === team.id ? 'text-amber-400' : ''}`}>{away?.name ?? '?'}</span>
                                  {m.winnerId === m.awayTeamId && m.played && <Trophy size={10} className="text-amber-400 flex-shrink-0" />}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          )}

          {/* ── OBJETIVOS ── */}
          {activeTab === 'objetivos' && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold text-lg flex items-center gap-2"><Target size={18} className="text-zinc-400" /> Objetivos · T{gameState.season}</h2>
                <span className="text-xs text-zinc-500">
                  {gameState.objectives.filter(o => o.achieved).length}/{gameState.objectives.length} cumpridos
                </span>
              </div>

              <div className="space-y-3 mb-6">
                {gameState.objectives.map(obj => (
                  <div key={obj.id} className={`rounded-2xl border p-4 transition-all ${obj.achieved === true ? 'border-emerald-500/40 bg-emerald-500/5' : obj.achieved === false ? 'border-red-500/20 bg-red-500/5 opacity-60' : 'border-zinc-800 bg-zinc-900'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 min-w-0">
                        {obj.achieved === true ? <CheckCircle2 size={18} className="text-emerald-400 flex-shrink-0 mt-0.5" /> :
                          obj.achieved === false ? <XCircle size={18} className="text-red-400 flex-shrink-0 mt-0.5" /> :
                            <Clock size={18} className="text-zinc-500 flex-shrink-0 mt-0.5" />}
                        <div>
                          <div className="font-semibold text-sm">{obj.description}</div>
                          <div className="text-xs text-zinc-500 mt-0.5">
                            {obj.achieved === null ? 'Em andamento' : obj.achieved ? 'Cumprido ✓' : 'Não cumprido'}
                          </div>
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="text-emerald-400 font-bold font-mono text-sm">R${(obj.rewardMoney / 1_000_000).toFixed(1)}M</div>
                        <div className="text-xs text-amber-400 flex items-center gap-0.5 justify-end">
                          <Star size={10} />+{obj.rewardRep} rep
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
                {gameState.objectives.length === 0 && (
                  <div className="text-center py-12 text-zinc-500 text-sm">Nenhum objetivo definido ainda.</div>
                )}
              </div>

              {/* Total bonuses preview */}
              {gameState.objectives.some(o => o.achieved === null) && (
                <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
                  <div className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-3">Se cumprir todos</div>
                  <div className="flex gap-6">
                    <div>
                      <div className="text-xs text-zinc-500">Bônus financeiro</div>
                      <div className="font-bold text-emerald-400 font-mono">R${(gameState.objectives.filter(o => o.achieved === null).reduce((s, o) => s + o.rewardMoney, 0) / 1_000_000).toFixed(1)}M</div>
                    </div>
                    <div>
                      <div className="text-xs text-zinc-500">Reputação</div>
                      <div className="font-bold text-amber-400 font-mono">+{gameState.objectives.filter(o => o.achieved === null).reduce((s, o) => s + o.rewardRep, 0)}</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── FIXTURES ── */}
          {activeTab === 'fixtures' && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold text-lg flex items-center gap-2"><Calendar size={18} className="text-zinc-400" /> Rodada {gameState.currentRound}</h2>
                <span className={`text-xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1 ${transferWindowOpen ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-800 text-zinc-500'}`}>
                  {transferWindowOpen ? <Unlock size={11} /> : <Lock size={11} />}{transferWindowOpen ? 'Janela aberta' : 'Janela fechada'}
                </span>
              </div>
              <div className="grid gap-2">
                {currentRoundMatches.length === 0
                  ? <div className="text-center text-zinc-500 py-12">Fim de temporada!</div>
                  : currentRoundMatches.map(m => {
                    const home = gameState.teams.find(t => t.id === m.homeTeamId)!, away = gameState.teams.find(t => t.id === m.awayTeamId)!;
                    const isUser = home.id === team.id || away.id === team.id;
                    return (
                      <div key={m.id} className={`flex items-center p-3 sm:p-4 rounded-xl border ${isUser ? 'border-zinc-600 bg-zinc-800/60' : 'border-zinc-800 bg-zinc-900'}`}>
                        <div className="flex-1 flex items-center justify-end gap-2 min-w-0">
                          <span className={`font-semibold text-sm truncate ${isUser && home.id === team.id ? 'text-emerald-400' : ''}`}>{home.name}</span>
                          <div className="w-5 h-5 rounded-full flex-shrink-0" style={{ backgroundColor: home.color }} />
                        </div>
                        <div className="mx-3 sm:mx-5 font-mono font-bold text-base sm:text-lg px-3 py-1 bg-zinc-950 rounded-lg border border-zinc-800 min-w-[64px] text-center">
                          {m.played ? `${m.homeScore}-${m.awayScore}` : 'vs'}
                        </div>
                        <div className="flex-1 flex items-center gap-2 min-w-0">
                          <div className="w-5 h-5 rounded-full flex-shrink-0" style={{ backgroundColor: away.color }} />
                          <span className={`font-semibold text-sm truncate ${isUser && away.id === team.id ? 'text-emerald-400' : ''}`}>{away.name}</span>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {/* ── TRAINING ── */}
          {activeTab === 'training' && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold text-lg flex items-center gap-2"><Dumbbell size={18} className="text-zinc-400" /> Treino</h2>
                <span className="text-xs text-zinc-500">R$50k/sessão{gameState.manager.specialization === 'desenvolvedor' && <span className="text-emerald-400 font-bold ml-1">· 2× Dev</span>}</span>
              </div>
              <div className="grid grid-cols-1 gap-3">
                {userPlayers.filter(p => p.injuryWeeksLeft === 0).map(p => {
                  const primaries = PRIMARY_ATTRS[p.position];
                  const weakestAttr = primaries.reduce((w, k) => p.attributes[k] < p.attributes[w] ? k : w, primaries[0]);
                  const atCap = p.attributes[weakestAttr] >= p.potential;
                  return (
                    <div key={p.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                      <div className="flex items-center gap-3 mb-3">
                        <span className={`inline-flex items-center justify-center w-9 h-9 rounded-lg font-bold text-xs border flex-shrink-0 ${posColor[p.position]}`}>{p.position}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5"><span className="font-semibold">{p.name}</span><span className="text-xs text-zinc-500">{p.age}a</span><FormBadge streak={p.formStreak} /></div>
                          <div className="text-xs text-zinc-500">Overall <span className="text-zinc-200 font-bold font-mono">{p.strength}</span> · Pot <span className="text-amber-400 font-bold font-mono">{p.potential}</span></div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <div className="text-right">
                            <div className="text-[10px] text-zinc-600 mb-0.5">Progresso</div>
                            <div className="flex items-center gap-1.5">
                              <div className="w-20 h-2 bg-zinc-800 rounded-full overflow-hidden"><div className="h-full bg-emerald-500 transition-all" style={{ width: `${p.trainingProgress}%` }} /></div>
                              <span className="text-xs font-mono text-zinc-400">{p.trainingProgress}%</span>
                            </div>
                          </div>
                          <button onClick={() => dispatch({ type: 'TRAIN_PLAYER', payload: { playerId: p.id } })}
                            disabled={team.money < 50_000 || p.strength >= 99 || atCap}
                            className="bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 border border-zinc-700 text-xs font-bold py-1.5 px-3 rounded-lg">Treinar</button>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-0.5">
                        {primaries.map(k => (
                          <div key={k} className="flex items-center gap-2">
                            <span className={`text-[10px] w-20 flex-shrink-0 ${k === weakestAttr ? 'text-amber-400 font-bold' : 'text-zinc-500'}`}>{ATTR_LABELS[k]}{k === weakestAttr && ' ▲'}</span>
                            <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden"><div className={`h-full rounded-full ${p.attributes[k] >= 75 ? 'bg-emerald-500' : p.attributes[k] >= 55 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${p.attributes[k]}%` }} /></div>
                            <span className="font-mono text-xs text-zinc-400 w-6 text-right">{p.attributes[k]}</span>
                          </div>
                        ))}
                      </div>
                      {atCap && <div className="mt-2 text-[10px] text-amber-600">Potencial máximo atingido.</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── FINANCES ── */}
          {activeTab === 'finances' && (
            <div>
              <h2 className="font-bold text-lg flex items-center gap-2 mb-4"><DollarSign size={18} className="text-emerald-400" /> Finanças</h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                {[
                  { label: 'Saldo', value: `R$${(team.money / 1_000_000).toFixed(2)}M`, color: 'text-emerald-400' },
                  { label: 'Folha Mensal', value: `R$${(userPlayers.reduce((s, p) => s + p.salary, 0) / 1_000_000).toFixed(2)}M`, color: 'text-red-400' },
                  { label: 'Patrocínio Anual', value: `R$${(team.sponsorshipIncome / 1_000_000).toFixed(2)}M`, color: 'text-blue-400' },
                ].map(({ label, value, color }) => (
                  <div key={label} className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
                    <div className="text-zinc-500 text-xs mb-1">{label}</div>
                    <div className={`text-xl font-bold font-mono ${color}`}>{value}</div>
                  </div>
                ))}
              </div>
              {/* Satisfação */}
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 mb-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold flex items-center gap-2">
                    {team.fanSatisfaction >= 60 ? <Smile size={14} className="text-emerald-400" /> : <Frown size={14} className="text-red-400" />}
                    Satisfação da Torcida
                  </span>
                  <span className={`font-bold font-mono ${team.fanSatisfaction >= 70 ? 'text-emerald-400' : team.fanSatisfaction >= 40 ? 'text-amber-400' : 'text-red-400'}`}>{team.fanSatisfaction}%</span>
                </div>
                <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${team.fanSatisfaction >= 70 ? 'bg-emerald-500' : team.fanSatisfaction >= 40 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${team.fanSatisfaction}%` }} />
                </div>
                <p className="text-xs text-zinc-600 mt-2">Afeta bilheteria. Vitórias +5, derrotas -4. Rebaixamento -25.</p>
              </div>
              {/* Reputação */}
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 mb-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-bold flex items-center gap-2"><Star size={14} className="text-amber-400" />Reputação do Clube</span>
                  <span className="font-bold font-mono text-amber-400">{team.reputation}/100</span>
                </div>
                <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-amber-600 to-amber-400 transition-all" style={{ width: `${team.reputation}%` }} />
                </div>
                <p className="text-xs text-zinc-600 mt-2">Multiplica receita de patrocínio. Afeta custo de transferências.</p>
              </div>
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-zinc-800 text-xs text-zinc-500 font-medium uppercase tracking-wider">Últimas transações</div>
                {team.finances.length === 0
                  ? <div className="p-6 text-center text-zinc-500 text-sm">Sem transações ainda.</div>
                  : team.finances.slice().reverse().slice(0, 30).map(r => (
                    <div key={r.id} className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/50 last:border-0 hover:bg-zinc-800/30">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-xs text-zinc-600 font-mono w-4 flex-shrink-0">R{r.round}</span>
                        <span className="text-sm truncate">{r.description}</span>
                      </div>
                      <span className={`text-sm font-mono font-bold flex-shrink-0 ml-3 ${r.type === 'income' ? 'text-emerald-400' : 'text-red-400'}`}>
                        {r.type === 'income' ? '+' : '-'}R${(r.amount / 1000).toFixed(0)}k
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* ── STADIUM ── */}
          {activeTab === 'stadium' && (
            <div>
              <h2 className="font-bold text-lg flex items-center gap-2 mb-4"><Home size={18} className="text-zinc-400" /> Estádio</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
                  <div className="flex items-center gap-3 mb-5">
                    <div className="w-12 h-12 bg-zinc-800 rounded-xl flex items-center justify-center"><Home size={22} className="text-zinc-400" /></div>
                    <div><div className="font-bold text-lg">Nível {team.stadium.level}</div><div className="text-zinc-500 text-sm">Estádio atual</div></div>
                  </div>
                  <div className="space-y-3">
                    {[['Capacidade', team.stadium.capacity.toLocaleString('pt-BR')], ['Ingresso', `R$ ${team.stadium.ticketPrice}`], ['Manutenção', `R$ ${(team.stadium.maintenanceCost / 1000).toFixed(0)}k/jogo`]].map(([l, v]) => (
                      <div key={l} className="flex justify-between items-center text-sm border-b border-zinc-800/60 pb-2">
                        <span className="text-zinc-500">{l}</span><span className="font-bold">{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-5">
                  <h3 className="font-bold text-lg mb-1">Ampliar</h3>
                  <p className="text-zinc-500 text-sm mb-5">+10.000 lugares · +R$10 no ingresso</p>
                  <div className="space-y-2 text-sm mb-5">
                    <div className="flex justify-between"><span className="text-zinc-500">Nova capacidade</span><span className="font-bold">{(team.stadium.capacity + 10_000).toLocaleString('pt-BR')}</span></div>
                    <div className="flex justify-between"><span className="text-zinc-500">Novo ingresso</span><span className="font-bold text-emerald-400">R$ {team.stadium.ticketPrice + 10}</span></div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div><div className="text-xs text-zinc-500">Investimento</div><div className="font-bold font-mono text-amber-400">R$ {team.stadium.level * 2}M</div></div>
                    <button onClick={() => dispatch({ type: 'UPGRADE_STADIUM' })} disabled={team.money < team.stadium.level * 2_000_000}
                      className="bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-800 disabled:text-zinc-600 text-zinc-950 font-bold py-2 px-5 rounded-xl">Construir</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── STAFF ── */}
          {activeTab === 'staff' && (
            <div>
              <h2 className="font-bold text-lg flex items-center gap-2 mb-1"><Briefcase size={18} className="text-zinc-400" /> Comissão Técnica</h2>
              <p className="text-zinc-500 text-sm mb-5">Contrate profissionais para melhorar o desempenho do clube.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {(Object.keys(STAFF_INFO) as StaffRole[]).map(role => {
                  const info = STAFF_INFO[role], level = gameState.staff[role] ?? 0, maxed = level >= 3;
                  const nextCost = maxed ? 0 : info.hireCost[level];
                  const canAfford = team.money >= nextCost;
                  return (
                    <div key={role} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
                      <div className="flex items-start justify-between mb-3">
                        <div><div className="font-bold text-base">{info.label}</div><div className="text-zinc-500 text-xs mt-0.5">{info.desc}</div></div>
                        <div className="flex gap-1">{[1, 2, 3].map(l => <div key={l} className={`w-3 h-3 rounded-full ${l <= level ? 'bg-emerald-500' : 'bg-zinc-800'}`} />)}</div>
                      </div>
                      <div className="space-y-1.5 mb-4">
                        {info.effect.map((eff, i) => (
                          <div key={i} className={`flex items-center gap-2 text-xs ${i < level ? 'text-zinc-300' : 'text-zinc-600'}`}>
                            <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${i < level ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-zinc-800 border border-zinc-700'}`}>{i + 1}</div>
                            <span>{eff}</span>{i < level && <span className="text-emerald-500 text-[10px]">✓ ativo</span>}
                          </div>
                        ))}
                      </div>
                      {maxed ? <div className="w-full py-2 text-center text-xs font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">Nível máximo</div> : (
                        <div className="flex items-center justify-between">
                          <div><div className="text-[10px] text-zinc-500">Próximo nível</div><div className={`font-bold font-mono text-sm ${canAfford ? 'text-amber-400' : 'text-red-400'}`}>R${(nextCost / 1_000_000).toFixed(1)}M</div></div>
                          <button onClick={() => dispatch({ type: 'HIRE_STAFF', payload: { role } })} disabled={!canAfford}
                            className="bg-zinc-700 hover:bg-zinc-600 disabled:bg-zinc-800 disabled:text-zinc-600 text-white font-bold py-2 px-4 rounded-xl text-xs">{level === 0 ? 'Contratar' : 'Promover'}</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── ACADEMIA ── */}
          {activeTab === 'academy' && (
            <div>
              <h2 className="font-bold text-lg flex items-center gap-2 mb-1"><GraduationCap size={18} className="text-zinc-400" /> Academia de Jovens</h2>
              <p className="text-zinc-500 text-sm mb-5">Novos jovens chegam a cada início de temporada.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                {ACADEMY_INFO.map((info, level) => {
                  const active = team.academyLevel === level;
                  const canUpgrade = team.academyLevel === level - 1 && team.money >= info.cost;
                  return (
                    <div key={level} className={`rounded-2xl border p-5 transition-all ${active ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-zinc-800 bg-zinc-900'}`}>
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <div className={`font-bold text-base ${active ? 'text-emerald-400' : ''}`}>{info.label}</div>
                          <div className="text-zinc-500 text-xs mt-0.5">{info.desc}</div>
                        </div>
                        {active && <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">Ativo</span>}
                      </div>
                      {level > 0 && !active && level === team.academyLevel + 1 && (
                        <div className="flex items-center justify-between mt-3">
                          <div><div className="text-[10px] text-zinc-500">Investimento</div><div className={`font-bold font-mono text-sm ${canUpgrade ? 'text-amber-400' : 'text-red-400'}`}>R${(info.cost / 1_000_000).toFixed(1)}M</div></div>
                          <button onClick={() => dispatch({ type: 'UPGRADE_ACADEMY' })} disabled={!canUpgrade}
                            className="bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white font-bold py-2 px-4 rounded-xl text-xs">Construir</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <h3 className="font-bold text-sm text-zinc-400 uppercase tracking-wider mb-3">Jovens da Academia</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {userPlayers.filter(p => p.isYouth).length === 0
                  ? <div className="col-span-full text-zinc-500 text-sm py-6 text-center">Nenhum jovem ainda. Construa a academia e inicie uma nova temporada.</div>
                  : userPlayers.filter(p => p.isYouth).map(p => (
                    <div key={p.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 flex items-center gap-3">
                      <span className={`inline-flex items-center justify-center w-9 h-9 rounded-lg font-bold text-xs border flex-shrink-0 ${posColor[p.position]}`}>{p.position}</span>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm truncate">{p.name} <span className="text-[9px] text-emerald-400 font-bold">BASE</span></div>
                        <div className="text-xs text-zinc-500">{p.age}a · {p.strength} ovr · Pot <span className="text-amber-400">{p.potential}</span></div>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* ── MANAGER ── */}
          {activeTab === 'manager' && (
            <div>
              <h2 className="font-bold text-lg flex items-center gap-2 mb-4"><User size={18} className="text-zinc-400" /> Técnico</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
                  {[{ label: 'Nome', field: 'name' as const }, { label: 'Nacionalidade', field: 'nationality' as const }].map(({ label, field }) => (
                    <div key={field}>
                      <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-1.5">{label}</label>
                      <input type="text" value={gameState.manager[field]}
                        onChange={e => dispatch({ type: 'UPDATE_MANAGER', payload: { name: field === 'name' ? e.target.value : gameState.manager.name, nationality: field === 'nationality' ? e.target.value : gameState.manager.nationality } })}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-emerald-500" />
                    </div>
                  ))}
                  <div>
                    <div className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Reputação</div>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 bg-zinc-800 rounded-full h-3 overflow-hidden"><div className="h-full bg-gradient-to-r from-amber-500 to-emerald-500" style={{ width: `${gameState.manager.reputation}%` }} /></div>
                      <span className="font-bold font-mono text-sm">{gameState.manager.reputation}</span>
                    </div>
                  </div>
                </div>
                <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
                  <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-4">Carreira</h3>
                  <div className="grid grid-cols-2 gap-4">
                    {[['Jogos', gameState.manager.matchesManaged, ''], ['Vitórias', gameState.manager.wins, 'text-emerald-400'], ['Empates', gameState.manager.draws, 'text-amber-400'], ['Derrotas', gameState.manager.losses, 'text-red-400'], ['Títulos', gameState.manager.titles, 'text-amber-400']].map(([l, v, c]) => (
                      <div key={l as string}><div className="text-zinc-500 text-xs">{l}</div><div className={`text-2xl font-black font-mono ${c}`}>{v}</div></div>
                    ))}
                  </div>
                  <div className="mt-4 pt-3 border-t border-zinc-800">
                    <div className="text-zinc-500 text-xs">Aproveitamento</div>
                    <div className="text-xl font-black font-mono">
                      {gameState.manager.matchesManaged > 0 ? (((gameState.manager.wins * 3 + gameState.manager.draws) / (gameState.manager.matchesManaged * 3)) * 100).toFixed(1) : '0.0'}%
                    </div>
                  </div>
                </div>
                {/* Reputação do clube */}
                <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
                  <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-3 flex items-center gap-2"><Star size={12} className="text-amber-400" />Reputação do Clube</h3>
                  <div className="flex items-center gap-3 mb-3">
                    <div className="flex-1 bg-zinc-800 rounded-full h-3 overflow-hidden"><div className="h-full bg-gradient-to-r from-amber-600 to-amber-300" style={{ width: `${team.reputation}%` }} /></div>
                    <span className="font-bold font-mono text-amber-400">{team.reputation}</span>
                  </div>
                  <div className="text-xs text-zinc-600 space-y-1">
                    <p>· Afeta patrocínio (×{(0.7 + team.reputation / 333).toFixed(2)})</p>
                    <p>· Facilita contratação de jogadores</p>
                    <p>· Cresce com títulos e vitórias</p>
                  </div>
                </div>
                <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 sm:col-span-2">
                  <div className="flex items-center gap-2 mb-1"><Star size={16} className="text-amber-400" /><h3 className="font-bold">Especialização</h3></div>
                  <p className="text-zinc-500 text-xs mb-4">Define o estilo de jogo e aplica bônus permanente.</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {(Object.keys(SPEC_INFO) as Specialization[]).map(spec => {
                      const info = SPEC_INFO[spec], active = gameState.manager.specialization === spec;
                      const [textClass, borderClass, bgClass] = info.color.trim().split(/\s+/);
                      return (
                        <button key={spec} onClick={() => dispatch({ type: 'SET_SPECIALIZATION', payload: active ? null : spec })}
                          className={`rounded-xl p-4 border text-left transition-all ${active ? `${borderClass} ${bgClass} ring-1 ${borderClass}` : 'border-zinc-800 hover:border-zinc-600'}`}>
                          <div className={`font-bold text-sm mb-1 ${active ? textClass : 'text-zinc-200'}`}>{info.label}</div>
                          <div className="text-[10px] text-zinc-500 leading-tight">{info.desc}</div>
                          {active && <div className={`mt-2 text-[10px] font-bold ${textClass}`}>✓ Ativo</div>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── MARKET ── */}
          {activeTab === 'market' && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-bold text-lg flex items-center gap-2"><ShoppingCart size={18} className="text-amber-400" /> Mercado</h2>
                <span className="text-xs text-zinc-500">Saldo: <span className="text-emerald-400 font-bold">R${(team.money / 1_000_000).toFixed(1)}M</span></span>
              </div>
              {!transferWindowOpen && (
                <div className="bg-zinc-800/60 border border-zinc-700 rounded-xl px-4 py-3 mb-4 flex items-center gap-3">
                  <Lock size={16} className="text-zinc-500 flex-shrink-0" />
                  <p className="text-zinc-400 text-sm">Janela de transferências fechada. Abre nas rodadas 1–3 e 10–12.</p>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
                {gameState.players.filter(p => p.teamId !== team.id && p.listedForSale).map(p => {
                  const pt = gameState.teams.find(t => t.id === p.teamId);
                  return (
                    <div key={p.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-3">
                      <div className="flex items-start gap-3 mb-3">
                        <span className={`inline-flex items-center justify-center w-9 h-9 rounded-lg font-bold text-xs border flex-shrink-0 ${posColor[p.position]}`}>{p.position}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5"><span className="font-semibold text-sm truncate">{p.name}</span><FormBadge streak={p.formStreak} /></div>
                          <div className="text-xs text-zinc-500 truncate flex items-center gap-1.5">
                            {pt?.name} · {p.age}a <RepBadge rep={pt?.reputation ?? 0} />
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className="font-black font-mono text-sm text-amber-400">R${(p.value / 1_000_000).toFixed(1)}M</div>
                          <div className="text-xs text-zinc-500">Ovr <span className="text-zinc-300 font-bold">{p.strength}</span></div>
                        </div>
                      </div>
                      <div className="mb-3 space-y-0.5">
                        {PRIMARY_ATTRS[p.position].slice(0, 3).map(k => (
                          <div key={k} className="flex items-center gap-2 text-[10px]">
                            <span className="text-zinc-500 w-16 truncate">{ATTR_LABELS[k]}</span>
                            <div className="flex-1 h-1 bg-zinc-800 rounded-full overflow-hidden"><div className={`h-full rounded-full ${p.attributes[k] >= 75 ? 'bg-emerald-500' : p.attributes[k] >= 55 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${p.attributes[k]}%` }} /></div>
                            <span className="font-mono text-zinc-400 w-5 text-right">{p.attributes[k]}</span>
                          </div>
                        ))}
                      </div>
                      <button onClick={() => { setNegotiatingPlayer(p); setOfferAmount(p.value); setNegotiationMessage(''); }}
                        disabled={!transferWindowOpen}
                        className="w-full bg-emerald-500/10 hover:bg-emerald-500/20 disabled:opacity-40 border border-emerald-500/30 text-emerald-400 font-bold py-1.5 rounded-lg text-xs flex items-center justify-center gap-1">
                        Negociar <ChevronRight size={14} />
                      </button>
                    </div>
                  );
                })}
                {gameState.players.filter(p => p.teamId !== team.id && p.listedForSale).length === 0 && (
                  <div className="col-span-full text-center text-zinc-500 py-12">Nenhum jogador à venda no momento.</div>
                )}
              </div>
            </div>
          )}

          {/* ── HISTÓRICO ── */}
          {activeTab === 'historico' && (
            <div>
              <h2 className="font-bold text-lg flex items-center gap-2 mb-4"><History size={18} className="text-zinc-400" /> Histórico · {team.name}</h2>
              {gameState.seasonHistory.length === 0 ? (
                <div className="text-center py-12 text-zinc-500 text-sm">Nenhuma temporada concluída ainda.</div>
              ) : (
                <>
                  {/* Resumo de conquistas */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                    {[
                      { label: 'Temporadas', value: gameState.seasonHistory.length, color: 'text-zinc-200' },
                      { label: 'Títulos', value: gameState.seasonHistory.filter(r => r.champion).length, color: 'text-amber-400' },
                      { label: 'Promoções', value: gameState.seasonHistory.filter(r => r.promoted).length, color: 'text-emerald-400' },
                      { label: 'Rebaixamentos', value: gameState.seasonHistory.filter(r => r.relegated).length, color: 'text-red-400' },
                    ].map(({ label, value, color }) => (
                      <div key={label} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 text-center">
                        <div className={`text-3xl font-black font-mono ${color}`}>{value}</div>
                        <div className="text-xs text-zinc-500 mt-1">{label}</div>
                      </div>
                    ))}
                  </div>

                  {/* Tabela de temporadas */}
                  <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
                    <div className="grid grid-cols-[auto_auto_auto_1fr_auto_auto] gap-x-3 px-4 py-2.5 border-b border-zinc-800 text-xs text-zinc-500 font-medium uppercase tracking-wider">
                      <span>T.</span><span>Div.</span><span>Pos.</span><span>V-E-D</span><span>Copa</span><span>Obj.</span>
                    </div>
                    {[...gameState.seasonHistory].reverse().map(r => (
                      <div key={r.season} className={`grid grid-cols-[auto_auto_auto_1fr_auto_auto] gap-x-3 items-center px-4 py-3 border-b border-zinc-800/50 last:border-0 hover:bg-zinc-800/20`}>
                        <span className="text-zinc-500 font-mono text-sm w-5">{r.season}</span>
                        <span className="text-xs font-bold text-zinc-400 w-8">
                          {r.league === 1 ? 'A' : r.league === 2 ? 'B' : 'C'}
                          {r.champion && ' 🏆'}
                          {r.promoted && !r.champion && ' ↑'}
                          {r.relegated && ' ↓'}
                        </span>
                        <span className={`font-bold text-sm w-5 ${r.position <= 3 ? 'text-emerald-400' : r.position >= 8 ? 'text-red-400' : 'text-zinc-300'}`}>
                          {r.position}º
                        </span>
                        <div className="text-xs text-zinc-500 min-w-0">
                          <span className="text-emerald-400 font-bold">{r.wins}</span>
                          <span className="text-zinc-600">-</span>
                          <span className="text-amber-400 font-bold">{r.draws}</span>
                          <span className="text-zinc-600">-</span>
                          <span className="text-red-400 font-bold">{r.losses}</span>
                          <span className="text-zinc-600 ml-2">({r.goalsFor}:{r.goalsAgainst})</span>
                        </div>
                        <span className="text-xs text-zinc-500 truncate max-w-[80px]">{r.cupResult}</span>
                        <span className="text-xs text-zinc-500">
                          <span className={r.objectivesAchieved === r.objectivesTotal ? 'text-emerald-400' : 'text-zinc-400'}>{r.objectivesAchieved}</span>/{r.objectivesTotal}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Melhor temporada */}
                  {gameState.seasonHistory.length > 0 && (() => {
                    const best = [...gameState.seasonHistory].sort((a, b) => a.league - b.league || a.position - b.position)[0];
                    return (
                      <div className="mt-4 bg-amber-500/5 border border-amber-500/20 rounded-2xl p-4">
                        <div className="text-xs font-bold text-amber-400 uppercase tracking-wider mb-1">Melhor Temporada</div>
                        <div className="font-bold">Temporada {best.season} — {best.league === 1 ? 'Série A' : best.league === 2 ? 'Série B' : 'Série C'}, {best.position}º lugar</div>
                        <div className="text-sm text-zinc-400">{best.wins}V {best.draws}E {best.losses}D · {best.goalsFor} gols marcados</div>
                      </div>
                    );
                  })()}
                </>
              )}
            </div>
          )}

        </main>
      </div>

      {/* Bottom Nav mobile */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-zinc-900 border-t border-zinc-800 z-20">
        <div className="flex overflow-x-auto">
          {NAV.map(({ key, icon, label }) => (
            <button key={key} onClick={() => setActiveTab(key)}
              className={`flex flex-col items-center gap-0.5 px-3 py-2.5 flex-1 min-w-[52px] transition-colors relative ${activeTab === key ? 'text-emerald-400' : 'text-zinc-500 hover:text-zinc-300'}`}>
              <span className={`transition-transform ${activeTab === key ? 'scale-110' : ''}`}>{icon}</span>
              <span className="text-[9px] font-medium whitespace-nowrap">{label}</span>
              {key === 'copa' && hasPendingCup && <span className="absolute top-1.5 right-2.5 w-2 h-2 bg-amber-400 rounded-full" />}
            </button>
          ))}
        </div>
      </nav>

      {/* Modal negociação transferência */}
      {negotiatingPlayer && (
        <div className="fixed inset-0 bg-black/80 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-t-3xl sm:rounded-2xl p-6 w-full sm:max-w-md">
            <h3 className="text-lg font-bold mb-4">Negociar Transferência</h3>
            <div className="flex items-center gap-3 mb-5 bg-zinc-950 p-3 rounded-xl border border-zinc-800">
              <span className={`inline-flex items-center justify-center w-11 h-11 rounded-xl font-bold border text-sm ${posColor[negotiatingPlayer.position]}`}>{negotiatingPlayer.position}</span>
              <div className="min-w-0"><div className="font-bold">{negotiatingPlayer.name}</div><div className="text-zinc-500 text-xs">{gameState.teams.find(t => t.id === negotiatingPlayer.teamId)?.name} · {negotiatingPlayer.age}a · Ovr {negotiatingPlayer.strength}</div></div>
              <div className="ml-auto text-right flex-shrink-0"><div className="text-xs text-zinc-500">Valor</div><div className="font-bold text-amber-400 font-mono">R${(negotiatingPlayer.value / 1_000_000).toFixed(1)}M</div></div>
            </div>
            <div className="mb-4">
              <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-1.5">Sua oferta (R$)</label>
              <input type="number" value={offerAmount} onChange={e => setOfferAmount(Number(e.target.value))}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white font-mono text-lg focus:outline-none focus:border-emerald-500" />
            </div>
            {negotiationMessage && <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">{negotiationMessage}</div>}
            <div className="flex gap-3">
              <button onClick={() => setNegotiatingPlayer(null)} className="flex-1 py-3 rounded-xl font-bold bg-zinc-800 hover:bg-zinc-700 text-sm">Cancelar</button>
              <button onClick={submitOffer} className="flex-1 py-3 rounded-xl font-bold bg-emerald-500 hover:bg-emerald-400 text-zinc-950 text-sm">Fazer Oferta</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal renovação de contrato */}
      {contractPlayer && (
        <div className="fixed inset-0 bg-black/80 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-t-3xl sm:rounded-2xl p-6 w-full sm:max-w-md">
            <h3 className="text-lg font-bold mb-4">Renovar Contrato</h3>
            <div className="flex items-center gap-3 mb-5 bg-zinc-950 p-3 rounded-xl border border-zinc-800">
              <span className={`inline-flex items-center justify-center w-11 h-11 rounded-xl font-bold border text-sm ${posColor[contractPlayer.position]}`}>{contractPlayer.position}</span>
              <div className="min-w-0">
                <div className="font-bold">{contractPlayer.name}</div>
                <div className="text-zinc-500 text-xs">{contractPlayer.age}a · Ovr {contractPlayer.strength} · Contrato atual: {contractPlayer.contractYears}a</div>
              </div>
            </div>
            <div className="space-y-4 mb-5">
              <div>
                <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-1.5">
                  Salário Mensal (atual: R${(contractPlayer.salary / 1000).toFixed(0)}k)
                </label>
                <input type="number" value={contractSalary} onChange={e => setContractSalary(Number(e.target.value))}
                  step="5000"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white font-mono text-lg focus:outline-none focus:border-emerald-500" />
                {contractSalary > contractPlayer.salary && (
                  <div className="text-xs text-amber-400 mt-1">
                    Bônus de assinatura: R${(contractSalary * 0.5 / 1000).toFixed(0)}k
                    {team.money < contractSalary * 0.5 && <span className="text-red-400 ml-2">— saldo insuficiente</span>}
                  </div>
                )}
              </div>
              <div>
                <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-1.5">
                  Duração do contrato
                </label>
                <div className="flex gap-2">
                  {[1, 2, 3, 4].map(y => (
                    <button key={y} onClick={() => setContractYears(y)}
                      className={`flex-1 py-2.5 rounded-xl font-bold text-sm border ${contractYears === y ? 'border-emerald-500 bg-emerald-500/20 text-emerald-400' : 'border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-zinc-600'}`}>
                      {y}a
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {contractMsg && <div className="mb-4 p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 text-sm">{contractMsg}</div>}
            <div className="flex gap-3">
              <button onClick={() => setContractPlayer(null)} className="flex-1 py-3 rounded-xl font-bold bg-zinc-800 hover:bg-zinc-700 text-sm">Cancelar</button>
              <button onClick={submitContract}
                disabled={team.money < (contractSalary > contractPlayer.salary ? contractSalary * 0.5 : 0)}
                className="flex-1 py-3 rounded-xl font-bold bg-emerald-500 hover:bg-emerald-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-zinc-950 text-sm">
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal relatório pós-jogo */}
      {showMatchReport && gameState.lastMatchReport && (
        <div className="fixed inset-0 bg-black/85 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-t-3xl sm:rounded-2xl p-6 w-full sm:max-w-lg max-h-[85vh] overflow-y-auto">
            {(() => {
              const rpt = gameState.lastMatchReport!;
              const home = gameState.teams.find(t => t.id === rpt.homeTeamId)!;
              const away = gameState.teams.find(t => t.id === rpt.awayTeamId)!;
              const isHome = home.id === team.id;
              const userGoals = isHome ? rpt.homeScore : rpt.awayScore;
              const oppGoals = isHome ? rpt.awayScore : rpt.homeScore;
              const resultLabel = userGoals > oppGoals ? '✅ Vitória' : userGoals === oppGoals ? '🤝 Empate' : '❌ Derrota';
              return (
                <>
                  <div className="flex items-center justify-between mb-5">
                    <h3 className="font-bold text-lg flex items-center gap-2"><FileText size={16} className="text-zinc-400" />Relatório {rpt.isCup ? '· Copa' : ''}</h3>
                    <span className="text-sm font-bold">{resultLabel}</span>
                  </div>
                  {/* Placar */}
                  <div className="flex items-center justify-center gap-4 mb-5 py-4 bg-zinc-950 rounded-2xl border border-zinc-800">
                    <div className="text-right">
                      <div className="flex items-center gap-2 justify-end">
                        <span className={`font-bold ${home.id === team.id ? 'text-emerald-400' : ''}`}>{home.name}</span>
                        <div className="w-5 h-5 rounded-full" style={{ backgroundColor: home.color }} />
                      </div>
                    </div>
                    <div className="text-4xl font-black font-mono">{rpt.homeScore}–{rpt.awayScore}</div>
                    <div className="text-left">
                      <div className="flex items-center gap-2">
                        <div className="w-5 h-5 rounded-full" style={{ backgroundColor: away.color }} />
                        <span className={`font-bold ${away.id === team.id ? 'text-emerald-400' : ''}`}>{away.name}</span>
                      </div>
                    </div>
                  </div>

                  {/* Estatísticas */}
                  <div className="grid grid-cols-3 gap-2 text-center mb-5">
                    {[
                      { label: 'Finalizações', h: rpt.homeShots, a: rpt.awayShots },
                      { label: 'Posse (%)', h: rpt.homePossession, a: 100 - rpt.homePossession },
                    ].map(({ label, h, a }) => (
                      <React.Fragment key={label}>
                        <div className="font-bold font-mono text-lg">{h}</div>
                        <div className="text-xs text-zinc-500 flex items-center justify-center">{label}</div>
                        <div className="font-bold font-mono text-lg">{a}</div>
                      </React.Fragment>
                    ))}
                  </div>

                  {/* Gols */}
                  {rpt.goalEvents.length > 0 && (
                    <div className="mb-4">
                      <div className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Gols</div>
                      <div className="space-y-1">
                        {rpt.goalEvents.map((g, i) => {
                          const scorer = gameState.players.find(p => p.id === g.playerId);
                          const assister = g.assistId ? gameState.players.find(p => p.id === g.assistId) : null;
                          const isUserGoal = g.teamId === team.id;
                          return (
                            <div key={i} className={`flex items-center gap-2 text-sm p-2 rounded-lg ${isUserGoal ? 'bg-emerald-500/10' : 'bg-red-500/10'}`}>
                              <span className="text-zinc-500 font-mono text-xs w-8">{g.minute}'</span>
                              <span className={`font-bold ${isUserGoal ? 'text-emerald-400' : 'text-red-400'}`}>⚽</span>
                              <span className="font-semibold">{scorer?.name ?? '?'}</span>
                              {assister && <span className="text-zinc-500 text-xs">(A: {assister.name})</span>}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Cartões */}
                  {rpt.cards.length > 0 && (
                    <div className="mb-4">
                      <div className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Cartões</div>
                      <div className="flex flex-wrap gap-2">
                        {rpt.cards.map((c, i) => {
                          const p = gameState.players.find(pl => pl.id === c.playerId);
                          return (
                            <div key={i} className="flex items-center gap-1.5 text-xs bg-zinc-800 px-2 py-1 rounded-lg">
                              <span className={`w-2.5 h-3.5 rounded-sm ${c.type === 'yellow' ? 'bg-amber-400' : 'bg-red-500'}`} />
                              <span>{c.minute}' {p?.name ?? '?'}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Melhores em campo */}
                  {rpt.topPerformers.length > 0 && (
                    <div className="mb-5">
                      <div className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Melhores em Campo</div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {rpt.topPerformers.slice(0, 6).map((perf, i) => {
                          const p = gameState.players.find(pl => pl.id === perf.playerId);
                          const isUser = perf.teamId === team.id;
                          return (
                            <div key={i} className={`flex items-center gap-2 p-2 rounded-xl border text-sm ${isUser ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-zinc-800 bg-zinc-900'}`}>
                              {p && <span className={`inline-flex items-center justify-center w-7 h-7 rounded-lg font-bold text-[10px] border flex-shrink-0 ${posColor[p.position]}`}>{p.position}</span>}
                              <div className="min-w-0">
                                <div className="truncate text-xs font-semibold">{p?.name ?? '?'}</div>
                                <div className="text-[10px] text-zinc-500 font-mono">{perf.rating.toFixed(1)} nota</div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <button onClick={() => setShowMatchReport(false)}
                    className="w-full bg-zinc-100 text-zinc-900 hover:bg-white font-bold py-3 rounded-2xl text-sm">
                    Fechar
                  </button>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* Modal fim de temporada */}
      {showOffseasonModal && gameState.lastSeasonSummary && (
        <div className="fixed inset-0 bg-black/90 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-t-3xl sm:rounded-2xl p-6 w-full sm:max-w-lg max-h-[85vh] overflow-y-auto">
            {(() => {
              const s = gameState.lastSeasonSummary!;
              const wasPromoted = s.promoted.includes(gameState.userTeamId!);
              const wasRelegated = s.relegated.includes(gameState.userTeamId!);
              const wasChampion = s.userPosition === 1;
              return (
                <>
                  <div className="text-center mb-6">
                    <div className="text-4xl mb-2">{wasChampion ? '🏆' : wasPromoted ? '🎉' : wasRelegated ? '😞' : '⚽'}</div>
                    <h2 className="text-2xl font-black">Temporada {s.season} Encerrada</h2>
                    <p className="text-zinc-500 text-sm mt-1">
                      {wasChampion && 'Campeão! Parabéns!'}
                      {wasPromoted && !wasChampion && 'Promovido para a divisão superior!'}
                      {wasRelegated && 'Rebaixado para a divisão inferior.'}
                      {!wasChampion && !wasPromoted && !wasRelegated && `${s.userLeague === 1 ? 'Série A' : s.userLeague === 2 ? 'Série B' : 'Série C'} — ${s.userPosition}º lugar`}
                    </p>
                  </div>
                  <div className="space-y-3 mb-6">
                    {s.promoted.length > 0 && (
                      <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3">
                        <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm mb-1"><TrendingUp size={14} /> Promovidos</div>
                        <div className="text-xs text-zinc-400">{s.promoted.map(id => gameState.teams.find(t => t.id === id)?.name).join(', ')}</div>
                      </div>
                    )}
                    {s.relegated.length > 0 && (
                      <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-3">
                        <div className="flex items-center gap-2 text-red-400 font-bold text-sm mb-1"><TrendingDown size={14} /> Rebaixados</div>
                        <div className="text-xs text-zinc-400">{s.relegated.map(id => gameState.teams.find(t => t.id === id)?.name).join(', ')}</div>
                      </div>
                    )}
                    {s.cupResult && s.cupResult !== 'Não participou' && (
                      <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">
                        <div className="flex items-center gap-2 text-amber-400 font-bold text-sm mb-1"><Trophy size={14} /> Copa</div>
                        <div className="text-xs text-zinc-400">{s.cupResult}</div>
                      </div>
                    )}
                    {s.objectivesTotal > 0 && (
                      <div className="bg-zinc-800 rounded-xl p-3">
                        <div className="flex items-center justify-between">
                          <div className="text-xs text-zinc-500">Objetivos cumpridos</div>
                          <div className={`font-bold font-mono ${s.objectivesAchieved === s.objectivesTotal ? 'text-emerald-400' : 'text-zinc-300'}`}>
                            {s.objectivesAchieved}/{s.objectivesTotal}
                          </div>
                        </div>
                      </div>
                    )}
                    {s.topScorer && (
                      <div className="bg-zinc-800 rounded-xl p-3">
                        <div className="text-xs text-zinc-500 mb-1">⚽ Artilheiro</div>
                        <div className="font-bold">{s.topScorer.name} <span className="text-emerald-400">{s.topScorer.goals} gols</span></div>
                        <div className="text-xs text-zinc-500">{s.topScorer.team}</div>
                      </div>
                    )}
                    {s.retired.length > 0 && (
                      <div className="bg-zinc-800/60 rounded-xl p-3">
                        <div className="text-xs text-zinc-500 mb-1">👋 Aposentados</div>
                        <div className="text-xs text-zinc-400">{s.retired.join(', ')}</div>
                      </div>
                    )}
                    {s.youthGenerated.length > 0 && (
                      <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-3">
                        <div className="flex items-center gap-2 text-emerald-400 font-bold text-xs mb-1"><GraduationCap size={12} /> Novos talentos da academia</div>
                        <div className="text-xs text-zinc-400">{s.youthGenerated.join(', ')}</div>
                      </div>
                    )}
                  </div>
                  <button onClick={() => { setShowOffseasonModal(false); dispatch({ type: 'START_NEW_SEASON' }); setMatchResult(null); }}
                    className="w-full bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold py-4 rounded-2xl text-base">
                    Iniciar Temporada {s.season + 1} →
                  </button>
                </>
              );
            })()}
          </div>
        </div>
      )}

    </div>
  );
}