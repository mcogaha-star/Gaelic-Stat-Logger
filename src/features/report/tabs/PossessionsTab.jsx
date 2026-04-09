import React, { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ChartContainer, ChartTooltipContent } from '@/components/ui/chart';
import { BarChart, Bar, CartesianGrid, Legend, LineChart, Line, PieChart, Pie, Cell, Tooltip, ReferenceLine, XAxis, YAxis } from 'recharts';
import {
  PITCH_W,
  PITCH_H,
  calcDistanceToGoal,
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
      const startTime = times.length ? Math.min(...times) : NaN;
      const endTime = times.length ? Math.max(...times) : NaN;
      const duration = Number.isFinite(startTime) && Number.isFinite(endTime) ? Math.max(0, endTime - startTime) : NaN;

      const points = acting.reduce((a, e) => {
        if (e.stat_type !== 'shot') return a;
        const ex = safeParseJSON(e.extra_data || '{}', {});
        return a + shotPointsForOutcome(ex?.shot?.outcome);
      }, 0);

      const startSource = inferPossessionStartSource(evs, teamSide, previousByPossessionKey.get(key) || []);

      const isAttack = isAttackPossession(evs, teamSide);
      const passes = acting.filter((e) => e.stat_type === 'pass' && deriveOutcome(e, safeParseJSON(e.extra_data || '{}', {})) === 'completed').length;
      const shots = acting.filter((e) => e.stat_type === 'shot').length;
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
    const map = {
      defence_set_yes: 'Yes',
      defence_set_no: 'No',
    };
    return possessions.filter((p) => p.counterState === map[counterFilter]);
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
      const avgDur = ds.length ? ds.reduce((a, b) => a + b, 0) / ds.length : NaN;
      const possToAttack = possN ? (attN / possN) * 100 : NaN;
      const possToShot = possN ? (rows.filter((p) => p.shots > 0).length / possN) * 100 : NaN;
      const attToShot = attN ? (att.filter((p) => p.shots > 0).length / attN) * 100 : NaN;
      const passesPerPoss = possN ? rows.reduce((a, p) => a + (p.passes || 0), 0) / possN : NaN;
      const scoringPoss = possN ? (rows.filter((p) => Number(p.points || 0) > 0).length / possN) * 100 : NaN;
      const counterPoss = possN ? (rows.filter((p) => p.counterState === 'Yes').length / possN) * 100 : NaN;
      const channels = { Left: 0, Middle: 0, Right: 0 };
      rows.filter((p) => p.isAttack).forEach((p) => {
        if (channels[p.attackEntryChannel] != null) channels[p.attackEntryChannel] += 1;
      });
      return { possN, attN, pointsPerPossession, avgDur, possToAttack, possToShot, attToShot, passesPerPoss, scoringPoss, counterPoss, channels };
    };
    const home = calc(possessionsFiltered.filter((p) => p.teamSide === 'home'));
    const away = calc(possessionsFiltered.filter((p) => p.teamSide === 'away'));
    return { home, away };
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
  return (
    <div className="space-y-4">
        <ComparisonMetricsCard
          title="Possession Metrics"
          homeTeam={homeTeam}
          awayTeam={awayTeam}
          teamMode={teamMode}
          rows={[
            { label: 'Possessions', home: sideKpis.home.possN, away: sideKpis.away.possN },
            { label: 'Attacks', home: sideKpis.home.attN, away: sideKpis.away.attN },
            { label: 'Points Per Possession', home: Number.isFinite(sideKpis.home.pointsPerPossession) ? sideKpis.home.pointsPerPossession.toFixed(2) : 'NA', away: Number.isFinite(sideKpis.away.pointsPerPossession) ? sideKpis.away.pointsPerPossession.toFixed(2) : 'NA' },
            { label: 'Avg Possession Duration', home: Number.isFinite(sideKpis.home.avgDur) ? `${sideKpis.home.avgDur.toFixed(1)}s` : 'NA', away: Number.isFinite(sideKpis.away.avgDur) ? `${sideKpis.away.avgDur.toFixed(1)}s` : 'NA' },
            { label: 'Possession To Attack %', home: formatPct(sideKpis.home.possToAttack), away: formatPct(sideKpis.away.possToAttack) },
            { label: 'Possession To Shot %', home: formatPct(sideKpis.home.possToShot), away: formatPct(sideKpis.away.possToShot) },
            { label: 'Attack To Shot %', home: formatPct(sideKpis.home.attToShot), away: formatPct(sideKpis.away.attToShot) },
            { label: 'Completed Passes Per Possession', home: Number.isFinite(sideKpis.home.passesPerPoss) ? sideKpis.home.passesPerPoss.toFixed(2) : 'NA', away: Number.isFinite(sideKpis.away.passesPerPoss) ? sideKpis.away.passesPerPoss.toFixed(2) : 'NA' },
            { label: 'Scoring Possession %', home: formatPct(sideKpis.home.scoringPoss), away: formatPct(sideKpis.away.scoringPoss) },
            { label: 'Defence Set? Possession %', home: formatPct(sideKpis.home.counterPoss), away: formatPct(sideKpis.away.counterPoss) },
          ]}
        />

        {possessionsFiltered.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-sm text-slate-600 text-center">
              No possessions available for current filters.
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid lg:grid-cols-2 gap-4">
              <Card>
                <CardContent className="p-4 space-y-3">
                  <div className="font-semibold text-slate-900">Possession Outcomes</div>
                  <ChartContainer id="possession-outcomes" className="h-[240px] w-full" config={{}}>
                    <BarChart data={possessionOutcomeData} margin={{ top: 10, right: 16, left: 0, bottom: 6 }}>
                      <CartesianGrid vertical={false} />
                      <XAxis dataKey="team" className="text-xs" />
                      <YAxis allowDecimals={false} className="text-xs" />
                      <Tooltip content={<ChartTooltipContent />} />
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
                      <Tooltip content={<ChartTooltipContent />} />
                      <Legend />
                      {outcomeSeries.map((o) => (
                        <Bar key={o.k} dataKey={o.k} stackId="a" fill={o.c} />
                      ))}
                    </BarChart>
                  </ChartContainer>
                </CardContent>
              </Card>
            </div>

            <div className="grid lg:grid-cols-[1fr_1fr] gap-4">
              <Card>
                <CardContent className="p-4 space-y-3">
                  <div className="font-semibold text-slate-900">Possession Start Zones</div>
                  <ChartContainer id="possession-start-zones" className="h-[240px] w-full" config={{}}>
                    <BarChart data={startZoneData} margin={{ top: 10, right: 16, left: 0, bottom: 6 }}>
                      <CartesianGrid vertical={false} />
                      <XAxis dataKey="team" className="text-xs" />
                      <YAxis allowDecimals={false} className="text-xs" />
                      <Tooltip content={<ChartTooltipContent />} />
                      <Legend />
                      <Bar dataKey="Defensive Third" stackId="a" fill="#60a5fa" />
                      <Bar dataKey="Middle Third" stackId="a" fill="#f59e0b" />
                      <Bar dataKey="Attacking Third" stackId="a" fill="#22c55e" />
                    </BarChart>
                  </ChartContainer>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4 space-y-3">
                  <div className="font-semibold text-slate-900">Possession Origins</div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Event</TableHead>
                        <TableHead className="text-right">{homeTeam?.name || 'Home'}</TableHead>
                        <TableHead className="text-right">{awayTeam?.name || 'Away'}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {originTableRows.map((row) => (
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
                      <TableHead>Poss</TableHead>
                      <TableHead>Team</TableHead>
                      <TableHead>Half</TableHead>
                      <TableHead className="text-right">Start</TableHead>
                      <TableHead className="text-right">End</TableHead>
                      <TableHead className="text-right">Dur</TableHead>
                      <TableHead>Start Source</TableHead>
                      <TableHead>Outcome</TableHead>
                      <TableHead className="text-right">Completed Passes</TableHead>
                      <TableHead className="text-right">Pts</TableHead>
                      <TableHead className="text-right">Attack</TableHead>
                      <TableHead>Start Zone</TableHead>
                      <TableHead>Defence Set?</TableHead>
                      <TableHead className="text-right"> </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {possessionsFiltered.slice(0, 250).map((p) => {
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

