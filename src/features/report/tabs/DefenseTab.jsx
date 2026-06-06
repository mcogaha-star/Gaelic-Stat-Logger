import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ChartContainer, ChartTooltipContent } from '@/components/ui/chart';
import { BarChart, Bar, CartesianGrid, Legend, LineChart, Line, PieChart, Pie, Cell, Tooltip, ReferenceLine, XAxis, YAxis, ResponsiveContainer, Sankey } from 'recharts';
import pitchImg from '@/assets/pitch.png';
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
  shouldExcludeFromTotals,
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
  MultiSelect,
  MatchTimeRangeSlider,
  groupByPossession,
  derivePossessionOutcome,
  inferPossessionStartSource,
  deriveCounterAttackState,
  getCompletedReceiptSelection,
  getPrimaryActorSelection,
  getKeeperCandidate,
  isGoalkeeperPlayer,
  buildShotAssistCredits,
  buildDefensiveActions,
  buildTouchesMap,
  getPossessionStartZone,
  selectionKey,
  normalizePlayerRef,
  ComparisonMetricsCard,
  DirectionBadge,
  FullscreenMapShell,
  TouchMap,
  AttackChannelPitch,
  PassNetwork,
  ShotMap,
  shotSideFromY,
  shotZoneFromDistance,
  applyNonTeamReportFilters,
} from '../shared';

const DEFENSE_PANE_CLASS = 'border-2 border-slate-400 bg-gradient-to-br from-slate-50 via-white to-white shadow-md';
const DEFENSE_SANKEY_GROUPING_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'type', label: 'Type' },
  { value: 'zone', label: 'Zone' },
];
const DEFENSE_SANKEY_TYPE_ORDER = ['Tackle', 'Group Tackle', 'Interception', 'Foul', 'Sideline Against'];
const DEFENSE_SANKEY_ZONE_ORDER = ['Def', 'Mid', 'Att'];
const DEFENSE_SANKEY_HIDDEN_LAYER3_SINK = '__defense_layer3_sink__';
const DEFENSE_SANKEY_LAYER_ORDER = {
  2: ['Shot', 'TO Lost'],
  3: ['Score', 'Miss', DEFENSE_SANKEY_HIDDEN_LAYER3_SINK],
};
const DEFENSE_OUTCOME_TO_SHOT_RESULT = {
  Score: 'Score',
  Wide: 'Miss',
  Short: 'Miss',
  Blocked: 'Miss',
  Saved: 'Miss',
  Post: 'Miss',
};
const DEFENSE_TURNOVER_TYPE_PALETTE = ['#2563eb', '#0f766e', '#7c3aed', '#d97706', '#dc2626', '#64748b', '#16a34a', '#db2777'];
const DEFENSE_ZONE_BREAKDOWN_SERIES = [
  { key: 'Def', color: '#2563eb' },
  { key: 'Mid', color: '#f59e0b' },
  { key: 'Att', color: '#dc2626' },
  { key: 'Unknown', color: '#94a3b8' },
];

function getShotXpValue(stat) {
  const extra = safeParseJSON(stat?.extra_data || '{}', {});
  const shot = extra?.shot || {};
  const xpRaw = shot?.xp?.value ?? shot?.expected_points ?? shot?.expectedPoints ?? shot?.xp ?? shot?.xP ?? null;
  const xp = Number(xpRaw);
  return Number.isFinite(xp) ? xp : 0;
}

function getDefenseSankeyNodeFill(name, layer) {
  if (layer === 1) return '#334155';
  if (layer === 2) {
    if (name === 'Shot') return '#7c3aed';
    if (name === 'TO Lost') return '#f97316';
  }
  if (layer === 3) return name === 'Score' ? '#16a34a' : '#dc2626';
  return '#475569';
}

function isHiddenDefenseSankeyNode(name) {
  return name === DEFENSE_SANKEY_HIDDEN_LAYER3_SINK;
}

function defenseSankeyNodeKeyToName(nodeKey) {
  return String(nodeKey || '').split(':').slice(1).join(':');
}

function createDefenseTooltipMatrix() {
  return {
    inputs: new Set(),
    outputs: new Set(),
    grid: new Map(),
    total: 0,
  };
}

