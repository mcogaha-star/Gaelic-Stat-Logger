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
            home_scored: { label: 'Home Scored', color: homeFill },
            home_missed: { label: 'Home No Score', color: faded(homeFill, 0.28) },
            away_scored: { label: 'Away Scored', color: awayFill },
            away_missed: { label: 'Away No Score', color: faded(awayFill, 0.28) },
            scored: { label: 'Scored', color: teamMode === 'away' ? awayFill : homeFill },
            missed: { label: 'No Score', color: faded(teamMode === 'away' ? awayFill : homeFill, 0.28) },
          }}
        >
          <BarChart data={data} margin={{ top: 42, right: 12, left: 0, bottom: 6 }} barGap={10} barCategoryGap="28%">
            <CartesianGrid vertical={false} />
            <XAxis dataKey="pressure" className="text-xs" />
            <YAxis allowDecimals={false} className="text-xs" />
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
                <Bar dataKey="home_scored" stackId="home" name="Home Scored" fill="var(--color-home_scored)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="home_missed" stackId="home" name="Home No Score" fill="var(--color-home_missed)" radius={[0, 0, 4, 4]}>
                  <LabelList dataKey="home_attempts" position="top" className="fill-slate-700 text-[11px]" />
                </Bar>
                <Bar dataKey="away_scored" stackId="away" name="Away Scored" fill="var(--color-away_scored)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="away_missed" stackId="away" name="Away No Score" fill="var(--color-away_missed)" radius={[0, 0, 4, 4]}>
                  <LabelList dataKey="away_attempts" position="top" className="fill-slate-700 text-[11px]" />
                </Bar>
              </>
            ) : (
              <>
                <Bar dataKey="scored" stackId="single" name="Scored" fill="var(--color-scored)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="missed" stackId="single" name="No Score" fill="var(--color-missed)" radius={[0, 0, 4, 4]}>
                  <LabelList dataKey="attempts" position="top" className="fill-slate-700 text-[11px]" />
                </Bar>
              </>
            )}
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

