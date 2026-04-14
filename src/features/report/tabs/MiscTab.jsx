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
  inferRestartWinnerSide,
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

function MiscTab({ stats, homeTeam, awayTeam, playerOptions, reportFilters }) {
  const scopedReportFilters = useMemo(() => ({ ...reportFilters, allowedActionTypes: ['throw_in'] }), [reportFilters]);
  const base = useMemo(() => applyNonTeamReportFilters(stats, scopedReportFilters), [stats, scopedReportFilters]);
  const throwIns = useMemo(() => base.filter((s) => s?.stat_type === 'throw_in'), [base]);
  const nextStatById = useMemo(() => {
    const ordered = (Array.isArray(stats) ? stats.slice() : []).sort((a, b) => {
      const pa = Number(a?.play_id);
      const pb = Number(b?.play_id);
      if (Number.isFinite(pa) && Number.isFinite(pb) && pa !== pb) return pa - pb;
      const ta = Number(a?.normalized_time_s);
      const tb = Number(b?.normalized_time_s);
      if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
      const ra = Number(a?.time_s);
      const rb = Number(b?.time_s);
      if (Number.isFinite(ra) && Number.isFinite(rb) && ra !== rb) return ra - rb;
      return String(a?.id || '').localeCompare(String(b?.id || ''));
    });
    const out = new Map();
    for (let i = 0; i < ordered.length; i += 1) out.set(ordered[i]?.id, ordered[i + 1] || null);
    return out;
  }, [stats]);

  const kpis = useMemo(() => {
    const calc = (teamSide) => {
      const contested = throwIns.length;
      const won = throwIns.filter((s) => {
        const ex = safeParseJSON(s.extra_data || '{}', {});
        const out = ex?.throw_in?.outcome;
        const wonSide = inferRestartWinnerSide(s, nextStatById.get(s.id));
        return wonSide === teamSide;
      }).length;
      const cleanWon = throwIns.filter((s) => {
        const ex = safeParseJSON(s.extra_data || '{}', {});
        const out = ex?.throw_in?.outcome;
        const wonSide = inferRestartWinnerSide(s, nextStatById.get(s.id));
        return out === 'clean' && wonSide === teamSide;
      }).length;
      const breakWon = throwIns.filter((s) => {
        const ex = safeParseJSON(s.extra_data || '{}', {});
        const out = ex?.throw_in?.outcome;
        const wonSide = inferRestartWinnerSide(s, nextStatById.get(s.id));
        return out === 'break' && wonSide === teamSide;
      }).length;
      return { contested, won, cleanWon, breakWon };
    };
    return { home: calc('home'), away: calc('away') };
  }, [throwIns, nextStatById]);

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
  const [outcomeSort, setOutcomeSort] = useState({ key: 'count', dir: 'desc' });
  const outcomeColumns = useMemo(() => ([
    { key: 'outcome', label: 'Outcome', sortValue: (r) => r.outcome },
    { key: 'count', label: 'Count', sortValue: (r) => r.count },
  ]), []);
  const sortedOutcomeRows = useMemo(() => sortRows(outcomeRows, outcomeSort, outcomeColumns, 'outcome'), [outcomeRows, outcomeSort, outcomeColumns]);
  const toggleOutcomeSort = (key) => setOutcomeSort((current) => current.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'outcome' ? 'asc' : 'desc' });
  const [playerSort, setPlayerSort] = useState({ key: 'won', dir: 'desc' });
  const playerColumns = useMemo(() => ([
    { key: 'player', label: 'Player', sortValue: (r) => r.player },
    { key: 'team', label: 'Team', sortValue: (r) => r.team === 'away' ? (awayTeam?.name || 'Away') : (r.team === 'home' ? (homeTeam?.name || 'Home') : 'NA') },
    { key: 'won', label: 'Won', sortValue: (r) => r.won },
    { key: 'lost', label: 'Lost', sortValue: (r) => r.lost },
    { key: 'broken', label: 'Broken', sortValue: (r) => r.broken },
  ]), [homeTeam, awayTeam]);
  const sortedPlayerRows = useMemo(() => sortRows(playerRows, playerSort, playerColumns, 'key'), [playerRows, playerSort, playerColumns]);
  const togglePlayerSort = (key) => setPlayerSort((current) => current.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'player' || key === 'team' ? 'asc' : 'desc' });

  return (
    <div className="space-y-4">
        {throwIns.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-sm text-slate-600 text-center">No throw-ins available for current filters.</CardContent>
          </Card>
        ) : (
          <>
            <ComparisonMetricsCard
              title="Throw-In Metrics"
              homeTeam={homeTeam}
              awayTeam={awayTeam}
              teamMode="both"
              rows={[
                {
                  label: 'Throw-In Win %',
                  home: `${kpis.home.won}/${kpis.home.contested} (${formatPct(kpis.home.contested ? (kpis.home.won / kpis.home.contested) * 100 : NaN)})`,
                  away: `${kpis.away.won}/${kpis.away.contested} (${formatPct(kpis.away.contested ? (kpis.away.won / kpis.away.contested) * 100 : NaN)})`,
                },
                { label: 'Clean Wins', home: kpis.home.cleanWon, away: kpis.away.cleanWon },
                { label: 'Break Wins', home: kpis.home.breakWon, away: kpis.away.breakWon },
                { label: 'Throw-Ins Contested', home: throwIns.length, away: throwIns.length },
              ]}
            />

            <div className="grid lg:grid-cols-2 gap-4">
              <Card>
                <CardContent className="p-4 space-y-3">
                  <div className="font-semibold text-slate-900">Throw-In Outcomes</div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <SortableTableHead column={outcomeColumns[0]} sortState={outcomeSort} onToggle={toggleOutcomeSort} />
                        <SortableTableHead column={outcomeColumns[1]} sortState={outcomeSort} onToggle={toggleOutcomeSort} className="text-right" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedOutcomeRows.map((r) => (
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
                        {playerColumns.map((column) => (
                          <SortableTableHead
                            key={column.key}
                            column={column}
                            sortState={playerSort}
                            onToggle={togglePlayerSort}
                            className={['won', 'lost', 'broken'].includes(column.key) ? 'text-right' : undefined}
                          />
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedPlayerRows.slice(0, 200).map((r) => (
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