function bumpDefenseTooltipMatrix(matrices, nodeName, inputName, outputName, count = 1) {
  if (!nodeName) return;
  const current = matrices.get(nodeName) || createDefenseTooltipMatrix();
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

function serializeDefenseTooltipMatrix(matrix) {
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

function serializeDefenseOriginTotals(originMap) {
  return Array.from((originMap || new Map()).entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || String(a.label).localeCompare(String(b.label)));
}

function getTurnoverZoneLabel(stat, winningSide, match, possessionGroups) {
  const possessionEvents = possessionGroups?.get(String(stat?.id || '')) || [];
  const startZone = getPossessionStartZone(possessionEvents, {
    startSource: 'Turnover Won',
    previousStat: stat,
    teamSide: winningSide,
    match,
  });
  if (startZone === 'Defensive Third') return 'Def';
  if (startZone === 'Middle Third') return 'Mid';
  if (startZone === 'Attacking Third') return 'Att';
  return 'Unknown';
}

function buildDefenseSankeyData({ turnovers, teamSide, groupingMode, possessionGroups, classifyTurnover, match }) {
  const nodeIndex = new Map();
  const nodes = [];
  const linkValues = new Map();
  const nodeMatrices = new Map();
  const nodeOriginTotals = new Map();
  const flowPaths = [];

  const addNode = (layer, name) => {
    const key = `${layer}:${name}`;
    if (nodeIndex.has(key)) return key;
    nodeIndex.set(key, nodes.length);
    nodes.push({ name, layer, nodeKey: key, color: getDefenseSankeyNodeFill(name, layer) });
    return key;
  };
  const hiddenSinkKey = `3:${DEFENSE_SANKEY_HIDDEN_LAYER3_SINK}`;

  const addLink = (sourceKey, targetKey, count = 1) => {
    const linkKey = `${sourceKey}->${targetKey}`;
    linkValues.set(linkKey, (linkValues.get(linkKey) || 0) + count);
  };
  const getOrderedGroupName = (rawName) => {
    if (groupingMode === 'type') {
      return DEFENSE_SANKEY_TYPE_ORDER.includes(rawName) ? rawName : 'Other';
    }
    if (groupingMode === 'zone') {
      return DEFENSE_SANKEY_ZONE_ORDER.includes(rawName) ? rawName : 'Other';
    }
    return rawName;
  };

  const turnoverList = (Array.isArray(turnovers) ? turnovers : [])
    .filter((stat) => classifyTurnover(stat).rec === teamSide)
    .sort((a, b) => {
      const aClass = classifyTurnover(a);
      const bClass = classifyTurnover(b);
      const aType = toTitleCase(normalizeFoulType(String(aClass.typ || 'unknown')));
      const bType = toTitleCase(normalizeFoulType(String(bClass.typ || 'unknown')));
      const aZone = getTurnoverZoneLabel(a, teamSide, match, possessionGroups);
      const bZone = getTurnoverZoneLabel(b, teamSide, match, possessionGroups);
      const aGroup = groupingMode === 'type'
        ? (DEFENSE_SANKEY_TYPE_ORDER.indexOf(aType) === -1 ? 999 : DEFENSE_SANKEY_TYPE_ORDER.indexOf(aType))
        : groupingMode === 'zone'
          ? (DEFENSE_SANKEY_ZONE_ORDER.indexOf(aZone) === -1 ? 999 : DEFENSE_SANKEY_ZONE_ORDER.indexOf(aZone))
          : 0;
      const bGroup = groupingMode === 'type'
        ? (DEFENSE_SANKEY_TYPE_ORDER.indexOf(bType) === -1 ? 999 : DEFENSE_SANKEY_TYPE_ORDER.indexOf(bType))
        : groupingMode === 'zone'
          ? (DEFENSE_SANKEY_ZONE_ORDER.indexOf(bZone) === -1 ? 999 : DEFENSE_SANKEY_ZONE_ORDER.indexOf(bZone))
          : 0;
      if (aGroup !== bGroup) return aGroup - bGroup;
      const aPlay = Number(a?.play_id);
      const bPlay = Number(b?.play_id);
      if (Number.isFinite(aPlay) && Number.isFinite(bPlay) && aPlay !== bPlay) return aPlay - bPlay;
      return String(a?.id || '').localeCompare(String(b?.id || ''));
    });
  turnoverList.forEach((stat) => {
    const classification = classifyTurnover(stat);
    const typeLabel = toTitleCase(normalizeFoulType(String(classification.typ || 'unknown')));
    const rawGroupName = groupingMode === 'type'
      ? typeLabel
      : groupingMode === 'zone'
        ? getTurnoverZoneLabel(stat, teamSide, match, possessionGroups)
        : 'All Turnovers Won';
    const groupName = getOrderedGroupName(rawGroupName);

    const possessionEvents = possessionGroups.get(String(stat?.id || '')) || [];
    const groupedOutcome = derivePossessionOutcome(possessionEvents, teamSide);

    let layer2 = 'TO Lost';
    let layer3 = null;
    if (DEFENSE_OUTCOME_TO_SHOT_RESULT[groupedOutcome]) {
      layer2 = 'Shot';
      layer3 = DEFENSE_OUTCOME_TO_SHOT_RESULT[groupedOutcome];
    }

    const layer1Key = addNode(1, groupName);
    const layer2Key = addNode(2, layer2);
    const path = [layer1Key, layer2Key];
    if (layer3) {
      path.push(addNode(3, layer3));
    } else {
      addNode(3, DEFENSE_SANKEY_HIDDEN_LAYER3_SINK);
    }
    flowPaths.push({ nodes: path, value: 1 });

    const originLabel = defenseSankeyNodeKeyToName(path[0]);
    for (let i = 0; i < path.length; i += 1) {
      const nodeKey = path[i];
      const nodeName = defenseSankeyNodeKeyToName(nodeKey);
      if (!nodeOriginTotals.has(nodeKey)) nodeOriginTotals.set(nodeKey, new Map());
      const origins = nodeOriginTotals.get(nodeKey);
      origins.set(originLabel, (origins.get(originLabel) || 0) + 1);
      bumpDefenseTooltipMatrix(
        nodeMatrices,
        nodeName,
        i > 0 ? defenseSankeyNodeKeyToName(path[i - 1]) : null,
        i < path.length - 1 ? defenseSankeyNodeKeyToName(path[i + 1]) : null,
        1
      );
    }
  });

  flowPaths.forEach((flow) => {
    for (let i = 0; i < flow.nodes.length - 1; i += 1) {
      addLink(flow.nodes[i], flow.nodes[i + 1], flow.value);
    }
    if (flow.nodes.length === 2) {
      addLink(flow.nodes[1], hiddenSinkKey, flow.value);
    }
  });

  const getLayerOrder = (layer) => {
    if (layer === 1) {
      if (groupingMode === 'all') return ['All Turnovers Won'];
      if (groupingMode === 'type') return [...DEFENSE_SANKEY_TYPE_ORDER, 'Other'];
      if (groupingMode === 'zone') return [...DEFENSE_SANKEY_ZONE_ORDER, 'Other'];
    }
    return DEFENSE_SANKEY_LAYER_ORDER[layer] || [];
  };

  const orderedNodes = nodes
    .map((node, originalIndex) => ({ ...node, originalIndex }))
    .sort((a, b) => {
      if (a.layer !== b.layer) return a.layer - b.layer;
      const order = getLayerOrder(a.layer);
      const ai = order.indexOf(a.name);
      const bi = order.indexOf(b.name);
      const aPos = ai === -1 ? Number.MAX_SAFE_INTEGER : ai;
      const bPos = bi === -1 ? Number.MAX_SAFE_INTEGER : bi;
      if (aPos !== bPos) return aPos - bPos;
      return a.originalIndex - b.originalIndex;
    });
  const orderedIndexByKey = new Map(orderedNodes.map((node, index) => [node.nodeKey, index]));

  const mergedLinks = Array.from(linkValues.entries()).map(([linkKey, value]) => {
    const [sourceKey, targetKey] = linkKey.split('->');
    return {
      source: orderedIndexByKey.get(sourceKey),
      target: orderedIndexByKey.get(targetKey),
      value,
      linkKey,
      sourceKey,
      targetKey,
      sourceName: defenseSankeyNodeKeyToName(sourceKey),
      targetName: defenseSankeyNodeKeyToName(targetKey),
      targetLayer: Number(String(targetKey).split(':')[0]),
    };
  });

  return {
    nodes: orderedNodes.map((node) => ({
      ...node,
      tooltipMatrix: serializeDefenseTooltipMatrix(nodeMatrices.get(node.name)),
      originTotals: serializeDefenseOriginTotals(nodeOriginTotals.get(node.nodeKey)),
    })),
    links: mergedLinks,
    flowPaths,
    totalTurnovers: turnoverList.length,
  };
}

function buildDefenseSankeyHighlight(data, selectedNodeKey) {
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
    const originLabel = defenseSankeyNodeKeyToName(nodes[0]);
    for (let i = 0; i < nodes.length; i += 1) {
      const nodeKey = nodes[i];
      const nodeName = defenseSankeyNodeKeyToName(nodeKey);
      nodeKeys.add(nodeKey);
      if (!nodeOriginTotals.has(nodeKey)) nodeOriginTotals.set(nodeKey, new Map());
      const origins = nodeOriginTotals.get(nodeKey);
      origins.set(originLabel, (origins.get(originLabel) || 0) + count);
      bumpDefenseTooltipMatrix(
        nodeMatrices,
        nodeName,
        i > 0 ? defenseSankeyNodeKeyToName(nodes[i - 1]) : null,
        i < nodes.length - 1 ? defenseSankeyNodeKeyToName(nodes[i + 1]) : null,
        count
      );
      if (i < nodes.length - 1) {
        const linkKey = `${nodes[i]}->${nodes[i + 1]}`;
        linkValues.set(linkKey, (linkValues.get(linkKey) || 0) + count);
      }
    }
  });
  return { nodeKeys, linkValues, nodeMatrices, nodeOriginTotals };
}

