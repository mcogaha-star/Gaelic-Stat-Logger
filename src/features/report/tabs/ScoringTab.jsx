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
import { createSeededRng, hashSimulationSeed, simulateFullMatchFromShots } from '@/lib/winProbability';
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
  deriveAttackTypeState,
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
  attackTypeStateKey,
} from '../shared';

const paneClassName = 'border-2 border-slate-400 bg-gradient-to-br from-white via-white to-slate-50 shadow-md';

function normalizeShootingSituation(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'free_kick') return 'free_hands';
  return raw;
}

function ptsXpCellStyle(value) {
  if (!Number.isFinite(value)) return undefined;
  const clamped = Math.min(Math.abs(value) / 2.5, 1);
  if (value > 0) {
    return {
      color: clamped > 0.45 ? '#14532d' : '#166534',
      fontWeight: 600,
    };
  }
  if (value < 0) {
    return {
      color: clamped > 0.45 ? '#7f1d1d' : '#991b1b',
      fontWeight: 600,
    };
  }
  return {
      color: '#475569',
    fontWeight: 600,
  };
}

function SideBreakdownTable({ title, rows, columns, headerAction = null }) {
  const [sortState, setSortState] = useState({ key: columns?.[0]?.key || '', dir: 'asc' });
  const sortedRows = useMemo(() => sortRows(rows, sortState, columns, 'key'), [rows, sortState, columns]);
  const toggleSort = (key) => setSortState((current) => current.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });
  return (
    <Card className={paneClassName}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="font-semibold text-slate-900">{title}</div>
          {headerAction}
        </div>
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

function TwoTeamBreakdownTable({ title, homeLabel, awayLabel, homeRows, awayRows, columns, headerAction = null }) {
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
    <Card className={paneClassName}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="font-semibold text-slate-900">{title}</div>
          {headerAction}
        </div>
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

function CategoryComparisonTable({ title, categories, categoryKey, categoryLabel, homeLabel, awayLabel, homeRows, awayRows, columns, sortable = true, headerAction = null }) {
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
    <Card className={paneClassName}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="font-semibold text-slate-900">{title}</div>
          {headerAction}
        </div>
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
    <Card className={paneClassName}>
      <CardContent className="p-4 space-y-3">
        <div className="font-semibold text-slate-900">{title}</div>
        <ChartContainer
          id={`pressure-conv-${title.replace(/\s+/g, '-').toLowerCase()}`}
          className="h-[336px] w-full"
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
                  <div className="rounded-md border bg-white px-3 py-2 text-[13px] shadow-sm">
                    <div className="mb-2 text-center font-semibold text-slate-900 underline underline-offset-2">{label || row.pressure || 'Pressure'}</div>
                    {teamMode === 'both' ? (
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <div className="font-semibold text-slate-900">{row.home_label || 'Home'}</div>
                          <div><span className="font-mono">{row.home_scores}/{row.home_attempts}</span></div>
                          <div>Conversion: <span className="font-mono">{formatPct(row.home_conv)}</span></div>
                          <div>Pts/Shot: <span className="font-mono">{Number.isFinite(row.home_pps) ? row.home_pps.toFixed(2) : 'NA'}</span></div>
                          <div>xP/Shot: <span className="font-mono">{Number.isFinite(row.home_xps) ? row.home_xps.toFixed(2) : 'NA'}</span></div>
                        </div>
                        <div className="space-y-1">
                          <div className="font-semibold text-slate-900">{row.away_label || 'Away'}</div>
                          <div><span className="font-mono">{row.away_scores}/{row.away_attempts}</span></div>
                          <div>Conversion: <span className="font-mono">{formatPct(row.away_conv)}</span></div>
                          <div>Pts/Shot: <span className="font-mono">{Number.isFinite(row.away_pps) ? row.away_pps.toFixed(2) : 'NA'}</span></div>
                          <div>xP/Shot: <span className="font-mono">{Number.isFinite(row.away_xps) ? row.away_xps.toFixed(2) : 'NA'}</span></div>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <div>Attempts: <span className="font-mono">{row.attempts}</span></div>
                        <div>Scores: <span className="font-mono">{row.scores}</span></div>
                        <div>Conversion: <span className="font-mono">{formatPct(row.conv)}</span></div>
                        <div>Pts/Shot: <span className="font-mono">{Number.isFinite(row.pps) ? row.pps.toFixed(2) : 'NA'}</span></div>
                        <div>xP/Shot: <span className="font-mono">{Number.isFinite(row.xps) ? row.xps.toFixed(2) : 'NA'}</span></div>
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

function WinProbabilityBar({ title, sim, homeTeam, awayTeam, homeColor, awayColor }) {
  const homeFill = homeColor || '#f97316';
  const awayFill = awayColor || '#7f1d3a';
  const homeLabel = homeTeam?.name || 'Home';
  const awayLabel = awayTeam?.name || 'Away';
  const chartData = sim ? [{
    label: 'Win Probability',
    home: sim.homeWinProb * 100,
    draw: sim.drawProb * 100,
    away: sim.awayWinProb * 100,
  }] : [];

  return (
    <Card className={paneClassName}>
      <CardContent className="px-4 pt-3 pb-2 space-y-0.5">
        <div className="font-semibold text-slate-900">{title}</div>
        {sim ? (
          <div className="space-y-0">
            <div className="flex items-center justify-between gap-3 pb-0 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <span className="truncate">{homeLabel}</span>
              <span className="truncate text-right">{awayLabel}</span>
            </div>
            <ChartContainer
              id="expected-point-post-game-win-probability"
              className="h-[56px] w-full"
              config={{
                home: { label: `${homeLabel} Win`, color: homeFill },
                draw: { label: 'Draw', color: '#cbd5e1' },
                away: { label: `${awayLabel} Win`, color: awayFill },
              }}
            >
              <BarChart
                data={chartData}
                layout="vertical"
                margin={{ top: -13, right: 0, left: 0, bottom: -8 }}
                barSize={34}
              >
                <XAxis type="number" domain={[0, 100]} hide />
                <YAxis type="category" dataKey="label" hide />
                <Tooltip
                  cursor={false}
                  formatter={(value, name) => [`${Number(value).toFixed(1)}%`, name]}
                  contentStyle={{ borderRadius: 8, borderColor: '#cbd5e1' }}
                />
                <Bar dataKey="home" stackId="wp" fill="var(--color-home)" radius={[8, 0, 0, 8]}>
                  <LabelList dataKey="home" position="insideLeft" offset={14} className="fill-white text-[11px] font-semibold" formatter={(value) => `${Number(value).toFixed(1)}%`} />
                </Bar>
                <Bar dataKey="draw" stackId="wp" fill="var(--color-draw)">
                  <LabelList dataKey="draw" position="inside" className="fill-slate-700 text-[11px] font-semibold" formatter={(value) => `${Number(value).toFixed(1)}%`} />
                </Bar>
                <Bar dataKey="away" stackId="wp" fill="var(--color-away)" radius={[0, 8, 8, 0]}>
                  <LabelList dataKey="away" position="insideRight" offset={14} className="fill-white text-[11px] font-semibold" formatter={(value) => `${Number(value).toFixed(1)}%`} />
                </Bar>
              </BarChart>
            </ChartContainer>
          </div>
        ) : (
          <div className="text-sm text-slate-600">
            No valid xP-tagged shots available for simulation under the current filters.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ScoringTab({ stats, simStats = null, homeTeam, awayTeam, playerOptions = [], reportFilters, shotType, setShotType, situation, setSituation, pressure, setPressure, method, setMethod, attackType = 'any', onOpenVideoAt }) {
  const scopedReportFilters = useMemo(() => ({ ...reportFilters, allowedActionTypes: ['shot'] }), [reportFilters]);
  const teamMode = String(reportFilters?.team || 'both');
  const scoringAttackTypeFilter = String(attackType || 'any');
  const [shotMapMode, setShotMapMode] = useState('all');
  const [detailedSituationOpen, setDetailedSituationOpen] = useState(false);
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
  const shootingPossessionAttackTypeByKey = useMemo(() => {
    const sourceStats = applyNonTeamReportFilters(
      Array.isArray(reportFilters?.allStats) ? reportFilters.allStats : [],
      {
        ...reportFilters,
        actionTypes: [],
        outcomes: [],
        playerIds: [],
        allowedActionTypes: ['pass', 'carry', 'shot', 'turnover', 'kickout', 'throw_in', 'foul'],
      }
    );
    const groups = groupByPossession(sourceStats);
    const map = new Map();
    for (const [key, evs] of groups.entries()) {
      const [teamSide] = String(key).split('-');
      if (teamSide !== 'home' && teamSide !== 'away') continue;
      const acting = (Array.isArray(evs) ? evs : []).filter((e) => e && e.team_side === teamSide);
      if (!acting.length) continue;
      map.set(String(key), deriveAttackTypeState(acting));
    }
    return map;
  }, [reportFilters]);

  const buildShotRows = React.useCallback((sourceStats) => {
    const list = Array.isArray(sourceStats) ? sourceStats : [];
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
      const sit = normalizeShootingSituation(sh.situation || '');
      const pr = String(sh.pressure || '');
      const xpRaw = extra?.shot?.xp?.value ?? sh?.xp?.value ?? sh.expected_points ?? sh.expectedPoints ?? sh.xp ?? sh.xP ?? null;
      const xp = Number(xpRaw);

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
        method: String(sh.method || ''),
        pressure: pr,
        attackType: shootingPossessionAttackTypeByKey.get(`${s.possession_team_side}-${Number(s.possession_id)}`) || 'Set',
        outcome: o,
        broughtBackAdv: !!sh.brought_back_adv || isBroughtBackAdvantageStat(s),
        distance: dist,
        angle: calcAngleToGoal(x, y),
        zone: z,
        side: shotSideFromY(y),
        isScore: shotOutcomeGroup(o) === 'score',
        points: shotPointsForOutcome(o),
        xp: Number.isFinite(xp) ? xp : NaN,
        isFromPlay: sit === 'play',
        isPlacedBall: sit && sit !== 'play',
        playerLabel,
        playerId: playerSel?.id || rosterPlayer?.id || null,
        playerKey: `${s.team_side === 'away' ? 'away' : 'home'}|${String(playerSel?.id || rosterPlayer?.id || playerLabel || 'NA')}`,
        playerMatchKeys: [
          `${s.team_side === 'away' ? 'away' : 'home'}|${String(playerSel?.id || rosterPlayer?.id || playerLabel || 'NA')}`,
          `${s.team_side === 'away' ? 'away' : 'home'}|${String(playerLabel || 'NA')}`,
        ],
        timeLabel,
      });
    }
    return out;
  }, [playerLookup, scopedReportFilters, shootingPossessionAttackTypeByKey]);

  const shots = useMemo(() => buildShotRows(stats), [stats, buildShotRows]);
  const simShots = useMemo(() => buildShotRows(simStats ?? stats), [simStats, stats, buildShotRows]);

  const situationLabelMap = useMemo(() => ({
    play: 'Play',
    free_ground: 'Free From Ground',
    free_hands: 'Free From Hands',
    '45': '45',
    penalty: 'Penalty',
    mark: 'Mark',
  }), []);

  const situationOrder = useMemo(() => ([
    'play',
    'free_ground',
    'free_hands',
    '45',
    'penalty',
    'mark',
  ]), []);

  const selectedPlayerKeys = useMemo(() => {
    const selectedIds = Array.isArray(reportFilters?.playerIds) ? reportFilters.playerIds.map((id) => String(id)) : [];
    if (!selectedIds.length) return [];
    const keys = new Set();
    for (const player of Array.isArray(playerOptions) ? playerOptions : []) {
      if (!selectedIds.includes(String(player?.id))) continue;
      const side = player?.team_side === 'away' ? 'away' : 'home';
      keys.add(`${side}|${String(player.id)}`);
      keys.add(`${side}|${String(player.label || 'NA')}`);
    }
    return Array.from(keys);
  }, [reportFilters?.playerIds, playerOptions]);

  const matchesSelectedPlayer = (shot) => {
    if (!selectedPlayerKeys.length) return true;
    const keys = Array.isArray(shot?.playerMatchKeys) ? shot.playerMatchKeys : [];
    return keys.some((key) => selectedPlayerKeys.includes(String(key)));
  };

  const filteredShots = useMemo(() => {
    return shots.filter((s) => {
      if (s.broughtBackAdv) return false;
      if (!matchesSelectedPlayer(s)) return false;
      if (shotType.length && !shotType.includes(s.shotType)) return false;
      if (situation.length && !situation.includes(s.situation)) return false;
      if (pressure.length && !pressure.includes(s.pressure)) return false;
      if (method.length && !method.includes(s.method)) return false;
      if (scoringAttackTypeFilter !== 'any' && attackTypeStateKey(s.attackType) !== scoringAttackTypeFilter) return false;
      return true;
    });
  }, [shots, selectedPlayerKeys, shotType, situation, pressure, method, scoringAttackTypeFilter]);

  const mapShots = useMemo(() => {
    return shots.filter((s) => {
      if (s.broughtBackAdv) return false;
      if (!matchesSelectedPlayer(s)) return false;
      if (shotType.length && !shotType.includes(s.shotType)) return false;
      if (situation.length && !situation.includes(s.situation)) return false;
      if (pressure.length && !pressure.includes(s.pressure)) return false;
      if (method.length && !method.includes(s.method)) return false;
      if (scoringAttackTypeFilter !== 'any' && attackTypeStateKey(s.attackType) !== scoringAttackTypeFilter) return false;
      return true;
    });
  }, [shots, selectedPlayerKeys, shotType, situation, pressure, method, scoringAttackTypeFilter]);

  const kpis = useMemo(() => {
    const calc = (side) => {
      const sh = filteredShots.filter((s) => s.team_side === side);
      const shotsN = sh.length;
      const scoresN = sh.filter((s) => s.isScore).length;
      const totalPts = sh.reduce((a, s) => a + (s.points || 0), 0);
      const totalXp = sh.reduce((a, s) => a + (Number.isFinite(s.xp) ? s.xp : 0), 0);
      const xpCount = sh.filter((s) => Number.isFinite(s.xp)).length;
      const goals = sh.filter((s) => s.outcome === 'goal').length;
      const points1 = sh.filter((s) => s.outcome === 'point').length;
      const points2 = sh.filter((s) => s.outcome === '2_point').length;
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
        goals,
        points1,
        points2,
        totalPts,
        totalXp,
        xpCount,
        xpShot: xpCount ? totalXp / xpCount : NaN,
        conv,
        pps,
        avgDist,
        playConv,
        fromPlayPct,
        placedConv,
        lowPressureShots: lowPressure,
        shortN,
        typeBreakdown,
      };
    };
    return { home: calc('home'), away: calc('away') };
  }, [filteredShots]);

  const shotOutcomeRows = useMemo(() => {
    const order = ['point', '2_point', 'goal', 'wide', 'short', 'saved', 'blocked', 'post', 'other'];
    const labels = {
      point: '1 Point',
      '2_point': '2 Point',
      goal: 'Goal',
      wide: 'Wide',
      short: 'Short',
      saved: 'Saved',
      blocked: 'Blocked',
      post: 'Post',
      other: 'Total',
    };
    const buildCounts = (side) => {
      const counts = Object.fromEntries(order.map((key) => [key, 0]));
      const teamShots = filteredShots.filter((shot) => shot.team_side === side);
      teamShots.forEach((shot) => {
        const key = order.includes(String(shot.outcome || '')) ? String(shot.outcome) : 'other';
        if (key !== 'other') counts[key] += 1;
      });
      counts.other = teamShots.length;
      return counts;
    };
    const homeCounts = buildCounts('home');
    const awayCounts = buildCounts('away');
    return order.map((key) => ({
      key,
      label: labels[key] || toTitleCase(key),
      home: homeCounts[key] || 0,
      away: awayCounts[key] || 0,
    }));
  }, [filteredShots]);

  const shotTypeSummary = useMemo(() => {
    const build = (teamSide = null) => {
      const source = teamSide ? filteredShots.filter((s) => s.team_side === teamSide) : filteredShots;
      const order = ['point', '2_point', 'goal'];
      const label = { point: '1 Point', '2_point': '2 Point', goal: 'Goal' };
      const m = new Map(order.map((type) => [type, { type, attempts: 0, scores: 0, converted: 0, points: 0, xpTotal: 0, xpCount: 0 }]));
      for (const s of source) {
        const t = String(s.shotType || 'point');
        const attemptRow = m.get(t) || { type: t, attempts: 0, scores: 0, converted: 0, points: 0, xpTotal: 0, xpCount: 0 };
        attemptRow.attempts += 1;
        attemptRow.points += s.points || 0;
        if (Number.isFinite(s.xp)) {
          attemptRow.xpTotal += s.xp;
          attemptRow.xpCount += 1;
        }
        if (s.outcome === t) attemptRow.converted += 1;
        m.set(t, attemptRow);

        const outcomeType = order.includes(String(s.outcome || '')) ? String(s.outcome) : null;
        if (outcomeType) {
          const outcomeRow = m.get(outcomeType) || { type: outcomeType, attempts: 0, scores: 0, converted: 0, points: 0, xpTotal: 0, xpCount: 0 };
          outcomeRow.scores += 1;
          m.set(outcomeType, outcomeRow);
        }
      }
      const rows = Array.from(m.values()).map((r) => ({
        ...r,
        label: label[r.type] || toTitleCase(r.type),
        conv: r.attempts ? (r.converted / r.attempts) * 100 : NaN,
        pps: r.attempts ? r.points / r.attempts : NaN,
        xps: r.xpCount ? r.xpTotal / r.xpCount : NaN,
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
        const totalXp = list.reduce((a, s) => a + (Number.isFinite(s.xp) ? s.xp : 0), 0);
        const xpCount = list.filter((s) => Number.isFinite(s.xp)).length;
        return {
          pressure: toTitleCase(p),
          attempts,
          scores,
          conv: attempts ? (scores / attempts) * 100 : NaN,
          scored: scores,
          missed: Math.max(0, attempts - scores),
          pps: attempts ? points / attempts : NaN,
          xps: xpCount ? totalXp / xpCount : NaN,
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
      home_xps: home[idx]?.xps,
      away_attempts: away[idx]?.attempts || 0,
      away_scores: away[idx]?.scores || 0,
      away_conv: away[idx]?.conv,
      away_scored: away[idx]?.scored || 0,
      away_missed: away[idx]?.missed || 0,
      away_pps: away[idx]?.pps,
      away_xps: away[idx]?.xps,
      home_label: homeTeam?.name || 'Home',
      away_label: awayTeam?.name || 'Away',
    }));
    return { both, home, away };
  }, [filteredShots, homeTeam?.name, awayTeam?.name]);

  const situationSummary = useMemo(() => {
    const build = (teamSide = null) => {
      const source = teamSide ? filteredShots.filter((s) => s.team_side === teamSide) : filteredShots;
      const cats = ['play', 'deadball'];
      return cats.map((key) => {
        const list = source.filter((s) => {
          const situationKey = String(s.situation || '');
          return key === 'play' ? situationKey === 'play' : situationKey && situationKey !== 'play';
        });
        const attempts = list.length;
        const scores = list.filter((s) => s.isScore).length;
        const points = list.reduce((a, s) => a + (s.points || 0), 0);
        const totalXp = list.reduce((a, s) => a + (Number.isFinite(s.xp) ? s.xp : 0), 0);
        const xpCount = list.filter((s) => Number.isFinite(s.xp)).length;
        return {
          situation: key === 'play' ? 'Play' : 'Deadball',
          attempts,
          conv: attempts ? (scores / attempts) * 100 : NaN,
          pps: attempts ? points / attempts : NaN,
          xps: xpCount ? totalXp / xpCount : NaN,
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
    { key: 'point', label: '1 Point', homeFallback: { type: 'point', label: '1 Point', attempts: 0, scores: 0, conv: NaN, pps: NaN, xps: NaN }, awayFallback: { type: 'point', label: '1 Point', attempts: 0, scores: 0, conv: NaN, pps: NaN, xps: NaN } },
    { key: '2_point', label: '2 Point', homeFallback: { type: '2_point', label: '2 Point', attempts: 0, scores: 0, conv: NaN, pps: NaN, xps: NaN }, awayFallback: { type: '2_point', label: '2 Point', attempts: 0, scores: 0, conv: NaN, pps: NaN, xps: NaN } },
    { key: 'goal', label: 'Goal', homeFallback: { type: 'goal', label: 'Goal', attempts: 0, scores: 0, conv: NaN, pps: NaN, xps: NaN }, awayFallback: { type: 'goal', label: 'Goal', attempts: 0, scores: 0, conv: NaN, pps: NaN, xps: NaN } },
  ]), []);

  const situationCategories = useMemo(() => ([
    { key: 'Play', label: 'Play', homeFallback: { situation: 'Play', attempts: 0, conv: NaN, pps: NaN, xps: NaN }, awayFallback: { situation: 'Play', attempts: 0, conv: NaN, pps: NaN, xps: NaN } },
    { key: 'Deadball', label: 'Deadball', homeFallback: { situation: 'Deadball', attempts: 0, conv: NaN, pps: NaN, xps: NaN }, awayFallback: { situation: 'Deadball', attempts: 0, conv: NaN, pps: NaN, xps: NaN } },
  ]), []);

  const detailedSituationSummary = useMemo(() => {
    const build = (teamSide = null) => {
      const source = teamSide ? filteredShots.filter((s) => s.team_side === teamSide) : filteredShots;
      return situationOrder.map((key) => {
        const list = source.filter((s) => String(s.situation || '') === key);
        const attempts = list.length;
        const scores = list.filter((s) => s.isScore).length;
        const points = list.reduce((a, s) => a + (s.points || 0), 0);
        const totalXp = list.reduce((a, s) => a + (Number.isFinite(s.xp) ? s.xp : 0), 0);
        const xpCount = list.filter((s) => Number.isFinite(s.xp)).length;
        return {
          situation: situationLabelMap[key] || toTitleCase(key),
          attempts,
          conv: attempts ? (scores / attempts) * 100 : NaN,
          pps: attempts ? points / attempts : NaN,
          xps: xpCount ? totalXp / xpCount : NaN,
        };
      });
    };
    return {
      both: build(null),
      home: build('home'),
      away: build('away'),
    };
  }, [filteredShots, situationLabelMap, situationOrder]);

  const detailedSituationCategories = useMemo(() => (
    situationOrder.map((key) => {
      const label = situationLabelMap[key] || toTitleCase(key);
      return {
        key: label,
        label,
        homeFallback: { situation: label, attempts: 0, conv: NaN, pps: NaN, xps: NaN },
        awayFallback: { situation: label, attempts: 0, conv: NaN, pps: NaN, xps: NaN },
      };
    })
  ), [situationLabelMap, situationOrder]);

  const playerSummary = useMemo(() => {
    const rows = new Map();
    for (const s of filteredShots) {
      if (teamMode !== 'both' && s.team_side !== teamMode) continue;
      const key = s.playerKey || `${s.team_side}|${s.playerLabel || 'NA'}`;
      const cur = rows.get(key) || {
        key,
        player: s.playerLabel || 'NA',
        team: s.team_side,
        shots: 0,
        points: 0,
        xpTotal: 0,
        xpCount: 0,
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
      if (Number.isFinite(s.xp)) {
        cur.xpTotal += s.xp;
        cur.xpCount += 1;
      }
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
      xp: r.xpCount ? r.xpTotal : NaN,
      xpPts: r.xpCount ? (r.points - r.xpTotal) : NaN,
      xps: r.xpCount ? r.xpTotal / r.xpCount : NaN,
      avgDist: r.distN ? r.distSum / r.distN : NaN,
    }));
    out.sort((a, b) => b.points - a.points);
    return out;
  }, [filteredShots, teamMode]);
  const [playerSort, setPlayerSort] = useState({ key: 'points', dir: 'desc' });
  const [showAllPlayerShooting, setShowAllPlayerShooting] = useState(false);
  const playerColumns = useMemo(() => ([
    { key: 'player', label: 'Player', sortValue: (r) => r.player },
    { key: 'shots', label: 'Shots', sortValue: (r) => r.shots },
    { key: 'points', label: 'Points', sortValue: (r) => r.points },
    { key: 'xp', label: 'xP', sortValue: (r) => r.xp },
    { key: 'xpPts', label: 'Pts-XP', sortValue: (r) => r.xpPts },
    { key: 'pps', label: 'Pts/Shot', sortValue: (r) => r.pps },
    { key: 'xps', label: 'xP/Shot', sortValue: (r) => r.xps },
    { key: 'avgDist', label: 'Avg Dist', sortValue: (r) => r.avgDist },
    { key: 'pointAtt', label: '1 Point', sortValue: (r) => r.pointAtt },
    { key: 'twoAtt', label: '2 Point', sortValue: (r) => r.twoAtt },
    { key: 'goalAtt', label: 'Goal', sortValue: (r) => r.goalAtt },
  ]), []);
  const sortedPlayerSummary = useMemo(() => sortRows(playerSummary, playerSort, playerColumns, 'key'), [playerSummary, playerSort, playerColumns]);
  const togglePlayerSort = (key) => setPlayerSort((current) => current.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'desc' });
  const simulationShots = useMemo(() => (
    simShots
      .filter((shot) => !shot.broughtBackAdv)
      .filter((shot) => matchesSelectedPlayer(shot))
      .filter((shot) => shotType.length ? shotType.includes(shot.shotType) : true)
      .filter((shot) => situation.length ? situation.includes(shot.situation) : true)
      .filter((shot) => pressure.length ? pressure.includes(shot.pressure) : true)
      .filter((shot) => method.length ? method.includes(shot.method) : true)
      .filter((shot) => scoringAttackTypeFilter !== 'any' ? attackTypeStateKey(shot.attackType) === scoringAttackTypeFilter : true)
      .filter((shot) => Number.isFinite(shot?.xp))
      .map((shot) => ({
        key: shot.id || `${shot.team_side}-${shot.shotType}-${shot.xp}-${shot.time_s ?? ''}`,
        team_side: shot.team_side,
        shotType: shot.shotType,
        xp: shot.xp,
      }))
  ), [simShots, selectedPlayerKeys, shotType, situation, pressure, method, scoringAttackTypeFilter]);
  const winProbabilitySeed = useMemo(
    () => hashSimulationSeed({
      teamMode,
      selectedPlayerKeys: [...selectedPlayerKeys].sort(),
      shotType: [...shotType].sort(),
      situation: [...situation].sort(),
      pressure: [...pressure].sort(),
      method: [...method].sort(),
      scoringAttackTypeFilter,
      shots: simulationShots.map((shot) => [shot.key, shot.team_side, shot.shotType, Number(shot.xp).toFixed(4)]),
    }),
    [teamMode, selectedPlayerKeys, shotType, situation, pressure, method, scoringAttackTypeFilter, simulationShots]
  );
  const winProbabilitySim = useMemo(() => (
    simulateFullMatchFromShots(
      simulationShots,
      10000,
      createSeededRng(winProbabilitySeed),
    )
  ), [simulationShots, winProbabilitySeed]);

  return (
    <div className="space-y-4">
      <div className="report-metric-split items-stretch">
        <ComparisonMetricsCard
          title="Shooting Metrics"
          cardClassName="w-full h-full min-h-[540px]"
          homeTeam={homeTeam}
          awayTeam={awayTeam}
          teamMode={teamMode}
          rows={[
            {
              label: 'Score',
              home: `${kpis.home.goals}:${kpis.home.points1 + (kpis.home.points2 * 2)} (${kpis.home.totalPts})`,
              away: `${kpis.away.goals}:${kpis.away.points1 + (kpis.away.points2 * 2)} (${kpis.away.totalPts})`,
              strong: true,
            },
            { label: 'Expected Points', home: kpis.home.xpCount ? kpis.home.totalXp.toFixed(2) : 'N/A', away: kpis.away.xpCount ? kpis.away.totalXp.toFixed(2) : 'N/A' },
            {
              label: 'Shots',
              home: `${kpis.home.scoresN}/${kpis.home.shotsN} (${formatPct(kpis.home.conv)})`,
              away: `${kpis.away.scoresN}/${kpis.away.shotsN} (${formatPct(kpis.away.conv)})`,
            },
            { label: 'Points Per Shot', home: Number.isFinite(kpis.home.pps) ? kpis.home.pps.toFixed(2) : 'NA', away: Number.isFinite(kpis.away.pps) ? kpis.away.pps.toFixed(2) : 'NA' },
            { label: 'XP / Shot', home: Number.isFinite(kpis.home.xpShot) ? kpis.home.xpShot.toFixed(2) : 'N/A', away: Number.isFinite(kpis.away.xpShot) ? kpis.away.xpShot.toFixed(2) : 'N/A' },
            { label: 'Average Shot Distance', home: Number.isFinite(kpis.home.avgDist) ? kpis.home.avgDist.toFixed(1) : 'NA', away: Number.isFinite(kpis.away.avgDist) ? kpis.away.avgDist.toFixed(1) : 'NA' },
            { label: 'Low Pressure Shots', home: kpis.home.lowPressureShots, away: kpis.away.lowPressureShots },
            { label: 'Shots Short', home: kpis.home.shortN, away: kpis.away.shortN },
          ]}
        />
        <div className="report-companion-grid">
          <WinProbabilityBar
            title="xP win probability"
            sim={winProbabilitySim}
            homeTeam={homeTeam}
            awayTeam={awayTeam}
            homeColor={homeTeam?.color}
            awayColor={awayTeam?.color}
          />
          <PressureConversionChart
            title="Pressure vs Conversion"
            data={teamMode === 'both' ? pressureSummary.both : (teamMode === 'away' ? pressureSummary.away : pressureSummary.home)}
            homeColor={homeTeam?.color}
            awayColor={awayTeam?.color}
            teamMode={teamMode}
          />
        </div>
      </div>

        {mapShots.length === 0 ? (
          <Card className={paneClassName}>
            <CardContent className="p-6 text-sm text-slate-600 text-center">
              No shots available for current filters.
            </CardContent>
          </Card>
        ) : (
          <>
            <Card className={paneClassName}>
              <CardContent className="p-4">
                <ShotMap shots={mapShots} mode={shotMapMode} setMode={setShotMapMode} teamMode={teamMode} homeColor={homeTeam?.color} awayColor={awayTeam?.color} onOpenVideoAt={onOpenVideoAt} />
              </CardContent>
            </Card>

            <div className="grid lg:grid-cols-2 gap-4">
              {teamMode === 'both' ? (
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
                    { key: 'xps', label: 'xP/Shot', align: 'right', render: (r) => Number.isFinite(r.xps) ? r.xps.toFixed(2) : 'NA' },
                  ]}
                />
              ) : (
                <SideBreakdownTable
                  title="Shot Type Breakdown"
                  rows={shotTypeSummary.both}
                  columns={[
                    { key: 'label', label: 'Type', primary: true, render: (r) => r.label },
                    { key: 'attempts', label: 'Attempts', align: 'right', render: (r) => r.attempts },
                    { key: 'conv', label: 'Conv %', align: 'right', render: (r) => formatPct(r.conv) },
                    { key: 'pps', label: 'Pts/Shot', align: 'right', render: (r) => Number.isFinite(r.pps) ? r.pps.toFixed(2) : 'NA' },
                    { key: 'xps', label: 'xP/Shot', align: 'right', render: (r) => Number.isFinite(r.xps) ? r.xps.toFixed(2) : 'NA' },
                  ]}
                />
              )}
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
                  headerAction={<Button type="button" variant="outline" size="sm" className="h-8" onClick={() => setDetailedSituationOpen(true)}>Expand</Button>}
                  columns={[
                    { key: 'attempts', label: 'Attempts', align: 'right', render: (r) => r.attempts },
                    { key: 'conv', label: 'Conv %', align: 'right', render: (r) => formatPct(r.conv) },
                    { key: 'pps', label: 'Pts/Shot', align: 'right', render: (r) => Number.isFinite(r.pps) ? r.pps.toFixed(2) : 'NA' },
                    { key: 'xps', label: 'xP/Shot', align: 'right', render: (r) => Number.isFinite(r.xps) ? r.xps.toFixed(2) : 'NA' },
                  ]}
                />
              ) : (
                <SideBreakdownTable
                  title="Shot Situation Breakdown"
                  rows={situationSummary.both}
                  headerAction={<Button type="button" variant="outline" size="sm" className="h-8" onClick={() => setDetailedSituationOpen(true)}>Expand</Button>}
                  columns={[
                    { key: 'situation', label: 'Situation', primary: true, render: (r) => r.situation },
                    { key: 'attempts', label: 'Attempts', align: 'right', render: (r) => r.attempts },
                    { key: 'conv', label: 'Conv %', align: 'right', render: (r) => formatPct(r.conv) },
                    { key: 'pps', label: 'Pts/Shot', align: 'right', render: (r) => Number.isFinite(r.pps) ? r.pps.toFixed(2) : 'NA' },
                    { key: 'xps', label: 'xP/Shot', align: 'right', render: (r) => Number.isFinite(r.xps) ? r.xps.toFixed(2) : 'NA' },
                  ]}
                />
              )}
            </div>

            <Card className={paneClassName}>
              <CardContent className="p-4 space-y-3">
                <div className="font-semibold text-slate-900">Shot Outcomes</div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Team</TableHead>
                      {shotOutcomeRows.map((row) => (
                        <TableHead key={row.key} className="text-right">{row.label}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(teamMode === 'both' || teamMode === 'home') && (
                      <TableRow>
                        <TableCell className="font-medium">{homeTeam?.name || 'Home'}</TableCell>
                        {shotOutcomeRows.map((row) => (
                          <TableCell key={`home-${row.key}`} className="text-right tabular-nums">{row.home}</TableCell>
                        ))}
                      </TableRow>
                    )}
                    {(teamMode === 'both' || teamMode === 'away') && (
                      <TableRow>
                        <TableCell className="font-medium">{awayTeam?.name || 'Away'}</TableCell>
                        {shotOutcomeRows.map((row) => (
                          <TableCell key={`away-${row.key}`} className="text-right tabular-nums">{row.away}</TableCell>
                        ))}
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Dialog open={detailedSituationOpen} onOpenChange={setDetailedSituationOpen}>
              <DialogContent className="max-w-[95rem]">
                <DialogHeader>
                  <DialogTitle>Detailed Shot Situation Breakdown</DialogTitle>
                </DialogHeader>
                {teamMode === 'both' ? (
                  <CategoryComparisonTable
                    title=""
                    sortable={false}
                    categories={detailedSituationCategories}
                    categoryKey="situation"
                    categoryLabel="Situation"
                    homeLabel={homeTeam?.name || 'Home'}
                    awayLabel={awayTeam?.name || 'Away'}
                    homeRows={detailedSituationSummary.home}
                    awayRows={detailedSituationSummary.away}
                    columns={[
                      { key: 'attempts', label: 'Attempts', align: 'right', render: (r) => r.attempts },
                      { key: 'conv', label: 'Conv %', align: 'right', render: (r) => formatPct(r.conv) },
                      { key: 'pps', label: 'Pts/Shot', align: 'right', render: (r) => Number.isFinite(r.pps) ? r.pps.toFixed(2) : 'NA' },
                      { key: 'xps', label: 'xP/Shot', align: 'right', render: (r) => Number.isFinite(r.xps) ? r.xps.toFixed(2) : 'NA' },
                    ]}
                  />
                ) : (
                  <SideBreakdownTable
                    title=""
                    rows={detailedSituationSummary.both}
                    columns={[
                      { key: 'situation', label: 'Situation', primary: true, render: (r) => r.situation },
                      { key: 'attempts', label: 'Attempts', align: 'right', render: (r) => r.attempts },
                      { key: 'conv', label: 'Conv %', align: 'right', render: (r) => formatPct(r.conv) },
                      { key: 'pps', label: 'Pts/Shot', align: 'right', render: (r) => Number.isFinite(r.pps) ? r.pps.toFixed(2) : 'NA' },
                      { key: 'xps', label: 'xP/Shot', align: 'right', render: (r) => Number.isFinite(r.xps) ? r.xps.toFixed(2) : 'NA' },
                    ]}
                  />
                )}
              </DialogContent>
            </Dialog>

            <Card className={paneClassName}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-semibold text-slate-900">Player Shooting</div>
                  {sortedPlayerSummary.length > 8 ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 w-[108px] px-2 text-xs"
                      onClick={() => setShowAllPlayerShooting((current) => !current)}
                    >
                      {showAllPlayerShooting ? 'Show Top 8' : 'Expand Table'}
                    </Button>
                  ) : null}
                </div>
                <Table className="table-fixed w-full">
                  <colgroup>
                    <col style={{ width: '230px' }} />
                    <col style={{ width: '74px' }} />
                    <col style={{ width: '74px' }} />
                    <col style={{ width: '82px' }} />
                    <col style={{ width: '90px' }} />
                    <col style={{ width: '92px' }} />
                    <col style={{ width: '92px' }} />
                    <col style={{ width: '90px' }} />
                    <col style={{ width: '86px' }} />
                    <col style={{ width: '86px' }} />
                    <col style={{ width: '86px' }} />
                  </colgroup>
                  <TableHeader>
                    <TableRow>
                      {playerColumns.map((column) => (
                        <SortableTableHead
                          key={column.key}
                          column={column}
                          sortState={playerSort}
                          onToggle={togglePlayerSort}
                          className={column.key === 'player'
                            ? 'whitespace-nowrap px-3 py-2 text-left align-middle'
                            : 'whitespace-nowrap px-2 py-2 text-center align-middle'}
                        />
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(showAllPlayerShooting ? sortedPlayerSummary : sortedPlayerSummary.slice(0, 8)).map((r) => (
                      <TableRow key={r.key} style={teamRowTint(r.team, homeTeam?.color, awayTeam?.color, 0.07)}>
                        <TableCell className="px-3 py-2.5 text-left align-middle font-medium">{r.player}</TableCell>
                        <TableCell className="whitespace-nowrap px-2 py-2.5 text-center align-middle tabular-nums">{r.shots}</TableCell>
                        <TableCell className="whitespace-nowrap px-2 py-2.5 text-center align-middle tabular-nums">{r.points}</TableCell>
                        <TableCell className="whitespace-nowrap px-2 py-2.5 text-center align-middle tabular-nums">{Number.isFinite(r.xp) ? r.xp.toFixed(2) : 'NA'}</TableCell>
                        <TableCell className="whitespace-nowrap px-2 py-2.5 text-center align-middle tabular-nums" style={ptsXpCellStyle(r.xpPts)}>{Number.isFinite(r.xpPts) ? r.xpPts.toFixed(2) : 'NA'}</TableCell>
                        <TableCell className="whitespace-nowrap px-2 py-2.5 text-center align-middle tabular-nums">{Number.isFinite(r.pps) ? r.pps.toFixed(2) : 'NA'}</TableCell>
                        <TableCell className="whitespace-nowrap px-2 py-2.5 text-center align-middle tabular-nums">{Number.isFinite(r.xps) ? r.xps.toFixed(2) : 'NA'}</TableCell>
                        <TableCell className="whitespace-nowrap px-2 py-2.5 text-center align-middle tabular-nums">{Number.isFinite(r.avgDist) ? r.avgDist.toFixed(1) : 'NA'}</TableCell>
                        <TableCell className="whitespace-nowrap px-2 py-2.5 text-center align-middle tabular-nums">{r.pointMade}/{r.pointAtt}</TableCell>
                        <TableCell className="whitespace-nowrap px-2 py-2.5 text-center align-middle tabular-nums">{r.twoMade}/{r.twoAtt}</TableCell>
                        <TableCell className="whitespace-nowrap px-2 py-2.5 text-center align-middle tabular-nums">{r.goalMade}/{r.goalAtt}</TableCell>
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

