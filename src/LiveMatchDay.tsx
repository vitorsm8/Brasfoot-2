import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import {
  GameState, Player, Match, MatchEvent, MatchReport, Formation,
  FORMATION_MODIFIERS, SetPieceType,
} from './types';
import {
  getEffectiveStrength, computeMidfieldControl, resolveAttack,
  computeMomentum, getHomeAdvantage, computeGoalkeeperSave,
  checkSetPiece, resolveCorner, resolveFreeKick, resolvePenalty,
  getAITacticalStyle, getAIFormation, getAIMatchModifiers,
  getAIMidMatchFormationChange, getAISubstitutionTarget, findBestSubIn,
  computeLeadershipBoost, pickWeightedPlayer, AttackOutcome,
} from './engine';
import { RNG } from './rng'; // ← usa o RNG robusto de rng.ts (fix #4 antecipado)
import { Play, Pause, FastForward, SkipForward, Trophy, Swords, Shield, Zap } from 'lucide-react';

// ─── Tipos internos ───────────────────────────────────────────────────────────

interface MatchState {
  homeScore: number; awayScore: number;
  homeLineup: Player[]; awayLineup: Player[];
  homeBench: Player[]; awayBench: Player[];
  homeFormation: Formation; awayFormation: Formation;
  awayStyle: ReturnType<typeof getAITacticalStyle>;
  events: MatchEvent[];
  homePoss: number; awayPoss: number;
  homeShots: number; awayShots: number;
  minute: number;
  homeRecentGoal: number | null; awayRecentGoal: number | null;
  homeRecentConceded: number | null; awayRecentConceded: number | null;
  homeSubs: number; awaySubs: number;
  homeInjured: string[]; awayInjured: string[];
  finished: boolean;
}

interface Props {
  gameState: GameState;
  matches: Match[];
  userLineup: string[];
  onComplete: (updatedMatches: Match[], playerUpdates: Partial<Player>[], report: MatchReport) => void;
  isCupMatch?: boolean;
}

const TICK_SPEEDS = [800, 400, 150, 0]; // Normal, Rápido, Ultra, Instant
const SPEED_LABELS = ['▶', '▶▶', '▶▶▶', '⏭'];

