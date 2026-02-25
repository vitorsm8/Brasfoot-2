import React, { useState, useMemo, useReducer } from 'react';
import { generateInitialState } from './data';
import { GameState, Player, Match } from './types';
import { getBestLineup } from './engine';
import { gameReducer } from './gameReducer';
import {
  Trophy, Users, Calendar, Play, Dumbbell,
  User, DollarSign, Home, ShoppingCart, Shield,
  ChevronRight, TrendingUp, Zap, Heart,
} from 'lucide-react';
import LiveMatchDay from './LiveMatchDay';

// ─── Helpers de estilo ────────────────────────────────────────────────────────

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

// ─── Navegação ────────────────────────────────────────────────────────────────

type Tab = 'squad' | 'standings' | 'fixtures' | 'training' | 'finances' | 'stadium' | 'manager' | 'market';

const NAV: { key: Tab; icon: React.ReactNode; label: string }[] = [
  { key: 'squad',     icon: <Users size={20} />,        label: 'Elenco' },
  { key: 'standings', icon: <Trophy size={20} />,       label: 'Tabela' },
  { key: 'fixtures',  icon: <Calendar size={20} />,     label: 'Rodada' },
  { key: 'training',  icon: <Dumbbell size={20} />,     label: 'Treino' },
  { key: 'finances',  icon: <DollarSign size={20} />,   label: 'Finanças' },
  { key: 'stadium',   icon: <Home size={20} />,         label: 'Estádio' },
  { key: 'manager',   icon: <User size={20} />,         label: 'Técnico' },
  { key: 'market',    icon: <ShoppingCart size={20} />, label: 'Mercado' },
];

// ─── Componente principal ─────────────────────────────────────────────────────

