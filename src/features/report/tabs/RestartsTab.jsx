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

function RestartsTab({ stats, homeTeam, awayTeam, playerOptions, reportFilters }) {
  const scopedReportFilters = useMemo(() => ({ ...reportFilters, allowedActionTypes: ['kickout', 'throw_in'] }), [reportFilters]);
  const base = useMemo(() => applyNonTeamReportFilters(stats, scopedReportFilters), [stats, scopedReportFilters]);
  const teamMode = String(reportFilters?.team || 'both');

  const kickouts = useMemo(() => base.filter((s) => s?.stat_type === 'kickout'), [base]);
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
    const byPoss = groupByPossession(base);

    const calcForTeam = (teamSide) => {
      const ownKickouts = [];
      const oppKickouts = [];
      for (const s of kickouts) {
        const ex = safeParseJSON(s.extra_data || '{}', {});
        const koTeam = ex?.kickout?.team_side;
        const o = ex?.kickout?.outcome;
        const wonSide = inferRestartWinnerSide(s, nextStatById.get(s.id));
        if (koTeam === teamSide) ownKickouts.push({ o, wonSide, koTeam });
        if (koTeam && koTeam !== teamSide) oppKickouts.push({ o, wonSide, koTeam });
      }

      const ownTaken = ownKickouts.length;
      const ownWon = ownKickouts.filter((r) => r.wonSide === teamSide).length;
      const ownCleanWon = ownKickouts.filter((r) => r.o === 'clean' && r.wonSide === teamSide).length;

      const oppTaken = oppKickouts.length;
      const oppDisrupted = oppKickouts.filter((r) => {
        const oppSide = r.koTeam;
        if (r.o !== 'clean') return true;
        return r.wonSide !== oppSide;
      }).length;

      // Restart-to-shot/score (best-effort): check possessions associated with won restarts.
      const restartPossKeys = new Set();
      for (const s of kickouts) {
        const ex = safeParseJSON(s.extra_data || '{}', {});
        const koTeam = ex?.kickout?.team_side;
        if (koTeam !== teamSide) continue;
        const wonSide = inferRestartWinnerSide(s, nextStatById.get(s.id));
        if (wonSide !== teamSide) continue;
        const pid = Number(s?.possession_id);
        const pside = s?.possession_team_side;
        if (Number.isFinite(pid) && pside === teamSide) restartPossKeys.add(`${pside}-${pid}`);
      }

      const restartPoss = Array.from(restartPossKeys).map((k) => byPoss.get(k) || []);
      const restartWins = restartPoss.length;
      const restartToShot = restartPoss.filter((evs) => evs.some((e) => e.team_side === teamSide && e.stat_type === 'shot')).length;
      const restartToScore = restartPoss.filter((evs) => evs.some((e) => {
        if (e.team_side !== teamSide || e.stat_type !== 'shot') return false;
        const ex = safeParseJSON(e.extra_data || '{}', {});
        return shotOutcomeGroup(ex?.shot?.outcome) === 'score';
      })).length;

      return {
        ownKickoutsTaken: ownTaken,
        ownKickoutsWon: ownWon,
        oppKickoutsTaken: oppTaken,
        oppDisrupted,
        ownCleanWon,
        restartWins,
        restartToShot,
        restartToScore,
      };
    };

    // Break-ball recovery % across both restarts (best-effort).
    const breakAll = kickouts.filter((s) => safeParseJSON(s.extra_data || '{}', {})?.kickout?.outcome === 'break');
    const breakWonHome = breakAll.filter((s) => inferRestartWinnerSide(s, nextStatById.get(s.id)) === 'home').length;
    const breakWonAway = breakAll.filter((s) => inferRestartWinnerSide(s, nextStatById.get(s.id)) === 'away').length;

    return {
      home: calcForTeam('home'),
      away: calcForTeam('away'),
      breakAll: breakAll.length,
      breakWonHome,
      breakWonAway,
    };
  }, [kickouts, base, nextStatById]);

  const kickoutTargets = useMemo(() => {
    const rows = new Map();
    for (const s of kickouts) {
      const ex = safeParseJSON(s.extra_data || '{}', {});
      const koTeam = ex?.kickout?.team_side;
      if (koTeam !== 'home' && koTeam !== 'away') continue;
      const r = ex?.kickout?.intended_recipient;
      const key = r?.kind === 'player' ? r.id : (r?.kind === 'team' ? 'team' : (r?.kind === 'none' ? 'none' : 'unknown'));
      const cur = rows.get(`${koTeam}|${key}`) || { team: koTeam, key, label: formatExtraValue(r), targeted: 0, won: 0, clean: 0, break: 0, marks: 0 };
      cur.targeted += 1;
      const o = ex?.kickout?.outcome;
      const wonSide = inferRestartWinnerSide(s, nextStatById.get(s.id));
      if (wonSide === koTeam) cur.won += 1;
      if (o === 'clean' && wonSide === koTeam) cur.clean += 1;
      if (o === 'break' && wonSide === koTeam) cur.break += 1;
      if (ex?.kickout?.mark) cur.marks += 1;
      rows.set(`${koTeam}|${key}`, cur);
    }
    return Array.from(rows.values()).sort((a, b) => b.targeted - a.targeted || String(a.label).localeCompare(String(b.label)));
  }, [kickouts, nextStatById]);

  const visibleKickouts = useMemo(() => {
    if (teamMode === 'both') return kickouts;
    return kickouts.filter((s) => {
      const ex = safeParseJSON(s.extra_data || '{}', {});
      return ex?.kickout?.team_side === teamMode || s?.team_side === teamMode;
    });
  }, [kickouts, teamMode]);

  return (
    <div className="space-y-4">
        <ComparisonMetricsCard
          title="Kickout Metrics"
          homeTeam={homeTeam}
          awayTeam={awayTeam}
          teamMode={teamMode}
          rows={[
            {
              label: 'Own Kickout Win %',
              home: `${kpis.home.ownKickoutsWon}/${kpis.home.ownKickoutsTaken} (${formatPct(kpis.home.ownKickoutsTaken ? (kpis.home.ownKickoutsWon / kpis.home.ownKickoutsTaken) * 100 : NaN)})`,
              away: `${kpis.away.ownKickoutsWon}/${kpis.away.ownKickoutsTaken} (${formatPct(kpis.away.ownKickoutsTaken ? (kpis.away.ownKickoutsWon / kpis.away.ownKickoutsTaken) * 100 : NaN)})`,
            },
            {
              label: 'Opposition Kickout Disruption %',
              home: `${kpis.home.oppDisrupted}/${kpis.home.oppKickoutsTaken} (${formatPct(kpis.home.oppKickoutsTaken ? (kpis.home.oppDisrupted / kpis.home.oppKickoutsTaken) * 100 : NaN)})`,
              away: `${kpis.away.oppDisrupted}/${kpis.away.oppKickoutsTaken} (${formatPct(kpis.away.oppKickoutsTaken ? (kpis.away.oppDisrupted / kpis.away.oppKickoutsTaken) * 100 : NaN)})`,
            },
            {
              label: 'Clean Kickout Win %',
              home: `${kpis.home.ownCleanWon}/${kpis.home.ownKickoutsTaken} (${formatPct(kpis.home.ownKickoutsTaken ? (kpis.home.ownCleanWon / kpis.home.ownKickoutsTaken) * 100 : NaN)})`,
              away: `${kpis.away.ownCleanWon}/${kpis.away.ownKickoutsTaken} (${formatPct(kpis.away.ownKickoutsTaken ? (kpis.away.ownCleanWon / kpis.away.ownKickoutsTaken) * 100 : NaN)})`,
            },
            {
              label: 'Break-Ball Recovery %',
              home: `${kpis.breakWonHome}/${kpis.breakAll} (${formatPct(kpis.breakAll ? (kpis.breakWonHome / kpis.breakAll) * 100 : NaN)})`,
              away: `${kpis.breakWonAway}/${kpis.breakAll} (${formatPct(kpis.breakAll ? (kpis.breakWonAway / kpis.breakAll) * 100 : NaN)})`,
            },
            {
              label: 'Restart-to-Shot %',
              home: `${kpis.home.restartToShot}/${kpis.home.restartWins} (${formatPct(kpis.home.restartWins ? (kpis.home.restartToShot / kpis.home.restartWins) * 100 : NaN)})`,
              away: `${kpis.away.restartToShot}/${kpis.away.restartWins} (${formatPct(kpis.away.restartWins ? (kpis.away.restartToShot / kpis.away.restartWins) * 100 : NaN)})`,
            },
            {
              label: 'Restart-to-Score %',
              home: `${kpis.home.restartToScore}/${kpis.home.restartWins} (${formatPct(kpis.home.restartWins ? (kpis.home.restartToScore / kpis.home.restartWins) * 100 : NaN)})`,
              away: `${kpis.away.restartToScore}/${kpis.away.restartWins} (${formatPct(kpis.away.restartWins ? (kpis.away.restartToScore / kpis.away.restartWins) * 100 : NaN)})`,
            },
          ]}
        />

        {visibleKickouts.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-sm text-slate-600 text-center">
              No kickouts available for current filters.
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="font-semibold text-slate-900">Kickout Map</div>
                <PitchViz
                  stats={visibleKickouts}
                  contextStats={stats}
                  homeColor={homeTeam?.color}
                  awayColor={awayTeam?.color}
                  colorBy={teamMode === 'both' ? 'team' : 'outcome'}
                  showColorControls={false}
                  mirrorAwayWhenBoth={teamMode !== 'home'}
                  kickoutOutcomeDots
                  directionLabel="Home ->"
                />
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="font-semibold text-slate-900">Kickout Targets</div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Team</TableHead>
                      <TableHead>Target</TableHead>
                      <TableHead className="text-right">Targeted</TableHead>
                      <TableHead className="text-right">Won</TableHead>
                      <TableHead className="text-right">Win %</TableHead>
                      <TableHead className="text-right">Clean</TableHead>
                      <TableHead className="text-right">Break</TableHead>
                      <TableHead className="text-right">Marks</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {kickoutTargets.filter((r) => teamMode === 'both' || r.team === teamMode).slice(0, 200).map((r, idx) => (
                      <TableRow key={`${r.team}-${r.key}-${idx}`}>
                        <TableCell>{r.team === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home')}</TableCell>
                        <TableCell className="font-medium">{r.label || 'NA'}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.targeted}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.won}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatPct(r.targeted ? (r.won / r.targeted) * 100 : NaN)}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.clean}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.break}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.marks}</TableCell>
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


export default RestartsTab;

