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
}) {
  const analysisFilters = useMemo(() => ({ ...reportFilters, team: 'both', allowedActionTypes: ['turnover', 'defensive_contact', 'foul'] }), [reportFilters]);
  const base = useMemo(() => applyNonTeamReportFilters(stats, analysisFilters), [stats, analysisFilters]);
  const teamMode = String(reportFilters?.team || 'both');

  const turnovers = useMemo(() => base.filter((s) => s?.stat_type === 'turnover' || (safeParseJSON(s?.extra_data || '{}', {})?.turnover)), [base]);
  const defActions = useMemo(() => base.filter((s) => s?.stat_type === 'defensive_contact'), [base]);
  const defensiveFouls = useMemo(() => base.filter((s) => {
    const f = extractFoulFromStat(s);
    if (!f?.foul_by?.team_side) return false;
    return ['pull', 'push', 'tackle', 'high_tackle'].includes(normalizeFoulType(f?.foul_type));
  }), [base]);

  const classifyTurnover = (s) => {
    const ex = safeParseJSON(s?.extra_data || '{}', {});
    const t = ex?.turnover || {};
    const foul = extractFoulFromStat(s);
    const lost = t?.lost_by?.team_side || foul?.foul_by?.team_side || null;
    const rec = t?.recovered_by?.team_side || foul?.foul_on_or_forced_by?.team_side || foul?.foul_on?.team_side || null;
    const unforced = !!t?.unforced;
    const typ = String(t?.type || t?.turnover_type || ex?.turnover_type || foul?.foul_type || '');
    return { lost, rec, unforced, typ };
  };

  const teamRelevant = (row, side) => {
    if (!row || side === 'both') return true;
    return row.rec === side || row.lost === side;
  };

  const kpis = useMemo(() => {
    const calc = (teamSide) => {
      const won = turnovers.filter((s) => classifyTurnover(s).rec === teamSide).length;
      const lost = turnovers.filter((s) => classifyTurnover(s).lost === teamSide).length;
      const total = turnovers.filter((s) => {
        const c = classifyTurnover(s);
        return c.rec === teamSide || c.lost === teamSide;
      }).length;
      const forced = turnovers.filter((s) => {
        const c = classifyTurnover(s);
        return (c.rec === teamSide || c.lost === teamSide) && !c.unforced;
      }).length;
      const forcedPct = total ? (forced / total) * 100 : NaN;

      const winXs = turnovers
        .filter((s) => classifyTurnover(s).rec === teamSide)
        .map((s) => Number(s?.x_position))
        .filter(Number.isFinite);
      const avgHeight = winXs.length ? (winXs.reduce((a, b) => a + b, 0) / winXs.length) : NaN;

      const byPoss = groupByPossession(base);
      const startKeys = new Set();
      for (const s of turnovers) {
        const c = classifyTurnover(s);
        if (c.rec !== teamSide) continue;
        const pid = Number(s?.possession_id);
        const pside = s?.possession_team_side;
        if (Number.isFinite(pid) && pside === teamSide) startKeys.add(`${pside}-${pid}`);
      }
      const poss = Array.from(startKeys).map((k) => byPoss.get(k) || []);
      const shotsFrom = poss.filter((evs) => evs.some((e) => e.team_side === teamSide && e.stat_type === 'shot')).length;
      const scoresFrom = poss.filter((evs) => evs.some((e) => {
        if (e.team_side !== teamSide || e.stat_type !== 'shot') return false;
        const ex = safeParseJSON(e.extra_data || '{}', {});
        return shotOutcomeGroup(ex?.shot?.outcome) === 'score';
      })).length;

      const oppSide = teamSide === 'home' ? 'away' : 'home';
      const oppCompletedPasses = base.filter((s) => {
        if (s?.stat_type !== 'pass' || s?.team_side !== oppSide) return false;
        const ex = safeParseJSON(s.extra_data || '{}', {});
        return ex?.pass?.outcome === 'completed';
      }).length;
      const defActionCount =
        won +
        defActions.filter((s) => s?.team_side === teamSide).length +
        defensiveFouls.filter((s) => extractFoulFromStat(s)?.foul_by?.team_side === teamSide).length;

      const concededKeys = new Set();
      for (const s of turnovers) {
        const c = classifyTurnover(s);
        if (c.lost !== teamSide) continue;
        const pid = Number(s?.possession_id);
        const pside = s?.possession_team_side;
        if (Number.isFinite(pid) && pside === oppSide) concededKeys.add(`${pside}-${pid}`);
      }
      const concededPoss = Array.from(concededKeys).map((k) => byPoss.get(k) || []);
      const scoresConceded = concededPoss.filter((evs) => evs.some((e) => {
        if (e.team_side !== oppSide || e.stat_type !== 'shot') return false;
        const ex = safeParseJSON(e.extra_data || '{}', {});
        return shotOutcomeGroup(ex?.shot?.outcome) === 'score';
      })).length;

      const possessionCount = Array.from(byPoss.keys()).filter((k) => String(k).startsWith(`${teamSide}-`)).length;

      return {
        won,
        lost,
        diff: won - lost,
        forcedPct,
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
  }, [turnovers, base, defActions, defensiveFouls]);

  const typeRows = useMemo(() => {
    const rows = new Map();
    for (const s of turnovers) {
      const c = classifyTurnover(s);
      if (!teamRelevant(c, teamMode)) continue;
      const typ = toTitleCase(c.typ || 'Unknown');
      const cur = rows.get(typ) || { type: typ, won: 0, lost: 0 };
      if (c.rec && (teamMode === 'both' || c.rec === teamMode)) cur.won += 1;
      if (c.lost && (teamMode === 'both' || c.lost === teamMode)) cur.lost += 1;
      rows.set(typ, cur);
    }
    return Array.from(rows.values()).sort((a, b) => String(a.type).localeCompare(String(b.type)));
  }, [turnovers, teamMode]);

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

  const filteredDefActions = useMemo(() => defActions.filter((s) => {
    if (teamMode !== 'both' && s?.team_side !== teamMode) return false;
    if (!defTypes.length) return true;
    const ex = safeParseJSON(s?.extra_data || '{}', {});
    return defTypes.includes(String(ex?.defensive_contact?.type || ''));
  }), [defActions, defTypes, teamMode]);

  const mapStats = useMemo(() => {
    if (eventCategory === 'turnovers') return filteredTurnovers;
    if (eventCategory === 'def_actions') return filteredDefActions;
    return [...filteredTurnovers, ...filteredDefActions];
  }, [eventCategory, filteredTurnovers, filteredDefActions]);

  const display = (selector) => {
    if (teamMode === 'home') return selector(kpis.home);
    if (teamMode === 'away') return selector(kpis.away);
    return `${selector(kpis.home)} / ${selector(kpis.away)}`;
  };

  return (
    <div className="space-y-4">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: 'Turnovers Won', value: display((k) => String(k.won)) },
            { label: 'Turnovers Lost', value: display((k) => String(k.lost)) },
            { label: 'Turnover Differential', value: display((k) => String(k.diff)) },
            { label: 'Forced Turnover %', value: display((k) => formatPct(k.forcedPct)) },
            { label: 'Average Regain Height (x)', value: display((k) => Number.isFinite(k.avgHeight) ? k.avgHeight.toFixed(1) : 'NA') },
            { label: 'Defensive Actions', value: display((k) => String(k.defActionCount)) },
            { label: 'PPDA', value: display((k) => Number.isFinite(k.ppda) ? k.ppda.toFixed(2) : 'NA') },
            { label: 'Turnover Rate', value: display((k) => formatPct(Number.isFinite(k.turnoverRate) ? k.turnoverRate * 100 : NaN)) },
            { label: 'Shots From Regains', value: display((k) => String(k.shotsFrom)) },
            { label: 'Scores From Regains', value: display((k) => String(k.scoresFrom)) },
            { label: 'Scores Conceded After Lost Turnovers', value: display((k) => String(k.scoresConceded)) },
          ].map((k) => (
            <Card key={k.label}>
              <CardContent className="p-3">
                <div className="text-[11px] text-slate-600">{k.label}</div>
                <div className="text-lg font-semibold text-slate-900 tabular-nums">{k.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        {mapStats.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-sm text-slate-600 text-center">No defensive events available for current filters.</CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="font-semibold text-slate-900">Defensive Map</div>
                <PitchViz
                  stats={mapStats}
                  homeColor={homeTeam?.color}
                  awayColor={awayTeam?.color}
                  colorBy={teamMode === 'both' ? 'team' : 'action'}
                  showColorControls={false}
                  mirrorAwayWhenBoth={teamMode === 'both'}
                  directionLabel={teamMode === 'both' ? 'Home ->' : 'Attacking ->'}
                />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="font-semibold text-slate-900">Turnover Type Breakdown</div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Count</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {typeRows.map((r) => (
                      <TableRow key={r.type}>
                        <TableCell className="font-medium">{r.type}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.won + r.lost}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="text-[11px] text-slate-500">Counts are best-effort from turnover.type and embedded turnover fields.</div>
              </CardContent>
            </Card>
          </>
        )}
    </div>
  );
}


export default DefenseTab;