export default function App() {
  // Todos os hooks antes de qualquer return condicional
  const [gameState, dispatch] = useReducer(gameReducer, null);
  const [activeTab, setActiveTab] = useState<Tab>('squad');
  const [matchResult, setMatchResult] = useState<Match | null>(null);
  const [isLiveMatchMode, setIsLiveMatchMode] = useState(false);
  const [negotiatingPlayer, setNegotiatingPlayer] = useState<Player | null>(null);
  const [offerAmount, setOfferAmount] = useState<number>(0);
  const [negotiationMessage, setNegotiationMessage] = useState<string>('');

  const tempState = useMemo(() => generateInitialState(), []);

  const userTeam = gameState
    ? (gameState.teams.find(t => t.id === gameState.userTeamId) ?? null)
    : null;

  const userPlayers = useMemo(() => {
    if (!gameState || !userTeam) return [];
    return [...gameState.players]
      .filter(p => p.teamId === userTeam.id)
      .sort((a, b) => {
        const o = { G: 1, D: 2, M: 3, A: 4 };
        return o[a.position] !== o[b.position]
          ? o[a.position] - o[b.position]
          : b.strength - a.strength;
      });
  }, [gameState?.players, userTeam?.id]);

  const currentRoundMatches = useMemo(
    () => gameState ? gameState.matches.filter(m => m.round === gameState.currentRound) : [],
    [gameState?.matches, gameState?.currentRound]
  );

  const userMatch = userTeam
    ? currentRoundMatches.find(m => m.homeTeamId === userTeam.id || m.awayTeamId === userTeam.id)
    : undefined;

  const standings = useMemo(() => {
    if (!gameState) return [];
    const table = gameState.teams.map(t => ({ ...t, pts: 0, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0 }));
    gameState.matches.filter(m => m.played).forEach(m => {
      const h = table.find(t => t.id === m.homeTeamId)!;
      const a = table.find(t => t.id === m.awayTeamId)!;
      h.p++; a.p++; h.gf += m.homeScore; h.ga += m.awayScore; a.gf += m.awayScore; a.ga += m.homeScore;
      if (m.homeScore > m.awayScore) { h.pts += 3; h.w++; a.l++; }
      else if (m.homeScore < m.awayScore) { a.pts += 3; a.w++; h.l++; }
      else { h.pts++; a.pts++; h.d++; a.d++; }
    });
    table.forEach(t => (t.gd = t.gf - t.ga));
    return table.sort((a, b) => b.pts - a.pts || b.w - a.w || b.gd - a.gd || b.gf - a.gf);
  }, [gameState?.matches, gameState?.teams]);

  // ─── Handlers ──────────────────────────────────────────────────────────────

  const startGame = (teamId: string) => {
    const bestLineup = getBestLineup(tempState.players.filter(p => p.teamId === teamId)).map(p => p.id);
    dispatch({ type: 'INIT_GAME', payload: { ...tempState, currentRound: 1, userTeamId: teamId, userLineup: bestLineup } as GameState });
  };

  const handleMatchDayComplete = (updatedMatches: Match[], playerUpdates: Partial<Player>[]) => {
    const userUpdatedMatch = updatedMatches.find(
      m => m.homeTeamId === userTeam!.id || m.awayTeamId === userTeam!.id
    )!;
    dispatch({ type: 'MATCH_DAY_COMPLETE', payload: { updatedMatches, playerUpdates } });
    setMatchResult(userUpdatedMatch);
    setIsLiveMatchMode(false);
  };

  const submitOffer = () => {
    if (!negotiatingPlayer || !gameState) return;
    const t = gameState.teams.find(t => t.id === gameState.userTeamId)!;
    if (t.money < offerAmount) { setNegotiationMessage('Saldo insuficiente.'); return; }
    if (offerAmount >= negotiatingPlayer.value * (0.9 + Math.random() * 0.15)) {
      dispatch({ type: 'BUY_PLAYER', payload: { playerId: negotiatingPlayer.id, amount: offerAmount } });
      setNegotiatingPlayer(null);
    } else {
      setNegotiationMessage('Oferta recusada. Tente um valor maior.');
    }
  };

  // ─── Returns condicionais ──────────────────────────────────────────────────

  if (!gameState) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans">
        <div className="max-w-4xl mx-auto px-4 py-12">
          <div className="text-center mb-12">
            <h1 className="text-5xl sm:text-7xl font-black tracking-tighter text-emerald-400 mb-3">BRASMANAGER</h1>
            <p className="text-zinc-500">Escolha seu time e leve-o ao título.</p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {tempState.teams.map(team => (
              <button
                key={team.id}
                onClick={() => startGame(team.id)}
                className="bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-600 rounded-2xl p-5 transition-all flex flex-col items-center gap-3 group active:scale-95"
              >
                <div
                  className="w-14 h-14 rounded-full flex items-center justify-center text-2xl font-black shadow-lg group-hover:scale-110 transition-transform"
                  style={{ backgroundColor: team.color, color: '#fff' }}
                >
                  {team.name.charAt(0)}
                </div>
                <span className="font-bold text-sm text-center leading-tight">{team.name}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (isLiveMatchMode && userTeam) {
    return (
      <LiveMatchDay
        gameState={gameState}
        matches={currentRoundMatches}
        userLineup={gameState.userLineup}
        onComplete={handleMatchDayComplete}
      />
    );
  }

  const team = userTeam!;

  // ─── Render principal ──────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans flex flex-col">

      {/* ── Header ── */}
      <header className="bg-zinc-900 border-b border-zinc-800 sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center font-black text-sm"
              style={{ backgroundColor: team.color, color: '#fff' }}>
              {team.name.charAt(0)}
            </div>
            <div className="min-w-0">
              <div className="font-bold leading-tight truncate">{team.name}</div>
              <div className="text-xs text-zinc-500 flex items-center gap-2">
                <span>R{gameState.currentRound}</span>
                <span>·</span>
                <span className="text-emerald-400 font-mono">R${(team.money / 1_000_000).toFixed(1)}M</span>
              </div>
            </div>
          </div>

          <button
            onClick={() => setIsLiveMatchMode(true)}
            disabled={gameState.userLineup.length !== 11 || matchResult !== null || !userMatch}
            className="flex-shrink-0 bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 disabled:bg-zinc-800 disabled:text-zinc-600 text-zinc-950 font-bold py-2 px-4 sm:px-6 rounded-full flex items-center gap-2 transition-colors text-sm"
          >
            <Play size={16} />
            <span className="hidden sm:inline">
              {gameState.userLineup.length !== 11 ? `Escale (${gameState.userLineup.length}/11)` : 'Jogar'}
            </span>
            <span className="sm:hidden">
              {gameState.userLineup.length !== 11 ? `${gameState.userLineup.length}/11` : 'Jogar'}
            </span>
          </button>
        </div>
      </header>

      {/* ── Match Result Banner ── */}
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
            <button onClick={() => setMatchResult(null)}
              className="bg-zinc-100 text-zinc-900 hover:bg-white font-bold py-1.5 px-6 rounded-full text-sm transition-colors">
              Continuar
            </button>
          </div>
        </div>
      )}

      {/* ── Layout ── */}
      <div className="flex flex-1 max-w-6xl mx-auto w-full">

        {/* Sidebar — só desktop */}
        <nav className="hidden lg:flex flex-col gap-1 w-52 flex-shrink-0 p-4 border-r border-zinc-800">
          {NAV.map(({ key, icon, label }) => (
            <button key={key} onClick={() => setActiveTab(key)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors text-sm ${
                activeTab === key
                  ? 'bg-zinc-800 text-white font-semibold'
                  : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'
              }`}>
              {icon}
              {label}
            </button>
          ))}
        </nav>

        {/* Content */}
        <main className="flex-1 min-w-0 p-3 sm:p-5 pb-24 lg:pb-5">

          {/* ── SQUAD ─── */}
          {activeTab === 'squad' && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold text-lg flex items-center gap-2">
                  <Shield size={18} className="text-zinc-400" /> Elenco
                </h2>
                <span className={`text-sm font-bold px-3 py-1 rounded-full ${
                  gameState.userLineup.length === 11
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : 'bg-amber-500/20 text-amber-400'
                }`}>
                  {gameState.userLineup.length}/11 escalados
                </span>
              </div>

              {/* Cards de jogadores */}
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
                {userPlayers.map(player => {
                  const sel = gameState.userLineup.includes(player.id);
                  const susp = player.redCard;
                  return (
                    <div
                      key={player.id}
                      onClick={() => !susp && dispatch({ type: 'TOGGLE_LINEUP_PLAYER', payload: { playerId: player.id } })}
                      className={`relative rounded-xl border p-3 transition-all ${
                        susp ? 'opacity-50 cursor-not-allowed border-zinc-800 bg-zinc-900/50' :
                        sel  ? 'cursor-pointer border-emerald-500/50 bg-emerald-500/5 ring-1 ring-emerald-500/30' :
                               'cursor-pointer border-zinc-800 bg-zinc-900 hover:border-zinc-700 hover:bg-zinc-800/50'
                      }`}
                    >
                      {/* Indicador de seleção */}
                      <div className={`absolute top-3 right-3 w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                        sel ? 'bg-emerald-500 border-emerald-500' : 'border-zinc-600'
                      }`}>
                        {sel && <div className="w-2 h-2 bg-zinc-950 rounded-full" />}
                      </div>

                      <div className="flex items-start gap-3 pr-8">
                        <span className={`inline-flex items-center justify-center w-9 h-9 rounded-lg font-bold text-xs border flex-shrink-0 ${posColor[player.position]}`}>
                          {player.position}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-sm truncate">{player.name}</div>
                          <div className="text-xs text-zinc-500">{player.age} anos · Força <span className="text-zinc-300 font-mono font-bold">{player.strength}</span></div>
                          {susp && <span className="text-xs text-red-500 font-bold uppercase">Suspenso</span>}
                        </div>
                      </div>

                      {/* Stats + barras */}
                      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs text-zinc-500 flex items-center gap-1"><Zap size={10} />Energia</span>
                          <div className="flex items-center gap-1.5">
                            <MiniBar value={player.energy} color={player.energy > 60 ? 'bg-emerald-500' : player.energy > 30 ? 'bg-amber-500' : 'bg-red-500'} />
                            <span className="text-xs font-mono text-zinc-400 w-7 text-right">{player.energy}%</span>
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs text-zinc-500 flex items-center gap-1"><Heart size={10} />Moral</span>
                          <div className="flex items-center gap-1.5">
                            <MiniBar value={player.morale} color={player.morale > 60 ? 'bg-blue-500' : player.morale > 30 ? 'bg-amber-500' : 'bg-red-500'} />
                            <span className="text-xs font-mono text-zinc-400 w-7 text-right">{player.morale}%</span>
                          </div>
                        </div>

                        <div className="flex gap-3 text-xs text-zinc-500">
                          <span><span className="text-zinc-300 font-bold">{player.goals}</span> G</span>
                          <span><span className="text-zinc-300 font-bold">{player.assists}</span> A</span>
                          <span><span className="text-zinc-300 font-bold">{player.matchesPlayed}</span> J</span>
                        </div>

                        <div className="flex items-center justify-end gap-1">
                          {player.yellowCards > 0 && !player.redCard && (
                            <div className="w-2.5 h-3.5 bg-amber-400 rounded-sm" />
                          )}
                          {player.yellowCards > 1 && !player.redCard && (
                            <div className="w-2.5 h-3.5 bg-amber-400 rounded-sm" />
                          )}
                          {player.redCard && <div className="w-2.5 h-3.5 bg-red-500 rounded-sm" />}
                        </div>
                      </div>

                      {/* Footer */}
                      <div className="mt-3 pt-2 border-t border-zinc-800 flex items-center justify-between">
                        <span className="text-xs text-zinc-500 font-mono">R${(player.salary / 1000).toFixed(0)}k/mês</span>
                        <button
                          onClick={e => { e.stopPropagation(); dispatch({ type: 'TOGGLE_LIST_PLAYER', payload: { playerId: player.id } }); }}
                          className={`text-xs font-bold py-0.5 px-2.5 rounded-lg border transition-colors ${
                            player.listedForSale
                              ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                              : 'bg-zinc-800 text-zinc-500 border-zinc-700 hover:text-zinc-300'
                          }`}
                        >
                          {player.listedForSale ? 'À Venda' : 'Vender'}
                        </button>
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
              <h2 className="font-bold text-lg flex items-center gap-2 mb-4"><Trophy size={18} className="text-zinc-400" /> Classificação</h2>
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
                {/* Header da tabela — esconde colunas extras no mobile */}
                <div className="grid grid-cols-[auto_1fr_auto_auto_auto_auto] sm:grid-cols-[auto_1fr_auto_auto_auto_auto_auto_auto] gap-x-2 px-4 py-2 border-b border-zinc-800 text-xs text-zinc-500 font-medium uppercase tracking-wider">
                  <span className="w-6 text-center">#</span>
                  <span>Time</span>
                  <span className="w-8 text-center">Pts</span>
                  <span className="w-6 text-center">J</span>
                  <span className="w-6 text-center hidden sm:block">V</span>
                  <span className="w-6 text-center hidden sm:block">E</span>
                  <span className="w-6 text-center">D</span>
                  <span className="w-8 text-center">SG</span>
                </div>
                {standings.map((t, i) => (
                  <div key={t.id}
                    className={`grid grid-cols-[auto_1fr_auto_auto_auto_auto] sm:grid-cols-[auto_1fr_auto_auto_auto_auto_auto_auto] gap-x-2 items-center px-4 py-3 border-b border-zinc-800/50 last:border-0 ${
                      t.id === team.id ? 'bg-zinc-800/40' : 'hover:bg-zinc-800/20'
                    }`}>
                    <span className="w-6 text-center text-zinc-500 text-sm font-mono">{i + 1}</span>
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-5 h-5 rounded-full flex-shrink-0" style={{ backgroundColor: t.color }} />
                      <span className={`text-sm font-medium truncate ${t.id === team.id ? 'text-emerald-400' : ''}`}>{t.name}</span>
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
          )}

          {/* ── FIXTURES ── */}
          {activeTab === 'fixtures' && (
            <div>
              <h2 className="font-bold text-lg flex items-center gap-2 mb-4"><Calendar size={18} className="text-zinc-400" /> Rodada {gameState.currentRound}</h2>
              <div className="grid gap-2">
                {currentRoundMatches.length === 0
                  ? <div className="text-center text-zinc-500 py-12">Fim de temporada!</div>
                  : currentRoundMatches.map(m => {
                    const home = gameState.teams.find(t => t.id === m.homeTeamId)!;
                    const away = gameState.teams.find(t => t.id === m.awayTeamId)!;
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
                <span className="text-xs text-zinc-500">Custo: <span className="text-amber-400 font-bold">R$50k</span>/sessão</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
                {userPlayers.map(p => (
                  <div key={p.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 flex items-center gap-3">
                    <span className={`inline-flex items-center justify-center w-9 h-9 rounded-lg font-bold text-xs border flex-shrink-0 ${posColor[p.position]}`}>
                      {p.position}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm truncate">{p.name}</div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-zinc-500">Força <span className="text-zinc-200 font-bold font-mono">{p.strength}</span></span>
                        <div className="flex-1 bg-zinc-800 rounded-full h-1.5 overflow-hidden">
                          <div className="h-full bg-emerald-500 transition-all" style={{ width: `${p.trainingProgress}%` }} />
                        </div>
                        <span className="text-xs text-zinc-500 font-mono">{p.trainingProgress}%</span>
                      </div>
                    </div>
                    <button
                      onClick={() => dispatch({ type: 'TRAIN_PLAYER', payload: { playerId: p.id } })}
                      disabled={team.money < 50_000 || p.strength >= 99}
                      className="flex-shrink-0 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 border border-zinc-700 text-xs font-bold py-1.5 px-3 rounded-lg transition-colors"
                    >+1</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── FINANCES ── */}
          {activeTab === 'finances' && (
            <div>
              <h2 className="font-bold text-lg flex items-center gap-2 mb-4"><DollarSign size={18} className="text-emerald-400" /> Finanças</h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
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
              <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-zinc-800 text-xs text-zinc-500 font-medium uppercase tracking-wider">Últimas transações</div>
                {team.finances.length === 0
                  ? <div className="p-6 text-center text-zinc-500 text-sm">Sem transações ainda.</div>
                  : team.finances.slice().reverse().slice(0, 20).map(r => (
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
                    <div className="w-12 h-12 bg-zinc-800 rounded-xl flex items-center justify-center">
                      <Home size={22} className="text-zinc-400" />
                    </div>
                    <div>
                      <div className="font-bold text-lg">Nível {team.stadium.level}</div>
                      <div className="text-zinc-500 text-sm">Estádio atual</div>
                    </div>
                  </div>
                  <div className="space-y-3">
                    {[
                      ['Capacidade', team.stadium.capacity.toLocaleString('pt-BR')],
                      ['Ingresso', `R$ ${team.stadium.ticketPrice}`],
                      ['Manutenção', `R$ ${(team.stadium.maintenanceCost / 1000).toFixed(0)}k/jogo`],
                    ].map(([l, v]) => (
                      <div key={l} className="flex justify-between items-center text-sm border-b border-zinc-800/60 pb-2">
                        <span className="text-zinc-500">{l}</span>
                        <span className="font-bold">{v}</span>
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
                    <div>
                      <div className="text-xs text-zinc-500">Investimento</div>
                      <div className="font-bold font-mono text-amber-400">R$ {(team.stadium.level * 2 / 1).toFixed(0)}M</div>
                    </div>
                    <button
                      onClick={() => dispatch({ type: 'UPGRADE_STADIUM' })}
                      disabled={team.money < team.stadium.level * 2_000_000}
                      className="bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-800 disabled:text-zinc-600 text-zinc-950 font-bold py-2 px-5 rounded-xl transition-colors"
                    >Construir</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── MANAGER ── */}
          {activeTab === 'manager' && (
            <div>
              <h2 className="font-bold text-lg flex items-center gap-2 mb-4"><User size={18} className="text-zinc-400" /> Técnico</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
                  {[
                    { label: 'Nome', field: 'name' as const },
                    { label: 'Nacionalidade', field: 'nationality' as const },
                  ].map(({ label, field }) => (
                    <div key={field}>
                      <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-1.5">{label}</label>
                      <input
                        type="text"
                        value={gameState.manager[field]}
                        onChange={e => dispatch({ type: 'UPDATE_MANAGER', payload: {
                          name: field === 'name' ? e.target.value : gameState.manager.name,
                          nationality: field === 'nationality' ? e.target.value : gameState.manager.nationality,
                        }})}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-white text-sm focus:outline-none focus:border-emerald-500 transition-colors"
                      />
                    </div>
                  ))}
                  <div>
                    <div className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-2">Reputação</div>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 bg-zinc-800 rounded-full h-3 overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-amber-500 to-emerald-500" style={{ width: `${gameState.manager.reputation}%` }} />
                      </div>
                      <span className="font-bold font-mono text-sm">{gameState.manager.reputation}</span>
                    </div>
                  </div>
                </div>
                <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
                  <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-4">Estatísticas de Carreira</h3>
                  <div className="grid grid-cols-2 gap-4">
                    {[
                      ['Jogos', gameState.manager.matchesManaged, ''],
                      ['Vitórias', gameState.manager.wins, 'text-emerald-400'],
                      ['Empates', gameState.manager.draws, 'text-amber-400'],
                      ['Derrotas', gameState.manager.losses, 'text-red-400'],
                    ].map(([label, val, cls]) => (
                      <div key={label as string}>
                        <div className="text-zinc-500 text-xs">{label}</div>
                        <div className={`text-2xl font-black font-mono ${cls}`}>{val}</div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 pt-3 border-t border-zinc-800">
                    <div className="text-zinc-500 text-xs">Aproveitamento</div>
                    <div className="text-xl font-black font-mono flex items-baseline gap-1">
                      {gameState.manager.matchesManaged > 0
                        ? (((gameState.manager.wins * 3 + gameState.manager.draws) / (gameState.manager.matchesManaged * 3)) * 100).toFixed(1)
                        : '0.0'}
                      <span className="text-zinc-500 text-sm font-normal">%</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── MARKET ── */}
          {activeTab === 'market' && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-bold text-lg flex items-center gap-2"><ShoppingCart size={18} className="text-amber-400" /> Mercado</h2>
                <span className="text-xs text-zinc-500">Saldo: <span className="text-emerald-400 font-bold">R${(team.money / 1_000_000).toFixed(1)}M</span></span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
                {gameState.players.filter(p => p.teamId !== team.id && p.listedForSale).map(p => {
                  const pt = gameState.teams.find(t => t.id === p.teamId);
                  return (
                    <div key={p.id} className="bg-zinc-900 border border-zinc-800 rounded-xl p-3">
                      <div className="flex items-start gap-3 mb-3">
                        <span className={`inline-flex items-center justify-center w-9 h-9 rounded-lg font-bold text-xs border flex-shrink-0 ${posColor[p.position]}`}>
                          {p.position}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-sm truncate">{p.name}</div>
                          <div className="text-xs text-zinc-500 truncate">{pt?.name} · {p.age} anos</div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className="font-black font-mono text-sm text-amber-400">R${(p.value / 1_000_000).toFixed(1)}M</div>
                          <div className="text-xs text-zinc-500">Força <span className="text-zinc-300 font-bold">{p.strength}</span></div>
                        </div>
                      </div>
                      <button
                        onClick={() => { setNegotiatingPlayer(p); setOfferAmount(p.value); setNegotiationMessage(''); }}
                        className="w-full bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 font-bold py-1.5 rounded-lg text-xs transition-colors flex items-center justify-center gap-1"
                      >
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

        </main>
      </div>

      {/* ── Bottom Nav — só mobile ── */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-zinc-900 border-t border-zinc-800 z-20">
        <div className="flex overflow-x-auto">
          {NAV.map(({ key, icon, label }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex flex-col items-center gap-0.5 px-3 py-2.5 flex-1 min-w-[56px] transition-colors ${
                activeTab === key ? 'text-emerald-400' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <span className={`transition-transform ${activeTab === key ? 'scale-110' : ''}`}>{icon}</span>
              <span className="text-[10px] font-medium whitespace-nowrap">{label}</span>
            </button>
          ))}
        </div>
      </nav>

      {/* ── Modal de negociação ── */}
      {negotiatingPlayer && (
        <div className="fixed inset-0 bg-black/80 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-t-3xl sm:rounded-2xl p-6 w-full sm:max-w-md">
            <h3 className="text-lg font-bold mb-4">Negociar Transferência</h3>
            <div className="flex items-center gap-3 mb-5 bg-zinc-950 p-3 rounded-xl border border-zinc-800">
              <span className={`inline-flex items-center justify-center w-11 h-11 rounded-xl font-bold border text-sm ${posColor[negotiatingPlayer.position]}`}>
                {negotiatingPlayer.position}
              </span>
              <div className="min-w-0">
                <div className="font-bold">{negotiatingPlayer.name}</div>
                <div className="text-zinc-500 text-xs">
                  {gameState.teams.find(t => t.id === negotiatingPlayer.teamId)?.name} · {negotiatingPlayer.age}a · Força {negotiatingPlayer.strength}
                </div>
              </div>
              <div className="ml-auto text-right flex-shrink-0">
                <div className="text-xs text-zinc-500">Valor</div>
                <div className="font-bold text-amber-400 font-mono">R${(negotiatingPlayer.value / 1_000_000).toFixed(1)}M</div>
              </div>
            </div>
            <div className="mb-4">
              <label className="block text-xs font-bold text-zinc-500 uppercase tracking-wider mb-1.5">Sua oferta (R$)</label>
              <input
                type="number"
                value={offerAmount}
                onChange={e => setOfferAmount(Number(e.target.value))}
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white font-mono text-lg focus:outline-none focus:border-emerald-500 transition-colors"
              />
            </div>
            {negotiationMessage && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">{negotiationMessage}</div>
            )}
            <div className="flex gap-3">
              <button onClick={() => setNegotiatingPlayer(null)} className="flex-1 py-3 rounded-xl font-bold bg-zinc-800 hover:bg-zinc-700 text-sm transition-colors">Cancelar</button>
              <button onClick={submitOffer} className="flex-1 py-3 rounded-xl font-bold bg-emerald-500 hover:bg-emerald-400 text-zinc-950 text-sm transition-colors">Fazer Oferta</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}