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

function FoulsDisciplineTab({ stats, homeTeam, awayTeam, playerOptions, reportFilters, onOpenVideoAt }) {
  const analysisFilters = useMemo(() => ({ ...reportFilters, team: 'both', allowedActionTypes: ['foul', 'pass', 'carry', 'turnover', 'kickout', 'throw_in'] }), [reportFilters]);
  const base = useMemo(() => applyNonTeamReportFilters(stats, analysisFilters), [stats, analysisFilters]);
  const teamMode = String(reportFilters?.team || 'both');
  const fouls = useMemo(() => base.filter((s) => !!extractFoulFromStat(s)), [base]);
  const scorableFreeRows = useMemo(() => findScorableFreeConcededRows(base), [base]);

  const kpis = useMemo(() => {
    const by = {
      home: { won: 0, conceded: 0, yellow: 0, black: 0, red: 0, scorable: 0 },
      away: { won: 0, conceded: 0, yellow: 0, black: 0, red: 0, scorable: 0 },
    };
    for (const s of fouls) {
      const f = extractFoulFromStat(s);
      const foulBy = f?.foul_by?.team_side;
      const foulOn = f?.foul_on_or_forced_by?.team_side;
      const card = String(f?.card || 'none');
      if (foulOn === 'home') by.home.won += 1;
      if (foulOn === 'away') by.away.won += 1;
      if (foulBy === 'home') by.home.conceded += 1;
      if (foulBy === 'away') by.away.conceded += 1;
      if (foulBy === 'home') {
        if (card === 'yellow') by.home.yellow += 1;
        if (card === 'black') by.home.black += 1;
        if (card === 'red') by.home.red += 1;
      }
      if (foulBy === 'away') {
        if (card === 'yellow') by.away.yellow += 1;
        if (card === 'black') by.away.black += 1;
        if (card === 'red') by.away.red += 1;
      }
    }
    for (const row of scorableFreeRows) {
      if (row.concedingSide === 'home') by.home.scorable += 1;
      if (row.concedingSide === 'away') by.away.scorable += 1;
    }
    return by;
  }, [fouls, scorableFreeRows]);

  const visibleFouls = useMemo(() => {
    if (teamMode === 'both') return fouls;
    return fouls.filter((s) => {
      const f = extractFoulFromStat(s);
      return f?.foul_by?.team_side === teamMode || f?.foul_on_or_forced_by?.team_side === teamMode;
    });
  }, [fouls, teamMode]);

  const typeRows = useMemo(() => {
    const rows = new Map();
    for (const s of visibleFouls) {
      const f = extractFoulFromStat(s);
      const typ = toTitleCase(f?.foul_type || 'Unknown');
      const cur = rows.get(typ) || { type: typ, count: 0, home: 0, away: 0 };
      cur.count += 1;
      const foulBySide = f?.foul_by?.team_side;
      if (foulBySide === 'home') cur.home += 1;
      if (foulBySide === 'away') cur.away += 1;
      rows.set(typ, cur);
    }
    return Array.from(rows.values()).sort((a, b) => b.count - a.count);
  }, [visibleFouls]);

  const foulMapStats = useMemo(() => {
    return visibleFouls.map((stat) => {
      const foul = extractFoulFromStat(stat);
      const foulBySide = foul?.foul_by?.team_side || stat?.team_side;
      const foulBy = foul?.foul_by;
      const useEndPoint = stat?.stat_type === 'pass' || stat?.stat_type === 'carry';
      const x = useEndPoint ? stat?.end_x_position : stat?.x_position;
      const y = useEndPoint ? stat?.end_y_position : stat?.y_position;
      const rawX = useEndPoint ? stat?.raw_end_x_position : stat?.raw_x_position;
      const rawY = useEndPoint ? stat?.raw_end_y_position : stat?.raw_y_position;
      return {
        ...stat,
        stat_type: 'foul',
        team_side: stat?.team_side,
        color_team_side: foulBySide || stat?.team_side,
        player_name: foulBy?.name || stat?.player_name || '',
        player_number: foulBy?.number ?? stat?.player_number ?? '',
        x_position: x,
        y_position: y,
        raw_x_position: rawX,
        raw_y_position: rawY,
        end_x_position: undefined,
        end_y_position: undefined,
        raw_end_x_position: undefined,
        raw_end_y_position: undefined,
      };
    }).filter((s) => Number.isFinite(Number(s?.x_position)) && Number.isFinite(Number(s?.y_position)));
  }, [visibleFouls]);
  const [typeSort, setTypeSort] = useState({ key: teamMode === 'both' ? 'count' : 'count', dir: 'desc' });
  const typeColumns = useMemo(() => ([
    { key: 'type', label: 'Type', sortValue: (r) => r.type },
    { key: 'home', label: homeTeam?.name || 'Home', sortValue: (r) => r.home },
    { key: 'away', label: awayTeam?.name || 'Away', sortValue: (r) => r.away },
    { key: 'count', label: 'Count', sortValue: (r) => (teamMode === 'home' ? r.home : teamMode === 'away' ? r.away : r.count) },
  ]), [homeTeam, awayTeam, teamMode]);
  const toggleTypeSort = (key) => setTypeSort((current) => current.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'type' ? 'asc' : 'desc' });
  const sortedTypeRows = useMemo(() => sortRows(typeRows, typeSort, typeColumns, 'type'), [typeRows, typeSort, typeColumns]);
  const [freeSort, setFreeSort] = useState({ key: 'distance', dir: 'desc' });
  const freeColumns = useMemo(() => ([
    { key: 'team', label: 'Team', sortValue: (r) => r.concedingSide === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home') },
    { key: 'foulType', label: 'Foul Type', sortValue: (r) => r?.foul?.foul_type || '' },
    { key: 'restartType', label: 'Restart', sortValue: (r) => r.restartType || '' },
    { key: 'distance', label: 'Distance', sortValue: (r) => r.distance },
    { key: 'playId', label: 'Play', sortValue: (r) => r.playId },
    { key: 'possessionId', label: 'Possession', sortValue: (r) => r.possessionId },
  ]), [homeTeam, awayTeam]);
  const filteredScorableRows = useMemo(() => scorableFreeRows.filter((row) => teamMode === 'both' || row.concedingSide === teamMode), [scorableFreeRows, teamMode]);
  const sortedScorableRows = useMemo(() => sortRows(filteredScorableRows, freeSort, freeColumns, 'playId'), [filteredScorableRows, freeSort, freeColumns]);
  const toggleFreeSort = (key) => setFreeSort((current) => current.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'team' || key === 'foulType' || key === 'restartType' ? 'asc' : 'desc' });

  return (
    <div className="space-y-4">
        <ComparisonMetricsCard
          title="Foul Metrics"
          homeTeam={homeTeam}
          awayTeam={awayTeam}
          teamMode={teamMode}
          rows={[
            { label: 'Fouls Conceded', home: kpis.home.conceded, away: kpis.away.conceded },
            { label: 'Cards Total', home: kpis.home.yellow + kpis.home.black + kpis.home.red, away: kpis.away.yellow + kpis.away.black + kpis.away.red },
            { label: 'Scorable Frees Conceded', home: kpis.home.scorable, away: kpis.away.scorable },
          ]}
        />

        {visibleFouls.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-sm text-slate-600 text-center">No fouls available for current filters.</CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="font-semibold text-slate-900">Foul Map</div>
                <PitchViz
                  stats={foulMapStats}
                  homeColor={homeTeam?.color}
                  awayColor={awayTeam?.color}
                  colorBy="team"
                  showColorControls={false}
                mirrorAwayWhenBoth={teamMode !== 'home'}
                  directionLabel="Home ->"
                  onOpenVideoAt={onOpenVideoAt}
                />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="font-semibold text-slate-900">Foul Types</div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <SortableTableHead column={typeColumns[0]} sortState={typeSort} onToggle={toggleTypeSort} />
                      {teamMode === 'both' ? (
                        <>
                          <SortableTableHead column={typeColumns[1]} sortState={typeSort} onToggle={toggleTypeSort} className="text-right" />
                          <SortableTableHead column={typeColumns[2]} sortState={typeSort} onToggle={toggleTypeSort} className="text-right" />
                        </>
                      ) : (
                        <SortableTableHead column={typeColumns[3]} sortState={typeSort} onToggle={toggleTypeSort} className="text-right" />
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedTypeRows.map((r) => (
                      <TableRow key={r.type}>
                        <TableCell className="font-medium">{r.type}</TableCell>
                        {teamMode === 'both' ? (
                          <>
                            <TableCell className="text-right tabular-nums">{r.home}</TableCell>
                            <TableCell className="text-right tabular-nums">{r.away}</TableCell>
                          </>
                        ) : (
                          <TableCell className="text-right tabular-nums">{teamMode === 'home' ? r.home : r.away}</TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="font-semibold text-slate-900">Scorable Free Conceded Events</div>
                {scorableFreeRows.length === 0 ? (
                  <div className="text-sm text-slate-600">No scorable frees conceded for current filters.</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <SortableTableHead column={freeColumns[0]} sortState={freeSort} onToggle={toggleFreeSort} />
                        <SortableTableHead column={freeColumns[1]} sortState={freeSort} onToggle={toggleFreeSort} />
                        <SortableTableHead column={freeColumns[2]} sortState={freeSort} onToggle={toggleFreeSort} />
                        <SortableTableHead column={freeColumns[3]} sortState={freeSort} onToggle={toggleFreeSort} className="text-right" />
                        <SortableTableHead column={freeColumns[4]} sortState={freeSort} onToggle={toggleFreeSort} className="text-right" />
                        <SortableTableHead column={freeColumns[5]} sortState={freeSort} onToggle={toggleFreeSort} className="text-right" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedScorableRows
                        .slice(0, 200)
                        .map((row) => (
                          <TableRow key={`${row.playId}-${row.restartStat?.id || ''}`}>
                            <TableCell>{row.concedingSide === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home')}</TableCell>
                            <TableCell>{toTitleCase(row.foul?.foul_type || 'Unknown')}</TableCell>
                            <TableCell>{toTitleCase(row.restartType || 'Unknown')}</TableCell>
                            <TableCell className="text-right tabular-nums">{Number.isFinite(row.distance) ? row.distance.toFixed(1) : 'NA'}m</TableCell>
                            <TableCell className="text-right tabular-nums">{Number.isFinite(row.playId) ? row.playId : 'NA'}</TableCell>
                            <TableCell className="text-right tabular-nums">{Number.isFinite(row.possessionId) ? row.possessionId : 'NA'}</TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </>
        )}
    </div>
  );
}


export default FoulsDisciplineTab;