function ScoringTab({ stats, homeTeam, awayTeam, playerOptions = [], reportFilters, shotType, setShotType, situation, setSituation, pressure, setPressure, method, setMethod, onOpenVideoAt }) {
  const scopedReportFilters = useMemo(() => ({ ...reportFilters, allowedActionTypes: ['shot'] }), [reportFilters]);
  const teamMode = String(reportFilters?.team || 'both');
  const [shotMapMode, setShotMapMode] = useState('all');
  const playerLookup = useMemo(() => {
    const byId = new Map();
    const bySideNumber = new Map();
    for (const player of Array.isArray(playerOptions) ? playerOptions : []) {
      if (player?.id) byId.set(String(player.id), player);
      const side = player?.team_side;
      const number = Number(player?.number);
      if ((side === 'home' || side === 'away') && Number.isFinite(number)) {
        bySideNumber.set(`${side}:${number}`, player);
      }
    }
    return { byId, bySideNumber };
  }, [playerOptions]);

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
      const rosterPlayer = (() => {
        if (playerSel?.id && playerLookup.byId.has(String(playerSel.id))) return playerLookup.byId.get(String(playerSel.id));
        const number = Number(playerSel?.number ?? s.player_number);
        const side = playerSel?.team_side === 'away' || playerSel?.team_side === 'home'
          ? playerSel.team_side
          : s.team_side === 'away' ? 'away' : 'home';
        if (Number.isFinite(number)) return playerLookup.bySideNumber.get(`${side}:${number}`) || null;
        return null;
      })();

      const playerLabel = (() => {
        if (playerSel?.kind === 'player') {
          const n = (playerSel.number ?? rosterPlayer?.number) ? `#${playerSel.number ?? rosterPlayer?.number}` : '';
          const name = String(playerSel.name || rosterPlayer?.name || s.player_name || '').trim();
          return `${n} ${name}`.trim() || 'Player';
        }
        if (s.player_number || rosterPlayer?.number) {
          const n = s.player_number ?? rosterPlayer?.number;
          const name = String(s.player_name || rosterPlayer?.name || '').trim();
          return `#${n} ${name}`.trim();
        }
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
        situationGroup: sit === 'play' ? 'play' : 'deadball',
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
        playerId: playerSel?.id || rosterPlayer?.id || null,
        timeLabel,
      });
    }
    return out;
  }, [stats, playerLookup, scopedReportFilters]);

  const filteredShots = useMemo(() => {
    return shots.filter((s) => {
      if (s.broughtBackAdv) return false;
      if (shotType.length && !shotType.includes(s.shotType)) return false;
      if (situation.length && !situation.includes(s.situationGroup)) return false;
      if (pressure.length && !pressure.includes(s.pressure)) return false;
      if (method.length && !method.includes(s.method)) return false;
      return true;
    });
  }, [shots, shotType, situation, pressure, method]);

  const mapShots = useMemo(() => {
    return shots.filter((s) => {
      if (shotType.length && !shotType.includes(s.shotType)) return false;
      if (situation.length && !situation.includes(s.situationGroup)) return false;
      if (pressure.length && !pressure.includes(s.pressure)) return false;
      if (method.length && !method.includes(s.method)) return false;
      return true;
    });
  }, [shots, shotType, situation, pressure, method]);

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
        const scored = sh.filter((s) => s.outcome === type).length;
        const converted = sh.filter((s) => s.shotType === type && s.outcome === type).length;
        acc[type] = { attempts, scored, converted };
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
      const m = new Map(order.map((type) => [type, { type, attempts: 0, scores: 0, converted: 0, points: 0 }]));
      for (const s of source) {
        const t = String(s.shotType || 'point');
        const attemptRow = m.get(t) || { type: t, attempts: 0, scores: 0, converted: 0, points: 0 };
        attemptRow.attempts += 1;
        attemptRow.points += s.points || 0;
        if (s.outcome === t) attemptRow.converted += 1;
        m.set(t, attemptRow);

        const outcomeType = order.includes(String(s.outcome || '')) ? String(s.outcome) : null;
        if (outcomeType) {
          const outcomeRow = m.get(outcomeType) || { type: outcomeType, attempts: 0, scores: 0, converted: 0, points: 0 };
          outcomeRow.scores += 1;
          m.set(outcomeType, outcomeRow);
        }
      }
      const rows = Array.from(m.values()).map((r) => ({
        ...r,
        label: label[r.type] || toTitleCase(r.type),
        conv: r.attempts ? (r.converted / r.attempts) * 100 : NaN,
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
          scored: scores,
          missed: Math.max(0, attempts - scores),
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
      home_scored: home[idx]?.scored || 0,
      home_missed: home[idx]?.missed || 0,
      home_pps: home[idx]?.pps,
      away_attempts: away[idx]?.attempts || 0,
      away_scores: away[idx]?.scores || 0,
      away_conv: away[idx]?.conv,
      away_scored: away[idx]?.scored || 0,
      away_missed: away[idx]?.missed || 0,
      away_pps: away[idx]?.pps,
      home_label: homeTeam?.name || 'Home',
      away_label: awayTeam?.name || 'Away',
    }));
    return { both, home, away };
  }, [filteredShots, homeTeam?.name, awayTeam?.name]);

  const situationSummary = useMemo(() => {
    const build = (teamSide = null) => {
      const source = teamSide ? filteredShots.filter((s) => s.team_side === teamSide) : filteredShots;
      const cats = ['play', 'deadball'];
      return cats.map((c) => {
        const list = source.filter((s) => String(s.situationGroup) === c);
        const attempts = list.length;
        const scores = list.filter((s) => s.isScore).length;
        const points = list.reduce((a, s) => a + (s.points || 0), 0);
        return {
          situation: c === 'play' ? 'Play' : 'Deadball',
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
    { key: 'Deadball', label: 'Deadball', homeFallback: { situation: 'Deadball', attempts: 0, conv: NaN, pps: NaN }, awayFallback: { situation: 'Deadball', attempts: 0, conv: NaN, pps: NaN } },
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
        points: 0,
        distSum: 0,
        distN: 0,
        pointMade: 0,
        pointAtt: 0,
        twoMade: 0,
        twoAtt: 0,
        goalMade: 0,
        goalAtt: 0,
      };
      cur.shots += 1;
      cur.points += s.points || 0;
      if (Number.isFinite(s.distance)) { cur.distSum += s.distance; cur.distN += 1; }
      if (s.shotType === 'point') cur.pointAtt += 1;
      if (s.shotType === '2_point') cur.twoAtt += 1;
      if (s.shotType === 'goal') cur.goalAtt += 1;
      if (s.outcome === 'point') cur.pointMade += 1;
      if (s.outcome === '2_point') cur.twoMade += 1;
      if (s.outcome === 'goal') cur.goalMade += 1;
      rows.set(key, cur);
    }
    const out = Array.from(rows.values()).map((r) => ({
      ...r,
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
    { key: 'points', label: 'Points', sortValue: (r) => r.points },
    { key: 'pps', label: 'Pts/Shot', sortValue: (r) => r.pps },
    { key: 'avgDist', label: 'Avg Dist', sortValue: (r) => r.avgDist },
    { key: 'pointAtt', label: '1 Point', sortValue: (r) => r.pointAtt },
    { key: 'twoAtt', label: '2 Point', sortValue: (r) => r.twoAtt },
    { key: 'goalAtt', label: 'Goal', sortValue: (r) => r.goalAtt },
  ]), []);
  const sortedPlayerSummary = useMemo(() => sortRows(playerSummary, playerSort, playerColumns, 'key'), [playerSummary, playerSort, playerColumns]);
  const togglePlayerSort = (key) => setPlayerSort((current) => current.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' });

  return (
    <div className="space-y-4">
      <div className="report-metric-split">
        <ComparisonMetricsCard
          title="Scoring Metrics"
          cardClassName="w-full"
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
            { label: 'Shots Short', home: kpis.home.shortN, away: kpis.away.shortN },
          ]}
        />
        <div className="report-companion-grid">
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
      </div>

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
                        <TableCell className="text-right tabular-nums">{r.points}</TableCell>
                        <TableCell className="text-right tabular-nums">{Number.isFinite(r.pps) ? r.pps.toFixed(2) : 'NA'}</TableCell>
                        <TableCell className="text-right tabular-nums">{Number.isFinite(r.avgDist) ? r.avgDist.toFixed(1) : 'NA'}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.pointMade}/{r.pointAtt}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.twoMade}/{r.twoAtt}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.goalMade}/{r.goalAtt}</TableCell>
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

