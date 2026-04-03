import React, { useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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
  getProgressiveMeters,
  getScoringZoneEntry,
  isAttackPossession,
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
  selectionKey,
  normalizePlayerRef,
  ComparisonMetricsCard,
  PitchViz,
  AttackChannelPitch,
  PassNetwork,
  ShotMap,
  shotSideFromY,
  shotZoneFromDistance,
  applyNonTeamReportFilters,
} from '../shared';

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
        const displayX = side === 'away' ? (PITCH_W - x) : x;
        const displayY = side === 'away' ? (PITCH_H - y) : y;
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

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="font-semibold text-slate-900">{title}</div>
        <div
          className="relative mx-auto rounded-xl border border-slate-200 overflow-hidden"
          style={{
            width: '73%',
            aspectRatio: `${PITCH_W} / ${PITCH_H}`,
            backgroundImage: `url(${pitchImg})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        >
          <svg className="absolute inset-0 w-full h-full" viewBox={`0 0 ${PITCH_W} ${PITCH_H}`} preserveAspectRatio="none">
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
      </CardContent>
    </Card>
  );
}

function BuildUpTab({
  stats,
  homeTeam,
  awayTeam,
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
}) {
  const scopedReportFilters = useMemo(() => ({ ...reportFilters, allowedActionTypes: ['pass', 'carry'] }), [reportFilters]);
  const base = useMemo(() => applyNonTeamReportFilters(stats, scopedReportFilters), [stats, scopedReportFilters]);
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

  const kpis = useMemo(() => {
    const possessionGroups = groupByPossession(base);
    const shotAssistCredits = buildShotAssistCredits(base);
    const calc = (side) => {
      const sideEvents = filtered.filter((s) => s.team_side === side);
      const pass = sideEvents.filter((s) => s.stat_type === 'pass');
      const carry = sideEvents.filter((s) => s.stat_type === 'carry');
      const passComp = pass.filter((s) => deriveOutcome(s, safeParseJSON(s.extra_data || '{}', {})) === 'completed').length;
      const carryComp = carry.filter((s) => deriveOutcome(s, safeParseJSON(s.extra_data || '{}', {})) === 'completed').length;
      const progPass = pass.filter((s) => isProgressiveShared(s)).length;
      const progPassComp = pass.filter((s) => isProgressiveShared(s) && deriveOutcome(s, safeParseJSON(s.extra_data || '{}', {})) === 'completed').length;
      const progCarry = carry.filter((s) => isProgressiveShared(s)).length;
      const progCarryComp = carry.filter((s) => isProgressiveShared(s) && deriveOutcome(s, safeParseJSON(s.extra_data || '{}', {})) === 'completed').length;
      const scoringEntries = sideEvents.filter((s) => getScoringZoneEntry(s)).length;
      const passesIntoScoringZone = pass.filter((s) => deriveOutcome(s, safeParseJSON(s.extra_data || '{}', {})) === 'completed' && getScoringZoneEntry(s)).length;
      const turnovers = sideEvents.filter((s) => classifyTerminalOutcome(s, side) === 'TURNOVER').length;
      const shotAssists = shotAssistCredits.filter((row) => row.teamSide === side).length;

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
        const times = acting.map((e) => getMatchTimeS(e, reportFilters?.match, reportFilters?.imputedTimeById)).filter(Number.isFinite);
        if (times.length >= 2) possessionDurations.push(Math.max(0, Math.max(...times) - Math.min(...times)));
        if (!isAttackPossession(acting, side)) continue;
        const channel = getAttackEntryChannelForPossession(acting, side);
        if (channel) channels[channel] += 1;

        const startTime = getMatchTimeS(acting[0], reportFilters?.match, reportFilters?.imputedTimeById);
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
        progPassPct: progPass ? (progPassComp / progPass) * 100 : NaN,
        progCarry,
        progCarryComp,
        progCarryPct: progCarry ? (progCarryComp / progCarry) * 100 : NaN,
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
        channels,
        startZones,
      };
    };
    return { home: calc('home'), away: calc('away') };
  }, [base, filtered, reportFilters]);

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

  const networkPasses = useMemo(() => {
    const targetHalf = String(pnHalf || 'all');
    return filtered.filter((s) => {
      if (s.stat_type !== 'pass') return false;
      if (targetHalf === 'all') return true;
      return String(s.half || '').toLowerCase() === targetHalf;
    });
  }, [filtered, pnHalf]);

  return (
    <div className="space-y-4">
        <ComparisonMetricsCard
          title="Build-Up Metrics"
          homeTeam={homeTeam}
          awayTeam={awayTeam}
          teamMode={teamMode}
          rows={[
            { label: 'Passes', home: formatRatioPct(kpis.home.passComp, kpis.home.passes), away: formatRatioPct(kpis.away.passComp, kpis.away.passes) },
            { label: 'Carries', home: formatRatioPct(kpis.home.carryComp, kpis.home.carries), away: formatRatioPct(kpis.away.carryComp, kpis.away.carries) },
            { label: 'Progressive Passes', home: formatRatioPct(kpis.home.progPassComp, kpis.home.progPass), away: formatRatioPct(kpis.away.progPassComp, kpis.away.progPass) },
            { label: 'Progressive Carries', home: formatRatioPct(kpis.home.progCarryComp, kpis.home.progCarry), away: formatRatioPct(kpis.away.progCarryComp, kpis.away.progCarry) },
            { label: 'Scoring Zone Entries', home: kpis.home.scoringEntries, away: kpis.away.scoringEntries },
            { label: 'Passes Into Scoring Zone', home: kpis.home.passesIntoScoringZone, away: kpis.away.passesIntoScoringZone },
            { label: 'Passes / Possession Minute', home: Number.isFinite(kpis.home.passesPerMinuteInPossession) ? kpis.home.passesPerMinuteInPossession.toFixed(2) : 'NA', away: Number.isFinite(kpis.away.passesPerMinuteInPossession) ? kpis.away.passesPerMinuteInPossession.toFixed(2) : 'NA' },
            { label: 'Field Tilt', home: formatPct(fieldTiltPct.home), away: formatPct(fieldTiltPct.away) },
            { label: 'Build-Up Speed', home: Number.isFinite(kpis.home.buildUpSpeed) ? `${kpis.home.buildUpSpeed.toFixed(1)}s` : 'NA', away: Number.isFinite(kpis.away.buildUpSpeed) ? `${kpis.away.buildUpSpeed.toFixed(1)}s` : 'NA' },
          ]}
        />

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
                  </div>
                  <PassNetwork
                    passes={networkPasses}
                    side={teamMode === 'both' ? pnSide : teamMode}
                    minCount={pnMin}
                    teamLabel={(teamMode === 'both' ? pnSide : teamMode) === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home')}
                    teamColor={((teamMode === 'both' ? pnSide : teamMode) === 'away' ? awayTeam?.color : homeTeam?.color) || '#111827'}
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="font-semibold text-slate-900">Possession Start Zones</div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Zone</TableHead>
                      {(teamMode === 'both' || teamMode === 'home') && <TableHead className="text-right">{homeTeam?.name || 'Home'}</TableHead>}
                      {(teamMode === 'both' || teamMode === 'away') && <TableHead className="text-right">{awayTeam?.name || 'Away'}</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {['Defensive Third', 'Middle Third', 'Attacking Third'].map((zone) => (
                      <TableRow key={zone}>
                        <TableCell className="font-medium">{zone}</TableCell>
                        {(teamMode === 'both' || teamMode === 'home') && (
                          <TableCell className="text-right tabular-nums">{kpis.home.startZones?.[zone] || 0}</TableCell>
                        )}
                        {(teamMode === 'both' || teamMode === 'away') && (
                          <TableCell className="text-right tabular-nums">{kpis.away.startZones?.[zone] || 0}</TableCell>
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

