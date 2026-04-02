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
  calcAngleToGoal,
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
  formatMatchClock,
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
  teamRowTint,
  applyNonTeamReportFilters,
} from '../shared';

function SideBreakdownTable({ title, rows, columns }) {
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="font-semibold text-slate-900">{title}</div>
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <TableHead key={column.key} className={column.align === 'right' ? 'text-right' : undefined}>
                  {column.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.key || row.label || row.pressure || row.situation}>
                {columns.map((column) => (
                  <TableCell
                    key={column.key}
                    className={[
                      column.align === 'right' ? 'text-right tabular-nums' : '',
                      column.primary ? 'font-medium' : '',
                    ].join(' ').trim()}
                  >
                    {column.render(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function PressureChartCard({ title, data }) {
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="font-semibold text-slate-900">{title}</div>
        <ChartContainer
          id={`pressure-conv-${title.replace(/\s+/g, '-').toLowerCase()}`}
          className="h-[220px] w-full"
          config={{
            attempts: { label: 'Attempts', color: '#94a3b8' },
          }}
        >
          <BarChart data={data} margin={{ top: 10, right: 12, left: 0, bottom: 6 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="pressure" className="text-xs" />
            <YAxis allowDecimals={false} className="text-xs" />
            <Tooltip
              content={
                <ChartTooltipContent
                  formatter={(value, name, item) => {
                    const row = item?.payload;
                    if (!row) return null;
                    return (
                      <div className="text-xs space-y-1">
                        <div>Attempts: <span className="font-mono">{row.attempts}</span></div>
                        <div>Scores: <span className="font-mono">{row.scores}</span></div>
                        <div>Conversion: <span className="font-mono">{formatPct(row.conv)}</span></div>
                        <div>Pts/Shot: <span className="font-mono">{Number.isFinite(row.pps) ? row.pps.toFixed(2) : 'NA'}</span></div>
                      </div>
                    );
                  }}
                  labelFormatter={(_, payload) => payload?.[0]?.payload?.pressure || 'Pressure'}
                />
              }
            />
            <Bar dataKey="attempts" fill="var(--color-attempts)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

function ScoringTab({ stats, homeTeam, awayTeam, reportFilters, shotType, setShotType, situation, setSituation, pressure, setPressure, outcome, setOutcome, zone, setZone }) {
  const scopedReportFilters = useMemo(() => ({ ...reportFilters, allowedActionTypes: ['shot'] }), [reportFilters]);
  const teamMode = String(reportFilters?.team || 'both');
  const [shotMapMode, setShotMapMode] = useState('all');

  const shots = useMemo(() => {
    const list = Array.isArray(stats) ? stats : [];
    const out = [];
    for (const s of list) {
      if (!s || s.stat_type !== 'shot') continue;
      const extra = safeParseJSON(s.extra_data || '{}', {});
      const sh = extra?.shot || {};

      const x = Number(s.x_position);
      const y = Number(s.y_position);
      const o = String(sh.outcome || '');
      const st = String(sh.type || sh.shot_type || sh.shotType || '');
      const stNorm = st === '2 point' ? '2_point' : st;
      const sit = String(sh.situation || '');
      const pr = String(sh.pressure || '');

      const dist = calcDistanceToGoal(x, y);
      const z = shotZoneFromDistance(dist);

      const playerSel = sh.player && typeof sh.player === 'object' ? sh.player : null;
      const playerLabel = (() => {
        if (playerSel?.kind === 'player') {
          const n = playerSel.number ? `#${playerSel.number}` : '';
          const name = playerSel.name ? String(playerSel.name) : '';
          return `${n} ${name}`.trim() || 'Player';
        }
        if (s.player_number) return `#${s.player_number}`;
        return 'NA';
      })();

      const matchTime = getMatchTimeS(s, scopedReportFilters?.match, scopedReportFilters?.imputedTimeById);
      const timeLabel = Number.isFinite(matchTime) ? formatMatchClock(matchTime, scopedReportFilters?.match, s.half) : 'NA';

      const possessionLabel = (s.possession_team_side && Number.isFinite(Number(s.possession_id)))
        ? `${toTitleCase(s.possession_team_side)} #${Number(s.possession_id)}`
        : '';

      out.push({
        id: s.id,
        raw: s,
        extra,
        team_side: s.team_side === 'away' ? 'away' : 'home',
        half: s.half,
        possession_id: s.possession_id,
        possessionLabel,
        x,
        y,
        shotType: stNorm || 'point',
        situation: sit,
        method: String(sh.method || ''),
        pressure: pr,
        outcome: o,
        distance: dist,
        angle: calcAngleToGoal(x, y),
        zone: z,
        side: shotSideFromY(y),
        isScore: shotOutcomeGroup(o) === 'score',
        points: shotPointsForOutcome(o),
        isFromPlay: sit === 'play',
        isPlacedBall: sit && sit !== 'play',
        playerLabel,
        playerId: playerSel?.id || null,
        timeLabel,
      });
    }
    return out;
  }, [stats]);

  const filteredShots = useMemo(() => {
    return shots.filter((s) => {
      if (shotType.length && !shotType.includes(s.shotType)) return false;
      if (situation.length && !situation.includes(s.situation)) return false;
      if (pressure.length && !pressure.includes(s.pressure)) return false;
      if (outcome.length && !outcome.includes(s.outcome)) return false;
      if (zone.length && !zone.includes(s.zone)) return false;
      return true;
    });
  }, [shots, shotType, situation, pressure, outcome, zone]);

  const kpis = useMemo(() => {
    const calc = (side) => {
      const sh = filteredShots.filter((s) => s.team_side === side);
      const shotsN = sh.length;
      const scoresN = sh.filter((s) => s.isScore).length;
      const totalPts = sh.reduce((a, s) => a + (s.points || 0), 0);
      const conv = shotsN ? (scoresN / shotsN) * 100 : NaN;
      const pps = shotsN ? totalPts / shotsN : NaN;
      const dists = sh.map((s) => s.distance).filter(Number.isFinite);
      const avgDist = dists.length ? dists.reduce((a, d) => a + d, 0) / dists.length : NaN;
      const play = sh.filter((s) => s.isFromPlay);
      const playScores = play.filter((s) => s.isScore).length;
      const playConv = play.length ? (playScores / play.length) * 100 : NaN;
      const fromPlayPct = shotsN ? (play.length / shotsN) * 100 : NaN;
      const placed = sh.filter((s) => s.isPlacedBall);
      const placedScores = placed.filter((s) => s.isScore).length;
      const placedConv = placed.length ? (placedScores / placed.length) * 100 : NaN;
      const lowPressure = sh.filter((s) => String(s.pressure) === 'low').length;
      const typeBreakdown = ['point', '2_point', 'goal'].reduce((acc, type) => {
        const attempts = sh.filter((s) => s.shotType === type).length;
        const scored = sh.filter((s) => s.shotType === type && s.outcome === type).length;
        acc[type] = { attempts, scored };
        return acc;
      }, {});
      return {
        shotsN,
        scoresN,
        conv,
        pps,
        avgDist,
        playConv,
        fromPlayPct,
        placedConv,
        lowPressurePct: shotsN ? (lowPressure / shotsN) * 100 : NaN,
        typeBreakdown,
      };
    };
    return { home: calc('home'), away: calc('away') };
  }, [filteredShots]);

  const shotTypeSummary = useMemo(() => {
    const build = (teamSide = null) => {
      const source = teamSide ? filteredShots.filter((s) => s.team_side === teamSide) : filteredShots;
      const order = ['point', '2_point', 'goal'];
      const label = { point: '1 Point', '2_point': '2 Point', goal: 'Goal' };
      const m = new Map();
      for (const s of source) {
        const t = String(s.shotType || 'point');
        const cur = m.get(t) || { type: t, attempts: 0, scores: 0, points: 0 };
        cur.attempts += 1;
        if (s.isScore) cur.scores += 1;
        cur.points += s.points || 0;
        m.set(t, cur);
      }
      const rows = Array.from(m.values()).map((r) => ({
        ...r,
        label: label[r.type] || toTitleCase(r.type),
        conv: r.attempts ? (r.scores / r.attempts) * 100 : NaN,
        pps: r.attempts ? r.points / r.attempts : NaN,
      }));
      rows.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
      return rows;
    };
    return {
      both: build(null),
      home: build('home'),
      away: build('away'),
    };
  }, [filteredShots]);

  const pressureSummary = useMemo(() => {
    const build = (teamSide = null) => {
      const source = teamSide ? filteredShots.filter((s) => s.team_side === teamSide) : filteredShots;
      const levels = ['low', 'medium', 'high'];
      return levels.map((p) => {
        const list = source.filter((s) => String(s.pressure) === p);
        const attempts = list.length;
        const scores = list.filter((s) => s.isScore).length;
        const points = list.reduce((a, s) => a + (s.points || 0), 0);
        return {
          pressure: toTitleCase(p),
          attempts,
          scores,
          conv: attempts ? (scores / attempts) * 100 : NaN,
          pps: attempts ? points / attempts : NaN,
        };
      });
    };
    return {
      both: build(null),
      home: build('home'),
      away: build('away'),
    };
  }, [filteredShots]);

  const situationSummary = useMemo(() => {
    const build = (teamSide = null) => {
      const source = teamSide ? filteredShots.filter((s) => s.team_side === teamSide) : filteredShots;
      const cats = ['play', 'free_ground', 'free_hands', '45', 'penalty', 'mark'];
      return cats.map((c) => {
        const list = source.filter((s) => String(s.situation) === c);
        const attempts = list.length;
        const scores = list.filter((s) => s.isScore).length;
        const points = list.reduce((a, s) => a + (s.points || 0), 0);
        return {
          situation: toTitleCase(c),
          attempts,
          conv: attempts ? (scores / attempts) * 100 : NaN,
          pps: attempts ? points / attempts : NaN,
        };
      });
    };
    return {
      both: build(null),
      home: build('home'),
      away: build('away'),
    };
  }, [filteredShots]);

  const playerSummary = useMemo(() => {
    const rows = new Map();
    for (const s of filteredShots) {
      if (teamMode !== 'both' && s.team_side !== teamMode) continue;
      const key = s.playerId || s.playerLabel || 'NA';
      const cur = rows.get(key) || {
        key,
        player: s.playerLabel || 'NA',
        team: s.team_side,
        shots: 0,
        scores: 0,
        points: 0,
        distSum: 0,
        distN: 0,
        pointMade: 0,
        pointAtt: 0,
        twoMade: 0,
        twoAtt: 0,
        goalMade: 0,
        goalAtt: 0,
        playShots: 0,
        placedShots: 0,
      };
      cur.shots += 1;
      if (s.isScore) cur.scores += 1;
      cur.points += s.points || 0;
      if (Number.isFinite(s.distance)) { cur.distSum += s.distance; cur.distN += 1; }
      if (s.shotType === 'point') { cur.pointAtt += 1; if (s.outcome === 'point') cur.pointMade += 1; }
      if (s.shotType === '2_point') { cur.twoAtt += 1; if (s.outcome === '2_point') cur.twoMade += 1; }
      if (s.shotType === 'goal') { cur.goalAtt += 1; if (s.outcome === 'goal') cur.goalMade += 1; }
      if (s.isFromPlay) cur.playShots += 1;
      if (s.isPlacedBall) cur.placedShots += 1;
      rows.set(key, cur);
    }
    const out = Array.from(rows.values()).map((r) => ({
      ...r,
      conv: r.shots ? (r.scores / r.shots) * 100 : NaN,
      pps: r.shots ? r.points / r.shots : NaN,
      avgDist: r.distN ? r.distSum / r.distN : NaN,
    }));
    out.sort((a, b) => b.points - a.points);
    return out;
  }, [filteredShots, teamMode]);

  return (
    <div className="space-y-4">
        <ComparisonMetricsCard
          title="Scoring Metrics"
          homeTeam={homeTeam}
          awayTeam={awayTeam}
          teamMode={teamMode}
          rows={[
            {
              label: 'Shot Scoring',
              home: `${kpis.home.scoresN}/${kpis.home.shotsN} (${formatPct(kpis.home.conv)})`,
              away: `${kpis.away.scoresN}/${kpis.away.shotsN} (${formatPct(kpis.away.conv)})`,
            },
            { label: 'Points Per Shot', home: Number.isFinite(kpis.home.pps) ? kpis.home.pps.toFixed(2) : 'NA', away: Number.isFinite(kpis.away.pps) ? kpis.away.pps.toFixed(2) : 'NA' },
            { label: 'Average Shot Distance', home: Number.isFinite(kpis.home.avgDist) ? kpis.home.avgDist.toFixed(1) : 'NA', away: Number.isFinite(kpis.away.avgDist) ? kpis.away.avgDist.toFixed(1) : 'NA' },
            { label: 'Play-Shot Conversion %', home: formatPct(kpis.home.playConv), away: formatPct(kpis.away.playConv) },
            { label: '% Shots From Play', home: formatPct(kpis.home.fromPlayPct), away: formatPct(kpis.away.fromPlayPct) },
            { label: 'Placed-Ball Conversion %', home: formatPct(kpis.home.placedConv), away: formatPct(kpis.away.placedConv) },
            { label: '1 Point Scores', home: `${kpis.home.typeBreakdown.point.scored}/${kpis.home.typeBreakdown.point.attempts} (${formatPct(kpis.home.typeBreakdown.point.attempts ? (kpis.home.typeBreakdown.point.scored / kpis.home.typeBreakdown.point.attempts) * 100 : NaN)})`, away: `${kpis.away.typeBreakdown.point.scored}/${kpis.away.typeBreakdown.point.attempts} (${formatPct(kpis.away.typeBreakdown.point.attempts ? (kpis.away.typeBreakdown.point.scored / kpis.away.typeBreakdown.point.attempts) * 100 : NaN)})` },
            { label: '2 Point Scores', home: `${kpis.home.typeBreakdown['2_point'].scored}/${kpis.home.typeBreakdown['2_point'].attempts} (${formatPct(kpis.home.typeBreakdown['2_point'].attempts ? (kpis.home.typeBreakdown['2_point'].scored / kpis.home.typeBreakdown['2_point'].attempts) * 100 : NaN)})`, away: `${kpis.away.typeBreakdown['2_point'].scored}/${kpis.away.typeBreakdown['2_point'].attempts} (${formatPct(kpis.away.typeBreakdown['2_point'].attempts ? (kpis.away.typeBreakdown['2_point'].scored / kpis.away.typeBreakdown['2_point'].attempts) * 100 : NaN)})` },
            { label: 'Goal Scores', home: `${kpis.home.typeBreakdown.goal.scored}/${kpis.home.typeBreakdown.goal.attempts} (${formatPct(kpis.home.typeBreakdown.goal.attempts ? (kpis.home.typeBreakdown.goal.scored / kpis.home.typeBreakdown.goal.attempts) * 100 : NaN)})`, away: `${kpis.away.typeBreakdown.goal.scored}/${kpis.away.typeBreakdown.goal.attempts} (${formatPct(kpis.away.typeBreakdown.goal.attempts ? (kpis.away.typeBreakdown.goal.scored / kpis.away.typeBreakdown.goal.attempts) * 100 : NaN)})` },
            { label: '% Low Pressure Shots', home: formatPct(kpis.home.lowPressurePct), away: formatPct(kpis.away.lowPressurePct) },
          ]}
        />

        {filteredShots.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-sm text-slate-600 text-center">
              No shots available for current filters.
            </CardContent>
          </Card>
        ) : (
          <>
            <ShotMap shots={filteredShots} mode={shotMapMode} setMode={setShotMapMode} teamMode={teamMode} homeColor={homeTeam?.color} awayColor={awayTeam?.color} />

            <div className="grid lg:grid-cols-2 gap-4">
              {teamMode === 'both' ? (
                <>
                  <SideBreakdownTable
                    title={`${homeTeam?.name || 'Home'} Shot Type Breakdown`}
                    rows={shotTypeSummary.home}
                    columns={[
                      { key: 'label', label: 'Type', primary: true, render: (r) => r.label },
                      { key: 'attempts', label: 'Attempts', align: 'right', render: (r) => r.attempts },
                      { key: 'scores', label: 'Scores', align: 'right', render: (r) => r.scores },
                      { key: 'conv', label: 'Conv %', align: 'right', render: (r) => formatPct(r.conv) },
                      { key: 'pps', label: 'Pts/Shot', align: 'right', render: (r) => Number.isFinite(r.pps) ? r.pps.toFixed(2) : 'NA' },
                    ]}
                  />
                  <SideBreakdownTable
                    title={`${awayTeam?.name || 'Away'} Shot Type Breakdown`}
                    rows={shotTypeSummary.away}
                    columns={[
                      { key: 'label', label: 'Type', primary: true, render: (r) => r.label },
                      { key: 'attempts', label: 'Attempts', align: 'right', render: (r) => r.attempts },
                      { key: 'scores', label: 'Scores', align: 'right', render: (r) => r.scores },
                      { key: 'conv', label: 'Conv %', align: 'right', render: (r) => formatPct(r.conv) },
                      { key: 'pps', label: 'Pts/Shot', align: 'right', render: (r) => Number.isFinite(r.pps) ? r.pps.toFixed(2) : 'NA' },
                    ]}
                  />
                </>
              ) : (
                <SideBreakdownTable
                  title="Shot Type Breakdown"
                  rows={shotTypeSummary.both}
                  columns={[
                    { key: 'label', label: 'Type', primary: true, render: (r) => r.label },
                    { key: 'attempts', label: 'Attempts', align: 'right', render: (r) => r.attempts },
                    { key: 'scores', label: 'Scores', align: 'right', render: (r) => r.scores },
                    { key: 'conv', label: 'Conv %', align: 'right', render: (r) => formatPct(r.conv) },
                    { key: 'pps', label: 'Pts/Shot', align: 'right', render: (r) => Number.isFinite(r.pps) ? r.pps.toFixed(2) : 'NA' },
                  ]}
                />
              )}

              {teamMode === 'both' ? (
                <>
                  <PressureChartCard title={`${homeTeam?.name || 'Home'} Pressure vs Conversion`} data={pressureSummary.home} />
                  <PressureChartCard title={`${awayTeam?.name || 'Away'} Pressure vs Conversion`} data={pressureSummary.away} />
                </>
              ) : (
                <PressureChartCard title="Pressure vs Conversion" data={pressureSummary.both} />
              )}
            </div>

            <div className="grid lg:grid-cols-2 gap-4">
              {teamMode === 'both' ? (
                <>
                  <SideBreakdownTable
                    title={`${homeTeam?.name || 'Home'} Shot Situation Breakdown`}
                    rows={situationSummary.home}
                    columns={[
                      { key: 'situation', label: 'Situation', primary: true, render: (r) => r.situation },
                      { key: 'attempts', label: 'Attempts', align: 'right', render: (r) => r.attempts },
                      { key: 'conv', label: 'Conv %', align: 'right', render: (r) => formatPct(r.conv) },
                      { key: 'pps', label: 'Pts/Shot', align: 'right', render: (r) => Number.isFinite(r.pps) ? r.pps.toFixed(2) : 'NA' },
                    ]}
                  />
                  <SideBreakdownTable
                    title={`${awayTeam?.name || 'Away'} Shot Situation Breakdown`}
                    rows={situationSummary.away}
                    columns={[
                      { key: 'situation', label: 'Situation', primary: true, render: (r) => r.situation },
                      { key: 'attempts', label: 'Attempts', align: 'right', render: (r) => r.attempts },
                      { key: 'conv', label: 'Conv %', align: 'right', render: (r) => formatPct(r.conv) },
                      { key: 'pps', label: 'Pts/Shot', align: 'right', render: (r) => Number.isFinite(r.pps) ? r.pps.toFixed(2) : 'NA' },
                    ]}
                  />
                </>
              ) : (
                <SideBreakdownTable
                  title="Shot Situation Breakdown"
                  rows={situationSummary.both}
                  columns={[
                    { key: 'situation', label: 'Situation', primary: true, render: (r) => r.situation },
                    { key: 'attempts', label: 'Attempts', align: 'right', render: (r) => r.attempts },
                    { key: 'conv', label: 'Conv %', align: 'right', render: (r) => formatPct(r.conv) },
                    { key: 'pps', label: 'Pts/Shot', align: 'right', render: (r) => Number.isFinite(r.pps) ? r.pps.toFixed(2) : 'NA' },
                  ]}
                />
              )}
            </div>

            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="font-semibold text-slate-900">Player Shooting</div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Player</TableHead>
                      <TableHead className="text-right">Shots</TableHead>
                      <TableHead className="text-right">Scores</TableHead>
                      <TableHead className="text-right">Points</TableHead>
                      <TableHead className="text-right">Pts/Shot</TableHead>
                      <TableHead className="text-right">Avg Dist</TableHead>
                      <TableHead className="text-right">1 Att</TableHead>
                      <TableHead className="text-right">1 Scored</TableHead>
                      <TableHead className="text-right">2 Att</TableHead>
                      <TableHead className="text-right">2 Scored</TableHead>
                      <TableHead className="text-right">Goal Att</TableHead>
                      <TableHead className="text-right">Goal Scored</TableHead>
                      <TableHead className="text-right">Play Shots</TableHead>
                      <TableHead className="text-right">Placed Shots</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {playerSummary.map((r) => (
                      <TableRow key={r.key} style={teamRowTint(r.team, homeTeam?.color, awayTeam?.color, 0.07)}>
                        <TableCell className="font-medium">{r.player}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.shots}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.scores}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.points}</TableCell>
                        <TableCell className="text-right tabular-nums">{Number.isFinite(r.pps) ? r.pps.toFixed(2) : 'NA'}</TableCell>
                        <TableCell className="text-right tabular-nums">{Number.isFinite(r.avgDist) ? r.avgDist.toFixed(1) : 'NA'}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.pointAtt}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.pointMade}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.twoAtt}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.twoMade}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.goalAtt}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.goalMade}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.playShots}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.placedShots}</TableCell>
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


export default ScoringTab;

