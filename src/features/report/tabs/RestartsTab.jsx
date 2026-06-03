import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ChartContainer, ChartTooltipContent } from '@/components/ui/chart';
import { BarChart, Bar, CartesianGrid, LineChart, Line, PieChart, Pie, Cell, Tooltip, ReferenceLine, XAxis, YAxis, ResponsiveContainer, Sankey } from 'recharts';
import {
  PITCH_W,
  PITCH_H,
  calcDistanceToGoal,
  classifyKickoutLength,
  extractFoulFromStat,
  findScorableFreeConcededRows,
  getAttackEntryChannelForPossession,
  getFieldTiltContribution,
  getNextBallActionStat,
  inferRestartWinnerSide,
  getMatchTimeS,
  getProgressiveMeters,
  getScoringZoneEntry,
  isAttackPossession,
  isDeadBallGapStart,
  shouldExcludeFromTotals,
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
  sortRows,
  SortableTableHead,
  MultiSelect,
  MatchTimeRangeSlider,
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

function KickoutPressTable({ card, homeTeam, awayTeam }) {
  return (
    <div className="rounded-xl border-2 border-slate-400 bg-gradient-to-br from-slate-50 via-white to-white p-3 shadow-md space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-medium text-slate-900">{card.player}</div>
          <div className="text-xs text-slate-500">
            {card.team === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home')}
          </div>
        </div>
        <div className="text-right text-xs text-slate-600">
          <div className="font-medium text-slate-900">{card.kickoutsTaken ? `${card.ownKickoutsWon}/${card.kickoutsTaken}` : 'NA'}</div>
          <div>Overall Own KO Wins</div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Press</TableHead>
              <TableHead className="text-right">Overall</TableHead>
              <TableHead className="border-l border-slate-200 text-right">Short</TableHead>
              <TableHead className="text-right">Long</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {card.pressRows.map((row) => (
              <TableRow key={row.key} style={teamRowTint(card.team, homeTeam?.color, awayTeam?.color, 0.07)}>
                <TableCell className="font-medium">{row.press}</TableCell>
                <TableCell className="text-right tabular-nums">{row.overall}</TableCell>
                <TableCell className="border-l border-slate-200 text-right tabular-nums">{row.short}</TableCell>
                <TableCell className="text-right tabular-nums">{row.long}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function getKickoutSideLabel(stat) {
  return toTitleCase(shotSideFromY(stat?.end_y_position) || shotSideFromY(stat?.y_position) || '');
}

function getShotXpValue(stat) {
  const extra = safeParseJSON(stat?.extra_data || '{}', {});
  const shot = extra?.shot || {};
  const xpRaw = shot?.xp?.value ?? shot?.expected_points ?? shot?.expectedPoints ?? shot?.xp ?? shot?.xP ?? null;
  const xp = Number(xpRaw);
  return Number.isFinite(xp) ? xp : 0;
}

function getKickoutValueGroupingLabel(stat, groupingMode) {
  if (groupingMode === 'side') {
    const side = String(getKickoutSideLabel(stat) || '').toLowerCase();
    if (side === 'left') return 'Left';
    if (side === 'centre' || side === 'middle') return 'Middle';
    if (side === 'right') return 'Right';
    return 'Unknown';
  }
  if (groupingMode === 'length') {
    const length = String(classifyKickoutLength(stat) || '').toLowerCase();
    if (length === 'short') return 'Short';
    if (length === 'long') return 'Long';
    return 'Unknown';
  }
  if (groupingMode === 'press') {
    const extra = safeParseJSON(stat?.extra_data || '{}', {});
    const press = String(extra?.kickout?.press || '').toLowerCase();
    if (press === 'm2m') return 'M2M';
    if (press === 'zonal') return 'Zonal';
    if (press === 'conceded') return 'Conceded';
    return 'Unknown';
  }
  return 'All Kickouts';
}

function getKickoutChainFirstShot(kickoutStat, orderedStats, statIndexById) {
  const startIndex = statIndexById.get(kickoutStat?.id);
  if (!Number.isInteger(startIndex)) return null;
  for (let i = startIndex + 1; i < orderedStats.length; i += 1) {
    const stat = orderedStats[i];
    if (!stat) continue;
    const statType = String(stat?.stat_type || '');
    if (statType === 'shot') return stat;
    if (statType === 'kickout' || statType === 'throw_in' || statType === 'period_end') return null;
    if (isDeadBallGapStart(stat)) return null;
  }
  return null;
}

function buildKickoutValueRows({ kickouts, groupingMode, orderedStats, statIndexById }) {
  const groupOrder = groupingMode === 'all'
    ? ['All Kickouts']
    : groupingMode === 'side'
      ? ['Left', 'Middle', 'Right']
      : groupingMode === 'length'
        ? ['Short', 'Long']
        : ['M2M', 'Zonal', 'Conceded'];
  const buckets = new Map(groupOrder.map((label) => [label, { group: label, n: 0, xpTotal: 0, pppTotal: 0 }]));

  (Array.isArray(kickouts) ? kickouts : []).forEach((kickout) => {
    const extra = safeParseJSON(kickout?.extra_data || '{}', {});
    const kickingTeam = extra?.kickout?.team_side || kickout?.team_side;
    if (kickingTeam !== 'home' && kickingTeam !== 'away') return;
    const group = getKickoutValueGroupingLabel(kickout, groupingMode);
    if (groupingMode !== 'all' && !groupOrder.includes(group)) return;
    const bucket = buckets.get(group) || { group, n: 0, xpTotal: 0, pppTotal: 0 };
    bucket.n += 1;
    const firstShot = getKickoutChainFirstShot(kickout, orderedStats, statIndexById);
    if (firstShot?.stat_type === 'shot') {
      const shotTeam = firstShot?.team_side;
      const sign = shotTeam === kickingTeam ? 1 : shotTeam === 'home' || shotTeam === 'away' ? -1 : 0;
      const shotExtra = safeParseJSON(firstShot?.extra_data || '{}', {});
      const outcome = shotExtra?.shot?.outcome;
      bucket.xpTotal += sign * getShotXpValue(firstShot);
      bucket.pppTotal += sign * (shotOutcomeGroup(outcome) === 'score' ? shotPointsForOutcome(outcome) : 0);
    }
    buckets.set(group, bucket);
  });

  return groupOrder
    .map((label) => buckets.get(label) || { group: label, n: 0, xpTotal: 0, pppTotal: 0 })
    .filter((row) => groupingMode !== 'all' || row.group === 'All Kickouts')
    .map((row) => ({
      ...row,
      netXpPerPoss: row.n ? row.xpTotal / row.n : 0,
      netPppPerPoss: row.n ? row.pppTotal / row.n : 0,
    }));
}

function getKickoutSankeyNodeFill(name, layer) {
  if (name === 'TO Lost') return '#f97316';
  if (String(name).includes('Lost')) return '#eab308';
  if (name === 'Half End') return '#64748b';
  if (name === 'Score') return '#16a34a';
  if (name === 'Miss') return '#dc2626';
  if (layer === 1) return '#334155';
  if (layer === 2) {
    if (String(name).includes('Won')) return '#2563eb';
    return '#eab308';
  }
  if (layer === 3) {
    if (name === 'Shot') return '#7c3aed';
    if (name === 'TO Lost') return '#f97316';
    if (name === 'Half End') return '#64748b';
    return '#64748b';
  }
  if (layer === 4) return name === 'Score' ? '#16a34a' : '#dc2626';
  return '#475569';
}

function KickoutSankeyNode(props) {
  const { x, y, width, height, index, payload } = props;
  const name = payload?.name || '';
  if (isHiddenKickoutSankeyNode(name)) return <g key={`ko-node-${index}`} />;
  const layer = payload?.layer || 1;
  const fill = getKickoutSankeyNodeFill(name, layer);
  const onSelect = payload?.onSelect;
  const isSelected = !!payload?.isSelected;
  const isDimmed = !!payload?.isDimmed;

  return (
    <g
      key={`ko-node-${index}`}
      onClick={onSelect ? () => onSelect(payload) : undefined}
      style={{ cursor: onSelect ? 'pointer' : 'default' }}
    >
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={4}
        fill={fill}
        fillOpacity={isDimmed ? 0.18 : (isSelected ? 1 : 0.9)}
        stroke={isSelected ? '#0f172a' : '#ffffff'}
        strokeWidth={isSelected ? 2 : 1.2}
      />
      <text
        x={x + ((payload?.depth ?? 0) === 0 ? width + 8 : -8)}
        y={y + (height / 2)}
        textAnchor={(payload?.depth ?? 0) === 0 ? 'start' : 'end'}
        dominantBaseline="middle"
        fontSize={12}
        fontWeight={600}
        fill={isDimmed ? '#94a3b8' : '#0f172a'}
      >
        {name}
      </text>
    </g>
  );
}

function KickoutSankeyLink(props) {
  const { sourceX, targetX, sourceY, targetY, sourceControlX, targetControlX, linkWidth, payload } = props;
  if (isHiddenKickoutSankeyNode(payload?.target?.name) || isHiddenKickoutSankeyNode(payload?.source?.name)) return null;
  const color = payload?.target?.color || getKickoutSankeyNodeFill(payload?.targetName, payload?.targetLayer) || '#cbd5e1';
  const relevantValue = Number(payload?.highlightValue || 0);
  const totalValue = Number(payload?.value || 0);
  const flowRatio = payload?.isHighlighted && totalValue > 0 ? Math.max(0, Math.min(1, relevantValue / totalValue)) : 1;
  return (
    <path
      d={`M${sourceX},${sourceY} C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`}
      fill="none"
      stroke={color}
      strokeOpacity={payload?.isDimmed ? 0.08 : (payload?.isHighlighted ? 0.6 : 0.35)}
      strokeWidth={Math.max(1, (linkWidth * flowRatio)) + (payload?.isHighlighted ? 0.5 : 0)}
    />
  );
}

function KickoutSankeyTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const entry = payload[0] || {};
  const item = entry?.payload || entry;
  const sourceName = item?.source?.name || item?.payload?.source?.name || item?.sourceName || '';
  const targetName = item?.target?.name || item?.payload?.target?.name || item?.targetName || '';
  const nodeName = item?.name || item?.payload?.name || '';
  if (isHiddenKickoutSankeyNode(sourceName) || isHiddenKickoutSankeyNode(targetName) || isHiddenKickoutSankeyNode(nodeName)) return null;
  const value = Number(item?.value ?? item?.payload?.value ?? entry?.value ?? 0);
  const filteredValue = Number(item?.highlightValue ?? item?.payload?.highlightValue ?? value);
  const displayValue = item?.isHighlighted ? filteredValue : value;
  if (sourceName && targetName) {
    return (
      <div className="rounded-xl border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
        <div className="font-medium text-slate-900">{sourceName} -&gt; {targetName}</div>
        <div className="mt-1 flex justify-between gap-4">
          <span className="text-muted-foreground">Kickouts</span>
          <span className="font-mono font-medium tabular-nums text-foreground">{displayValue}</span>
        </div>
      </div>
    );
  }
  const matrix = item?.tooltipMatrix || item?.payload?.tooltipMatrix || null;
  const origins = Array.isArray(item?.originTotals || item?.payload?.originTotals) ? (item?.originTotals || item?.payload?.originTotals) : [];
  if (!nodeName || !matrix) return null;
  const inputs = Array.isArray(matrix.inputs) ? matrix.inputs : [];
  const outputs = Array.isArray(matrix.outputs) ? matrix.outputs : [];
  return (
    <div className="max-w-[420px] rounded-xl border border-border/50 bg-background px-2.5 py-2 text-xs shadow-xl">
      <div className="font-medium text-slate-900">{nodeName}</div>
      <div className="mt-1 mb-2 flex justify-between gap-4">
        <span className="text-muted-foreground">Node total</span>
        <span className="font-mono font-medium tabular-nums text-foreground">{Number(matrix.total || 0)}</span>
      </div>
      {origins.length ? (
        <div className="mb-2 space-y-1">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Origins</div>
          <div className="grid gap-1">
            {origins.map((origin) => (
              <div key={origin.label} className="flex justify-between gap-3 text-[11px]">
                <span className="text-slate-600">{origin.label}</span>
                <span className="font-mono tabular-nums text-slate-900">{origin.value}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {inputs.length || outputs.length ? (
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-[11px]">
            <thead>
              <tr>
                <th className="border border-slate-200 bg-slate-50 px-2 py-1 text-left font-semibold text-slate-600">Input \ Output</th>
                {outputs.length ? outputs.map((label) => (
                  <th key={label} className="border border-slate-200 bg-slate-50 px-2 py-1 text-right font-semibold text-slate-600">{label}</th>
                )) : (
                  <th className="border border-slate-200 bg-slate-50 px-2 py-1 text-right font-semibold text-slate-600">Total</th>
                )}
              </tr>
            </thead>
            <tbody>
              {(inputs.length ? inputs : ['Input Total']).map((inputLabel) => (
                <tr key={inputLabel}>
                  <td className="border border-slate-200 px-2 py-1 font-medium text-slate-700">{inputLabel}</td>
                  {(outputs.length ? outputs : ['__total__']).map((outputLabel) => (
                    <td key={`${inputLabel}-${outputLabel}`} className="border border-slate-200 px-2 py-1 text-right tabular-nums text-slate-700">
                      {matrix.grid?.[inputLabel]?.[outputLabel] ?? 0}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

const KICKOUT_OUTCOME_STACKS = [
  { key: 'clean_for', label: 'Clean Won', color: '#2563eb' },
  { key: 'clean_against', label: 'Clean Lost', color: '#93c5fd' },
  { key: 'break_for', label: 'Break Won', color: '#16a34a' },
  { key: 'break_against', label: 'Break Lost', color: '#86efac' },
  { key: 'sideline_for', label: 'Sideline Won', color: '#d97706' },
  { key: 'sideline_against', label: 'Sideline Lost', color: '#fdba74' },
  { key: 'foul_for', label: 'Foul Won', color: '#dc2626' },
  { key: 'foul_against', label: 'Foul Lost', color: '#fca5a5' },
];

const KICKOUT_OUTCOME_SIMPLE_STACKS = [
  { key: 'for_total', label: 'Won', color: '#16a34a' },
  { key: 'against_total', label: 'Lost', color: '#dc2626' },
];

const RESTART_PANE_CLASS = 'border-2 border-slate-400 bg-gradient-to-br from-slate-50 via-white to-white shadow-md';
const KICKOUT_VALUE_GROUPING_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'side', label: 'Direction' },
  { value: 'length', label: 'Length' },
  { value: 'press', label: 'Press' },
];
const KICKOUT_SANKEY_GROUPING_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'press', label: 'Press' },
  { value: 'side', label: 'Direction' },
  { value: 'distance', label: 'Distance' },
];
const KICKOUT_SANKEY_WON_OUTCOMES = new Set(['Clean Won', 'Break Won', 'Sideline Won', 'Foul Won']);
const KICKOUT_SANKEY_HIDDEN_LOST_SINK = '__kickout_lost_sink__';
const KICKOUT_SANKEY_HIDDEN_LAYER3_SINK = '__kickout_layer3_sink__';
const KICKOUT_SANKEY_LAYER_ORDER = {
  2: ['Break Lost', 'Sideline Lost', 'Clean Lost', 'Foul Lost', 'Break Won', 'Sideline Won', 'Clean Won', 'Foul Won'],
  3: ['TO Lost', 'Half End', 'Other', 'Shot'],
  4: ['Score', 'Miss'],
};
const KICKOUT_SANKEY_LAYER2_PAIR_ORDER = ['Clean Lost', 'Clean Won', 'Break Lost', 'Break Won', 'Sideline Lost', 'Sideline Won', 'Foul Lost', 'Foul Won'];

function isHiddenKickoutSankeyNode(name) {
  return name === KICKOUT_SANKEY_HIDDEN_LOST_SINK || name === KICKOUT_SANKEY_HIDDEN_LAYER3_SINK;
}

function kickoutSankeyNodeKeyToName(nodeKey) {
  return String(nodeKey || '').split(':').slice(1).join(':');
}

function createKickoutTooltipMatrix() {
  return {
    inputs: new Set(),
    outputs: new Set(),
    grid: new Map(),
    total: 0,
  };
}

function bumpKickoutTooltipMatrix(matrices, nodeName, inputName, outputName, count = 1) {
  if (!nodeName) return;
  const current = matrices.get(nodeName) || createKickoutTooltipMatrix();
  const inKey = inputName || 'Input Total';
  const outKey = outputName || '__total__';
  current.inputs.add(inKey);
  if (outputName) current.outputs.add(outputName);
  if (!current.grid.has(inKey)) current.grid.set(inKey, new Map());
  const row = current.grid.get(inKey);
  row.set(outKey, (row.get(outKey) || 0) + count);
  current.total += count;
  matrices.set(nodeName, current);
}

function serializeKickoutTooltipMatrix(matrix) {
  if (!matrix) return { total: 0, inputs: [], outputs: [], grid: {} };
  return {
    total: matrix.total,
    inputs: Array.from(matrix.inputs),
    outputs: Array.from(matrix.outputs),
    grid: Array.from(matrix.grid.entries()).reduce((acc, [input, row]) => {
      acc[input] = Array.from(row.entries()).reduce((rowAcc, [output, count]) => {
        rowAcc[output] = count;
        return rowAcc;
      }, {});
      return acc;
    }, {}),
  };
}

function serializeKickoutOriginTotals(originMap) {
  return Array.from((originMap || new Map()).entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || String(a.label).localeCompare(String(b.label)));
}

function buildKickoutSankeyHighlight(data, selectedNodeKey) {
  if (!selectedNodeKey || !data?.nodes?.length || !data?.links?.length) {
    return { nodeKeys: new Set(), linkValues: new Map(), nodeMatrices: new Map(), nodeOriginTotals: new Map() };
  }
  const nodeKeys = new Set([selectedNodeKey]);
  const linkValues = new Map();
  const nodeMatrices = new Map();
  const nodeOriginTotals = new Map();
  const flowPaths = Array.isArray(data?.flowPaths) ? data.flowPaths : [];
  flowPaths.forEach((flow) => {
    const nodes = Array.isArray(flow?.nodes) ? flow.nodes : [];
    const idx = nodes.indexOf(selectedNodeKey);
    if (idx === -1) return;
    const count = Number(flow?.value || 0);
    const prefix = nodes.slice(0, idx + 1);
    const originLabel = kickoutSankeyNodeKeyToName(prefix[0]);
    for (let i = 0; i < prefix.length; i += 1) {
      const nodeKey = prefix[i];
      const nodeName = kickoutSankeyNodeKeyToName(nodeKey);
      nodeKeys.add(nodeKey);
      if (!nodeOriginTotals.has(nodeKey)) nodeOriginTotals.set(nodeKey, new Map());
      const origins = nodeOriginTotals.get(nodeKey);
      origins.set(originLabel, (origins.get(originLabel) || 0) + count);
      bumpKickoutTooltipMatrix(
        nodeMatrices,
        nodeKey,
        i > 0 ? kickoutSankeyNodeKeyToName(prefix[i - 1]) : null,
        i < prefix.length - 1 ? kickoutSankeyNodeKeyToName(prefix[i + 1]) : null,
        count
      );
    }
    for (let i = 0; i < prefix.length - 1; i += 1) {
      const linkKey = `${prefix[i]}->${prefix[i + 1]}`;
      linkValues.set(linkKey, (linkValues.get(linkKey) || 0) + count);
    }
  });
  return { nodeKeys, linkValues, nodeMatrices, nodeOriginTotals };
}

function getKickoutGroupingLabel(stat, groupingMode) {
  const extra = safeParseJSON(stat?.extra_data || '{}', {});
  const kick = extra?.kickout || {};
  if (groupingMode === 'press') {
    const press = String(kick?.press || '').toLowerCase();
    if (press === 'm2m') return 'M2M';
    if (press === 'zonal') return 'Zonal';
    if (press === 'conceded') return 'Conceded';
    return 'Unknown';
  }
  if (groupingMode === 'side') {
    const side = getKickoutSideLabel(stat).toLowerCase();
    if (side === 'left') return 'Left';
    if (side === 'centre' || side === 'middle') return 'Middle';
    if (side === 'right') return 'Right';
    return 'Unknown';
  }
  if (groupingMode === 'distance') {
    const length = String(classifyKickoutLength(stat) || '').toLowerCase();
    if (length === 'short') return 'Short';
    if (length === 'long') return 'Long';
    return 'Unknown';
  }
  return 'All Kickouts';
}

function getKickoutImmediateOutcome(stat, nextStatById) {
  const extra = safeParseJSON(stat?.extra_data || '{}', {});
  const kick = extra?.kickout || {};
  const kickTeam = kick?.team_side;
  const outcome = String(kick?.outcome || '').toLowerCase();
  const winnerSide = inferRestartWinnerSide(stat, nextStatById?.get?.(stat?.id) || null);
  const won = !!kickTeam && !!winnerSide && kickTeam === winnerSide;

  if (outcome === 'clean') return won ? 'Clean Won' : 'Clean Lost';
  if (outcome === 'break') return won ? 'Break Won' : 'Break Lost';
  if (outcome === 'sideline_for') return 'Sideline Won';
  if (outcome === 'sideline_against') return 'Sideline Lost';
  if (outcome === 'foul') return won ? 'Foul Won' : 'Foul Lost';
  return won ? 'Other Won' : 'Other Lost';
}

function getPostWinKickoutOutcome(stat, possessionGroups, nextStatById) {
  const winnerSide = inferRestartWinnerSide(stat, nextStatById?.get?.(stat?.id) || null);
  if (winnerSide !== 'home' && winnerSide !== 'away') return { layer3: 'Other', shotResult: null };
  const pid = Number(stat?.possession_id);
  if (!Number.isFinite(pid)) return { layer3: 'Other', shotResult: null };
  const possession = possessionGroups?.get?.(`${winnerSide}-${pid}`) || null;
  if (!Array.isArray(possession) || !possession.length) return { layer3: 'Other', shotResult: null };
  const possessionOutcome = derivePossessionOutcome(possession, winnerSide);
  if (possessionOutcome === 'Turnover') return { layer3: 'TO Lost', shotResult: null };
  if (possessionOutcome === 'Half End') return { layer3: 'Half End', shotResult: null };
  if (['Score', 'Wide', 'Short', 'Blocked', 'Saved', 'Post'].includes(possessionOutcome)) {
    return { layer3: 'Shot', shotResult: possessionOutcome === 'Score' ? 'Score' : 'Miss' };
  }
  return { layer3: 'Other', shotResult: null };
}

function buildKickoutSankeyData({ kickouts, groupingMode, nextStatById, possessionGroups, viewMode = 'full', layer2OrderMode = 'grouped' }) {
  const nodes = [];
  const nodeIndex = new Map();
  const links = [];
  const linkIndex = new Map();
  const nodeMatrices = new Map();
  const nodeOriginTotals = new Map();
  const flowPathCounts = new Map();

  const ensureNode = (name, layer) => {
    const key = `${layer}:${name}`;
    if (nodeIndex.has(key)) return nodeIndex.get(key);
    const idx = nodes.length;
    nodeIndex.set(key, idx);
    nodes.push({ name, layer, nodeKey: key, color: getKickoutSankeyNodeFill(name, layer) });
    return idx;
  };

  const bumpLink = (sourceName, sourceLayer, targetName, targetLayer) => {
    const source = ensureNode(sourceName, sourceLayer);
    const target = ensureNode(targetName, targetLayer);
    const key = `${source}->${target}`;
    if (!linkIndex.has(key)) {
      linkIndex.set(key, links.length);
      links.push({ source, target, value: 0, sourceName, targetName, sourceLayer, targetLayer });
    }
    links[linkIndex.get(key)].value += 1;
  };

  const recordNodePath = (nodeName, inputName, outputName) => {
    bumpKickoutTooltipMatrix(nodeMatrices, nodeName, inputName, outputName, 1);
  };

  const recordFlowPath = (path) => {
    const visiblePath = (Array.isArray(path) ? path : []).filter(Boolean);
    if (visiblePath.length < 2) return;
    const key = visiblePath.join('||');
    flowPathCounts.set(key, (flowPathCounts.get(key) || 0) + 1);
    const originLabel = kickoutSankeyNodeKeyToName(visiblePath[0]);
    visiblePath.forEach((nodeKey) => {
      if (!nodeOriginTotals.has(nodeKey)) nodeOriginTotals.set(nodeKey, new Map());
      const origins = nodeOriginTotals.get(nodeKey);
      origins.set(originLabel, (origins.get(originLabel) || 0) + 1);
    });
  };

  (Array.isArray(kickouts) ? kickouts : []).forEach((stat) => {
    const layer1 = getKickoutGroupingLabel(stat, groupingMode);
    const layer2 = getKickoutImmediateOutcome(stat, nextStatById);
    if (!layer2 || layer2.startsWith('Other')) return;
    const downstream = getPostWinKickoutOutcome(stat, possessionGroups, nextStatById);
    const endResult = !KICKOUT_SANKEY_WON_OUTCOMES.has(layer2)
      ? layer2
      : downstream.layer3 === 'Shot' && downstream.shotResult
        ? downstream.shotResult
        : downstream.layer3;

    if (viewMode === 'end') {
      bumpLink(layer1, 1, endResult, 4);
      recordNodePath(layer1, null, endResult);
      recordNodePath(endResult, layer1, null);
      recordFlowPath([`1:${layer1}`, `4:${endResult}`]);
      return;
    }

    bumpLink(layer1, 1, layer2, 2);
    recordNodePath(layer1, null, layer2);
    if (!KICKOUT_SANKEY_WON_OUTCOMES.has(layer2)) {
      bumpLink(layer2, 2, KICKOUT_SANKEY_HIDDEN_LOST_SINK, 3);
      recordNodePath(layer2, layer1, null);
      recordFlowPath([`1:${layer1}`, `2:${layer2}`]);
      return;
    }
    bumpLink(layer2, 2, downstream.layer3, 3);
    recordNodePath(layer2, layer1, downstream.layer3);
    if (downstream.layer3 === 'Shot' && downstream.shotResult) {
      bumpLink('Shot', 3, downstream.shotResult, 4);
      recordNodePath('Shot', layer2, downstream.shotResult);
      recordNodePath(downstream.shotResult, 'Shot', null);
      recordFlowPath([`1:${layer1}`, `2:${layer2}`, '3:Shot', `4:${downstream.shotResult}`]);
    } else {
      bumpLink(downstream.layer3, 3, KICKOUT_SANKEY_HIDDEN_LAYER3_SINK, 4);
      recordNodePath(downstream.layer3, layer2, null);
      recordFlowPath([`1:${layer1}`, `2:${layer2}`, `3:${downstream.layer3}`]);
    }
  });

  const outgoingTotals = new Map();
  links.forEach((link) => {
    outgoingTotals.set(link.source, (outgoingTotals.get(link.source) || 0) + link.value);
  });

  const layerOneOrder = groupingMode === 'all'
    ? ['All Kickouts']
    : groupingMode === 'press'
      ? ['M2M', 'Zonal', 'Conceded', 'Unknown']
      : groupingMode === 'side'
        ? ['Left', 'Middle', 'Right', 'Unknown']
        : ['Short', 'Long', 'Unknown'];

  const getLayerOrder = (layer) => {
    if (layer === 1) return layerOneOrder;
    if (viewMode === 'end' && layer === 4) {
      return ['Score', 'Miss', 'TO Lost', 'Half End', 'Other', 'Clean Lost', 'Break Lost', 'Sideline Lost', 'Foul Lost'];
    }
    if (viewMode === 'full' && layer === 2) return layer2OrderMode === 'paired' ? KICKOUT_SANKEY_LAYER2_PAIR_ORDER : KICKOUT_SANKEY_LAYER_ORDER[2];
    if (viewMode === 'full' && layer === 3) {
      return [...KICKOUT_SANKEY_LAYER_ORDER[3], KICKOUT_SANKEY_HIDDEN_LOST_SINK];
    }
    if (viewMode === 'full' && layer === 4) {
      return ['Score', 'Miss', KICKOUT_SANKEY_HIDDEN_LAYER3_SINK];
    }
    return KICKOUT_SANKEY_LAYER_ORDER[layer] || [];
  };

  const orderedNodes = nodes
    .map((node, idx) => ({ ...node, originalIndex: idx }))
    .sort((a, b) => {
      if (a.layer !== b.layer) return a.layer - b.layer;
      const order = getLayerOrder(a.layer);
      const ai = order.indexOf(a.name);
      const bi = order.indexOf(b.name);
      if (ai !== bi) {
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      }
      return a.originalIndex - b.originalIndex;
    });

  const remap = new Map();
  orderedNodes.forEach((node, idx) => {
    remap.set(node.originalIndex, idx);
  });

  return {
    nodes: orderedNodes.map((node) => {
      const matrix = nodeMatrices.get(node.name);
      return {
        ...node,
        tooltipMatrix: matrix ? serializeKickoutTooltipMatrix(matrix) : { total: 0, inputs: [], outputs: [], grid: {} },
        originTotals: serializeKickoutOriginTotals(nodeOriginTotals.get(node.nodeKey)),
      };
    }),
    links: links.map((link) => ({
      ...link,
      source: remap.get(link.source),
      target: remap.get(link.target),
      sourceKey: `${link.sourceLayer}:${link.sourceName}`,
      targetKey: `${link.targetLayer}:${link.targetName}`,
      linkKey: `${link.sourceLayer}:${link.sourceName}->${link.targetLayer}:${link.targetName}`,
      parentTotal: outgoingTotals.get(link.source) || link.value,
      pctOfParent: (outgoingTotals.get(link.source) || 0) > 0 ? (link.value / outgoingTotals.get(link.source)) * 100 : 100,
    })),
    flowPaths: Array.from(flowPathCounts.entries()).map(([key, value]) => ({ nodes: key.split('||'), value })),
    totalKickouts: Array.isArray(kickouts) ? kickouts.length : 0,
  };
}

function formatRestartPlayerLabel(player, { includeTeam = true } = {}) {
  const normalized = normalizePlayerRef(player);
  if (!normalized) return 'Unknown';
  const bits = [];
  if (normalized.number != null && String(normalized.number) !== '') bits.push(`#${normalized.number}`);
  if (normalized.name) bits.push(normalized.name);
  const core = bits.join(' ').trim() || 'Player';
  if (!includeTeam) return core;
  const teamPrefix = normalized.team_side === 'away' ? 'Away' : 'Home';
  return `${teamPrefix}: ${core}`;
}

function sortRestartSelectionOptions(options) {
  const sideOrder = { home: 0, away: 1 };
  return (Array.isArray(options) ? options.slice() : []).sort((a, b) => {
    const sideCmp = (sideOrder[a.team_side] ?? 99) - (sideOrder[b.team_side] ?? 99);
    if (sideCmp !== 0) return sideCmp;
    const aNum = Number(a.number);
    const bNum = Number(b.number);
    const aHasNum = Number.isFinite(aNum);
    const bHasNum = Number.isFinite(bNum);
    if (aHasNum && bHasNum && aNum !== bNum) return aNum - bNum;
    if (aHasNum !== bHasNum) return aHasNum ? -1 : 1;
    return String(a.label || '').localeCompare(String(b.label || ''), undefined, { numeric: true, sensitivity: 'base' });
  });
}

function RestartsTab({
  stats,
  homeTeam,
  awayTeam,
  playerOptions,
  reportFilters,
  restartTargetFilter = [],
  restartWonByFilter = [],
  restartLengthFilter = [],
  restartSideFilter = [],
  onOpenVideoAt,
}) {
  const scopedReportFilters = useMemo(() => ({ ...reportFilters, allowedActionTypes: ['kickout', 'throw_in'] }), [reportFilters]);
  const base = useMemo(() => applyNonTeamReportFilters(stats, scopedReportFilters), [stats, scopedReportFilters]);
  const calcBase = useMemo(() => base.filter((s) => !shouldExcludeFromTotals(s)), [base]);
  const teamMode = String(reportFilters?.team || 'both');

  const kickouts = useMemo(() => base.filter((s) => s?.stat_type === 'kickout'), [base]);
  const calcKickouts = useMemo(() => calcBase.filter((s) => s?.stat_type === 'kickout'), [calcBase]);
  const throwIns = useMemo(() => calcBase.filter((s) => s?.stat_type === 'throw_in'), [calcBase]);
  const [kickoutValueGrouping, setKickoutValueGrouping] = useState('all');
  const orderedAllStats = useMemo(() => (Array.isArray(stats) ? stats.slice() : []).sort((a, b) => {
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
  }), [stats]);
  const statIndexById = useMemo(() => {
    const out = new Map();
    orderedAllStats.forEach((stat, index) => {
      if (stat?.id) out.set(stat.id, index);
    });
    return out;
  }, [orderedAllStats]);
  const nextStatById = useMemo(() => {
    const out = new Map();
    for (let i = 0; i < orderedAllStats.length; i += 1) out.set(orderedAllStats[i]?.id, getNextBallActionStat(orderedAllStats, i));
    return out;
  }, [orderedAllStats]);

  const kpis = useMemo(() => {
    const byPoss = groupByPossession(calcBase);

    const calcForTeam = (teamSide) => {
      const ownKickouts = [];
      const oppKickouts = [];
      for (const s of calcKickouts) {
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
      for (const s of calcKickouts) {
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
      const restartToShot = restartPoss.filter((evs) => evs.some((e) => e.team_side === teamSide && e.stat_type === 'shot' && !shouldExcludeFromTotals(e))).length;
      const restartToScore = restartPoss.filter((evs) => evs.some((e) => {
        if (e.team_side !== teamSide || e.stat_type !== 'shot' || shouldExcludeFromTotals(e)) return false;
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
    const breakAll = calcKickouts.filter((s) => safeParseJSON(s.extra_data || '{}', {})?.kickout?.outcome === 'break');
    const breakWonHome = breakAll.filter((s) => inferRestartWinnerSide(s, nextStatById.get(s.id)) === 'home').length;
    const breakWonAway = breakAll.filter((s) => inferRestartWinnerSide(s, nextStatById.get(s.id)) === 'away').length;

    return {
      home: calcForTeam('home'),
      away: calcForTeam('away'),
      breakAll: breakAll.length,
      breakWonHome,
      breakWonAway,
      throwInWinHome: throwIns.filter((s) => inferRestartWinnerSide(s, nextStatById.get(s.id)) === 'home').length,
      throwInWinAway: throwIns.filter((s) => inferRestartWinnerSide(s, nextStatById.get(s.id)) === 'away').length,
      throwInsContested: throwIns.length,
    };
  }, [calcKickouts, calcBase, nextStatById, throwIns]);

  const kickoutTargets = useMemo(() => {
    const rows = new Map();
    const ensureRow = (player, fallbackTeam) => {
      const normalized = normalizePlayerRef(player);
      const team = normalized?.team_side === 'home' || normalized?.team_side === 'away' ? normalized.team_side : fallbackTeam;
      if (!normalized?.id || (team !== 'home' && team !== 'away')) return null;
      const key = String(normalized.id);
      const rowKey = `${team}|${key}`;
      const existing = rows.get(rowKey);
      if (existing) return existing;
      const created = {
        team,
        key,
        label: formatRestartPlayerLabel({ ...normalized, team_side: team }, { includeTeam: false }),
        targeted: 0,
        won: 0,
        cleanWon: 0,
        cleanLost: 0,
        breakWon: 0,
        breakLost: 0,
        broken: 0,
        marks: 0,
      };
      rows.set(rowKey, created);
      return created;
    };
    for (const s of calcKickouts) {
      const ex = safeParseJSON(s.extra_data || '{}', {});
      const koTeam = ex?.kickout?.team_side;
      if (koTeam !== 'home' && koTeam !== 'away') continue;
      const targetRow = ensureRow(ex?.kickout?.intended_recipient, koTeam);
      const o = ex?.kickout?.outcome;
      const wonSide = inferRestartWinnerSide(s, nextStatById.get(s.id));
      const winnerPlayer = normalizePlayerRef(ex?.kickout?.won_by);
      const loserPlayer = normalizePlayerRef(ex?.kickout?.lost_by);
      const brokenPlayer = normalizePlayerRef(ex?.kickout?.broken_by);
      const winnerRow = ensureRow(winnerPlayer, koTeam);
      const loserRow = ensureRow(loserPlayer, koTeam);
      const brokenRow = ensureRow(brokenPlayer, koTeam);
      if (targetRow) {
        targetRow.targeted += 1;
        if (wonSide === koTeam) targetRow.won += 1;
      }
      if (o === 'clean') {
        if (winnerRow) winnerRow.cleanWon += 1;
        if (loserRow) loserRow.cleanLost += 1;
      }
      if (o === 'break') {
        if (winnerRow) winnerRow.breakWon += 1;
        if (loserRow) loserRow.breakLost += 1;
        if (brokenRow) brokenRow.broken += 1;
      }
      if (o === 'clean' && ex?.kickout?.mark && winnerRow) winnerRow.marks += 1;
    }
    return Array.from(rows.values()).sort((a, b) => b.targeted - a.targeted || String(a.label).localeCompare(String(b.label)));
  }, [calcKickouts, nextStatById]);

  const kickoutPressCards = useMemo(() => {
    const keeperRows = new Map();
    for (const stat of calcKickouts) {
      const extra = safeParseJSON(stat.extra_data || '{}', {});
      const kick = extra?.kickout || {};
      const team = kick?.team_side;
      if (team !== 'home' && team !== 'away') continue;
      const keeper = getKeeperCandidate(playerOptions, team);
      const keeperKey = keeper?.id ? `${team}|${keeper.id}` : `${team}|keeper`;
      const current = keeperRows.get(keeperKey) || {
        key: keeperKey,
        team,
        player: keeper ? `#${keeper.number || ''} ${keeper.name || ''}`.trim() : `${team === 'away' ? 'Away' : 'Home'} Goalkeeper`,
        kickoutsTaken: 0,
        ownKickoutsWon: 0,
        pressBreakdown: {
          m2m: { taken: 0, won: 0, shortTaken: 0, shortWon: 0, longTaken: 0, longWon: 0 },
          zonal: { taken: 0, won: 0, shortTaken: 0, shortWon: 0, longTaken: 0, longWon: 0 },
          conceded: { taken: 0, won: 0, shortTaken: 0, shortWon: 0, longTaken: 0, longWon: 0 },
        },
      };
      current.kickoutsTaken += 1;
      const won = inferRestartWinnerSide(stat, nextStatById.get(stat.id)) === team;
      if (won) current.ownKickoutsWon += 1;
      const pressKey = ['m2m', 'zonal', 'conceded'].includes(String(kick?.press || '').toLowerCase()) ? String(kick.press).toLowerCase() : null;
      if (!pressKey) {
        keeperRows.set(keeperKey, current);
        continue;
      }
      const isLong = classifyKickoutLength(stat) === 'long';
      current.pressBreakdown[pressKey].taken += 1;
      if (won) current.pressBreakdown[pressKey].won += 1;
      if (isLong) {
        current.pressBreakdown[pressKey].longTaken += 1;
        if (won) current.pressBreakdown[pressKey].longWon += 1;
      } else {
        current.pressBreakdown[pressKey].shortTaken += 1;
        if (won) current.pressBreakdown[pressKey].shortWon += 1;
      }
      keeperRows.set(keeperKey, current);
    }

    return Array.from(keeperRows.values()).map((row) => {
      const pressRows = ['m2m', 'zonal', 'conceded']
        .map((press) => {
          const info = row.pressBreakdown?.[press];
          return {
            key: press,
            press: press === 'm2m' ? 'M2M' : toTitleCase(press),
            overall: `${info.won}/${info.taken} (${formatPct(info.taken ? (info.won / info.taken) * 100 : NaN)})`,
            short: info.shortTaken ? `${info.shortWon}/${info.shortTaken} (${formatPct((info.shortWon / info.shortTaken) * 100)})` : 'NA',
            long: info.longTaken ? `${info.longWon}/${info.longTaken} (${formatPct((info.longWon / info.longTaken) * 100)})` : 'NA',
          };
        })
      return { ...row, pressRows };
    }).filter((row) => row.kickoutsTaken > 0 && (teamMode === 'both' || row.team === teamMode));
  }, [calcKickouts, nextStatById, playerOptions, teamMode]);
  const kickoutOutcomeRows = useMemo(() => {
    const seed = (side) => ({
      team: side,
      label: side === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home'),
      clean_for: 0,
      clean_against: 0,
      break_for: 0,
      break_against: 0,
      sideline_for: 0,
      sideline_against: 0,
      foul_for: 0,
      foul_against: 0,
    });
    const rows = {
      home: seed('home'),
      away: seed('away'),
    };

    calcKickouts.forEach((stat) => {
      const extra = safeParseJSON(stat.extra_data || '{}', {});
      const kick = extra?.kickout || {};
      const koTeam = kick?.team_side;
      if (koTeam !== 'home' && koTeam !== 'away') return;
      const winner = inferRestartWinnerSide(stat, nextStatById.get(stat.id));
      const outcome = String(kick?.outcome || '').toLowerCase();
      const row = rows[koTeam];
      if (!row) return;
      if (outcome === 'clean') {
        row[winner === koTeam ? 'clean_for' : 'clean_against'] += 1;
        return;
      }
      if (outcome === 'break') {
        row[winner === koTeam ? 'break_for' : 'break_against'] += 1;
        return;
      }
      if (outcome === 'sideline_for') {
        row.sideline_for += 1;
        return;
      }
      if (outcome === 'sideline_against') {
        row.sideline_against += 1;
        return;
      }
      if (outcome === 'foul') {
        row[winner === koTeam ? 'foul_for' : 'foul_against'] += 1;
      }
    });

    return ['home', 'away']
      .filter((side) => teamMode === 'both' || side === teamMode)
      .map((side) => rows[side]);
  }, [calcKickouts, nextStatById, homeTeam, awayTeam, teamMode]);

  const [koMapTeam, setKoMapTeam] = useState(String(reportFilters?.team || 'both'));
  const [koMapHalves, setKoMapHalves] = useState(Array.isArray(reportFilters?.halves) ? reportFilters.halves : []);
  const [koMapTimeMin, setKoMapTimeMin] = useState(String(reportFilters?.timeMin ?? ''));
  const [koMapTimeMax, setKoMapTimeMax] = useState(String(reportFilters?.timeMax ?? ''));
  const [koMapTargets, setKoMapTargets] = useState(Array.isArray(restartTargetFilter) ? restartTargetFilter : []);
  const [koMapOutcomes, setKoMapOutcomes] = useState([]);
  const [koMapWonBy, setKoMapWonBy] = useState(Array.isArray(restartWonByFilter) ? restartWonByFilter : []);
  const [koMapPress, setKoMapPress] = useState([]);
  const [koMapLengths, setKoMapLengths] = useState(Array.isArray(restartLengthFilter) ? restartLengthFilter : []);
  const [koMapSides, setKoMapSides] = useState(Array.isArray(restartSideFilter) ? restartSideFilter : []);
  const [koMapDotsOnly, setKoMapDotsOnly] = useState(false);
  const [kickoutOutcomeMode, setKickoutOutcomeMode] = useState('detailed');
  const [kickoutSankeyGrouping, setKickoutSankeyGrouping] = useState('all');
  const [kickoutSankeyTeam, setKickoutSankeyTeam] = useState(String(reportFilters?.team || '') === 'away' ? 'away' : 'home');
  const [kickoutSankeyViewMode, setKickoutSankeyViewMode] = useState('full');
  const [kickoutSankeyLayer2OrderMode, setKickoutSankeyLayer2OrderMode] = useState('grouped');
  const [selectedKickoutSankeyNodeKey, setSelectedKickoutSankeyNodeKey] = useState(null);
  useEffect(() => { setKoMapTargets(Array.isArray(restartTargetFilter) ? restartTargetFilter : []); }, [restartTargetFilter]);
  useEffect(() => { setKoMapWonBy(Array.isArray(restartWonByFilter) ? restartWonByFilter : []); }, [restartWonByFilter]);
  useEffect(() => { setKoMapLengths(Array.isArray(restartLengthFilter) ? restartLengthFilter : []); }, [restartLengthFilter]);
  useEffect(() => { setKoMapSides(Array.isArray(restartSideFilter) ? restartSideFilter : []); }, [restartSideFilter]);
  useEffect(() => { setSelectedKickoutSankeyNodeKey(null); }, [kickoutSankeyGrouping, kickoutSankeyTeam, kickoutSankeyViewMode, kickoutSankeyLayer2OrderMode]);
  const kickoutMapBase = useMemo(() => applyNonTeamReportFilters(stats, {
    halves: koMapHalves,
    playerIds: [],
    actionTypes: [],
    outcomes: [],
    timeMin: koMapTimeMin,
    timeMax: koMapTimeMax,
    match: reportFilters?.match,
    imputedTimeById: reportFilters?.imputedTimeById,
  }).filter((s) => s?.stat_type === 'kickout'), [stats, koMapHalves, koMapTimeMin, koMapTimeMax, reportFilters?.match, reportFilters?.imputedTimeById]);
  const kickoutTargetOptions = useMemo(() => {
    const rows = new Map();
    kickoutMapBase.forEach((stat) => {
      const extra = safeParseJSON(stat.extra_data || '{}', {});
      const target = extra?.kickout?.intended_recipient;
      const normalized = normalizePlayerRef(target);
      const key = normalized?.id ? String(normalized.id) : String(target?.kind || 'unknown');
      if (!key || rows.has(key)) return;
      if (normalized?.id) {
        rows.set(key, {
          value: key,
          label: formatRestartPlayerLabel(normalized),
          team_side: normalized.team_side,
          number: normalized.number,
        });
      } else {
        rows.set(key, {
          value: key,
          label: formatExtraValue(target) || 'Unknown',
          team_side: 'zz_other',
          number: null,
        });
      }
    });
    return sortRestartSelectionOptions(Array.from(rows.values()));
  }, [kickoutMapBase]);
  const kickoutWonByOptions = useMemo(() => {
    const rows = new Map();
    kickoutMapBase.forEach((stat) => {
      const extra = safeParseJSON(stat.extra_data || '{}', {});
      const wonBy = normalizePlayerRef(extra?.kickout?.won_by);
      if (!wonBy?.id) return;
      const key = String(wonBy.id);
      if (rows.has(key)) return;
      rows.set(key, {
        value: key,
        label: formatRestartPlayerLabel(wonBy),
        team_side: wonBy.team_side,
        number: wonBy.number,
      });
    });
    return [
      { value: 'team:home', label: homeTeam?.name || 'Home', team_side: 'home', number: -2 },
      { value: 'team:away', label: awayTeam?.name || 'Away', team_side: 'away', number: -1 },
      ...sortRestartSelectionOptions(Array.from(rows.values())),
    ];
  }, [kickoutMapBase, homeTeam, awayTeam]);
  const filteredKickoutMapStats = useMemo(() => kickoutMapBase.filter((stat) => {
    const extra = safeParseJSON(stat.extra_data || '{}', {});
    const kick = extra?.kickout || {};
    const kickTeam = kick?.team_side;
    if (koMapTeam !== 'both' && kickTeam !== koMapTeam && stat?.team_side !== koMapTeam) return false;
    if (koMapTargets.length) {
      const target = kick?.intended_recipient;
      const targetKey = target?.kind === 'player' ? String(target.id) : String(target?.kind || 'unknown');
      if (!koMapTargets.includes(targetKey)) return false;
    }
    if (koMapOutcomes.length) {
      const outcome = String(kick?.outcome || '');
      if (!koMapOutcomes.includes(outcome)) return false;
    }
    if (koMapWonBy.length) {
      const winner = normalizePlayerRef(kick?.won_by);
      const winnerSide = winner?.team_side || inferRestartWinnerSide(stat, nextStatById.get(stat.id)) || '';
      const winnerId = winner?.id ? String(winner.id) : '';
      const matchesSelectedWinner = koMapWonBy.some((value) => {
        if (value === 'team:home') return winnerSide === 'home';
        if (value === 'team:away') return winnerSide === 'away';
        return winnerId && value === winnerId;
      });
      if (!matchesSelectedWinner) return false;
    }
    if (koMapPress.length) {
      const press = String(kick?.press || '').toLowerCase();
      if (!press || !koMapPress.includes(press)) return false;
    }
    if (koMapLengths.length) {
      const length = String(classifyKickoutLength(stat) || '').toLowerCase();
      if (!length || !koMapLengths.includes(length)) return false;
    }
    if (koMapSides.length) {
      const sideLabel = getKickoutSideLabel(stat).toLowerCase();
      if (!sideLabel || !koMapSides.includes(sideLabel)) return false;
    }
    return true;
  }), [kickoutMapBase, koMapTeam, koMapTargets, koMapOutcomes, koMapWonBy, koMapPress, koMapLengths, koMapSides, nextStatById]);
  const restartFilteredKickouts = useMemo(() => calcKickouts.filter((stat) => {
    const extra = safeParseJSON(stat.extra_data || '{}', {});
    const kick = extra?.kickout || {};
    const kickTeam = kick?.team_side;
    if (kickTeam !== kickoutSankeyTeam && stat?.team_side !== kickoutSankeyTeam) return false;
    if (restartTargetFilter.length) {
      const target = kick?.intended_recipient;
      const targetKey = target?.kind === 'player' ? String(target.id) : String(target?.kind || 'unknown');
      if (!restartTargetFilter.includes(targetKey)) return false;
    }
    if (restartWonByFilter.length) {
      const winner = normalizePlayerRef(kick?.won_by);
      const winnerSide = winner?.team_side || inferRestartWinnerSide(stat, nextStatById.get(stat.id)) || '';
      const winnerId = winner?.id ? String(winner.id) : '';
      const matchesSelectedWinner = restartWonByFilter.some((value) => {
        if (value === 'team:home') return winnerSide === 'home';
        if (value === 'team:away') return winnerSide === 'away';
        return winnerId && value === winnerId;
      });
      if (!matchesSelectedWinner) return false;
    }
    if (restartLengthFilter.length) {
      const length = String(classifyKickoutLength(stat) || '').toLowerCase();
      if (!length || !restartLengthFilter.includes(length)) return false;
    }
    if (restartSideFilter.length) {
      const sideLabel = getKickoutSideLabel(stat).toLowerCase();
      if (!sideLabel || !restartSideFilter.includes(sideLabel)) return false;
    }
    return true;
  }), [calcKickouts, kickoutSankeyTeam, restartTargetFilter, restartWonByFilter, restartLengthFilter, restartSideFilter, nextStatById]);
  const kickoutValueKickouts = useMemo(() => calcKickouts.filter((stat) => {
    const extra = safeParseJSON(stat.extra_data || '{}', {});
    const kick = extra?.kickout || {};
    if (restartTargetFilter.length) {
      const target = kick?.intended_recipient;
      const targetKey = target?.kind === 'player' ? String(target.id) : String(target?.kind || 'unknown');
      if (!restartTargetFilter.includes(targetKey)) return false;
    }
    if (restartWonByFilter.length) {
      const winner = normalizePlayerRef(kick?.won_by);
      const winnerSide = winner?.team_side || inferRestartWinnerSide(stat, nextStatById.get(stat.id)) || '';
      const winnerId = winner?.id ? String(winner.id) : '';
      const matchesSelectedWinner = restartWonByFilter.some((value) => {
        if (value === 'team:home') return winnerSide === 'home';
        if (value === 'team:away') return winnerSide === 'away';
        return winnerId && value === winnerId;
      });
      if (!matchesSelectedWinner) return false;
    }
    if (restartLengthFilter.length) {
      const length = String(classifyKickoutLength(stat) || '').toLowerCase();
      if (!length || !restartLengthFilter.includes(length)) return false;
    }
    if (restartSideFilter.length) {
      const sideLabel = getKickoutSideLabel(stat).toLowerCase();
      if (!sideLabel || !restartSideFilter.includes(sideLabel)) return false;
    }
    return true;
  }), [calcKickouts, restartTargetFilter, restartWonByFilter, restartLengthFilter, restartSideFilter, nextStatById]);
  const kickoutValueRowsHome = useMemo(
    () => buildKickoutValueRows({
      kickouts: kickoutValueKickouts.filter((stat) => (safeParseJSON(stat?.extra_data || '{}', {})?.kickout?.team_side || stat?.team_side) === 'home'),
      groupingMode: kickoutValueGrouping,
      orderedStats: orderedAllStats,
      statIndexById,
    }),
    [kickoutValueKickouts, kickoutValueGrouping, orderedAllStats, statIndexById]
  );
  const kickoutValueRowsAway = useMemo(
    () => buildKickoutValueRows({
      kickouts: kickoutValueKickouts.filter((stat) => (safeParseJSON(stat?.extra_data || '{}', {})?.kickout?.team_side || stat?.team_side) === 'away'),
      groupingMode: kickoutValueGrouping,
      orderedStats: orderedAllStats,
      statIndexById,
    }),
    [kickoutValueKickouts, kickoutValueGrouping, orderedAllStats, statIndexById]
  );
  const [targetSort, setTargetSort] = useState({ key: 'targeted', dir: 'desc' });
  const targetColumns = useMemo(() => ([
    { key: 'team', label: 'Team', sortValue: (r) => r.team === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home') },
    { key: 'label', label: 'Player', sortValue: (r) => r.label || '' },
    { key: 'targeted', label: 'Targets', sortValue: (r) => r.targeted },
    { key: 'won', label: 'Won By Team', sortValue: (r) => r.won },
    { key: 'winPct', label: 'Win %', sortValue: (r) => (r.targeted ? (r.won / r.targeted) * 100 : -1) },
    { key: 'cleanWon', label: 'Clean Won', sortValue: (r) => r.cleanWon },
    { key: 'cleanLost', label: 'Clean Lost', sortValue: (r) => r.cleanLost },
    { key: 'cleanPct', label: 'Clean %', sortValue: (r) => ((r.cleanWon + r.cleanLost) ? (r.cleanWon / (r.cleanWon + r.cleanLost)) * 100 : -1) },
    { key: 'breakWon', label: 'Break Won', sortValue: (r) => r.breakWon },
    { key: 'breakLost', label: 'Break Lost', sortValue: (r) => r.breakLost },
    { key: 'breakPct', label: 'Break %', sortValue: (r) => ((r.breakWon + r.breakLost) ? (r.breakWon / (r.breakWon + r.breakLost)) * 100 : -1) },
    { key: 'broken', label: 'Broken', sortValue: (r) => r.broken },
    { key: 'marks', label: 'Marks', sortValue: (r) => r.marks },
  ]), [homeTeam, awayTeam]);
  const sortedKickoutTargets = useMemo(
    () => sortRows(kickoutTargets.filter((r) => teamMode === 'both' || r.team === teamMode), targetSort, targetColumns, 'key'),
    [kickoutTargets, teamMode, targetSort, targetColumns]
  );
  const toggleTargetSort = (key) => setTargetSort((current) => current.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'label' || key === 'team' ? 'asc' : 'desc' });
  const [showAllKickoutTargets, setShowAllKickoutTargets] = useState(false);
  const kickoutOutcomeChartRows = useMemo(() => {
    if (kickoutOutcomeMode !== 'simple') return kickoutOutcomeRows;
    return kickoutOutcomeRows.map((row) => ({
      ...row,
      for_total: row.clean_for + row.break_for + row.sideline_for + row.foul_for,
      against_total: row.clean_against + row.break_against + row.sideline_against + row.foul_against,
    }));
  }, [kickoutOutcomeMode, kickoutOutcomeRows]);
  const kickoutOutcomeStacks = kickoutOutcomeMode === 'simple' ? KICKOUT_OUTCOME_SIMPLE_STACKS : KICKOUT_OUTCOME_STACKS;
  const kickoutOutcomeLegendColumns = kickoutOutcomeMode === 'simple'
    ? [KICKOUT_OUTCOME_SIMPLE_STACKS]
    : [
        [KICKOUT_OUTCOME_STACKS[0], KICKOUT_OUTCOME_STACKS[1]],
        [KICKOUT_OUTCOME_STACKS[2], KICKOUT_OUTCOME_STACKS[3]],
        [KICKOUT_OUTCOME_STACKS[4], KICKOUT_OUTCOME_STACKS[5]],
        [KICKOUT_OUTCOME_STACKS[6], KICKOUT_OUTCOME_STACKS[7]],
      ];
  const possessionGroups = useMemo(() => groupByPossession(calcBase), [calcBase]);
  const kickoutSankeyData = useMemo(
    () => buildKickoutSankeyData({
      kickouts: restartFilteredKickouts,
      groupingMode: kickoutSankeyGrouping,
      nextStatById,
      possessionGroups,
      viewMode: kickoutSankeyViewMode,
      layer2OrderMode: kickoutSankeyLayer2OrderMode,
    }),
    [restartFilteredKickouts, kickoutSankeyGrouping, nextStatById, possessionGroups, kickoutSankeyViewMode, kickoutSankeyLayer2OrderMode]
  );
  const kickoutSankeyHighlight = useMemo(
    () => buildKickoutSankeyHighlight(kickoutSankeyData, selectedKickoutSankeyNodeKey),
    [kickoutSankeyData, selectedKickoutSankeyNodeKey]
  );
  useEffect(() => {
    if (!selectedKickoutSankeyNodeKey) return;
    if (!kickoutSankeyData.nodes.some((node) => node.nodeKey === selectedKickoutSankeyNodeKey)) {
      setSelectedKickoutSankeyNodeKey(null);
    }
  }, [kickoutSankeyData, selectedKickoutSankeyNodeKey]);
  const kickoutSankeyRenderData = useMemo(() => ({
    ...kickoutSankeyData,
    nodes: kickoutSankeyData.nodes.map((node) => ({
      ...node,
      tooltipMatrix: selectedKickoutSankeyNodeKey && kickoutSankeyHighlight.nodeKeys.has(node.nodeKey)
        ? serializeKickoutTooltipMatrix(kickoutSankeyHighlight.nodeMatrices.get(node.nodeKey))
        : node.tooltipMatrix,
      originTotals: selectedKickoutSankeyNodeKey && kickoutSankeyHighlight.nodeKeys.has(node.nodeKey)
        ? serializeKickoutOriginTotals(kickoutSankeyHighlight.nodeOriginTotals.get(node.nodeKey))
        : node.originTotals,
      isSelected: selectedKickoutSankeyNodeKey === node.nodeKey,
      isDimmed: !!selectedKickoutSankeyNodeKey && !kickoutSankeyHighlight.nodeKeys.has(node.nodeKey),
      onSelect: () => setSelectedKickoutSankeyNodeKey((current) => current === node.nodeKey ? null : node.nodeKey),
    })),
    links: kickoutSankeyData.links.map((link) => ({
      ...link,
      highlightValue: kickoutSankeyHighlight.linkValues.get(link.linkKey) || 0,
      isHighlighted: kickoutSankeyHighlight.linkValues.has(link.linkKey),
      isDimmed: !!selectedKickoutSankeyNodeKey && !kickoutSankeyHighlight.linkValues.has(link.linkKey),
    })),
  }), [kickoutSankeyData, kickoutSankeyHighlight, selectedKickoutSankeyNodeKey]);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-stretch">
        <ComparisonMetricsCard
          title="Restart Metrics"
          cardClassName="w-full h-full"
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
              label: 'Opp. Kickout Disruption %',
              home: `${kpis.home.oppDisrupted}/${kpis.home.oppKickoutsTaken} (${formatPct(kpis.home.oppKickoutsTaken ? (kpis.home.oppDisrupted / kpis.home.oppKickoutsTaken) * 100 : NaN)})`,
              away: `${kpis.away.oppDisrupted}/${kpis.away.oppKickoutsTaken} (${formatPct(kpis.away.oppKickoutsTaken ? (kpis.away.oppDisrupted / kpis.away.oppKickoutsTaken) * 100 : NaN)})`,
            },
            {
              label: 'Clean Kickout Win %',
              home: `${kpis.home.ownCleanWon}/${kpis.home.ownKickoutsTaken} (${formatPct(kpis.home.ownKickoutsTaken ? (kpis.home.ownCleanWon / kpis.home.ownKickoutsTaken) * 100 : NaN)})`,
              away: `${kpis.away.ownCleanWon}/${kpis.away.ownKickoutsTaken} (${formatPct(kpis.away.ownKickoutsTaken ? (kpis.away.ownCleanWon / kpis.away.ownKickoutsTaken) * 100 : NaN)})`,
            },
            {
              label: 'Break Win %',
              home: `${kpis.breakWonHome}/${kpis.breakAll} (${formatPct(kpis.breakAll ? (kpis.breakWonHome / kpis.breakAll) * 100 : NaN)})`,
              away: `${kpis.breakWonAway}/${kpis.breakAll} (${formatPct(kpis.breakAll ? (kpis.breakWonAway / kpis.breakAll) * 100 : NaN)})`,
            },
            {
              label: 'Throw-In Win %',
              home: `${kpis.throwInWinHome}/${kpis.throwInsContested} (${formatPct(kpis.throwInsContested ? (kpis.throwInWinHome / kpis.throwInsContested) * 100 : NaN)})`,
              away: `${kpis.throwInWinAway}/${kpis.throwInsContested} (${formatPct(kpis.throwInsContested ? (kpis.throwInWinAway / kpis.throwInsContested) * 100 : NaN)})`,
            },
          ]}
        />
        <Card className={RESTART_PANE_CLASS}>
          <CardContent className="flex h-full flex-col p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="font-semibold text-slate-900">Kickout Outcomes</div>
              <div className="inline-flex rounded-xl bg-slate-100 p-1">
                <Button
                  type="button"
                  variant={kickoutOutcomeMode === 'detailed' ? 'default' : 'outline'}
                  size="sm"
                  className="h-8 px-3 text-xs"
                  onClick={() => setKickoutOutcomeMode('detailed')}
                >
                  Detailed
                </Button>
                <Button
                  type="button"
                  variant={kickoutOutcomeMode === 'simple' ? 'default' : 'outline'}
                  size="sm"
                  className="h-8 px-3 text-xs"
                  onClick={() => setKickoutOutcomeMode('simple')}
                >
                  Simple
                </Button>
              </div>
            </div>
            <div className="flex-1 min-h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={kickoutOutcomeChartRows} layout="vertical" margin={{ top: 8, right: 12, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                  <XAxis type="number" tick={{ fontSize: 12, fill: '#64748b' }} allowDecimals={false} />
                  <YAxis dataKey="label" type="category" tick={{ fontSize: 14, fill: '#0f172a', fontWeight: 700 }} width={108} />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      return (
                        <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                          <div className="mb-2 text-sm font-semibold text-slate-900">{label}</div>
                          <div className="space-y-1">
                            {payload
                              .filter((entry) => Number(entry?.value) > 0)
                              .map((entry) => (
                                <div key={String(entry?.dataKey)} className="flex items-center justify-between gap-3 text-xs text-slate-700">
                                  <span>{entry?.name}</span>
                                  <span className="tabular-nums">{entry?.value}</span>
                                </div>
                              ))}
                          </div>
                        </div>
                      );
                    }}
                  />
                  {kickoutOutcomeStacks.map((entry) => (
                    <Bar
                      key={entry.key}
                      dataKey={entry.key}
                      name={entry.label}
                      stackId="kickout-outcomes"
                      fill={entry.color}
                      radius={entry.key.includes('against') ? [0, 4, 4, 0] : [4, 0, 0, 4]}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className={`grid gap-3 text-[11px] text-slate-700 ${kickoutOutcomeMode === 'simple' ? 'sm:grid-cols-1' : 'sm:grid-cols-4'}`}>
              {kickoutOutcomeLegendColumns.map((column, columnIndex) => (
                <div key={`legend-column-${columnIndex}`} className="space-y-1">
                  {column.map((entry) => (
                    <div key={entry.key} className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
                      <span>{entry.label}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

        {kickoutMapBase.length === 0 ? (
          <Card className={RESTART_PANE_CLASS}>
            <CardContent className="p-6 text-sm text-slate-600 text-center">
              No kickouts available for current filters.
            </CardContent>
          </Card>
        ) : (
          <>
            <Card className={RESTART_PANE_CLASS}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-semibold text-slate-900">Kickout Map</div>
                  <div className="inline-flex rounded-xl bg-slate-100 p-1">
                    <Button
                      type="button"
                      variant={koMapDotsOnly ? 'outline' : 'default'}
                      size="sm"
                      className="h-8 px-3 text-xs"
                      onClick={() => setKoMapDotsOnly(false)}
                    >
                      Lines
                    </Button>
                    <Button
                      type="button"
                      variant={koMapDotsOnly ? 'default' : 'outline'}
                      size="sm"
                      className="h-8 px-3 text-xs"
                      onClick={() => setKoMapDotsOnly(true)}
                    >
                      Dots
                    </Button>
                  </div>
                </div>
                <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2.1fr)_320px]">
                  <div>
                    <PitchViz
                      stats={filteredKickoutMapStats}
                      contextStats={stats}
                      homeColor={homeTeam?.color}
                      awayColor={awayTeam?.color}
                      colorBy={koMapTeam === 'both' ? 'team' : 'outcome'}
                      showColorControls={false}
                      mirrorAwayWhenBoth={koMapTeam !== 'home'}
                      kickoutOutcomeDots={!koMapDotsOnly}
                      kickoutCircleMode={koMapDotsOnly}
                      directionLabel="Home ->"
                      align="left"
                      pitchScale="100%"
                      onOpenVideoAt={onOpenVideoAt}
                    />
                  </div>
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                      <div className="col-span-1">
                        <MultiSelect
                          label="Half"
                          placeholder="All"
                          values={koMapHalves}
                          onChange={setKoMapHalves}
                          options={['first', 'second', 'et_first', 'et_second'].map((v) => ({ value: v, label: toTitleCase(v) }))}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-slate-600">Team</Label>
                        <Select value={koMapTeam} onValueChange={setKoMapTeam}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="both">Both</SelectItem>
                            <SelectItem value="home">{homeTeam?.name || 'Home'}</SelectItem>
                            <SelectItem value="away">{awayTeam?.name || 'Away'}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <MatchTimeRangeSlider
                        className="col-span-2"
                        timeMin={koMapTimeMin}
                        timeMax={koMapTimeMax}
                        match={reportFilters?.match}
                        stats={stats}
                        imputedTimeById={reportFilters?.imputedTimeById}
                        compact
                        onChange={({ timeMin: nextMin, timeMax: nextMax }) => {
                          setKoMapTimeMin(nextMin);
                          setKoMapTimeMax(nextMax);
                        }}
                      />
                      <MultiSelect
                        label="Target"
                        placeholder="All"
                        values={koMapTargets}
                        onChange={setKoMapTargets}
                        options={kickoutTargetOptions}
                      />
                      <MultiSelect
                        label="Outcome"
                        placeholder="All"
                        values={koMapOutcomes}
                        onChange={setKoMapOutcomes}
                        options={[
                          { value: 'clean', label: 'Clean' },
                          { value: 'break', label: 'Break' },
                          { value: 'sideline_for', label: 'Sideline For' },
                          { value: 'sideline_against', label: 'Sideline Against' },
                          { value: 'foul', label: 'Foul' },
                        ]}
                      />
                      <MultiSelect
                        label="Won By"
                        placeholder="All"
                        values={koMapWonBy}
                        onChange={setKoMapWonBy}
                        options={kickoutWonByOptions}
                      />
                      <MultiSelect
                        label="Press"
                        placeholder="All"
                        values={koMapPress}
                        onChange={setKoMapPress}
                        options={[
                          { value: 'm2m', label: 'M2M' },
                          { value: 'zonal', label: 'Zonal' },
                          { value: 'conceded', label: 'Conceded' },
                        ]}
                      />
                      <MultiSelect
                        label="Distance"
                        placeholder="All"
                        values={koMapLengths}
                        onChange={setKoMapLengths}
                        options={[
                          { value: 'short', label: 'Short' },
                          { value: 'long', label: 'Long' },
                        ]}
                      />
                      <MultiSelect
                        label="Direction"
                        placeholder="All"
                        values={koMapSides}
                        onChange={setKoMapSides}
                        options={[
                          { value: 'left', label: 'Left' },
                          { value: 'centre', label: 'Centre' },
                          { value: 'right', label: 'Right' },
                        ]}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      onClick={() => {
                        setKoMapTeam(String(reportFilters?.team || 'both'));
                        setKoMapHalves(Array.isArray(reportFilters?.halves) ? reportFilters.halves : []);
                        setKoMapTimeMin(String(reportFilters?.timeMin ?? ''));
                        setKoMapTimeMax(String(reportFilters?.timeMax ?? ''));
                        setKoMapTargets(Array.isArray(restartTargetFilter) ? restartTargetFilter : []);
                        setKoMapOutcomes([]);
                        setKoMapWonBy(Array.isArray(restartWonByFilter) ? restartWonByFilter : []);
                        setKoMapPress([]);
                        setKoMapLengths(Array.isArray(restartLengthFilter) ? restartLengthFilter : []);
                        setKoMapSides(Array.isArray(restartSideFilter) ? restartSideFilter : []);
                      }}
                    >
                      Clear Filters
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {kickoutPressCards.length > 0 && (
              <Card className={RESTART_PANE_CLASS}>
                <CardContent className="p-4 space-y-3">
                  <div className="font-semibold text-slate-900">Kickout Press Breakdown</div>
                  <div className="grid gap-4 lg:grid-cols-2">
                    {kickoutPressCards.map((card) => (
                      <KickoutPressTable key={card.key} card={card} homeTeam={homeTeam} awayTeam={awayTeam} />
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            <Card className={RESTART_PANE_CLASS}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-semibold text-slate-900">Kickout Targets</div>
                  {sortedKickoutTargets.length > 8 ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 px-2 text-xs"
                      onClick={() => setShowAllKickoutTargets((current) => !current)}
                    >
                      {showAllKickoutTargets ? 'Show Top 8' : 'Expand Table'}
                    </Button>
                  ) : null}
                </div>
                <Table className="table-fixed w-full">
                  <colgroup>
                    <col style={{ width: '110px' }} />
                    <col style={{ width: '170px' }} />
                    <col style={{ width: '72px' }} />
                    <col style={{ width: '92px' }} />
                    <col style={{ width: '78px' }} />
                    <col style={{ width: '82px' }} />
                    <col style={{ width: '82px' }} />
                    <col style={{ width: '78px' }} />
                    <col style={{ width: '82px' }} />
                    <col style={{ width: '82px' }} />
                    <col style={{ width: '78px' }} />
                    <col style={{ width: '78px' }} />
                    <col style={{ width: '70px' }} />
                  </colgroup>
                  <TableHeader>
                    <TableRow>
                      <TableHead rowSpan={2} className="px-2 py-2 align-middle bg-slate-100/70 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">Team</TableHead>
                      <TableHead rowSpan={2} className="px-2 py-2 align-middle border-r-2 border-slate-300 bg-slate-100/70 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">Player</TableHead>
                      <TableHead colSpan={3} className="px-2 py-2 border-r-2 border-slate-300 bg-slate-100/70 text-center text-xs font-semibold uppercase tracking-wide text-slate-600">Targets</TableHead>
                      <TableHead colSpan={8} className="px-2 py-2 bg-slate-50 text-center text-xs font-semibold uppercase tracking-wide text-slate-600">All</TableHead>
                    </TableRow>
                    <TableRow>
                      {targetColumns.filter((column) => column.key !== 'team' && column.key !== 'label').map((column) => (
                        <SortableTableHead
                          key={column.key}
                          column={column}
                          sortState={targetSort}
                          onToggle={toggleTargetSort}
                          className={[
                            'bg-white px-2 py-2 text-[11px] font-semibold text-slate-700',
                            ['targeted', 'won', 'winPct', 'cleanWon', 'cleanLost', 'breakWon', 'breakLost', 'breakPct', 'broken', 'marks'].includes(column.key) ? 'text-right' : '',
                            column.key === 'winPct' ? 'border-r-2 border-slate-300' : '',
                          ].filter(Boolean).join(' ')}
                        />
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(showAllKickoutTargets ? sortedKickoutTargets : sortedKickoutTargets.slice(0, 8)).map((r, idx) => (
                      <TableRow key={`${r.team}-${r.key}-${idx}`} style={teamRowTint(r.team, homeTeam?.color, awayTeam?.color, 0.07)}>
                        <TableCell className="px-2 py-2">{r.team === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home')}</TableCell>
                        <TableCell className="px-2 py-2 border-r-2 border-slate-300 font-medium">{r.label || 'NA'}</TableCell>
                        <TableCell className="px-2 py-2 text-right tabular-nums">{r.targeted}</TableCell>
                        <TableCell className="px-2 py-2 text-right tabular-nums">{r.won}</TableCell>
                        <TableCell className="px-2 py-2 border-r-2 border-slate-300 text-right tabular-nums">{formatPct(r.targeted ? (r.won / r.targeted) * 100 : NaN)}</TableCell>
                        <TableCell className="px-2 py-2 text-right tabular-nums">{r.cleanWon}</TableCell>
                        <TableCell className="px-2 py-2 text-right tabular-nums">{r.cleanLost}</TableCell>
                        <TableCell className="px-2 py-2 text-right tabular-nums">{formatPct((r.cleanWon + r.cleanLost) ? (r.cleanWon / (r.cleanWon + r.cleanLost)) * 100 : NaN)}</TableCell>
                        <TableCell className="px-2 py-2 text-right tabular-nums">{r.breakWon}</TableCell>
                        <TableCell className="px-2 py-2 text-right tabular-nums">{r.breakLost}</TableCell>
                        <TableCell className="px-2 py-2 text-right tabular-nums">{formatPct((r.breakWon + r.breakLost) ? (r.breakWon / (r.breakWon + r.breakLost)) * 100 : NaN)}</TableCell>
                        <TableCell className="px-2 py-2 text-right tabular-nums">{r.broken}</TableCell>
                        <TableCell className="px-2 py-2 text-right tabular-nums">{r.marks}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card className={RESTART_PANE_CLASS}>
              <CardContent className="p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="font-semibold text-slate-900">Kickout Flow</div>
                    <div className="text-xs text-slate-500">Kickout grouping to immediate outcome, post-win possession outcome, and shot result.</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="space-y-1">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Team</div>
                      <div className="inline-flex rounded-xl bg-slate-100 p-1">
                        <Button
                          type="button"
                          variant={kickoutSankeyTeam === 'home' ? 'default' : 'outline'}
                          size="sm"
                          className="h-8 px-3 text-xs"
                          onClick={() => setKickoutSankeyTeam('home')}
                        >
                          {homeTeam?.name || 'Home'}
                        </Button>
                        <Button
                          type="button"
                          variant={kickoutSankeyTeam === 'away' ? 'default' : 'outline'}
                          size="sm"
                          className="h-8 px-3 text-xs"
                          onClick={() => setKickoutSankeyTeam('away')}
                          >
                            {awayTeam?.name || 'Away'}
                          </Button>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Style</div>
                      <div className="inline-flex rounded-xl bg-slate-100 p-1">
                        <Button
                          type="button"
                          variant={kickoutSankeyViewMode === 'full' ? 'default' : 'outline'}
                          size="sm"
                          className="h-8 px-3 text-xs"
                          onClick={() => setKickoutSankeyViewMode('full')}
                        >
                          Full
                        </Button>
                        <Button
                          type="button"
                          variant={kickoutSankeyViewMode === 'end' ? 'default' : 'outline'}
                          size="sm"
                          className="h-8 px-3 text-xs"
                          onClick={() => setKickoutSankeyViewMode('end')}
                        >
                          End Result
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Filter</div>
                      <div className="inline-flex rounded-xl bg-slate-100 p-1">
                        {KICKOUT_SANKEY_GROUPING_OPTIONS.map((option) => (
                          <Button
                            key={option.value}
                            type="button"
                            variant={kickoutSankeyGrouping === option.value ? 'default' : 'outline'}
                            size="sm"
                            className="h-8 px-3 text-xs"
                            onClick={() => setKickoutSankeyGrouping(option.value)}
                          >
                            {option.label}
                          </Button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
                {kickoutSankeyRenderData.totalKickouts > 0 && kickoutSankeyRenderData.links.length > 0 ? (
                  <>
                    <div className="h-[420px] w-full overflow-visible">
                      <ResponsiveContainer width="100%" height="100%">
                        <Sankey
                          data={kickoutSankeyRenderData}
                          nodePadding={26}
                          nodeWidth={18}
                          margin={{ top: 16, right: 100, bottom: 16, left: 120 }}
                          linkCurvature={0.45}
                          sort={false}
                          node={KickoutSankeyNode}
                          link={KickoutSankeyLink}
                        >
                          <Tooltip content={KickoutSankeyTooltip} />
                        </Sankey>
                      </ResponsiveContainer>
                    </div>
                    {kickoutSankeyViewMode === 'full' ? (
                      <div className="flex pt-1 pl-[34%]">
                        <div className="text-center">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 px-3 text-xs"
                            onClick={() => setKickoutSankeyLayer2OrderMode((current) => current === 'grouped' ? 'paired' : 'grouped')}
                          >
                            Sort: {kickoutSankeyLayer2OrderMode === 'grouped' ? 'Won/Lost' : 'Paired'}
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-300 bg-white/80 px-4 py-10 text-center text-sm text-slate-600">
                    No kickout flow available for current filters.
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className={RESTART_PANE_CLASS}>
              <CardContent className="p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="font-semibold text-slate-900">Kickout Value</div>
                    <div className="text-xs text-slate-500">First-shot value signed relative to the kicking team, shown per kickout chain.</div>
                  </div>
                  <div className="inline-flex rounded-xl bg-slate-100 p-1">
                    {KICKOUT_VALUE_GROUPING_OPTIONS.map((option) => (
                      <Button
                        key={option.value}
                        type="button"
                        variant={kickoutValueGrouping === option.value ? 'default' : 'outline'}
                        size="sm"
                        className="h-8 px-3 text-xs"
                        onClick={() => setKickoutValueGrouping(option.value)}
                      >
                        {option.label}
                      </Button>
                    ))}
                  </div>
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  {[
                    { side: 'home', title: homeTeam?.name || 'Home', rows: kickoutValueRowsHome },
                    { side: 'away', title: awayTeam?.name || 'Away', rows: kickoutValueRowsAway },
                  ].map((panel) => (
                    <div key={panel.side} className="rounded-xl border border-slate-200 bg-white/80 p-3 space-y-3">
                      <div className="font-semibold text-slate-900">{panel.title}</div>
                      {panel.rows.length ? (
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Group</TableHead>
                              <TableHead className="text-right">Number</TableHead>
                              <TableHead className="text-right">Net xPPP</TableHead>
                              <TableHead className="text-right">Net PPP</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {panel.rows.map((row) => (
                              <TableRow key={`${panel.side}-${row.group}`}>
                                <TableCell className="font-medium">{row.group}</TableCell>
                                <TableCell className="text-right tabular-nums">{row.n}</TableCell>
                                <TableCell className="text-right tabular-nums">{row.netXpPerPoss.toFixed(2)}</TableCell>
                                <TableCell className="text-right tabular-nums">{row.netPppPerPoss.toFixed(2)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      ) : (
                        <div className="rounded-xl border border-dashed border-slate-300 bg-white/80 px-4 py-6 text-center text-sm text-slate-600">
                          No kickout value rows available.
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </>
        )}
    </div>
  );
}


export default RestartsTab;

