import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ChartContainer, ChartTooltipContent } from '@/components/ui/chart';
import { BarChart, Bar, CartesianGrid, Legend, LineChart, Line, PieChart, Pie, Cell, Tooltip, ReferenceLine, XAxis, YAxis } from 'recharts';
import pitchImg from '@/assets/pitch.png';
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
  getPossessionTimeSummary,
  getProgressiveMeters,
  getScoringZoneEntry,
  getSetDefenceValue,
  getDerivedPossessionDurationSeconds,
  isDeadBallGapStart,
  isAttackPossession,
  shouldExcludeFromTotals,
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
  inferPossessionStartSource,
  selectionKey,
  normalizePlayerRef,
  ComparisonMetricsCard,
  MultiSelect,
  MatchTimeRangeSlider,
  RangeSliderField,
  DirectionBadge,
  teamRowTint,
  PitchViz,
  AttackChannelPitch,
  PassNetwork,
  buildPassSonarData,
  getPassMethodColor,
  ShotMap,
  shotSideFromY,
  shotZoneFromDistance,
  applyNonTeamReportFilters,
} from '../shared';

function getActionDistance(stat) {
  const sx = Number(stat?.x_position);
  const sy = Number(stat?.y_position);
  const ex = Number(stat?.end_x_position);
  const ey = Number(stat?.end_y_position);
  if (![sx, sy, ex, ey].every(Number.isFinite)) return NaN;
  return Math.sqrt(((ex - sx) ** 2) + ((ey - sy) ** 2));
}

function getThirdLabel(x) {
  const xx = Number(x);
  if (!Number.isFinite(xx)) return 'NA';
  if (xx < PITCH_W / 3) return 'Defensive Third';
  if (xx < (2 * PITCH_W) / 3) return 'Middle Third';
  return 'Attacking Third';
}

function normalizeDistanceRange({ min, max, maxDistance }) {
  const upperBound = Math.max(1, Number(maxDistance) || 1);
  const minValue = Number.isFinite(Number(min)) && String(min ?? '') !== '' ? Math.max(0, Number(min)) : 0;
  const maxValue = Number.isFinite(Number(max)) && String(max ?? '') !== '' ? Math.min(upperBound, Number(max)) : upperBound;
  return minValue <= maxValue ? [minValue, maxValue] : [maxValue, minValue];
}

function filterActionsByDistance(stat, { min, max }) {
  const distance = getActionDistance(stat);
  if (!Number.isFinite(distance)) return false;
  if (min != null && distance < min) return false;
  if (max != null && distance > max) return false;
  return true;
}

function getRecipientSelectionForBuildUp(stat, extra) {
  if (stat?.stat_type !== 'pass') return null;
  return extra?.pass?.intended_recipient?.kind === 'player'
    ? extra.pass.intended_recipient
    : (extra?.pass?.won_by?.kind === 'player' ? extra.pass.won_by : getCompletedReceiptSelection(stat, extra));
}

function canonicalizeCombinationKey(ids) {
  return (Array.isArray(ids) ? ids : [])
    .map((id) => String(id || '').trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
    .join('|');
}

function buildUnorderedCombinations(ids, size) {
  const list = Array.isArray(ids) ? ids : [];
  if (!Number.isInteger(size) || size <= 0 || list.length < size) return [];
  const output = [];
  const walk = (start, acc) => {
    if (acc.length === size) {
      output.push(acc.slice());
      return;
    }
    for (let i = start; i <= list.length - (size - acc.length); i += 1) {
      acc.push(list[i]);
      walk(i + 1, acc);
      acc.pop();
    }
  };
  walk(0, []);
  return output;
}

function getCompletedPassLink(stat, side, playerLookup = new Map(), hiddenPlayerIds = null) {
  if (!stat || stat.stat_type !== 'pass') return null;
  const extra = safeParseJSON(stat.extra_data || '{}', {});
  if (extra?.pass?.outcome !== 'completed') return null;
  const passer = normalizePlayerRef(extra?.pass?.passer);
  const receiver = normalizePlayerRef(extra?.pass?.won_by?.kind === 'player' ? extra.pass.won_by : getCompletedReceiptSelection(stat, extra));
  if (!passer?.id || !receiver?.id || passer.id === receiver.id) return null;
  if (passer.team_side !== side || receiver.team_side !== side) return null;
  const hiddenSet = hiddenPlayerIds instanceof Set ? hiddenPlayerIds : new Set(Array.isArray(hiddenPlayerIds) ? hiddenPlayerIds : []);
  if (hiddenSet.has(passer.id) || hiddenSet.has(receiver.id)) return null;
  const withFallback = (player) => {
    const lookup = playerLookup.get(player.id) || {};
    return {
      id: player.id,
      number: player.number ?? lookup.number ?? null,
      name: player.name || lookup.name || lookup.label || '',
    };
  };
  return {
    passer: withFallback(passer),
    receiver: withFallback(receiver),
    stat,
  };
}

function getPassConnectedPlayersForUnit(unitStats, side, playerLookup = new Map(), hiddenPlayerIds = null) {
  const adjacency = new Map();
  const members = new Map();
  (Array.isArray(unitStats) ? unitStats : []).forEach((stat) => {
    const link = getCompletedPassLink(stat, side, playerLookup, hiddenPlayerIds);
    if (!link) return;
    const a = String(link.passer.id);
    const b = String(link.receiver.id);
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a).add(b);
    adjacency.get(b).add(a);
    if (!members.has(a)) members.set(a, link.passer);
    if (!members.has(b)) members.set(b, link.receiver);
  });

  const seen = new Set();
  const components = [];
  adjacency.forEach((_, id) => {
    if (seen.has(id)) return;
    const stack = [id];
    const component = [];
    seen.add(id);
    while (stack.length) {
      const current = stack.pop();
      component.push(members.get(current) || { id: current, number: null, name: '' });
      (adjacency.get(current) || []).forEach((next) => {
        if (seen.has(next)) return;
        seen.add(next);
        stack.push(next);
      });
    }
    components.push(component);
  });
  return components;
}

function formatCombinationPlayer(member) {
  const name = String(member?.name || '').trim();
  const shortName = name ? (name.split(/\s+/).filter(Boolean).slice(-1)[0] || name) : '';
  return shortName || name || 'Player';
}

function buildTeamPassCombinationCounts(stats, side, size, playerLookup = new Map(), hiddenPlayerIds = null) {
  const counts = new Map();
  const record = (members) => {
    const canonicalIds = canonicalizeCombinationKey(members.map((member) => member?.id));
    if (!canonicalIds) return;
    const existing = counts.get(canonicalIds);
    if (existing) {
      existing.count += 1;
      return;
    }
    const orderedIds = canonicalIds.split('|');
    const memberById = new Map(members.map((member) => [String(member.id), member]));
    counts.set(canonicalIds, {
      key: canonicalIds,
      ids: orderedIds,
      members: orderedIds.map((id) => memberById.get(id) || {
        id,
        number: playerLookup.get(id)?.number ?? null,
        name: playerLookup.get(id)?.name || playerLookup.get(id)?.label || '',
      }),
      count: 1,
    });
  };

  if (size === 2) {
    (Array.isArray(stats) ? stats : []).forEach((stat) => {
      const link = getCompletedPassLink(stat, side, playerLookup, hiddenPlayerIds);
      if (!link) return;
      record([link.passer, link.receiver]);
    });
  } else {
    const possessionGroups = groupByPossession(Array.isArray(stats) ? stats : []);
    possessionGroups.forEach((unitStats, key) => {
      if (!String(key).startsWith(`${side}-`)) return;
      const components = getPassConnectedPlayersForUnit(unitStats, side, playerLookup, hiddenPlayerIds);
      components.forEach((component) => {
        if (component.length < size) return;
        const orderedIds = canonicalizeCombinationKey(component.map((member) => member.id)).split('|');
        const componentMembers = orderedIds.map((id) => component.find((member) => String(member.id) === id) || {
          id,
          number: playerLookup.get(id)?.number ?? null,
          name: playerLookup.get(id)?.name || playerLookup.get(id)?.label || '',
        });
        buildUnorderedCombinations(componentMembers, size).forEach((combo) => record(combo));
      });
    });
  }

  return Array.from(counts.values())
    .sort((a, b) => (b.count - a.count) || a.key.localeCompare(b.key, undefined, { numeric: true, sensitivity: 'base' }))
    .map((row, index) => ({
      ...row,
      rank: index + 1,
      label: row.members.map((member) => formatCombinationPlayer(member)).join(' + '),
    }));
}