function DefenseSankeyNode(props) {
  const { x, y, width, height, index, payload } = props;
  if (isHiddenDefenseSankeyNode(payload?.name)) return <g key={`def-node-${index}`} />;
  const fill = getDefenseSankeyNodeFill(payload?.name, payload?.layer);
  return (
    <g
      key={`def-node-${index}`}
      onClick={payload?.onSelect ? (event) => { event.stopPropagation(); payload.onSelect(payload); } : undefined}
      style={{ cursor: payload?.onSelect ? 'pointer' : 'default' }}
    >
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={4}
        fill={fill}
        fillOpacity={payload?.isDimmed ? 0.18 : (payload?.isSelected ? 1 : 0.9)}
        stroke={payload?.isSelected ? '#0f172a' : '#ffffff'}
        strokeWidth={payload?.isSelected ? 2 : 1.2}
      />
      <text
        x={x + ((payload?.depth ?? 0) === 0 ? width + 8 : -8)}
        y={y + (height / 2)}
        textAnchor={(payload?.depth ?? 0) === 0 ? 'start' : 'end'}
        dominantBaseline="middle"
        fontSize={12}
        fontWeight={600}
        fill={payload?.isDimmed ? '#94a3b8' : '#0f172a'}
      >
        {payload?.name}
      </text>
    </g>
  );
}

