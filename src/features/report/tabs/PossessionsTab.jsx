import React, { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ChartContainer, ChartTooltipContent } from '@/components/ui/chart';
import { BarChart, Bar, CartesianGrid, Legend, LineChart, Line, PieChart, Pie, Cell, Tooltip, ReferenceLine, XAxis, YAxis } from 'recharts';
import pitchImg from '@/assets/pitch.png';
import {
  PITCH_W,
  PITCH_H,
  calcDistanceToGoal,
  classifyTerminalOutcome,
  extractFoulFromStat,
  findScorableFreeConcededRows,
  getAttackEntryChannelForPossession,
  getFieldTiltContribution,
  getDerivedPossessionDurationSeconds,
  getMatchTimeS,
  getPossessionTimeSummary,
  isDeadBallGapStart,
  getProgressiveMeters,
  getScoringZoneEntry,
  isAttackPossession,
  isBroughtBackAdvantageStat,
  isProgressive as isProgressiveShared,
  shotOutcomeGroup,
  shotPointsForOutcome,
  normalizeFoulType,
} from '@/lib/reportAnalytics';
import {
  safeParseJSON,
  toTitleCase,
  deriveOutcome,
  formatMMSS,
  formatPct,
  sortRows,
  SortableTableHead,
  groupByPossession,
  derivePossessionOutcome,
  deriveCounterAttackState,
  defenceSetStateKey,
  inferPossessionStartSource,
  getCompletedReceiptSelection,
  getPrimaryActorSelection,
  getKeeperCandidate,
  isGoalkeeperPlayer,
  buildShotAssistCredits,
  buildTouchesMap,
  getPossessionStartZone,
  selectionKey,
  normalizePlayerRef,
  teamRowTint,
  ComparisonMetricsCard,
  PitchViz,
  AttackChannelPitch,
  PassNetwork,
  ShotMap,
  shotSideFromY,
  shotZoneFromDistance,
  applyNonTeamReportFilters,
} from '../shared';

function getLivePossessionStartAnchor(previousStat, startSource, match, imputedMap) {
  if (!previousStat || isDeadBallGapStart(previousStat)) return NaN;
  const source = String(startSource || '');
  const allowedSource =
    source === 'Turnover Won'
    || source === 'Shot Short'
    || source === 'Shot Blocked'
    || source === 'Shot Post'
    || source === 'Shot Saved';
  if (!allowedSource) return NaN;

  const previousTeam =
    previousStat?.possession_team_side === 'home' || previousStat?.possession_team_side === 'away'
      ? previousStat.possession_team_side
      : previousStat?.team_side;
  const terminal = classifyTerminalOutcome(previousStat, previousTeam);
  const isMatchingTerminal =
    (source === 'Turnover Won' && terminal === 'TURNOVER')
    || (source === 'Shot Short' && terminal === 'SHORT')
    || (source === 'Shot Blocked' && terminal === 'BLOCKED')
    || (source === 'Shot Post' && terminal === 'POST')
    || (source === 'Shot Saved' && terminal === 'SAVED');
  if (!isMatchingTerminal) return NaN;
  return getMatchTimeS(previousStat, match, imputedMap);
}

const PHYSICAL_ZONE_LABELS = ['Left 45', 'Middle', 'Right 45'];
const POSSESSION_DURATION_BINS = [
  { label: '0-5s', min: 0, max: 5 },
  { label: '5-10s', min: 5, max: 10 },
  { label: '10-20s', min: 10, max: 20 },
  { label: '20-30s', min: 20, max: 30 },
  { label: '30-45s', min: 30, max: 45 },
  { label: '45-60s', min: 45, max: 60 },
  { label: '60s+', min: 60, max: Infinity },
];

function getDirectionByPeriod(match) {
  const fallback = { first: 'right', second: 'left', et_first: 'right', et_second: 'left' };
  const raw = match?.direction_by_period;
  if (!raw) return fallback;
  if (typeof raw === 'object') return { ...fallback, ...raw };
  try {
    return { ...fallback, ...JSON.parse(raw) };
  } catch {
    return fallback;
  }
}

function homeAttacksRightForStat(match, stat) {
  const half = String(stat?.half || 'first');
  return getDirectionByPeriod(match)?.[half] !== 'left';
}

function getFixedDirectionX(stat, match, possessionTeamSide, fallbackKey = 'x_position') {
  const raw = Number(stat?.raw_x_position);
  if (Number.isFinite(raw)) {
    return homeAttacksRightForStat(match, stat) ? raw : PITCH_W - raw;
  }

  const fallback = Number(stat?.[fallbackKey]);
  if (!Number.isFinite(fallback)) return NaN;
  if (possessionTeamSide === 'away') return PITCH_W - fallback;
  return fallback;
}

