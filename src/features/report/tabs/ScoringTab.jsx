import React, { useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ChartContainer } from '@/components/ui/chart';
import { BarChart, Bar, CartesianGrid, Legend, LineChart, Line, PieChart, Pie, Cell, Tooltip, ReferenceLine, XAxis, YAxis, LabelList } from 'recharts';
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
  isBroughtBackAdvantageStat,
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
  teamRowTint,
  applyNonTeamReportFilters,
} from '../shared';

function SideBreakdownTable({ title, rows, columns }) {
  const [sortState, setSortState] = useState({ key: columns?.[0]?.key || '', dir: 'asc' });
  const sortedRows = useMemo(() => sortRows(rows, sortState, columns, 'key'), [rows, sortState, columns]);
  const toggleSort = (key) => setSortState((current) => current.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="font-semibold text-slate-900">{title}</div>
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <SortableTableHead
                  key={column.key}
                  column={column}
                  sortState={sortState}
                  onToggle={toggleSort}
                  className={column.align === 'right' ? 'text-right' : undefined}
                />
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedRows.map((row) => (
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

function TwoTeamBreakdownTable({ title, homeLabel, awayLabel, homeRows, awayRows, columns }) {
  const [sortState, setSortState] = useState({ key: columns?.[0]?.key || '', dir: 'asc' });
  const toggleSort = (key) => setSortState((current) => current.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });
  const sortedHomeRows = useMemo(() => sortRows(homeRows, sortState, columns, 'key'), [homeRows, sortState, columns]);
  const sortedAwayRows = useMemo(() => sortRows(awayRows, sortState, columns, 'key'), [awayRows, sortState, columns]);
  const renderSection = (label, rows) => (
    <>
      <TableRow>
        <TableCell colSpan={columns.length} className="bg-slate-50 px-4 py-2">
          <div className="font-semibold text-slate-900">{label}</div>
        </TableCell>
      </TableRow>
      {rows.map((row) => (
        <TableRow key={`${label}-${row.key || row.label || row.pressure || row.situation}`}>
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
    </>
  );

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="font-semibold text-slate-900">{title}</div>
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <SortableTableHead
                  key={column.key}
                  column={column}
                  sortState={sortState}
                  onToggle={toggleSort}
                  className={column.align === 'right' ? 'text-right' : undefined}
                />
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {renderSection(homeLabel, sortedHomeRows)}
            {renderSection(awayLabel, sortedAwayRows)}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function CategoryComparisonTable({ title, categories, categoryKey, categoryLabel, homeLabel, awayLabel, homeRows, awayRows, columns, sortable = true }) {
  const homeByKey = new Map((homeRows || []).map((row) => [row[categoryKey], row]));
  const awayByKey = new Map((awayRows || []).map((row) => [row[categoryKey], row]));
  const sortColumns = useMemo(() => ([
    { key: '__category', label: categoryLabel, sortValue: (row) => row?.label || '' },
    ...columns.map((column) => ({
      ...column,
      sortValue: (row) => (column.sortValue ? column.sortValue(row?.homeRow) : (row?.homeRow?.[column.key] ?? '')),
    })),
  ]), [columns, categoryLabel]);
  const [sortState, setSortState] = useState({ key: '__category', dir: 'asc' });
  const toggleSort = (key) => setSortState((current) => current.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });
  const categoryRows = useMemo(() => categories.map((category) => ({
    ...category,
    key: category.key,
    homeRow: homeByKey.get(category.key) || category.homeFallback,
    awayRow: awayByKey.get(category.key) || category.awayFallback,
  })), [categories, homeByKey, awayByKey]);
  const sortedCategories = useMemo(() => (sortable ? sortRows(categoryRows, sortState, sortColumns, 'key') : categoryRows), [categoryRows, sortState, sortColumns, sortable]);

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="font-semibold text-slate-900">{title}</div>
        <Table>
          <TableHeader>
            <TableRow>
              {sortable ? (
                <SortableTableHead column={{ key: '__category', label: categoryLabel }} sortState={sortState} onToggle={toggleSort} />
              ) : (
                <TableHead>{categoryLabel}</TableHead>
              )}
              <TableHead>Team</TableHead>
              {columns.map((column) => (
                sortable ? (
                  <SortableTableHead
                    key={column.key}
                    column={column}
                    sortState={sortState}
                    onToggle={toggleSort}
                    className={column.align === 'right' ? 'text-right' : undefined}
                  />
                ) : (
                  <TableHead key={column.key} className={column.align === 'right' ? 'text-right' : undefined}>{column.label}</TableHead>
                )
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedCategories.flatMap((category, idx) => {
              const homeRow = category.homeRow;
              const awayRow = category.awayRow;
              return [
                (
                  <TableRow key={`${category.key}-home`} className={idx > 0 ? 'border-t-2 border-slate-200' : ''}>
                    <TableCell className="font-medium" rowSpan={2}>{category.label}</TableCell>
                    <TableCell className="font-medium">{homeLabel}</TableCell>
                    {columns.map((column) => (
                      <TableCell key={`${category.key}-home-${column.key}`} className={column.align === 'right' ? 'text-right tabular-nums' : ''}>
                        {column.render(homeRow)}
                      </TableCell>
                    ))}
                  </TableRow>
                ),
                (
                  <TableRow key={`${category.key}-away`}>
                    <TableCell className="font-medium">{awayLabel}</TableCell>
                    {columns.map((column) => (
                      <TableCell key={`${category.key}-away-${column.key}`} className={column.align === 'right' ? 'text-right tabular-nums' : ''}>
                        {column.render(awayRow)}
                      </TableCell>
                    ))}
                  </TableRow>
                ),
              ];
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function PressureConversionChart({ title, data, homeColor, awayColor, teamMode }) {
  const homeFill = homeColor || '#f97316';
  const awayFill = awayColor || '#7f1d3a';
  const faded = (hex, alpha) => {
    if (!String(hex || '').startsWith('#')) return hex;
    const raw = String(hex).slice(1);
    const normalized = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
    const int = Number.parseInt(normalized, 16);
    if (!Number.isFinite(int)) return hex;
    const r = (int >> 16) & 255;
    const g = (int >> 8) & 255;
    const b = int & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="font-semibold text-slate-900">{title}</div>
        <ChartContainer
          id={`pressure-conv-${title.replace(/\s+/g, '-').toLowerCase()}`}
          className="h-[240px] w-full"
          config={{
            home_scored_pct: { label: 'Home Scored %', color: homeFill },
            home_missed_pct: { label: 'Home No Score %', color: faded(homeFill, 0.28) },
            away_scored_pct: { label: 'Away Scored %', color: awayFill },
            away_missed_pct: { label: 'Away No Score %', color: faded(awayFill, 0.28) },
            scored_pct: { label: 'Scored %', color: teamMode === 'away' ? awayFill : homeFill },
            missed_pct: { label: 'No Score %', color: faded(teamMode === 'away' ? awayFill : homeFill, 0.28) },
          }}
        >
          <BarChart data={data} margin={{ top: 42, right: 12, left: 0, bottom: 6 }} barGap={10} barCategoryGap="28%">
            <CartesianGrid vertical={false} />
            <XAxis dataKey="pressure" className="text-xs" />
            <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} className="text-xs" />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0]?.payload;
                if (!row) return null;
                return (
                  <div className="rounded-md border bg-white px-3 py-2 text-xs shadow-sm">
                    <div className="mb-2 font-semibold text-slate-900">{label || row.pressure || 'Pressure'}</div>
                    {teamMode === 'both' ? (
                      <div className="space-y-2">
                        <div>
                          <div>{row.home_label || 'Home'}: <span className="font-mono">{row.home_scores}/{row.home_attempts}</span></div>
                          <div>Conversion: <span className="font-mono">{formatPct(row.home_conv)}</span></div>
                          <div>Pts/Shot: <span className="font-mono">{Number.isFinite(row.home_pps) ? row.home_pps.toFixed(2) : 'NA'}</span></div>
                        </div>
                        <div>
                          <div>{row.away_label || 'Away'}: <span className="font-mono">{row.away_scores}/{row.away_attempts}</span></div>
                          <div>Conversion: <span className="font-mono">{formatPct(row.away_conv)}</span></div>
                          <div>Pts/Shot: <span className="font-mono">{Number.isFinite(row.away_pps) ? row.away_pps.toFixed(2) : 'NA'}</span></div>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <div>Attempts: <span className="font-mono">{row.attempts}</span></div>
                        <div>Scores: <span className="font-mono">{row.scores}</span></div>
                        <div>Conversion: <span className="font-mono">{formatPct(row.conv)}</span></div>
                        <div>Pts/Shot: <span className="font-mono">{Number.isFinite(row.pps) ? row.pps.toFixed(2) : 'NA'}</span></div>
                      </div>
                    )}
                  </div>
                );
              }}
            />
            {teamMode === 'both' ? (
              <>
                <Bar dataKey="home_scored_pct" stackId="home" name="Home Scored %" fill="var(--color-home_scored_pct)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="home_missed_pct" stackId="home" name="Home No Score %" fill="var(--color-home_missed_pct)" radius={[0, 0, 4, 4]}>
                  <LabelList dataKey="home_attempts" position="top" className="fill-slate-700 text-[11px]" />
                </Bar>
                <Bar dataKey="away_scored_pct" stackId="away" name="Away Scored %" fill="var(--color-away_scored_pct)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="away_missed_pct" stackId="away" name="Away No Score %" fill="var(--color-away_missed_pct)" radius={[0, 0, 4, 4]}>
                  <LabelList dataKey="away_attempts" position="top" className="fill-slate-700 text-[11px]" />
                </Bar>
              </>
            ) : (
              <>
                <Bar dataKey="scored_pct" stackId="single" name="Scored %" fill="var(--color-scored_pct)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="missed_pct" stackId="single" name="No Score %" fill="var(--color-missed_pct)" radius={[0, 0, 4, 4]}>
                  <LabelList dataKey="attempts" position="top" className="fill-slate-700 text-[11px]" />
                </Bar>
              </>
            )}
            <Legend />
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

function ScoringTab({ stats, homeTeam, awayTeam, reportFilters, shotType, setShotType, situation, setSituation, pressure, setPressure, outcome, setOutcome, zone, setZone, onOpenVideoAt }) {
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
        broughtBackAdv: !!sh.brought_back_adv || isBroughtBackAdvantageStat(s),
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
      if (s.broughtBackAdv) return false;
      if (shotType.length && !shotType.includes(s.shotType)) return false;
      if (situation.length && !situation.includes(s.situation)) return false;
      if (pressure.length && !pressure.includes(s.pressure)) return false;
      if (outcome.length && !outcome.includes(s.outcome)) return false;
      if (zone.length && !zone.includes(s.zone)) return false;
      return true;
    });
  }, [shots, shotType, situation, pressure, outcome, zone]);

  const mapShots = useMemo(() => {
    return shots.filter((s) => {
      if (shotType.length && !shotType.includes(s.shotType)) return false;
      if (situation.length && !situation.includes(s.situation)) return false;
      if (pressure.length && !pressure.includes(s.pressure)) return false;
      if (!s.broughtBackAdv && outcome.length && !outcome.includes(s.outcome)) return false;
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
      const shortN = sh.filter((s) => String(s.outcome) === 'short').length;
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
        shortN,
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
      const m = new Map(order.map((type) => [type, { type, attempts: 0, scores: 0, points: 0 }]));
      for (const s of source) {
        const t = String(s.shotType || 'point');
        const cur = m.get(t) || { type: t, attempts: 0, scores: 0, points: 0 };
        cur.attempts += 1;
        if (s.outcome === t) cur.scores += 1;
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
          scored_pct: attempts ? (scores / attempts) * 100 : 0,
          missed_pct: attempts ? ((attempts - scores) / attempts) * 100 : 0,
          pps: attempts ? points / attempts : NaN,
        };
      });
    };
    const home = build('home');
    const away = build('away');
    const both = ['low', 'medium', 'high'].map((level, idx) => ({
      pressure: toTitleCase(level),
      home_attempts: home[idx]?.attempts || 0,
      home_scores: home[idx]?.scores || 0,
      home_conv: home[idx]?.conv,
      home_scored_pct: home[idx]?.scored_pct || 0,
      home_missed_pct: home[idx]?.missed_pct || 0,
      home_pps: home[idx]?.pps,
      away_attempts: away[idx]?.attempts || 0,
      away_scores: away[idx]?.scores || 0,
      away_conv: away[idx]?.conv,
      away_scored_pct: away[idx]?.scored_pct || 0,
      away_missed_pct: away[idx]?.missed_pct || 0,
      away_pps: away[idx]?.pps,
      home_label: homeTeam?.name || 'Home',
      away_label: awayTeam?.name || 'Away',
    }));
    return { both, home, away };
  }, [filteredShots, homeTeam?.name, awayTeam?.name]);

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

  const shotTypeCategories = useMemo(() => ([
    { key: 'point', label: '1 Point', homeFallback: { type: 'point', label: '1 Point', attempts: 0, scores: 0, conv: NaN, pps: NaN }, awayFallback: { type: 'point', label: '1 Point', attempts: 0, scores: 0, conv: NaN, pps: NaN } },
    { key: '2_point', label: '2 Point', homeFallback: { type: '2_point', label: '2 Point', attempts: 0, scores: 0, conv: NaN, pps: NaN }, awayFallback: { type: '2_point', label: '2 Point', attempts: 0, scores: 0, conv: NaN, pps: NaN } },
    { key: 'goal', label: 'Goal', homeFallback: { type: 'goal', label: 'Goal', attempts: 0, scores: 0, conv: NaN, pps: NaN }, awayFallback: { type: 'goal', label: 'Goal', attempts: 0, scores: 0, conv: NaN, pps: NaN } },
  ]), []);

  const situationCategories = useMemo(() => ([
    { key: 'Play', label: 'Play', homeFallback: { situation: 'Play', attempts: 0, conv: NaN, pps: NaN }, awayFallback: { situation: 'Play', attempts: 0, conv: NaN, pps: NaN } },
    { key: 'Free Ground', label: 'Free Ground', homeFallback: { situation: 'Free Ground', attempts: 0, conv: NaN, pps: NaN }, awayFallback: { situation: 'Free Ground', attempts: 0, conv: NaN, pps: NaN } },
    { key: 'Free Hands', label: 'Free Hands', homeFallback: { situation: 'Free Hands', attempts: 0, conv: NaN, pps: NaN }, awayFallback: { situation: 'Free Hands', attempts: 0, conv: NaN, pps: NaN } },
    { key: '45', label: '45', homeFallback: { situation: '45', attempts: 0, conv: NaN, pps: NaN }, awayFallback: { situation: '45', attempts: 0, conv: NaN, pps: NaN } },
    { key: 'Penalty', label: 'Penalty', homeFallback: { situation: 'Penalty', attempts: 0, conv: NaN, pps: NaN }, awayFallback: { situation: 'Penalty', attempts: 0, conv: NaN, pps: NaN } },
    { key: 'Mark', label: 'Mark', homeFallback: { situation: 'Mark', attempts: 0, conv: NaN, pps: NaN }, awayFallback: { situation: 'Mark', attempts: 0, conv: NaN, pps: NaN } },
  ]), []);

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
  const [playerSort, setPlayerSort] = useState({ key: 'points', dir: 'desc' });
  const playerColumns = useMemo(() => ([
    { key: 'player', label: 'Player', sortValue: (r) => r.player },
    { key: 'shots', label: 'Shots', sortValue: (r) => r.shots },
    { key: 'scores', label: 'Scores', sortValue: (r) => r.scores },
    { key: 'points', label: 'Points', sortValue: (r) => r.points },
    { key: 'pps', label: 'Pts/Shot', sortValue: (r) => r.pps },
    { key: 'avgDist', label: 'Avg Dist', sortValue: (r) => r.avgDist },
    { key: 'pointAtt', label: '1 Att', sortValue: (r) => r.pointAtt },
    { key: 'pointMade', label: '1 Scored', sortValue: (r) => r.pointMade },
    { key: 'twoAtt', label: '2 Att', sortValue: (r) => r.twoAtt },
    { key: 'twoMade', label: '2 Scored', sortValue: (r) => r.twoMade },
    { key: 'goalAtt', label: 'Goal Att', sortValue: (r) => r.goalAtt },
    { key: 'goalMade', label: 'Goal Scored', sortValue: (r) => r.goalMade },
    { key: 'playShots', label: 'Play Shots', sortValue: (r) => r.playShots },
    { key: 'placedShots', label: 'Placed Shots', sortValue: (r) => r.placedShots },
  ]), []);
  const sortedPlayerSummary = useMemo(() => sortRows(playerSummary, playerSort, playerColumns, 'key'), [playerSummary, playerSort, playerColumns]);
  const togglePlayerSort = (key) => setPlayerSort((current) => current.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' });

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
            { label: 'Shots Short', home: kpis.home.shortN, away: kpis.away.shortN },
            { label: '1 Point Scores', home: `${kpis.home.typeBreakdown.point.scored}/${kpis.home.typeBreakdown.point.attempts} (${formatPct(kpis.home.typeBreakdown.point.attempts ? (kpis.home.typeBreakdown.point.scored / kpis.home.typeBreakdown.point.attempts) * 100 : NaN)})`, away: `${kpis.away.typeBreakdown.point.scored}/${kpis.away.typeBreakdown.point.attempts} (${formatPct(kpis.away.typeBreakdown.point.attempts ? (kpis.away.typeBreakdown.point.scored / kpis.away.typeBreakdown.point.attempts) * 100 : NaN)})` },
            { label: '2 Point Scores', home: `${kpis.home.typeBreakdown['2_point'].scored}/${kpis.home.typeBreakdown['2_point'].attempts} (${formatPct(kpis.home.typeBreakdown['2_point'].attempts ? (kpis.home.typeBreakdown['2_point'].scored / kpis.home.typeBreakdown['2_point'].attempts) * 100 : NaN)})`, away: `${kpis.away.typeBreakdown['2_point'].scored}/${kpis.away.typeBreakdown['2_point'].attempts} (${formatPct(kpis.away.typeBreakdown['2_point'].attempts ? (kpis.away.typeBreakdown['2_point'].scored / kpis.away.typeBreakdown['2_point'].attempts) * 100 : NaN)})` },
            { label: 'Goal Scores', home: `${kpis.home.typeBreakdown.goal.scored}/${kpis.home.typeBreakdown.goal.attempts} (${formatPct(kpis.home.typeBreakdown.goal.attempts ? (kpis.home.typeBreakdown.goal.scored / kpis.home.typeBreakdown.goal.attempts) * 100 : NaN)})`, away: `${kpis.away.typeBreakdown.goal.scored}/${kpis.away.typeBreakdown.goal.attempts} (${formatPct(kpis.away.typeBreakdown.goal.attempts ? (kpis.away.typeBreakdown.goal.scored / kpis.away.typeBreakdown.goal.attempts) * 100 : NaN)})` },
            { label: '% Low Pressure Shots', home: formatPct(kpis.home.lowPressurePct), away: formatPct(kpis.away.lowPressurePct) },
          ]}
        />

        {mapShots.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-sm text-slate-600 text-center">
              No shots available for current filters.
            </CardContent>
          </Card>
        ) : (
          <>
            <ShotMap shots={mapShots} mode={shotMapMode} setMode={setShotMapMode} teamMode={teamMode} homeColor={homeTeam?.color} awayColor={awayTeam?.color} onOpenVideoAt={onOpenVideoAt} />

            <div className="grid lg:grid-cols-2 gap-4">
              {teamMode === 'both' ? (
                <>
                  <CategoryComparisonTable
                    title="Shot Type Breakdown"
                    sortable={false}
                    categories={shotTypeCategories}
                    categoryKey="type"
                    categoryLabel="Type"
                    homeLabel={homeTeam?.name || 'Home'}
                    awayLabel={awayTeam?.name || 'Away'}
                    homeRows={shotTypeSummary.home}
                    awayRows={shotTypeSummary.away}
                    columns={[
                      { key: 'attempts', label: 'Attempts', align: 'right', render: (r) => r.attempts },
                      { key: 'scores', label: 'Scores', align: 'right', render: (r) => r.scores },
                      { key: 'conv', label: 'Conv %', align: 'right', render: (r) => formatPct(r.conv) },
                      { key: 'pps', label: 'Pts/Shot', align: 'right', render: (r) => Number.isFinite(r.pps) ? r.pps.toFixed(2) : 'NA' },
                    ]}
                  />
                  <PressureConversionChart
                    title="Pressure vs Conversion"
                    data={pressureSummary.both}
                    homeColor={homeTeam?.color}
                    awayColor={awayTeam?.color}
                    teamMode={teamMode}
                  />
                </>
              ) : (
                <>
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
                  <PressureConversionChart
                    title="Pressure vs Conversion"
                    data={teamMode === 'away' ? pressureSummary.away : pressureSummary.home}
                    homeColor={homeTeam?.color}
                    awayColor={awayTeam?.color}
                    teamMode={teamMode}
                  />
                </>
              )}
            </div>

            <div className="grid lg:grid-cols-2 gap-4">
              {teamMode === 'both' ? (
                <CategoryComparisonTable
                  title="Shot Situation Breakdown"
                  sortable={false}
                  categories={situationCategories}
                  categoryKey="situation"
                  categoryLabel="Situation"
                  homeLabel={homeTeam?.name || 'Home'}
                  awayLabel={awayTeam?.name || 'Away'}
                  homeRows={situationSummary.home}
                  awayRows={situationSummary.away}
                  columns={[
                    { key: 'attempts', label: 'Attempts', align: 'right', render: (r) => r.attempts },
                    { key: 'conv', label: 'Conv %', align: 'right', render: (r) => formatPct(r.conv) },
                    { key: 'pps', label: 'Pts/Shot', align: 'right', render: (r) => Number.isFinite(r.pps) ? r.pps.toFixed(2) : 'NA' },
                  ]}
                />
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
                      {playerColumns.map((column) => (
                        <SortableTableHead
                          key={column.key}
                          column={column}
                          sortState={playerSort}
                          onToggle={togglePlayerSort}
                          className={column.key === 'player' ? undefined : 'text-right'}
                        />
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedPlayerSummary.map((r) => (
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

