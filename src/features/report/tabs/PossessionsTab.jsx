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
  PitchViz,
  AttackChannelPitch,
  PassNetwork,
  ShotMap,
  shotSideFromY,
  shotZoneFromDistance,
  applyNonTeamReportFilters,
} from '../shared';

function PossessionsTab({ stats, homeTeam, awayTeam, reportFilters, onVisualisePossession, counterFilter, setCounterFilter }) {
  const scopedReportFilters = useMemo(() => ({ ...reportFilters, allowedActionTypes: ['pass', 'carry', 'shot', 'turnover', 'kickout', 'throw_in', 'foul'] }), [reportFilters]);
  const base = useMemo(() => applyNonTeamReportFilters(stats, scopedReportFilters), [stats, scopedReportFilters]);
  const teamMode = String(reportFilters?.team || 'both'); // both|home|away

  const possessions = useMemo(() => {
    const groups = groupByPossession(base);

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

      const startSource = (() => {
        const f = acting[0];
        const ex = safeParseJSON(f?.extra_data || '{}', {});
        if (f?.stat_type === 'kickout') return 'Kickout Won';
        if (f?.stat_type === 'turnover') return 'Turnover Won';
        if (f?.stat_type === 'throw_in') return 'Throw In Won';
        if (f?.stat_type === 'foul') return 'Foul Won';
        if (ex?.pass?.deadball) return 'Restart';
        return 'Other';
      })();

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
      set_attack: 'Set Attack',
      counter_attack: 'Counter Attack',
      counter_to_set: 'Counter -> Set',
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
      const scoringPoss = possN ? (rows.filter((p) => p.outcome === 'Score').length / possN) * 100 : NaN;
      const counterPoss = possN ? (rows.filter((p) => p.counterState === 'Counter Attack').length / possN) * 100 : NaN;
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

  const display = (fmtFn) => {
    if (teamMode === 'home') return fmtFn(sideKpis.home);
    if (teamMode === 'away') return fmtFn(sideKpis.away);
    return `${fmtFn(sideKpis.home)} / ${fmtFn(sideKpis.away)}`;
  };

  const byTeam = (rows) => {
    const out = {
      home: { Score: 0, 'Missed Shot': 0, Turnover: 0, 'Half End': 0 },
      away: { Score: 0, 'Missed Shot': 0, Turnover: 0, 'Half End': 0 },
    };
    for (const r of rows) {
      const side = r.teamSide;
      if (!out[side]) continue;
      const k = String(r.outcome || 'Turnover');
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
  return (
    <div className="space-y-4">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: 'Possessions', value: display((k) => String(k.possN)) },
            { label: 'Attacks', value: display((k) => String(k.attN)) },
            { label: 'Points Per Possession', value: display((k) => Number.isFinite(k.pointsPerPossession) ? k.pointsPerPossession.toFixed(2) : 'NA') },
            { label: 'Avg Possession Duration', value: display((k) => Number.isFinite(k.avgDur) ? `${k.avgDur.toFixed(1)}s` : 'NA') },
            { label: 'Possession To Attack %', value: display((k) => formatPct(k.possToAttack)) },
            { label: 'Possession To Shot %', value: display((k) => formatPct(k.possToShot)) },
            { label: 'Attack To Shot %', value: display((k) => formatPct(k.attToShot)) },
            { label: 'Completed Passes Per Possession', value: display((k) => Number.isFinite(k.passesPerPoss) ? k.passesPerPoss.toFixed(2) : 'NA') },
            { label: 'Scoring Possession %', value: display((k) => formatPct(k.scoringPoss)) },
            { label: 'Counter Attack Possession %', value: display((k) => formatPct(k.counterPoss)) },
          ].map((k) => (
            <Card key={k.label}>
              <CardContent className="p-3">
                <div className="text-[11px] text-slate-600">{k.label}</div>
                <div className="text-lg font-semibold text-slate-900 tabular-nums">{k.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>

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
                      {[
                        { k: 'Score', c: '#1d4ed8' },
                        { k: 'Missed Shot', c: '#64748b' },
                        { k: 'Turnover', c: '#dc2626' },
                        { k: 'Half End', c: '#94a3b8' },
                      ].map((o) => (
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
                      {[
                        { k: 'Score', c: '#1d4ed8' },
                        { k: 'Missed Shot', c: '#64748b' },
                        { k: 'Turnover', c: '#dc2626' },
                        { k: 'Half End', c: '#94a3b8' },
                      ].map((o) => (
                        <Bar key={o.k} dataKey={o.k} stackId="a" fill={o.c} />
                      ))}
                    </BarChart>
                  </ChartContainer>
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
                      <TableHead>Transition</TableHead>
                      <TableHead className="text-right"> </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {possessionsFiltered.slice(0, 250).map((p) => {
                      const teamName = p.teamSide === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home');
                      return (
                        <TableRow key={p.key}>
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