function getFixedDirectionEndX(stat, match, possessionTeamSide) {
  const rawEnd = Number(stat?.raw_end_x_position);
  if (Number.isFinite(rawEnd)) {
    return homeAttacksRightForStat(match, stat) ? rawEnd : PITCH_W - rawEnd;
  }
  const rawStart = Number(stat?.raw_x_position);
  if (Number.isFinite(rawStart)) {
    return homeAttacksRightForStat(match, stat) ? rawStart : PITCH_W - rawStart;
  }
  const end = Number(stat?.end_x_position);
  if (Number.isFinite(end)) return possessionTeamSide === 'away' ? PITCH_W - end : end;
  const start = Number(stat?.x_position);
  if (!Number.isFinite(start)) return NaN;
  return possessionTeamSide === 'away' ? PITCH_W - start : start;
}

function splitPhysicalZoneDuration(fromX, toX, duration) {
  const seconds = Number(duration);
  const a = Number(fromX);
  const b = Number(toX);
  const out = Object.fromEntries(PHYSICAL_ZONE_LABELS.map((z) => [z, 0]));
  if (!Number.isFinite(seconds) || seconds <= 0) return out;
  if (!Number.isFinite(a) && !Number.isFinite(b)) return out;
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(b - a) < 0.001) {
    const x = Number.isFinite(a) ? a : b;
    if (x < 45) out['Left 45'] += seconds;
    else if (x < PITCH_W - 45) out.Middle += seconds;
    else out['Right 45'] += seconds;
    return out;
  }

  const minX = Math.max(0, Math.min(a, b));
  const maxX = Math.min(PITCH_W, Math.max(a, b));
  const total = Math.max(0.001, maxX - minX);
  [
    ['Left 45', 0, 45],
    ['Middle', 45, PITCH_W - 45],
    ['Right 45', PITCH_W - 45, PITCH_W],
  ].forEach(([zone, start, end]) => {
    const overlap = Math.max(0, Math.min(maxX, end) - Math.max(minX, start));
    if (overlap > 0) out[zone] += seconds * (overlap / total);
  });
  return out;
}

function getPhysicalPossessionZoneSeconds(events, match, imputedMap, startAnchorTimeS, possessionTeamSide) {
  const ordered = (Array.isArray(events) ? events : [])
    .filter((s) => s && !['substitution', 'period_end'].includes(String(s?.stat_type || '')))
    .slice()
    .sort((a, b) => {
      const pa = Number(a?.play_id);
      const pb = Number(b?.play_id);
      if (Number.isFinite(pa) && Number.isFinite(pb) && pa !== pb) return pa - pb;
      const ta = getMatchTimeS(a, match, imputedMap);
      const tb = getMatchTimeS(b, match, imputedMap);
      if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
      return String(a?.id || '').localeCompare(String(b?.id || ''));
    });
  const out = Object.fromEntries(PHYSICAL_ZONE_LABELS.map((z) => [z, 0]));
  const add = (parts) => PHYSICAL_ZONE_LABELS.forEach((z) => { out[z] += Number(parts?.[z] || 0); });

  const first = ordered[0] || null;
  const anchor = Number(startAnchorTimeS);
  if (first && Number.isFinite(anchor)) {
    const firstTime = getMatchTimeS(first, match, imputedMap);
    if (Number.isFinite(firstTime) && firstTime >= anchor) {
      const firstX = getFixedDirectionX(first, match, possessionTeamSide);
      add(splitPhysicalZoneDuration(firstX, firstX, firstTime - anchor));
    }
  }

  for (let i = 0; i < ordered.length - 1; i += 1) {
    const current = ordered[i];
    const next = ordered[i + 1];
    if (isDeadBallGapStart(current)) continue;
    const a = getMatchTimeS(current, match, imputedMap);
    const b = getMatchTimeS(next, match, imputedMap);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) continue;
    add(splitPhysicalZoneDuration(
      getFixedDirectionX(current, match, possessionTeamSide),
      getFixedDirectionEndX(current, match, possessionTeamSide),
      b - a,
    ));
  }
  return out;
}

