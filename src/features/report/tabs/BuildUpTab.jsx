import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ChartContainer, ChartTooltipContent } from '@/components/ui/chart';
import { BarChart, Bar, CartesianGrid, Legend, LineChart, Line, PieChart, Pie, Cell, Tooltip, ReferenceLine, XAxis, YAxis } from 'recharts';
import pitchImg from '@/assets/pitch.png';
import {
  OPP_45_X,
  PITCH_W,
  PITCH_H,
  calcDistanceToGoal,
  classifyTerminalOutcome,
  extractFoulFromStat,
  findScorableFreeConcededRows,
  getAttackEntryChannelForPossession,
  getFieldTiltContribution,
  getMatchTimeS,
  getPossessionTimeSummary,
  getProgressiveMeters,
  getScoringZoneEntry,
  getDerivedPossessionDurationSeconds,
  isDeadBallGapStart,
  isAttackPossession,
  shouldExcludeFromTotals,
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
  getCompletedReceiptSelection,
  getPrimaryActorSelection,
  getKeeperCandidate,
  isGoalkeeperPlayer,
  buildShotAssistCredits,
  buildTouchesMap,
  getPossessionStartZone,
  inferPossessionStartSource,
  selectionKey,
  normalizePlayerRef,
  ComparisonMetricsCard,
  DirectionBadge,
  PitchViz,
  AttackChannelPitch,
  PassNetwork,
  buildPassSonarData,
  ShotMap,
  FullscreenMapShell,
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

function PassHeatmapCard({ title, stats, side, teamColor }) {
  const cols = 6;
  const rows = 5;
  const zoneCounts = useMemo(() => {
    const counts = Array.from({ length: rows }, () => Array(cols).fill(0));
    for (const stat of Array.isArray(stats) ? stats : []) {
      if (!stat || stat.stat_type !== 'pass' || stat.team_side !== side) continue;
      const points = [
        [Number(stat.x_position), Number(stat.y_position)],
        [Number(stat.end_x_position), Number(stat.end_y_position)],
      ];
      for (const [x, y] of points) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        const displayX = x;
        const displayY = y;
        const cx = Math.max(0, Math.min(cols - 1, Math.floor((displayX / PITCH_W) * cols)));
        const cy = Math.max(0, Math.min(rows - 1, Math.floor((displayY / PITCH_H) * rows)));
        counts[cy][cx] += 1;
      }
    }
    return counts;
  }, [stats, side]);

  const maxCount = Math.max(1, ...zoneCounts.flat());
  const fillFor = (count) => {
    if (!count) return 'rgba(255,255,255,0.05)';
    const alpha = 0.18 + (count / maxCount) * 0.72;
    const value = String(teamColor || '#2563eb').trim();
    if (!value.startsWith('#')) return `rgba(37,99,235,${alpha})`;
    const hex = value.slice(1);
    const normalized = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
    const int = Number.parseInt(normalized, 16);
    if (!Number.isFinite(int)) return `rgba(37,99,235,${alpha})`;
    const r = (int >> 16) & 255;
    const g = (int >> 8) & 255;
    const b = int & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  const renderContent = (isFullscreen = false) => (
    <div className="w-full">
        {!isFullscreen && <div className="font-semibold text-slate-900 mb-3">{title}</div>}
        <div
          className={`relative overflow-hidden ${isFullscreen ? 'w-full mx-auto' : 'mx-auto rounded-xl border border-slate-200'}`}
          style={{
            width: isFullscreen ? '100%' : '73%',
            aspectRatio: `${PITCH_W} / ${PITCH_H}`,
            backgroundImage: `url(${pitchImg})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        >
          <DirectionBadge label="Attacking ->" />
          <svg className="absolute inset-0 w-full h-full" viewBox={`-3 -3 ${PITCH_W + 6} ${PITCH_H + 6}`} preserveAspectRatio="none">
            {zoneCounts.map((line, rowIndex) => line.map((count, colIndex) => {
              const x = (colIndex * PITCH_W) / cols;
              const y = (rowIndex * PITCH_H) / rows;
              const width = PITCH_W / cols;
              const height = PITCH_H / rows;
              return (
                <g key={`${rowIndex}-${colIndex}`}>
                  <title>{`Zone ${rowIndex + 1}-${colIndex + 1}: ${count} pass touches`}</title>
                  <rect
                    x={x}
                    y={y}
                    width={width}
                    height={height}
                    fill={fillFor(count)}
                    stroke="rgba(255,255,255,0.18)"
                    strokeWidth="0.2"
                  />
                </g>
              );
            }))}
          </svg>
        </div>
    </div>
  );

  return (
    <FullscreenMapShell title={title} enabled>
      {(isFullscreen) => renderContent(isFullscreen)}
    </FullscreenMapShell>
  );
}

function describeSectorVertical(cx, cy, innerR, outerR, startAngle, endAngle) {
  const toPoint = (radius, angle) => ({
    x: cx + (radius * Math.sin(angle)),
    y: cy - (radius * Math.cos(angle)),
  });
  const startOuter = toPoint(outerR, startAngle);
  const endOuter = toPoint(outerR, endAngle);
  const startInner = toPoint(innerR, endAngle);
  const endInner = toPoint(innerR, startAngle);
  const span = ((endAngle - startAngle) + (Math.PI * 2)) % (Math.PI * 2);
  const largeArc = span > Math.PI ? 1 : 0;
  return [
    `M ${startOuter.x} ${startOuter.y}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 1 ${endOuter.x} ${endOuter.y}`,
    `L ${startInner.x} ${startInner.y}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${endInner.x} ${endInner.y}`,
    'Z',
  ].join(' ');
}

function SonarZoneCard({ zone, title }) {
  const size = 260;
  const cx = size / 2;
  const cy = size / 2;
  const maxCount = Math.max(1, ...(zone?.buckets || []).map((bucket) => bucket.count));
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-2">
        <div className="font-medium text-slate-900">{title}</div>
        <div className="text-xs text-slate-500">{zone?.total || 0} passes</div>
      </div>
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-[240px] mx-auto">
        {[0.25, 0.5, 0.75, 1].map((ratio) => (
          <circle
            key={ratio}
            cx={cx}
            cy={cy}
                    r={82 * ratio}
            fill="none"
            stroke="rgba(148,163,184,0.35)"
            strokeWidth="1"
          />
        ))}
        {(zone?.buckets || []).map((bucket) => {
          const startAngle = (bucket.index / zone.buckets.length) * Math.PI * 2;
          const endAngle = ((bucket.index + 1) / zone.buckets.length) * Math.PI * 2;
                  const outerR = 18 + ((bucket.count / maxCount) * 64);
          const path = describeSectorVertical(cx, cy, 10, outerR, startAngle, endAngle);
          const mixLabel = Number.isFinite(bucket.kickShare) ? `${(bucket.kickShare * 100).toFixed(0)}% kick` : 'mixed / unknown';
          return (
            <path key={bucket.index} d={path} fill={bucket.color} opacity={bucket.count ? 0.92 : 0.15} stroke="rgba(15,23,42,0.35)" strokeWidth="1">
              <title>{`Direction ${bucket.index + 1}\nPasses: ${bucket.count}\nKickpasses: ${bucket.kickCount}\nHandpasses: ${bucket.handCount}\nMix: ${mixLabel}`}</title>
            </path>
          );
        })}
        <text x={cx} y={18} textAnchor="middle" fontSize="11" fontWeight="700" fill="#475569">Toward Goal</text>
        <text x={size - 28} y={cy + 4} textAnchor="start" fontSize="11" fontWeight="700" fill="#475569">Right</text>
        <text x={28} y={cy + 4} textAnchor="end" fontSize="11" fontWeight="700" fill="#475569">Left</text>
        <text x={cx} y={size - 10} textAnchor="middle" fontSize="11" fontWeight="700" fill="#475569">Back</text>
      </svg>
    </div>
  );
}

function PassSonarComparisonCard({ homeTeam, awayTeam, homeZones, awayZones }) {
  const zoneOrder = ['Attacking Third', 'Middle Third', 'Defensive Third'];
  const homeByZone = new Map((homeZones || []).map((zone) => [zone.zone, zone]));
  const awayByZone = new Map((awayZones || []).map((zone) => [zone.zone, zone]));

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="font-semibold text-slate-900">Pass Sonars</div>
        <div className="grid gap-4">
          {zoneOrder.map((zoneName) => (
            <div key={zoneName} className="grid gap-4 lg:grid-cols-2">
              <SonarZoneCard zone={homeByZone.get(zoneName)} title={`${homeTeam?.name || 'Home'} ${zoneName}`} />
              <SonarZoneCard zone={awayByZone.get(zoneName)} title={`${awayTeam?.name || 'Away'} ${zoneName}`} />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function BuildUpTab({
  stats,
  homeTeam,
  awayTeam,
  playerOptions,
  reportFilters,
  eventTypes,
  setEventTypes,
  pressure,
  setPressure,
  outcome,
  setOutcome,
  progressiveOnly,
  setProgressiveOnly,
  pnSide,
  setPnSide,
  pnMin,
  setPnMin,
  pnHalf,
  setPnHalf,
  onOpenVideoAt,
}) {
  const scopedReportFilters = useMemo(() => ({ ...reportFilters, allowedActionTypes: ['pass', 'carry'] }), [reportFilters]);
  const base = useMemo(() => applyNonTeamReportFilters(stats, scopedReportFilters), [stats, scopedReportFilters]);
  const calcBase = useMemo(() => base.filter((s) => !shouldExcludeFromTotals(s)), [base]);
  const teamMode = String(reportFilters?.team || 'both');
  const events = useMemo(() => base.filter((s) => s && (s.stat_type === 'pass' || s.stat_type === 'carry')), [base]);

  const filtered = useMemo(() => events.filter((s) => {
    if (eventTypes.length && !eventTypes.includes(s.stat_type)) return false;
    const extra = safeParseJSON(s.extra_data || '{}', {});
    const p = s.stat_type === 'pass' ? extra?.pass?.pressure_on_passer : extra?.carry?.pressure_on_carrier;
    const o = deriveOutcome(s, extra);
    if (pressure.length && !pressure.includes(String(p || ''))) return false;
    if (outcome.length && !outcome.includes(String(o || ''))) return false;
    if (progressiveOnly && !isProgressiveShared(s)) return false;
    return true;
  }), [events, eventTypes, pressure, outcome, progressiveOnly]);
  const calcFiltered = useMemo(() => filtered.filter((s) => !shouldExcludeFromTotals(s)), [filtered]);

  const kpis = useMemo(() => {
    const eventLength = (stat) => {
      const sx = Number(stat?.x_position);
      const sy = Number(stat?.y_position);
      const ex = Number(stat?.end_x_position);
      const ey = Number(stat?.end_y_position);
      if (![sx, sy, ex, ey].every(Number.isFinite)) return NaN;
      return Math.sqrt(((ex - sx) ** 2) + ((ey - sy) ** 2));
    };
    const possessionGroups = groupByPossession(calcBase);
    const orderedBase = (Array.isArray(calcBase) ? calcBase : []).slice().sort((a, b) => {
      const pa = Number(a?.play_id);
      const pb = Number(b?.play_id);
      if (Number.isFinite(pa) && Number.isFinite(pb) && pa !== pb) return pa - pb;
      const ta = getMatchTimeS(a, reportFilters?.match, reportFilters?.imputedTimeById);
      const tb = getMatchTimeS(b, reportFilters?.match, reportFilters?.imputedTimeById);
      if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
      return String(a?.id || '').localeCompare(String(b?.id || ''));
    });
    const previousByPossessionKey = new Map();
    orderedBase.forEach((stat, index) => {
      const pid = Number(stat?.possession_id);
      const pside = stat?.possession_team_side;
      if (!Number.isFinite(pid) || (pside !== 'home' && pside !== 'away')) return;
      const key = `${pside}-${pid}`;
      if (!previousByPossessionKey.has(key)) previousByPossessionKey.set(key, index > 0 ? orderedBase[index - 1] : null);
    });
    const shotAssistCredits = buildShotAssistCredits(calcBase);
    const calc = (side) => {
      const sideEvents = calcFiltered.filter((s) => s.team_side === side);
      const pass = sideEvents.filter((s) => s.stat_type === 'pass');
      const carry = sideEvents.filter((s) => s.stat_type === 'carry');
      const passComp = pass.filter((s) => deriveOutcome(s, safeParseJSON(s.extra_data || '{}', {})) === 'completed').length;
      const carryComp = carry.filter((s) => deriveOutcome(s, safeParseJSON(s.extra_data || '{}', {})) === 'completed').length;
      const progPass = pass.filter((s) => isProgressiveShared(s)).length;
      const progPassComp = pass.filter((s) => isProgressiveShared(s) && deriveOutcome(s, safeParseJSON(s.extra_data || '{}', {})) === 'completed').length;
      const progCarry = carry.filter((s) => isProgressiveShared(s)).length;
      const progCarryComp = carry.filter((s) => isProgressiveShared(s) && deriveOutcome(s, safeParseJSON(s.extra_data || '{}', {})) === 'completed').length;
      const switches = pass.filter((s) => {
        if (deriveOutcome(s, safeParseJSON(s.extra_data || '{}', {})) !== 'completed') return false;
        const sy = Number(s?.y_position);
        const ey = Number(s?.end_y_position);
        return Number.isFinite(sy) && Number.isFinite(ey) && Math.abs(ey - sy) > 30;
      }).length;
      const scoringEntries = sideEvents.filter((s) => getScoringZoneEntry(s)).length;
      const passesIntoScoringZone = pass.filter((s) => deriveOutcome(s, safeParseJSON(s.extra_data || '{}', {})) === 'completed' && getScoringZoneEntry(s)).length;
      const turnovers = sideEvents.filter((s) => classifyTerminalOutcome(s, side) === 'TURNOVER').length;
      const shotAssists = shotAssistCredits.filter((row) => row.teamSide === side).length;
      const passLengths = pass.map(eventLength).filter(Number.isFinite);
      const kickPassLengths = pass
        .filter((s) => {
          const method = String(safeParseJSON(s.extra_data || '{}', {})?.pass?.method || '').toLowerCase();
          return method === 'left' || method === 'right';
        })
        .map(eventLength)
        .filter(Number.isFinite);
      const handPassLengths = pass
        .filter((s) => String(safeParseJSON(s.extra_data || '{}', {})?.pass?.method || '').toLowerCase() === 'hand')
        .map(eventLength)
        .filter(Number.isFinite);

      const buildUpSamples = [];
      const possessionDurations = [];
      const channels = { Left: 0, Middle: 0, Right: 0 };
      const startZones = { 'Defensive Third': 0, 'Middle Third': 0, 'Attacking Third': 0 };
      for (const [key, evs] of possessionGroups.entries()) {
        if (!String(key).startsWith(side + '-')) continue;
        const acting = evs.filter((e) => e && e.team_side === side);
        if (!acting.length) continue;
        const zone = getPossessionStartZone(acting);
        if (startZones[zone] != null) startZones[zone] += 1;
        const previousStat = previousByPossessionKey.get(key) || null;
        const startSource = inferPossessionStartSource(evs, side, previousStat || []);
        const liveStartAnchor = getLivePossessionStartAnchor(previousStat, startSource, reportFilters?.match, reportFilters?.imputedTimeById);
        const timeSummary = getPossessionTimeSummary(evs, side, reportFilters?.match, reportFilters?.imputedTimeById, { startAnchorTimeS: liveStartAnchor });
        const liveDuration = Number.isFinite(timeSummary.liveSeconds)
          ? timeSummary.liveSeconds
          : getDerivedPossessionDurationSeconds(evs, reportFilters?.match, reportFilters?.imputedTimeById);
        if (Number.isFinite(liveDuration) && liveDuration > 0) possessionDurations.push(liveDuration);
        if (!isAttackPossession(acting, side)) continue;
        const channel = getAttackEntryChannelForPossession(acting, side);
        if (channel) channels[channel] += 1;

        const firstEventTime = getMatchTimeS(acting[0], reportFilters?.match, reportFilters?.imputedTimeById);
        const startTime = Number.isFinite(liveStartAnchor) ? liveStartAnchor : firstEventTime;
        const attackEvent = acting.find((e) => {
          const sx = Number(e?.x_position);
          const ex = Number(e?.end_x_position);
          return (Number.isFinite(sx) && sx >= OPP_45_X) || (Number.isFinite(ex) && ex >= OPP_45_X);
        });
        const attackTime = getMatchTimeS(attackEvent, reportFilters?.match, reportFilters?.imputedTimeById);
        if (Number.isFinite(startTime) && Number.isFinite(attackTime)) buildUpSamples.push(Math.max(0, attackTime - startTime));
      }

      return {
        passes: pass.length,
        passComp,
        passPct: pass.length ? (passComp / pass.length) * 100 : NaN,
        carries: carry.length,
        carryComp,
        carryPct: carry.length ? (carryComp / carry.length) * 100 : NaN,
        progPass,
        progPassComp,
        progCarry,
        progCarryComp,
        switches,
        scoringEntries,
        passesIntoScoringZone,
        shotAssists,
        shotsCreated: shotAssists,
        fieldTiltEvents: sideEvents.filter((s) => getFieldTiltContribution(s)).length,
        turnovers,
        buildUpSpeed: buildUpSamples.length ? buildUpSamples.reduce((a, b) => a + b, 0) / buildUpSamples.length : NaN,
        passesPerMinuteInPossession: possessionDurations.length
          ? pass.length / (possessionDurations.reduce((a, b) => a + b, 0) / 60)
          : NaN,
        avgPassLength: passLengths.length ? passLengths.reduce((a, b) => a + b, 0) / passLengths.length : NaN,
        handPassCount: handPassLengths.length,
        kickPassCount: kickPassLengths.length,
        channels,
        startZones,
      };
    };
    return { home: calc('home'), away: calc('away') };
  }, [calcBase, calcFiltered, reportFilters]);

  const fieldTiltPct = useMemo(() => {
    const total = (kpis.home.fieldTiltEvents || 0) + (kpis.away.fieldTiltEvents || 0);
    return {
      home: total ? ((kpis.home.fieldTiltEvents || 0) / total) * 100 : NaN,
      away: total ? ((kpis.away.fieldTiltEvents || 0) / total) * 100 : NaN,
    };
  }, [kpis]);

  const channelRows = useMemo(() => {
    const homeTotal = Object.values(kpis.home.channels).reduce((a, b) => a + b, 0);
    const awayTotal = Object.values(kpis.away.channels).reduce((a, b) => a + b, 0);
    return ['Left', 'Middle', 'Right'].map((channel) => ({
      channel,
      homeCount: kpis.home.channels[channel] || 0,
      awayCount: kpis.away.channels[channel] || 0,
      homePct: homeTotal ? ((kpis.home.channels[channel] || 0) / homeTotal) * 100 : NaN,
      awayPct: awayTotal ? ((kpis.away.channels[channel] || 0) / awayTotal) * 100 : NaN,
    }));
  }, [kpis]);

  const formatRatioPct = (made, attempts) => {
    if (!Number.isFinite(Number(attempts)) || Number(attempts) <= 0) return `0/0 (NA)`;
    return `${made}/${attempts} (${formatPct((Number(made) / Number(attempts)) * 100)})`;
  };

  const formatHandKickRatio = (handCount, kickCount) => {
    if (!Number.isFinite(Number(handCount)) || !Number.isFinite(Number(kickCount)) || Number(kickCount) <= 0) return 'NA';
    return `${(Number(handCount) / Number(kickCount)).toFixed(2)}:1`;
  };

  const networkPasses = useMemo(() => {
    const targetHalf = String(pnHalf || 'all');
    return filtered.filter((s) => {
      if (s.stat_type !== 'pass') return false;
      if (targetHalf === 'all') return true;
      return String(s.half || '').toLowerCase() === targetHalf;
    });
  }, [filtered, pnHalf]);

  const networkSide = teamMode === 'both' ? pnSide : teamMode;
  const playerTeamById = useMemo(() => new Map((Array.isArray(playerOptions) ? playerOptions : []).map((p) => [p.id, p.team_side])), [playerOptions]);
  const substitutionPairs = useMemo(() => {
    const targetHalf = String(pnHalf || 'all');
    return (Array.isArray(stats) ? stats : [])
      .filter((s) => s?.stat_type === 'substitution')
      .filter((s) => targetHalf === 'all' || String(s?.half || '').toLowerCase() === targetHalf)
      .map((s) => {
        const extra = safeParseJSON(s?.extra_data || '{}', {});
        const outId = extra?.sub_out_id || '';
        const inId = extra?.sub_in_id || '';
        const outPlayer = (playerOptions || []).find((p) => p.id === outId);
        const inPlayer = (playerOptions || []).find((p) => p.id === inId);
        const pairSide = playerTeamById.get(outId) || playerTeamById.get(inId) || 'unknown';
        return {
          id: String(s?.id || `${outId}-${inId}`),
          side: pairSide,
          outId,
          inId,
          outNumber: outPlayer?.number ?? null,
          inNumber: inPlayer?.number ?? null,
          outLabel: outPlayer ? `#${outPlayer.number || ''} ${outPlayer.name || ''}`.trim() : 'Sub Out',
          inLabel: inPlayer ? `#${inPlayer.number || ''} ${inPlayer.name || ''}`.trim() : 'Sub In',
        };
      })
      .filter((pair) => pair.side === networkSide);
  }, [stats, pnHalf, playerOptions, playerTeamById, networkSide]);

  const [selectedSubPairPlayer, setSelectedSubPairPlayer] = useState({});
  useEffect(() => {
    setSelectedSubPairPlayer((current) => {
      const next = {};
      for (const pair of substitutionPairs) {
        const existing = current[pair.id];
        next[pair.id] = existing === 'out' || existing === 'in' ? existing : 'out';
      }
      return next;
    });
  }, [substitutionPairs]);

  const hiddenPlayerIds = useMemo(() => {
    const set = new Set();
    substitutionPairs.forEach((pair) => {
      const selected = selectedSubPairPlayer[pair.id] || 'out';
      if (selected === 'out') {
        if (pair.inId) set.add(pair.inId);
      } else {
        if (pair.outId) set.add(pair.outId);
      }
    });
    return set;
  }, [substitutionPairs, selectedSubPairPlayer]);
  const [startZoneSort, setStartZoneSort] = useState({ key: 'zone', dir: 'asc' });
  const startZoneColumns = useMemo(() => ([
    { key: 'zone', label: 'Zone', sortValue: (r) => r.zone },
    { key: 'home', label: homeTeam?.name || 'Home', sortValue: (r) => r.home },
    { key: 'away', label: awayTeam?.name || 'Away', sortValue: (r) => r.away },
  ]), [homeTeam, awayTeam]);
  const startZoneRows = useMemo(() => ['Defensive Third', 'Middle Third', 'Attacking Third'].map((zone) => ({
    key: zone,
    zone,
    home: kpis.home.startZones?.[zone] || 0,
    away: kpis.away.startZones?.[zone] || 0,
  })), [kpis]);
  const sortedStartZoneRows = useMemo(() => sortRows(startZoneRows, startZoneSort, startZoneColumns, 'key'), [startZoneRows, startZoneSort, startZoneColumns]);
  const toggleStartZoneSort = (key) => setStartZoneSort((current) => current.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'zone' ? 'asc' : 'desc' });
  const homeSonarZones = useMemo(() => buildPassSonarData(calcFiltered, { side: 'home' }), [calcFiltered]);
  const awaySonarZones = useMemo(() => buildPassSonarData(calcFiltered, { side: 'away' }), [calcFiltered]);
  const singleTeamSonarZones = useMemo(() => buildPassSonarData(calcFiltered, { side: teamMode === 'both' ? null : teamMode }), [calcFiltered, teamMode]);

  return (
    <div className="space-y-4">
        <div className="grid lg:grid-cols-[0.9fr_1.1fr] gap-5 items-start">
          <ComparisonMetricsCard
            title="Build-Up Metrics"
            homeTeam={homeTeam}
            awayTeam={awayTeam}
            teamMode={teamMode}
            cardClassName="w-full"
            rows={[
              { label: 'Passes', home: formatRatioPct(kpis.home.passComp, kpis.home.passes), away: formatRatioPct(kpis.away.passComp, kpis.away.passes) },
              { label: 'Carries', home: formatRatioPct(kpis.home.carryComp, kpis.home.carries), away: formatRatioPct(kpis.away.carryComp, kpis.away.carries) },
              { label: 'Successful Progressive Passes', home: kpis.home.progPassComp, away: kpis.away.progPassComp },
              { label: 'Successful Progressive Carries', home: kpis.home.progCarryComp, away: kpis.away.progCarryComp },
              { label: 'Switches', home: kpis.home.switches, away: kpis.away.switches },
              { label: 'Scoring Zone Entries', home: kpis.home.scoringEntries, away: kpis.away.scoringEntries },
              { label: 'Passes Into Scoring Zone', home: kpis.home.passesIntoScoringZone, away: kpis.away.passesIntoScoringZone },
              { label: 'Passes / Possession Minute', home: Number.isFinite(kpis.home.passesPerMinuteInPossession) ? kpis.home.passesPerMinuteInPossession.toFixed(2) : 'NA', away: Number.isFinite(kpis.away.passesPerMinuteInPossession) ? kpis.away.passesPerMinuteInPossession.toFixed(2) : 'NA' },
              { label: 'Avg Pass Length', home: Number.isFinite(kpis.home.avgPassLength) ? kpis.home.avgPassLength.toFixed(1) : 'NA', away: Number.isFinite(kpis.away.avgPassLength) ? kpis.away.avgPassLength.toFixed(1) : 'NA' },
              { label: 'Handpass : Kickpass', home: formatHandKickRatio(kpis.home.handPassCount, kpis.home.kickPassCount), away: formatHandKickRatio(kpis.away.handPassCount, kpis.away.kickPassCount) },
              { label: 'Field Tilt', home: formatPct(fieldTiltPct.home), away: formatPct(fieldTiltPct.away) },
              { label: 'Build-Up Speed', home: Number.isFinite(kpis.home.buildUpSpeed) ? `${kpis.home.buildUpSpeed.toFixed(1)}s` : 'NA', away: Number.isFinite(kpis.away.buildUpSpeed) ? `${kpis.away.buildUpSpeed.toFixed(1)}s` : 'NA' },
            ]}
          />
          {teamMode === 'both' ? (
            <PassSonarComparisonCard
              homeTeam={homeTeam}
              awayTeam={awayTeam}
              homeZones={homeSonarZones}
              awayZones={awaySonarZones}
            />
          ) : (
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="font-semibold text-slate-900">
                  {teamMode === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home')} Pass Sonar
                </div>
                <div className="text-xs text-slate-500">Direction and pass-method mix by start zone</div>
                <div className="grid gap-4">
                  {['Attacking Third', 'Middle Third', 'Defensive Third'].map((zoneName) => {
                    const zone = singleTeamSonarZones.find((entry) => entry.zone === zoneName) || { zone: zoneName, total: 0, buckets: [] };
                    return <SonarZoneCard key={zoneName} zone={zone} title={zoneName} />;
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {filtered.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-sm text-slate-600 text-center">
              No passes or carries available for current filters.
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="font-semibold text-slate-900">Pass / Carry Map</div>
                <PitchViz
                  stats={filtered}
                  homeColor={homeTeam?.color}
                  awayColor={awayTeam?.color}
                  colorBy={teamMode === 'both' ? 'team' : 'outcome'}
                  showColorControls={false}
                  mirrorAwayWhenBoth={teamMode !== 'home'}
                  directionLabel="Home ->"
                  onOpenVideoAt={onOpenVideoAt}
                />
              </CardContent>
            </Card>

            <AttackChannelPitch
              homeTeam={homeTeam}
              awayTeam={awayTeam}
              teamMode={teamMode}
              homeColor={homeTeam?.color}
              awayColor={awayTeam?.color}
              rows={channelRows}
            />

            {teamMode === 'both' ? (
              <div className="grid lg:grid-cols-2 gap-4">
                <PassHeatmapCard
                  title={`${homeTeam?.name || 'Home'} Pass Heatmap`}
                  stats={filtered}
                  side="home"
                  teamColor={homeTeam?.color || '#2563eb'}
                />
                <PassHeatmapCard
                  title={`${awayTeam?.name || 'Away'} Pass Heatmap`}
                  stats={filtered}
                  side="away"
                  teamColor={awayTeam?.color || '#ef4444'}
                />
              </div>
            ) : (
              <PassHeatmapCard
                title={`${teamMode === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home')} Pass Heatmap`}
                stats={filtered}
                side={teamMode === 'away' ? 'away' : 'home'}
                teamColor={teamMode === 'away' ? (awayTeam?.color || '#ef4444') : (homeTeam?.color || '#2563eb')}
              />
            )}

            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="grid lg:grid-cols-[180px_minmax(0,1fr)] gap-4 items-start">
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-600">Network Team</Label>
                      <Select value={teamMode === 'both' ? pnSide : teamMode} onValueChange={setPnSide}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="home">{homeTeam?.name || 'Home'}</SelectItem>
                          <SelectItem value="away">{awayTeam?.name || 'Away'}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-600">Minimum Passes For A Connection</Label>
                      <Input
                        type="number"
                        min={1}
                        step={1}
                        value={String(pnMin)}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          if (!Number.isFinite(n)) return;
                          setPnMin(Math.max(1, Math.floor(n)));
                        }}
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-600">Half</Label>
                        <Select value={pnHalf} onValueChange={setPnHalf}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">All</SelectItem>
                            <SelectItem value="first">First</SelectItem>
                            <SelectItem value="second">Second</SelectItem>
                            <SelectItem value="et_first">ET1</SelectItem>
                            <SelectItem value="et_second">ET2</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    {substitutionPairs.length > 0 && (
                      <div className="space-y-2">
                        <Label className="text-xs text-slate-600">Substitution Pairs</Label>
                        <div className="space-y-2">
                          {substitutionPairs.map((pair) => {
                            const selected = selectedSubPairPlayer[pair.id] || 'out';
                            const sideColor = pair.side === 'away' ? (awayTeam?.color || '#7f1d1d') : (homeTeam?.color || '#ea580c');
                            return (
                              <div key={pair.id} className="flex items-center gap-2">
                                <Button
                                  type="button"
                                  variant={selected === 'out' ? 'default' : 'outline'}
                                  size="sm"
                                  className="h-8 min-w-10 px-2 text-xs"
                                  style={selected === 'out' ? { backgroundColor: sideColor, borderColor: sideColor, color: '#fff' } : { borderColor: sideColor, color: sideColor }}
                                  onClick={() => setSelectedSubPairPlayer((current) => ({ ...current, [pair.id]: 'out' }))}
                                  title={pair.outLabel}
                                >
                                  {pair.outNumber ?? 'Out'}
                                </Button>
                                <Button
                                  type="button"
                                  variant={selected === 'in' ? 'default' : 'outline'}
                                  size="sm"
                                  className="h-8 min-w-10 px-2 text-xs"
                                  style={selected === 'in' ? { backgroundColor: sideColor, borderColor: sideColor, color: '#fff' } : { borderColor: sideColor, color: sideColor }}
                                  onClick={() => setSelectedSubPairPlayer((current) => ({ ...current, [pair.id]: 'in' }))}
                                  title={pair.inLabel}
                                >
                                  {pair.inNumber ?? 'In'}
                                </Button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                      <div className="space-y-3">
                        <PassNetwork
                          passes={networkPasses}
                          side={networkSide}
                          minCount={pnMin}
                          teamLabel={networkSide === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home')}
                          teamColor={(networkSide === 'away' ? awayTeam?.color : homeTeam?.color) || '#111827'}
                          showTable={false}
                          pitchScale="88%"
                          hiddenPlayerIds={hiddenPlayerIds}
                        />
                      </div>
                </div>
              </CardContent>
            </Card>

            <PassNetwork
              passes={networkPasses}
              side={networkSide}
              minCount={pnMin}
              teamLabel={`${networkSide === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home')} Pass Network Players`}
              teamColor={(networkSide === 'away' ? awayTeam?.color : homeTeam?.color) || '#111827'}
              showPitch={false}
              pitchScale="88%"
              hiddenPlayerIds={hiddenPlayerIds}
            />

            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="font-semibold text-slate-900">Possession Start Zones</div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <SortableTableHead column={startZoneColumns[0]} sortState={startZoneSort} onToggle={toggleStartZoneSort} />
                      {(teamMode === 'both' || teamMode === 'home') && <SortableTableHead column={startZoneColumns[1]} sortState={startZoneSort} onToggle={toggleStartZoneSort} className="text-right" />}
                      {(teamMode === 'both' || teamMode === 'away') && <SortableTableHead column={startZoneColumns[2]} sortState={startZoneSort} onToggle={toggleStartZoneSort} className="text-right" />}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedStartZoneRows.map((row) => (
                      <TableRow key={row.key}>
                        <TableCell className="font-medium">{row.zone}</TableCell>
                        {(teamMode === 'both' || teamMode === 'home') && (
                          <TableCell className="text-right tabular-nums">{row.home}</TableCell>
                        )}
                        {(teamMode === 'both' || teamMode === 'away') && (
                          <TableCell className="text-right tabular-nums">{row.away}</TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        )}
    </div>
  );
}


export default BuildUpTab;

