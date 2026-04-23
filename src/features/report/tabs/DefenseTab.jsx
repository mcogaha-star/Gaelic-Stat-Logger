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
  isBroughtBackAdvantageStat,
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

function DefenseTab({
  stats,
  homeTeam,
  awayTeam,
  reportFilters,
  eventCategory,
  setEventCategory,
  turnoverResult,
  setTurnoverResult,
  turnoverTypes,
  setTurnoverTypes,
  defTypes,
  setDefTypes,
  onOpenVideoAt,
}) {
  const analysisFilters = useMemo(() => ({ ...reportFilters, team: 'both', allowedActionTypes: ['turnover', 'foul'] }), [reportFilters]);
  const base = useMemo(() => applyNonTeamReportFilters(stats, analysisFilters), [stats, analysisFilters]);
  const calcBase = useMemo(() => base.filter((s) => !isBroughtBackAdvantageStat(s)), [base]);
  const teamMode = String(reportFilters?.team || 'both');

  const turnovers = useMemo(() => base.filter((s) => s?.stat_type === 'turnover' || (safeParseJSON(s?.extra_data || '{}', {})?.turnover)), [base]);
  const calcTurnovers = useMemo(() => calcBase.filter((s) => s?.stat_type === 'turnover' || (safeParseJSON(s?.extra_data || '{}', {})?.turnover)), [calcBase]);
  const defensiveFouls = useMemo(() => calcBase.filter((s) => {
    const f = extractFoulFromStat(s);
    if (!f?.foul_by?.team_side) return false;
    return ['pull', 'push', 'tackle', 'high_tackle'].includes(normalizeFoulType(f?.foul_type));
  }), [calcBase]);

  const classifyTurnover = (s) => {
    const ex = safeParseJSON(s?.extra_data || '{}', {});
    const t = ex?.turnover || {};
    const foul = extractFoulFromStat(s);
    const lost = t?.lost_by?.team_side || foul?.foul_by?.team_side || null;
    const typ = String(t?.type || t?.turnover_type || ex?.turnover_type || foul?.foul_type || '');
    const normalizedType = normalizeFoulType(typ);
    const rec = normalizedType === 'foul'
      ? (foul?.foul_on_or_forced_by?.team_side || foul?.foul_on?.team_side || t?.forced_by?.team_side || null)
      : (t?.recovered_by?.team_side || foul?.foul_on_or_forced_by?.team_side || foul?.foul_on?.team_side || null);
    const unforced = !!t?.unforced || normalizeFoulType(typ) === 'unforced';
    return { lost, rec, unforced, typ };
  };

  const teamRelevant = (row, side) => {
    if (!row || side === 'both') return true;
    return row.rec === side || row.lost === side;
  };

  const kpis = useMemo(() => {
    const calc = (teamSide) => {
      const won = calcTurnovers.filter((s) => classifyTurnover(s).rec === teamSide).length;
      const lost = calcTurnovers.filter((s) => classifyTurnover(s).lost === teamSide).length;
      const unforcedLost = calcTurnovers.filter((s) => {
        const c = classifyTurnover(s);
        return c.lost === teamSide && c.unforced;
      }).length;

      const winXs = calcTurnovers
        .filter((s) => classifyTurnover(s).rec === teamSide)
        .map((s) => Number(s?.x_position))
        .filter(Number.isFinite);
      const avgHeight = winXs.length ? (winXs.reduce((a, b) => a + b, 0) / winXs.length) : NaN;

      const byPoss = groupByPossession(calcBase);
      const startKeys = new Set();
      for (const s of calcTurnovers) {
        const c = classifyTurnover(s);
        if (c.rec !== teamSide) continue;
        const pid = Number(s?.possession_id);
        const pside = s?.possession_team_side;
        if (Number.isFinite(pid) && pside === teamSide) startKeys.add(`${pside}-${pid}`);
      }
      const poss = Array.from(startKeys).map((k) => byPoss.get(k) || []);
      const shotsFrom = poss.filter((evs) => evs.some((e) => e.team_side === teamSide && e.stat_type === 'shot' && !isBroughtBackAdvantageStat(e))).length;
      const scoresFrom = poss.filter((evs) => evs.some((e) => {
        if (e.team_side !== teamSide || e.stat_type !== 'shot' || isBroughtBackAdvantageStat(e)) return false;
        const ex = safeParseJSON(e.extra_data || '{}', {});
        return shotOutcomeGroup(ex?.shot?.outcome) === 'score';
      })).length;

      const oppSide = teamSide === 'home' ? 'away' : 'home';
      const oppCompletedPasses = calcBase.filter((s) => {
        if (s?.stat_type !== 'pass' || s?.team_side !== oppSide) return false;
        const ex = safeParseJSON(s.extra_data || '{}', {});
        return deriveOutcome(s, ex) === 'completed';
      }).length;
      const defActionCount =
        won +
        defensiveFouls.filter((s) => extractFoulFromStat(s)?.foul_by?.team_side === teamSide).length;

      const concededKeys = new Set();
      for (const s of calcTurnovers) {
        const c = classifyTurnover(s);
        if (c.lost !== teamSide) continue;
        const pid = Number(s?.possession_id);
        const pside = s?.possession_team_side;
        if (Number.isFinite(pid) && pside === oppSide) concededKeys.add(`${pside}-${pid}`);
      }
      const concededPoss = Array.from(concededKeys).map((k) => byPoss.get(k) || []);
      const scoresConceded = concededPoss.filter((evs) => evs.some((e) => {
        if (e.team_side !== oppSide || e.stat_type !== 'shot' || isBroughtBackAdvantageStat(e)) return false;
        const ex = safeParseJSON(e.extra_data || '{}', {});
        return shotOutcomeGroup(ex?.shot?.outcome) === 'score';
      })).length;

      const possessionCount = Array.from(byPoss.keys()).filter((k) => String(k).startsWith(`${teamSide}-`)).length;

      return {
        won,
        lost,
        diff: won - lost,
        unforcedLost,
        avgHeight,
        shotsFrom,
        scoresFrom,
        scoresConceded,
        defActionCount,
        ppda: defActionCount ? oppCompletedPasses / defActionCount : NaN,
        turnoverRate: possessionCount ? lost / possessionCount : NaN,
      };
    };
    return { home: calc('home'), away: calc('away') };
  }, [calcTurnovers, calcBase, defensiveFouls]);

  const typeRows = useMemo(() => {
    const rows = new Map();
    for (const s of calcTurnovers) {
      const c = classifyTurnover(s);
      if (!teamRelevant(c, teamMode)) continue;
      const typ = toTitleCase(c.typ || 'Unknown');
      const cur = rows.get(typ) || { type: typ, home: 0, away: 0, won: 0, lost: 0 };
      if (c.rec === 'home') cur.home += 1;
      if (c.rec === 'away') cur.away += 1;
      if (c.rec && (teamMode === 'both' || c.rec === teamMode)) cur.won += 1;
      if (c.lost && (teamMode === 'both' || c.lost === teamMode)) cur.lost += 1;
      rows.set(typ, cur);
    }
    return Array.from(rows.values()).sort((a, b) => String(a.type).localeCompare(String(b.type)));
  }, [calcTurnovers, teamMode]);

  const filteredTurnovers = useMemo(() => turnovers.filter((s) => {
    const c = classifyTurnover(s);
    if (!teamRelevant(c, teamMode)) return false;
    if (turnoverResult === 'won' && c.rec !== teamMode && teamMode !== 'both') return false;
    if (turnoverResult === 'lost' && c.lost !== teamMode && teamMode !== 'both') return false;
    if (turnoverResult === 'won' && teamMode === 'both' && !c.rec) return false;
    if (turnoverResult === 'lost' && teamMode === 'both' && !c.lost) return false;
    if (turnoverTypes.length && !turnoverTypes.includes(normalizeFoulType(String(c.typ || '')))) return false;
    return true;
  }), [turnovers, turnoverResult, turnoverTypes, teamMode]);

  const mapStats = useMemo(() => filteredTurnovers, [filteredTurnovers]);
  const [typeSort, setTypeSort] = useState({ key: teamMode === 'both' ? 'home' : 'won', dir: 'desc' });
  const typeColumns = useMemo(() => ([
    { key: 'type', label: 'Type', sortValue: (r) => r.type },
    { key: 'home', label: homeTeam?.name || 'Home', sortValue: (r) => r.home },
    { key: 'away', label: awayTeam?.name || 'Away', sortValue: (r) => r.away },
    { key: 'count', label: 'Count', sortValue: (r) => r.won + r.lost },
  ]), [homeTeam, awayTeam]);
  const sortedTypeRows = useMemo(() => sortRows(typeRows, typeSort, typeColumns, 'type'), [typeRows, typeSort, typeColumns]);
  const toggleTypeSort = (key) => setTypeSort((current) => current.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'type' ? 'asc' : 'desc' });

  return (
    <div className="space-y-4">
        <div className="grid lg:grid-cols-[0.75fr_1.25fr] gap-5 items-start">
          <ComparisonMetricsCard
            title="Defense Metrics"
            homeTeam={homeTeam}
            awayTeam={awayTeam}
            teamMode={teamMode}
            cardClassName="w-full"
            metricColWidth="140px"
            rows={[
              { label: 'Turnovers Won', home: kpis.home.won, away: kpis.away.won },
              { label: 'Turnovers Lost', home: kpis.home.lost, away: kpis.away.lost },
              { label: 'Turnover Differential', home: kpis.home.diff, away: kpis.away.diff },
              { label: 'Unforced TO Lost', home: kpis.home.unforcedLost, away: kpis.away.unforcedLost },
              { label: 'Average Regain Height (x)', home: Number.isFinite(kpis.home.avgHeight) ? kpis.home.avgHeight.toFixed(1) : 'NA', away: Number.isFinite(kpis.away.avgHeight) ? kpis.away.avgHeight.toFixed(1) : 'NA' },
              { label: 'Defensive Actions', home: kpis.home.defActionCount, away: kpis.away.defActionCount },
              { label: 'PPDA', home: Number.isFinite(kpis.home.ppda) ? kpis.home.ppda.toFixed(2) : 'NA', away: Number.isFinite(kpis.away.ppda) ? kpis.away.ppda.toFixed(2) : 'NA' },
              { label: 'Turnover Rate', home: formatPct(Number.isFinite(kpis.home.turnoverRate) ? kpis.home.turnoverRate * 100 : NaN), away: formatPct(Number.isFinite(kpis.away.turnoverRate) ? kpis.away.turnoverRate * 100 : NaN) },
              { label: 'Shots From Regains', home: kpis.home.shotsFrom, away: kpis.away.shotsFrom },
              { label: 'Scores From Regains', home: kpis.home.scoresFrom, away: kpis.away.scoresFrom },
              { label: 'Scores Conceded After Lost Turnovers', home: kpis.home.scoresConceded, away: kpis.away.scoresConceded },
            ]}
          />

          {mapStats.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-sm text-slate-600 text-center">No turnover events available for current filters.</CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-4 space-y-3 h-full">
                <div className="font-semibold text-slate-900">Turnover Lost Map</div>
                <PitchViz
                  stats={mapStats}
                  homeColor={homeTeam?.color}
                  awayColor={awayTeam?.color}
                  colorBy={teamMode === 'both' ? 'team' : 'action'}
                  showColorControls={false}
                  mirrorAwayWhenBoth={teamMode !== 'home'}
                  directionLabel="Home ->"
                  turnoverEndpointOnly
                  pitchScale="100%"
                  onOpenVideoAt={onOpenVideoAt}
                />
              </CardContent>
            </Card>
          )}
        </div>

        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="font-semibold text-slate-900">Turnover Type Breakdown</div>
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
                      <TableCell className="text-right tabular-nums">{r.won + r.lost}</TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="text-[11px] text-slate-500">Counts are best-effort from turnover.type and embedded turnover fields.</div>
          </CardContent>
        </Card>
    </div>
  );
}


export default DefenseTab;

