import React, { useReducer, useEffect, useMemo, useState, useCallback, useRef } from 'react';
import {
  GameState, Player, Team, Match, Formation, FORMATIONS, FORMATION_LABELS, FORMATION_MODIFIERS,
  Position, ATTR_LABELS, ATTR_GROUPS, PlayerAttributes, PRIMARY_ATTRS,
  StaffRole, STAFF_INFO, Specialization, SPEC_INFO,
  ACADEMY_INFO, CUP_ROUND_LABELS, TRANSFER_WINDOW_ROUNDS, TOTAL_SEASON_ROUNDS,
  MatchReport, CupRound, SetPieceType,
} from './types';
import { gameReducer } from './gameReducer';
import { generateInitialState } from './data';
import { getEffectiveStrength, computeOverall, getBestLineup } from './engine';
import LiveMatchDay from './LiveMatchDay';
import {
  ChevronRight, ChevronLeft, ArrowLeft,
  Trophy, Star, Zap, Users, ShoppingCart, Wallet, Building2,
  Shield, Swords, Dumbbell, Calendar, Newspaper, Search,
  Play, TrendingUp, TrendingDown, Minus, Heart, AlertTriangle,
  X, Check, ChevronDown, Medal, Target, GraduationCap,
  UserCog, Gamepad2, AlertCircle, CheckCircle, Info,
} from 'lucide-react';

// ═══════════════════════════════════════════════════════════════════════════════
// TOAST SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════

type ToastType = 'error' | 'success' | 'info';

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

let toastCounter = 0;

