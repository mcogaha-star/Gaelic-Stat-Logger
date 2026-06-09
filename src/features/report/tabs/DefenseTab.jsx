import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, ResponsiveContainer, Sankey } from 'recharts';
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
  selectionTooltipLabel,
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
  2: ['Shot', 'TO Lost', 'Half End', 'No Shot / Other'],
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

    let layer2 = 'No Shot / Other';
    let layer3 = null;
    if (DEFENSE_OUTCOME_TO_SHOT_RESULT[groupedOutcome]) {
      layer2 = 'Shot';
      layer3 = DEFENSE_OUTCOME_TO_SHOT_RESULT[groupedOutcome];
    } else if (groupedOutcome === 'Turnover') {
      layer2 = 'TO Lost';
    } else if (groupedOutcome === 'Half End') {
      layer2 = 'Half End';
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
    { label: 'Block / Save', category: 'block_save' },
    { label: 'Foul', category: 'foul' },
    { label: 'High Pressure', category: 'pressure' },
  ];
  const renderGlyph = (category) => {
    if (category === 'turnover') return <div className="h-3 w-3 rotate-45 border border-slate-700 bg-slate-700" />;
    if (false && category === 'turnover') return <div className="inline-flex h-3 w-3 items-center justify-center text-[10px] leading-none text-slate-700">?</div>;
    if (category === 'block_save') return <div className="h-3 w-3 rounded-[2px] border border-slate-700 bg-slate-700" />;
    if (category === 'foul' || category === 'technical_foul') return <div className="h-0 w-0 border-l-[7px] border-r-[7px] border-b-[12px] border-l-transparent border-r-transparent border-b-slate-700" />;
    return <div className="h-3 w-3 rounded-full border border-slate-700 bg-slate-700" />;
  };
  return (
    <div className="flex flex-wrap gap-3 text-[11px] text-slate-700">
      {items.filter((item) => item.category !== 'technical_foul').map((item) => (
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
  if (primaryCategory === 'block_save') return 'Block / Save';
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

function getDisplayZoneLabel(x) {
  const xx = Number(x);
  if (!Number.isFinite(xx)) return 'Unknown';
  if (xx < PITCH_W / 3) return 'Defensive Third';
  if (xx < (2 * PITCH_W) / 3) return 'Middle Third';
  return 'Attacking Third';
}

function getTeamRelativeDisplayZoneLabel(x, teamSide) {
  const xx = Number(x);
  if (!Number.isFinite(xx)) return 'Unknown';
  const relativeX = teamSide === 'away' ? (PITCH_W - xx) : xx;
  if (relativeX < PITCH_W / 3) return 'Defensive Third';
  if (relativeX < (2 * PITCH_W) / 3) return 'Middle Third';
  return 'Attacking Third';
}

function isMeaningfulPlayerLabel(label) {
  const value = String(label || '').trim();
  if (!value) return false;
  if (!/[A-Za-z0-9]/.test(value)) return false;
  if (String(value).startsWith('legacy:')) return false;
  if (/^demo-[a-z0-9-]+-player-[a-f0-9-]+$/i.test(value)) return false;
  if (/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)) return false;
  if (/^(home|away)(\s+team)?$/i.test(value)) return false;
  if (!value.startsWith('#') && !/\s/.test(value)) return false;
  return true;
}

function formatPlayerOptionLabel(player) {
  return [player?.number != null && player?.number !== '' ? `#${player.number}` : '', String(player?.name || '').trim()]
    .filter(Boolean)
    .join(' ')
    || player?.label
    || (player?.id != null ? String(player.id) : '');
}

function formatTeamSideFallbackLabel(teamSide, homeTeamName, awayTeamName) {
  if (teamSide === 'home') return homeTeamName || 'Home Team';
  if (teamSide === 'away') return awayTeamName || 'Away Team';
  return '';
}

function firstMeaningfulValue(...values) {
  for (const value of values) {
    if (isMeaningfulPlayerLabel(value)) return String(value).trim();
  }
  return '';
}

function parsePlayerLabelParts(label) {
  const value = String(label || '').trim();
  const match = value.match(/^#(\d+)\s*(.*)$/);
  if (!match) return { number: Number.POSITIVE_INFINITY, name: value };
  return {
    number: Number(match[1]),
    name: String(match[2] || '').trim(),
  };
}

function sortPlayerOptionRows(options) {
  const teamRank = { home: 0, away: 1 };
  return options.slice().sort((a, b) => {
    const teamCmp = (teamRank[a?.teamSide] ?? 9) - (teamRank[b?.teamSide] ?? 9);
    if (teamCmp !== 0) return teamCmp;
    const aParts = parsePlayerLabelParts(a?.label);
    const bParts = parsePlayerLabelParts(b?.label);
    if (aParts.number !== bParts.number) return aParts.number - bParts.number;
    const nameCmp = String(aParts.name || '').localeCompare(String(bParts.name || ''), undefined, { sensitivity: 'base' });
    if (nameCmp !== 0) return nameCmp;
    return String(a?.label || '').localeCompare(String(b?.label || ''), undefined, { sensitivity: 'base' });
  });
}

function finalizePlayerOptions(options) {
  return sortPlayerOptionRows(
    (Array.isArray(options) ? options : []).filter((option) => isMeaningfulPlayerLabel(option?.label))
  ).map(({ value, label }) => ({ value, label }));
}

function buildDefenseTooltipText(action, homeTeamName, awayTeamName, match, imputedTimeById) {
  const extra = safeParseJSON(action?.stat?.extra_data || '{}', {});
  const lines = [];
  const addLine = (label, value) => {
    const text = String(value || '').trim();
    if (!text || text === 'NA' || text === '???' || text === '????????' || text === '?' || text === '-') return;
    lines.push(`${label}: ${text}`);
  };
  const foulOnTeamSide = action?.foulOnTeamSide || extra?.foul?.foul_on?.team_side || extra?.foul?.foul_on_or_forced_by?.team_side || '';
  const lostByTeamSide = action?.lostByTeamSide || extra?.turnover?.lost_by?.team_side || '';
  const forcedByTeamSide = action?.forcedByTeamSide || extra?.turnover?.forced_by?.team_side || '';
  const recoveredByTeamSide = action?.recoveredByTeamSide || extra?.turnover?.recovered_by?.team_side || '';
  const forcedByRaw = selectionTooltipLabel(extra?.turnover?.forced_by);
  const recoveredByRaw = selectionTooltipLabel(extra?.turnover?.recovered_by);
  const lostByRaw = selectionTooltipLabel(extra?.turnover?.lost_by);
  const foulByRaw = selectionTooltipLabel(extra?.foul?.foul_by);
  const foulOnRaw = selectionTooltipLabel(extra?.foul?.foul_on || extra?.foul?.foul_on_or_forced_by);
  const defenderRaw = selectionTooltipLabel(extra?.pass?.defender || extra?.carry?.defender || extra?.shot?.defender);
  const blockSavedByRaw = selectionTooltipLabel(extra?.shot?.blocked_by || extra?.shot?.saved_by);
  const shotRecoveredByRaw = selectionTooltipLabel(extra?.shot?.recovered_by);

  addLine('Team', formatDefenseTeamLabel(action?.teamSide, homeTeamName, awayTeamName));
  addLine('Half', toTitleCase(action?.half || 'NA'));
  addLine('Action', formatDefenseActionCategoryLabel(action));
  if (action?.primaryCategory === 'pressure') addLine('Type', toTitleCase(String(action?.sourceType || '').toLowerCase() || 'NA'));
  else if (action?.primaryCategory === 'block_save') addLine('Type', action?.blockSaveType || '');
  else if (action?.primaryCategory === 'turnover') addLine('Type', toTitleCase(action?.turnoverType || 'NA'));
  else addLine('Type', toTitleCase(action?.foulType || 'NA'));

  if (action?.primaryCategory === 'turnover') {
    addLine('Forced By', firstMeaningfulValue(forcedByRaw, action?.forcedByLabel, formatTeamSideFallbackLabel(forcedByTeamSide, homeTeamName, awayTeamName)));
    addLine('Recovered By', firstMeaningfulValue(recoveredByRaw, action?.recoveredByLabel, formatTeamSideFallbackLabel(recoveredByTeamSide, homeTeamName, awayTeamName)));
    addLine('Lost By', firstMeaningfulValue(lostByRaw, action?.lostByLabel, formatTeamSideFallbackLabel(lostByTeamSide, homeTeamName, awayTeamName)));
    addLine('Unforced', action?.unforced ? 'Yes' : 'No');
    if (normalizeFoulType(action?.turnoverType || '') === 'foul' || action?.foulType) addLine('Foul Type', toTitleCase(action?.foulType || ''));
  }
  if (action?.primaryCategory === 'block_save') {
    addLine(action?.blockSaveType === 'Save' ? 'Saved By' : 'Blocked By', firstMeaningfulValue(
      blockSavedByRaw,
      action?.blockSaveType === 'Save' ? action?.savedByLabel : action?.blockedByLabel,
      formatTeamSideFallbackLabel(action?.teamSide, homeTeamName, awayTeamName)
    ));
    addLine('Recovered By', firstMeaningfulValue(shotRecoveredByRaw, action?.shotRecoveredByLabel, formatTeamSideFallbackLabel(action?.teamSide, homeTeamName, awayTeamName)));
  }
  if (action?.primaryCategory === 'pressure') {
    addLine('Defender', firstMeaningfulValue(defenderRaw, action?.defenderLabel, formatTeamSideFallbackLabel(action?.teamSide, homeTeamName, awayTeamName)));
  }
  if (action?.primaryCategory === 'foul' || action?.primaryCategory === 'technical_foul' || action?.primaryCategory === 'offensive_foul') {
    addLine('Foul By', firstMeaningfulValue(foulByRaw, action?.fouledByLabel, formatTeamSideFallbackLabel(action?.committingTeamSide, homeTeamName, awayTeamName)));
    addLine('Foul On', firstMeaningfulValue(foulOnRaw, action?.oppositionPlayerLabel, action?.fouledOnLabel, formatTeamSideFallbackLabel(foulOnTeamSide, homeTeamName, awayTeamName)));
    addLine('Card', toTitleCase(action?.stat?.card || extra?.foul?.card || 'None'));
  }
  addLine('Time', formatDefenseClock(action?.stat, match, imputedTimeById));
  if (Number.isFinite(Number(action?.stat?.play_id))) addLine('Play', Number(action.stat.play_id));
  if (Number.isFinite(Number(action?.stat?.possession_id))) addLine('Poss', Number(action.stat.possession_id));
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
            opacity="0.94"
          />
        </g>
      );
    }
    if (category === 'block_save') {
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
            opacity="0.95"
          />
        </g>
      );
    }
    if (category === 'foul' || category === 'technical_foul' || category === 'offensive_foul') {
      return (
        <g key={action.key} {...commonProps}>
          <title>{tip}</title>
          <polygon
            points={`${x},${y - (size * 1.45)} ${x + (size * 1.3)},${y + (size * 1.1)} ${x - (size * 1.3)},${y + (size * 1.1)}`}
            fill={technical || action?.isOffensiveFoul ? '#ffffff' : color}
            stroke="#0f172a"
            strokeWidth={0.25}
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
    </div>
  );
}

function DefenseTab({
  stats,
  homeTeam,
  awayTeam,
  reportFilters,
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
  const [defMapZone, setDefMapZone] = useState('all');
  const [defMapPlayerId, setDefMapPlayerId] = useState('all');
  const [defMapAction, setDefMapAction] = useState('all');
  const [defMapPressureType, setDefMapPressureType] = useState('all');
  const [defMapPressureDefenderId, setDefMapPressureDefenderId] = useState('all');
  const [defMapFoulType, setDefMapFoulType] = useState('all');
  const [defMapFoulById, setDefMapFoulById] = useState('all');
  const [defMapTurnoverType, setDefMapTurnoverType] = useState('all');
  const [defMapForcedById, setDefMapForcedById] = useState('all');
  const [defMapRecoveredById, setDefMapRecoveredById] = useState('all');
  const [defMapLostById, setDefMapLostById] = useState('all');
  const [defMapBlockSaveType, setDefMapBlockSaveType] = useState('all');
  const [defMapBlockSavedById, setDefMapBlockSavedById] = useState('all');
  const [defMapBlockRecoveredById, setDefMapBlockRecoveredById] = useState('all');
  const [defenseSankeyGrouping, setDefenseSankeyGrouping] = useState('all');
  const [defenseSankeyTeam, setDefenseSankeyTeam] = useState(String(reportFilters?.team || '') === 'away' ? 'away' : 'home');
  const [selectedDefenseSankeyNodeKeys, setSelectedDefenseSankeyNodeKeys] = useState({ home: null, away: null });

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
        firstContactHeight: avgFirstContactHeight,
        pointsFrom,
        xpFrom,
        defActionCount,
        defActionsPerPoss: oppPossessionCount ? defActionCount / oppPossessionCount : NaN,
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
  const playerLabelById = useMemo(() => {
    const map = new Map();
    defensiveActions.playerActions.forEach((action) => {
      const player = action?.player;
      if (!player?.id) return;
      const label = formatPlayerOptionLabel(player);
      if (isMeaningfulPlayerLabel(label)) {
        map.set(String(player.id), label);
      }
    });
    return map;
  }, [defensiveActions]);
  const resolvedDefensiveTeamActions = useMemo(() => defensiveActions.teamActions.map((action) => ({
    ...action,
    forcedByLabel: isMeaningfulPlayerLabel(action?.forcedByLabel) ? action.forcedByLabel : (playerLabelById.get(String(action?.forcedById || '')) || ''),
    recoveredByLabel: isMeaningfulPlayerLabel(action?.recoveredByLabel) ? action.recoveredByLabel : (playerLabelById.get(String(action?.recoveredById || '')) || ''),
    lostByLabel: isMeaningfulPlayerLabel(action?.lostByLabel) ? action.lostByLabel : (playerLabelById.get(String(action?.lostById || '')) || ''),
    fouledByLabel: isMeaningfulPlayerLabel(action?.fouledByLabel) ? action.fouledByLabel : (playerLabelById.get(String(action?.foulById || '')) || ''),
    fouledOnLabel: isMeaningfulPlayerLabel(action?.fouledOnLabel) ? action.fouledOnLabel : (playerLabelById.get(String(action?.foulOnId || '')) || ''),
    defenderLabel: isMeaningfulPlayerLabel(action?.defenderLabel) ? action.defenderLabel : (playerLabelById.get(String(action?.defenderId || '')) || ''),
    blockedByLabel: isMeaningfulPlayerLabel(action?.blockedByLabel) ? action.blockedByLabel : (playerLabelById.get(String(action?.blockedById || '')) || ''),
    savedByLabel: isMeaningfulPlayerLabel(action?.savedByLabel) ? action.savedByLabel : (playerLabelById.get(String(action?.savedById || '')) || ''),
    shotRecoveredByLabel: isMeaningfulPlayerLabel(action?.shotRecoveredByLabel) ? action.shotRecoveredByLabel : (playerLabelById.get(String(action?.shotRecoveredById || '')) || ''),
  })), [defensiveActions, playerLabelById]);
  const playerOptionMetaById = useMemo(() => {
    const map = new Map();
    const upsert = (id, label, teamSide) => {
      if (!id || !isMeaningfulPlayerLabel(label)) return;
      const key = String(id);
      if (!map.has(key)) {
        map.set(key, { value: key, label: String(label).trim(), teamSide });
      }
    };
    defensiveActions.playerActions.forEach((action) => {
      const player = action?.player;
      if (!player?.id) return;
      upsert(player.id, formatPlayerOptionLabel(player), player.team_side);
    });
    resolvedDefensiveTeamActions.forEach((action) => {
      upsert(action?.forcedById, action?.forcedByLabel, action?.teamSide);
      upsert(action?.recoveredById, action?.recoveredByLabel, action?.teamSide);
      upsert(action?.foulById, action?.fouledByLabel, action?.committingTeamSide || action?.teamSide);
      upsert(action?.foulOnId, action?.fouledOnLabel, action?.foulOnTeamSide || action?.turnoverLostBy || action?.actingTeamSide);
      upsert(action?.defenderId, action?.defenderLabel, action?.teamSide);
      upsert(action?.blockedById, action?.blockedByLabel, action?.teamSide);
      upsert(action?.savedById, action?.savedByLabel, action?.teamSide);
      upsert(action?.shotRecoveredById, action?.shotRecoveredByLabel, action?.teamSide);
      upsert(action?.lostById, action?.lostByLabel, action?.lostByTeamSide || action?.turnoverLostBy || action?.actingTeamSide);
    });
    return map;
  }, [defensiveActions, resolvedDefensiveTeamActions]);
  const playerFilterOptions = useMemo(() => {
    return finalizePlayerOptions(Array.from(playerOptionMetaById.values()));
  }, [playerOptionMetaById]);

  const turnoverTypeOptions = useMemo(() => Array.from(new Set(resolvedDefensiveTeamActions
    .filter((action) => Array.isArray(action.filterTags) && action.filterTags.includes('turnover'))
    .map((action) => String(action?.turnoverType || '').trim())
    .filter(Boolean))).sort((a, b) => a.localeCompare(b)), [resolvedDefensiveTeamActions]);
  const foulTypeOptions = useMemo(() => Array.from(new Set(resolvedDefensiveTeamActions
    .filter((action) => Array.isArray(action.filterTags) && action.filterTags.includes('foul'))
    .map((action) => String(action?.foulType || '').trim())
    .filter(Boolean))).sort((a, b) => a.localeCompare(b)), [resolvedDefensiveTeamActions]);
  const pressureDefenderOptions = useMemo(() => finalizePlayerOptions(Array.from(new Map(resolvedDefensiveTeamActions
    .filter((action) => (action?.primaryCategory || action?.actionCategory) === 'pressure' && action?.defenderId)
    .map((action) => [String(action.defenderId), playerOptionMetaById.get(String(action.defenderId)) || { value: String(action.defenderId), label: action.defenderLabel || String(action.defenderId), teamSide: action.teamSide }])).values()))
  , [resolvedDefensiveTeamActions, playerOptionMetaById]);
  const foulByOptions = useMemo(() => finalizePlayerOptions(Array.from(new Map(resolvedDefensiveTeamActions
    .filter((action) => Array.isArray(action.filterTags) && action.filterTags.includes('foul') && action?.foulById)
    .map((action) => [String(action.foulById), playerOptionMetaById.get(String(action.foulById)) || { value: String(action.foulById), label: action.fouledByLabel || String(action.foulById), teamSide: action.committingTeamSide || action.teamSide }])).values()))
  , [resolvedDefensiveTeamActions, playerOptionMetaById]);
  const forcedByOptions = useMemo(() => finalizePlayerOptions(Array.from(new Map(resolvedDefensiveTeamActions
    .filter((action) => Array.isArray(action.filterTags) && action.filterTags.includes('turnover') && action?.forcedById)
    .map((action) => [String(action.forcedById), playerOptionMetaById.get(String(action.forcedById)) || { value: String(action.forcedById), label: action.forcedByLabel || String(action.forcedById), teamSide: action.teamSide }])).values()))
  , [resolvedDefensiveTeamActions, playerOptionMetaById]);
  const recoveredByOptions = useMemo(() => finalizePlayerOptions(Array.from(new Map(resolvedDefensiveTeamActions
    .filter((action) => Array.isArray(action.filterTags) && action.filterTags.includes('turnover') && action?.recoveredById)
    .map((action) => [String(action.recoveredById), playerOptionMetaById.get(String(action.recoveredById)) || { value: String(action.recoveredById), label: action.recoveredByLabel || String(action.recoveredById), teamSide: action.teamSide }])).values()))
  , [resolvedDefensiveTeamActions, playerOptionMetaById]);
  const lostByOptions = useMemo(() => finalizePlayerOptions(Array.from(new Map(resolvedDefensiveTeamActions
    .filter((action) => Array.isArray(action.filterTags) && action.filterTags.includes('turnover') && action?.lostById)
    .map((action) => [String(action.lostById), playerOptionMetaById.get(String(action.lostById)) || { value: String(action.lostById), label: action.lostByLabel || String(action.lostById), teamSide: action.lostByTeamSide || action.turnoverLostBy || action.actingTeamSide }])).values()))
  , [resolvedDefensiveTeamActions, playerOptionMetaById]);
  const blockSavedByOptions = useMemo(() => finalizePlayerOptions(Array.from(new Map(resolvedDefensiveTeamActions
    .filter((action) => Array.isArray(action.filterTags) && action.filterTags.includes('block_save'))
    .flatMap((action) => ([
      action?.blockedById ? [String(action.blockedById), playerOptionMetaById.get(String(action.blockedById)) || { value: String(action.blockedById), label: action.blockedByLabel || String(action.blockedById), teamSide: action.teamSide }] : null,
      action?.savedById ? [String(action.savedById), playerOptionMetaById.get(String(action.savedById)) || { value: String(action.savedById), label: action.savedByLabel || String(action.savedById), teamSide: action.teamSide }] : null,
    ]).filter(Boolean))).values()))
  , [resolvedDefensiveTeamActions, playerOptionMetaById]);
  const blockRecoveredByOptions = useMemo(() => finalizePlayerOptions(Array.from(new Map(resolvedDefensiveTeamActions
    .filter((action) => Array.isArray(action.filterTags) && action.filterTags.includes('block_save') && action?.shotRecoveredById)
    .map((action) => [String(action.shotRecoveredById), playerOptionMetaById.get(String(action.shotRecoveredById)) || { value: String(action.shotRecoveredById), label: action.shotRecoveredByLabel || String(action.shotRecoveredById), teamSide: action.teamSide }])).values()))
  , [resolvedDefensiveTeamActions, playerOptionMetaById]);

  const actionTagByValue = { turnover: 'turnover', block_save: 'block_save', foul: 'foul', pressure: 'pressure' };
  const defActionMapActions = useMemo(() => resolvedDefensiveTeamActions
    .filter((action) => defMapTeam === 'both' || (action.colorTeamSide || action.teamSide) === defMapTeam)
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
    })
    .filter((action) => defMapZone === 'all' || getTeamRelativeDisplayZoneLabel(action?.displayX, action?.teamSide) === defMapZone)
    .filter((action) => defMapPlayerId === 'all' || (Array.isArray(action?.playerInvolvementIds) && action.playerInvolvementIds.includes(defMapPlayerId)))
    .filter((action) => defMapAction === 'all' || (Array.isArray(action?.filterTags) && action.filterTags.includes(actionTagByValue[defMapAction])))
    .filter((action) => {
      if (defMapAction === 'pressure') {
        if (defMapPressureType !== 'all') {
          const sourceType = String(action?.sourceType || '').toLowerCase();
          if (sourceType !== defMapPressureType) return false;
        }
        if (defMapPressureDefenderId !== 'all' && action?.defenderId !== defMapPressureDefenderId) return false;
      }
      if (defMapAction === 'foul') {
        if (defMapFoulType !== 'all' && String(action?.foulType || '') !== defMapFoulType) return false;
        if (defMapFoulById !== 'all' && action?.foulById !== defMapFoulById) return false;
      }
      if (defMapAction === 'turnover') {
        if (defMapTurnoverType !== 'all' && String(action?.turnoverType || '') !== defMapTurnoverType) return false;
        if (defMapForcedById !== 'all' && action?.forcedById !== defMapForcedById) return false;
        if (defMapRecoveredById !== 'all' && action?.recoveredById !== defMapRecoveredById) return false;
        if (defMapLostById !== 'all' && action?.lostById !== defMapLostById) return false;
      }
      if (defMapAction === 'block_save') {
        if (defMapBlockSaveType !== 'all' && String(action?.blockSaveType || '').toLowerCase() !== defMapBlockSaveType) return false;
        if (defMapBlockSavedById !== 'all' && action?.blockedById !== defMapBlockSavedById && action?.savedById !== defMapBlockSavedById) return false;
        if (defMapBlockRecoveredById !== 'all' && action?.shotRecoveredById !== defMapBlockRecoveredById) return false;
      }
      return true;
    }), [
      resolvedDefensiveTeamActions, defMapTeam, defMapHalves, defMapTimeMin, defMapTimeMax, reportFilters?.match, reportFilters?.imputedTimeById,
      defMapZone, defMapPlayerId, defMapAction, defMapPressureType, defMapPressureDefenderId, defMapFoulType, defMapFoulById,
      defMapTurnoverType, defMapForcedById, defMapRecoveredById, defMapLostById, defMapBlockSaveType, defMapBlockSavedById, defMapBlockRecoveredById
    ]);

  const playerDefenseRows = useMemo(() => {
    const rows = new Map();
    const ensure = (id, label, teamSide) => {
      if (!id) return null;
      const key = String(id);
      if (!rows.has(key)) {
        rows.set(key, { id: key, player: label || key, team: teamSide, toForced: 0, toRecovered: 0, defensiveActions: 0, fouls: 0, _seenActions: new Set() });
      }
      return rows.get(key);
    };
    const bumpAction = (row, statId) => {
      if (!row) return;
      const key = String(statId || '');
      if (row._seenActions.has(key)) return;
      row._seenActions.add(key);
      row.defensiveActions += 1;
    };

    defensiveActions.playerActions.forEach((action) => {
      const player = action?.player;
      if (!player?.id) return;
      const label = [player?.number != null && player?.number !== '' ? `#${player.number}` : '', String(player?.name || '').trim()]
        .filter(Boolean)
        .join(' ')
        || player?.label
        || String(player.id);
      ensure(player.id, label, player.team_side);
    });

    resolvedDefensiveTeamActions.forEach((action) => {
      const statId = action?.statId || action?.stat?.id;
      const metricIncluded = !!action?.metricIncluded;
      const forcedRow = ensure(action?.forcedById, action?.forcedByLabel, action?.teamSide);
      const recoveredRow = ensure(action?.recoveredById, action?.recoveredByLabel, action?.teamSide);
      const foulRow = ensure(action?.foulById, action?.fouledByLabel, action?.committingTeamSide || action?.teamSide);
      const defenderRow = ensure(action?.defenderId, action?.defenderLabel, action?.teamSide);
      const blockedRow = ensure(action?.blockedById, action?.blockedByLabel, action?.teamSide);
      const savedRow = ensure(action?.savedById, action?.savedByLabel, action?.teamSide);

      if ((action?.primaryCategory || action?.actionCategory) === 'turnover') {
        if (forcedRow) forcedRow.toForced += 1;
        if (recoveredRow) recoveredRow.toRecovered += 1;
      }
      if (Array.isArray(action?.filterTags) && action.filterTags.includes('foul') && foulRow) {
        foulRow.fouls += 1;
      }
      if (metricIncluded) {
        [forcedRow, recoveredRow, foulRow, defenderRow, blockedRow, savedRow].forEach((row) => bumpAction(row, statId));
      }
    });

    return Array.from(rows.values())
      .filter((row) => isMeaningfulPlayerLabel(row?.player))
      .map((row) => ({ ...row, teamLabel: row.team === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home') }))
      .sort((a, b) => b.defensiveActions - a.defensiveActions || b.toForced - a.toForced || String(a.player).localeCompare(String(b.player)));
  }, [defensiveActions, resolvedDefensiveTeamActions, homeTeam, awayTeam]);

  const [playerDefenseSort, setPlayerDefenseSort] = useState({ key: 'defensiveActions', dir: 'desc' });
  const playerDefenseColumns = useMemo(() => ([
    { key: 'player', label: 'Player', sortValue: (r) => r.player },
    { key: 'teamLabel', label: 'Team', sortValue: (r) => r.teamLabel },
    { key: 'toForced', label: 'TO Forced', sortValue: (r) => r.toForced },
    { key: 'toRecovered', label: 'TO Recovered', sortValue: (r) => r.toRecovered },
    { key: 'defensiveActions', label: 'Defensive Actions', sortValue: (r) => r.defensiveActions },
    { key: 'fouls', label: 'Fouls', sortValue: (r) => r.fouls },
  ]), []);
  const togglePlayerDefenseSort = (key) => setPlayerDefenseSort((current) => current.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'player' || key === 'teamLabel' ? 'asc' : 'desc' });
  const [showAllPlayerDefenseRows, setShowAllPlayerDefenseRows] = useState(false);
  const sortedPlayerDefenseRows = useMemo(
    () => {
      const sorted = sortRows(playerDefenseRows, playerDefenseSort, playerDefenseColumns, 'player');
      return showAllPlayerDefenseRows ? sorted : sorted.slice(0, 8);
    },
    [playerDefenseRows, playerDefenseSort, playerDefenseColumns, showAllPlayerDefenseRows]
  );

  const possessionGroups = turnoverWonPossessionsByTurnoverId;
  const filteredTurnovers = turnovers;
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

  useEffect(() => {
    setSelectedDefenseSankeyNodeKeys({ home: null, away: null });
  }, [defenseSankeyGrouping]);

  return (
    <div className="space-y-4">
      <div className="grid lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-5 items-stretch">
        <ComparisonMetricsCard
          title="Defense Metrics"
          homeTeam={homeTeam}
          awayTeam={awayTeam}
          teamMode={teamMode}
          cardClassName="w-full h-full"
          metricColWidth="150px"
          rows={[
            { label: 'Turnovers Won', home: kpis.home.won, away: kpis.away.won },
            { label: 'Unforced TO Lost', home: kpis.home.unforcedLost, away: kpis.away.unforcedLost },
            { label: 'Defensive Actions', home: kpis.home.defActionCount, away: kpis.away.defActionCount },
            { label: 'Def Actions / Poss', home: Number.isFinite(kpis.home.defActionsPerPoss) ? kpis.home.defActionsPerPoss.toFixed(2) : 'NA', away: Number.isFinite(kpis.away.defActionsPerPoss) ? kpis.away.defActionsPerPoss.toFixed(2) : 'NA' },
            { label: 'PPDA', home: Number.isFinite(kpis.home.ppda) ? kpis.home.ppda.toFixed(2) : 'NA', away: Number.isFinite(kpis.away.ppda) ? kpis.away.ppda.toFixed(2) : 'NA' },
            { label: 'Fouls Conceded', home: kpis.home.foulConceded, away: kpis.away.foulConceded },
            { label: 'Scorable\u00A0Frees\u00A0Conceded', home: kpis.home.scorableFreesConceded, away: kpis.away.scorableFreesConceded },
          ]}
        />
        <Card className={DEFENSE_PANE_CLASS}>
          <CardContent className="p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="font-semibold text-slate-900">Turnover Flow</div>
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
                setDefMapZone('all');
                setDefMapPlayerId('all');
                setDefMapAction('all');
                setDefMapPressureType('all');
                setDefMapPressureDefenderId('all');
                setDefMapFoulType('all');
                setDefMapFoulById('all');
                setDefMapTurnoverType('all');
                setDefMapForcedById('all');
                setDefMapRecoveredById('all');
                setDefMapLostById('all');
                setDefMapBlockSaveType('all');
                setDefMapBlockSavedById('all');
                setDefMapBlockRecoveredById('all');
              }}
            >
              Reset Filters
            </Button>
          </div>
          <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-4 items-start">
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
              <div className="grid gap-3">
                <div className="grid grid-cols-2 gap-3">
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
                  <MultiSelect
                    label="Half"
                    placeholder="All"
                    values={defMapHalves}
                    onChange={setDefMapHalves}
                    options={['first', 'second', 'et_first', 'et_second'].map((v) => ({ value: v, label: toTitleCase(v) }))}
                  />
                </div>
                <MatchTimeRangeSlider
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
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-600">Zone</Label>
                    <Select value={defMapZone} onValueChange={setDefMapZone}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        <SelectItem value="Defensive Third">Defensive Third</SelectItem>
                        <SelectItem value="Middle Third">Middle Third</SelectItem>
                        <SelectItem value="Attacking Third">Attacking Third</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-600">Player</Label>
                    <Select value={defMapPlayerId} onValueChange={setDefMapPlayerId}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        {playerFilterOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-slate-600">Defensive Action</Label>
                  <Select value={defMapAction} onValueChange={setDefMapAction}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="turnover">Turnover Won</SelectItem>
                      <SelectItem value="block_save">Block / Save</SelectItem>
                      <SelectItem value="foul">Foul</SelectItem>
                      <SelectItem value="pressure">High Pressure</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {defMapAction === 'pressure' ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-600">High Pressure Type</Label>
                      <Select value={defMapPressureType} onValueChange={setDefMapPressureType}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All</SelectItem>
                          <SelectItem value="pass">Pass</SelectItem>
                          <SelectItem value="carry">Carry</SelectItem>
                          <SelectItem value="shot">Shot</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-600">Defender</Label>
                      <Select value={defMapPressureDefenderId} onValueChange={setDefMapPressureDefenderId}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All</SelectItem>
                          {pressureDefenderOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                ) : null}

                {defMapAction === 'foul' ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-600">Foul Type</Label>
                      <Select value={defMapFoulType} onValueChange={setDefMapFoulType}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All</SelectItem>
                          {foulTypeOptions.map((value) => <SelectItem key={value} value={value}>{toTitleCase(value)}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-600">Foul By</Label>
                      <Select value={defMapFoulById} onValueChange={setDefMapFoulById}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All</SelectItem>
                          {foulByOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                ) : null}

                {defMapAction === 'turnover' ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-600">Turnover Type</Label>
                      <Select value={defMapTurnoverType} onValueChange={setDefMapTurnoverType}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All</SelectItem>
                          {turnoverTypeOptions.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-600">Forced By</Label>
                      <Select value={defMapForcedById} onValueChange={setDefMapForcedById}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All</SelectItem>
                          {forcedByOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-600">Recovered By</Label>
                      <Select value={defMapRecoveredById} onValueChange={setDefMapRecoveredById}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All</SelectItem>
                          {recoveredByOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-600">Lost By</Label>
                      <Select value={defMapLostById} onValueChange={setDefMapLostById}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All</SelectItem>
                          {lostByOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                ) : null}

                {defMapAction === 'block_save' ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-600">Block/Save Type</Label>
                      <Select value={defMapBlockSaveType} onValueChange={setDefMapBlockSaveType}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All</SelectItem>
                          <SelectItem value="block">Block</SelectItem>
                          <SelectItem value="save">Save</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-600">Blocked/Saved By</Label>
                      <Select value={defMapBlockSavedById} onValueChange={setDefMapBlockSavedById}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All</SelectItem>
                          {blockSavedByOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-600">Recovered By</Label>
                      <Select value={defMapBlockRecoveredById} onValueChange={setDefMapBlockRecoveredById}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All</SelectItem>
                          {blockRecoveredByOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-5 items-stretch">
        <ComparisonMetricsCard
          title="Secondary Defense Metrics"
          homeTeam={homeTeam}
          awayTeam={awayTeam}
          teamMode={teamMode}
          cardClassName="w-full"
          metricColWidth="160px"
          rows={[
            { label: 'First Contact Height', home: Number.isFinite(kpis.home.firstContactHeight) ? kpis.home.firstContactHeight.toFixed(1) : 'NA', away: Number.isFinite(kpis.away.firstContactHeight) ? kpis.away.firstContactHeight.toFixed(1) : 'NA' },
            { label: 'TO Won / 10 Opp Poss', home: Number.isFinite(kpis.home.turnoverWonPer10Poss) ? kpis.home.turnoverWonPer10Poss.toFixed(2) : 'NA', away: Number.isFinite(kpis.away.turnoverWonPer10Poss) ? kpis.away.turnoverWonPer10Poss.toFixed(2) : 'NA' },
            { label: 'Shots\u00A0Conceded\u00A0/\u00A010\u00A0Poss', home: Number.isFinite(kpis.home.shotsConcededPer10Poss) ? kpis.home.shotsConcededPer10Poss.toFixed(2) : 'NA', away: Number.isFinite(kpis.away.shotsConcededPer10Poss) ? kpis.away.shotsConcededPer10Poss.toFixed(2) : 'NA' },
            { label: 'xP Conceded / 10 Poss', home: Number.isFinite(kpis.home.xpConcededPer10Poss) ? kpis.home.xpConcededPer10Poss.toFixed(2) : 'NA', away: Number.isFinite(kpis.away.xpConcededPer10Poss) ? kpis.away.xpConcededPer10Poss.toFixed(2) : 'NA' },
            { label: 'Regain Points', home: kpis.home.pointsFrom, away: kpis.away.pointsFrom },
            { label: 'Regain xP', home: Number.isFinite(kpis.home.xpFrom) ? kpis.home.xpFrom.toFixed(2) : 'NA', away: Number.isFinite(kpis.away.xpFrom) ? kpis.away.xpFrom.toFixed(2) : 'NA' },
          ]}
        />
        <Card className={`${DEFENSE_PANE_CLASS} h-full`}>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="font-semibold text-slate-900">Player Defensive Table</div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 min-w-[120px] px-3 text-xs"
                onClick={() => setShowAllPlayerDefenseRows((current) => !current)}
              >
                {showAllPlayerDefenseRows ? 'Show Top 8' : 'Expand Table'}
              </Button>
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
                <Table>
                  <TableHeader>
                    <TableRow>
                    {playerDefenseColumns.map((column) => (
                      <TableHead key={column.key} className={column.key === 'player' || column.key === 'teamLabel' ? 'text-left' : 'text-center'}>
                        <button
                          type="button"
                          className={`inline-flex w-full items-center gap-1 font-medium ${column.key === 'player' || column.key === 'teamLabel' ? 'justify-start text-left' : 'justify-center text-center'}`}
                          onClick={() => togglePlayerDefenseSort(column.key)}
                        >
                          <span>{column.label}</span>
                          <span className="text-[10px] text-slate-500">
                            {playerDefenseSort.key === column.key ? (playerDefenseSort.dir === 'asc' ? '▲' : '▼') : '↕'}
                          </span>
                        </button>
                      </TableHead>
                    ))}
                    </TableRow>
                  </TableHeader>
                <TableBody>
                  {sortedPlayerDefenseRows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">{row.player || '—'}</TableCell>
                      <TableCell>{row.teamLabel || '—'}</TableCell>
                      <TableCell className="text-center tabular-nums">{row.toForced}</TableCell>
                      <TableCell className="text-center tabular-nums">{row.toRecovered}</TableCell>
                      <TableCell className="text-center tabular-nums">{row.defensiveActions}</TableCell>
                      <TableCell className="text-center tabular-nums">{row.fouls}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}


export default DefenseTab;

