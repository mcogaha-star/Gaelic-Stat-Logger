import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, BarChart3, SlidersHorizontal } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { createPageUrl } from '@/utils';
import {
  getMatchSectionOffsets,
  getMatchTimeS,
  normalizeFoulType,
  shotPointsForOutcome,
  buildLegacyPossessionRepairs,
  POSSESSION_REBUILD_VERSION,
} from '@/lib/reportAnalytics';
import {
  safeParseJSON,
  formatMMSS,
  computeImputedNormalizedTimes,
  groupByPossession,
  possessionHasOpp45Entry,
  derivePossessionOutcome,
  ReportFiltersFields,
  PitchViz,
  MultiSelect,
  toTitleCase,
} from '@/features/report/shared';
import ScoringTab from '@/features/report/tabs/ScoringTab';
import PossessionsTab from '@/features/report/tabs/PossessionsTab';
import BuildUpTab from '@/features/report/tabs/BuildUpTab';
import RestartsTab from '@/features/report/tabs/RestartsTab';
import MiscTab from '@/features/report/tabs/MiscTab';
import DefenseTab from '@/features/report/tabs/DefenseTab';
import FoulsDisciplineTab from '@/features/report/tabs/FoulsTab';
import OverviewTab from '@/features/report/tabs/OverviewTab';
import PlayersAnalyticsTab from '@/features/report/tabs/PlayersAnalyticsTab';
import DataTab from '@/features/report/tabs/DataTab';
import VisualiserTab from '@/features/report/tabs/VisualiserTab';
import useFilteredReportStats from '@/features/report/hooks/useFilteredReportStats';
import usePossessionVisualiser from '@/features/report/hooks/usePossessionVisualiser';
import useReportFilterState from '@/features/report/hooks/useReportFilterState';