function DefenseSankeyLink(props) {
  const { sourceX, targetX, sourceY, targetY, sourceControlX, targetControlX, linkWidth, payload } = props;
  if (isHiddenDefenseSankeyNode(payload?.target?.name) || isHiddenDefenseSankeyNode(payload?.source?.name)) return null;
  const color = payload?.target?.color || getDefenseSankeyNodeFill(payload?.targetName, payload?.targetLayer) || '#cbd5e1';
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

function DefenseSankeyTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const entry = payload[0] || {};
  const item = entry?.payload || entry;
  const sourceName = item?.source?.name || item?.payload?.source?.name || item?.sourceName || '';
  const targetName = item?.target?.name || item?.payload?.target?.name || item?.targetName || '';
  const nodeName = item?.name || item?.payload?.name || '';
  if (isHiddenDefenseSankeyNode(sourceName) || isHiddenDefenseSankeyNode(targetName) || isHiddenDefenseSankeyNode(nodeName)) return null;
  const value = Number(item?.value ?? item?.payload?.value ?? entry?.value ?? 0);
  const filteredValue = Number(item?.highlightValue ?? item?.payload?.highlightValue ?? value);
  const displayValue = item?.isHighlighted ? filteredValue : value;
  if (sourceName && targetName) {
    return (
      <div className="rounded-xl border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
        <div className="font-medium text-slate-900">{sourceName} -&gt; {targetName}</div>
        <div className="mt-1 flex justify-between gap-4">
          <span className="text-muted-foreground">Turnovers</span>
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

function DefensiveActionLegend() {
  const items = [
    { label: 'Turnover Won', category: 'turnover' },
    { label: 'Foul', category: 'foul' },
    { label: 'High Pressure', category: 'pressure' },
  ];
  const renderGlyph = (category) => {
    if (category === 'turnover') return <div className="h-3 w-3 rotate-45 rounded-[2px] border border-slate-700 bg-slate-700" />;
    if (category === 'foul') return <div className="h-3 w-3 rounded-[2px] border border-slate-700 bg-slate-700" />;
    return <div className="h-3 w-3 rounded-full border border-slate-700 bg-slate-700" />;
  };
  return (
    <div className="flex flex-wrap gap-3 text-[11px] text-slate-700">
      {items.map((item) => (
        <div key={item.label} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 shadow-sm">
          {renderGlyph(item.category)}
          <div className="leading-tight">{item.label}</div>
        </div>
      ))}
    </div>
  );
}

function formatDefenseTeamLabel(side, homeTeamName, awayTeamName) {
  if (side === 'home') return homeTeamName || 'Home';
  if (side === 'away') return awayTeamName || 'Away';
  return 'Unknown';
}

function formatDefenseActionCategoryLabel(action) {
  const primaryCategory = action?.primaryCategory || action?.actionCategory;
  if (primaryCategory === 'turnover') return 'Turnover Won';
  if (primaryCategory === 'pressure') return 'High Pressure';
  if (primaryCategory === 'technical_foul' || primaryCategory === 'offensive_foul' || action?.isTechnicalFoul || action?.isOffensiveFoul) return 'Technical/Offensive Foul';
  return 'Foul';
}

function formatDefenseClock(stat, match, imputedTimeById) {
  const matchTime = getMatchTimeS(stat, match, imputedTimeById);
  if (Number.isFinite(matchTime)) return formatMMSS(matchTime);
  const raw = Number(stat?.time_s);
  return Number.isFinite(raw) ? formatMMSS(raw) : 'NA';
}

function buildDefenseTooltipText(action, homeTeamName, awayTeamName, match, imputedTimeById) {
  const lines = [];
  lines.push(`Team: ${formatDefenseTeamLabel(action?.teamSide, homeTeamName, awayTeamName)}`);
  lines.push(`Half: ${toTitleCase(action?.half || 'NA')}`);
  lines.push(`Time: ${formatDefenseClock(action?.stat, match, imputedTimeById)}`);
  lines.push(`Action: ${formatDefenseActionCategoryLabel(action)}`);
  lines.push(`Type: ${toTitleCase(action?.turnoverType || action?.foulType || action?.pressure || 'NA')}`);
  if (action?.primaryCategory === 'pressure') lines.push(`Defender: ${action?.defenderLabel || 'NA'}`);
  if (action?.primaryCategory === 'turnover') {
    lines.push(`Forced By: ${action?.forcedByLabel || 'None'}`);
    lines.push(`Recovered By: ${action?.recoveredByLabel || 'None'}`);
    lines.push(`Lost By: ${action?.lostByLabel || 'NA'}`);
  }
  if (action?.primaryCategory !== 'pressure' && action?.primaryCategory !== 'turnover') {
    lines.push(`Fouled By: ${action?.fouledByLabel || 'NA'}`);
  }
  if (Number.isFinite(Number(action?.stat?.play_id))) lines.push(`Play: ${Number(action.stat.play_id)}`);
  if (Number.isFinite(Number(action?.stat?.possession_id))) lines.push(`Poss: ${Number(action.stat.possession_id)}`);
  return lines.join('\n');
}

function DefensiveActionMap({
  actions,
  homeColor,
  awayColor,
  homeTeamName,
  awayTeamName,
  match,
  imputedTimeById,
  onOpenVideoAt,
}) {
  const renderMarker = (action, isFullscreen = false) => {
    const x = Number(action?.displayX);
    const y = Number(action?.displayY);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const color = action?.teamSide === 'away' ? (awayColor || '#ef4444') : (homeColor || '#22c55e');
    const category = String(action?.primaryCategory || action?.actionCategory || '');
    const size = isFullscreen ? 2.1 : 1.8;
    const technical = !!action?.isTechnicalFoul;
    const tip = buildDefenseTooltipText(action, homeTeamName, awayTeamName, match, imputedTimeById);
    const commonProps = {
      onDoubleClick: (event) => {
        event.stopPropagation();
        const timeS = Number(action?.stat?.time_s);
        if (Number.isFinite(timeS)) onOpenVideoAt?.(timeS);
      },
    };
    if (category === 'turnover') {
      return (
        <g key={action.key} {...commonProps}>
          <title>{tip}</title>
          <rect
            x={x - size}
            y={y - size}
            width={size * 2}
            height={size * 2}
            transform={`rotate(45 ${x} ${y})`}
            fill={color}
            stroke="#0f172a"
            strokeWidth={0.25}
            opacity="0.92"
          />
        </g>
      );
    }
    if (category === 'foul' || category === 'technical_foul' || category === 'offensive_foul') {
      return (
        <g key={action.key} {...commonProps}>
          <title>{tip}</title>
          <rect
            x={x - size}
            y={y - size}
            width={size * 2}
            height={size * 2}
            rx={0.4}
            fill={color}
            stroke="#0f172a"
            strokeWidth={0.25}
            strokeDasharray={technical || action?.isOffensiveFoul ? '1 0.8' : undefined}
            opacity="0.95"
          />
        </g>
      );
    }
    return (
      <g key={action.key} {...commonProps}>
        <title>{tip}</title>
        <circle cx={x} cy={y} r={size} fill={color} stroke="#0f172a" strokeWidth={0.25} opacity="0.92" />
      </g>
    );
  };

  return (
    <div className="space-y-3">
      <FullscreenMapShell title="Defensive Action Map">
        {(isFullscreen) => (
          <div className={`w-full overflow-hidden ${isFullscreen ? '' : 'rounded-xl border border-slate-200 bg-white'}`}>
            <div
              data-fullscreen-trigger="true"
              className={`relative ${isFullscreen ? 'mx-auto w-full' : 'mr-auto'}`}
              style={{
                width: isFullscreen ? undefined : '100%',
                aspectRatio: `${PITCH_W} / ${PITCH_H}`,
                backgroundImage: `url(${pitchImg})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }}
            >
              <DirectionBadge label="Home ->" />
              <svg className="absolute inset-0 h-full w-full" viewBox={`-5 -5 ${PITCH_W + 10} ${PITCH_H + 10}`} preserveAspectRatio="none">
                {actions.map((action) => renderMarker(action, isFullscreen))}
              </svg>
            </div>
          </div>
        )}
      </FullscreenMapShell>
      <DefensiveActionLegend />
      <div className="text-[11px] text-slate-500">Colours show team; shapes show defensive action category.</div>
    </div>
  );
}

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
  const analysisFilters = useMemo(() => ({ ...reportFilters, team: 'both', allowedActionTypes: ['turnover', 'foul', 'pass', 'carry', 'shot'] }), [reportFilters]);
  const base = useMemo(() => applyNonTeamReportFilters(stats, analysisFilters), [stats, analysisFilters]);
  const calcBase = useMemo(() => base.filter((s) => !shouldExcludeFromTotals(s)), [base]);
  const teamMode = String(reportFilters?.team || 'both');
  const [defMapTeam, setDefMapTeam] = useState(String(reportFilters?.team || 'both'));
  const [defMapHalves, setDefMapHalves] = useState(Array.isArray(reportFilters?.halves) ? reportFilters.halves : []);
  const [defMapTimeMin, setDefMapTimeMin] = useState(String(reportFilters?.timeMin ?? ''));
  const [defMapTimeMax, setDefMapTimeMax] = useState(String(reportFilters?.timeMax ?? ''));
  const [defenseSankeyGrouping, setDefenseSankeyGrouping] = useState('all');
  const [defenseSankeyTeam, setDefenseSankeyTeam] = useState(String(reportFilters?.team || '') === 'away' ? 'away' : 'home');
  const [selectedDefenseSankeyNodeKeys, setSelectedDefenseSankeyNodeKeys] = useState({ home: null, away: null });
  const [turnoverBreakdownType, setTurnoverBreakdownType] = useState('');
  const [turnoverBreakdownOpen, setTurnoverBreakdownOpen] = useState(false);

  const turnovers = useMemo(() => base.filter((s) => s?.stat_type === 'turnover' || (safeParseJSON(s?.extra_data || '{}', {})?.turnover)), [base]);
  const calcTurnovers = useMemo(() => calcBase.filter((s) => s?.stat_type === 'turnover' || (safeParseJSON(s?.extra_data || '{}', {})?.turnover)), [calcBase]);
  const defensiveActions = useMemo(() => buildDefensiveActions(calcBase, { match: reportFilters?.match }), [calcBase, reportFilters?.match]);
  const fouls = useMemo(() => calcBase.filter((s) => !!extractFoulFromStat(s)), [calcBase]);
  const scorableFreeRows = useMemo(() => findScorableFreeConcededRows(calcBase), [calcBase]);
  const orderedBase = useMemo(() => {
    const list = [...calcBase];
    list.sort((a, b) => {
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
    return list;
  }, [calcBase]);
  const previousByPossessionKey = useMemo(() => {
    const map = new Map();
    orderedBase.forEach((stat, index) => {
      const pid = Number(stat?.possession_id);
      const pside = stat?.possession_team_side;
      if (!Number.isFinite(pid) || (pside !== 'home' && pside !== 'away')) return;
      const key = `${pside}-${pid}`;
      if (!map.has(key)) {
        map.set(key, index > 0 ? orderedBase[index - 1] : null);
      }
    });
    return map;
  }, [orderedBase]);
  const turnoverWonPossessionsByTurnoverId = useMemo(() => {
    const groups = groupByPossession(calcBase);
    const map = new Map();
    for (const [key, evs] of groups.entries()) {
      const [teamSide] = String(key).split('-');
      const previousStat = previousByPossessionKey.get(key) || null;
      const startSource = inferPossessionStartSource(evs, teamSide, previousStat || []);
      if (startSource === 'Turnover Won' && previousStat?.id) {
        map.set(String(previousStat.id), evs);
      }
    }
    return map;
  }, [calcBase, previousByPossessionKey]);

  const classifyTurnover = (s) => {
    const ex = safeParseJSON(s?.extra_data || '{}', {});
    const t = ex?.turnover || {};
    const foul = extractFoulFromStat(s);
    const lost = t?.lost_by?.team_side || foul?.foul_by?.team_side || null;
    const typ = String(t?.type || t?.turnover_type || ex?.turnover_type || foul?.foul_type || '');
    const normalizedType = normalizeFoulType(typ);
    const rec = normalizedType === 'foul'
      ? (foul?.foul_on_or_forced_by?.team_side || foul?.foul_on?.team_side || t?.forced_by?.team_side || null)
      : (t?.recovered_by?.team_side || t?.forced_by?.team_side || foul?.foul_on_or_forced_by?.team_side || foul?.foul_on?.team_side || null);
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
      const teamMetricActions = defensiveActions.teamActions.filter((action) => action.teamSide === teamSide && action.metricIncluded);
      const firstContactByPossession = new Map();
      teamMetricActions.forEach((action) => {
        const pid = Number(action?.stat?.possession_id);
        const pside = action?.stat?.possession_team_side;
        if (!Number.isFinite(pid) || (pside !== 'home' && pside !== 'away')) return;
        const key = `${pside}-${pid}`;
        const actionTime = getMatchTimeS(action?.stat, reportFilters?.match, reportFilters?.imputedTimeById);
        const current = firstContactByPossession.get(key);
        if (!current) {
          firstContactByPossession.set(key, { action, actionTime });
          return;
        }
        const currentTime = Number(current?.actionTime);
        if (Number.isFinite(actionTime) && (!Number.isFinite(currentTime) || actionTime < currentTime)) {
          firstContactByPossession.set(key, { action, actionTime });
        }
      });
      const firstContactXs = Array.from(firstContactByPossession.values())
        .map((entry) => Number(entry?.action?.displayX))
        .filter(Number.isFinite);
      const avgFirstContactHeight = firstContactXs.length ? (firstContactXs.reduce((a, b) => a + b, 0) / firstContactXs.length) : NaN;

      const byPoss = groupByPossession(calcBase);
      const regainedPossessions = [];
      for (const s of calcTurnovers) {
        const c = classifyTurnover(s);
        if (c.rec !== teamSide) continue;
        const evs = turnoverWonPossessionsByTurnoverId.get(String(s?.id || ''));
        if (evs?.length) regainedPossessions.push(evs);
      }
      const pointsFrom = regainedPossessions.reduce((sum, evs) => sum + evs.reduce((acc, e) => {
        if (e.team_side !== teamSide || e.stat_type !== 'shot' || shouldExcludeFromTotals(e)) return acc;
        const ex = safeParseJSON(e.extra_data || '{}', {});
        return acc + shotPointsForOutcome(ex?.shot?.outcome);
      }, 0), 0);
      const xpFrom = regainedPossessions.reduce((sum, evs) => sum + evs.reduce((acc, e) => {
        if (e.team_side !== teamSide || e.stat_type !== 'shot' || shouldExcludeFromTotals(e)) return acc;
        return acc + getShotXpValue(e);
      }, 0), 0);

      const oppSide = teamSide === 'home' ? 'away' : 'home';
      const oppCompletedPasses = calcBase.filter((s) => {
        if (s?.stat_type !== 'pass' || s?.team_side !== oppSide) return false;
        const ex = safeParseJSON(s.extra_data || '{}', {});
        return deriveOutcome(s, ex) === 'completed';
      }).length;
      const defActionCount = teamMetricActions.length;
      const oppPossessionCount = Array.from(byPoss.keys()).filter((k) => String(k).startsWith(`${oppSide}-`)).length;

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
        if (e.team_side !== oppSide || e.stat_type !== 'shot' || shouldExcludeFromTotals(e)) return false;
        const ex = safeParseJSON(e.extra_data || '{}', {});
        return shotOutcomeGroup(ex?.shot?.outcome) === 'score';
      })).length;
      const shotsConceded = calcBase.filter((s) => s?.stat_type === 'shot' && s?.team_side === oppSide && !shouldExcludeFromTotals(s)).length;
      const xpConceded = calcBase.reduce((sum, s) => {
        if (s?.stat_type !== 'shot' || s?.team_side !== oppSide || shouldExcludeFromTotals(s)) return sum;
        return sum + getShotXpValue(s);
      }, 0);

      const foulConceded = fouls.filter((s) => extractFoulFromStat(s)?.foul_by?.team_side === teamSide).length;
      const scorableFreesConceded = scorableFreeRows.filter((row) => row?.concedingSide === teamSide).length;

      return {
        won,
        unforcedLost,
        avgFirstContactHeight,
        pointsFrom,
        xpFrom,
        defActionCount,
        ppda: defActionCount ? oppCompletedPasses / defActionCount : NaN,
        turnoverWonPer10Poss: oppPossessionCount ? (won / oppPossessionCount) * 10 : NaN,
        shotsConcededPer10Poss: oppPossessionCount ? (shotsConceded / oppPossessionCount) * 10 : NaN,
        xpConcededPer10Poss: oppPossessionCount ? (xpConceded / oppPossessionCount) * 10 : NaN,
        foulConceded,
        scorableFreesConceded,
      };
    };
    return { home: calc('home'), away: calc('away') };
  }, [calcTurnovers, calcBase, defensiveActions, fouls, turnoverWonPossessionsByTurnoverId, scorableFreeRows, reportFilters?.match, reportFilters?.imputedTimeById]);
  const defActionMapActions = useMemo(() => defensiveActions.teamActions
    .filter((action) => defMapTeam === 'both' || (action.colorTeamSide || action.teamSide) === defMapTeam)
    .filter((action) => !defTypes.length || defTypes.some((tag) => Array.isArray(action.filterTags) && action.filterTags.includes(tag)))
    .filter((action) => !defMapHalves.length || defMapHalves.includes(String(action?.stat?.half || '')))
    .filter((action) => {
      if (defMapTimeMin === '' && defMapTimeMax === '') return true;
      const mt = getMatchTimeS(action?.stat, reportFilters?.match, reportFilters?.imputedTimeById);
      const minS = defMapTimeMin === '' ? null : Number(defMapTimeMin) * 60;
      const maxS = defMapTimeMax === '' ? null : Number(defMapTimeMax) * 60;
      if (!Number.isFinite(mt)) return false;
      if (minS != null && mt < minS) return false;
      if (maxS != null && mt > maxS) return false;
      return true;
    }), [defensiveActions, defMapTeam, defTypes, defMapHalves, defMapTimeMin, defMapTimeMax, reportFilters?.match, reportFilters?.imputedTimeById]);

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

  const possessionGroups = turnoverWonPossessionsByTurnoverId;
  const defenseReasonOptions = useMemo(() => ([
    { value: 'turnover', label: 'Turnover Won' },
    { value: 'foul', label: 'Foul' },
    { value: 'pressure', label: 'High Pressure' },
  ]), []);

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
  const defenseSankeyBaseByTeam = useMemo(() => ({
    home: buildDefenseSankeyData({ turnovers: filteredTurnovers, teamSide: 'home', groupingMode: defenseSankeyGrouping, possessionGroups, classifyTurnover, match: reportFilters?.match }),
    away: buildDefenseSankeyData({ turnovers: filteredTurnovers, teamSide: 'away', groupingMode: defenseSankeyGrouping, possessionGroups, classifyTurnover, match: reportFilters?.match }),
  }), [filteredTurnovers, defenseSankeyGrouping, possessionGroups, reportFilters?.match]);
  const defenseSankeyHighlightByTeam = useMemo(() => ({
    home: buildDefenseSankeyHighlight(defenseSankeyBaseByTeam.home, selectedDefenseSankeyNodeKeys.home),
    away: buildDefenseSankeyHighlight(defenseSankeyBaseByTeam.away, selectedDefenseSankeyNodeKeys.away),
  }), [defenseSankeyBaseByTeam, selectedDefenseSankeyNodeKeys]);
  const defenseSankeyRenderByTeam = useMemo(() => (['home', 'away'].reduce((acc, side) => {
    const baseData = defenseSankeyBaseByTeam[side];
    const highlight = defenseSankeyHighlightByTeam[side];
    const selectedNodeKey = selectedDefenseSankeyNodeKeys[side];
    acc[side] = {
      ...baseData,
      nodes: baseData.nodes.map((node) => ({
        ...node,
        tooltipMatrix: selectedNodeKey && highlight.nodeKeys.has(node.nodeKey)
          ? serializeDefenseTooltipMatrix(highlight.nodeMatrices.get(node.name))
          : node.tooltipMatrix,
        originTotals: selectedNodeKey && highlight.nodeKeys.has(node.nodeKey)
          ? serializeDefenseOriginTotals(highlight.nodeOriginTotals.get(node.nodeKey))
          : node.originTotals,
        isSelected: selectedNodeKey === node.nodeKey,
        isDimmed: !!selectedNodeKey && !highlight.nodeKeys.has(node.nodeKey),
        onSelect: () => setSelectedDefenseSankeyNodeKeys((current) => ({ ...current, [side]: current[side] === node.nodeKey ? null : node.nodeKey })),
      })),
      links: baseData.links.map((link) => ({
        ...link,
        highlightValue: highlight.linkValues.get(link.linkKey) || 0,
        isHighlighted: highlight.linkValues.has(link.linkKey),
        isDimmed: !!selectedNodeKey && !highlight.linkValues.has(link.linkKey),
      })),
    };
    return acc;
  }, {})), [defenseSankeyBaseByTeam, defenseSankeyHighlightByTeam, selectedDefenseSankeyNodeKeys]);

  const [typeSort, setTypeSort] = useState({ key: teamMode === 'both' ? 'home' : 'won', dir: 'desc' });
  const typeColumns = useMemo(() => ([
    { key: 'type', label: 'Type', sortValue: (r) => r.type },
    { key: 'home', label: homeTeam?.name || 'Home', sortValue: (r) => r.home },
    { key: 'away', label: awayTeam?.name || 'Away', sortValue: (r) => r.away },
    { key: 'count', label: 'Count', sortValue: (r) => r.won + r.lost },
  ]), [homeTeam, awayTeam]);
  const sortedTypeRows = useMemo(() => sortRows(typeRows, typeSort, typeColumns, 'type'), [typeRows, typeSort, typeColumns]);
  const toggleTypeSort = (key) => setTypeSort((current) => current.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'type' ? 'asc' : 'desc' });
  useEffect(() => {
    setSelectedDefenseSankeyNodeKeys({ home: null, away: null });
  }, [defenseSankeyGrouping]);
  const turnoverWonBreakdownChartRows = useMemo(() => ([
    {
      team: homeTeam?.name || 'Home',
      ...Object.fromEntries(sortedTypeRows.map((row) => [row.type, row.home])),
    },
    {
      team: awayTeam?.name || 'Away',
      ...Object.fromEntries(sortedTypeRows.map((row) => [row.type, row.away])),
    },
  ]), [sortedTypeRows, homeTeam, awayTeam]);
  const turnoverTypeStackConfig = useMemo(() => {
    return sortedTypeRows.reduce((acc, row, index) => {
      acc[row.type] = { label: row.type, color: DEFENSE_TURNOVER_TYPE_PALETTE[index % DEFENSE_TURNOVER_TYPE_PALETTE.length] };
      return acc;
    }, {});
  }, [sortedTypeRows]);
  const openTurnoverBreakdown = (type) => {
    if (!type) return;
    setTurnoverBreakdownType(type);
    setTurnoverBreakdownOpen(true);
  };
  const turnoverZoneBreakdownRows = useMemo(() => {
    if (!turnoverBreakdownType) return [];
    const counts = {
      home: { Def: 0, Mid: 0, Att: 0, Unknown: 0 },
      away: { Def: 0, Mid: 0, Att: 0, Unknown: 0 },
    };
    calcTurnovers.forEach((stat) => {
      const classification = classifyTurnover(stat);
      const wonBy = classification.rec;
      if (wonBy !== 'home' && wonBy !== 'away') return;
      const typeLabel = toTitleCase(normalizeFoulType(String(classification.typ || 'unknown')));
      if (typeLabel !== turnoverBreakdownType) return;
      const zone = getTurnoverZoneLabel(stat, wonBy, reportFilters?.match, turnoverWonPossessionsByTurnoverId);
      const zoneKey = DEFENSE_SANKEY_ZONE_ORDER.includes(zone) ? zone : 'Unknown';
      counts[wonBy][zoneKey] += 1;
    });
    return [
      { team: homeTeam?.name || 'Home', side: 'home', ...counts.home },
      { team: awayTeam?.name || 'Away', side: 'away', ...counts.away },
    ];
  }, [turnoverBreakdownType, calcTurnovers, homeTeam, awayTeam, reportFilters?.match, turnoverWonPossessionsByTurnoverId]);
  const turnoverZoneBreakdownSeries = useMemo(
    () => DEFENSE_ZONE_BREAKDOWN_SERIES.filter((series) => turnoverZoneBreakdownRows.some((row) => Number(row?.[series.key] || 0) > 0)),
    [turnoverZoneBreakdownRows]
  );

  return (
    <div className="space-y-4">
        <div className="grid lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-5 items-start">
          <ComparisonMetricsCard
            title="Defense Metrics"
            homeTeam={homeTeam}
            awayTeam={awayTeam}
            teamMode={teamMode}
            cardClassName="w-full"
            metricColWidth="140px"
            rows={[
              { label: 'Turnovers Won', home: kpis.home.won, away: kpis.away.won },
              { label: 'Unforced TO Lost', home: kpis.home.unforcedLost, away: kpis.away.unforcedLost },
              { label: 'Defensive Actions', home: kpis.home.defActionCount, away: kpis.away.defActionCount },
              { label: 'Avg First Contact Height', home: Number.isFinite(kpis.home.avgFirstContactHeight) ? kpis.home.avgFirstContactHeight.toFixed(1) : 'NA', away: Number.isFinite(kpis.away.avgFirstContactHeight) ? kpis.away.avgFirstContactHeight.toFixed(1) : 'NA' },
              { label: 'PPDA', home: Number.isFinite(kpis.home.ppda) ? kpis.home.ppda.toFixed(2) : 'NA', away: Number.isFinite(kpis.away.ppda) ? kpis.away.ppda.toFixed(2) : 'NA' },
              { label: 'TO Won / 10 Poss', home: Number.isFinite(kpis.home.turnoverWonPer10Poss) ? kpis.home.turnoverWonPer10Poss.toFixed(2) : 'NA', away: Number.isFinite(kpis.away.turnoverWonPer10Poss) ? kpis.away.turnoverWonPer10Poss.toFixed(2) : 'NA' },
              { label: 'Shots Conceded / 10 Poss', home: Number.isFinite(kpis.home.shotsConcededPer10Poss) ? kpis.home.shotsConcededPer10Poss.toFixed(2) : 'NA', away: Number.isFinite(kpis.away.shotsConcededPer10Poss) ? kpis.away.shotsConcededPer10Poss.toFixed(2) : 'NA' },
              { label: 'xP Conceded / 10 Poss', home: Number.isFinite(kpis.home.xpConcededPer10Poss) ? kpis.home.xpConcededPer10Poss.toFixed(2) : 'NA', away: Number.isFinite(kpis.away.xpConcededPer10Poss) ? kpis.away.xpConcededPer10Poss.toFixed(2) : 'NA' },
              { label: 'Fouls Conceded', home: kpis.home.foulConceded, away: kpis.away.foulConceded },
              { label: 'Scorable Frees Conceded', home: kpis.home.scorableFreesConceded, away: kpis.away.scorableFreesConceded },
              { label: 'Points From Regains', home: kpis.home.pointsFrom, away: kpis.away.pointsFrom },
              { label: 'xP From Regains', home: kpis.home.xpFrom.toFixed(2), away: kpis.away.xpFrom.toFixed(2) },
            ]}
          />
          <Card className={DEFENSE_PANE_CLASS}>
            <CardContent className="p-4 space-y-4">
              <div className="min-h-[42px] flex items-start">
                <div className="pt-0.5 font-semibold text-slate-900">Turnovers Won Breakdown</div>
              </div>
              <div className="flex min-h-[40px] flex-wrap gap-2 text-[11px]">
                {sortedTypeRows.map((row) => (
                  <button
                    key={row.type}
                    type="button"
                    onClick={() => openTurnoverBreakdown(row.type)}
                    className="inline-flex h-8 items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
                  >
                    <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: turnoverTypeStackConfig[row.type]?.color }} />
                    <span>{row.type}</span>
                  </button>
                ))}
              </div>
              {turnoverWonBreakdownChartRows.length ? (
                <ChartContainer id="defense-turnover-type-breakdown" className="h-[280px] w-full flex-1" config={turnoverTypeStackConfig}>
                  <BarChart data={turnoverWonBreakdownChartRows} margin={{ top: 12, right: 16, left: 0, bottom: 6 }} barCategoryGap={28}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="team" className="text-xs" />
                    <YAxis allowDecimals={false} width={34} className="text-xs" />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        return (
                          <div className="rounded-md border bg-white px-3 py-2 text-[13px] shadow-sm">
                            <div className="mb-2 font-semibold text-slate-900">{label}</div>
                            <div className="space-y-1">
                              {payload.map((entry) => (
                                <div key={entry.dataKey} className="flex justify-between gap-4">
                                  <span>{entry.name}</span>
                                  <span className="font-mono">{entry.value ?? 0}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      }}
                    />
                    {sortedTypeRows.map((row) => (
                      <Bar
                        key={row.type}
                        dataKey={row.type}
                        stackId="a"
                        fill={turnoverTypeStackConfig[row.type]?.color}
                        onClick={() => openTurnoverBreakdown(row.type)}
                        className="cursor-pointer"
                      />
                    ))}
                  </BarChart>
                </ChartContainer>
              ) : (
                <div className="rounded-xl border border-dashed border-slate-300 bg-white/80 px-4 py-10 text-center text-sm text-slate-600">
                  No turnovers won available for current filters.
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className={DEFENSE_PANE_CLASS}>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="font-semibold text-slate-900">Defensive Action Map</div>
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-auto"
                onClick={() => {
                  setDefMapTeam(String(reportFilters?.team || 'both'));
                  setDefMapHalves(Array.isArray(reportFilters?.halves) ? reportFilters.halves : []);
                  setDefMapTimeMin(String(reportFilters?.timeMin ?? ''));
                  setDefMapTimeMax(String(reportFilters?.timeMax ?? ''));
                  setDefTypes([]);
                }}
              >
                Reset Filters
              </Button>
            </div>
            <div className="grid lg:grid-cols-[minmax(0,1.8fr)_320px] gap-4 items-start">
              <div>
                {defActionMapActions.length ? (
                  <DefensiveActionMap
                    actions={defActionMapActions}
                    homeColor={homeTeam?.color}
                    awayColor={awayTeam?.color}
                    homeTeamName={homeTeam?.name}
                    awayTeamName={awayTeam?.name}
                    match={reportFilters?.match}
                    imputedTimeById={reportFilters?.imputedTimeById}
                    onOpenVideoAt={onOpenVideoAt}
                  />
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-300 bg-white/80 px-4 py-10 text-center text-sm text-slate-600">
                    No defensive actions available for current filters.
                  </div>
                )}
              </div>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-600">Team</Label>
                    <Select value={defMapTeam} onValueChange={setDefMapTeam}>
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
                      values={defMapHalves}
                      onChange={setDefMapHalves}
                      options={['first', 'second', 'et_first', 'et_second'].map((v) => ({ value: v, label: toTitleCase(v) }))}
                    />
                  </div>
                  <MatchTimeRangeSlider
                    className="col-span-2"
                    timeMin={defMapTimeMin}
                    timeMax={defMapTimeMax}
                    match={reportFilters?.match}
                    stats={stats}
                    imputedTimeById={reportFilters?.imputedTimeById}
                    compact
                    onChange={({ timeMin: nextMin, timeMax: nextMax }) => {
                      setDefMapTimeMin(nextMin);
                      setDefMapTimeMax(nextMax);
                    }}
                  />
                  <div className="col-span-2">
                    <MultiSelect
                      label="Defensive Action"
                      placeholder="All"
                      values={defTypes}
                      onChange={setDefTypes}
                      options={defenseReasonOptions}
                    />
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className={DEFENSE_PANE_CLASS}>
          <CardContent className="p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="font-semibold text-slate-900">Turnover Flow</div>
                <div className="text-xs text-slate-500">Turnovers won into possession outcome, then shot result where applicable.</div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-xl bg-slate-100 p-1">
                  <Button
                    type="button"
                    variant={defenseSankeyTeam === 'home' ? 'default' : 'outline'}
                    size="sm"
                    className="h-8 px-3 text-xs"
                    onClick={() => setDefenseSankeyTeam('home')}
                  >
                    {homeTeam?.name || 'Home'}
                  </Button>
                  <Button
                    type="button"
                    variant={defenseSankeyTeam === 'away' ? 'default' : 'outline'}
                    size="sm"
                    className="h-8 px-3 text-xs"
                    onClick={() => setDefenseSankeyTeam('away')}
                  >
                    {awayTeam?.name || 'Away'}
                  </Button>
                </div>
                <div className="inline-flex rounded-xl bg-slate-100 p-1">
                  {DEFENSE_SANKEY_GROUPING_OPTIONS.map((option) => (
                    <Button
                      key={option.value}
                      type="button"
                      variant={defenseSankeyGrouping === option.value ? 'default' : 'outline'}
                      size="sm"
                      className="h-8 px-3 text-xs"
                      onClick={() => setDefenseSankeyGrouping(option.value)}
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
            <div className="grid gap-4">
              <div className="space-y-3 rounded-xl border border-slate-200 bg-white/80 p-3">
                <div className="font-semibold text-slate-900">{defenseSankeyTeam === 'home' ? (homeTeam?.name || 'Home') : (awayTeam?.name || 'Away')}</div>
                {defenseSankeyRenderByTeam[defenseSankeyTeam]?.totalTurnovers > 0 && defenseSankeyRenderByTeam[defenseSankeyTeam]?.links?.length > 0 ? (
                  <div className="h-[360px] w-full overflow-visible" onClick={() => setSelectedDefenseSankeyNodeKeys((current) => ({ ...current, [defenseSankeyTeam]: null }))}>
                    <ResponsiveContainer width="100%" height="100%">
                      <Sankey
                        data={defenseSankeyRenderByTeam[defenseSankeyTeam]}
                        nodePadding={26}
                        nodeWidth={18}
                        margin={{ top: 16, right: 100, bottom: 16, left: 120 }}
                        linkCurvature={0.45}
                        sort={false}
                        node={DefenseSankeyNode}
                        link={DefenseSankeyLink}
                      >
                        <Tooltip content={DefenseSankeyTooltip} />
                      </Sankey>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-300 bg-white/80 px-4 py-10 text-center text-sm text-slate-600">
                    No turnover flow available for current filters.
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
        <Dialog open={turnoverBreakdownOpen} onOpenChange={setTurnoverBreakdownOpen}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>{turnoverBreakdownType || 'Turnover'} Zone Won Breakdown</DialogTitle>
            </DialogHeader>
            {turnoverZoneBreakdownRows.length && turnoverZoneBreakdownSeries.length ? (
              <ChartContainer id="defense-turnover-zone-breakdown" className="h-[320px] w-full" config={{}}>
                <BarChart data={turnoverZoneBreakdownRows} margin={{ top: 12, right: 16, left: 0, bottom: 6 }} barCategoryGap={28}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="team" className="text-xs" />
                  <YAxis allowDecimals={false} width={34} className="text-xs" />
                  <Tooltip content={<ChartTooltipContent />} />
                  <Legend verticalAlign="bottom" align="center" wrapperStyle={{ paddingTop: 8 }} />
                  {turnoverZoneBreakdownSeries.map((series) => (
                    <Bar key={series.key} dataKey={series.key} stackId="a" fill={series.color} />
                  ))}
                </BarChart>
              </ChartContainer>
            ) : (
              <div className="text-sm text-slate-500">No zone breakdown available for this turnover type.</div>
            )}
          </DialogContent>
        </Dialog>
    </div>
  );
}


export default DefenseTab;