export default function LiveMatchDay({ gameState, matches, userLineup, onComplete, isCupMatch }: Props) {
  const { teams, players } = gameState;
  const userTeamId = gameState.userTeamId!;
  const userMatch = matches.find(m => m.homeTeamId === userTeamId || m.awayTeamId === userTeamId)!;
  const isHome = userMatch.homeTeamId === userTeamId;

  const homeTeam = teams.find(t => t.id === userMatch.homeTeamId)!;
  const awayTeam = teams.find(t => t.id === userMatch.awayTeamId)!;

  // ── RNG: usa o Mulberry32 de rng.ts com seed derivada do matchId ──────────
  // Seed determinística: mesma partida sempre produz a mesma sequência
  const matchSeed = useMemo(() => {
    let hash = 0;
    for (let i = 0; i < userMatch.id.length; i++) {
      hash = ((hash << 5) - hash + userMatch.id.charCodeAt(i)) | 0;
    }
    return Math.abs(hash) + Date.now();
  }, [userMatch.id]);

  const rng = useRef(new RNG(matchSeed));

  // ── Spec modifiers ─────────────────────────────────────────────────────────
  const userSpec = gameState.manager.specialization;
  const userSpecAtk = userSpec === 'ofensivo' ? 1.15 : 1.0;
  const userSpecDef = userSpec === 'defensivo' ? 1.15 : 1.0;
  const gkBoost = gameState.staff.goleiros ?? 0;

  // ── Inicializar estado da partida ──────────────────────────────────────────
  const initMatchState = useCallback((): MatchState => {
    const allHomePlayers = players.filter(p => p.teamId === homeTeam.id && !p.redCard && p.injuryWeeksLeft === 0);
    const allAwayPlayers = players.filter(p => p.teamId === awayTeam.id && !p.redCard && p.injuryWeeksLeft === 0);

    let homeLineup: Player[], homeBench: Player[];
    if (isHome) {
      homeLineup = userLineup.map(id => players.find(p => p.id === id)!).filter(Boolean);
      homeBench = allHomePlayers.filter(p => !userLineup.includes(p.id)).slice(0, 5);
    } else {
      homeLineup = allHomePlayers.sort((a, b) => b.strength - a.strength).slice(0, 11);
      homeBench = allHomePlayers.filter(p => !homeLineup.includes(p)).slice(0, 5);
    }

    let awayLineup: Player[], awayBench: Player[];
    if (!isHome) {
      awayLineup = userLineup.map(id => players.find(p => p.id === id)!).filter(Boolean);
      awayBench = allAwayPlayers.filter(p => !userLineup.includes(p.id)).slice(0, 5);
    } else {
      awayLineup = allAwayPlayers.sort((a, b) => b.strength - a.strength).slice(0, 11);
      awayBench = allAwayPlayers.filter(p => !awayLineup.includes(p)).slice(0, 5);
    }

    const awayStyle = getAITacticalStyle(isHome ? awayTeam : homeTeam, players);
    const aiFormation = getAIFormation(awayStyle);

    return {
      homeScore: 0, awayScore: 0,
      homeLineup, awayLineup, homeBench, awayBench,
      homeFormation: isHome ? gameState.formation : aiFormation,
      awayFormation: isHome ? aiFormation : gameState.formation,
      awayStyle,
      events: [], homePoss: 0, awayPoss: 0, homeShots: 0, awayShots: 0,
      minute: 0,
      homeRecentGoal: null, awayRecentGoal: null,
      homeRecentConceded: null, awayRecentConceded: null,
      homeSubs: 0, awaySubs: 0,
      homeInjured: [], awayInjured: [],
      finished: false,
    };
  }, []);

  const [matchState, setMatchState] = useState<MatchState>(initMatchState);
  const [speedIdx, setSpeedIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const matchStateRef = useRef(matchState);
  matchStateRef.current = matchState;

  // ══════════════════════════════════════════════════════════════════════════
  // FUNÇÃO PURA DE TICK
  // Recebe o estado atual e retorna o próximo estado — sem tocar no React.
  // Isso permite tanto o loop incremental (setInterval) quanto o loop
  // instant (simular tudo de uma vez antes de chamar setMatchState).
  // ══════════════════════════════════════════════════════════════════════════

  const applyTick = useCallback((prev: MatchState): MatchState => {
    if (prev.finished || prev.minute >= 90) return { ...prev, finished: true };

    const s = { ...prev };
    const minute = s.minute + 1;
    s.minute = minute;
    const rand = () => rng.current.next();
    const newEvents: MatchEvent[] = [];

    // ── AI mid-match formation change ──────────────────────────────────────
    const aiIsHome = !isHome;
    const aiTeamScore = aiIsHome ? s.homeScore : s.awayScore;
    const aiOppScore = aiIsHome ? s.awayScore : s.homeScore;

    const newAIFormation = getAIMidMatchFormationChange(
      s.awayStyle,
      aiIsHome ? s.homeFormation : s.awayFormation,
      aiTeamScore, aiOppScore, minute, rand,
    );
    if (newAIFormation) {
      if (aiIsHome) s.homeFormation = newAIFormation;
      else s.awayFormation = newAIFormation;
      newEvents.push({
        id: `tc_${minute}`, minute, type: 'tactical_change',
        teamId: aiIsHome ? homeTeam.id : awayTeam.id,
        playerId: '', newFormation: newAIFormation,
      });
    }

    // ── AI substitutions (max 3) ──────────────────────────────────────────
    const aiLineup = aiIsHome ? s.homeLineup : s.awayLineup;
    const aiBench = aiIsHome ? s.homeBench : s.awayBench;
    const aiSubs = aiIsHome ? s.homeSubs : s.awaySubs;
    const aiInjured = aiIsHome ? s.homeInjured : s.awayInjured;

    if (aiSubs < 3 && minute > 45) {
      const subTarget = getAISubstitutionTarget(
        s.awayStyle, aiLineup, aiBench,
        aiTeamScore, aiOppScore, minute, aiInjured,
      );
      if (subTarget) {
        const subIn = findBestSubIn(aiBench, subTarget.preferPosition, aiLineup.find(p => p.id === subTarget.outId)?.position ?? 'M');
        if (subIn) {
          const outIdx = aiLineup.findIndex(p => p.id === subTarget.outId);
          if (outIdx >= 0) {
            newEvents.push({
              id: `sub_${minute}_ai`, minute, type: 'sub',
              teamId: aiIsHome ? homeTeam.id : awayTeam.id,
              playerId: subTarget.outId, subInId: subIn.id,
            });
            const newLineup = [...aiLineup];
            newLineup[outIdx] = subIn;
            const newBench = aiBench.filter(p => p.id !== subIn.id);
            if (aiIsHome) { s.homeLineup = newLineup; s.homeBench = newBench; s.homeSubs++; }
            else { s.awayLineup = newLineup; s.awayBench = newBench; s.awaySubs++; }
          }
        }
      }
    }

    // ── Resolve attacks ────────────────────────────────────────────────────
    const resolveTeamAttack = (
      attackers: Player[], defenders: Player[],
      atkFormation: Formation, defFormation: Formation,
      isAtkHome: boolean, atkTeamId: string,
      atkScore: number, defScore: number,
    ) => {
      const homeAdv = getHomeAdvantage(isAtkHome);
      const atkFm = FORMATION_MODIFIERS[atkFormation];
      const defFm = FORMATION_MODIFIERS[defFormation];

      const isUserAtk = atkTeamId === userTeamId;
      const specAtk = isUserAtk ? userSpecAtk : 1.0;
      const specDef = isUserAtk ? 1.0 : userSpecDef;

      const midControl = computeMidfieldControl(attackers, defenders);
      if (rand() < midControl) s.homePoss += isAtkHome ? 1 : 0;
      else s.awayPoss += isAtkHome ? 0 : 1;

      const momentum = computeMomentum(
        atkScore, defScore, minute,
        isAtkHome ? s.homeRecentGoal : s.awayRecentGoal,
        isAtkHome ? s.homeRecentConceded : s.awayRecentConceded,
      );
      const deficit = defScore - atkScore;
      const leaderBoost = computeLeadershipBoost(attackers, deficit, minute);

      const gk = defenders.find(p => p.position === 'G') ?? null;
      let boostedGk = gk;
      if (gk && isUserAtk && gkBoost > 0) {
        boostedGk = { ...gk, attributes: { ...gk.attributes, posicionamento: Math.min(99, gk.attributes.posicionamento + gkBoost * 2) } };
      }

      const outcome: AttackOutcome = resolveAttack({
        attackers, defenders, goalkeeper: isUserAtk ? boostedGk : gk,
        midfieldControl: midControl,
        momentumBonus: momentum + leaderBoost,
        homeAdvantage: homeAdv,
        formationAtkMod: atkFm.attack, formationDefMod: defFm.defense,
        specAtkMod: specAtk, specDefMod: specDef,
        rand,
      });

      if (outcome.chanceCreated) {
        if (isAtkHome) s.homeShots++; else s.awayShots++;
      }

      if (outcome.result === 'goal' && outcome.shooter) {
        if (isAtkHome) { s.homeScore++; s.homeRecentGoal = minute; s.awayRecentConceded = minute; }
        else { s.awayScore++; s.awayRecentGoal = minute; s.homeRecentConceded = minute; }
        newEvents.push({
          id: `goal_${minute}_${atkTeamId}`, minute, type: 'goal',
          teamId: atkTeamId, playerId: outcome.shooter.id,
          assistId: outcome.assister?.id,
        });
      }

      // ── Set pieces ───────────────────────────────────────────────────────
      const setPiece = checkSetPiece(attackers, defenders, outcome.chanceCreated, outcome.shotBlocked, rand);

      if (setPiece.type === 'corner') {
        newEvents.push({ id: `corner_${minute}_${atkTeamId}`, minute, type: 'corner', teamId: atkTeamId, playerId: '', setPieceType: 'corner' });
        const cornerResult = resolveCorner(attackers, defenders, isUserAtk ? boostedGk : gk, rand);
        if (isAtkHome) s.homeShots++; else s.awayShots++;
        if (cornerResult.result === 'goal' && cornerResult.scorer) {
          if (isAtkHome) { s.homeScore++; s.homeRecentGoal = minute; s.awayRecentConceded = minute; }
          else { s.awayScore++; s.awayRecentGoal = minute; s.homeRecentConceded = minute; }
          newEvents.push({ id: `spg_${minute}_${atkTeamId}`, minute, type: 'goal', teamId: atkTeamId, playerId: cornerResult.scorer.id, assistId: cornerResult.assister?.id, setPieceType: 'corner' });
        }
      }

      if (setPiece.type === 'freekick') {
        newEvents.push({ id: `fk_${minute}_${atkTeamId}`, minute, type: 'freekick', teamId: atkTeamId, playerId: setPiece.fouledPlayerId ?? '', setPieceType: 'freekick' });
        if (setPiece.foulingPlayerId) {
          const fouler = defenders.find(p => p.id === setPiece.foulingPlayerId);
          if (fouler) {
            const defTeamId = isAtkHome ? awayTeam.id : homeTeam.id;
            const cardChance = (100 - fouler.attributes.disciplina) / 800;
            if (rand() < cardChance) {
              const isRed = fouler.yellowCards >= 1 || rand() < 0.05;
              newEvents.push({ id: `card_${minute}_${fouler.id}`, minute, type: isRed ? 'red' : 'yellow', teamId: defTeamId, playerId: fouler.id });
            }
          }
        }
        const fkResult = resolveFreeKick(attackers, isUserAtk ? boostedGk : gk, rand);
        if (isAtkHome) s.homeShots++; else s.awayShots++;
        if (fkResult.result === 'goal' && fkResult.scorer) {
          if (isAtkHome) { s.homeScore++; s.homeRecentGoal = minute; s.awayRecentConceded = minute; }
          else { s.awayScore++; s.awayRecentGoal = minute; s.homeRecentConceded = minute; }
          newEvents.push({ id: `spg_fk_${minute}_${atkTeamId}`, minute, type: 'goal', teamId: atkTeamId, playerId: fkResult.scorer.id, setPieceType: 'freekick' });
        }
      }

      if (setPiece.type === 'penalty') {
        newEvents.push({ id: `pen_${minute}_${atkTeamId}`, minute, type: 'penalty', teamId: atkTeamId, playerId: setPiece.fouledPlayerId ?? '', setPieceType: 'penalty' });
        if (setPiece.foulingPlayerId) {
          const fouler = defenders.find(p => p.id === setPiece.foulingPlayerId);
          if (fouler) {
            const defTeamId = isAtkHome ? awayTeam.id : homeTeam.id;
            const isRed = rand() < 0.30;
            newEvents.push({ id: `card_pen_${minute}_${fouler.id}`, minute, type: isRed ? 'red' : 'yellow', teamId: defTeamId, playerId: fouler.id });
          }
        }
        const penResult = resolvePenalty(attackers, isUserAtk ? boostedGk : gk, rand);
        if (isAtkHome) s.homeShots++; else s.awayShots++;
        if (penResult.result === 'goal' && penResult.scorer) {
          if (isAtkHome) { s.homeScore++; s.homeRecentGoal = minute; s.awayRecentConceded = minute; }
          else { s.awayScore++; s.awayRecentGoal = minute; s.homeRecentConceded = minute; }
          newEvents.push({ id: `spg_pen_${minute}_${atkTeamId}`, minute, type: 'goal', teamId: atkTeamId, playerId: penResult.scorer.id, setPieceType: 'penalty' });
        } else if (penResult.result !== 'goal') {
          newEvents.push({ id: `pm_${minute}_${atkTeamId}`, minute, type: 'penalty_miss', teamId: atkTeamId, playerId: penResult.scorer?.id ?? '' });
        }
      }

      // ── Cartões de jogo normal ──────────────────────────────────────────
      if (setPiece.type === null) {
        for (const def of defenders.filter(p => p.position !== 'G')) {
          const cardChance = (100 - def.attributes.disciplina) / 3000;
          if (rand() < cardChance) {
            const defTeamId = isAtkHome ? awayTeam.id : homeTeam.id;
            const isRed = def.yellowCards >= 1 || rand() < 0.03;
            newEvents.push({ id: `card_${minute}_${def.id}`, minute, type: isRed ? 'red' : 'yellow', teamId: defTeamId, playerId: def.id });
          }
        }
      }

      // ── Lesões ──────────────────────────────────────────────────────────
      const allMatchPlayers = [...attackers, ...defenders];
      for (const p of allMatchPlayers) {
        const injuryChance = 0.0008 * (1 - p.attributes.stamina / 200) * (minute > 70 ? 1.5 : 1.0);
        if (rand() < injuryChance) {
          const tId = attackers.includes(p) ? atkTeamId : (isAtkHome ? awayTeam.id : homeTeam.id);
          newEvents.push({ id: `inj_${minute}_${p.id}`, minute, type: 'injury', teamId: tId, playerId: p.id });
          if (isAtkHome && attackers.includes(p)) s.homeInjured.push(p.id);
          else if (isAtkHome && defenders.includes(p)) s.awayInjured.push(p.id);
          else if (!isAtkHome && attackers.includes(p)) s.awayInjured.push(p.id);
          else s.homeInjured.push(p.id);
        }
      }
    };

    resolveTeamAttack(s.homeLineup, s.awayLineup, s.homeFormation, s.awayFormation, true, homeTeam.id, s.homeScore, s.awayScore);
    resolveTeamAttack(s.awayLineup, s.homeLineup, s.awayFormation, s.homeFormation, false, awayTeam.id, s.awayScore, s.homeScore);

    // ── Desgaste de energia ──────────────────────────────────────────────
    const drainEnergy = (lineup: Player[]) =>
      lineup.map(p => ({ ...p, energy: Math.max(0, p.energy - (0.8 + (100 - p.attributes.stamina) / 200)) }));
    s.homeLineup = drainEnergy(s.homeLineup);
    s.awayLineup = drainEnergy(s.awayLineup);

    s.events = [...prev.events, ...newEvents];

    if (minute >= 90) s.finished = true;
    return s;
  }, [isHome, homeTeam, awayTeam, userTeamId, userSpecAtk, userSpecDef, gkBoost]);

  // ══════════════════════════════════════════════════════════════════════════
  // GAME LOOP
  // ══════════════════════════════════════════════════════════════════════════

  useEffect(() => {
    if (matchState.finished || paused) return;

    const speed = TICK_SPEEDS[speedIdx];

    if (speed === 0) {
      // ── INSTANT: simula todos os ticks restantes em JS puro ──────────────
      // Sem chamar setMatchState dentro do loop — evita 90 re-renders.
      // Aplica o resultado final com um único setState.
      let current = matchStateRef.current;
      while (!current.finished && current.minute < 90) {
        current = applyTick(current);
      }
      setMatchState(current);
      return;
    }

    // ── NORMAL / RÁPIDO / ULTRA: um tick por intervalo ────────────────────
    const timer = setInterval(() => {
      setMatchState(prev => applyTick(prev));
    }, speed);

    return () => clearInterval(timer);
  }, [matchState.finished, paused, speedIdx, applyTick]);

  // ── Finalizar ──────────────────────────────────────────────────────────────
  const handleFinish = useCallback(() => {
    const ms = matchStateRef.current;

    const goalEvents = ms.events.filter(e => e.type === 'goal').map(e => ({
      playerId: e.playerId, teamId: e.teamId, minute: e.minute,
      assistId: e.assistId, isSetPiece: !!e.setPieceType, setPieceType: e.setPieceType,
    }));
    const cards = ms.events.filter(e => e.type === 'yellow' || e.type === 'red').map(e => ({
      playerId: e.playerId, teamId: e.teamId, minute: e.minute, type: e.type as 'yellow' | 'red',
    }));
    const injuries = ms.events.filter(e => e.type === 'injury').map(e => ({
      playerId: e.playerId, teamId: e.teamId, minute: e.minute,
    }));

    const totalPoss = ms.homePoss + ms.awayPoss || 1;

    const ratingMap = new Map<string, number>();
    const allPlayed = [...ms.homeLineup, ...ms.awayLineup];
    for (const p of allPlayed) {
      let rating = 6.0 + (p.strength - 60) / 80;
      const goals = goalEvents.filter(g => g.playerId === p.id).length;
      const assists = goalEvents.filter(g => g.assistId === p.id).length;
      const reds = cards.filter(c => c.playerId === p.id && c.type === 'red').length;
      rating += goals * 1.2 + assists * 0.6 - reds * 2.0;
      ratingMap.set(p.id, Math.max(1, Math.min(10, rating)));
    }

    const topPerformers = Array.from(ratingMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([pid, rating]) => {
        const p = allPlayed.find(pl => pl.id === pid)!;
        return { playerId: pid, teamId: p.teamId, rating };
      });

    const report: MatchReport = {
      homeTeamId: homeTeam.id, awayTeamId: awayTeam.id,
      homeScore: ms.homeScore, awayScore: ms.awayScore,
      homeShots: ms.homeShots, awayShots: ms.awayShots,
      homePossession: Math.round((ms.homePoss / totalPoss) * 100),
      goalEvents, cards, injuries, topPerformers,
      isCup: !!isCupMatch,
    };

    const playerUpdates: Partial<Player>[] = [];
    for (const p of allPlayed) {
      const goals = goalEvents.filter(g => g.playerId === p.id).length;
      const assists = goalEvents.filter(g => g.assistId === p.id).length;
      const yellows = cards.filter(c => c.playerId === p.id && c.type === 'yellow').length;
      const reds = cards.filter(c => c.playerId === p.id && c.type === 'red').length;
      const injured = injuries.some(i => i.playerId === p.id);
      const medLevel = gameState.staff.medico ?? 0;
      const injWeeks = injured ? Math.max(1, rng.current.nextInt(1, 6) - medLevel) : 0;

      playerUpdates.push({
        id: p.id,
        energy: Math.max(5, Math.round(p.energy * 0.85)),
        goals: (p.goals ?? 0) + goals,
        assists: (p.assists ?? 0) + assists,
        matchesPlayed: (p.matchesPlayed ?? 0) + 1,
        minutesPlayed: (p.minutesPlayed ?? 0) + 90,
        yellowCards: p.yellowCards + yellows,
        redCard: reds > 0 || (p.yellowCards + yellows >= 2),
        injuryWeeksLeft: Math.max(p.injuryWeeksLeft, injWeeks),
      });
    }

    const updatedMatches = matches.map(m =>
      m.id === userMatch.id
        ? { ...m, homeScore: ms.homeScore, awayScore: ms.awayScore, played: true }
        : m
    );

    onComplete(updatedMatches, playerUpdates, report);
  }, [matches, userMatch, homeTeam, awayTeam, onComplete, isCupMatch, gameState.staff.medico]);

  useEffect(() => {
    if (matchState.finished) {
      const timer = setTimeout(handleFinish, 600);
      return () => clearTimeout(timer);
    }
  }, [matchState.finished, handleFinish]);

  // ── Render ─────────────────────────────────────────────────────────────────
  const recentEvents = useMemo(() =>
    [...matchState.events].reverse().slice(0, 12),
    [matchState.events]
  );

  const setPieceIcon = (type?: SetPieceType) => {
    if (type === 'corner') return '🚩';
    if (type === 'freekick') return '🎯';
    if (type === 'penalty') return '⚡';
    return '';
  };

  const eventLabel = (e: MatchEvent) => {
    const team = teams.find(t => t.id === e.teamId);
    const player = players.find(p => p.id === e.playerId);
    const teamName = team?.name ?? '?';
    const playerName = player?.name ?? '';

    switch (e.type) {
      case 'goal': {
        const sp = e.setPieceType ? ` ${setPieceIcon(e.setPieceType)}` : '';
        const assist = e.assistId ? ` (${players.find(p => p.id === e.assistId)?.name ?? 'A'})` : '';
        return `⚽ GOL! ${playerName}${assist}${sp} — ${teamName}`;
      }
      case 'yellow': return `🟨 ${playerName} — ${teamName}`;
      case 'red': return `🟥 ${playerName} — ${teamName}`;
      case 'corner': return `🚩 Escanteio — ${teamName}`;
      case 'freekick': return `🎯 Falta perigosa — ${teamName}`;
      case 'penalty': return `⚡ PÊNALTI! — ${teamName}`;
      case 'penalty_miss': return `❌ Pênalti perdido — ${playerName}`;
      case 'sub': {
        const subIn = players.find(p => p.id === e.subInId);
        return `🔄 ${playerName} ➜ ${subIn?.name ?? '?'} — ${teamName}`;
      }
      case 'injury': return `🏥 Lesão — ${playerName}`;
      case 'tactical_change': return `📋 Mudança tática: ${e.newFormation} — ${teamName}`;
      default: return `${e.type} — ${teamName}`;
    }
  };

  const totalPoss = matchState.homePoss + matchState.awayPoss || 1;
  const homePossPercent = Math.round((matchState.homePoss / totalPoss) * 100);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans flex flex-col">

      {/* Placar */}
      <div className="bg-zinc-900 border-b border-zinc-800 px-4 py-4">
        <div className="max-w-lg mx-auto">
          {isCupMatch && <div className="text-center text-amber-400 text-[10px] font-bold mb-2 flex items-center justify-center gap-1"><Trophy size={11} />COPA</div>}
          <div className="flex items-center justify-center gap-4 mb-3">
            <div className="flex items-center gap-2 flex-1 justify-end min-w-0">
              <span className={`font-bold text-sm truncate ${homeTeam.id === userTeamId ? 'text-emerald-400' : ''}`}>{homeTeam.name}</span>
              <div className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center font-bold text-xs" style={{ backgroundColor: homeTeam.color, color: '#fff' }}>{homeTeam.name.charAt(0)}</div>
            </div>
            <div className="text-4xl font-black font-mono bg-zinc-950 px-4 py-1.5 rounded-2xl border border-zinc-700 min-w-[90px] text-center">
              {matchState.homeScore} – {matchState.awayScore}
            </div>
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center font-bold text-xs" style={{ backgroundColor: awayTeam.color, color: '#fff' }}>{awayTeam.name.charAt(0)}</div>
              <span className={`font-bold text-sm truncate ${awayTeam.id === userTeamId ? 'text-emerald-400' : ''}`}>{awayTeam.name}</span>
            </div>
          </div>

          {/* Minuto + progresso */}
          <div className="flex items-center gap-2 mb-2">
            <span className="text-zinc-500 text-[10px] font-mono w-6">{matchState.minute}'</span>
            <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${(matchState.minute / 90) * 100}%` }} />
            </div>
            <span className="text-zinc-500 text-[10px] font-mono">90'</span>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-2 text-center text-[10px]">
            <div><div className="font-bold text-xs">{matchState.homeShots}</div><div className="text-zinc-500">Chutes</div></div>
            <div>
              <div className="flex items-center gap-1 justify-center">
                <span className="font-bold text-xs">{homePossPercent}%</span>
                <span className="text-zinc-600">Posse</span>
                <span className="font-bold text-xs">{100 - homePossPercent}%</span>
              </div>
              <div className="flex h-1 bg-zinc-800 rounded-full overflow-hidden">
                <div className="bg-blue-500 transition-all" style={{ width: `${homePossPercent}%` }} />
                <div className="bg-red-500 transition-all" style={{ width: `${100 - homePossPercent}%` }} />
              </div>
            </div>
            <div><div className="font-bold text-xs">{matchState.awayShots}</div><div className="text-zinc-500">Chutes</div></div>
          </div>

          {/* Formações */}
          <div className="flex items-center justify-between mt-2 text-[9px] text-zinc-500">
            <span className="flex items-center gap-1"><Shield size={9} />{matchState.homeFormation}</span>
            <span className="flex items-center gap-1">{matchState.awayFormation}<Shield size={9} /></span>
          </div>
        </div>
      </div>

      {/* Controles */}
      <div className="bg-zinc-900/80 border-b border-zinc-800 px-4 py-2 flex items-center justify-center gap-2">
        <button onClick={() => setPaused(!paused)} disabled={matchState.finished}
          className="bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-white font-bold p-2 rounded-xl">
          {paused ? <Play size={16} /> : <Pause size={16} />}
        </button>
        {SPEED_LABELS.map((label, i) => (
          <button key={i} onClick={() => setSpeedIdx(i)} disabled={matchState.finished}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${speedIdx === i ? 'bg-emerald-500 text-zinc-950' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Feed de eventos */}
      <div className="flex-1 max-w-lg mx-auto w-full px-3 py-3 overflow-y-auto">
        {matchState.events.length === 0 && (
          <div className="text-center text-zinc-600 py-8 text-sm">A partida vai começar...</div>
        )}
        <div className="space-y-1">
          {recentEvents.map(e => {
            const isGoal = e.type === 'goal';
            const isPenalty = e.type === 'penalty' || e.type === 'penalty_miss';
            const isCard = e.type === 'yellow' || e.type === 'red';
            const isTactical = e.type === 'tactical_change';
            const isSetPieceEvt = e.type === 'corner' || e.type === 'freekick';

            return (
              <div key={e.id} className={`flex items-start gap-2 px-3 py-2 rounded-xl text-xs transition-all ${
                isGoal ? 'bg-emerald-500/10 border border-emerald-500/30 font-bold' :
                isPenalty ? 'bg-amber-500/10 border border-amber-500/30' :
                isCard ? 'bg-zinc-800/50 border border-zinc-800' :
                isTactical ? 'bg-blue-500/10 border border-blue-500/20' :
                isSetPieceEvt ? 'bg-zinc-800/30 border border-zinc-800/50' :
                'bg-zinc-900/50 border border-zinc-800/30'
              }`}>
                <span className="font-mono text-zinc-500 w-6 flex-shrink-0 text-right">{e.minute}'</span>
                <span className={`flex-1 ${isGoal ? 'text-emerald-400' : isPenalty ? 'text-amber-400' : ''}`}>
                  {eventLabel(e)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Status final */}
      {matchState.finished && (
        <div className="bg-zinc-900 border-t border-zinc-800 px-4 py-3 text-center">
          <div className="text-zinc-400 text-xs mb-1">Fim de jogo</div>
          <div className="text-2xl font-black">
            {matchState.homeScore > matchState.awayScore
              ? (homeTeam.id === userTeamId ? '✅ Vitória!' : '❌ Derrota')
              : matchState.homeScore < matchState.awayScore
                ? (awayTeam.id === userTeamId ? '✅ Vitória!' : '❌ Derrota')
                : '🤝 Empate'}
          </div>
        </div>
      )}
    </div>
  );
}