const db = globalThis.__B44_DB__ || {
  entities: new Proxy({}, {
    get: () => ({
      filter: async () => [],
      get: async () => null,
    }),
  }),
};
export default function MatchReport() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const urlParams = new URLSearchParams(location?.search || '');
  const matchId = urlParams.get('id');

  const { data: matchArr = [] } = useQuery({
    queryKey: ['match', matchId],
    queryFn: () => db.entities.Match.filter({ id: matchId }),
    enabled: !!matchId,
  });

  const match = matchArr?.[0] || null;
  const halfAnchors = useMemo(() => safeParseJSON(match?.video_half_start_time_s || '{}', {}), [match?.video_half_start_time_s]);

  const { data: homeTeamArr = [] } = useQuery({
    queryKey: ['team', match?.home_team_id],
    queryFn: () => db.entities.Team.filter({ id: match?.home_team_id }),
    enabled: !!match?.home_team_id,
  });

  const { data: awayTeamArr = [] } = useQuery({
    queryKey: ['team', match?.away_team_id],
    queryFn: () => db.entities.Team.filter({ id: match?.away_team_id }),
    enabled: !!match?.away_team_id,
  });

  const homeTeam = homeTeamArr?.[0] || null;
  const awayTeam = awayTeamArr?.[0] || null;

  const { data: homePlayers = [] } = useQuery({
    queryKey: ['players', 'home', match?.home_team_id],
    queryFn: () => db.entities.Player.filter({ team_id: match?.home_team_id }),
    enabled: !!match?.home_team_id,
  });

  const { data: awayPlayers = [] } = useQuery({
    queryKey: ['players', 'away', match?.away_team_id],
    queryFn: () => db.entities.Player.filter({ team_id: match?.away_team_id }),
    enabled: !!match?.away_team_id,
  });

  const { data: stats = [] } = useQuery({
    queryKey: ['stats', matchId],
    queryFn: () => db.entities.StatEntry.filter({ match_id: matchId }),
    enabled: !!matchId,
  });

  const [repairingLegacyPossessions, setRepairingLegacyPossessions] = useState(false);

  useEffect(() => {
    if (!matchId || !Array.isArray(stats) || !stats.length || repairingLegacyPossessions) return;
    const rebuildKey = `gstl-possession-rebuild:${POSSESSION_REBUILD_VERSION}:${matchId}`;
    try {
      if (localStorage.getItem(rebuildKey) === 'done') return;
    } catch {}
    const repairs = buildLegacyPossessionRepairs(stats);
    if (!repairs.length) {
      try { localStorage.setItem(rebuildKey, 'done'); } catch {}
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        setRepairingLegacyPossessions(true);
        for (const repair of repairs) {
          if (cancelled) return;
          await db.entities.StatEntry.update(repair.id, repair.data);
        }
        if (!cancelled) {
          await queryClient.invalidateQueries({ queryKey: ['stats', matchId] });
          await queryClient.refetchQueries({ queryKey: ['stats', matchId], type: 'active' });
          try { localStorage.setItem(rebuildKey, 'done'); } catch {}
        }
      } finally {
        if (!cancelled) setRepairingLegacyPossessions(false);
      }
    })();

    return () => { cancelled = true; };
  }, [matchId, stats, repairingLegacyPossessions, queryClient]);

  const imputedTimeById = useMemo(() => computeImputedNormalizedTimes(stats), [stats]);

  const playerOptions = useMemo(() => {
    const all = [
      ...(homePlayers || []).map((p) => ({ ...p, team_side: 'home' })),
      ...(awayPlayers || []).map((p) => ({ ...p, team_side: 'away' })),
    ];
    const label = (p) => `#${p.number || ''} ${p.name || ''}`.trim();
    return all
      .slice()
      .sort((a, b) => (a.team_side === b.team_side ? (a.number || 0) - (b.number || 0) : (a.team_side === 'home' ? -1 : 1)))
      .map((p) => ({
        id: p.id,
        team_side: p.team_side,
        label: label(p) || p.id,
        name: p.name || '',
        number: p.number ?? null,
        position: p.position || '',
      }));
  }, [homePlayers, awayPlayers]);

  const defenseTurnoverTypeOptions = useMemo(() => {
    const values = new Set();
    for (const s of Array.isArray(stats) ? stats : []) {
      const extra = safeParseJSON(s?.extra_data || '{}', {});
      const turnover = extra?.turnover;
      if (!(s?.stat_type === 'turnover' || turnover)) continue;
      const raw = String(turnover?.type || turnover?.turnover_type || '');
      const normalized = normalizeFoulType(raw);
      if (!normalized) continue;
      values.add(JSON.stringify({ value: normalized, label: raw ? toTitleCase(raw) : toTitleCase(normalized) }));
    }
    return Array.from(values).map((raw) => JSON.parse(raw)).sort((a, b) => a.label.localeCompare(b.label));
  }, [stats]);

  const reportState = useReportFilterState({ stats, match, imputedTimeById });
  const {
    activeTab,
    setActiveTab,
    topFiltersOpen,
    setTopFiltersOpen,
    overviewHalf,
    setOverviewHalf,
    reportFilters,
    vizTeam,
    setVizTeam,
    vizActions,
    setVizActions,
    vizHalves,
    setVizHalves,
    vizCounters,
    setVizCounters,
    vizPlayerIds,
    setVizPlayerIds,
    vizColorBy,
    setVizColorBy,
    scoringShotType,
    setScoringShotType,
    scoringSituation,
    setScoringSituation,
    scoringPressure,
    setScoringPressure,
    scoringOutcome,
    setScoringOutcome,
    scoringZone,
    setScoringZone,
    possessionsCounterFilter,
    setPossessionsCounterFilter,
    buildEventTypes,
    setBuildEventTypes,
    buildPressure,
    setBuildPressure,
    buildOutcome,
    setBuildOutcome,
    buildProgressiveOnly,
    setBuildProgressiveOnly,
    buildPnSide,
    setBuildPnSide,
    buildPnMin,
    setBuildPnMin,
    defenseEventCategory,
    setDefenseEventCategory,
    defenseTurnoverResult,
    setDefenseTurnoverResult,
    defenseTurnoverTypes,
    setDefenseTurnoverTypes,
    defenseDefTypes,
    setDefenseDefTypes,
    playersFocusPlayerId,
    setPlayersFocusPlayerId,
    filteredForViz,
    showTopFiltersButton,
  } = reportState;

  const { overviewStats, filteredForReport } = useFilteredReportStats({
    stats,
    overviewHalf,
    reportFilters,
    match,
    imputedTimeById,
  });

  const {
    sharedVizOpen,
    setSharedVizOpen,
    sharedVizTitle,
    sharedVizStats,
    openPossessionVisualiser,
    openSharedVideoAt,
    preRollSeconds: SHARED_VIZ_PRE_ROLL_S,
  } = usePossessionVisualiser({ matchId });

  const summary = useMemo(() => {
    const empty = {
      shots: 0,
      goals: 0,
      points1: 0,
      points2: 0,
      totalPoints: 0,
      passes: 0,
      turnovers: 0, // lost
      turnoversWon: 0,
      kickoutsTaken: 0,
      kickoutsWon: 0,
      ownKickoutsTaken: 0,
      ownKickoutsWon: 0,
      carries: 0,
      takeOnsAttempted: 0,
      takeOnsCompleted: 0,
      defensiveActions: 0,
      possessions: 0,
      attacks: 0,
    };
    const out = { home: { ...empty }, away: { ...empty } };
    const list = Array.isArray(overviewStats) ? overviewStats : [];

    const groupedPossessions = [];
    const groups = groupByPossession(list);
    for (const [key, evs] of groups.entries()) {
      const [teamSide, pidStr] = String(key).split('-');
      const pid = Number(pidStr);
      if ((teamSide !== 'home' && teamSide !== 'away') || !Number.isFinite(pid)) continue;
      const acting = (Array.isArray(evs) ? evs : []).filter((e) => e && e.team_side === teamSide);
      if (!acting.length) continue;
      groupedPossessions.push({
        teamSide,
        possessionId: pid,
        isAttack: possessionHasOpp45Entry(acting),
      });
    }

    for (const s of list) {
      if (!s) continue;
      const side = s.team_side === 'away' ? 'away' : 'home';
      const extra = safeParseJSON(s.extra_data || '{}', {});

      if (s.stat_type === 'shot') {
        out[side].shots += 1;
        const o = extra?.shot?.outcome;
        if (o === 'goal') out[side].goals += 1;
        if (o === 'point') out[side].points1 += 1;
        if (o === '2_point') out[side].points2 += 1;
      }

      if (s.stat_type === 'pass') out[side].passes += 1;
      if (s.stat_type === 'carry') out[side].carries += 1;

      if (s.stat_type === 'carry') {
        if (extra?.carry?.take_on_attempted) out[side].takeOnsAttempted += 1;
        if (extra?.carry?.take_on_attempted && extra?.carry?.take_on_completed) out[side].takeOnsCompleted += 1;
      }

      if (s.stat_type === 'defensive_contact') out[side].defensiveActions += 1;

      if (s.stat_type === 'kickout') {
        out[side].kickoutsTaken += 1;
        const o = extra?.kickout?.outcome;
        const won = extra?.kickout?.won_by;
        if ((o === 'clean' || o === 'break') && won?.team_side && (won.team_side === 'home' || won.team_side === 'away')) {
          out[won.team_side].kickoutsWon += 1;
        }

        // "Own" kickouts: taken by the team that is restarting (extra.kickout.team_side).
        const koTeam = extra?.kickout?.team_side;
        if (koTeam === 'home' || koTeam === 'away') {
          out[koTeam].ownKickoutsTaken += 1;
          if ((o === 'clean' || o === 'break') && won?.team_side === koTeam) out[koTeam].ownKickoutsWon += 1;
        }
      }

      // Turnovers: count as "lost" by the lost_by selection when present.
      const turnover = extra?.turnover;
      if (s.stat_type === 'turnover' || (turnover && typeof turnover === 'object')) {
        const lost = turnover?.lost_by;
        const rec = turnover?.recovered_by;
        if (lost?.team_side === 'home' || lost?.team_side === 'away') {
          out[lost.team_side].turnovers += 1;
        } else {
          // Fallback: attribute to acting team.
          out[side].turnovers += 1;
        }
        if (rec?.team_side === 'home' || rec?.team_side === 'away') {
          out[rec.team_side].turnoversWon += 1;
        }
      }
    }

    out.home.totalPoints = out.home.goals * 3 + out.home.points1 + out.home.points2 * 2;
    out.away.totalPoints = out.away.goals * 3 + out.away.points1 + out.away.points2 * 2;

    out.home.possessions = groupedPossessions.filter((p) => p.teamSide === 'home').length;
    out.away.possessions = groupedPossessions.filter((p) => p.teamSide === 'away').length;

    out.home.attacks = groupedPossessions.filter((p) => p.teamSide === 'home' && p.isAttack).length;
    out.away.attacks = groupedPossessions.filter((p) => p.teamSide === 'away' && p.isAttack).length;

    return out;
  }, [overviewStats]);

  const scoreTimeline = useMemo(() => {
    const list = Array.isArray(overviewStats) ? overviewStats : [];
    const scoring = [];

    for (const s of list) {
      if (!s || s.stat_type !== 'shot') continue;
      const extra = safeParseJSON(s.extra_data || '{}', {});
      const o = extra?.shot?.outcome;
      if (!['point', '2_point', 'goal'].includes(o)) continue;
      scoring.push({ s, extra, outcome: o });
    }

    if (!scoring.length) {
      return { mode: 'none', points: [] };
    }

    const allHaveTime = scoring.every((e) => Number.isFinite(Number(e.s.time_s)));
    const mode = allHaveTime ? 'time' : 'play';
    // When the user filters to a specific half, use that half's anchor so the chart "starts at 00:00".
    // In "All Halves" mode, we anchor from the first-half start.
    const preferAnchorKey = overviewHalf === 'second' ? 'second' : 'first';
    const t0 = (() => {
      const v = Number(halfAnchors?.[preferAnchorKey]);
      if (Number.isFinite(v)) return v;
      const v1 = Number(halfAnchors?.first);
      if (Number.isFinite(v1)) return v1;
      return 0;
    })();

    const getX = (e) => {
      if (mode === 'time') return Math.max(0, Number(e.s.time_s) - t0);
      return Number.isFinite(Number(e.s.play_id)) ? Number(e.s.play_id) : 0;
    };

    scoring.sort((a, b) => getX(a) - getX(b));

    let homeTotal = 0, awayTotal = 0;
    let homeGoals = 0, awayGoals = 0;
    let homePts = 0, awayPts = 0; // points (1p + 2p*2), excludes goals

    const points = [];
    points.push({
      x: 0,
      home_total: 0,
      away_total: 0,
      home_goals: 0,
      away_goals: 0,
      home_points: 0,
      away_points: 0,
      label: mode === 'time' ? '00:00' : '0',
    });

    for (const e of scoring) {
      const side = e.s.team_side === 'away' ? 'away' : 'home';
      const add = e.outcome === 'goal' ? 3 : (e.outcome === '2_point' ? 2 : 1);
      if (side === 'home') {
        homeTotal += add;
        if (e.outcome === 'goal') homeGoals += 1;
        else homePts += add;
      } else {
        awayTotal += add;
        if (e.outcome === 'goal') awayGoals += 1;
        else awayPts += add;
      }

      const x = getX(e);
      points.push({
        x,
        home_total: homeTotal,
        away_total: awayTotal,
        home_goals: homeGoals,
        away_goals: awayGoals,
        home_points: homePts,
        away_points: awayPts,
        label: mode === 'time' ? formatMMSS(x) : String(x),
      });
    }

    const htX = (() => {
      if (mode !== 'time') return null;
      if (overviewHalf !== 'all') return null;
      const second = Number(halfAnchors?.second);
      if (!Number.isFinite(second)) return null;
      return Math.max(0, second - t0);
    })();

    return { mode, points, htX };
  }, [overviewStats, halfAnchors, overviewHalf]);

  const overviewAttackOutcome = useMemo(() => {
    const groups = groupByPossession(overviewStats);
    const outcomes = {
      home: { Goal: 0, '2 Point': 0, '1 Point': 0, Miss: 0, Turnover: 0 },
      away: { Goal: 0, '2 Point': 0, '1 Point': 0, Miss: 0, Turnover: 0 },
    };

    for (const [key, evs] of groups.entries()) {
      const [teamSide] = String(key).split('-');
      if (teamSide !== 'home' && teamSide !== 'away') continue;
      if (!possessionHasOpp45Entry(evs, teamSide)) continue; // attack = entry to opp 45 (one per possession)
      const acting = (Array.isArray(evs) ? evs : []).filter((e) => e && e.team_side === teamSide);
      const shots = acting.filter((e) => e.stat_type === 'shot');
      let scoreType = '';
      for (const e of shots) {
        const ex = safeParseJSON(e.extra_data || '{}', {});
        const o = String(ex?.shot?.outcome || '');
        if (o === 'goal') { scoreType = 'Goal'; break; }
        if (o === '2_point') scoreType = scoreType || '2 Point';
        if (o === 'point') scoreType = scoreType || '1 Point';
      }
      if (scoreType) outcomes[teamSide][scoreType] += 1;
      else if (shots.length) outcomes[teamSide].Miss += 1;
      else outcomes[teamSide].Turnover += 1;
    }

    const data = [
      { team: homeTeam?.name || 'Home', side: 'home', ...outcomes.home },
      { team: awayTeam?.name || 'Away', side: 'away', ...outcomes.away },
    ];
    return { outcomes, data };
  }, [overviewStats, homeTeam, awayTeam]);

  const overviewPossessionOutcome = useMemo(() => {
    const groups = groupByPossession(overviewStats);
    const init = () => ({ Score: 0, Wide: 0, Short: 0, Blocked: 0, Saved: 0, Post: 0, Turnover: 0, 'Half End': 0 });
    const outcomes = { home: init(), away: init() };

    for (const [key, evs] of groups.entries()) {
      const [teamSide] = String(key).split('-');
      if (teamSide !== 'home' && teamSide !== 'away') continue;
      const acting = (Array.isArray(evs) ? evs : []).filter((e) => e && e.team_side === teamSide);
      if (!acting.length) continue;

      const outcome = derivePossessionOutcome(evs, teamSide);

      if (outcomes[teamSide][outcome] == null) outcomes[teamSide][outcome] = 0;
      outcomes[teamSide][outcome] += 1;
    }

    return [
      { team: homeTeam?.name || 'Home', side: 'home', ...outcomes.home },
      { team: awayTeam?.name || 'Away', side: 'away', ...outcomes.away },
    ];
  }, [overviewStats, homeTeam, awayTeam]);

  const overviewMomentum = useMemo(() => {
    const list = Array.isArray(overviewStats) ? overviewStats : [];
    const withTime = list
      .map((s) => ({ stat: s, matchTime: getMatchTimeS(s, match, imputedTimeById) }))
      .filter((entry) => Number.isFinite(entry.matchTime))
      .sort((a, b) => a.matchTime - b.matchTime);
    if (!withTime.length) return { mode: 'none', rows: [] };

    const share = (a, b) => {
      const d = a + b;
      if (!Number.isFinite(d) || d <= 0) return 0.5;
      return a / d;
    };

    const turnoverLostSide = (s) => {
      const ex = safeParseJSON(s?.extra_data || '{}', {});
      const lost = ex?.turnover?.lost_by?.team_side;
      if (lost === 'home' || lost === 'away') return lost;
      return null;
    };

    const possessionStarts = [];
    const groups = groupByPossession(withTime.map((entry) => entry.stat));
    for (const [key, events] of groups.entries()) {
      const times = events
        .map((event) => getMatchTimeS(event, match, imputedTimeById))
        .filter(Number.isFinite)
        .sort((a, b) => a - b);
      if (!times.length) continue;
      possessionStarts.push({
        key,
        side: String(key).startsWith('away-') ? 'away' : 'home',
        time: times[0],
      });
    }

    const offsets = getMatchSectionOffsets(match);
    const actualMax = withTime.reduce((m, entry) => Math.max(m, entry.matchTime), 0);
    const baseMax = offsets.second * 2;
    const axisMax = Math.max(baseMax, actualMax);
    const lastMinute = Math.max(1, Math.ceil(axisMax / 60));

    const rows = Array.from({ length: lastMinute + 1 }, (_, minuteIndex) => {
      const minuteMark = minuteIndex * 60;
      const windowStart = Math.max(0, minuteMark - 5 * 60);
      const windowStats = withTime.filter((entry) => entry.matchTime > windowStart && entry.matchTime <= minuteMark);
      const statsBySide = {
        home: { pts: 0, shots: 0, poss: new Set(), toLost: 0, possWins: 0 },
        away: { pts: 0, shots: 0, poss: new Set(), toLost: 0, possWins: 0 },
      };

      for (const { stat } of windowStats) {
        const pid = Number(stat?.possession_id);
        const pside = stat?.possession_team_side;
        if (Number.isFinite(pid) && (pside === 'home' || pside === 'away')) {
          statsBySide[pside].poss.add(`${pside}-${pid}`);
        }

        if (stat.stat_type === 'shot') {
          const ex = safeParseJSON(stat.extra_data || '{}', {});
          const o = ex?.shot?.outcome;
          const add = shotPointsForOutcome(o);
          if (stat.team_side === 'home') {
            statsBySide.home.shots += 1;
            statsBySide.home.pts += add;
          }
          if (stat.team_side === 'away') {
            statsBySide.away.shots += 1;
            statsBySide.away.pts += add;
          }
        }

        if (stat.stat_type === 'turnover' || safeParseJSON(stat?.extra_data || '{}', {})?.turnover) {
          const lostSide = turnoverLostSide(stat);
          if (lostSide) statsBySide[lostSide].toLost += 1;
        }
      }

      for (const pos of possessionStarts) {
        if (pos.time > windowStart && pos.time <= minuteMark) {
          statsBySide[pos.side].possWins += 1;
        }
      }

      const homePoss = statsBySide.home.poss.size;
      const awayPoss = statsBySide.away.poss.size;

      const homeProd = homePoss ? statsBySide.home.pts / homePoss : 0;
      const awayProd = awayPoss ? statsBySide.away.pts / awayPoss : 0;

      const homeTC = homePoss ? (1 - statsBySide.home.toLost / homePoss) : 0;
      const awayTC = awayPoss ? (1 - statsBySide.away.toLost / awayPoss) : 0;

      const homeEff = statsBySide.home.shots ? (statsBySide.home.pts / statsBySide.home.shots) : 0;
      const awayEff = statsBySide.away.shots ? (statsBySide.away.pts / statsBySide.away.shots) : 0;

      const pointShareHome = share(statsBySide.home.pts, statsBySide.away.pts);
      const prodShareHome = share(homeProd, awayProd);
      const tcShareHome = share(homeTC, awayTC);
      const pwShareHome = share(statsBySide.home.possWins, statsBySide.away.possWins);
      const effShareHome = share(homeEff, awayEff);

      const mHome = 100 * (0.35 * pointShareHome + 0.25 * prodShareHome + 0.20 * tcShareHome + 0.10 * pwShareHome + 0.10 * effShareHome);
      const mAway = 100 - mHome;

      return {
        minute: minuteMark / 60,
        label: formatMMSS(minuteMark),
        home: Number.isFinite(mHome) ? mHome : 50,
        away: Number.isFinite(mAway) ? mAway : 50,
        home_pts: statsBySide.home.pts,
        away_pts: statsBySide.away.pts,
        home_poss: homePoss,
        away_poss: awayPoss,
        home_to: statsBySide.home.toLost,
        away_to: statsBySide.away.toLost,
      };
    });

    return { mode: 'rolling', rows, axisMaxMinutes: Math.ceil(axisMax / 60) };
  }, [overviewStats, match, imputedTimeById]);

  if (!matchId) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <Card className="max-w-md w-full">
          <CardContent className="p-6 text-center space-y-4">
            <div className="w-12 h-12 bg-slate-900 rounded-xl flex items-center justify-center mx-auto">
              <BarChart3 className="w-6 h-6 text-white" />
            </div>
            <div className="text-slate-900 font-semibold">No match selected</div>
            <Link to={createPageUrl('Home')}>
              <Button>Go to Dashboard</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link to={createPageUrl(`MatchStats?id=${matchId}`)}>
              <Button variant="ghost" size="sm" className="gap-2">
                <ArrowLeft className="w-4 h-4" /> Back
              </Button>
            </Link>
            <div className="min-w-0">
              <div className="font-semibold text-slate-900 truncate">
                {homeTeam?.name || 'Home'} vs {awayTeam?.name || 'Away'}
              </div>
              <div className="text-xs text-slate-500 truncate">
                {match?.date || ''}{match?.venue ? ` - ${match.venue}` : ''}
              </div>
            </div>
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 py-5">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <TabsList>
              <TabsTrigger value="summary">Overview</TabsTrigger>
              <TabsTrigger value="scoring">Scoring</TabsTrigger>
              <TabsTrigger value="possessions">Possessions</TabsTrigger>
              <TabsTrigger value="build_up">Build-Up</TabsTrigger>
              <TabsTrigger value="kickouts">Kickouts</TabsTrigger>
              <TabsTrigger value="misc">Misc</TabsTrigger>
              <TabsTrigger value="defense">Defense</TabsTrigger>
              <TabsTrigger value="fouls">Fouls</TabsTrigger>
              <TabsTrigger value="players_ana">Players</TabsTrigger>
              <TabsTrigger value="visualiser">Visualiser</TabsTrigger>
              <TabsTrigger value="data">Data</TabsTrigger>
            </TabsList>
            {showTopFiltersButton && (
              <Popover open={topFiltersOpen} onOpenChange={setTopFiltersOpen}>
                <PopoverTrigger asChild>
                  <Button type="button" variant="outline" size="sm" className="ml-auto gap-2">
                    <SlidersHorizontal className="h-4 w-4" />
                    Filters
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-[320px] max-w-[90vw] max-h-[80vh] overflow-y-auto p-4">
                  <div className="space-y-4">
                    {activeTab === 'summary' && (
                      <>
                        <div className="font-semibold text-slate-900">Overview Filters</div>
                        <div className="space-y-1">
                          <Label className="text-xs text-slate-600">Half</Label>
                          <Select value={overviewHalf} onValueChange={setOverviewHalf}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All Halves</SelectItem>
                              <SelectItem value="first">1st Half</SelectItem>
                              <SelectItem value="second">2nd Half</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </>
                    )}
                    {activeTab === 'scoring' && (
                      <>
                        <div className="font-semibold text-slate-900">Scoring Filters</div>
                        <ReportFiltersFields reportFilters={{ ...reportFilters, allowedActionTypes: ['shot'] }} playerOptions={playerOptions} homeTeam={homeTeam} awayTeam={awayTeam} />
                        <MultiSelect label="Shot Type" placeholder="All" values={scoringShotType} onChange={setScoringShotType} options={[{ value: 'point', label: '1 Point' }, { value: '2_point', label: '2 Point' }, { value: 'goal', label: 'Goal' }]} />
                        <MultiSelect label="Situation" placeholder="All" values={scoringSituation} onChange={setScoringSituation} options={['play', 'free_ground', 'free_hands', '45', 'penalty', 'mark'].map((v) => ({ value: v, label: toTitleCase(v) }))} />
                        <MultiSelect label="Pressure" placeholder="All" values={scoringPressure} onChange={setScoringPressure} options={['low', 'medium', 'high'].map((v) => ({ value: v, label: toTitleCase(v) }))} />
                        <MultiSelect label="Outcome" placeholder="All" values={scoringOutcome} onChange={setScoringOutcome} options={['goal', 'point', '2_point', 'wide', 'short', 'post', 'saved', 'blocked'].map((v) => ({ value: v, label: toTitleCase(v) }))} />
                        <MultiSelect label="Shot Zone" placeholder="All" values={scoringZone} onChange={setScoringZone} options={[{ value: 'inside_21', label: 'Inside 21' }, { value: '21_45', label: '21-45' }, { value: '45_65', label: '45-65' }, { value: '65_plus', label: '65+' }]} />
                      </>
                    )}
                    {activeTab === 'possessions' && (
                      <>
                        <div className="font-semibold text-slate-900">Possessions Filters</div>
                        <ReportFiltersFields reportFilters={{ ...reportFilters, allowedActionTypes: ['pass', 'carry', 'shot', 'turnover', 'kickout', 'throw_in', 'foul'] }} playerOptions={playerOptions} homeTeam={homeTeam} awayTeam={awayTeam} />
                        <div className="space-y-1">
                          <Label className="text-xs text-slate-600">Counter Attack</Label>
                          <Select value={possessionsCounterFilter} onValueChange={setPossessionsCounterFilter}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="any">Any</SelectItem>
                              <SelectItem value="set_attack">Set Attack</SelectItem>
                              <SelectItem value="counter_attack">Counter Attack</SelectItem>
                              <SelectItem value="counter_to_set">Counter -&gt; Set</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </>
                    )}
                    {activeTab === 'build_up' && (
                      <>
                        <div className="font-semibold text-slate-900">Build-Up Filters</div>
                        <ReportFiltersFields reportFilters={{ ...reportFilters, allowedActionTypes: ['pass', 'carry'] }} playerOptions={playerOptions} homeTeam={homeTeam} awayTeam={awayTeam} />
                        <MultiSelect label="Event Type" placeholder="Both" values={buildEventTypes} onChange={setBuildEventTypes} options={[{ value: 'pass', label: 'Pass' }, { value: 'carry', label: 'Carry' }]} />
                        <MultiSelect label="Pressure" placeholder="Any" values={buildPressure} onChange={setBuildPressure} options={[{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }]} />
                        <MultiSelect label="Outcome" placeholder="Any" values={buildOutcome} onChange={setBuildOutcome} options={[{ value: 'completed', label: 'Completed' }, { value: 'turnover', label: 'Turnover' }, { value: 'foul', label: 'Foul' }, { value: 'sideline_for', label: 'Sideline For' }, { value: 'sideline_against', label: 'Sideline Against' }, { value: '45_for', label: '45 For' }, { value: 'goal_kick_for', label: 'Goal Kick For' }, { value: 'goal_kick_against', label: 'Goal Kick Against' }]} />
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-xs text-slate-600">Progressive Only</div>
                          <Checkbox checked={buildProgressiveOnly} onCheckedChange={(v) => setBuildProgressiveOnly(!!v)} />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-slate-600">Network Team</Label>
                          <Select value={buildPnSide} onValueChange={setBuildPnSide}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="home">{homeTeam?.name || 'Home'}</SelectItem>
                              <SelectItem value="away">{awayTeam?.name || 'Away'}</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-slate-600">Minimum Passes For A Connection</Label>
                          <Input className="h-8 text-xs" inputMode="numeric" value={String(buildPnMin)} onChange={(e) => setBuildPnMin(Math.max(1, Number(e.target.value) || 1))} />
                        </div>
                      </>
                    )}
                    {activeTab === 'kickouts' && (
                      <>
                        <div className="font-semibold text-slate-900">Kickouts Filters</div>
                        <ReportFiltersFields reportFilters={{ ...reportFilters, allowedActionTypes: ['kickout', 'throw_in'] }} playerOptions={playerOptions} homeTeam={homeTeam} awayTeam={awayTeam} />
                      </>
                    )}
                    {activeTab === 'misc' && (
                      <>
                        <div className="font-semibold text-slate-900">Misc Filters</div>
                        <ReportFiltersFields reportFilters={{ ...reportFilters, allowedActionTypes: ['throw_in'] }} playerOptions={playerOptions} homeTeam={homeTeam} awayTeam={awayTeam} />
                      </>
                    )}
                    {activeTab === 'defense' && (
                      <>
                        <div className="font-semibold text-slate-900">Defense Filters</div>
                        <ReportFiltersFields reportFilters={{ ...reportFilters, team: 'both', allowedActionTypes: ['turnover', 'defensive_contact', 'foul'] }} playerOptions={playerOptions} homeTeam={homeTeam} awayTeam={awayTeam} />
                        <div className="space-y-1">
                          <Label className="text-xs text-slate-600">Event Category</Label>
                          <Select value={defenseEventCategory} onValueChange={setDefenseEventCategory}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All</SelectItem>
                              <SelectItem value="turnovers">Turnovers</SelectItem>
                              <SelectItem value="def_actions">Defensive Actions</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-slate-600">Turnover Result</Label>
                          <Select value={defenseTurnoverResult} onValueChange={setDefenseTurnoverResult}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="both">Both</SelectItem>
                              <SelectItem value="won">Won</SelectItem>
                              <SelectItem value="lost">Lost</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <MultiSelect label="Turnover Type" placeholder="Any" values={defenseTurnoverTypes} onChange={setDefenseTurnoverTypes} options={defenseTurnoverTypeOptions} />
                        <MultiSelect label="Defensive Action Type" placeholder="All" values={defenseDefTypes} onChange={setDefenseDefTypes} options={[{ value: 'contact', label: 'Contact' }, { value: 'dispossession', label: 'Dispossess' }, { value: 'block', label: 'Block' }]} />
                      </>
                    )}
                    {activeTab === 'fouls' && (
                      <>
                        <div className="font-semibold text-slate-900">Fouls Filters</div>
                        <ReportFiltersFields reportFilters={{ ...reportFilters, team: 'both', allowedActionTypes: ['foul', 'pass', 'carry', 'turnover', 'kickout', 'throw_in'] }} playerOptions={playerOptions} homeTeam={homeTeam} awayTeam={awayTeam} />
                      </>
                    )}
                    {activeTab === 'players_ana' && (
                      <>
                        <div className="font-semibold text-slate-900">Players Filters</div>
                        <ReportFiltersFields reportFilters={{ ...reportFilters, allowedActionTypes: ['shot', 'pass', 'carry', 'turnover', 'foul', 'kickout', 'throw_in', 'defensive_contact'] }} playerOptions={playerOptions} homeTeam={homeTeam} awayTeam={awayTeam} />
                        <div className="space-y-1">
                          <Label className="text-xs text-slate-600">Focus Player</Label>
                          <Select value={playersFocusPlayerId} onValueChange={setPlayersFocusPlayerId}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">All Players</SelectItem>
                              {(playerOptions || []).map((p) => (
                                <SelectItem key={p.id} value={p.id}>
                                  {(p.team_side === 'away' ? 'Away: ' : 'Home: ') + p.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </>
                    )}
                    {activeTab === 'visualiser' && (
                      <>
                        <div className="font-semibold text-slate-900">Visualiser Filters</div>
                        <div className="space-y-1">
                          <Label className="text-xs text-slate-600">Team</Label>
                          <Select value={vizTeam} onValueChange={setVizTeam}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="both">Both</SelectItem>
                              <SelectItem value="home">{homeTeam?.name || 'Home'}</SelectItem>
                              <SelectItem value="away">{awayTeam?.name || 'Away'}</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <MultiSelect label="Action" values={vizActions} onChange={setVizActions} options={['shot', 'kickout', 'pass', 'carry', 'turnover', 'foul', 'defensive_contact', 'throw_in'].map((v) => ({ value: v, label: toTitleCase(v) }))} />
                        <MultiSelect label="Half" values={vizHalves} onChange={setVizHalves} options={['first', 'second', 'et_first', 'et_second'].map((v) => ({ value: v, label: toTitleCase(v) }))} />
                        <MultiSelect label="Counter Attack" placeholder="Any" values={vizCounters} onChange={setVizCounters} options={[{ value: 'set_attack', label: 'Set Attack' }, { value: 'counter_attack', label: 'Counter Attack' }, { value: 'counter_to_set', label: 'Counter -> Set' }]} />
                        <MultiSelect label="Player" values={vizPlayerIds} onChange={setVizPlayerIds} options={playerOptions.map((p) => ({ value: p.id, label: (p.team_side === 'away' ? 'Away: ' : 'Home: ') + p.label }))} />
                        <div className="space-y-1">
                          <Label className="text-xs text-slate-600">Color By</Label>
                          <Select value={vizColorBy} onValueChange={setVizColorBy}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="team">Team</SelectItem>
                              <SelectItem value="action">Action</SelectItem>
                              <SelectItem value="outcome">Outcome</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="text-xs text-slate-500">Showing {filteredForViz.length} events.</div>
                      </>
                    )}
                  </div>
                </PopoverContent>
              </Popover>
            )}
          </div>

          <TabsContent value="summary">
            <OverviewTab
              homeTeam={homeTeam}
              awayTeam={awayTeam}
              scoreTimeline={scoreTimeline}
              summary={summary}
              overviewMomentum={overviewMomentum}
              overviewPossessionOutcome={overviewPossessionOutcome}
            />
          </TabsContent>

          <TabsContent value="visualiser">
            <VisualiserTab
              filteredForViz={filteredForViz}
              homeTeam={homeTeam}
              awayTeam={awayTeam}
              vizColorBy={vizColorBy}
              vizTeam={vizTeam}
            />
          </TabsContent>

          <TabsContent value="scoring">
            <ScoringTab
              stats={filteredForReport}
              homeTeam={homeTeam}
              awayTeam={awayTeam}
              playerOptions={playerOptions}
              reportFilters={reportFilters}
              shotType={scoringShotType}
              setShotType={setScoringShotType}
              situation={scoringSituation}
              setSituation={setScoringSituation}
              pressure={scoringPressure}
              setPressure={setScoringPressure}
              outcome={scoringOutcome}
              setOutcome={setScoringOutcome}
              zone={scoringZone}
              setZone={setScoringZone}
            />
          </TabsContent>

          <TabsContent value="possessions">
            <PossessionsTab
              stats={stats}
              homeTeam={homeTeam}
              awayTeam={awayTeam}
              playerOptions={playerOptions}
              reportFilters={reportFilters}
              counterFilter={possessionsCounterFilter}
              setCounterFilter={setPossessionsCounterFilter}
              onVisualisePossession={(p) => {
                const titleTeam = p?.teamSide === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home');
                openPossessionVisualiser({
                  title: `Possession #${p?.possessionId ?? 'NA'} - ${titleTeam}`,
                  stats: p?.stats,
                });
              }}
            />
          </TabsContent>

          <TabsContent value="build_up">
            <BuildUpTab
              stats={filteredForReport}
              homeTeam={homeTeam}
              awayTeam={awayTeam}
              reportFilters={reportFilters}
              eventTypes={buildEventTypes}
              setEventTypes={setBuildEventTypes}
              pressure={buildPressure}
              setPressure={setBuildPressure}
              outcome={buildOutcome}
              setOutcome={setBuildOutcome}
              progressiveOnly={buildProgressiveOnly}
              setProgressiveOnly={setBuildProgressiveOnly}
              pnSide={buildPnSide}
              setPnSide={setBuildPnSide}
              pnMin={buildPnMin}
              setPnMin={setBuildPnMin}
            />
          </TabsContent>

          <TabsContent value="kickouts">
            <RestartsTab
              stats={stats}
              homeTeam={homeTeam}
              awayTeam={awayTeam}
              playerOptions={playerOptions}
              reportFilters={reportFilters}
            />
          </TabsContent>

          <TabsContent value="misc">
            <MiscTab
              stats={stats}
              homeTeam={homeTeam}
              awayTeam={awayTeam}
              playerOptions={playerOptions}
              reportFilters={reportFilters}
            />
          </TabsContent>

          <TabsContent value="defense">
            <DefenseTab
              stats={stats}
              homeTeam={homeTeam}
              awayTeam={awayTeam}
              reportFilters={reportFilters}
              eventCategory={defenseEventCategory}
              setEventCategory={setDefenseEventCategory}
              turnoverResult={defenseTurnoverResult}
              setTurnoverResult={setDefenseTurnoverResult}
              turnoverTypes={defenseTurnoverTypes}
              setTurnoverTypes={setDefenseTurnoverTypes}
              defTypes={defenseDefTypes}
              setDefTypes={setDefenseDefTypes}
            />
          </TabsContent>

          <TabsContent value="fouls">
            <FoulsDisciplineTab
              stats={stats}
              homeTeam={homeTeam}
              awayTeam={awayTeam}
              playerOptions={playerOptions}
              reportFilters={reportFilters}
            />
          </TabsContent>

          <TabsContent value="players_ana">
            <PlayersAnalyticsTab
              stats={stats}
              homeTeam={homeTeam}
              awayTeam={awayTeam}
              playerOptions={playerOptions}
              reportFilters={reportFilters}
              focusPlayerId={playersFocusPlayerId}
              setFocusPlayerId={setPlayersFocusPlayerId}
            />
          </TabsContent>

          <TabsContent value="data">
            <DataTab
              matchId={matchId}
              match={match}
              stats={stats}
              homeTeam={homeTeam}
              awayTeam={awayTeam}
              homePlayers={homePlayers}
              awayPlayers={awayPlayers}
            />
          </TabsContent>
        </Tabs>
      </main>

      <Dialog open={sharedVizOpen} onOpenChange={setSharedVizOpen}>
        <DialogContent className="sm:max-w-4xl p-4">
          <DialogHeader>
            <div className="flex items-center justify-between gap-2">
              <DialogTitle className="text-base">{sharedVizTitle || 'Visualise'}</DialogTitle>
              {(() => {
                const times = (sharedVizStats || []).map((s) => Number(s?.time_s)).filter(Number.isFinite);
                if (!times.length) return null;
                const t = Math.min(...times);
                return (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 px-3 text-xs"
                    onClick={() => openSharedVideoAt(t)}
                    title="Open the video popout and jump to this timestamp"
                  >
                    Open Video @ {formatMMSS(Math.max(0, t - SHARED_VIZ_PRE_ROLL_S))}
                  </Button>
                );
              })()}
            </div>
          </DialogHeader>
          <div className="pt-2">
            <PitchViz
              stats={sharedVizStats}
              homeColor={homeTeam?.color}
              awayColor={awayTeam?.color}
              colorBy="team"
              showColorControls={false}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
