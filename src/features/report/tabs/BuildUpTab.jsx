import React, { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ChartContainer, ChartTooltipContent } from '@/components/ui/chart';
import { BarChart, Bar, CartesianGrid, Legend, LineChart, Line, PieChart, Pie, Cell, Tooltip, ReferenceLine, XAxis, YAxis } from 'recharts';
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
  PitchViz,
  AttackChannelPitch,
  PassNetwork,
  ShotMap,
  shotSideFromY,
  shotZoneFromDistance,
  applyNonTeamReportFilters,
} from '../shared';

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
    const shotAssistCredits = buildShotAssistCredits(filtered);
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
      const channels = { Left: 0, Middle: 0, Right: 0 };
      const startZones = { 'Defensive Third': 0, 'Middle Third': 0, 'Attacking Third': 0 };
      for (const [key, evs] of possessionGroups.entries()) {
        if (!String(key).startsWith(side + '-')) continue;
        const acting = evs.filter((e) => e && e.team_side === side);
        if (!acting.length) continue;
        const zone = getPossessionStartZone(acting);
        if (startZones[zone] != null) startZones[zone] += 1;
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
        passPct: pass.length ? (passComp / pass.length) * 100 : NaN,
        carries: carry.length,
        carryPct: carry.length ? (carryComp / carry.length) * 100 : NaN,
        progPass,
        progPassPct: progPass ? (progPassComp / progPass) * 100 : NaN,
        progCarry,
        progCarryPct: progCarry ? (progCarryComp / progCarry) * 100 : NaN,
        scoringEntries,
        passesIntoScoringZone,
        shotAssists,
        shotsCreated: shotAssists,
        fieldTiltEvents: sideEvents.filter((s) => getFieldTiltContribution(s)).length,
        turnovers,
        buildUpSpeed: buildUpSamples.length ? buildUpSamples.reduce((a, b) => a + b, 0) / buildUpSamples.length : NaN,
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

  const display = (selector) => {
    if (teamMode === 'home') return selector(kpis.home);
    if (teamMode === 'away') return selector(kpis.away);
    return `${selector(kpis.home)} / ${selector(kpis.away)}`;
  };

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

  return (
    <div className="space-y-4">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: 'Passes Attempted', value: display((k) => String(k.passes)) },
            { label: 'Pass Completion %', value: display((k) => formatPct(k.passPct)) },
            { label: 'Carries', value: display((k) => String(k.carries)) },
            { label: 'Carry Completion %', value: display((k) => formatPct(k.carryPct)) },
            { label: 'Progressive Passes Attempted', value: display((k) => String(k.progPass)) },
            { label: 'Progressive Pass Success %', value: display((k) => formatPct(k.progPassPct)) },
            { label: 'Progressive Carries Attempted', value: display((k) => String(k.progCarry)) },
            { label: 'Progressive Carry Success %', value: display((k) => formatPct(k.progCarryPct)) },
            { label: 'Scoring Zone Entries', value: display((k) => String(k.scoringEntries)) },
            { label: 'Passes Into Scoring Zone', value: display((k) => String(k.passesIntoScoringZone)) },
            { label: 'Shot Assists', value: display((k) => String(k.shotAssists)) },
            { label: 'Shots Created', value: display((k) => String(k.shotsCreated)) },
            { label: 'Field Tilt', value: teamMode === 'home' ? formatPct(fieldTiltPct.home) : teamMode === 'away' ? formatPct(fieldTiltPct.away) : `${formatPct(fieldTiltPct.home)} / ${formatPct(fieldTiltPct.away)}` },
            { label: 'Build-Up Turnovers', value: display((k) => String(k.turnovers)) },
            { label: 'Build-Up Speed', value: display((k) => Number.isFinite(k.buildUpSpeed) ? `${k.buildUpSpeed.toFixed(1)}s` : 'NA') },
          ].map((k) => (
            <Card key={k.label}>
              <CardContent className="p-3">
                <div className="text-[11px] text-slate-600">{k.label}</div>
                <div className="text-lg font-semibold text-slate-900 tabular-nums">{k.value}</div>
              </CardContent>
            </Card>
          ))}
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
                  </div>
                  <PassNetwork
                    passes={filtered.filter((s) => s.stat_type === 'pass')}
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

