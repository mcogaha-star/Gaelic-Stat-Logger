import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ChartContainer, ChartTooltipContent } from '@/components/ui/chart';
import { BarChart, Bar, CartesianGrid, Legend, LineChart, Line, PieChart, Pie, Cell, Tooltip, ReferenceLine, ResponsiveContainer, XAxis, YAxis, Sankey } from 'recharts';
import pitchImg from '@/assets/pitch.png';
import {
  PITCH_W,
  PITCH_H,
  calcDistanceToGoal,
  classifyTerminalOutcome,
  extractFoulFromStat,
  findScorableFreeConcededRows,
  getAttackEntryChannelForPossession,
  getFieldTiltContribution,
  getDerivedPossessionDurationSeconds,
  getMatchTimeS,
  getPossessionTimeSummary,
  isDeadBallGapStart,
  getProgressiveMeters,
  getScoringZoneEntry,
  isAttackPossession,
  statHasEnteredOpp45,
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
  deriveAttackTypeState,
  defenceSetStateKey,
  attackTypeStateKey,
  inferPossessionStartSource,
  getCompletedReceiptSelection,
  getPrimaryActorSelection,
  getKeeperCandidate,
  isGoalkeeperPlayer,
  buildShotAssistCredits,
  buildTouchesMap,
  getPossessionStartZone,
  selectionKey,
  normalizePlayerRef,
  teamRowTint,
  ComparisonMetricsCard,
  PitchViz,
  AttackChannelPitch,
  PassNetwork,
  ShotMap,
  shotSideFromY,
  shotZoneFromDistance,
  applyNonTeamReportFilters,
} from '../shared';

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

const PHYSICAL_ZONE_LABELS = ['Left 45', 'Middle', 'Right 45'];
function getDirectionByPeriod(match) {
  const fallback = { first: 'right', second: 'left', et_first: 'right', et_second: 'left' };
  const raw = match?.direction_by_period;
  if (!raw) return fallback;
  if (typeof raw === 'object') return { ...fallback, ...raw };
  try {
    return { ...fallback, ...JSON.parse(raw) };
  } catch {
    return fallback;
  }
}

function homeAttacksRightForStat(match, stat) {
  const half = String(stat?.half || 'first');
  return getDirectionByPeriod(match)?.[half] !== 'left';
}

function getFixedDirectionX(stat, match, possessionTeamSide, fallbackKey = 'x_position') {
  const raw = Number(stat?.raw_x_position);
  if (Number.isFinite(raw)) {
    return homeAttacksRightForStat(match, stat) ? raw : PITCH_W - raw;
  }

  const fallback = Number(stat?.[fallbackKey]);
  if (!Number.isFinite(fallback)) return NaN;
  if (possessionTeamSide === 'away') return PITCH_W - fallback;
  return fallback;
}

function getFixedDirectionEndX(stat, match, possessionTeamSide) {
  const rawEnd = Number(stat?.raw_end_x_position);
  if (Number.isFinite(rawEnd)) {
    return homeAttacksRightForStat(match, stat) ? rawEnd : PITCH_W - rawEnd;
  }
  const rawStart = Number(stat?.raw_x_position);
  if (Number.isFinite(rawStart)) {
    return homeAttacksRightForStat(match, stat) ? rawStart : PITCH_W - rawStart;
  }
  const end = Number(stat?.end_x_position);
  if (Number.isFinite(end)) return possessionTeamSide === 'away' ? PITCH_W - end : end;
  const start = Number(stat?.x_position);
  if (!Number.isFinite(start)) return NaN;
  return possessionTeamSide === 'away' ? PITCH_W - start : start;
}

function splitPhysicalZoneDuration(fromX, toX, duration) {
  const seconds = Number(duration);
  const a = Number(fromX);
  const b = Number(toX);
  const out = Object.fromEntries(PHYSICAL_ZONE_LABELS.map((z) => [z, 0]));
  if (!Number.isFinite(seconds) || seconds <= 0) return out;
  if (!Number.isFinite(a) && !Number.isFinite(b)) return out;
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(b - a) < 0.001) {
    const x = Number.isFinite(a) ? a : b;
    if (x < 45) out['Left 45'] += seconds;
    else if (x < PITCH_W - 45) out.Middle += seconds;
    else out['Right 45'] += seconds;
    return out;
  }

  const minX = Math.max(0, Math.min(a, b));
  const maxX = Math.min(PITCH_W, Math.max(a, b));
  const total = Math.max(0.001, maxX - minX);
  [
    ['Left 45', 0, 45],
    ['Middle', 45, PITCH_W - 45],
    ['Right 45', PITCH_W - 45, PITCH_W],
  ].forEach(([zone, start, end]) => {
    const overlap = Math.max(0, Math.min(maxX, end) - Math.max(minX, start));
    if (overlap > 0) out[zone] += seconds * (overlap / total);
  });
  return out;
}

function getPhysicalPossessionZoneSeconds(events, match, imputedMap, startAnchorTimeS, possessionTeamSide) {
  const ordered = (Array.isArray(events) ? events : [])
    .filter((s) => s && !['substitution', 'period_end'].includes(String(s?.stat_type || '')))
    .slice()
    .sort((a, b) => {
      const pa = Number(a?.play_id);
      const pb = Number(b?.play_id);
      if (Number.isFinite(pa) && Number.isFinite(pb) && pa !== pb) return pa - pb;
      const ta = getMatchTimeS(a, match, imputedMap);
      const tb = getMatchTimeS(b, match, imputedMap);
      if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
      return String(a?.id || '').localeCompare(String(b?.id || ''));
    });
  const out = Object.fromEntries(PHYSICAL_ZONE_LABELS.map((z) => [z, 0]));
  const add = (parts) => PHYSICAL_ZONE_LABELS.forEach((z) => { out[z] += Number(parts?.[z] || 0); });

  const first = ordered[0] || null;
  const anchor = Number(startAnchorTimeS);
  if (first && Number.isFinite(anchor)) {
    const firstTime = getMatchTimeS(first, match, imputedMap);
    if (Number.isFinite(firstTime) && firstTime >= anchor) {
      const firstX = getFixedDirectionX(first, match, possessionTeamSide);
      add(splitPhysicalZoneDuration(firstX, firstX, firstTime - anchor));
    }
  }

  for (let i = 0; i < ordered.length - 1; i += 1) {
    const current = ordered[i];
    const next = ordered[i + 1];
    if (isDeadBallGapStart(current)) continue;
    const a = getMatchTimeS(current, match, imputedMap);
    const b = getMatchTimeS(next, match, imputedMap);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) continue;
    add(splitPhysicalZoneDuration(
      getFixedDirectionX(current, match, possessionTeamSide),
      getFixedDirectionEndX(current, match, possessionTeamSide),
      b - a,
    ));
  }
  return out;
}

function possessionSankeyNodeKeyToName(nodeKey) {
  return String(nodeKey || '').split(':').slice(1).join(':');
}

function createPossessionSankeyTooltipMatrix() {
  return {
    inputs: new Set(),
    outputs: new Set(),
    grid: new Map(),
    total: 0,
  };
}

