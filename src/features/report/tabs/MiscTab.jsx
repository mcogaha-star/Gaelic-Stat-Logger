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
  formatExtraValue,
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

function MiscTab({ stats, homeTeam, awayTeam, playerOptions, reportFilters }) {
  const scopedReportFilters = useMemo(() => ({ ...reportFilters, allowedActionTypes: ['throw_in'] }), [reportFilters]);
  const base = useMemo(() => applyNonTeamReportFilters(stats, scopedReportFilters), [stats, scopedReportFilters]);
  const throwIns = useMemo(() => base.filter((s) => s?.stat_type === 'throw_in'), [base]);

  const kpis = useMemo(() => {
    const calc = (teamSide) => {
      const contested = throwIns.length;
      const won = throwIns.filter((s) => {
        const ex = safeParseJSON(s.extra_data || '{}', {});
        const out = ex?.throw_in?.outcome;
        const w = ex?.throw_in?.won_by;
        return (out === 'clean' || out === 'break') && w?.team_side === teamSide;
      }).length;
      const cleanWon = throwIns.filter((s) => {
        const ex = safeParseJSON(s.extra_data || '{}', {});
        const out = ex?.throw_in?.outcome;
        const w = ex?.throw_in?.won_by;
        return out === 'clean' && w?.team_side === teamSide;
      }).length;
      const breakWon = throwIns.filter((s) => {
        const ex = safeParseJSON(s.extra_data || '{}', {});
        const out = ex?.throw_in?.outcome;
        const w = ex?.throw_in?.won_by;
        return out === 'break' && w?.team_side === teamSide;
      }).length;
      return { contested, won, cleanWon, breakWon };
    };
    return { home: calc('home'), away: calc('away') };
  }, [throwIns]);

  const outcomeRows = useMemo(() => {
    const rows = new Map();
    for (const s of throwIns) {
      const ex = safeParseJSON(s.extra_data || '{}', {});
      const out = String(ex?.throw_in?.outcome || 'unknown');
      rows.set(out, (rows.get(out) || 0) + 1);
    }
    return Array.from(rows.entries())
      .map(([k, v]) => ({ outcome: toTitleCase(k), count: v }))
      .sort((a, b) => b.count - a.count || String(a.outcome).localeCompare(String(b.outcome)));
  }, [throwIns]);

  const playerRows = useMemo(() => {
    const rows = new Map();
    const bump = (sel, field) => {
      if (!sel) return;
      const key = JSON.stringify({ kind: sel.kind, id: sel.id || '', team_side: sel.team_side || '' });
      const cur = rows.get(key) || { key, player: formatExtraValue(sel), team: sel.team_side || 'unknown', won: 0, lost: 0, broken: 0 };
      cur[field] += 1;
      rows.set(key, cur);
    };
    for (const s of throwIns) {
      const ex = safeParseJSON(s.extra_data || '{}', {});
      const ti = ex?.throw_in || {};
      bump(ti.won_by, 'won');
      bump(ti.lost_by, 'lost');
      bump(ti.broken_by, 'broken');
    }
    return Array.from(rows.values()).sort((a, b) => (b.won + b.lost + b.broken) - (a.won + a.lost + a.broken));
  }, [throwIns]);

  return (
    <div className="space-y-4">
        {throwIns.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-sm text-slate-600 text-center">No throw-ins available for current filters.</CardContent>
          </Card>
        ) : (
          <>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                {
                  label: 'Throw-In Win %',
                  value: `${kpis.home.won}/${kpis.home.contested} (${formatPct(kpis.home.contested ? (kpis.home.won / kpis.home.contested) * 100 : NaN)}) • ${kpis.away.won}/${kpis.away.contested} (${formatPct(kpis.away.contested ? (kpis.away.won / kpis.away.contested) * 100 : NaN)})`,
                },
                { label: 'Clean Wins', value: `${kpis.home.cleanWon} • ${kpis.away.cleanWon}` },
                { label: 'Break Wins', value: `${kpis.home.breakWon} • ${kpis.away.breakWon}` },
                { label: 'Throw-Ins Contested', value: throwIns.length },
              ].map((k) => (
                <Card key={k.label}>
                  <CardContent className="p-3">
                    <div className="text-[11px] text-slate-600">{k.label}</div>
                    <div className="text-lg font-semibold text-slate-900 tabular-nums">{k.value}</div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="grid lg:grid-cols-2 gap-4">
              <Card>
                <CardContent className="p-4 space-y-3">
                  <div className="font-semibold text-slate-900">Throw-In Outcomes</div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Outcome</TableHead>
                        <TableHead className="text-right">Count</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {outcomeRows.map((r) => (
                        <TableRow key={r.outcome}>
                          <TableCell className="font-medium">{r.outcome}</TableCell>
                          <TableCell className="text-right tabular-nums">{r.count}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4 space-y-3">
                  <div className="font-semibold text-slate-900">Throw-In Players</div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Player</TableHead>
                        <TableHead>Team</TableHead>
                        <TableHead className="text-right">Won</TableHead>
                        <TableHead className="text-right">Lost</TableHead>
                        <TableHead className="text-right">Broken</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {playerRows.slice(0, 200).map((r) => (
                        <TableRow key={r.key}>
                          <TableCell className="font-medium">{r.player}</TableCell>
                          <TableCell>{r.team === 'away' ? (awayTeam?.name || 'Away') : (r.team === 'home' ? (homeTeam?.name || 'Home') : 'NA')}</TableCell>
                          <TableCell className="text-right tabular-nums">{r.won}</TableCell>
                          <TableCell className="text-right tabular-nums">{r.lost}</TableCell>
                          <TableCell className="text-right tabular-nums">{r.broken}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          </>
        )}
    </div>
  );
}


export default MiscTab;