function PlayerCombinationsPane({ stats, side, teamLabel, teamColor, hiddenPlayerIds = null, playerLookup = new Map(), title = 'Player Combinations' }) {
  const [size, setSize] = useState(2);
  const [showAllRows, setShowAllRows] = useState(false);
  const sizeOptions = [
    { key: 2, label: '2 Players' },
    { key: 3, label: '3 Players' },
    { key: 4, label: '4 Players' },
  ];

  const rows = useMemo(
    () => buildTeamPassCombinationCounts(stats, side, size, playerLookup, hiddenPlayerIds),
    [stats, side, size, playerLookup, hiddenPlayerIds],
  );
  const displayedRows = useMemo(() => (showAllRows ? rows : rows.slice(0, 8)), [rows, showAllRows]);

  useEffect(() => {
    setShowAllRows(false);
  }, [size, side]);

  const emptyLabel = `${teamLabel || toTitleCase(side)} - No ${size}-player passing combinations found for current filters.`;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-semibold text-slate-900">{title}</div>
          <div className="text-xs text-slate-500">{teamLabel || toTitleCase(side)} passing links</div>
        </div>
        <div className="inline-flex rounded-xl bg-slate-100 p-1">
          {sizeOptions.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setSize(option.key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                size === option.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {rows.length ? (
        <div className="space-y-2">
          <div className="flex items-center justify-end">
            {rows.length > 8 ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 px-2 text-xs"
                onClick={() => setShowAllRows((current) => !current)}
              >
                {showAllRows ? 'Show Top 8' : 'View Full Table'}
              </Button>
            ) : null}
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[68px]">Rank</TableHead>
                <TableHead>Combination</TableHead>
                <TableHead className="text-right">Count</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayedRows.map((row, index) => (
                <TableRow key={row.key} style={teamRowTint(side, side === 'home' ? teamColor : null, side === 'away' ? teamColor : null, index % 2 === 0 ? 0.06 : 0.11)}>
                  <TableCell className="font-medium text-slate-600">{row.rank}</TableCell>
                  <TableCell className="font-medium">{row.label}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.count}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
          {emptyLabel}
        </div>
      )}
    </div>
  );
}

function PlayerCombinationsSection({ stats, homeTeam, awayTeam, homeColor, awayColor, playerLookup, hiddenHomePlayerIds = null, hiddenAwayPlayerIds = null }) {
  return (
    <Card className="border-2 border-slate-400 bg-gradient-to-br from-slate-50 via-white to-white shadow-md">
      <CardContent className="p-4 space-y-3">
        <div className="font-semibold text-slate-900">Player Combinations</div>
        <div className="grid gap-4 lg:grid-cols-2">
          <PlayerCombinationsPane
            stats={stats}
            side="home"
            title={homeTeam?.name || 'Home'}
            teamLabel={homeTeam?.name || 'Home'}
            teamColor={homeColor || '#2563eb'}
            hiddenPlayerIds={hiddenHomePlayerIds}
            playerLookup={playerLookup}
          />
          <PlayerCombinationsPane
            stats={stats}
            side="away"
            title={awayTeam?.name || 'Away'}
            teamLabel={awayTeam?.name || 'Away'}
            teamColor={awayColor || '#ef4444'}
            hiddenPlayerIds={hiddenAwayPlayerIds}
            playerLookup={playerLookup}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function getLivePossessionStartAnchor(previousStat, startSource, match, imputedMap) {
  if (!previousStat || isDeadBallGapStart(previousStat)) return NaN;
  const source = String(startSource || '');
  const allowedSource =
    source === 'Turnover Won'
    || source === 'Shot Short'
    || source === 'Shot Blocked'
    || source === 'Shot Post'
    || source === 'Shot Saved';
  if (!allowedSource) return NaN;

  const previousTeam =
    previousStat?.possession_team_side === 'home' || previousStat?.possession_team_side === 'away'
      ? previousStat.possession_team_side
      : previousStat?.team_side;
  const terminal = classifyTerminalOutcome(previousStat, previousTeam);
  const isMatchingTerminal =
    (source === 'Turnover Won' && terminal === 'TURNOVER')
    || (source === 'Shot Short' && terminal === 'SHORT')
    || (source === 'Shot Blocked' && terminal === 'BLOCKED')
    || (source === 'Shot Post' && terminal === 'POST')
    || (source === 'Shot Saved' && terminal === 'SAVED');
  if (!isMatchingTerminal) return NaN;
  return getMatchTimeS(previousStat, match, imputedMap);
}

const BUILD_UP_HEATMAP_SAMPLE_THRESHOLD = 4;
const BUILD_UP_HEATMAP_MODES = [
  { key: 'activity', label: 'Activity', subtitle: 'Build-up pass touch volume by zone' },
  { key: 'hand_kick', label: 'Hand : Kick', subtitle: 'Handpass vs kickpass balance by zone' },
  { key: 'pass_carry', label: 'Pass : Carry', subtitle: 'Pass vs carry balance by zone' },
];

function getHeatmapZoneIndex(x, y, cols, rows) {
  const xx = Number(x);
  const yy = Number(y);
  if (!Number.isFinite(xx) || !Number.isFinite(yy)) return null;
  const col = Math.max(0, Math.min(cols - 1, Math.floor((xx / PITCH_W) * cols)));
  const row = Math.max(0, Math.min(rows - 1, Math.floor((yy / PITCH_H) * rows)));
  return { row, col };
}

function createHeatmapGrid(cols, rows, factory) {
  return Array.from({ length: rows }, (_, row) => (
    Array.from({ length: cols }, (_, col) => factory(row, col))
  ));
}

function getHeatmapCellDisplayValue(cell, mode) {
  if (mode === 'activity') return cell.activityCount || 0;
  return Number.isFinite(cell.share) ? `${(cell.share * 100).toFixed(0)}%` : 'NA';
}

function getHeatmapTooltipData(cell, mode) {
  if (mode === 'activity') {
    return [
      cell.zoneLabel,
      `Activity count: ${cell.activityCount || 0}`,
      'Current activity mode counts pass touches by zone (pass start + end points).',
    ];
  }
  if (mode === 'hand_kick') {
    return [
      cell.zoneLabel,
      `Handpasses: ${cell.handCount || 0}`,
      `Kickpasses: ${cell.kickCount || 0}`,
      `Total relevant actions: ${cell.total || 0}`,
      `Hand share: ${Number.isFinite(cell.share) ? (cell.share * 100).toFixed(1) : 'NA'}%`,
      cell.isLowSample ? `Low sample: fewer than ${BUILD_UP_HEATMAP_SAMPLE_THRESHOLD} relevant actions` : null,
    ].filter(Boolean);
  }
  return [
    cell.zoneLabel,
    `Passes: ${cell.passCount || 0}`,
    `Carries: ${cell.carryCount || 0}`,
    `Total relevant actions: ${cell.total || 0}`,
    `Pass share: ${Number.isFinite(cell.share) ? (cell.share * 100).toFixed(1) : 'NA'}%`,
    cell.isLowSample ? `Low sample: fewer than ${BUILD_UP_HEATMAP_SAMPLE_THRESHOLD} relevant actions` : null,
  ].filter(Boolean);
}

function buildActivityHeatmapData(stats, side, cols, rows) {
  const grid = createHeatmapGrid(cols, rows, (row, col) => ({
    row,
    col,
    zoneLabel: `Zone ${row + 1}-${col + 1}`,
    activityCount: 0,
  }));

  for (const stat of Array.isArray(stats) ? stats : []) {
    // Preserve current heatmap behavior: activity is pass touches, counting both
    // pass origin and pass receipt/end locations by zone.
    if (!stat || stat.stat_type !== 'pass' || stat.team_side !== side) continue;
    const points = [
      [Number(stat.x_position), Number(stat.y_position)],
      [Number(stat.end_x_position), Number(stat.end_y_position)],
    ];
    for (const [x, y] of points) {
      const zone = getHeatmapZoneIndex(x, y, cols, rows);
      if (!zone) continue;
      grid[zone.row][zone.col].activityCount += 1;
    }
  }

  return grid;
}

function buildHandKickHeatmapData(stats, side, cols, rows) {
  const grid = createHeatmapGrid(cols, rows, (row, col) => ({
    row,
    col,
    zoneLabel: `Zone ${row + 1}-${col + 1}`,
    handCount: 0,
    kickCount: 0,
    total: 0,
    share: NaN,
    isLowSample: false,
  }));

  for (const stat of Array.isArray(stats) ? stats : []) {
    if (!stat || stat.stat_type !== 'pass' || stat.team_side !== side) continue;
    const zone = getHeatmapZoneIndex(stat.x_position, stat.y_position, cols, rows);
    if (!zone) continue;
    const extra = safeParseJSON(stat.extra_data || '{}', {});
    const method = String(extra?.pass?.method || '').toLowerCase();
    if (method === 'hand') grid[zone.row][zone.col].handCount += 1;
    if (method === 'left' || method === 'right') grid[zone.row][zone.col].kickCount += 1;
  }

  return grid.map((row) => row.map((cell) => {
    const total = cell.handCount + cell.kickCount;
    return {
      ...cell,
      total,
      share: total ? (cell.handCount / total) : NaN,
      isLowSample: total < BUILD_UP_HEATMAP_SAMPLE_THRESHOLD,
    };
  }));
}

function buildPassCarryHeatmapData(stats, side, cols, rows) {
  const grid = createHeatmapGrid(cols, rows, (row, col) => ({
    row,
    col,
    zoneLabel: `Zone ${row + 1}-${col + 1}`,
    passCount: 0,
    carryCount: 0,
    total: 0,
    share: NaN,
    isLowSample: false,
  }));

  for (const stat of Array.isArray(stats) ? stats : []) {
    if (!stat || stat.team_side !== side || (stat.stat_type !== 'pass' && stat.stat_type !== 'carry')) continue;
    const zone = getHeatmapZoneIndex(stat.x_position, stat.y_position, cols, rows);
    if (!zone) continue;
    if (stat.stat_type === 'pass') grid[zone.row][zone.col].passCount += 1;
    if (stat.stat_type === 'carry') grid[zone.row][zone.col].carryCount += 1;
  }

  return grid.map((row) => row.map((cell) => {
    const total = cell.passCount + cell.carryCount;
    return {
      ...cell,
      total,
      share: total ? (cell.passCount / total) : NaN,
      isLowSample: total < BUILD_UP_HEATMAP_SAMPLE_THRESHOLD,
    };
  }));
}

function buildBuildUpHeatmapData(stats, side, mode, cols, rows) {
  if (mode === 'hand_kick') return buildHandKickHeatmapData(stats, side, cols, rows);
  if (mode === 'pass_carry') return buildPassCarryHeatmapData(stats, side, cols, rows);
  return buildActivityHeatmapData(stats, side, cols, rows);
}

function mixChannelColor(lowRgb, highRgb, ratio) {
  const t = Math.max(0, Math.min(1, ratio));
  const r = Math.round(lowRgb[0] + ((highRgb[0] - lowRgb[0]) * t));
  const g = Math.round(lowRgb[1] + ((highRgb[1] - lowRgb[1]) * t));
  const b = Math.round(lowRgb[2] + ((highRgb[2] - lowRgb[2]) * t));
  return [r, g, b];
}

function getBuildUpHeatmapModeNote(mode) {
  if (mode === 'hand_kick') {
    return 'Colour key: red zones are more handpass-heavy, blue zones are more kickpass-heavy, purple zones are more balanced, and grey zones are low-sample.';
  }
  if (mode === 'pass_carry') {
    return 'Colour key: amber zones are more carry-heavy, blue zones are more pass-heavy, and grey zones are low-sample.';
  }
  return 'Colour key: deeper shading means more build-up activity in that zone.';
}

function BuildUpHeatmapPane({ title, stats, side, teamColor, mode }) {
  const cols = 6;
  const rows = 5;
  const heatmap = useMemo(() => buildBuildUpHeatmapData(stats, side, mode, cols, rows), [stats, side, mode]);
  const modeMeta = BUILD_UP_HEATMAP_MODES.find((entry) => entry.key === mode) || BUILD_UP_HEATMAP_MODES[0];
  const maxActivity = Math.max(1, ...heatmap.flat().map((cell) => cell.activityCount || 0));

  const fillFor = (cell) => {
    if (mode === 'activity') {
      if (!cell.activityCount) return 'rgba(255,255,255,0.05)';
      const alpha = 0.18 + ((cell.activityCount / maxActivity) * 0.72);
      const value = String(teamColor || '#2563eb').trim();
      if (!value.startsWith('#')) return `rgba(37,99,235,${alpha})`;
      const hex = value.slice(1);
      const normalized = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
      const int = Number.parseInt(normalized, 16);
      if (!Number.isFinite(int)) return `rgba(37,99,235,${alpha})`;
      const r = (int >> 16) & 255;
      const g = (int >> 8) & 255;
      const b = int & 255;
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    if (cell.isLowSample || !Number.isFinite(cell.share)) return 'rgba(148,163,184,0.28)';
    if (mode === 'hand_kick') {
      const hex = getPassMethodColor(1 - cell.share);
      const normalized = String(hex || '').replace('#', '');
      const expanded = normalized.length === 3 ? normalized.split('').map((c) => c + c).join('') : normalized;
      const int = Number.parseInt(expanded, 16);
      if (Number.isFinite(int)) {
        const r = (int >> 16) & 255;
        const g = (int >> 8) & 255;
        const b = int & 255;
        return `rgba(${r}, ${g}, ${b}, 0.76)`;
      }
    }
    const [r, g, b] = mixChannelColor([245, 158, 11], [37, 99, 235], cell.share);
    return `rgba(${r}, ${g}, ${b}, 0.72)`;
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="w-full">
        <div className="mb-2">
          <div className="font-semibold text-slate-900">{title}</div>
          <div className="text-xs text-slate-500">{modeMeta.subtitle}</div>
        </div>
        <div
          className="relative mx-auto overflow-hidden rounded-xl border border-slate-200"
          style={{
            width: '73%',
            aspectRatio: `${PITCH_W} / ${PITCH_H}`,
            backgroundImage: `url(${pitchImg})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        >
          <DirectionBadge label="Attacking ->" />
          <svg className="absolute inset-0 w-full h-full" viewBox={`-3 -3 ${PITCH_W + 6} ${PITCH_H + 6}`} preserveAspectRatio="none">
            {heatmap.map((line, rowIndex) => line.map((cell, colIndex) => {
              const x = (colIndex * PITCH_W) / cols;
              const y = (rowIndex * PITCH_H) / rows;
              const width = PITCH_W / cols;
              const height = PITCH_H / rows;
              return (
                <g key={`${rowIndex}-${colIndex}`}>
                  <title>{getHeatmapTooltipData(cell, mode).join('\n')}</title>
                  <rect
                    x={x}
                    y={y}
                    width={width}
                    height={height}
                    fill={fillFor(cell)}
                    stroke="rgba(255,255,255,0.18)"
                    strokeWidth="0.2"
                  />
                </g>
              );
            }))}
          </svg>
        </div>
      </div>
    </div>
  );
}

function BuildUpHeatmapSection({ stats, teamMode, homeTeam, awayTeam, homeColor, awayColor }) {
  const [mode, setMode] = useState('activity');
  const modeMeta = BUILD_UP_HEATMAP_MODES.find((entry) => entry.key === mode) || BUILD_UP_HEATMAP_MODES[0];
  const teams = teamMode === 'both'
    ? [
        { title: `${homeTeam?.name || 'Home'} Build-Up Heatmap`, side: 'home', color: homeColor || '#2563eb' },
        { title: `${awayTeam?.name || 'Away'} Build-Up Heatmap`, side: 'away', color: awayColor || '#ef4444' },
      ]
    : [
        {
          title: `${teamMode === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home')} Build-Up Heatmap`,
          side: teamMode === 'away' ? 'away' : 'home',
          color: teamMode === 'away' ? (awayColor || '#ef4444') : (homeColor || '#2563eb'),
        },
      ];

  return (
    <Card className="border-2 border-slate-400 bg-gradient-to-br from-slate-50 via-white to-white shadow-md">
      <CardContent className="p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="font-semibold text-slate-900">Build-Up Heatmap</div>
          <div className="inline-flex rounded-xl bg-slate-100 p-1">
            {BUILD_UP_HEATMAP_MODES.map((option) => {
              const active = option.key === mode;
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setMode(option.key)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className={teamMode === 'both' ? 'grid gap-4 lg:grid-cols-2' : ''}>
          {teams.map((team) => (
            <BuildUpHeatmapPane
              key={team.side}
              title={team.title}
              stats={stats}
              side={team.side}
              teamColor={team.color}
              mode={mode}
            />
          ))}
        </div>
        <div className="text-[11px] leading-4 text-slate-500">
          {modeMeta.label}: {getBuildUpHeatmapModeNote(mode)}
        </div>
      </CardContent>
    </Card>
  );
}

function describeSectorVertical(cx, cy, innerR, outerR, startAngle, endAngle) {
  const toPoint = (radius, angle) => ({
    x: cx + (radius * Math.sin(angle)),
    y: cy - (radius * Math.cos(angle)),
  });
  const startOuter = toPoint(outerR, startAngle);
  const endOuter = toPoint(outerR, endAngle);
  const startInner = toPoint(innerR, endAngle);
  const endInner = toPoint(innerR, startAngle);
  const span = ((endAngle - startAngle) + (Math.PI * 2)) % (Math.PI * 2);
  const largeArc = span > Math.PI ? 1 : 0;
  return [
    `M ${startOuter.x} ${startOuter.y}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 1 ${endOuter.x} ${endOuter.y}`,
    `L ${startInner.x} ${startInner.y}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${endInner.x} ${endInner.y}`,
    'Z',
  ].join(' ');
}

function SonarZoneCard({ zone, title, bare = false }) {
  const size = 260;
  const cx = size / 2;
  const cy = size / 2;
  const maxCount = Math.max(1, ...(zone?.buckets || []).map((bucket) => bucket.count));
  return (
    <div className={bare ? 'p-1' : 'rounded-xl border border-slate-200 bg-white p-4'}>
      <div className="mb-2">
        <div className="font-medium text-slate-900">{title}</div>
        <div className="text-xs text-slate-500">{zone?.total || 0} passes</div>
      </div>
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-[240px] mx-auto">
        {[0.25, 0.5, 0.75, 1].map((ratio) => (
          <circle
            key={ratio}
            cx={cx}
            cy={cy}
                    r={82 * ratio}
            fill="none"
            stroke="rgba(148,163,184,0.35)"
            strokeWidth="1"
          />
        ))}
        {(zone?.buckets || []).map((bucket) => {
          const startAngle = (bucket.index / zone.buckets.length) * Math.PI * 2;
          const endAngle = ((bucket.index + 1) / zone.buckets.length) * Math.PI * 2;
                  const outerR = 18 + ((bucket.count / maxCount) * 64);
          const path = describeSectorVertical(cx, cy, 10, outerR, startAngle, endAngle);
          const mixLabel = Number.isFinite(bucket.kickShare) ? `${(bucket.kickShare * 100).toFixed(0)}% kick` : 'mixed / unknown';
          return (
            <path key={bucket.index} d={path} fill={bucket.color} opacity={bucket.count ? 0.92 : 0.15} stroke="rgba(15,23,42,0.35)" strokeWidth="1">
              <title>{`Direction ${bucket.index + 1}\nPasses: ${bucket.count}\nKickpasses: ${bucket.kickCount}\nHandpasses: ${bucket.handCount}\nMix: ${mixLabel}`}</title>
            </path>
          );
        })}
        <text x={cx} y={18} textAnchor="middle" fontSize="11" fontWeight="700" fill="#475569">Toward Goal</text>
        <text x={size - 28} y={cy + 4} textAnchor="start" fontSize="11" fontWeight="700" fill="#475569">Right</text>
        <text x={28} y={cy + 4} textAnchor="end" fontSize="11" fontWeight="700" fill="#475569">Left</text>
        <text x={cx} y={size - 10} textAnchor="middle" fontSize="11" fontWeight="700" fill="#475569">Back</text>
      </svg>
    </div>
  );
}

function PassSonarComparisonCard({ homeTeam, awayTeam, homeZones, awayZones }) {
  const zoneOrder = ['Attacking Third', 'Middle Third', 'Defensive Third'];
  const homeByZone = new Map((homeZones || []).map((zone) => [zone.zone, zone]));
  const awayByZone = new Map((awayZones || []).map((zone) => [zone.zone, zone]));

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="font-semibold text-slate-900">Pass Sonars</div>
        <div className="grid gap-4">
          {zoneOrder.map((zoneName) => (
            <div key={zoneName} className="grid gap-4 lg:grid-cols-2">
              <SonarZoneCard zone={homeByZone.get(zoneName)} title={`${homeTeam?.name || 'Home'} ${zoneName}`} />
              <SonarZoneCard zone={awayByZone.get(zoneName)} title={`${awayTeam?.name || 'Away'} ${zoneName}`} />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function TeamPassSonarCard({ title, zones, defaultZone = 'Overall' }) {
  const [activeZone, setActiveZone] = useState(defaultZone);
  const zoneOptions = useMemo(() => ([
    { key: 'Overall', label: 'Overall' },
    { key: 'Defensive Third', label: 'Def 1/3' },
    { key: 'Middle Third', label: 'Mid 1/3' },
    { key: 'Attacking Third', label: 'Final 1/3' },
  ]).filter((option) => zones.some((zone) => zone.zone === option.key)), [zones]);

  useEffect(() => {
    if (!zoneOptions.length) return;
    if (!zoneOptions.some((option) => option.key === activeZone)) {
      setActiveZone(zoneOptions[0].key);
    }
  }, [zoneOptions, activeZone]);

  const zone = zones.find((entry) => entry.zone === activeZone)
    || (zoneOptions.length
      ? (zones.find((entry) => entry.zone === zoneOptions[0]?.key) || { zone: zoneOptions[0]?.key, total: 0, buckets: [] })
      : { zone: activeZone, total: 0, buckets: [] });

  return (
    <Card className="h-full border-2 border-slate-400 bg-gradient-to-br from-slate-50 via-white to-white shadow-md">
      <CardContent className="flex h-full flex-col p-4 space-y-2.5">
        <div className="font-semibold text-slate-900">{title}</div>
        <div className="flex-1">
          <SonarZoneCard bare zone={zone} title={activeZone === 'Overall' ? 'Overall' : zoneOptions.find((option) => option.key === activeZone)?.label || activeZone} />
        </div>
        <div className="-mt-1 grid grid-cols-4 gap-2">
          {zoneOptions.map((option) => (
            <Button
              key={option.key}
              type="button"
              variant={activeZone === option.key ? 'default' : 'outline'}
              size="sm"
              className="h-8 min-w-0 px-2 text-xs"
              onClick={() => setActiveZone(option.key)}
            >
              {option.label}
            </Button>
          ))}
        </div>
        <div className="min-h-[28px] text-center text-[11px] leading-4 text-slate-500">
          Red = more handpass-heavy, blue = more kickpass-heavy, purple = balanced mix.
        </div>
      </CardContent>
    </Card>
  );
}

function BuildUpTab({
  stats,
  homeTeam,
  awayTeam,
  playerOptions,
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
  pnHalf,
  setPnHalf,
  onOpenVideoAt,
}) {
  const paneClassName = 'border-2 border-slate-400 bg-gradient-to-br from-slate-50 via-white to-white shadow-md';
  const scopedReportFilters = useMemo(() => ({ ...reportFilters, allowedActionTypes: ['pass', 'carry'] }), [reportFilters]);
  const base = useMemo(() => applyNonTeamReportFilters(stats, scopedReportFilters), [stats, scopedReportFilters]);
  const calcBase = useMemo(() => base.filter((s) => !shouldExcludeFromTotals(s)), [base]);
  const teamMode = String(reportFilters?.team || 'both');
  const events = useMemo(() => base.filter((s) => s && (s.stat_type === 'pass' || s.stat_type === 'carry')), [base]);
  const [mapTeam, setMapTeam] = useState(String(reportFilters?.team || 'both'));
  const [mapHalves, setMapHalves] = useState(Array.isArray(reportFilters?.halves) ? reportFilters.halves : []);
  const [mapTimeMin, setMapTimeMin] = useState(String(reportFilters?.timeMin ?? ''));
  const [mapTimeMax, setMapTimeMax] = useState(String(reportFilters?.timeMax ?? ''));
  const [mapPlayerIds, setMapPlayerIds] = useState(Array.isArray(reportFilters?.playerIds) ? reportFilters.playerIds : []);
  const [mapEventTypes, setMapEventTypes] = useState(Array.isArray(eventTypes) ? eventTypes : []);
  const [mapPressure, setMapPressure] = useState(Array.isArray(pressure) ? pressure : []);
  const [mapOutcome, setMapOutcome] = useState(Array.isArray(outcome) ? outcome : []);
  const [mapProgressiveFilter, setMapProgressiveFilter] = useState(progressiveOnly ? ['yes'] : []);
  const [mapDistanceMin, setMapDistanceMin] = useState('');
  const [mapDistanceMax, setMapDistanceMax] = useState('');
  const [mapOriginZones, setMapOriginZones] = useState([]);
  const [mapEndZones, setMapEndZones] = useState([]);
  const [mapAccuracy, setMapAccuracy] = useState([]);
  const [mapSetDefence, setMapSetDefence] = useState([]);
  const [mapRecipientIds, setMapRecipientIds] = useState([]);
  const [pnNodeSizeMode, setPnNodeSizeMode] = useState('volume');

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
  const calcFiltered = useMemo(() => filtered.filter((s) => !shouldExcludeFromTotals(s)), [filtered]);
  const mapBase = useMemo(() => applyNonTeamReportFilters(stats, {
    halves: mapHalves,
    playerIds: mapPlayerIds,
    actionTypes: [],
    outcomes: [],
    timeMin: mapTimeMin,
    timeMax: mapTimeMax,
    match: reportFilters?.match,
    imputedTimeById: reportFilters?.imputedTimeById,
  }), [stats, mapHalves, mapPlayerIds, mapTimeMin, mapTimeMax, reportFilters?.match, reportFilters?.imputedTimeById]);
  const mapDistanceMaxBound = useMemo(() => {
    const distances = mapBase
      .filter((s) => s && (s.stat_type === 'pass' || s.stat_type === 'carry'))
      .map((s) => getActionDistance(s))
      .filter(Number.isFinite);
    const observedMax = distances.length ? Math.max(...distances) : 0;
    return Math.max(10, Math.ceil(observedMax / 10) * 10);
  }, [mapBase]);
  const mapDistanceMidpoint = useMemo(() => Math.round(mapDistanceMaxBound / 2), [mapDistanceMaxBound]);
  const mapEvents = useMemo(() => mapBase.filter((s) => {
    if (!s || (s.stat_type !== 'pass' && s.stat_type !== 'carry')) return false;
    if (mapTeam !== 'both' && s.team_side !== mapTeam) return false;
    if (mapEventTypes.length && !mapEventTypes.includes(s.stat_type)) return false;
    const extra = safeParseJSON(s.extra_data || '{}', {});
    const p = s.stat_type === 'pass' ? extra?.pass?.pressure_on_passer : extra?.carry?.pressure_on_carrier;
    const o = deriveOutcome(s, extra);
    if (mapPressure.length && !mapPressure.includes(String(p || ''))) return false;
    if (mapOutcome.length && !mapOutcome.includes(String(o || ''))) return false;
    const progressiveStatus = isProgressiveShared(s) ? 'yes' : 'no';
    if (mapProgressiveFilter.length && !mapProgressiveFilter.includes(progressiveStatus)) return false;
    const [distanceMin, distanceMax] = normalizeDistanceRange({ min: mapDistanceMin, max: mapDistanceMax, maxDistance: mapDistanceMaxBound });
    if (!filterActionsByDistance(s, {
      min: String(mapDistanceMin ?? '') === '' ? null : distanceMin,
      max: String(mapDistanceMax ?? '') === '' ? null : distanceMax,
    })) return false;
    const originZone = getThirdLabel(s?.x_position);
    if (mapOriginZones.length && !mapOriginZones.includes(originZone)) return false;
    const endZone = getThirdLabel(s?.end_x_position);
    if (mapEndZones.length && !mapEndZones.includes(endZone)) return false;
    if (mapAccuracy.length) {
      const accuracy = s.stat_type === 'pass' ? String(extra?.pass?.accuracy || '').trim() : '';
      if (!accuracy || !mapAccuracy.includes(accuracy)) return false;
    }
    if (mapSetDefence.length) {
      const setDefence = getSetDefenceValue(s, null);
      const setDefenceKey = setDefence == null ? '' : (setDefence ? 'yes' : 'no');
      if (!setDefenceKey || !mapSetDefence.includes(setDefenceKey)) return false;
    }
    if (mapRecipientIds.length) {
      const recipient = normalizePlayerRef(getRecipientSelectionForBuildUp(s, extra));
      if (!recipient || !mapRecipientIds.includes(String(recipient.id))) return false;
    }
    return true;
  }), [mapBase, mapTeam, mapEventTypes, mapPressure, mapOutcome, mapProgressiveFilter, mapDistanceMin, mapDistanceMax, mapDistanceMaxBound, mapOriginZones, mapEndZones, mapAccuracy, mapSetDefence, mapRecipientIds]);

  const kpis = useMemo(() => {
    const eventLength = (stat) => {
      const sx = Number(stat?.x_position);
      const sy = Number(stat?.y_position);
      const ex = Number(stat?.end_x_position);
      const ey = Number(stat?.end_y_position);
      if (![sx, sy, ex, ey].every(Number.isFinite)) return NaN;
      return Math.sqrt(((ex - sx) ** 2) + ((ey - sy) ** 2));
    };
    const possessionGroups = groupByPossession(calcBase);
    const orderedBase = (Array.isArray(calcBase) ? calcBase : []).slice().sort((a, b) => {
      const pa = Number(a?.play_id);
      const pb = Number(b?.play_id);
      if (Number.isFinite(pa) && Number.isFinite(pb) && pa !== pb) return pa - pb;
      const ta = getMatchTimeS(a, reportFilters?.match, reportFilters?.imputedTimeById);
      const tb = getMatchTimeS(b, reportFilters?.match, reportFilters?.imputedTimeById);
      if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
      return String(a?.id || '').localeCompare(String(b?.id || ''));
    });
    const previousByPossessionKey = new Map();
    orderedBase.forEach((stat, index) => {
      const pid = Number(stat?.possession_id);
      const pside = stat?.possession_team_side;
      if (!Number.isFinite(pid) || (pside !== 'home' && pside !== 'away')) return;
      const key = `${pside}-${pid}`;
      if (!previousByPossessionKey.has(key)) previousByPossessionKey.set(key, index > 0 ? orderedBase[index - 1] : null);
    });
    const shotAssistCredits = buildShotAssistCredits(calcBase);
    const calc = (side) => {
      const sideEvents = calcFiltered.filter((s) => s.team_side === side);
      const pass = sideEvents.filter((s) => s.stat_type === 'pass');
      const carry = sideEvents.filter((s) => s.stat_type === 'carry');
      const passComp = pass.filter((s) => deriveOutcome(s, safeParseJSON(s.extra_data || '{}', {})) === 'completed').length;
      const carryComp = carry.filter((s) => deriveOutcome(s, safeParseJSON(s.extra_data || '{}', {})) === 'completed').length;
      const progPass = pass.filter((s) => isProgressiveShared(s)).length;
      const progPassComp = pass.filter((s) => isProgressiveShared(s) && deriveOutcome(s, safeParseJSON(s.extra_data || '{}', {})) === 'completed').length;
      const progCarry = carry.filter((s) => isProgressiveShared(s)).length;
      const progCarryComp = carry.filter((s) => isProgressiveShared(s) && deriveOutcome(s, safeParseJSON(s.extra_data || '{}', {})) === 'completed').length;
      const switches = pass.filter((s) => {
        if (deriveOutcome(s, safeParseJSON(s.extra_data || '{}', {})) !== 'completed') return false;
        const sy = Number(s?.y_position);
        const ey = Number(s?.end_y_position);
        return Number.isFinite(sy) && Number.isFinite(ey) && Math.abs(ey - sy) > 30;
      }).length;
      const scoringEntries = sideEvents.filter((s) => getScoringZoneEntry(s)).length;
      const passesIntoScoringZone = pass.filter((s) => deriveOutcome(s, safeParseJSON(s.extra_data || '{}', {})) === 'completed' && getScoringZoneEntry(s)).length;
      const turnovers = sideEvents.filter((s) => classifyTerminalOutcome(s, side) === 'TURNOVER').length;
      const shotAssists = shotAssistCredits.filter((row) => row.teamSide === side).length;
      const passLengths = pass.map(eventLength).filter(Number.isFinite);
      const kickPassLengths = pass
        .filter((s) => {
          const method = String(safeParseJSON(s.extra_data || '{}', {})?.pass?.method || '').toLowerCase();
          return method === 'left' || method === 'right';
        })
        .map(eventLength)
        .filter(Number.isFinite);
      const handPassLengths = pass
        .filter((s) => String(safeParseJSON(s.extra_data || '{}', {})?.pass?.method || '').toLowerCase() === 'hand')
        .map(eventLength)
        .filter(Number.isFinite);

      const buildUpSamples = [];
      const possessionDurations = [];
      const channels = { Left: 0, Middle: 0, Right: 0 };
      const startZones = { 'Defensive Third': 0, 'Middle Third': 0, 'Attacking Third': 0 };
      for (const [key, evs] of possessionGroups.entries()) {
        if (!String(key).startsWith(side + '-')) continue;
        const acting = evs.filter((e) => e && e.team_side === side);
        if (!acting.length) continue;
        const zone = getPossessionStartZone(acting);
        if (startZones[zone] != null) startZones[zone] += 1;
        const previousStat = previousByPossessionKey.get(key) || null;
        const startSource = inferPossessionStartSource(evs, side, previousStat || []);
        const liveStartAnchor = getLivePossessionStartAnchor(previousStat, startSource, reportFilters?.match, reportFilters?.imputedTimeById);
        const timeSummary = getPossessionTimeSummary(evs, side, reportFilters?.match, reportFilters?.imputedTimeById, { startAnchorTimeS: liveStartAnchor });
        const liveDuration = Number.isFinite(timeSummary.liveSeconds)
          ? timeSummary.liveSeconds
          : getDerivedPossessionDurationSeconds(evs, reportFilters?.match, reportFilters?.imputedTimeById);
        if (Number.isFinite(liveDuration) && liveDuration > 0) possessionDurations.push(liveDuration);
        if (!isAttackPossession(acting, side)) continue;
        const channel = getAttackEntryChannelForPossession(acting, side);
        if (channel) channels[channel] += 1;

        const firstEventTime = getMatchTimeS(acting[0], reportFilters?.match, reportFilters?.imputedTimeById);
        const startTime = Number.isFinite(liveStartAnchor) ? liveStartAnchor : firstEventTime;
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
        passComp,
        passPct: pass.length ? (passComp / pass.length) * 100 : NaN,
        carries: carry.length,
        carryComp,
        carryPct: carry.length ? (carryComp / carry.length) * 100 : NaN,
        progPass,
        progPassComp,
        progCarry,
        progCarryComp,
        switches,
        scoringEntries,
        passesIntoScoringZone,
        shotAssists,
        shotsCreated: shotAssists,
        fieldTiltEvents: sideEvents.filter((s) => getFieldTiltContribution(s)).length,
        turnovers,
        buildUpSpeed: buildUpSamples.length ? buildUpSamples.reduce((a, b) => a + b, 0) / buildUpSamples.length : NaN,
        passesPerMinuteInPossession: possessionDurations.length
          ? pass.length / (possessionDurations.reduce((a, b) => a + b, 0) / 60)
          : NaN,
        avgPassLength: passLengths.length ? passLengths.reduce((a, b) => a + b, 0) / passLengths.length : NaN,
        handPassCount: handPassLengths.length,
        kickPassCount: kickPassLengths.length,
        channels,
        startZones,
      };
    };
    return { home: calc('home'), away: calc('away') };
  }, [calcBase, calcFiltered, reportFilters]);

  const fieldTiltPct = useMemo(() => {
    const total = (kpis.home.fieldTiltEvents || 0) + (kpis.away.fieldTiltEvents || 0);
    return {
      home: total ? ((kpis.home.fieldTiltEvents || 0) / total) * 100 : NaN,
      away: total ? ((kpis.away.fieldTiltEvents || 0) / total) * 100 : NaN,
    };
  }, [kpis]);

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

  const formatRatioPct = (made, attempts) => {
    if (!Number.isFinite(Number(attempts)) || Number(attempts) <= 0) return `0/0 (NA)`;
    return `${made}/${attempts} (${formatPct((Number(made) / Number(attempts)) * 100)})`;
  };

  const formatHandKickRatio = (handCount, kickCount) => {
    if (!Number.isFinite(Number(handCount)) || !Number.isFinite(Number(kickCount)) || Number(kickCount) <= 0) return 'NA';
    return `${(Number(handCount) / Number(kickCount)).toFixed(2)}:1`;
  };

  const networkPasses = useMemo(() => {
    const targetHalf = String(pnHalf || 'all');
    return filtered.filter((s) => {
      if (s.stat_type !== 'pass') return false;
      if (targetHalf === 'all') return true;
      return String(s.half || '').toLowerCase() === targetHalf;
    });
  }, [filtered, pnHalf]);

  const networkSide = teamMode === 'both' ? pnSide : teamMode;
  const playerTeamById = useMemo(() => new Map((Array.isArray(playerOptions) ? playerOptions : []).map((p) => [p.id, p.team_side])), [playerOptions]);
  const playerLookup = useMemo(() => new Map((Array.isArray(playerOptions) ? playerOptions : []).map((p) => [String(p.id), p])), [playerOptions]);
  const substitutionPairs = useMemo(() => {
    const targetHalf = String(pnHalf || 'all');
    return (Array.isArray(stats) ? stats : [])
      .filter((s) => s?.stat_type === 'substitution')
      .filter((s) => targetHalf === 'all' || String(s?.half || '').toLowerCase() === targetHalf)
      .map((s) => {
        const extra = safeParseJSON(s?.extra_data || '{}', {});
        const outId = extra?.sub_out_id || '';
        const inId = extra?.sub_in_id || '';
        const outPlayer = (playerOptions || []).find((p) => p.id === outId);
        const inPlayer = (playerOptions || []).find((p) => p.id === inId);
        const pairSide = playerTeamById.get(outId) || playerTeamById.get(inId) || 'unknown';
        return {
          id: String(s?.id || `${outId}-${inId}`),
          side: pairSide,
          outId,
          inId,
          outNumber: outPlayer?.number ?? null,
          inNumber: inPlayer?.number ?? null,
          outLabel: outPlayer ? `#${outPlayer.number || ''} ${outPlayer.name || ''}`.trim() : 'Sub Out',
          inLabel: inPlayer ? `#${inPlayer.number || ''} ${inPlayer.name || ''}`.trim() : 'Sub In',
        };
      })
      .filter((pair) => pair.side === networkSide);
  }, [stats, pnHalf, playerOptions, playerTeamById, networkSide]);

  const [selectedSubPairPlayer, setSelectedSubPairPlayer] = useState({});
  useEffect(() => {
    setSelectedSubPairPlayer((current) => {
      const next = {};
      for (const pair of substitutionPairs) {
        const existing = current[pair.id];
        next[pair.id] = existing === 'out' || existing === 'in' ? existing : 'out';
      }
      return next;
    });
  }, [substitutionPairs]);

  const hiddenPlayerIds = useMemo(() => {
    const set = new Set();
    substitutionPairs.forEach((pair) => {
      const selected = selectedSubPairPlayer[pair.id] || 'out';
      if (selected === 'out') {
        if (pair.inId) set.add(pair.inId);
      } else {
        if (pair.outId) set.add(pair.outId);
      }
    });
    return set;
  }, [substitutionPairs, selectedSubPairPlayer]);

  const networkTeamColor = (networkSide === 'away' ? awayTeam?.color : homeTeam?.color) || '#111827';
  const homeSonarZones = useMemo(() => buildPassSonarData(calcFiltered, { side: 'home', includeOverall: true }), [calcFiltered]);
  const awaySonarZones = useMemo(() => buildPassSonarData(calcFiltered, { side: 'away', includeOverall: true }), [calcFiltered]);
  const singleTeamSonarZones = useMemo(() => buildPassSonarData(calcFiltered, { side: teamMode === 'both' ? null : teamMode, includeOverall: true }), [calcFiltered, teamMode]);

  return (
    <div className="space-y-4">
        <div className="grid lg:grid-cols-[0.9fr_1.1fr] gap-5 items-stretch">
          <ComparisonMetricsCard
            title="Build-Up Metrics"
            homeTeam={homeTeam}
            awayTeam={awayTeam}
            teamMode={teamMode}
            cardClassName="w-full h-full"
            rows={[
              { label: 'Passes', home: formatRatioPct(kpis.home.passComp, kpis.home.passes), away: formatRatioPct(kpis.away.passComp, kpis.away.passes) },
              { label: 'Carries', home: formatRatioPct(kpis.home.carryComp, kpis.home.carries), away: formatRatioPct(kpis.away.carryComp, kpis.away.carries) },
              { label: 'Progressive Passes', home: kpis.home.progPassComp, away: kpis.away.progPassComp },
              { label: 'Progressive Carries', home: kpis.home.progCarryComp, away: kpis.away.progCarryComp },
              { label: 'Switches', home: kpis.home.switches, away: kpis.away.switches },
              { label: 'Field Tilt', home: formatPct(fieldTiltPct.home), away: formatPct(fieldTiltPct.away) },
            ]}
          />
          {teamMode === 'both' ? (
            <div className="grid lg:grid-cols-2 gap-4">
              <TeamPassSonarCard title={`${homeTeam?.name || 'Home'} Pass Sonar`} zones={homeSonarZones} defaultZone="Overall" />
              <TeamPassSonarCard title={`${awayTeam?.name || 'Away'} Pass Sonar`} zones={awaySonarZones} defaultZone="Overall" />
            </div>
          ) : (
            <TeamPassSonarCard
              title={`${teamMode === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home')} Pass Sonar`}
              zones={singleTeamSonarZones}
              defaultZone="Overall"
            />
          )}
        </div>

        {mapEvents.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-sm text-slate-600 text-center">
              No passes or carries available for current filters.
            </CardContent>
          </Card>
        ) : (
          <>
            <Card className={paneClassName}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-semibold text-slate-900">Pass / Carry Map</div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 px-3 text-xs"
                    onClick={() => {
                      setMapTeam(String(reportFilters?.team || 'both'));
                      setMapHalves(Array.isArray(reportFilters?.halves) ? reportFilters.halves : []);
                      setMapTimeMin(String(reportFilters?.timeMin ?? ''));
                      setMapTimeMax(String(reportFilters?.timeMax ?? ''));
                      setMapPlayerIds(Array.isArray(reportFilters?.playerIds) ? reportFilters.playerIds : []);
                      setMapEventTypes(Array.isArray(eventTypes) ? eventTypes : []);
                      setMapPressure(Array.isArray(pressure) ? pressure : []);
                      setMapOutcome(Array.isArray(outcome) ? outcome : []);
                      setMapProgressiveFilter(progressiveOnly ? ['yes'] : []);
                      setMapDistanceMin('');
                      setMapDistanceMax('');
                      setMapOriginZones([]);
                      setMapEndZones([]);
                      setMapAccuracy([]);
                      setMapSetDefence([]);
                      setMapRecipientIds([]);
                    }}
                  >
                    Reset Filters
                  </Button>
                </div>
                <div className="grid lg:grid-cols-[minmax(0,1.8fr)_320px] gap-4 items-start">
                  <div>
                    <PitchViz
                      stats={mapEvents}
                      homeColor={homeTeam?.color}
                      awayColor={awayTeam?.color}
                      colorBy={mapTeam === 'both' ? 'team' : 'outcome'}
                      showColorControls={false}
                      mirrorAwayWhenBoth={mapTeam !== 'home'}
                      directionLabel="Home ->"
                      align="left"
                      pitchScale="100%"
                      onOpenVideoAt={onOpenVideoAt}
                      fullscreenTitle="Pass / Carry Map"
                    />
                  </div>
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                      <div className="space-y-1">
                        <Label className="text-xs text-slate-600">Team</Label>
                        <Select value={mapTeam} onValueChange={setMapTeam}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="both">Both</SelectItem>
                            <SelectItem value="home">{homeTeam?.name || 'Home'}</SelectItem>
                            <SelectItem value="away">{awayTeam?.name || 'Away'}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="col-span-1">
                        <MultiSelect
                          label="Half"
                          placeholder="All"
                          values={mapHalves}
                          onChange={setMapHalves}
                          options={['first', 'second', 'et_first', 'et_second'].map((v) => ({ value: v, label: toTitleCase(v) }))}
                        />
                      </div>
                      <MatchTimeRangeSlider
                        className="col-span-2"
                        timeMin={mapTimeMin}
                        timeMax={mapTimeMax}
                        match={reportFilters?.match}
                        stats={stats}
                        imputedTimeById={reportFilters?.imputedTimeById}
                        compact
                        onChange={({ timeMin: nextMin, timeMax: nextMax }) => {
                          setMapTimeMin(nextMin);
                          setMapTimeMax(nextMax);
                        }}
                      />
                      <MultiSelect
                        label="Passer / Carrier"
                        placeholder="Any"
                        values={mapPlayerIds}
                        onChange={setMapPlayerIds}
                        options={(playerOptions || []).map((p) => ({ value: p.id, label: (p.team_side === 'away' ? 'Away: ' : 'Home: ') + p.label }))}
                      />
                      <MultiSelect
                        label="Intended Recipient"
                        placeholder="Any"
                        values={mapRecipientIds}
                        onChange={setMapRecipientIds}
                        options={(playerOptions || []).map((p) => ({ value: String(p.id), label: (p.team_side === 'away' ? 'Away: ' : 'Home: ') + p.label }))}
                      />
                      <MultiSelect
                        label="Carry / Pass"
                        placeholder="All"
                        values={mapEventTypes}
                        onChange={setMapEventTypes}
                        options={[
                          { value: 'pass', label: 'Pass' },
                          { value: 'carry', label: 'Carry' },
                        ]}
                      />
                      <MultiSelect
                        label="Outcome"
                        placeholder="All"
                        values={mapOutcome}
                        onChange={setMapOutcome}
                        options={[
                          { value: 'completed', label: 'Completed' },
                          { value: 'turnover', label: 'Turnover' },
                          { value: 'foul', label: 'Foul' },
                        ]}
                      />
                      <MultiSelect
                        label="Origin"
                        placeholder="All"
                        values={mapOriginZones}
                        onChange={setMapOriginZones}
                        options={[
                          { value: 'Defensive Third', label: 'Def 1/3' },
                          { value: 'Middle Third', label: 'Mid 1/3' },
                          { value: 'Attacking Third', label: 'Final 1/3' },
                        ]}
                      />
                      <MultiSelect
                        label="End Point"
                        placeholder="All"
                        values={mapEndZones}
                        onChange={setMapEndZones}
                        options={[
                          { value: 'Defensive Third', label: 'Def 1/3' },
                          { value: 'Middle Third', label: 'Mid 1/3' },
                          { value: 'Attacking Third', label: 'Final 1/3' },
                        ]}
                      />
                      <MultiSelect
                        label="Pressure"
                        placeholder="All"
                        values={mapPressure}
                        onChange={setMapPressure}
                        options={[
                          { value: 'low', label: 'Low' },
                          { value: 'medium', label: 'Medium' },
                          { value: 'high', label: 'High' },
                        ]}
                      />
                      <MultiSelect
                        label="Accuracy"
                        placeholder="All"
                        values={mapAccuracy}
                        onChange={setMapAccuracy}
                        options={[
                          { value: '++', label: '++' },
                          { value: '+', label: '+' },
                          { value: '-', label: '-' },
                          { value: '--', label: '--' },
                        ]}
                      />
                      <MultiSelect
                        label="Progressive"
                        placeholder="All"
                        values={mapProgressiveFilter}
                        onChange={setMapProgressiveFilter}
                        options={[
                          { value: 'yes', label: 'Yes' },
                          { value: 'no', label: 'No' },
                        ]}
                      />
                      <MultiSelect
                        label="Set Defence"
                        placeholder="All"
                        values={mapSetDefence}
                        onChange={setMapSetDefence}
                        options={[
                          { value: 'yes', label: 'Yes' },
                          { value: 'no', label: 'No' },
                        ]}
                      />
                      <RangeSliderField
                        className="col-span-2"
                        compact
                        label="Distance"
                        min={0}
                        max={mapDistanceMaxBound}
                        step={1}
                        value={normalizeDistanceRange({ min: mapDistanceMin, max: mapDistanceMax, maxDistance: mapDistanceMaxBound })}
                        onChange={([nextMin, nextMax]) => {
                          setMapDistanceMin(nextMin <= 0 ? '' : String(nextMin));
                          setMapDistanceMax(nextMax >= mapDistanceMaxBound ? '' : String(nextMax));
                        }}
                        formatValue={(value) => `${Math.round(value)}`}
                        tickValues={[0, mapDistanceMidpoint, mapDistanceMaxBound]}
                        tickFormatter={(value) => {
                          if (value <= 0) return '0';
                          if (Math.abs(value - mapDistanceMidpoint) < 0.5) return String(mapDistanceMidpoint);
                          return String(mapDistanceMaxBound);
                        }}
                        showBoundsText={false}
                      />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch">
              <div className="lg:w-[46%] lg:min-w-0 lg:flex-none">
                <ComparisonMetricsCard
                  title="Build-Up Style"
                  homeTeam={homeTeam}
                  awayTeam={awayTeam}
                  teamMode={teamMode}
                  cardClassName="w-full max-w-none mr-0"
                  rows={[
                    { label: 'Build-Up Speed', home: Number.isFinite(kpis.home.buildUpSpeed) ? `${kpis.home.buildUpSpeed.toFixed(1)}s` : 'NA', away: Number.isFinite(kpis.away.buildUpSpeed) ? `${kpis.away.buildUpSpeed.toFixed(1)}s` : 'NA' },
                    { label: 'Scoring Zone Entries', home: kpis.home.scoringEntries, away: kpis.away.scoringEntries },
                    { label: 'Passes Into Scoring Zone', home: kpis.home.passesIntoScoringZone, away: kpis.away.passesIntoScoringZone },
                    { label: 'Passes / Possession Minute', home: Number.isFinite(kpis.home.passesPerMinuteInPossession) ? kpis.home.passesPerMinuteInPossession.toFixed(2) : 'NA', away: Number.isFinite(kpis.away.passesPerMinuteInPossession) ? kpis.away.passesPerMinuteInPossession.toFixed(2) : 'NA' },
                    { label: 'Avg Pass Length', home: Number.isFinite(kpis.home.avgPassLength) ? kpis.home.avgPassLength.toFixed(1) : 'NA', away: Number.isFinite(kpis.away.avgPassLength) ? kpis.away.avgPassLength.toFixed(1) : 'NA' },
                    { label: 'Handpass : Kickpass', home: formatHandKickRatio(kpis.home.handPassCount, kpis.home.kickPassCount), away: formatHandKickRatio(kpis.away.handPassCount, kpis.away.kickPassCount) },
                  ]}
                />
              </div>

              <div className="lg:flex lg:w-[54%] lg:min-w-0 lg:flex-none">
                <AttackChannelPitch
                  homeTeam={homeTeam}
                  awayTeam={awayTeam}
                  teamMode={teamMode}
                  homeColor={homeTeam?.color}
                  awayColor={awayTeam?.color}
                  rows={channelRows}
                  compact
                  cardClassName="h-full"
                />
              </div>
            </div>

            <BuildUpHeatmapSection
              stats={filtered}
              teamMode={teamMode}
              homeTeam={homeTeam}
              awayTeam={awayTeam}
              homeColor={homeTeam?.color || '#2563eb'}
              awayColor={awayTeam?.color || '#ef4444'}
            />

            <Card className={paneClassName}>
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
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-600">Half</Label>
                      <Select value={pnHalf} onValueChange={setPnHalf}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All</SelectItem>
                          <SelectItem value="first">First</SelectItem>
                          <SelectItem value="second">Second</SelectItem>
                          <SelectItem value="et_first">ET1</SelectItem>
                          <SelectItem value="et_second">ET2</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-600">Node Size</Label>
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          type="button"
                          variant={pnNodeSizeMode === 'volume' ? 'default' : 'outline'}
                          size="sm"
                          className="h-8 px-2 text-xs"
                          onClick={() => setPnNodeSizeMode('volume')}
                        >
                          Pass Volume
                        </Button>
                        <Button
                          type="button"
                          variant={pnNodeSizeMode === 'fixed' ? 'default' : 'outline'}
                          size="sm"
                          className="h-8 px-2 text-xs"
                          onClick={() => setPnNodeSizeMode('fixed')}
                        >
                          Fixed
                        </Button>
                      </div>
                    </div>
                    {substitutionPairs.length > 0 && (
                      <div className="space-y-2">
                        <Label className="text-xs text-slate-600">Substitution Pairs</Label>
                        <div className="space-y-2">
                          {substitutionPairs.map((pair) => {
                            const selected = selectedSubPairPlayer[pair.id] || 'out';
                            const sideColor = pair.side === 'away' ? (awayTeam?.color || '#7f1d1d') : (homeTeam?.color || '#ea580c');
                            return (
                              <div key={pair.id} className="flex items-center gap-2">
                                <Button
                                  type="button"
                                  variant={selected === 'out' ? 'default' : 'outline'}
                                  size="sm"
                                  className="h-8 min-w-10 px-2 text-xs"
                                  style={selected === 'out' ? { backgroundColor: sideColor, borderColor: sideColor, color: '#fff' } : { borderColor: sideColor, color: sideColor }}
                                  onClick={() => setSelectedSubPairPlayer((current) => ({ ...current, [pair.id]: 'out' }))}
                                  title={pair.outLabel}
                                >
                                  {pair.outNumber ?? 'Out'}
                                </Button>
                                <Button
                                  type="button"
                                  variant={selected === 'in' ? 'default' : 'outline'}
                                  size="sm"
                                  className="h-8 min-w-10 px-2 text-xs"
                                  style={selected === 'in' ? { backgroundColor: sideColor, borderColor: sideColor, color: '#fff' } : { borderColor: sideColor, color: sideColor }}
                                  onClick={() => setSelectedSubPairPlayer((current) => ({ ...current, [pair.id]: 'in' }))}
                                  title={pair.inLabel}
                                >
                                  {pair.inNumber ?? 'In'}
                                </Button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="space-y-3">
                    <PassNetwork
                      passes={networkPasses}
                      side={networkSide}
                      minCount={pnMin}
                      teamLabel={networkSide === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home')}
                      teamColor={networkTeamColor}
                      showTable
                      pitchScale="88%"
                      hiddenPlayerIds={hiddenPlayerIds}
                      nodeSizeMode={pnNodeSizeMode}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            <PlayerCombinationsSection
              stats={networkPasses}
              homeTeam={homeTeam}
              awayTeam={awayTeam}
              homeColor={homeTeam?.color}
              awayColor={awayTeam?.color}
              playerLookup={playerLookup}
              hiddenHomePlayerIds={networkSide === 'home' ? hiddenPlayerIds : null}
              hiddenAwayPlayerIds={networkSide === 'away' ? hiddenPlayerIds : null}
            />
          </>
        )}
    </div>
  );
}


export default BuildUpTab;