function bumpPossessionSankeyTooltipMatrix(matrices, nodeName, inputName, outputName, count = 1) {
  if (!nodeName) return;
  const current = matrices.get(nodeName) || createPossessionSankeyTooltipMatrix();
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

function serializePossessionSankeyTooltipMatrix(matrix) {
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

function serializePossessionSankeyOriginTotals(originMap, originOrder = []) {
  const orderIndex = new Map(originOrder.map((label, index) => [label, index]));
  return Array.from((originMap || new Map()).entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => {
      const ai = orderIndex.has(a.label) ? orderIndex.get(a.label) : 999;
      const bi = orderIndex.has(b.label) ? orderIndex.get(b.label) : 999;
      if (ai !== bi) return ai - bi;
      return b.value - a.value || String(a.label).localeCompare(String(b.label));
    });
}

function buildPossessionSankeyHighlight(data, selectedNodeKey) {
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
    const originLabel = possessionSankeyNodeKeyToName(prefix[0]);
    for (let i = 0; i < prefix.length; i += 1) {
      const nodeKey = prefix[i];
      nodeKeys.add(nodeKey);
      if (!nodeOriginTotals.has(nodeKey)) nodeOriginTotals.set(nodeKey, new Map());
      const origins = nodeOriginTotals.get(nodeKey);
      origins.set(originLabel, (origins.get(originLabel) || 0) + count);
      bumpPossessionSankeyTooltipMatrix(
        nodeMatrices,
        nodeKey,
        i > 0 ? possessionSankeyNodeKeyToName(prefix[i - 1]) : null,
        i < prefix.length - 1 ? possessionSankeyNodeKeyToName(prefix[i + 1]) : null,
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

function PossessionZonePitch({ homeTeam, awayTeam, homeColor, awayColor, zoneSeconds, className = '' }) {
  const zones = [
    { key: 'Left 45', x: 0, width: 45 },
    { key: 'Middle', x: 45, width: PITCH_W - 90 },
    { key: 'Right 45', x: PITCH_W - 45, width: 45 },
  ];
  const home = zoneSeconds?.home || {};
  const away = zoneSeconds?.away || {};
  const totalPossession = zones.reduce((sum, z) => sum + Number(home[z.key] || 0) + Number(away[z.key] || 0), 0);
  const pct = (value) => totalPossession > 0 ? `${((Number(value || 0) / totalPossession) * 100).toFixed(1)}%` : '0.0%';
  const homeName = homeTeam?.name || 'Home';
  const awayName = awayTeam?.name || 'Away';
  return (
    <div className={`relative overflow-hidden rounded-xl border border-slate-200 bg-slate-900/5 shadow-sm ${className}`.trim()} style={{ aspectRatio: `${PITCH_W} / ${PITCH_H}`, backgroundImage: `url(${pitchImg})`, backgroundSize: 'contain', backgroundRepeat: 'no-repeat', backgroundPosition: 'center' }}>
      <div className="absolute left-2.5 top-2.5 z-10 rounded-full border border-white/70 bg-white/80 px-3 py-1 text-[15px] font-medium tracking-wide shadow-sm backdrop-blur-[2px]" style={{ color: homeColor || '#fb4b14' }}>
        {homeName} attacks &rarr;
      </div>
      <div className="absolute right-2.5 top-2.5 z-10 rounded-full border border-white/70 bg-white/80 px-3 py-1 text-[15px] font-medium tracking-wide shadow-sm backdrop-blur-[2px]" style={{ color: awayColor || '#5b1f32' }}>
        &lt;- {awayName} attacks
      </div>
      <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${PITCH_W} ${PITCH_H}`} preserveAspectRatio="none">
        {zones.map((zone, index) => (
          <g key={zone.key}>
            <rect
              x={zone.x}
              y="0"
              width={zone.width}
              height={PITCH_H}
              fill={index % 2 === 0 ? 'rgba(15,23,42,0.10)' : 'rgba(255,255,255,0.08)'}
              stroke="rgba(255,255,255,0.55)"
              strokeWidth="0.35"
            />
          </g>
        ))}
      </svg>
      <div className="absolute inset-0 grid grid-cols-3">
        {zones.map((zone) => (
          <div key={zone.key} className="flex items-center justify-center px-2 py-8">
            <div className="min-w-[96px] rounded-xl border border-white/70 bg-white/90 px-3 py-2 text-center shadow-sm backdrop-blur-[3px] sm:min-w-[110px] sm:px-3.5">
              <div className="space-y-1">
                <div className="flex items-center justify-center gap-1.5 text-[0.8rem] font-medium text-black sm:text-[0.85rem]">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: homeColor || '#fb4b14', opacity: 0.8 }} />
                  <span className="truncate text-black">{homeName}:</span>
                  <span className="tabular-nums text-sm font-bold text-black sm:text-[0.95rem]">{pct(home[zone.key])}</span>
                </div>
                <div className="flex items-center justify-center gap-1.5 text-[0.8rem] font-medium text-black sm:text-[0.85rem]">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: awayColor || '#5b1f32', opacity: 0.8 }} />
                  <span className="truncate text-black">{awayName}:</span>
                  <span className="tabular-nums text-sm font-bold text-black sm:text-[0.95rem]">{pct(away[zone.key])}</span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PossessionsTab({ stats, homeTeam, awayTeam, reportFilters, onVisualisePossession, onOpenVideoAt, attackTypeFilter = 'any', setAttackTypeFilter, outcomeFilter = [], originFilter = [], startZoneFilter = [] }) {
  const paneClassName = 'border-2 border-slate-400 bg-gradient-to-br from-white via-white to-slate-50 shadow-md';
  const outcomeSeries = [
    { k: 'Score', c: '#059669' },
    { k: 'Missed Shot', c: '#eab308' },
    { k: 'Turnover', c: '#f97316' },
    { k: 'Half End', c: '#64748b' },
  ];
  const clickableOutcomeKeys = new Set(['Score', 'Missed Shot', 'Turnover']);
  const [outcomeMode, setOutcomeMode] = useState('possessions');
  const [flowView, setFlowView] = useState('charts');
  const [selectedPossessionSankeyNodeKey, setSelectedPossessionSankeyNodeKey] = useState(null);
  const [showAllPossessions, setShowAllPossessions] = useState(false);
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [breakdownCategory, setBreakdownCategory] = useState('');
  const [originBreakdownOpen, setOriginBreakdownOpen] = useState(false);
  const scopedReportFilters = useMemo(() => ({ ...reportFilters, allowedActionTypes: ['pass', 'carry', 'shot', 'turnover', 'kickout', 'throw_in', 'foul'] }), [reportFilters]);
  const possessionLevelFilters = useMemo(() => ({
    ...scopedReportFilters,
    actionTypes: [],
    outcomes: [],
    playerIds: [],
  }), [scopedReportFilters]);
  const base = useMemo(() => applyNonTeamReportFilters(stats, possessionLevelFilters), [stats, possessionLevelFilters]);
  const calcBase = useMemo(() => base.filter((s) => !shouldExcludeFromTotals(s)), [base]);
  const teamMode = String(reportFilters?.team || 'both'); // both|home|away

  const possessions = useMemo(() => {
    const groups = groupByPossession(calcBase);
    const orderedBase = calcBase.slice().sort((a, b) => {
      const pa = Number(a?.play_id);
      const pb = Number(b?.play_id);
      if (Number.isFinite(pa) && Number.isFinite(pb) && pa !== pb) return pa - pb;
      const ta = getMatchTimeS(a, reportFilters?.match, reportFilters?.imputedTimeById);
      const tb = getMatchTimeS(b, reportFilters?.match, reportFilters?.imputedTimeById);
      if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
      return String(a?.id || '').localeCompare(String(b?.id || ''));
    });
    const statsByPossessionKey = new Map();
    const previousByPossessionKey = new Map();
    orderedBase.forEach((stat, index) => {
      const pid = Number(stat?.possession_id);
      const pside = stat?.possession_team_side;
      if (!Number.isFinite(pid) || (pside !== 'home' && pside !== 'away')) return;
      const key = `${pside}-${pid}`;
      const arr = statsByPossessionKey.get(key) || [];
      arr.push(stat);
      statsByPossessionKey.set(key, arr);
      if (!previousByPossessionKey.has(key)) {
        previousByPossessionKey.set(key, index > 0 ? orderedBase[index - 1] : null);
      }
    });

    const out = [];
    for (const [key, evs0] of groups.entries()) {
      const [teamSide, pidStr] = String(key).split('-');
      const pid = Number(pidStr);
      if (teamSide !== 'home' && teamSide !== 'away') continue;
      if (!Number.isFinite(pid)) continue;

      const evs = (Array.isArray(evs0) ? evs0 : []).slice();

      const acting = evs.filter((e) => e && e.team_side === teamSide);
      if (!acting.length) continue;

      const outcome = derivePossessionOutcome(evs, teamSide);
      const times = evs.map((s) => getMatchTimeS(s, reportFilters?.match, reportFilters?.imputedTimeById)).filter(Number.isFinite);
      const firstEventTime = times.length ? Math.min(...times) : NaN;
      const endTime = times.length ? Math.max(...times) : NaN;
      const previousStat = previousByPossessionKey.get(key) || null;
      const startSource = inferPossessionStartSource(evs, teamSide, previousStat || []);
      const liveDuration = getDerivedPossessionDurationSeconds(evs, reportFilters?.match, reportFilters?.imputedTimeById);
      const liveStartAnchor = getLivePossessionStartAnchor(previousStat, startSource, reportFilters?.match, reportFilters?.imputedTimeById);
      const startTime = Number.isFinite(liveStartAnchor) ? liveStartAnchor : firstEventTime;
      const rawVideoTimes = evs.map((s) => Number(s?.time_s)).filter(Number.isFinite);
      const videoStartTime = rawVideoTimes.length ? Math.min(...rawVideoTimes) : NaN;
      const timeSummary = getPossessionTimeSummary(evs, teamSide, reportFilters?.match, reportFilters?.imputedTimeById, { startAnchorTimeS: liveStartAnchor });
      const physicalZoneSeconds = getPhysicalPossessionZoneSeconds(evs, reportFilters?.match, reportFilters?.imputedTimeById, liveStartAnchor, teamSide);
      const anchorGap =
        Number.isFinite(liveStartAnchor) && Number.isFinite(firstEventTime) && firstEventTime >= liveStartAnchor
          ? firstEventTime - liveStartAnchor
          : 0;
      const duration = Number.isFinite(timeSummary.liveSeconds)
        ? timeSummary.liveSeconds
        : Number.isFinite(liveDuration)
        ? liveDuration + anchorGap
        : (Number.isFinite(startTime) && Number.isFinite(endTime) ? Math.max(0, endTime - startTime) : NaN);

      const points = acting.reduce((a, e) => {
        if (e.stat_type !== 'shot') return a;
        if (shouldExcludeFromTotals(e)) return a;
        const ex = safeParseJSON(e.extra_data || '{}', {});
        return a + shotPointsForOutcome(ex?.shot?.outcome);
      }, 0);

      const isAttack = isAttackPossession(evs, teamSide);
      const orderedActing = acting.slice().sort((a, b) => {
        const pa = Number(a?.play_id);
        const pb = Number(b?.play_id);
        if (Number.isFinite(pa) && Number.isFinite(pb) && pa !== pb) return pa - pb;
        const ta = getMatchTimeS(a, reportFilters?.match, reportFilters?.imputedTimeById);
        const tb = getMatchTimeS(b, reportFilters?.match, reportFilters?.imputedTimeById);
        if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
        return String(a?.id || '').localeCompare(String(b?.id || ''));
      });
      const passes = acting.filter((e) => e.stat_type === 'pass' && deriveOutcome(e, safeParseJSON(e.extra_data || '{}', {})) === 'completed').length;
      const shots = acting.filter((e) => e.stat_type === 'shot' && !shouldExcludeFromTotals(e)).length;
      const firstOpp45EntryStat = orderedActing.find((stat) => statHasEnteredOpp45(stat));
      const firstOpp45EntryTime = firstOpp45EntryStat ? getMatchTimeS(firstOpp45EntryStat, reportFilters?.match, reportFilters?.imputedTimeById) : NaN;
      const timeToAttack = Number.isFinite(startTime) && Number.isFinite(firstOpp45EntryTime)
        ? Math.max(0, firstOpp45EntryTime - startTime)
        : NaN;
      const counterState = deriveCounterAttackState(acting);
      const attackType = deriveAttackTypeState(acting);
      const attackEntryChannel = isAttack ? getAttackEntryChannelForPossession(evs, teamSide) : '';
      const startZone = getPossessionStartZone(acting);

      out.push({
        key,
        teamSide,
        possessionId: pid,
        previousStat,
        half: acting[0]?.half || '',
        startTime,
        videoStartTime,
        endTime,
        duration,
        timeToAttack,
        startSource,
        outcome,
        isAttack,
        passes,
        shots,
        points,
        counterState,
        attackType,
        attackEntryChannel,
        startZone,
        zoneSeconds: timeSummary.zoneSeconds || {},
        physicalZoneSeconds,
        stats: evs,
      });
    }

    out.sort((a, b) => {
      if (Number.isFinite(a.possessionId) && Number.isFinite(b.possessionId) && a.possessionId !== b.possessionId) return a.possessionId - b.possessionId;
      if (a.teamSide !== b.teamSide) return String(a.teamSide).localeCompare(String(b.teamSide));
      return String(a.key).localeCompare(String(b.key));
    });
    return out;
  }, [calcBase, reportFilters]);

  const possessionsFiltered = useMemo(() => {
    return possessions.filter((p) => {
      if (attackTypeFilter !== 'any' && attackTypeStateKey(p.attackType) !== attackTypeFilter) return false;
      const groupedOutcome = ['Wide', 'Short', 'Blocked', 'Saved', 'Post'].includes(String(p?.outcome || '')) ? 'Missed Shot' : String(p?.outcome || '');
      if (outcomeFilter.length && !outcomeFilter.includes(groupedOutcome)) return false;
      const originLabel = deriveOriginLabel(p);
      if (originFilter.length && !originFilter.includes(originLabel)) return false;
      if (startZoneFilter.length && !startZoneFilter.includes(String(p?.startZone || ''))) return false;
      return true;
    });
  }, [possessions, attackTypeFilter, outcomeFilter, originFilter, startZoneFilter]);

  const attacks = useMemo(() => possessionsFiltered.filter((p) => p.isAttack), [possessionsFiltered]);

  const sideKpis = useMemo(() => {
    const calc = (rows) => {
      const possN = rows.length;
      const att = rows.filter((p) => p.isAttack);
      const attN = att.length;
      const totalPts = rows.reduce((a, p) => a + (p.points || 0), 0);
      const pointsPerPossession = possN ? totalPts / possN : NaN;
      const ds = rows.map((p) => p.duration).filter(Number.isFinite);
      const livePossessionSeconds = ds.reduce((a, b) => a + b, 0);
      const avgDur = ds.length ? ds.reduce((a, b) => a + b, 0) / ds.length : NaN;
      const possToShot = possN ? (rows.filter((p) => p.shots > 0).length / possN) * 100 : NaN;
      const passesPerPoss = possN ? rows.reduce((a, p) => a + (p.passes || 0), 0) / possN : NaN;
      const setAttackPct = possN ? (rows.filter((p) => String(p.attackType || '') === 'Set').length / possN) * 100 : NaN;
      const channels = { Left: 0, Middle: 0, Right: 0 };
      rows.filter((p) => p.isAttack).forEach((p) => {
        if (channels[p.attackEntryChannel] != null) channels[p.attackEntryChannel] += 1;
      });
      return { possN, attN, pointsPerPossession, livePossessionSeconds, avgDur, possToShot, passesPerPoss, setAttackPct, channels };
    };
    const home = calc(possessionsFiltered.filter((p) => p.teamSide === 'home'));
    const away = calc(possessionsFiltered.filter((p) => p.teamSide === 'away'));
    const totalLive = Number(home.livePossessionSeconds || 0) + Number(away.livePossessionSeconds || 0);
    return {
      home: { ...home, possessionPct: totalLive ? (Number(home.livePossessionSeconds || 0) / totalLive) * 100 : NaN },
      away: { ...away, possessionPct: totalLive ? (Number(away.livePossessionSeconds || 0) / totalLive) * 100 : NaN },
    };
  }, [possessionsFiltered]);

  const byTeam = (rows) => {
    const out = {
      home: Object.fromEntries(outcomeSeries.map((o) => [o.k, 0])),
      away: Object.fromEntries(outcomeSeries.map((o) => [o.k, 0])),
    };
    for (const r of rows) {
      const side = r.teamSide;
      if (!out[side]) continue;
      const raw = String(r.outcome || 'Turnover');
      const k = ['Wide', 'Short', 'Blocked', 'Saved', 'Post'].includes(raw) ? 'Missed Shot' : raw;
      if (out[side][k] == null) out[side][k] = 0;
      out[side][k] += 1;
    }
    const rowsOut = [];
    if (teamMode === 'both' || teamMode === 'home') rowsOut.push({ team: homeTeam?.name || 'Home', side: 'home', ...out.home });
    if (teamMode === 'both' || teamMode === 'away') rowsOut.push({ team: awayTeam?.name || 'Away', side: 'away', ...out.away });
    return rowsOut;
  };

  const possessionOutcomeData = useMemo(() => byTeam(possessionsFiltered), [possessionsFiltered, homeTeam, awayTeam, teamMode]);
  const attackOutcomeData = useMemo(() => byTeam(attacks), [attacks, homeTeam, awayTeam, teamMode]);
  const buildOutcomeBreakdown = useMemo(() => {
    const pickRows = outcomeMode === 'attacks' ? attacks : possessionsFiltered;
    const template = {
      Score: ['Goal', '2 Point', '1 Point'],
      'Missed Shot': ['Wide', 'Short', 'Blocked', 'Saved', 'Post'],
      Turnover: [],
      'Half End': ['Half End'],
    };
    const grouped = {};
    Object.entries(template).forEach(([key, labels]) => {
      const counts = {
        home: Object.fromEntries(labels.map((label) => [label, 0])),
        away: Object.fromEntries(labels.map((label) => [label, 0])),
      };
      pickRows.forEach((row) => {
        const side = row?.teamSide;
        if (side !== 'home' && side !== 'away') return;
        const rawOutcome = String(row?.outcome || 'Turnover');
        const category = ['Wide', 'Short', 'Blocked', 'Saved', 'Post'].includes(rawOutcome) ? 'Missed Shot' : rawOutcome;
        if (category !== key) return;
        if (key === 'Score') {
          const actingShots = Array.isArray(row?.stats)
            ? row.stats.filter((stat) => stat?.stat_type === 'shot' && stat?.team_side === side && !shouldExcludeFromTotals(stat))
            : [];
          let bucket = '1 Point';
          if (actingShots.some((stat) => shotPointsForOutcome(safeParseJSON(stat.extra_data || '{}', {})?.shot?.outcome) === 3)) bucket = 'Goal';
          else if (actingShots.some((stat) => shotPointsForOutcome(safeParseJSON(stat.extra_data || '{}', {})?.shot?.outcome) === 2)) bucket = '2 Point';
          counts[side][bucket] += 1;
          return;
        }
        if (key === 'Missed Shot') {
          counts[side][rawOutcome] += 1;
          return;
        }
        if (key === 'Turnover') {
          const ordered = Array.isArray(row?.stats)
            ? row.stats.slice().sort((a, b) => {
              const pa = Number(a?.play_id);
              const pb = Number(b?.play_id);
              if (Number.isFinite(pa) && Number.isFinite(pb) && pa !== pb) return pa - pb;
              const ta = Number(a?.normalized_time_s);
              const tb = Number(b?.normalized_time_s);
              if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
              return String(a?.id || '').localeCompare(String(b?.id || ''));
            })
            : [];
          let turnoverLabel = 'Other';
          for (let idx = ordered.length - 1; idx >= 0; idx -= 1) {
            const stat = ordered[idx];
            const ex = safeParseJSON(stat?.extra_data || '{}', {});
            const passOutcome = String(ex?.pass?.outcome || '');
            const carryOutcome = String(ex?.carry?.outcome || '');
            const turnoverType = String(ex?.turnover?.turnover_type || ex?.turnover?.type || '');
            if (stat?.stat_type === 'turnover' || turnoverType || passOutcome === 'turnover' || carryOutcome === 'turnover') {
              turnoverLabel = toTitleCase(turnoverType || 'turnover');
              break;
            }
            if (['sideline_against', '45_against', 'goal_kick_against'].includes(passOutcome) || ['sideline_against', '45_against', 'goal_kick_against'].includes(carryOutcome)) {
              turnoverLabel = toTitleCase(passOutcome || carryOutcome);
              break;
            }
            if (passOutcome === 'foul' || carryOutcome === 'foul') {
              const foul = extractFoulFromStat(stat);
              turnoverLabel = toTitleCase(foul?.foul_type || 'foul');
              break;
            }
          }
          counts[side][turnoverLabel] = Number(counts[side][turnoverLabel] || 0) + 1;
          return;
        }
        counts[side][labels[0]] += 1;
      });

      grouped[key] = [];
      if (teamMode === 'both' || teamMode === 'home') {
        grouped[key].push({ team: homeTeam?.name || 'Home', side: 'home', ...counts.home });
      }
      if (teamMode === 'both' || teamMode === 'away') {
        grouped[key].push({ team: awayTeam?.name || 'Away', side: 'away', ...counts.away });
      }
    });
    return grouped;
  }, [attacks, possessionsFiltered, homeTeam, awayTeam, teamMode, outcomeMode]);
  const startZoneData = useMemo(() => {
    const zones = ['Defensive Third', 'Middle Third', 'Attacking Third'];
    const counts = {
      home: Object.fromEntries(zones.map((z) => [z, 0])),
      away: Object.fromEntries(zones.map((z) => [z, 0])),
    };
    for (const p of possessionsFiltered) {
      if (!counts[p.teamSide] || counts[p.teamSide][p.startZone] == null) continue;
      counts[p.teamSide][p.startZone] += 1;
    }
    const rows = [];
    if (teamMode === 'both' || teamMode === 'home') {
      rows.push({ team: homeTeam?.name || 'Home', side: 'home', ...counts.home });
    }
    if (teamMode === 'both' || teamMode === 'away') {
      rows.push({ team: awayTeam?.name || 'Away', side: 'away', ...counts.away });
    }
    return rows;
  }, [possessionsFiltered, homeTeam, awayTeam, teamMode]);

  const possessionZoneTimeData = useMemo(() => {
    const zones = ['Defensive Third', 'Middle Third', 'Attacking Third', 'Unknown'];
    const seconds = {
      home: Object.fromEntries(zones.map((z) => [z, 0])),
      away: Object.fromEntries(zones.map((z) => [z, 0])),
    };
    for (const p of possessionsFiltered) {
      if (!seconds[p.teamSide]) continue;
      for (const z of zones) seconds[p.teamSide][z] += Number(p.zoneSeconds?.[z] || 0);
    }
    const rows = [];
    if (teamMode === 'both' || teamMode === 'home') {
      rows.push({ team: homeTeam?.name || 'Home', side: 'home', ...seconds.home });
    }
    if (teamMode === 'both' || teamMode === 'away') {
      rows.push({ team: awayTeam?.name || 'Away', side: 'away', ...seconds.away });
    }
    return rows;
  }, [possessionsFiltered, homeTeam, awayTeam, teamMode]);

  const possessionPhysicalZoneSeconds = useMemo(() => {
    const zones = PHYSICAL_ZONE_LABELS;
    const seconds = {
      home: Object.fromEntries(zones.map((z) => [z, 0])),
      away: Object.fromEntries(zones.map((z) => [z, 0])),
    };
    for (const p of possessionsFiltered) {
      if (!seconds[p.teamSide]) continue;
      for (const z of zones) seconds[p.teamSide][z] += Number(p.physicalZoneSeconds?.[z] || 0);
    }
    return seconds;
  }, [possessionsFiltered]);

  const originSeries = useMemo(() => ([
    { key: 'Turnover Won', color: '#dc6b1f' },
    { key: 'Own KO Won', color: '#1d4ed8' },
    { key: 'Opp KO Won', color: '#06b6d4' },
    { key: 'Shot Missed (Live Ball)', color: '#eab308' },
    { key: 'Throw In Won', color: '#7c3aed' },
  ]), []);
  function deriveOriginLabel(possession, { grouped = true } = {}) {
    const startSource = String(possession?.startSource || '');
    if (['Shot Short', 'Shot Blocked', 'Shot Post', 'Shot Saved'].includes(startSource)) {
      return grouped ? 'Shot Missed (Live Ball)' : startSource;
    }
    if (startSource !== 'Kickout Won') return startSource;
    const firstStat = Array.isArray(possession?.stats) ? possession.stats[0] : null;
    const kickoutStat = firstStat?.stat_type === 'kickout'
      ? firstStat
      : (possession?.previousStat?.stat_type === 'kickout' ? possession.previousStat : null);
    const kickoutTeamSide = kickoutStat?.team_side;
    if (kickoutTeamSide === 'home' || kickoutTeamSide === 'away') {
      return kickoutTeamSide === possession?.teamSide ? 'Own KO Won' : 'Opp KO Won';
    }
    return 'Own KO Won';
  }
  const possessionOriginData = useMemo(() => {
    const allowed = originSeries.map((item) => item.key);
    const counts = {
      home: Object.fromEntries(allowed.map((key) => [key, 0])),
      away: Object.fromEntries(allowed.map((key) => [key, 0])),
    };
    for (const p of possessionsFiltered) {
      const sourceLabel = deriveOriginLabel(p);
      if (!allowed.includes(sourceLabel)) continue;
      const source = sourceLabel;
      if (p.teamSide === 'home') counts.home[source] += 1;
      if (p.teamSide === 'away') counts.away[source] += 1;
    }
    const rows = [];
    if (teamMode === 'both' || teamMode === 'home') rows.push({ team: homeTeam?.name || 'Home', side: 'home', ...counts.home });
    if (teamMode === 'both' || teamMode === 'away') rows.push({ team: awayTeam?.name || 'Away', side: 'away', ...counts.away });
    return rows;
  }, [possessionsFiltered, originSeries, homeTeam, awayTeam, teamMode]);
  const sharedOutcomeAxisMax = useMemo(() => {
    const totals = possessionOriginData.map((row) =>
      originSeries.reduce((sum, item) => sum + Number(row?.[item.key] || 0), 0)
    );
    const maxValue = totals.length ? Math.max(...totals, 0) : 0;
    if (maxValue <= 0) return 1;
    return Math.ceil(maxValue / 15) * 15;
  }, [possessionOriginData, originSeries]);
  const originBreakdownRows = useMemo(() => {
    const detailKeys = ['Shot Short', 'Shot Blocked', 'Shot Post', 'Shot Saved'];
    const counts = {
      home: Object.fromEntries(detailKeys.map((key) => [key, 0])),
      away: Object.fromEntries(detailKeys.map((key) => [key, 0])),
    };
    for (const p of possessionsFiltered) {
      const sourceLabel = deriveOriginLabel(p, { grouped: false });
      if (!detailKeys.includes(sourceLabel)) continue;
      if (p.teamSide === 'home') counts.home[sourceLabel] += 1;
      if (p.teamSide === 'away') counts.away[sourceLabel] += 1;
    }
    const rows = [];
    if (teamMode === 'both' || teamMode === 'home') rows.push({ team: homeTeam?.name || 'Home', side: 'home', ...counts.home });
    if (teamMode === 'both' || teamMode === 'away') rows.push({ team: awayTeam?.name || 'Away', side: 'away', ...counts.away });
    return rows;
  }, [possessionsFiltered, homeTeam, awayTeam, teamMode]);
  const renderOutcomeTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    const row = payload[0]?.payload || {};
    const total = outcomeSeries.reduce((sum, item) => sum + Number(row?.[item.k] || 0), 0);
    return (
      <div className="grid min-w-[10rem] gap-1.5 rounded-xl border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
        <div className="font-medium">{label || row.team || 'Outcomes'}</div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Total {outcomeMode === 'attacks' ? 'Attacks' : 'Possessions'}</span>
          <span className="font-mono font-medium tabular-nums text-foreground">{total}</span>
        </div>
        {outcomeSeries.map((item) => (
          <div key={item.k} className="flex justify-between gap-4">
            <span className="text-muted-foreground">{item.k}</span>
            <span className="font-mono font-medium tabular-nums text-foreground">{Number(row?.[item.k] || 0)}</span>
          </div>
        ))}
      </div>
    );
  };
  const renderOriginsTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.length) return null;
    const row = payload[0]?.payload || {};
    const total = originSeries.reduce((sum, item) => sum + Number(row?.[item.key] || 0), 0);
    return (
      <div className="grid min-w-[11rem] gap-1.5 rounded-xl border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
        <div className="font-medium">{label || row.team || 'Origins'}</div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Total Possessions</span>
          <span className="font-mono font-medium tabular-nums text-foreground">{total}</span>
        </div>
        {originSeries
          .filter((item) => Number(row?.[item.key] || 0) > 0)
          .map((item) => (
            <div key={item.key} className="flex justify-between gap-4">
              <span className="text-muted-foreground">{item.key}</span>
              <span className="font-mono font-medium tabular-nums text-foreground">{Number(row?.[item.key] || 0)}</span>
            </div>
          ))}
      </div>
    );
  };
  const [possessionSort, setPossessionSort] = useState({ key: 'possessionId', dir: 'asc' });
  const possessionColumns = useMemo(() => ([
    { key: 'possessionId', label: 'Poss', sortValue: (r) => r.possessionId },
    { key: 'team', label: 'Team', sortValue: (r) => r.teamSide === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home') },
    { key: 'half', label: 'Half', sortValue: (r) => r.half },
    { key: 'startTime', label: 'Start', sortValue: (r) => r.startTime },
    { key: 'endTime', label: 'End', sortValue: (r) => r.endTime },
    { key: 'duration', label: 'Dur', sortValue: (r) => r.duration },
    { key: 'timeToAttack', label: 'TTA', sortValue: (r) => r.timeToAttack },
    { key: 'startSource', label: 'Start Source', sortValue: (r) => r.startSource },
    { key: 'startZone', label: 'Start Zone', sortValue: (r) => r.startZone },
    { key: 'outcome', label: 'Outcome', sortValue: (r) => r.outcome },
    { key: 'passes', label: 'Passes', sortValue: (r) => r.passes },
    { key: 'attack', label: 'Attack', sortValue: (r) => (r.isAttack ? 1 : 0) },
    { key: 'shot', label: 'Shot', sortValue: (r) => (r.shots > 0 ? 1 : 0) },
    { key: 'points', label: 'Pts', sortValue: (r) => r.points },
    { key: 'attackType', label: 'Attack Type', sortValue: (r) => r.attackType },
  ]), [homeTeam, awayTeam]);
  const sortedPossessions = useMemo(() => sortRows(possessionsFiltered, possessionSort, possessionColumns, 'key'), [possessionsFiltered, possessionSort, possessionColumns]);
  const visiblePossessions = useMemo(() => (showAllPossessions ? sortedPossessions : sortedPossessions.slice(0, 5)), [showAllPossessions, sortedPossessions]);
  const togglePossessionSort = (key) => setPossessionSort((current) => current.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'team' || key === 'half' || key === 'startSource' || key === 'outcome' || key === 'startZone' || key === 'attackType' ? 'asc' : 'desc' });
  const activeOutcomeData = outcomeMode === 'attacks' ? attackOutcomeData : possessionOutcomeData;
  const openBreakdown = (key) => {
    if (!clickableOutcomeKeys.has(key)) return;
    setBreakdownCategory(key);
    setBreakdownOpen(true);
  };
  const breakdownRows = breakdownCategory ? (buildOutcomeBreakdown?.[breakdownCategory] || []) : [];
  const breakdownSeries = useMemo(() => {
    if (!breakdownRows.length) return [];
    const keys = Array.from(new Set(breakdownRows.flatMap((row) => Object.keys(row || {}))))
      .filter((key) => !['team', 'side'].includes(key));
    const palette = ['#047857', '#0ea5e9', '#6366f1', '#f59e0b', '#dc2626', '#7c3aed', '#334155'];
    return keys.map((key, index) => ({ key, color: palette[index % palette.length] }));
  }, [breakdownRows]);
  const buildPossessionFlowData = useMemo(() => (teamSide) => {
    const outcomeColorMap = Object.fromEntries(outcomeSeries.map((item) => [item.k, item.c]));
    const originColorMap = Object.fromEntries(originSeries.map((item) => [item.key, item.color]));
    const linkCounts = new Map();
    const nodeMatrices = new Map();
    const nodeOriginTotals = new Map();
    const flowPathCounts = new Map();
    const bumpOriginTotal = (nodeKey, originLabel, count = 1) => {
      if (!nodeOriginTotals.has(nodeKey)) nodeOriginTotals.set(nodeKey, new Map());
      const origins = nodeOriginTotals.get(nodeKey);
      origins.set(originLabel, (origins.get(originLabel) || 0) + count);
    };
    for (const p of possessionsFiltered.filter((row) => !teamSide || row.teamSide === teamSide)) {
      const origin = deriveOriginLabel(p);
      const outcome = ['Wide', 'Short', 'Blocked', 'Saved', 'Post'].includes(String(p?.outcome || '')) ? 'Missed Shot' : String(p?.outcome || 'Turnover');
      if (!origin || !outcome) continue;
      const key = `${origin}__${outcome}`;
      linkCounts.set(key, Number(linkCounts.get(key) || 0) + 1);
      bumpPossessionSankeyTooltipMatrix(nodeMatrices, origin, null, outcome, 1);
      bumpPossessionSankeyTooltipMatrix(nodeMatrices, outcome, origin, null, 1);
      bumpOriginTotal(`1:${origin}`, origin, 1);
      bumpOriginTotal(`2:${outcome}`, origin, 1);
      const flowKey = `1:${origin}||2:${outcome}`;
      flowPathCounts.set(flowKey, (flowPathCounts.get(flowKey) || 0) + 1);
    }
    const originLabels = originSeries.map((item) => item.key);
    const outcomeLabels = outcomeSeries.map((item) => item.k);
    if (!linkCounts.size) return null;
    const orderedNodes = [
      ...originLabels.map((label) => ({ name: label, color: originColorMap[label] || '#94a3b8', layer: 1, nodeKey: `1:${label}` })),
      ...outcomeLabels.map((label) => ({ name: label, color: outcomeColorMap[label] || '#94a3b8', layer: 2, nodeKey: `2:${label}` })),
    ];
    const nodes = orderedNodes;
    const nodeIndex = new Map(nodes.map((node, index) => [node.name, index]));
    const links = Array.from(linkCounts.entries()).map(([key, value]) => {
      const [origin, outcome] = key.split('__');
      return {
        source: nodeIndex.get(origin),
        target: nodeIndex.get(outcome),
        value,
        sourceName: origin,
        targetName: outcome,
        sourceLayer: 1,
        targetLayer: 2,
        sourceKey: `1:${origin}`,
        targetKey: `2:${outcome}`,
        linkKey: `1:${origin}->2:${outcome}`,
      };
    });
    return {
      nodes: nodes.map((node) => ({
        ...node,
        tooltipMatrix: serializePossessionSankeyTooltipMatrix(nodeMatrices.get(node.name)),
        originTotals: serializePossessionSankeyOriginTotals(nodeOriginTotals.get(node.nodeKey), originLabels),
      })),
      links,
      flowPaths: Array.from(flowPathCounts.entries()).map(([key, value]) => ({ nodes: key.split('||'), value })),
      originOrder: originLabels,
    };
  }, [possessionsFiltered, originSeries, outcomeSeries]);
  const possessionFlowPanels = useMemo(() => {
    const panels = [];
    if (teamMode === 'both' || teamMode === 'home') {
      const data = buildPossessionFlowData('home');
      if (data) panels.push({ side: 'home', title: `${homeTeam?.name || 'Home'} Origin to Outcome Flow`, data });
    }
    if (teamMode === 'both' || teamMode === 'away') {
      const data = buildPossessionFlowData('away');
      if (data) panels.push({ side: 'away', title: `${awayTeam?.name || 'Away'} Origin to Outcome Flow`, data });
    }
    return panels;
  }, [teamMode, buildPossessionFlowData, homeTeam, awayTeam]);
  useEffect(() => {
    setSelectedPossessionSankeyNodeKey(null);
  }, [teamMode, possessionsFiltered]);
  const possessionFlowRenderPanels = useMemo(() => possessionFlowPanels.map((panel) => {
    const highlight = buildPossessionSankeyHighlight(panel.data, selectedPossessionSankeyNodeKey);
    return {
      ...panel,
      data: {
        ...panel.data,
        nodes: panel.data.nodes.map((node) => ({
          ...node,
          tooltipMatrix: selectedPossessionSankeyNodeKey && highlight.nodeKeys.has(node.nodeKey)
            ? serializePossessionSankeyTooltipMatrix(highlight.nodeMatrices.get(node.nodeKey))
            : node.tooltipMatrix,
          originTotals: selectedPossessionSankeyNodeKey && highlight.nodeKeys.has(node.nodeKey)
            ? serializePossessionSankeyOriginTotals(highlight.nodeOriginTotals.get(node.nodeKey), panel.data.originOrder || [])
            : node.originTotals,
          isSelected: selectedPossessionSankeyNodeKey === node.nodeKey,
          isDimmed: !!selectedPossessionSankeyNodeKey && !highlight.nodeKeys.has(node.nodeKey),
          onSelect: () => setSelectedPossessionSankeyNodeKey((current) => current === node.nodeKey ? null : node.nodeKey),
        })),
        links: panel.data.links.map((link) => ({
          ...link,
          highlightValue: highlight.linkValues.get(link.linkKey) || 0,
          isHighlighted: highlight.linkValues.has(link.linkKey),
          isDimmed: !!selectedPossessionSankeyNodeKey && !highlight.linkValues.has(link.linkKey),
        })),
      },
    };
  }), [possessionFlowPanels, selectedPossessionSankeyNodeKey]);
  const renderSankeyNode = ({ x, y, width, height, index, payload }) => (
    <g
      key={`node-${index}`}
      onClick={payload?.onSelect ? () => payload.onSelect(payload) : undefined}
      style={{ cursor: payload?.onSelect ? 'pointer' : 'default' }}
    >
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={3}
        fill={payload?.color || '#94a3b8'}
        fillOpacity={payload?.isDimmed ? 0.18 : (payload?.isSelected ? 1 : 0.92)}
        stroke={payload?.isSelected ? '#0f172a' : '#ffffff'}
        strokeWidth={payload?.isSelected ? 1.8 : 1}
      />
      <text
        x={x + (payload?.depth === 0 ? width + 8 : -8)}
        y={y + (height / 2)}
        textAnchor={payload?.depth === 0 ? 'start' : 'end'}
        dominantBaseline="middle"
        fill={payload?.isDimmed ? '#94a3b8' : '#0f172a'}
        fontSize={11}
        fontWeight={600}
      >
        {payload?.name || ''}
      </text>
    </g>
  );
  const renderSankeyLink = (props) => {
    const { sourceX, targetX, sourceY, targetY, sourceControlX, targetControlX, linkWidth, payload } = props;
    const color = payload?.target?.color || '#cbd5e1';
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
  };
  const renderSankeyTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const entry = payload[0] || {};
    const item = entry?.payload || entry;
    const sourceName = item?.source?.name || item?.payload?.source?.name || '';
    const targetName = item?.target?.name || item?.payload?.target?.name || '';
    const nodeName = item?.name || item?.payload?.name || '';
    const value = Number(item?.value ?? item?.payload?.value ?? entry?.value ?? 0);
    const filteredValue = Number(item?.highlightValue ?? item?.payload?.highlightValue ?? value);
    const displayValue = item?.isHighlighted ? filteredValue : value;
    if (sourceName && targetName) {
      return (
        <div className="rounded-xl border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
          <div className="font-medium text-slate-900">{sourceName} -&gt; {targetName}</div>
          <div className="mt-1 flex justify-between gap-4">
            <span className="text-muted-foreground">Possessions</span>
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
  };
  const openOriginBreakdown = (key) => {
    if (key !== 'Shot Missed (Live Ball)') return;
    setOriginBreakdownOpen(true);
  };
  return (
    <div className="space-y-4">
      <div className="report-metric-split items-stretch">
        <ComparisonMetricsCard
          title="Possession Metrics"
          cardClassName={`w-full ${paneClassName}`}
          homeTeam={homeTeam}
          awayTeam={awayTeam}
          teamMode={teamMode}
          rows={[
            { label: 'Possessions (Attacks)', home: `${sideKpis.home.possN} (${sideKpis.home.attN})`, away: `${sideKpis.away.possN} (${sideKpis.away.attN})` },
            {
              label: 'Possession (%)',
              home: Number.isFinite(sideKpis.home.livePossessionSeconds) ? `${formatMMSS(sideKpis.home.livePossessionSeconds)} (${formatPct(sideKpis.home.possessionPct)})` : 'NA',
              away: Number.isFinite(sideKpis.away.livePossessionSeconds) ? `${formatMMSS(sideKpis.away.livePossessionSeconds)} (${formatPct(sideKpis.away.possessionPct)})` : 'NA',
            },
            { label: 'Points Per Possession', home: Number.isFinite(sideKpis.home.pointsPerPossession) ? sideKpis.home.pointsPerPossession.toFixed(2) : 'NA', away: Number.isFinite(sideKpis.away.pointsPerPossession) ? sideKpis.away.pointsPerPossession.toFixed(2) : 'NA' },
            { label: 'Avg Possession Duration', home: Number.isFinite(sideKpis.home.avgDur) ? `${sideKpis.home.avgDur.toFixed(1)}s` : 'NA', away: Number.isFinite(sideKpis.away.avgDur) ? `${sideKpis.away.avgDur.toFixed(1)}s` : 'NA' },
            { label: 'Completed Passes Per Possession', home: Number.isFinite(sideKpis.home.passesPerPoss) ? sideKpis.home.passesPerPoss.toFixed(2) : 'NA', away: Number.isFinite(sideKpis.away.passesPerPoss) ? sideKpis.away.passesPerPoss.toFixed(2) : 'NA' },
            { label: 'Possession To Shot %', home: formatPct(sideKpis.home.possToShot), away: formatPct(sideKpis.away.possToShot) },
            { label: 'Set Attack %', home: formatPct(sideKpis.home.setAttackPct), away: formatPct(sideKpis.away.setAttackPct) },
          ]}
        />

        <div className="report-companion-grid h-full self-stretch">
          <Card className={`${paneClassName} h-full`}>
            <CardContent className="flex h-full flex-col p-4">
              <div>
                <div className="font-semibold text-slate-900">Possession Time By Zone</div>
              </div>
              <div className="mt-3 flex flex-1 items-center justify-center py-2">
                <PossessionZonePitch
                  className="w-full max-w-[660px]"
                  homeTeam={homeTeam}
                  awayTeam={awayTeam}
                  homeColor={homeTeam?.color || '#fb4b14'}
                  awayColor={awayTeam?.color || '#5b1f32'}
                  zoneSeconds={possessionPhysicalZoneSeconds}
                />
              </div>
            </CardContent>
          </Card>

        </div>
      </div>

        {possessionsFiltered.length === 0 ? (
          <Card className={paneClassName}>
            <CardContent className="p-6 text-sm text-slate-600 text-center">
              No possessions available for current filters.
            </CardContent>
          </Card>
        ) : (
          <>
            <Card className={paneClassName}>
              <CardContent className="space-y-4 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-semibold text-slate-900">Possession Flow</div>
                  <div className="inline-flex items-center gap-2">
                    <Button type="button" variant={flowView === 'charts' ? 'default' : 'outline'} size="sm" className="h-7 px-2 text-xs" onClick={() => setFlowView('charts')}>
                      Charts
                    </Button>
                    <Button type="button" variant={flowView === 'mapping' ? 'default' : 'outline'} size="sm" className="h-7 px-2 text-xs" onClick={() => setFlowView('mapping')}>
                      Mapping
                    </Button>
                  </div>
                </div>
                {flowView === 'mapping' ? (
                  possessionFlowPanels.length ? (
                    <div className={`grid gap-4 ${possessionFlowRenderPanels.length > 1 ? 'xl:grid-cols-2' : ''}`}>
                      {possessionFlowRenderPanels.map((panel) => (
                        <div key={panel.side} className="space-y-2">
                          <div className="font-semibold text-slate-900">{panel.title}</div>
                          <div className="h-[300px] w-full">
                            <ResponsiveContainer width="100%" height="100%">
                              <Sankey
                                data={panel.data}
                                node={renderSankeyNode}
                                link={renderSankeyLink}
                                nodePadding={18}
                                nodeWidth={12}
                                margin={{ top: 12, right: 88, bottom: 12, left: 88 }}
                                sort={false}
                              >
                                <Tooltip content={renderSankeyTooltip} />
                              </Sankey>
                            </ResponsiveContainer>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-slate-500">No possession flow available for current filters.</div>
                  )
                ) : (
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_1px_minmax(0,1fr)] lg:items-stretch">
                    <div className="flex h-full flex-col space-y-3">
                      <div className="min-h-[42px] flex items-start">
                        <div className="pt-0.5 font-semibold text-slate-900">Possession Origins</div>
                      </div>
                      <div className="flex min-h-[40px] flex-wrap gap-2 text-[11px]">
                          {originSeries.map((item) => (
                            <button
                              key={item.key}
                              type="button"
                              onClick={() => openOriginBreakdown(item.key)}
                              className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 ${
                                item.key === 'Shot Missed (Live Ball)'
                                  ? 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                                  : 'border-slate-100 bg-slate-50 text-slate-500'
                              }`}
                            >
                              <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
                              <span>{item.key}</span>
                            </button>
                          ))}
                      </div>
                      <ChartContainer id="possession-origins" className="h-[280px] w-full flex-1" config={{}}>
                        <BarChart data={possessionOriginData} margin={{ top: 12, right: 16, left: 0, bottom: 6 }} barCategoryGap={28}>
                          <CartesianGrid vertical={false} />
                          <XAxis dataKey="team" className="text-xs" />
                          <YAxis allowDecimals={false} width={34} className="text-xs" domain={[0, sharedOutcomeAxisMax]} />
                          <Tooltip content={renderOriginsTooltip} />
                          {originSeries.map((item) => (
                            <Bar key={item.key} dataKey={item.key} stackId="a" fill={item.color} onClick={() => openOriginBreakdown(item.key)} className={item.key === 'Shot Missed (Live Ball)' ? 'cursor-pointer' : ''} />
                          ))}
                        </BarChart>
                      </ChartContainer>
                    </div>
                    <div className="hidden lg:block self-stretch w-px bg-slate-200/90" />
                    <div className="flex h-full flex-col space-y-3">
                      <div className="flex min-h-[42px] items-start">
                        <div className="pt-0.5 font-semibold text-slate-900">{outcomeMode === 'attacks' ? 'Attack Outcomes' : 'Possession Outcomes'}</div>
                      </div>
                      <div className="flex min-h-[40px] flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap gap-2 text-[11px]">
                          {outcomeSeries.map((item) => (
                            <button
                              key={item.k}
                              type="button"
                              onClick={() => openBreakdown(item.k)}
                              className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 ${
                                clickableOutcomeKeys.has(item.k)
                                  ? 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                                  : 'cursor-default border-slate-100 bg-slate-50 text-slate-500'
                              }`}
                              disabled={!clickableOutcomeKeys.has(item.k)}
                            >
                              <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: item.c }} />
                              <span>{item.k}</span>
                            </button>
                          ))}
                        </div>
                        <div className="inline-flex items-center gap-2">
                          <Button type="button" variant={outcomeMode === 'possessions' ? 'default' : 'outline'} size="sm" className="h-7 px-2 text-xs" onClick={() => setOutcomeMode('possessions')}>
                            Possessions
                          </Button>
                          <Button type="button" variant={outcomeMode === 'attacks' ? 'default' : 'outline'} size="sm" className="h-7 px-2 text-xs" onClick={() => setOutcomeMode('attacks')}>
                            Attacks
                          </Button>
                        </div>
                      </div>
                      <ChartContainer id="possession-outcomes" className="h-[280px] w-full flex-1" config={{}}>
                        <BarChart data={activeOutcomeData} margin={{ top: 12, right: 16, left: 0, bottom: 6 }} barCategoryGap={28}>
                          <CartesianGrid vertical={false} />
                          <XAxis dataKey="team" className="text-xs" />
                          <YAxis allowDecimals={false} width={34} className="text-xs" domain={[0, sharedOutcomeAxisMax]} />
                          <Tooltip content={renderOutcomeTooltip} />
                          {outcomeSeries.map((o) => (
                            <Bar key={o.k} dataKey={o.k} stackId="a" fill={o.c} onClick={() => openBreakdown(o.k)} className={clickableOutcomeKeys.has(o.k) ? 'cursor-pointer' : ''} />
                          ))}
                        </BarChart>
                      </ChartContainer>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
            <Card className={paneClassName}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-semibold text-slate-900">Possession Table</div>
                  {sortedPossessions.length > 5 ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => setShowAllPossessions((current) => !current)}
                    >
                      {showAllPossessions ? 'Show Less' : 'Expand'}
                    </Button>
                  ) : null}
                </div>
                <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {possessionColumns.map((column) => (
                        <SortableTableHead
                          key={column.key}
                          column={column}
                          sortState={possessionSort}
                          onToggle={togglePossessionSort}
                          className={['startTime', 'endTime', 'duration', 'timeToAttack', 'passes', 'points', 'attack', 'shot'].includes(column.key) ? 'text-right' : undefined}
                        />
                      ))}
                      <TableHead className="text-right"> </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visiblePossessions.map((p) => {
                      const teamName = p.teamSide === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home');
                      return (
                        <TableRow key={p.key} style={teamRowTint(p.teamSide, homeTeam?.color, awayTeam?.color, 0.07)}>
                          <TableCell className="font-mono text-xs">#{p.possessionId}</TableCell>
                          <TableCell className="font-medium">{teamName}</TableCell>
                          <TableCell>{toTitleCase(p.half)}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{Number.isFinite(p.startTime) ? formatMMSS(p.startTime) : 'NA'}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{Number.isFinite(p.endTime) ? formatMMSS(p.endTime) : 'NA'}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{Number.isFinite(p.duration) ? `${p.duration.toFixed(1)}s` : 'NA'}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{Number.isFinite(p.timeToAttack) ? `${p.timeToAttack.toFixed(1)}s` : 'NA'}</TableCell>
                          <TableCell>{p.startSource}</TableCell>
                          <TableCell>{p.startZone}</TableCell>
                          <TableCell>{p.outcome}</TableCell>
                          <TableCell className="text-right tabular-nums">{p.passes}</TableCell>
                          <TableCell className="text-right tabular-nums">{p.isAttack ? 'Yes' : 'No'}</TableCell>
                          <TableCell className="text-right tabular-nums">{p.shots > 0 ? 'Yes' : 'No'}</TableCell>
                          <TableCell className="text-right tabular-nums">{p.points}</TableCell>
                          <TableCell>{p.attackType}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              {Number.isFinite(p.videoStartTime) ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-7 px-2 text-xs"
                                  title={`Open video at ${formatMMSS(p.videoStartTime)}`}
                                  onClick={() => onOpenVideoAt?.(p.videoStartTime)}
                                >
                                  Open Video
                                </Button>
                              ) : null}
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                onClick={() => onVisualisePossession?.(p)}
                              >
                                Visualise
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      <Dialog open={breakdownOpen} onOpenChange={setBreakdownOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {outcomeMode === 'attacks' ? 'Attack' : 'Possession'} Outcome Breakdown: {breakdownCategory}
            </DialogTitle>
          </DialogHeader>
          {breakdownRows.length ? (
            <ChartContainer id="possession-outcome-breakdown" className="h-[320px] w-full" config={{}}>
              <BarChart data={breakdownRows} margin={{ top: 12, right: 16, left: 0, bottom: 6 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="team" className="text-xs" />
                <YAxis allowDecimals={false} className="text-xs" />
                <Tooltip content={<ChartTooltipContent />} />
                <Legend verticalAlign="bottom" align="center" wrapperStyle={{ paddingTop: 8 }} />
                {breakdownSeries.map((series) => (
                  <Bar key={series.key} dataKey={series.key} stackId="a" fill={series.color} />
                ))}
              </BarChart>
            </ChartContainer>
          ) : (
            <div className="text-sm text-slate-500">No detailed rows available for this outcome.</div>
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={originBreakdownOpen} onOpenChange={setOriginBreakdownOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Shot Missed (Live Ball) Breakdown</DialogTitle>
          </DialogHeader>
          <ChartContainer id="possession-origin-breakdown" className="h-[320px] w-full" config={{}}>
            <BarChart data={originBreakdownRows} margin={{ top: 12, right: 16, left: 0, bottom: 6 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="team" className="text-xs" />
              <YAxis allowDecimals={false} className="text-xs" />
              <Tooltip content={<ChartTooltipContent />} />
              <Legend verticalAlign="bottom" align="center" wrapperStyle={{ paddingTop: 8 }} />
              <Bar dataKey="Shot Short" stackId="a" fill="#f59e0b" />
              <Bar dataKey="Shot Blocked" stackId="a" fill="#ef4444" />
              <Bar dataKey="Shot Post" stackId="a" fill="#84cc16" />
              <Bar dataKey="Shot Saved" stackId="a" fill="#14b8a6" />
            </BarChart>
          </ChartContainer>
        </DialogContent>
      </Dialog>
    </div>
  );
}


export default PossessionsTab;