function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showToast = useCallback((message: string, type: ToastType = 'error') => {
    const id = ++toastCounter;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return { toasts, showToast, dismissToast };
}

function ToastContainer({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-20 left-0 right-0 z-[100] flex flex-col items-center gap-2 px-4 pointer-events-none">
      {toasts.map(t => {
        const styles: Record<ToastType, string> = {
          error:   'bg-red-500/90 border-red-400/50 text-white',
          success: 'bg-emerald-500/90 border-emerald-400/50 text-white',
          info:    'bg-zinc-700/90 border-zinc-600/50 text-zinc-100',
        };
        const Icon = t.type === 'error' ? AlertCircle : t.type === 'success' ? CheckCircle : Info;
        return (
          <div
            key={t.id}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border shadow-lg text-sm font-bold pointer-events-auto max-w-sm w-full animate-in slide-in-from-bottom ${styles[t.type]}`}
          >
            <Icon size={15} className="flex-shrink-0" />
            <span className="flex-1">{t.message}</span>
            <button onClick={() => onDismiss(t.id)} className="opacity-60 hover:opacity-100 ml-1">
              <X size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════════════════════════════════════

const fmt = (n: number) => {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'K';
  return n.toLocaleString('pt-BR');
};
const posColor: Record<Position, string> = { G: 'text-amber-400', D: 'text-sky-400', M: 'text-emerald-400', A: 'text-rose-400' };
const posLabel: Record<Position, string> = { G: 'GOL', D: 'DEF', M: 'MEI', A: 'ATA' };

function StarRating({ value, max = 5 }: { value: number; max?: number }) {
  const full = Math.floor(value);
  const half = value - full >= 0.5;
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: max }, (_, i) => (
        <Star key={i} size={12} className={i < full ? 'text-amber-400 fill-amber-400' : half && i === full ? 'text-amber-400 fill-amber-400/50' : 'text-zinc-600'} />
      ))}
    </div>
  );
}
function EnergyBar({ value, size = 'md' }: { value: number; size?: 'sm' | 'md' }) {
  const color = value > 65 ? 'bg-emerald-500' : value > 35 ? 'bg-amber-500' : 'bg-red-500';
  const h = size === 'sm' ? 'h-1.5' : 'h-2.5';
  return (<div className={`w-full ${h} bg-zinc-700 rounded-full overflow-hidden`}><div className={`${h} ${color} rounded-full transition-all`} style={{ width: `${value}%` }} /></div>);
}
function FormBadge({ streak }: { streak: number }) {
  if (streak >= 2) return <TrendingUp size={12} className="text-emerald-400" />;
  if (streak <= -2) return <TrendingDown size={12} className="text-red-400" />;
  return <Minus size={12} className="text-zinc-500" />;
}
function TeamCrest({ team, size = 32 }: { team: Team; size?: number }) {
  return (
    <div className="rounded-full flex items-center justify-center font-black text-white shadow-lg flex-shrink-0"
      style={{ backgroundColor: team.color, width: size, height: size, fontSize: size * 0.38 }}>
      {team.name.charAt(0)}
    </div>
  );
}
function SectionRating({ label, value }: { label: string; value: number }) {
  return (<div className="text-center"><div className="text-[10px] text-zinc-400 uppercase tracking-wider">{label}</div><div className="text-lg font-black">{value}</div></div>);
}

type Section = null | 'squad' | 'match' | 'training' | 'calendar' | 'table' | 'cup' | 'transfers' | 'finances' | 'stadium' | 'staff' | 'academy' | 'objectives' | 'history' | 'manager';

// ═══════════════════════════════════════════════════════════════════════════════
// APP
// ═══════════════════════════════════════════════════════════════════════════════

export default function App() {
  const saved = useMemo(() => { try { const d = localStorage.getItem('brasmanager_save'); return d ? JSON.parse(d) : null; } catch { return null; } }, []);
  const [state, dispatch] = useReducer(gameReducer, saved, s => s);
  const [section, setSection] = useState<Section>(null);
  const [showMatchDay, setShowMatchDay] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<string | null>(null);
  const [offerModal, setOfferModal] = useState<{ playerId: string; asking: number } | null>(null);
  const [offerAmount, setOfferAmount] = useState(0);
  const [reportModal, setReportModal] = useState(false);
  const [offseasonModal, setOffseasonModal] = useState(false);
  const { toasts, showToast, dismissToast } = useToast();

  // ── Save com debounce ──────────────────────────────────────────────────────
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!state) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      try { localStorage.setItem('brasmanager_save', JSON.stringify(state)); }
      catch (e) { console.warn('Falha ao salvar:', e); }
    }, 500);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [state]);

  const userTeam = state?.teams.find((t: Team) => t.id === state.userTeamId) ?? null;
  const userPlayers = useMemo(() =>
    state ? state.players
      .filter((p: Player) => p.teamId === state.userTeamId)
      .sort((a: Player, b: Player) => {
        const o: Record<Position, number> = { G: 0, D: 1, M: 2, A: 3 };
        return o[a.position] - o[b.position] || b.strength - a.strength;
      }) : [],
    [state?.players, state?.userTeamId]);

  const standings = useMemo(() => {
    if (!state || !userTeam) return [];
    const lt = state.teams.filter((t: Team) => t.league === userTeam.league);
    const tb = lt.map((t: Team) => ({ ...t, pts: 0, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0 }));
    state.matches.filter((m: Match) => m.played && m.league === userTeam.league).forEach((m: Match) => {
      const h = tb.find((t: any) => t.id === m.homeTeamId), a = tb.find((t: any) => t.id === m.awayTeamId);
      if (!h || !a) return; h.p++; a.p++; h.gf += m.homeScore; h.ga += m.awayScore; a.gf += m.awayScore; a.ga += m.homeScore;
      if (m.homeScore > m.awayScore) { h.pts += 3; h.w++; a.l++; } else if (m.homeScore < m.awayScore) { a.pts += 3; a.w++; h.l++; } else { h.pts++; a.pts++; h.d++; a.d++; }
    });
    tb.forEach((t: any) => (t.gd = t.gf - t.ga));
    return tb.sort((a: any, b: any) => b.pts - a.pts || b.w - a.w || b.gd - a.gd || b.gf - a.gf);
  }, [state?.matches, state?.teams, userTeam?.league]);

  const currentRoundMatches = useMemo(() =>
    state ? state.matches.filter((m: Match) => m.round === state.currentRound && m.league === userTeam?.league) : [],
    [state?.matches, state?.currentRound, userTeam?.league]);

  const userPosition = standings.findIndex((t: any) => t.id === state?.userTeamId) + 1;

  const teamStats = useMemo(() => {
    if (!userPlayers.length) return { def: 0, mei: 0, ata: 0, energy: 0, stars: 0, ovr: 0 };
    const byPos = (pos: Position) => { const ps = userPlayers.filter((p: Player) => p.position === pos); return ps.length > 0 ? Math.round(ps.reduce((s: number, p: Player) => s + p.strength, 0) / ps.length) : 0; };
    const avgE = Math.round(userPlayers.reduce((s: number, p: Player) => s + p.energy, 0) / userPlayers.length);
    const avgS = Math.round(userPlayers.reduce((s: number, p: Player) => s + p.strength, 0) / userPlayers.length);
    return { def: byPos('D'), mei: byPos('M'), ata: byPos('A'), energy: avgE, stars: Math.min(5, avgS / 18), ovr: avgS };
  }, [userPlayers]);

  const nextMatch = useMemo(() => {
    if (!state || !userTeam) return null;
    const m = currentRoundMatches.find((m: Match) => m.homeTeamId === state.userTeamId || m.awayTeamId === state.userTeamId);
    if (!m) return null;
    const isHome = m.homeTeamId === state.userTeamId;
    const oppId = isHome ? m.awayTeamId : m.homeTeamId;
    const opp = state.teams.find((t: Team) => t.id === oppId)!;
    const oppP = state.players.filter((p: Player) => p.teamId === oppId);
    const oppByPos = (pos: Position) => { const ps = oppP.filter((p: Player) => p.position === pos); return ps.length > 0 ? Math.round(ps.reduce((s: number, p: Player) => s + p.strength, 0) / ps.length) : 0; };
    const oppAvg = oppP.length > 0 ? Math.round(oppP.reduce((s: number, p: Player) => s + p.strength, 0) / oppP.length) : 50;
    return { match: m, isHome, opp, oppDef: oppByPos('D'), oppMei: oppByPos('M'), oppAta: oppByPos('A'), oppStars: Math.min(5, oppAvg / 18) };
  }, [state, userTeam, currentRoundMatches]);

  const recentResults = useMemo(() => {
    if (!state) return [];
    return state.matches
      .filter((m: Match) => m.played && (m.homeTeamId === state.userTeamId || m.awayTeamId === state.userTeamId))
      .sort((a: Match, b: Match) => b.round - a.round).slice(0, 5)
      .map((m: Match) => {
        const isHome = m.homeTeamId === state.userTeamId;
        const us = isHome ? m.homeScore : m.awayScore;
        const os = isHome ? m.awayScore : m.homeScore;
        return { ...m, result: us > os ? 'W' : us < os ? 'L' : 'D', opp: state.teams.find((t: Team) => t.id === (isHome ? m.awayTeamId : m.homeTeamId))!, isHome, userScore: us, oppScore: os };
      });
  }, [state?.matches]);

  const newsFeed = useMemo(() => {
    if (!state) return [];
    const news: { text: string; type: 'transfer' | 'injury' | 'general' }[] = [];
    state.players.filter((p: Player) => p.teamId === state.userTeamId && p.injuryWeeksLeft > 0).forEach((p: Player) => { news.push({ text: `${p.name} lesionado (${p.injuryWeeksLeft}r)`, type: 'injury' }); });
    if (news.length === 0) news.push({ text: 'Nenhuma notícia recente', type: 'general' });
    return news.slice(0, 5);
  }, [state?.currentRound, state?.players]);

  const startGame = (teamId: string) => {
    const base = generateInitialState();
    const gs: GameState = { ...base, userTeamId: teamId, userLineup: [], formation: '4-4-2' as Formation, staff: {}, season: 1, phase: 'season', lastSeasonSummary: null };
    gs.userLineup = getBestLineup(gs.players.filter((p: Player) => p.teamId === teamId), '4-4-2').map((p: Player) => p.id);
    dispatch({ type: 'INIT_GAME', payload: gs });
  };

  const handleMatchDayComplete = useCallback((updatedMatches: Match[], playerUpdates: Partial<Player>[], report: MatchReport) => {
    setShowMatchDay(false);
    dispatch({ type: 'MATCH_DAY_COMPLETE', payload: { updatedMatches, playerUpdates, report } });
    setReportModal(true);
  }, []);

  // ══════════════════════════════════════════════════════════════════════════
  // AÇÕES GUARDADAS — checa pré-condição antes de fazer dispatch
  // ══════════════════════════════════════════════════════════════════════════

  const handleTrain = useCallback((playerId: string) => {
    if (!state || !userTeam) return;
    const cost = 50_000;
    if (userTeam.money < cost) {
      showToast(`Saldo insuficiente. Necessário: R$ ${fmt(cost)}`, 'error');
      return;
    }
    const player = state.players.find((p: Player) => p.id === playerId);
    if (player && player.strength >= player.potential) {
      showToast(`${player.name} já atingiu seu potencial máximo.`, 'info');
      return;
    }
    dispatch({ type: 'TRAIN_PLAYER', payload: { playerId } });
    showToast('Sessão de treino concluída! ✓', 'success');
  }, [state, userTeam, showToast]);

  const handleHireStaff = useCallback((role: StaffRole) => {
    if (!state || !userTeam) return;
    const currentLevel = state.staff[role] ?? 0;
    if (currentLevel >= 3) {
      showToast('Nível máximo já atingido.', 'info');
      return;
    }
    const cost = STAFF_INFO[role].hireCost[currentLevel];
    if (userTeam.money < cost) {
      showToast(`Saldo insuficiente. Necessário: R$ ${fmt(cost)}`, 'error');
      return;
    }
    dispatch({ type: 'HIRE_STAFF', payload: { role } });
    showToast(`${STAFF_INFO[role].label} contratado! ✓`, 'success');
  }, [state, userTeam, showToast]);

  const handleUpgradeStadium = useCallback(() => {
    if (!state || !userTeam) return;
    const cost = userTeam.stadium.level * 2_000_000;
    if (userTeam.money < cost) {
      showToast(`Saldo insuficiente. Necessário: R$ ${fmt(cost)}`, 'error');
      return;
    }
    dispatch({ type: 'UPGRADE_STADIUM' });
    showToast('Estádio ampliado com sucesso! ✓', 'success');
  }, [state, userTeam, showToast]);

  const handleUpgradeAcademy = useCallback(() => {
    if (!state || !userTeam) return;
    const nextLevel = userTeam.academyLevel + 1;
    if (nextLevel >= ACADEMY_INFO.length) {
      showToast('Nível máximo de academia já atingido.', 'info');
      return;
    }
    const cost = ACADEMY_INFO[nextLevel].cost;
    if (userTeam.money < cost) {
      showToast(`Saldo insuficiente. Necessário: R$ ${fmt(cost)}`, 'error');
      return;
    }
    dispatch({ type: 'UPGRADE_ACADEMY' });
    showToast(`Academia atualizada para ${ACADEMY_INFO[nextLevel].label}! ✓`, 'success');
  }, [state, userTeam, showToast]);

  const handleToggleLineup = useCallback((playerId: string) => {
    if (!state) return;
    const player = state.players.find((p: Player) => p.id === playerId);
    if (!player) return;
    if (player.redCard) { showToast(`${player.name} está suspenso.`, 'error'); return; }
    if (player.injuryWeeksLeft > 0) { showToast(`${player.name} está lesionado.`, 'error'); return; }

    if (!state.userLineup.includes(playerId)) {
      if (state.userLineup.length >= 11) {
        showToast('Elenco cheio. Remova um jogador primeiro.', 'error');
        return;
      }
      const slots = FORMATIONS[state.formation];
      const currentCount: Record<string, number> = { G: 0, D: 0, M: 0, A: 0 };
      for (const id of state.userLineup) {
        const p = state.players.find((pl: Player) => pl.id === id);
        if (p) currentCount[p.position]++;
      }
      if (currentCount[player.position] >= slots[player.position]) {
        showToast(`Vagas de ${posLabel[player.position]} preenchidas para ${state.formation}.`, 'error');
        return;
      }
    }
    dispatch({ type: 'TOGGLE_LINEUP_PLAYER', payload: { playerId } });
  }, [state, showToast]);

  const handleBuyPlayer = useCallback(() => {
    if (!offerModal || offerAmount <= 0 || !userTeam || !state) return;
    if (!TRANSFER_WINDOW_ROUNDS.has(state.currentRound)) {
      showToast('Janela de transferências fechada.', 'error');
      return;
    }
    if (userTeam.money < offerAmount) {
      showToast('Saldo insuficiente para essa oferta.', 'error');
      return;
    }
    dispatch({ type: 'BUY_PLAYER', payload: { playerId: offerModal.playerId, amount: offerAmount } });
    showToast('Transferência concluída! ✓', 'success');
    setOfferModal(null);
  }, [offerModal, offerAmount, userTeam, state, showToast]);

  useEffect(() => { if (state?.phase === 'offseason' && state.lastSeasonSummary) setOffseasonModal(true); }, [state?.phase]);

  // ══════════════════════════════════════════════════════════════════════════
  // TEAM SELECT
  // ══════════════════════════════════════════════════════════════════════════

  if (!state) {
    const base = generateInitialState();
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans">
        <div className="bg-gradient-to-b from-emerald-900/40 to-zinc-950 px-4 py-8">
          <h1 className="text-3xl font-black text-center tracking-tight">BRASMANAGER</h1>
          <p className="text-zinc-400 text-center text-sm mt-1">Escolha seu clube</p>
        </div>
        <div className="px-3 pb-8">
          {[1, 2, 3].map(league => (
            <div key={league} className="mb-6">
              <div className="flex items-center gap-2 mb-3 px-1"><Trophy size={14} className="text-amber-400" /><span className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Série {league === 1 ? 'A' : league === 2 ? 'B' : 'C'}</span></div>
              <div className="grid grid-cols-2 gap-2">
                {base.teams.filter((t: Team) => t.league === league).map((t: Team) => (
                  <button key={t.id} onClick={() => startGame(t.id)} className="flex items-center gap-3 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-600 rounded-xl px-3 py-3 transition-all text-left group">
                    <TeamCrest team={t} size={36} />
                    <div className="min-w-0 flex-1"><div className="font-bold text-sm truncate group-hover:text-white">{t.name}</div><div className="text-[10px] text-zinc-500">R$ {fmt(t.money)}</div></div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // LIVE MATCH
  // ══════════════════════════════════════════════════════════════════════════

  if (showMatchDay && state.phase === 'season') {
    const um = currentRoundMatches.find((m: Match) => m.homeTeamId === state.userTeamId || m.awayTeamId === state.userTeamId);
    if (um && !um.played) return <LiveMatchDay gameState={state} matches={currentRoundMatches} userLineup={state.userLineup} onComplete={handleMatchDayComplete} />;
  }
  if (showMatchDay && state.pendingCupRound && state.cup) {
    const cm = state.cup.matches.find((m: any) => m.round === state.pendingCupRound && !m.played && (m.homeTeamId === state.userTeamId || m.awayTeamId === state.userTeamId));
    if (cm) return <LiveMatchDay gameState={state}
      matches={[{ id: cm.id, homeTeamId: cm.homeTeamId, awayTeamId: cm.awayTeamId, homeScore: 0, awayScore: 0, played: false, round: 0 }]}
      userLineup={state.userLineup}
      onComplete={(u, pu) => { setShowMatchDay(false); dispatch({ type: 'CUP_MATCH_COMPLETE', payload: { cupMatchId: cm.id, homeScore: u[0].homeScore, awayScore: u[0].awayScore, playerUpdates: pu } }); }}
      isCupMatch />;
  }

  if (!userTeam) return null;
  const isTransferWindow = TRANSFER_WINDOW_ROUNDS.has(state.currentRound);
  const leagueLabel = userTeam.league === 1 ? 'Série A' : userTeam.league === 2 ? 'Série B' : 'Série C';
  const canPlay = state.phase === 'season' && state.userLineup.length === 11;
  const hasPendingCup = !!state.pendingCupRound;
  const userMatchNotPlayed = nextMatch && !nextMatch.match.played;

  const DashCard = ({ title, icon: Icon, onClick, children, accent, badge }: { title: string; icon: React.ElementType; onClick: () => void; children: React.ReactNode; accent?: string; badge?: string | number }) => (
    <button onClick={onClick} className="bg-zinc-900/80 border border-zinc-800 hover:border-zinc-600 rounded-2xl p-4 text-left transition-all hover:bg-zinc-800/60 group relative overflow-hidden w-full">
      {accent && <div className="absolute top-0 left-0 right-0 h-0.5" style={{ backgroundColor: accent }} />}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2"><Icon size={15} className="text-zinc-400 group-hover:text-zinc-200" /><span className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider group-hover:text-zinc-200">{title}</span></div>
        <div className="flex items-center gap-1">{badge && <span className="bg-amber-500/20 text-amber-400 text-[9px] font-bold px-1.5 py-0.5 rounded-full">{badge}</span>}<ChevronRight size={14} className="text-zinc-600 group-hover:text-zinc-300" /></div>
      </div>
      <div className="text-zinc-100">{children}</div>
    </button>
  );

  const SectionHeader = ({ title, onBack }: { title: string; onBack: () => void }) => (
    <div className="sticky top-0 z-30 bg-zinc-950/95 backdrop-blur-md border-b border-zinc-800 px-4 py-3 flex items-center gap-3">
      <button onClick={onBack} className="p-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700"><ArrowLeft size={16} /></button>
      <span className="font-bold text-sm">{title}</span>
    </div>
  );

  // ── SQUAD ──────────────────────────────────────────────────────────────────
  if (section === 'squad') return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <SectionHeader title="Elenco" onBack={() => setSection(null)} />
      <div className="px-4 py-3 border-b border-zinc-800">
        <div className="flex items-center gap-2 mb-2"><Shield size={12} className="text-zinc-400" /><span className="text-[10px] text-zinc-400 font-bold uppercase">Formação</span></div>
        <div className="flex gap-1.5 flex-wrap">
          {(Object.keys(FORMATIONS) as Formation[]).map(f => (
            <button key={f} onClick={() => dispatch({ type: 'SET_FORMATION', payload: f })}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold ${state.formation === f ? 'bg-emerald-500 text-zinc-950' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}>{f}</button>
          ))}
        </div>
      </div>
      <div className="px-3 py-2 space-y-1.5 pb-20">
        {userPlayers.map((p: Player) => {
          const inLineup = state.userLineup.includes(p.id);
          const unavail = p.redCard || p.injuryWeeksLeft > 0;
          return (
            <div key={p.id} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 border transition-all
              ${inLineup ? 'bg-emerald-500/10 border-emerald-500/30' : unavail ? 'bg-red-500/5 border-red-500/20 opacity-60' : 'bg-zinc-900 border-zinc-800 hover:border-zinc-600'}`}>
              <button onClick={() => handleToggleLineup(p.id)}
                className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-black border-2
                  ${inLineup ? 'bg-emerald-500 border-emerald-500 text-zinc-950' : 'border-zinc-600 text-zinc-500 hover:border-zinc-400'}`}>
                {inLineup ? '✓' : ''}
              </button>
              <div className={`text-[10px] font-black ${posColor[p.position]} w-7`}>{posLabel[p.position]}</div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold truncate">{p.name}</div>
                <div className="flex items-center gap-2 text-[10px] text-zinc-500">
                  <span>{p.age}a</span><FormBadge streak={p.formStreak} />
                  {p.injuryWeeksLeft > 0 && <span className="text-red-400">🏥{p.injuryWeeksLeft}r</span>}
                  {p.redCard && <span className="text-red-400">🟥</span>}
                </div>
              </div>
              <div className="text-right"><div className="text-sm font-black">{p.strength}</div><div className="w-12"><EnergyBar value={p.energy} size="sm" /></div></div>
            </div>
          );
        })}
      </div>
      <div className="fixed bottom-0 left-0 right-0 bg-zinc-900/95 border-t border-zinc-800 px-4 py-3 flex items-center justify-between backdrop-blur-md">
        <span className="text-xs text-zinc-400">Escalados: <span className="text-white font-bold">{state.userLineup.length}/11</span></span>
        <button onClick={() => dispatch({ type: 'SET_FORMATION', payload: state.formation })} className="px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 text-xs font-bold hover:bg-zinc-700">Auto</button>
      </div>
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );

  // ── TABLE ──────────────────────────────────────────────────────────────────
  if (section === 'table') return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <SectionHeader title={`Classificação — ${leagueLabel}`} onBack={() => setSection(null)} />
      <div className="px-3 py-3">
        <div className="grid grid-cols-[auto_1fr_repeat(7,auto)] gap-x-2 gap-y-1 text-[10px] items-center">
          <div className="text-zinc-500 font-bold">#</div><div className="text-zinc-500 font-bold">Time</div>
          {['P', 'V', 'E', 'D', 'GP', 'SG', 'Pts'].map(h => <div key={h} className="text-zinc-500 font-bold text-center">{h}</div>)}
          {standings.map((t: any, i: number) => {
            const u = t.id === state.userTeamId;
            const zone = i < 2 ? 'border-l-2 border-emerald-500 pl-1' : i >= standings.length - 2 ? 'border-l-2 border-red-500 pl-1' : 'pl-1';
            return (<React.Fragment key={t.id}>
              <div className={`py-1.5 font-bold ${u ? 'text-emerald-400' : 'text-zinc-500'} ${zone}`}>{i + 1}</div>
              <div className={`py-1.5 font-bold truncate ${u ? 'text-emerald-400' : ''}`}>{t.name}</div>
              <div className="text-center py-1.5">{t.p}</div><div className="text-center py-1.5">{t.w}</div><div className="text-center py-1.5">{t.d}</div>
              <div className="text-center py-1.5">{t.l}</div><div className="text-center py-1.5">{t.gf}</div><div className="text-center py-1.5">{t.gd}</div>
              <div className={`text-center py-1.5 font-black ${u ? 'text-emerald-400' : ''}`}>{t.pts}</div>
            </React.Fragment>);
          })}
        </div>
        <div className="flex gap-4 mt-3 text-[9px] text-zinc-500">
          <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-emerald-500" />Acesso</span>
          <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-red-500" />Rebaixamento</span>
        </div>
      </div>
    </div>
  );

  // ── TRANSFERS ──────────────────────────────────────────────────────────────
  if (section === 'transfers') {
    const avail = state.players.filter((p: Player) => p.teamId !== state.userTeamId && p.listedForSale);
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100">
        <SectionHeader title="Transferências" onBack={() => setSection(null)} />
        {!isTransferWindow && <div className="mx-4 mt-3 bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 text-center"><AlertTriangle size={16} className="text-amber-400 mx-auto mb-1" /><div className="text-xs text-amber-400">Janela fechada</div><div className="text-[10px] text-zinc-500 mt-1">Rodadas 1-3 e 10-12</div></div>}
        <div className="px-3 py-3 space-y-2">
          {avail.slice(0, 30).map((p: Player) => {
            const st = state.teams.find((t: Team) => t.id === p.teamId)!;
            return (<div key={p.id} className="bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5 flex items-center gap-3">
              <div><div className={`text-[10px] font-black ${posColor[p.position]}`}>{posLabel[p.position]}</div><div className="text-sm font-bold">{p.strength}</div></div>
              <div className="flex-1 min-w-0"><div className="text-sm font-bold truncate">{p.name}</div><div className="text-[10px] text-zinc-500">{p.age}a · {st.name}</div></div>
              <div className="text-right"><div className="text-[10px] text-zinc-400">R$ {fmt(p.value)}</div>
                {isTransferWindow && <button onClick={() => { setOfferModal({ playerId: p.id, asking: p.value }); setOfferAmount(p.value); }} className="mt-1 px-2 py-1 rounded-lg bg-emerald-500/20 text-emerald-400 text-[10px] font-bold hover:bg-emerald-500/30">Negociar</button>}
              </div>
            </div>);
          })}
        </div>
        <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      </div>
    );
  }

  // ── FINANCES ──────────────────────────────────────────────────────────────
  if (section === 'finances') return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <SectionHeader title="Finanças" onBack={() => setSection(null)} />
      <div className="px-4 py-4">
        <div className="text-center mb-4">
          <div className="text-[10px] text-zinc-400 uppercase tracking-wider">Saldo</div>
          <div className={`text-3xl font-black ${userTeam.money >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>R$ {fmt(userTeam.money)}</div>
        </div>
        {(() => {
          const monthlySalary = userPlayers.reduce((s: number, p: Player) => s + p.salary, 0);
          return (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 mb-4 flex items-center justify-between">
              <div><div className="text-[10px] text-zinc-400 uppercase tracking-wider">Folha mensal estimada</div><div className="text-sm font-black text-red-400">− R$ {fmt(monthlySalary)}</div></div>
              <div><div className="text-[10px] text-zinc-400 uppercase tracking-wider">Saldo após folha</div><div className={`text-sm font-black ${userTeam.money - monthlySalary >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>R$ {fmt(userTeam.money - monthlySalary)}</div></div>
            </div>
          );
        })()}
        <div className="space-y-1">
          {[...userTeam.finances].reverse().slice(0, 20).map((f: any) => (
            <div key={f.id} className="flex items-center justify-between py-2 border-b border-zinc-800/50 text-xs">
              <div><div className="font-bold">{f.description}</div><div className="text-[10px] text-zinc-500">R{f.round}</div></div>
              <span className={f.type === 'income' ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>{f.type === 'income' ? '+' : '-'}R$ {fmt(f.amount)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  // ── TRAINING ──────────────────────────────────────────────────────────────
  if (section === 'training') return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <SectionHeader title="Treinamento" onBack={() => setSection(null)} />
      <div className="px-3 py-3 space-y-2">
        <div className="text-[10px] text-zinc-500 px-1 mb-1">Custo: R$ 50K/sessão{state.manager.specialization === 'desenvolvedor' ? ' · 2× eficiência' : ''}</div>
        {userPlayers.map((p: Player) => (
          <div key={p.id} className="bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2.5 flex items-center gap-3">
            <div className={`text-[10px] font-black ${posColor[p.position]} w-7`}>{posLabel[p.position]}</div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold truncate">{p.name}</div>
              <div className="flex items-center gap-2 text-[10px] text-zinc-500"><span>OVR {p.strength}</span><span>POT {p.potential}</span></div>
              <div className="w-full h-1 bg-zinc-700 rounded-full mt-1 overflow-hidden"><div className="h-full bg-sky-500 rounded-full" style={{ width: `${p.trainingProgress}%` }} /></div>
            </div>
            <button onClick={() => handleTrain(p.id)} disabled={p.strength >= p.potential}
              className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold flex-shrink-0 ${p.strength >= p.potential ? 'bg-zinc-800 text-zinc-600 cursor-not-allowed' : 'bg-sky-500/20 text-sky-400 hover:bg-sky-500/30'}`}>
              {p.strength >= p.potential ? 'Max' : 'Treinar'}
            </button>
          </div>
        ))}
      </div>
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );

  // ── CALENDAR ──────────────────────────────────────────────────────────────
  if (section === 'calendar') {
    const all = state.matches.filter((m: Match) => m.homeTeamId === state.userTeamId || m.awayTeamId === state.userTeamId).sort((a: Match, b: Match) => a.round - b.round);
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100">
        <SectionHeader title="Calendário" onBack={() => setSection(null)} />
        <div className="px-3 py-3 space-y-1">{all.map((m: Match) => {
          const isH = m.homeTeamId === state.userTeamId; const opp = state.teams.find((t: Team) => t.id === (isH ? m.awayTeamId : m.homeTeamId))!;
          const r = m.played ? ((isH ? m.homeScore : m.awayScore) > (isH ? m.awayScore : m.homeScore) ? 'V' : (isH ? m.homeScore : m.awayScore) < (isH ? m.awayScore : m.homeScore) ? 'D' : 'E') : null;
          const rc = r === 'V' ? 'bg-emerald-500' : r === 'D' ? 'bg-red-500' : r === 'E' ? 'bg-zinc-500' : 'bg-zinc-700';
          const cur = m.round === state.currentRound;
          return (<div key={m.id} className={`flex items-center gap-3 px-3 py-2 rounded-xl text-xs ${cur ? 'bg-zinc-800 border border-zinc-600' : 'border border-transparent'}`}>
            <span className="text-zinc-500 font-mono w-6 text-right">S{m.round}</span>
            <TeamCrest team={opp} size={22} />
            <div className="flex-1 min-w-0"><span className="font-bold truncate">{opp.name}</span><span className="text-zinc-500 ml-2">{isH ? '(C)' : '(F)'}</span></div>
            {m.played ? <div className="flex items-center gap-2"><span className="font-mono font-bold">{isH ? m.homeScore : m.awayScore}-{isH ? m.awayScore : m.homeScore}</span>
              <div className={`w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-black ${rc}`}>{r}</div></div> : <span className="text-zinc-500">—</span>}
          </div>);
        })}</div>
      </div>
    );
  }

  // ── CUP ────────────────────────────────────────────────────────────────────
  if (section === 'cup') {
    if (!state.cup) return <div className="min-h-screen bg-zinc-950 text-zinc-100"><SectionHeader title="Copa" onBack={() => setSection(null)} /><div className="p-4 text-center text-zinc-500">Sem copa</div></div>;
    const rounds: CupRound[] = ['r16', 'qf', 'sf', 'final'];
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100">
        <SectionHeader title={`Copa — ${state.cup.userCupResult}`} onBack={() => setSection(null)} />
        <div className="px-3 py-3 space-y-4">{rounds.map(round => {
          const ms = state.cup!.matches.filter((m: any) => m.round === round); if (ms.length === 0) return null;
          return (<div key={round}><div className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2 px-1">{CUP_ROUND_LABELS[round]}</div>
            <div className="space-y-1">{ms.map((m: any) => {
              const h = state.teams.find((t: Team) => t.id === m.homeTeamId)!; const a = state.teams.find((t: Team) => t.id === m.awayTeamId)!;
              const u = m.homeTeamId === state.userTeamId || m.awayTeamId === state.userTeamId;
              return (<div key={m.id} className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs ${u ? 'bg-emerald-500/10 border border-emerald-500/30' : 'bg-zinc-900 border border-zinc-800'}`}>
                <TeamCrest team={h} size={20} /><span className="flex-1 font-bold truncate">{h.name}</span>
                <span className="font-mono font-bold">{m.played ? `${m.homeScore}-${m.awayScore}` : 'vs'}</span>
                <span className="flex-1 font-bold truncate text-right">{a.name}</span><TeamCrest team={a} size={20} />
              </div>);
            })}</div></div>);
        })}</div>
      </div>
    );
  }

  // ── STAFF ──────────────────────────────────────────────────────────────────
  if (section === 'staff') return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <SectionHeader title="Comissão Técnica" onBack={() => setSection(null)} />
      <div className="px-3 py-3 space-y-3">{(Object.keys(STAFF_INFO) as StaffRole[]).map(role => {
        const info = STAFF_INFO[role]; const lv = state.staff[role] ?? 0; const can = lv < 3; const cost = can ? info.hireCost[lv] : 0;
        const affordable = userTeam.money >= cost;
        return (<div key={role} className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3">
          <div className="flex items-center justify-between mb-1"><span className="font-bold text-sm">{info.label}</span><span className="text-[10px] text-zinc-400">Nv {lv}/3</span></div>
          <div className="text-[10px] text-zinc-500 mb-2">{info.desc}</div>
          {lv > 0 && <div className="text-[10px] text-emerald-400 mb-2">Efeito: {info.effect[lv - 1]}</div>}
          {can && (
            <button onClick={() => handleHireStaff(role)}
              className={`w-full py-2 rounded-lg text-xs font-bold ${affordable ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30' : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'}`}>
              Contratar Nv{lv + 1} — R$ {fmt(cost)} {!affordable && '(sem saldo)'}
            </button>
          )}
        </div>);
      })}</div>
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );

  // ── OBJECTIVES ────────────────────────────────────────────────────────────
  if (section === 'objectives') return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <SectionHeader title="Objetivos" onBack={() => setSection(null)} />
      <div className="px-3 py-3 space-y-2">{state.objectives.map((o: any) => (
        <div key={o.id} className={`bg-zinc-900 border rounded-xl px-4 py-3 ${o.achieved === true ? 'border-emerald-500/30' : o.achieved === false ? 'border-red-500/30' : 'border-zinc-800'}`}>
          <div className="flex items-center gap-2 mb-1">{o.achieved === true ? <Check size={14} className="text-emerald-400" /> : o.achieved === false ? <X size={14} className="text-red-400" /> : <Target size={14} className="text-amber-400" />}<span className="font-bold text-sm">{o.description}</span></div>
          <div className="text-[10px] text-zinc-500">Prêmio: R$ {fmt(o.rewardMoney)} + {o.rewardRep} rep</div>
        </div>
      ))}</div>
    </div>
  );

  // ── HISTORY ───────────────────────────────────────────────────────────────
  if (section === 'history') return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <SectionHeader title="Histórico" onBack={() => setSection(null)} />
      <div className="px-3 py-3 space-y-2">
        {state.seasonHistory.length === 0 && <div className="text-center text-zinc-500 py-8 text-sm">1ª temporada</div>}
        {[...state.seasonHistory].reverse().map((r: any) => (
          <div key={r.season} className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3">
            <div className="flex items-center justify-between mb-1"><span className="font-bold">Temp {r.season}</span><span className="text-[10px] text-zinc-400">Série {r.league === 1 ? 'A' : r.league === 2 ? 'B' : 'C'}</span></div>
            <div className="flex items-center gap-3 text-xs"><span>{r.position}º</span><span className="text-zinc-500">{r.wins}V {r.draws}E {r.losses}D</span>{r.champion && <span>🏆</span>}{r.promoted && <span className="text-emerald-400">⬆️</span>}{r.relegated && <span className="text-red-400">⬇️</span>}</div>
            <div className="text-[10px] text-zinc-500 mt-1">Copa: {r.cupResult} · Obj: {r.objectivesAchieved}/{r.objectivesTotal}</div>
          </div>
        ))}
      </div>
    </div>
  );

  // ── STADIUM ───────────────────────────────────────────────────────────────
  if (section === 'stadium') {
    const cost = userTeam.stadium.level * 2_000_000;
    const affordable = userTeam.money >= cost;
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100">
        <SectionHeader title="Estádio" onBack={() => setSection(null)} />
        <div className="px-4 py-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 text-center mb-4">
            <Building2 size={40} className="text-zinc-400 mx-auto mb-3" /><div className="text-xl font-black">Nível {userTeam.stadium.level}</div>
            <div className="text-sm text-zinc-400 mt-1">{userTeam.stadium.capacity.toLocaleString('pt-BR')} lugares</div>
            <div className="grid grid-cols-2 gap-3 mt-4 text-xs">
              <div><div className="text-zinc-500">Ingresso</div><div className="font-bold">R$ {userTeam.stadium.ticketPrice}</div></div>
              <div><div className="text-zinc-500">Manutenção</div><div className="font-bold text-red-400">R$ {fmt(userTeam.stadium.maintenanceCost)}/t</div></div>
            </div>
          </div>
          {!affordable && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2.5 mb-3 text-xs text-red-400">
              <AlertCircle size={14} /><span>Saldo insuficiente — faltam R$ {fmt(cost - userTeam.money)}</span>
            </div>
          )}
          <button onClick={handleUpgradeStadium} disabled={!affordable}
            className={`w-full py-3 rounded-xl font-bold text-sm ${affordable ? 'bg-emerald-500 text-zinc-950 hover:bg-emerald-400' : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'}`}>
            Ampliar — R$ {fmt(cost)}
          </button>
        </div>
        <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      </div>
    );
  }

  // ── ACADEMY ───────────────────────────────────────────────────────────────
  if (section === 'academy') {
    const lv = userTeam.academyLevel; const nl = lv + 1; const can = nl < ACADEMY_INFO.length; const cost = can ? ACADEMY_INFO[nl].cost : 0;
    const affordable = can && userTeam.money >= cost;
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100">
        <SectionHeader title="Academia" onBack={() => setSection(null)} />
        <div className="px-4 py-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 text-center mb-4">
            <GraduationCap size={40} className="text-zinc-400 mx-auto mb-3" /><div className="text-xl font-black">{ACADEMY_INFO[lv].label}</div><div className="text-sm text-zinc-400 mt-1">{ACADEMY_INFO[lv].desc}</div>
          </div>
          {can && !affordable && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2.5 mb-3 text-xs text-red-400">
              <AlertCircle size={14} /><span>Saldo insuficiente — faltam R$ {fmt(cost - userTeam.money)}</span>
            </div>
          )}
          {can && <button onClick={handleUpgradeAcademy} disabled={!affordable}
            className={`w-full py-3 rounded-xl font-bold text-sm ${affordable ? 'bg-emerald-500 text-zinc-950 hover:bg-emerald-400' : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'}`}>
            Upgrade — R$ {fmt(cost)}
          </button>}
        </div>
        <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      </div>
    );
  }

  // ── MANAGER ───────────────────────────────────────────────────────────────
  if (section === 'manager') return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <SectionHeader title="Técnico" onBack={() => setSection(null)} />
      <div className="px-4 py-4">
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 text-center mb-4">
          <UserCog size={40} className="text-zinc-400 mx-auto mb-3" />
          <div className="text-xl font-black">{state.manager.name}</div><div className="text-sm text-zinc-400">{state.manager.nationality}</div>
          <div className="grid grid-cols-4 gap-2 mt-4 text-xs">
            <div><div className="text-zinc-500">Jogos</div><div className="font-bold">{state.manager.matchesManaged}</div></div>
            <div><div className="text-zinc-500">V</div><div className="font-bold text-emerald-400">{state.manager.wins}</div></div>
            <div><div className="text-zinc-500">E</div><div className="font-bold">{state.manager.draws}</div></div>
            <div><div className="text-zinc-500">D</div><div className="font-bold text-red-400">{state.manager.losses}</div></div>
          </div>
          <div className="text-sm mt-3">Rep: <span className="font-bold">{state.manager.reputation}</span> · Títulos: <span className="font-bold text-amber-400">{state.manager.titles}</span></div>
        </div>
        <div className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Especialização</div>
        <div className="grid grid-cols-2 gap-2 mb-4">{(Object.keys(SPEC_INFO) as Specialization[]).map(spec => {
          const info = SPEC_INFO[spec]; const active = state.manager.specialization === spec;
          return (<button key={spec} onClick={() => dispatch({ type: 'SET_SPECIALIZATION', payload: active ? null : spec })}
            className={`px-3 py-2.5 rounded-xl text-xs font-bold border ${active ? `${info.color} border-current` : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-600'}`}>
            <div>{info.label}</div><div className="text-[10px] opacity-70 mt-0.5">{info.desc}</div>
          </button>);
        })}</div>
      </div>
    </div>
  );

  // ══════════════════════════════════════════════════════════════════════════
  // MAIN DASHBOARD
  // ══════════════════════════════════════════════════════════════════════════

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans">
      {/* Header */}
      <div className="sticky top-0 z-50" style={{ backgroundColor: userTeam.color }}>
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <TeamCrest team={userTeam} size={40} />
            <div><div className="font-black text-lg text-white leading-tight">{userTeam.name}</div><div className="text-[10px] text-white/60">Temporada {state.season} · Rodada {state.currentRound}/{TOTAL_SEASON_ROUNDS}</div></div>
          </div>
          {(canPlay && (userMatchNotPlayed || hasPendingCup))
            ? <button onClick={() => setShowMatchDay(true)} className="flex items-center gap-2 bg-white text-zinc-950 font-black px-5 py-2.5 rounded-xl text-sm shadow-lg hover:bg-zinc-100 active:scale-95">CONTINUAR <Play size={16} fill="currentColor" /></button>
            : state.phase === 'offseason'
              ? <button onClick={() => { setOffseasonModal(false); dispatch({ type: 'START_NEW_SEASON' }); }} className="flex items-center gap-2 bg-white text-zinc-950 font-black px-5 py-2.5 rounded-xl text-sm shadow-lg">PRÓXIMA <ChevronRight size={16} /></button>
              : null}
        </div>
        <div className="flex items-center justify-between px-4 py-1.5 bg-black/20 text-[10px] text-white/80">
          <span>💰 R$ {fmt(userTeam.money)}</span><span>📊 {userPosition}º {leagueLabel}</span><span>⭐ Rep {userTeam.reputation}</span><span>😊 {userTeam.fanSatisfaction}%</span>
          {isTransferWindow && <span className="text-emerald-300 font-bold">🔄 Janela</span>}
        </div>
      </div>

      {/* Cards */}
      <div className="px-3 py-3 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {nextMatch && <DashCard title="Próximo Jogo" icon={Swords} onClick={() => setSection('calendar')} accent={userTeam.color}>
            <div className="text-[10px] text-zinc-400 mb-1">Rodada {state.currentRound} de {TOTAL_SEASON_ROUNDS}</div>
            <div className="flex items-center gap-2 mb-2"><TeamCrest team={nextMatch.opp} size={32} /><div>
              <div className="font-bold">{nextMatch.opp.name} <span className="text-zinc-500 text-[10px]">({nextMatch.isHome ? 'C' : 'F'})</span></div>
              <StarRating value={nextMatch.oppStars} /></div></div>
            <div className="flex gap-3 text-[10px]"><SectionRating label="DEF" value={nextMatch.oppDef} /><SectionRating label="MEI" value={nextMatch.oppMei} /><SectionRating label="ATA" value={nextMatch.oppAta} /></div>
          </DashCard>}
          <DashCard title="Gestão do Time" icon={Shield} onClick={() => setSection('squad')} accent="#22c55e">
            <div className="mb-2"><div className="flex items-center justify-between text-[10px] mb-1"><span className="text-zinc-400">{state.formation} — Energia: {teamStats.energy}%</span></div><EnergyBar value={teamStats.energy} /></div>
            <div className="flex gap-3 text-[10px] mb-2"><SectionRating label="DEF" value={teamStats.def} /><SectionRating label="MEI" value={teamStats.mei} /><SectionRating label="ATA" value={teamStats.ata} /></div>
            <StarRating value={teamStats.stars} />
          </DashCard>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <DashCard title="Treinamento" icon={Dumbbell} onClick={() => setSection('training')}>
            <StarRating value={Math.min(5, (state.staff.preparador ?? 0) + 1.5)} />
            {(() => { const b = userPlayers.sort((a: Player, b: Player) => b.trainingProgress - a.trainingProgress)[0]; return b ? <div className="text-[10px] text-zinc-500 mt-1">Próx: <span className="text-zinc-300 font-bold">{b.name.split(' ')[0]}</span> <span className="text-emerald-400">{b.strength}</span></div> : null; })()}
          </DashCard>
          <DashCard title="Classificação" icon={Trophy} onClick={() => setSection('table')} badge={`${userPosition}º`}>
            <div className="space-y-0.5">{standings.slice(0, 4).map((t: any, i: number) => (
              <div key={t.id} className={`flex items-center justify-between text-[10px] ${t.id === state.userTeamId ? 'text-emerald-400 font-bold' : 'text-zinc-400'}`}>
                <span className="truncate">{i + 1}. {t.name}</span><span className="font-mono">{t.pts}</span></div>
            ))}</div>
          </DashCard>
          <DashCard title="Objetivos" icon={Target} onClick={() => setSection('objectives')} badge={state.objectives.filter((o: any) => o.achieved === null).length}>
            <div className="space-y-1">{state.objectives.slice(0, 2).map((o: any) => (
              <div key={o.id} className="text-[10px] flex items-center gap-1">
                {o.achieved === true ? <Check size={10} className="text-emerald-400" /> : o.achieved === false ? <X size={10} className="text-red-400" /> : <Target size={10} className="text-amber-400" />}
                <span className={o.achieved === true ? 'text-emerald-400' : o.achieved === false ? 'text-red-400 line-through' : 'text-zinc-300'}>{o.description}</span>
              </div>
            ))}</div>
          </DashCard>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <DashCard title="Calendário" icon={Calendar} onClick={() => setSection('calendar')}>
            <div className="space-y-0.5">{recentResults.slice(0, 4).map((r: any) => (
              <div key={r.id} className="flex items-center gap-2 text-[10px]">
                <span className="text-zinc-500 font-mono w-5">S{r.round}</span><TeamCrest team={r.opp} size={14} />
                <span className="flex-1 truncate">{r.opp.name}</span>
                <span className={`font-bold ${r.result === 'W' ? 'text-emerald-400' : r.result === 'L' ? 'text-red-400' : 'text-zinc-400'}`}>{r.userScore}-{r.oppScore}</span>
                <span className={`w-4 h-4 rounded-full text-[8px] font-black flex items-center justify-center ${r.result === 'W' ? 'bg-emerald-500' : r.result === 'L' ? 'bg-red-500' : 'bg-zinc-600'} text-white`}>{r.result}</span>
              </div>
            ))}{recentResults.length === 0 && <div className="text-[10px] text-zinc-500">Sem resultados</div>}</div>
          </DashCard>
          <DashCard title="Transferências" icon={ShoppingCart} onClick={() => setSection('transfers')} badge={isTransferWindow ? 'Aberta' : undefined}>
            <div className="flex gap-4">
              <div><div className="text-[10px] text-zinc-400">Entradas</div><div className="text-lg font-black text-emerald-400">{userTeam.finances.filter((f: any) => f.category === 'transfer' && f.type === 'expense').length}</div></div>
              <div><div className="text-[10px] text-zinc-400">Saídas</div><div className="text-lg font-black text-red-400">{userTeam.finances.filter((f: any) => f.category === 'transfer' && f.type === 'income').length}</div></div>
            </div>
          </DashCard>
          <DashCard title="Notícias" icon={Newspaper} onClick={() => { }}>
            <div className="space-y-1">{newsFeed.slice(0, 3).map((n: any, i: number) => (
              <div key={i} className="text-[10px] flex items-start gap-1.5">
                <span>{n.type === 'transfer' ? '🔄' : n.type === 'injury' ? '🏥' : '📰'}</span>
                <span className="text-zinc-300">{n.text}</span>
              </div>
            ))}</div>
          </DashCard>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <DashCard title="Finanças" icon={Wallet} onClick={() => setSection('finances')}><div className={`text-lg font-black ${userTeam.money >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>R$ {fmt(userTeam.money)}</div></DashCard>
          <DashCard title="Copa" icon={Medal} onClick={() => setSection('cup')} badge={hasPendingCup ? '!' : undefined}><div className="text-xs">{state.cup ? <span className={state.cup.winnerId === state.userTeamId ? 'text-amber-400 font-bold' : ''}>{state.cup.userCupResult}</span> : 'Sem copa'}</div></DashCard>
          <DashCard title="Estádio" icon={Building2} onClick={() => setSection('stadium')}><div className="text-xs">Nv {userTeam.stadium.level} · {fmt(userTeam.stadium.capacity)} lug</div></DashCard>
          <DashCard title="Staff" icon={Users} onClick={() => setSection('staff')}><div className="text-xs">{Object.values(state.staff).filter((v: any) => v && v > 0).length}/{Object.keys(STAFF_INFO).length}</div></DashCard>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <DashCard title="Academia" icon={GraduationCap} onClick={() => setSection('academy')}><div className="text-xs">{ACADEMY_INFO[userTeam.academyLevel].label}</div></DashCard>
          <DashCard title="Histórico" icon={Trophy} onClick={() => setSection('history')}><div className="text-xs">{state.seasonHistory.length} temp</div></DashCard>
          <DashCard title="Técnico" icon={UserCog} onClick={() => setSection('manager')}><div className="text-xs">{state.manager.specialization ? SPEC_INFO[state.manager.specialization].label : 'Sem espec.'}</div></DashCard>
        </div>
      </div>

      {/* Modais */}
      {offerModal && (() => {
        const p = state.players.find((p: Player) => p.id === offerModal.playerId); if (!p) return null;
        return (
          <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-4" onClick={() => setOfferModal(null)}>
            <div className="bg-zinc-900 rounded-2xl w-full max-w-sm p-5 border border-zinc-700" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4"><span className="font-bold">Proposta: {p.name}</span><button onClick={() => setOfferModal(null)}><X size={18} className="text-zinc-400" /></button></div>
              <div className="text-xs text-zinc-400 mb-3">Valor pedido: R$ {fmt(offerModal.asking)}</div>
              <div className="flex items-center gap-2 mb-4"><span className="text-xs text-zinc-400">R$</span><input type="number" value={offerAmount} onChange={e => setOfferAmount(Number(e.target.value))} className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm" /></div>
              {userTeam.money < offerAmount && <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 mb-3 text-xs text-red-400"><AlertCircle size={12} />Saldo insuficiente</div>}
              <button onClick={handleBuyPlayer} disabled={userTeam.money < offerAmount} className={`w-full py-3 rounded-xl font-bold text-sm ${userTeam.money >= offerAmount ? 'bg-emerald-500 text-zinc-950 hover:bg-emerald-400' : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'}`}>Enviar Proposta</button>
            </div>
          </div>
        );
      })()}

      {reportModal && state.lastMatchReport && (() => {
        const r = state.lastMatchReport; const h = state.teams.find((t: Team) => t.id === r.homeTeamId)!; const a = state.teams.find((t: Team) => t.id === r.awayTeamId)!;
        return (
          <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-4" onClick={() => setReportModal(false)}>
            <div className="bg-zinc-900 rounded-2xl w-full max-w-md p-5 border border-zinc-700 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="text-center mb-4">
                <div className="text-[10px] text-zinc-400 uppercase tracking-wider mb-2">{r.isCup ? '🏆 Copa' : `Rodada ${state.currentRound - 1}`}</div>
                <div className="flex items-center justify-center gap-4">
                  <div className="text-right"><TeamCrest team={h} size={32} /><div className="text-xs font-bold mt-1">{h.name}</div></div>
                  <div className="text-3xl font-black">{r.homeScore} - {r.awayScore}</div>
                  <div><TeamCrest team={a} size={32} /><div className="text-xs font-bold mt-1">{a.name}</div></div>
                </div>
                <div className="text-[10px] text-zinc-500 mt-2">Posse: {r.homePossession}%—{100 - r.homePossession}% | Chutes: {r.homeShots}—{r.awayShots}</div>
              </div>
              <div className="space-y-1 mb-4">{r.goalEvents.map((g: any, i: number) => {
                const sc = state.players.find((p: Player) => p.id === g.playerId); const tm = state.teams.find((t: Team) => t.id === g.teamId);
                const sp = g.isSetPiece ? (g.setPieceType === 'penalty' ? ' ⚡' : g.setPieceType === 'corner' ? ' 🚩' : ' 🎯') : '';
                return <div key={i} className="flex items-center gap-2 text-xs"><span className="text-zinc-500 font-mono w-6">{g.minute}'</span><span>⚽</span><span className="font-bold">{sc?.name ?? '?'}{sp}</span><span className="text-zinc-500">— {tm?.name}</span></div>;
              })}</div>
              {r.cards.length > 0 && <div className="space-y-0.5 mb-3">{r.cards.map((c: any, i: number) => { const p = state.players.find((pl: Player) => pl.id === c.playerId); return <div key={i} className="text-[10px] text-zinc-400">{c.minute}' {c.type === 'red' ? '🟥' : '🟨'} {p?.name}</div>; })}</div>}
              <div className="text-[10px] text-zinc-400 font-bold mb-1 uppercase">Destaques</div>
              <div className="flex gap-2 flex-wrap mb-4">{r.topPerformers.slice(0, 4).map((tp: any, i: number) => { const p = state.players.find((pl: Player) => pl.id === tp.playerId); return <div key={i} className="bg-zinc-800 rounded-lg px-2 py-1 text-[10px]"><span className="font-bold">{p?.name?.split(' ')[0]}</span> <span className="text-amber-400">{tp.rating.toFixed(1)}</span></div>; })}</div>
              <button onClick={() => setReportModal(false)} className="w-full py-2.5 rounded-xl bg-zinc-800 text-zinc-300 font-bold text-sm hover:bg-zinc-700">Fechar</button>
            </div>
          </div>
        );
      })()}

      {offseasonModal && state.lastSeasonSummary && (() => {
        const s = state.lastSeasonSummary;
        return (
          <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-4" onClick={() => setOffseasonModal(false)}>
            <div className="bg-zinc-900 rounded-2xl w-full max-w-md p-5 border border-zinc-700 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="text-center mb-4"><Trophy size={32} className="text-amber-400 mx-auto mb-2" /><div className="text-xl font-black">Fim da Temporada {s.season}</div>
                <div className="text-sm text-zinc-400">{s.userPosition}º — Série {s.userLeague === 1 ? 'A' : s.userLeague === 2 ? 'B' : 'C'}</div></div>
              <div className="space-y-2 text-sm mb-4">
                <div className="flex justify-between"><span className="text-zinc-400">Copa</span><span className="font-bold">{s.cupResult}</span></div>
                <div className="flex justify-between"><span className="text-zinc-400">Objetivos</span><span className="font-bold">{s.objectivesAchieved}/{s.objectivesTotal}</span></div>
                {s.topScorer && <div className="text-zinc-400">🥇 Artilheiro: <span className="text-white font-bold">{s.topScorer.name}</span> ({s.topScorer.goals}g)</div>}
                {s.retired?.length > 0 && <div className="text-zinc-500">🏁 Aposentados: {s.retired.join(', ')}</div>}
                {s.youthGenerated?.length > 0 && <div className="text-emerald-400">🌱 Jovens: {s.youthGenerated.join(', ')}</div>}
              </div>
              <button onClick={() => { setOffseasonModal(false); dispatch({ type: 'START_NEW_SEASON' }); }} className="w-full py-3 rounded-xl bg-emerald-500 text-zinc-950 font-black text-sm hover:bg-emerald-400">PRÓXIMA TEMPORADA →</button>
            </div>
          </div>
        );
      })()}

      <div className="px-4 py-6 text-center">
        <button onClick={() => { localStorage.removeItem('brasmanager_save'); dispatch({ type: 'NEW_GAME' }); }} className="text-[10px] text-zinc-600 hover:text-zinc-400">Resetar jogo</button>
      </div>

      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}