function PossessionZonePitch({ homeTeam, awayTeam, homeColor, awayColor, zoneSeconds }) {
  const zones = [
    { key: 'Left 45', x: 0, width: 45 },
    { key: 'Middle', x: 45, width: PITCH_W - 90 },
    { key: 'Right 45', x: PITCH_W - 45, width: 45 },
  ];
  const home = zoneSeconds?.home || {};
  const away = zoneSeconds?.away || {};
  const totalPossession = zones.reduce((sum, z) => sum + Number(home[z.key] || 0) + Number(away[z.key] || 0), 0);
  const pct = (value) => totalPossession > 0 ? `${((Number(value || 0) / totalPossession) * 100).toFixed(1)}%` : '0.0%';
  const homeName = homeTeam?.name || 'Home';
  const awayName = awayTeam?.name || 'Away';
  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-900/5" style={{ aspectRatio: `${PITCH_W} / ${PITCH_H}`, backgroundImage: `url(${pitchImg})`, backgroundSize: 'cover', backgroundPosition: 'center' }}>
      <div className="absolute left-3 top-3 z-10 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold shadow-sm" style={{ color: homeColor || '#fb4b14' }}>
        {homeName} attacks &rarr;
      </div>
      <div className="absolute right-3 top-3 z-10 rounded-full bg-white/90 px-3 py-1 text-xs font-semibold shadow-sm" style={{ color: awayColor || '#5b1f32' }}>
        &lt;- {awayName} attacks
      </div>
      <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${PITCH_W} ${PITCH_H}`} preserveAspectRatio="none">
        {zones.map((zone, index) => (
          <g key={zone.key}>
            <rect
              x={zone.x}
              y="0"
              width={zone.width}
              height={PITCH_H}
              fill={index % 2 === 0 ? 'rgba(15,23,42,0.10)' : 'rgba(255,255,255,0.08)'}
              stroke="rgba(255,255,255,0.55)"
              strokeWidth="0.35"
            />
          </g>
        ))}
      </svg>
      <div className="absolute inset-0 grid grid-cols-3">
        {zones.map((zone) => (
          <div key={zone.key} className="flex flex-col items-center justify-center gap-1 px-2 text-center drop-shadow">
            <div className="text-[0.7rem] font-semibold uppercase tracking-wide text-white/85">{zone.key}</div>
            <div className="text-sm font-bold" style={{ color: homeColor || '#fb4b14' }}>{homeName}: {pct(home[zone.key])}</div>
            <div className="text-sm font-bold" style={{ color: awayColor || '#5b1f32' }}>{awayName}: {pct(away[zone.key])}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PossessionsTab({ stats, homeTeam, awayTeam, reportFilters, onVisualisePossession, counterFilter, setCounterFilter }) {
  const outcomeSeries = [
    { k: 'Score', c: '#059669' },
    { k: 'Missed Shot', c: '#eab308' },
    { k: 'Turnover', c: '#f97316' },
    { k: 'Half End', c: '#64748b' },
  ];
  const scopedReportFilters = useMemo(() => ({ ...reportFilters, allowedActionTypes: ['pass', 'carry', 'shot', 'turnover', 'kickout', 'throw_in', 'foul'] }), [reportFilters]);
  const possessionLevelFilters = useMemo(() => ({
    ...scopedReportFilters,
    actionTypes: [],
    outcomes: [],
    playerIds: [],
  }), [scopedReportFilters]);
  const base = useMemo(() => applyNonTeamReportFilters(stats, possessionLevelFilters), [stats, possessionLevelFilters]);
  const teamMode = String(reportFilters?.team || 'both'); // both|home|away

  const possessions = useMemo(() => {
    const groups = groupByPossession(base);
    const orderedBase = base.slice().sort((a, b) => {
      const pa = Number(a?.play_id);
      const pb = Number(b?.play_id);
      if (Number.isFinite(pa) && Number.isFinite(pb) && pa !== pb) return pa - pb;
      const ta = getMatchTimeS(a, reportFilters?.match, reportFilters?.imputedTimeById);
      const tb = getMatchTimeS(b, reportFilters?.match, reportFilters?.imputedTimeById);
      if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
      return String(a?.id || '').localeCompare(String(b?.id || ''));
    });
    const statsByPossessionKey = new Map();
    const previousByPossessionKey = new Map();
    orderedBase.forEach((stat, index) => {
      const pid = Number(stat?.possession_id);
      const pside = stat?.possession_team_side;
      if (!Number.isFinite(pid) || (pside !== 'home' && pside !== 'away')) return;
      const key = `${pside}-${pid}`;
      const arr = statsByPossessionKey.get(key) || [];
      arr.push(stat);
      statsByPossessionKey.set(key, arr);
      if (!previousByPossessionKey.has(key)) {
        previousByPossessionKey.set(key, index > 0 ? orderedBase[index - 1] : null);
      }
    });

    const out = [];
    for (const [key, evs0] of groups.entries()) {
      const [teamSide, pidStr] = String(key).split('-');
      const pid = Number(pidStr);
      if (teamSide !== 'home' && teamSide !== 'away') continue;
      if (!Number.isFinite(pid)) continue;

      const evs = (Array.isArray(evs0) ? evs0 : []).slice();

      const acting = evs.filter((e) => e && e.team_side === teamSide);
      if (!acting.length) continue;

      const outcome = derivePossessionOutcome(evs, teamSide);
      const times = evs.map((s) => getMatchTimeS(s, reportFilters?.match, reportFilters?.imputedTimeById)).filter(Number.isFinite);
      const firstEventTime = times.length ? Math.min(...times) : NaN;
      const endTime = times.length ? Math.max(...times) : NaN;
      const previousStat = previousByPossessionKey.get(key) || null;
      const startSource = inferPossessionStartSource(evs, teamSide, previousStat || []);
      const liveDuration = getDerivedPossessionDurationSeconds(evs, reportFilters?.match, reportFilters?.imputedTimeById);
      const liveStartAnchor = getLivePossessionStartAnchor(previousStat, startSource, reportFilters?.match, reportFilters?.imputedTimeById);
      const startTime = Number.isFinite(liveStartAnchor) ? liveStartAnchor : firstEventTime;
      const timeSummary = getPossessionTimeSummary(evs, teamSide, reportFilters?.match, reportFilters?.imputedTimeById, { startAnchorTimeS: liveStartAnchor });
      const physicalZoneSeconds = getPhysicalPossessionZoneSeconds(evs, reportFilters?.match, reportFilters?.imputedTimeById, liveStartAnchor, teamSide);
      const anchorGap =
        Number.isFinite(liveStartAnchor) && Number.isFinite(firstEventTime) && firstEventTime >= liveStartAnchor
          ? firstEventTime - liveStartAnchor
          : 0;
      const duration = Number.isFinite(timeSummary.liveSeconds)
        ? timeSummary.liveSeconds
        : Number.isFinite(liveDuration)
        ? liveDuration + anchorGap
        : (Number.isFinite(startTime) && Number.isFinite(endTime) ? Math.max(0, endTime - startTime) : NaN);

      const points = acting.reduce((a, e) => {
        if (e.stat_type !== 'shot') return a;
        if (isBroughtBackAdvantageStat(e)) return a;
        const ex = safeParseJSON(e.extra_data || '{}', {});
        return a + shotPointsForOutcome(ex?.shot?.outcome);
      }, 0);

      const isAttack = isAttackPossession(evs, teamSide);
      const passes = acting.filter((e) => e.stat_type === 'pass' && deriveOutcome(e, safeParseJSON(e.extra_data || '{}', {})) === 'completed').length;
      const shots = acting.filter((e) => e.stat_type === 'shot' && !isBroughtBackAdvantageStat(e)).length;
      const counterState = deriveCounterAttackState(acting);
      const attackEntryChannel = isAttack ? getAttackEntryChannelForPossession(evs, teamSide) : '';
      const startZone = getPossessionStartZone(acting);

      out.push({
        key,
        teamSide,
        possessionId: pid,
        half: acting[0]?.half || '',
        startTime,
        endTime,
        duration,
        startSource,
        outcome,
        isAttack,
        passes,
        shots,
        points,
        counterState,
        attackEntryChannel,
        startZone,
        zoneSeconds: timeSummary.zoneSeconds || {},
        physicalZoneSeconds,
        stats: evs,
      });
    }

    out.sort((a, b) => {
      if (Number.isFinite(a.possessionId) && Number.isFinite(b.possessionId) && a.possessionId !== b.possessionId) return a.possessionId - b.possessionId;
      if (a.teamSide !== b.teamSide) return String(a.teamSide).localeCompare(String(b.teamSide));
      return String(a.key).localeCompare(String(b.key));
    });
    return out;
  }, [base, reportFilters]);

  const possessionsFiltered = useMemo(() => {
    if (counterFilter === 'any') return possessions;
    return possessions.filter((p) => defenceSetStateKey(p.counterState) === counterFilter);
  }, [possessions, counterFilter]);

  const attacks = useMemo(() => possessionsFiltered.filter((p) => p.isAttack), [possessionsFiltered]);

  const sideKpis = useMemo(() => {
    const calc = (rows) => {
      const possN = rows.length;
      const att = rows.filter((p) => p.isAttack);
      const attN = att.length;
      const totalPts = rows.reduce((a, p) => a + (p.points || 0), 0);
      const pointsPerPossession = possN ? totalPts / possN : NaN;
      const ds = rows.map((p) => p.duration).filter(Number.isFinite);
      const livePossessionSeconds = ds.reduce((a, b) => a + b, 0);
      const avgDur = ds.length ? ds.reduce((a, b) => a + b, 0) / ds.length : NaN;
      const possToAttack = possN ? (attN / possN) * 100 : NaN;
      const possToShot = possN ? (rows.filter((p) => p.shots > 0).length / possN) * 100 : NaN;
      const attToShot = attN ? (att.filter((p) => p.shots > 0).length / attN) * 100 : NaN;
      const passesPerPoss = possN ? rows.reduce((a, p) => a + (p.passes || 0), 0) / possN : NaN;
      const scoringPoss = possN ? (rows.filter((p) => Number(p.points || 0) > 0).length / possN) * 100 : NaN;
      const counterPoss = possN ? (rows.filter((p) => defenceSetStateKey(p.counterState) === 'defence_set_yes').length / possN) * 100 : NaN;
      const channels = { Left: 0, Middle: 0, Right: 0 };
      rows.filter((p) => p.isAttack).forEach((p) => {
        if (channels[p.attackEntryChannel] != null) channels[p.attackEntryChannel] += 1;
      });
      return { possN, attN, pointsPerPossession, livePossessionSeconds, avgDur, possToAttack, possToShot, attToShot, passesPerPoss, scoringPoss, counterPoss, channels };
    };
    const home = calc(possessionsFiltered.filter((p) => p.teamSide === 'home'));
    const away = calc(possessionsFiltered.filter((p) => p.teamSide === 'away'));
    const totalLive = Number(home.livePossessionSeconds || 0) + Number(away.livePossessionSeconds || 0);
    return {
      home: { ...home, possessionPct: totalLive ? (Number(home.livePossessionSeconds || 0) / totalLive) * 100 : NaN },
      away: { ...away, possessionPct: totalLive ? (Number(away.livePossessionSeconds || 0) / totalLive) * 100 : NaN },
    };
  }, [possessionsFiltered]);

  const byTeam = (rows) => {
    const out = {
      home: Object.fromEntries(outcomeSeries.map((o) => [o.k, 0])),
      away: Object.fromEntries(outcomeSeries.map((o) => [o.k, 0])),
    };
    for (const r of rows) {
      const side = r.teamSide;
      if (!out[side]) continue;
      const raw = String(r.outcome || 'Turnover');
      const k = ['Wide', 'Short', 'Blocked', 'Saved', 'Post'].includes(raw) ? 'Missed Shot' : raw;
      if (out[side][k] == null) out[side][k] = 0;
      out[side][k] += 1;
    }
    const rowsOut = [];
    if (teamMode === 'both' || teamMode === 'home') rowsOut.push({ team: homeTeam?.name || 'Home', side: 'home', ...out.home });
    if (teamMode === 'both' || teamMode === 'away') rowsOut.push({ team: awayTeam?.name || 'Away', side: 'away', ...out.away });
    return rowsOut;
  };

  const possessionOutcomeData = useMemo(() => byTeam(possessionsFiltered), [possessionsFiltered, homeTeam, awayTeam, teamMode]);
  const attackOutcomeData = useMemo(() => byTeam(attacks), [attacks, homeTeam, awayTeam, teamMode]);
  const startZoneData = useMemo(() => {
    const zones = ['Defensive Third', 'Middle Third', 'Attacking Third'];
    const counts = {
      home: Object.fromEntries(zones.map((z) => [z, 0])),
      away: Object.fromEntries(zones.map((z) => [z, 0])),
    };
    for (const p of possessionsFiltered) {
      if (!counts[p.teamSide] || counts[p.teamSide][p.startZone] == null) continue;
      counts[p.teamSide][p.startZone] += 1;
    }
    const rows = [];
    if (teamMode === 'both' || teamMode === 'home') {
      rows.push({ team: homeTeam?.name || 'Home', side: 'home', ...counts.home });
    }
    if (teamMode === 'both' || teamMode === 'away') {
      rows.push({ team: awayTeam?.name || 'Away', side: 'away', ...counts.away });
    }
    return rows;
  }, [possessionsFiltered, homeTeam, awayTeam, teamMode]);

  const possessionZoneTimeData = useMemo(() => {
    const zones = ['Defensive Third', 'Middle Third', 'Attacking Third', 'Unknown'];
    const seconds = {
      home: Object.fromEntries(zones.map((z) => [z, 0])),
      away: Object.fromEntries(zones.map((z) => [z, 0])),
    };
    for (const p of possessionsFiltered) {
      if (!seconds[p.teamSide]) continue;
      for (const z of zones) seconds[p.teamSide][z] += Number(p.zoneSeconds?.[z] || 0);
    }
    const rows = [];
    if (teamMode === 'both' || teamMode === 'home') {
      rows.push({ team: homeTeam?.name || 'Home', side: 'home', ...seconds.home });
    }
    if (teamMode === 'both' || teamMode === 'away') {
      rows.push({ team: awayTeam?.name || 'Away', side: 'away', ...seconds.away });
    }
    return rows;
  }, [possessionsFiltered, homeTeam, awayTeam, teamMode]);

  const possessionPhysicalZoneSeconds = useMemo(() => {
    const zones = PHYSICAL_ZONE_LABELS;
    const seconds = {
      home: Object.fromEntries(zones.map((z) => [z, 0])),
      away: Object.fromEntries(zones.map((z) => [z, 0])),
    };
    for (const p of possessionsFiltered) {
      if (!seconds[p.teamSide]) continue;
      for (const z of zones) seconds[p.teamSide][z] += Number(p.physicalZoneSeconds?.[z] || 0);
    }
    return seconds;
  }, [possessionsFiltered]);

  const possessionDurationDistributionData = useMemo(() => {
    const rows = POSSESSION_DURATION_BINS.map((bin) => ({
      bin: bin.label,
      home: 0,
      away: 0,
    }));
    for (const p of possessionsFiltered) {
      const duration = Number(p?.duration);
      if (!Number.isFinite(duration) || duration < 0) continue;
      const side = p?.teamSide;
      if (side !== 'home' && side !== 'away') continue;
      const index = POSSESSION_DURATION_BINS.findIndex((bin) => duration >= bin.min && duration < bin.max);
      if (index >= 0) rows[index][side] += 1;
    }
    return rows;
  }, [possessionsFiltered]);

  const originTableRows = useMemo(() => {
    const allowed = ['Turnover Won', 'Kickout Won', 'Throw In Won', 'Shot Short', 'Shot Blocked', 'Shot Post', 'Shot Saved', 'Open Play'];
    const counts = {};
    for (const key of allowed) counts[key] = { label: key, home: 0, away: 0 };
    for (const p of possessionsFiltered) {
      const source = allowed.includes(p.startSource) ? p.startSource : 'Open Play';
      if (p.teamSide === 'home') counts[source].home += 1;
      if (p.teamSide === 'away') counts[source].away += 1;
    }
    return allowed
      .map((key) => counts[key])
      .filter((row) => row.home > 0 || row.away > 0 || row.label === 'Open Play');
  }, [possessionsFiltered]);
  const [originSort, setOriginSort] = useState({ key: 'home', dir: 'desc' });
  const originColumns = useMemo(() => ([
    { key: 'label', label: 'Event', sortValue: (r) => r.label },
    { key: 'home', label: homeTeam?.name || 'Home', sortValue: (r) => r.home },
    { key: 'away', label: awayTeam?.name || 'Away', sortValue: (r) => r.away },
  ]), [homeTeam, awayTeam]);
  const sortedOriginRows = useMemo(() => sortRows(originTableRows, originSort, originColumns, 'label'), [originTableRows, originSort, originColumns]);
  const toggleOriginSort = (key) => setOriginSort((current) => current.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'label' ? 'asc' : 'desc' });
  const renderOutcomeTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    const row = payload[0]?.payload || {};
    const total = outcomeSeries.reduce((sum, item) => sum + Number(row?.[item.k] || 0), 0);
    return (
      <div className="rounded-md border bg-white px-3 py-2 text-xs shadow-sm">
        <div className="mb-1 font-semibold text-slate-900">{label || row.team || 'Outcomes'}</div>
        <div className="mb-2 text-slate-600">Total Possessions: <span className="font-mono">{total}</span></div>
        <div className="space-y-1">
          {outcomeSeries.map((item) => (
            <div key={item.k} className="flex items-center justify-between gap-3">
              <span>{item.k}</span>
              <span className="font-mono">{Number(row?.[item.k] || 0)}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };
  const [possessionSort, setPossessionSort] = useState({ key: 'possessionId', dir: 'asc' });
  const possessionColumns = useMemo(() => ([
    { key: 'possessionId', label: 'Poss', sortValue: (r) => r.possessionId },
    { key: 'team', label: 'Team', sortValue: (r) => r.teamSide === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home') },
    { key: 'half', label: 'Half', sortValue: (r) => r.half },
    { key: 'startTime', label: 'Start', sortValue: (r) => r.startTime },
    { key: 'endTime', label: 'End', sortValue: (r) => r.endTime },
    { key: 'duration', label: 'Dur', sortValue: (r) => r.duration },
    { key: 'startSource', label: 'Start Source', sortValue: (r) => r.startSource },
    { key: 'outcome', label: 'Outcome', sortValue: (r) => r.outcome },
    { key: 'passes', label: 'Completed Passes', sortValue: (r) => r.passes },
    { key: 'points', label: 'Pts', sortValue: (r) => r.points },
    { key: 'attack', label: 'Attack', sortValue: (r) => (r.isAttack ? 1 : 0) },
    { key: 'startZone', label: 'Start Zone', sortValue: (r) => r.startZone },
    { key: 'counterState', label: 'Set Defence', sortValue: (r) => r.counterState },
  ]), [homeTeam, awayTeam]);
  const sortedPossessions = useMemo(() => sortRows(possessionsFiltered, possessionSort, possessionColumns, 'key'), [possessionsFiltered, possessionSort, possessionColumns]);
  const togglePossessionSort = (key) => setPossessionSort((current) => current.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'team' || key === 'half' || key === 'startSource' || key === 'outcome' || key === 'startZone' || key === 'counterState' ? 'asc' : 'desc' });
  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-2">
        <ComparisonMetricsCard
          title="Possession Metrics"
          cardClassName="w-full"
          homeTeam={homeTeam}
          awayTeam={awayTeam}
          teamMode={teamMode}
          rows={[
            { label: 'Possessions', home: sideKpis.home.possN, away: sideKpis.away.possN },
            { label: 'Attacks', home: sideKpis.home.attN, away: sideKpis.away.attN },
            { label: 'Possession %', home: formatPct(sideKpis.home.possessionPct), away: formatPct(sideKpis.away.possessionPct) },
            { label: 'Live Possession Time', home: Number.isFinite(sideKpis.home.livePossessionSeconds) ? formatMMSS(sideKpis.home.livePossessionSeconds) : 'NA', away: Number.isFinite(sideKpis.away.livePossessionSeconds) ? formatMMSS(sideKpis.away.livePossessionSeconds) : 'NA' },
            { label: 'Points Per Possession', home: Number.isFinite(sideKpis.home.pointsPerPossession) ? sideKpis.home.pointsPerPossession.toFixed(2) : 'NA', away: Number.isFinite(sideKpis.away.pointsPerPossession) ? sideKpis.away.pointsPerPossession.toFixed(2) : 'NA' },
            { label: 'Avg Possession Duration', home: Number.isFinite(sideKpis.home.avgDur) ? `${sideKpis.home.avgDur.toFixed(1)}s` : 'NA', away: Number.isFinite(sideKpis.away.avgDur) ? `${sideKpis.away.avgDur.toFixed(1)}s` : 'NA' },
            { label: 'Possession To Attack %', home: formatPct(sideKpis.home.possToAttack), away: formatPct(sideKpis.away.possToAttack) },
            { label: 'Possession To Shot %', home: formatPct(sideKpis.home.possToShot), away: formatPct(sideKpis.away.possToShot) },
            { label: 'Attack To Shot %', home: formatPct(sideKpis.home.attToShot), away: formatPct(sideKpis.away.attToShot) },
            { label: 'Completed Passes Per Possession', home: Number.isFinite(sideKpis.home.passesPerPoss) ? sideKpis.home.passesPerPoss.toFixed(2) : 'NA', away: Number.isFinite(sideKpis.away.passesPerPoss) ? sideKpis.away.passesPerPoss.toFixed(2) : 'NA' },
            { label: 'Scoring Possession %', home: formatPct(sideKpis.home.scoringPoss), away: formatPct(sideKpis.away.scoringPoss) },
            { label: 'Set Defence Possession %', home: formatPct(sideKpis.home.counterPoss), away: formatPct(sideKpis.away.counterPoss) },
          ]}
        />
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="font-semibold text-slate-900">Possession Outcomes</div>
              <ChartContainer id="possession-outcomes" className="h-[240px] w-full" config={{}}>
                <BarChart data={possessionOutcomeData} margin={{ top: 10, right: 16, left: 0, bottom: 6 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="team" className="text-xs" />
                  <YAxis allowDecimals={false} className="text-xs" />
                  <Tooltip content={renderOutcomeTooltip} />
                  <Legend />
                  {outcomeSeries.map((o) => (
                    <Bar key={o.k} dataKey={o.k} stackId="a" fill={o.c} />
                  ))}
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="font-semibold text-slate-900">Attack Outcomes</div>
              <ChartContainer id="attack-outcomes-poss" className="h-[240px] w-full" config={{}}>
                <BarChart data={attackOutcomeData} margin={{ top: 10, right: 16, left: 0, bottom: 6 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="team" className="text-xs" />
                  <YAxis allowDecimals={false} className="text-xs" />
                  <Tooltip content={renderOutcomeTooltip} />
                  <Legend />
                  {outcomeSeries.map((o) => (
                    <Bar key={o.k} dataKey={o.k} stackId="a" fill={o.c} />
                  ))}
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>
        </div>
      </div>

        {possessionsFiltered.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-sm text-slate-600 text-center">
              No possessions available for current filters.
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid lg:grid-cols-[1fr_1fr] gap-4">
              <Card>
                <CardContent className="p-4 space-y-3">
                  <div>
                    <div className="font-semibold text-slate-900">Possession Duration Distribution</div>
                    <div className="text-xs text-slate-500">Number of possessions by live possession length.</div>
                  </div>
                  <ChartContainer id="possession-duration-distribution" className="h-[260px] w-full" config={{}}>
                    <BarChart data={possessionDurationDistributionData} margin={{ top: 12, right: 16, left: 0, bottom: 6 }}>
                      <CartesianGrid vertical={false} />
                      <XAxis dataKey="bin" className="text-xs" />
                      <YAxis allowDecimals={false} className="text-xs" />
                      <Tooltip content={<ChartTooltipContent />} />
                      <Legend />
                      {(teamMode === 'both' || teamMode === 'home') && (
                        <Bar dataKey="home" name={homeTeam?.name || 'Home'} fill={homeTeam?.color || '#fb4b14'} radius={[4, 4, 0, 0]} />
                      )}
                      {(teamMode === 'both' || teamMode === 'away') && (
                        <Bar dataKey="away" name={awayTeam?.name || 'Away'} fill={awayTeam?.color || '#5b1f32'} radius={[4, 4, 0, 0]} />
                      )}
                    </BarChart>
                  </ChartContainer>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4 space-y-3">
                  <div>
                    <div className="font-semibold text-slate-900">Possession Time By Zone</div>
                    <div className="text-xs text-slate-500">Physical pitch view. Percentages are share of total live possession time.</div>
                  </div>
                  <PossessionZonePitch
                    homeTeam={homeTeam}
                    awayTeam={awayTeam}
                    homeColor={homeTeam?.color || '#fb4b14'}
                    awayColor={awayTeam?.color || '#5b1f32'}
                    zoneSeconds={possessionPhysicalZoneSeconds}
                  />
                </CardContent>
              </Card>
            </div>

            <div className="grid lg:grid-cols-2 gap-4">
              <Card>
                <CardContent className="p-4 space-y-3">
                  <div className="font-semibold text-slate-900">Possession Origins</div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <SortableTableHead column={originColumns[0]} sortState={originSort} onToggle={toggleOriginSort} />
                        <SortableTableHead column={originColumns[1]} sortState={originSort} onToggle={toggleOriginSort} className="text-right" />
                        <SortableTableHead column={originColumns[2]} sortState={originSort} onToggle={toggleOriginSort} className="text-right" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedOriginRows.map((row) => (
                        <TableRow key={row.label}>
                          <TableCell className="font-medium">{row.label}</TableCell>
                          <TableCell className="text-right tabular-nums">{row.home}</TableCell>
                          <TableCell className="text-right tabular-nums">{row.away}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="font-semibold text-slate-900">Possession Table</div>
                <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {possessionColumns.map((column) => (
                        <SortableTableHead
                          key={column.key}
                          column={column}
                          sortState={possessionSort}
                          onToggle={togglePossessionSort}
                          className={['startTime', 'endTime', 'duration', 'passes', 'points', 'attack'].includes(column.key) ? 'text-right' : undefined}
                        />
                      ))}
                      <TableHead className="text-right"> </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedPossessions.slice(0, 250).map((p) => {
                      const teamName = p.teamSide === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home');
                      return (
                        <TableRow key={p.key} style={teamRowTint(p.teamSide, homeTeam?.color, awayTeam?.color, 0.07)}>
                          <TableCell className="font-mono text-xs">#{p.possessionId}</TableCell>
                          <TableCell className="font-medium">{teamName}</TableCell>
                          <TableCell>{toTitleCase(p.half)}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{Number.isFinite(p.startTime) ? formatMMSS(p.startTime) : 'NA'}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{Number.isFinite(p.endTime) ? formatMMSS(p.endTime) : 'NA'}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{Number.isFinite(p.duration) ? `${p.duration.toFixed(1)}s` : 'NA'}</TableCell>
                          <TableCell>{p.startSource}</TableCell>
                          <TableCell>{p.outcome}</TableCell>
                          <TableCell className="text-right tabular-nums">{p.passes}</TableCell>
                          <TableCell className="text-right tabular-nums">{p.points}</TableCell>
                          <TableCell className="text-right tabular-nums">{p.isAttack ? 'Yes' : 'No'}</TableCell>
                          <TableCell>{p.startZone}</TableCell>
                          <TableCell>{p.counterState}</TableCell>
                          <TableCell className="text-right">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() => onVisualisePossession?.(p)}
                            >
                              Visualise
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                </div>
              </CardContent>
            </Card>
          </>
        )}
    </div>
  );
}


export default PossessionsTab;

