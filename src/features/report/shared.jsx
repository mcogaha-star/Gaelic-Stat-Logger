import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, Maximize2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import pitchImg from '@/assets/pitch.png';
import {
  PITCH_W,
  PITCH_H,
  OPP_45_X,
  calcAngleToGoal,
  calcDistanceToGoal,
  classifyTerminalOutcome,
  derivePossessionOutcome as derivePossessionOutcomeShared,
  extractFoulFromStat,
  inferRestartWinnerSide,
  oppositeTeamSide,
  isAttackPossession,
  getMatchSectionOffsets,
  getMatchTimeS,
  getNormalizedTimeS,
  formatHalfClock,
  formatMatchClock as formatMatchClockFromAnalytics,
  getProgressiveMeters,
  isBroughtBackAdvantageStat,
  shouldExcludeFromTotals,
  normalizeFoulType,
  normalizeOutcomeAlias,
  shotOutcomeGroup,
  statHasEmbeddedTurnover,
  statHasEnteredOpp45,
  getSetDefenceValue,
} from '@/lib/reportAnalytics';

const REPORT_PITCH_VERTICAL_SCALE = 1;
const REPORT_PITCH_SCALE = '73%';
function safeParseJSON(s, fallback) {
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' ? v : fallback;
  } catch {
    return fallback;
  }
}

function toTitleCase(s) {
  return String(s || '')
    .replace(/_/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function formatMMSS(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
  const s = Math.floor(seconds);
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function formatMatchTimeLabel(seconds) {
  return formatMMSS(seconds);
}

const MATCH_SECTION_ORDER = ['first', 'second', 'et_first', 'et_second'];

function getSectionBoundaryLabel(half) {
  if (half === 'first') return 'HT';
  if (half === 'second') return 'FT';
  if (half === 'et_first') return 'ET HT';
  return '';
}

function buildMatchTimeDisplayLayout(stats, match, imputedTimeById) {
  const sectionStats = MATCH_SECTION_ORDER.map((half) => {
    const rows = (Array.isArray(stats) ? stats : []).filter((stat) => stat?.half === half);
    const times = rows
      .map((stat) => getNormalizedTimeS(stat, imputedTimeById))
      .filter(Number.isFinite);
    const periodEndTimes = rows
      .filter((stat) => stat?.stat_type === 'period_end')
      .map((stat) => getNormalizedTimeS(stat, imputedTimeById))
      .filter(Number.isFinite);
    const lastLiveOrLoggedTime = times.length ? Math.max(...times) : 0;
    const boundaryTime = periodEndTimes.length ? Math.max(...periodEndTimes) : lastLiveOrLoggedTime;
    return {
      half,
      hasData: times.length > 0,
      boundaryTime,
    };
  }).filter((section) => section.hasData);

  if (!sectionStats.length) {
    return {
      axisMax: 5 * 60,
      ticks: [0, 5 * 60],
      formatTick: () => '00:00',
      getDisplayTimeForStat: () => null,
    };
  }

  let runningOffset = 0;
  const sections = sectionStats.map((section) => {
    const next = { ...section, offset: runningOffset };
    runningOffset += section.boundaryTime;
    return next;
  });

  const axisMax = Math.max(5 * 60, sections[sections.length - 1].offset + sections[sections.length - 1].boundaryTime);
  const ticks = Array.from(new Set(sections.flatMap((section) => {
    const values = [section.offset];
    for (let local = 10 * 60; local < section.boundaryTime; local += 10 * 60) {
      values.push(section.offset + local);
    }
    values.push(section.offset + section.boundaryTime);
    return values;
  })))
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= axisMax)
    .sort((a, b) => a - b);

  const findSectionForDisplayTime = (displayTimeS) => {
    const value = Math.max(0, Number(displayTimeS) || 0);
    for (const section of sections) {
      const start = section.offset;
      const end = section.offset + section.boundaryTime;
      if (value >= start && value <= end) return section;
    }
    return sections[sections.length - 1];
  };

  return {
    axisMax,
    ticks,
    formatTick: (displayTimeS) => {
      const section = findSectionForDisplayTime(displayTimeS);
      const exactBoundary = sections.find((entry) => Math.abs(Number(displayTimeS) - (entry.offset + entry.boundaryTime)) < 0.5);
      const boundaryLabel = getSectionBoundaryLabel(exactBoundary?.half);
      if (boundaryLabel) return boundaryLabel;
      const localTime = Math.max(0, Number(displayTimeS) - Number(section?.offset || 0));
      return formatHalfClock(localTime, section?.half, match);
    },
    getDisplayTimeForStat: (stat) => {
      const normalized = getNormalizedTimeS(stat, imputedTimeById);
      if (!Number.isFinite(normalized)) return null;
      const section = sections.find((entry) => entry.half === stat?.half);
      if (!section) return normalized;
      return section.offset + normalized;
    },
  };
}

function clampTimeRange(range, min = 0, max = 0) {
  const rawStart = Array.isArray(range) ? Number(range[0]) : min;
  const rawEnd = Array.isArray(range) ? Number(range[1]) : max;
  const start = Number.isFinite(rawStart) ? Math.max(min, Math.min(max, rawStart)) : min;
  const end = Number.isFinite(rawEnd) ? Math.max(min, Math.min(max, rawEnd)) : max;
  return start <= end ? [start, end] : [end, start];
}

function getFilterTimeSeconds(value) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || String(value ?? '') === '') return null;
  return Math.max(0, Math.round(minutes * 60));
}

function serializeFilterTimeSeconds(seconds, fallbackSeconds) {
  if (!Number.isFinite(seconds)) return '';
  if (seconds <= 0) return '';
  if (Number.isFinite(fallbackSeconds) && seconds >= fallbackSeconds) return '';
  return (seconds / 60).toFixed(3).replace(/\.?0+$/, '');
}

function normalizeTimeRangeForSlider({ timeMin, timeMax, maxSeconds }) {
  const safeMax = Math.max(0, Number(maxSeconds) || 0);
  const start = getFilterTimeSeconds(timeMin);
  const end = getFilterTimeSeconds(timeMax);
  return clampTimeRange([
    start == null ? 0 : start,
    end == null ? safeMax : end,
  ], 0, safeMax);
}

function statMatchesDisplayTimeRange(stat, { timeMin, timeMax, match, imputedTimeById, stats }) {
  const minDisplayS = getFilterTimeSeconds(timeMin);
  const maxDisplayS = getFilterTimeSeconds(timeMax);
  if (minDisplayS == null && maxDisplayS == null) return true;
  const layout = buildMatchTimeDisplayLayout(stats, match, imputedTimeById);
  const displayTime = layout.getDisplayTimeForStat(stat);
  if (!Number.isFinite(displayTime)) return false;
  if (minDisplayS != null && displayTime < minDisplayS) return false;
  if (maxDisplayS != null && displayTime > maxDisplayS) return false;
  return true;
}

function RangeSliderField({
  label,
  min = 0,
  max = 100,
  value = [0, 100],
  onChange,
  formatValue = (n) => String(n),
  resetLabel = 'Full Range',
  onReset,
  step = 1,
  className = '',
  tickValues = [],
  tickFormatter = (n) => String(n),
  showBoundsText = true,
  compact = false,
}) {
  const normalized = clampTimeRange(value, min, max);
  const range = Math.max(1, max - min);
  return (
    <div className={`${compact ? 'space-y-0.5' : 'space-y-2'} ${className}`.trim()}>
      <div className="flex min-h-[20px] items-center justify-between gap-3">
        <Label className={`text-xs leading-none text-slate-600 ${compact ? 'pt-0.5' : ''}`}>{label}</Label>
        {onReset ? (
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-[11px] text-slate-500" onClick={onReset}>
            {resetLabel}
          </Button>
        ) : null}
      </div>
      <div className={`rounded-xl border border-slate-200 bg-slate-50 shadow-sm ${compact ? 'px-2 py-1.5' : 'p-3'}`}>
        <div className={`flex items-center justify-between gap-3 text-[11px] font-semibold text-slate-700 ${compact ? 'mb-0.5 leading-none' : 'mb-2'}`}>
          <span>{formatValue(normalized[0])}</span>
          <span>{formatValue(normalized[1])}</span>
        </div>
        <Slider
          min={min}
          max={max}
          step={step}
          value={normalized}
          onValueChange={(next) => onChange?.(clampTimeRange(next, min, max))}
          className={compact ? 'px-0 py-0.5' : 'px-0'}
        />
        {Array.isArray(tickValues) && tickValues.length > 0 ? (
          <div className={`relative text-[10px] text-slate-500 ${compact ? 'mt-0.5 h-3' : 'mt-2 h-4'}`}>
            {tickValues.map((tick, index) => {
              const pct = ((tick - min) / range) * 100;
              const alignClass = index === 0 ? '-translate-x-0' : index === tickValues.length - 1 ? '-translate-x-full' : '-translate-x-1/2';
              return (
                <span
                  key={tick}
                  className={`absolute top-0 whitespace-nowrap ${alignClass}`}
                  style={{ left: `${pct}%` }}
                >
                  {tickFormatter(tick)}
                </span>
              );
            })}
          </div>
        ) : null}
        {showBoundsText ? (
          <div className={`${compact ? 'mt-1' : 'mt-2'} text-[11px] text-slate-500`}>
            {formatValue(min)} - {formatValue(max)}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MatchTimeRangeSlider({
  label = 'Time Range',
  timeMin,
  timeMax,
  onChange,
  match,
  stats,
  imputedTimeById,
  className = '',
  compact = false,
}) {
  const displayLayout = useMemo(
    () => buildMatchTimeDisplayLayout(stats, match, imputedTimeById),
    [match, stats, imputedTimeById],
  );
  const maxSeconds = displayLayout.axisMax;
  const sliderTicks = useMemo(() => {
    const boundaryTicks = (displayLayout.ticks || []).filter((tick) => tick > 0);
    return [0, ...boundaryTicks.filter((tick) => {
      const label = displayLayout.formatTick(tick);
      return label === 'HT' || label === 'FT';
    })];
  }, [displayLayout]);
  const sliderValue = useMemo(
    () => normalizeTimeRangeForSlider({ timeMin, timeMax, maxSeconds }),
    [timeMin, timeMax, maxSeconds],
  );

  const handleChange = (nextRange) => {
    const [start, end] = clampTimeRange(nextRange, 0, maxSeconds);
    onChange?.({
      timeMin: serializeFilterTimeSeconds(start, maxSeconds),
      timeMax: serializeFilterTimeSeconds(end, maxSeconds),
    });
  };

  return (
    <RangeSliderField
      label={label}
      min={0}
      max={maxSeconds}
      step={1}
      value={sliderValue}
      onChange={handleChange}
      formatValue={displayLayout.formatTick}
      tickValues={sliderTicks}
      tickFormatter={(value) => (value === 0 ? '0' : displayLayout.formatTick(value))}
      showBoundsText={false}
      className={className}
      compact={compact}
    />
  );
}

function formatAddedTime(baseSeconds, totalSeconds) {
  const extra = Math.max(0, Math.floor(totalSeconds - baseSeconds));
  const extraMinutes = Math.floor(extra / 60);
  const extraSeconds = extra % 60;
  return `${Math.floor(baseSeconds / 60)}+${extraMinutes}:${String(extraSeconds).padStart(2, '0')}`;
}

function formatMatchClock(seconds, match, half) {
  return formatMatchClockFromAnalytics(seconds, match, half);
}

function formatPct(n) {
  if (!Number.isFinite(n)) return 'NA';
  return `${n.toFixed(1)}%`;
}

function compareSortValues(a, b) {
  const av = a == null ? '' : a;
  const bv = b == null ? '' : b;
  const an = Number(av);
  const bn = Number(bv);
  const aIsNum = Number.isFinite(an) && String(av).trim() !== '';
  const bIsNum = Number.isFinite(bn) && String(bv).trim() !== '';
  if (aIsNum && bIsNum) return an - bn;
  return String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' });
}

function sortRows(rows, sortState, columns = [], fallbackKey = 'key') {
  const list = Array.isArray(rows) ? rows.slice() : [];
  const sortKey = String(sortState?.key || '');
  if (!sortKey) return list;
  const column = columns.find((entry) => entry?.key === sortKey);
  const getter = column?.sortValue
    ? column.sortValue
    : (row) => row?.[sortKey] ?? row?.[fallbackKey] ?? '';
  list.sort((a, b) => {
    const cmp = compareSortValues(getter(a), getter(b));
    if (cmp !== 0) return sortState?.dir === 'asc' ? cmp : -cmp;
    return compareSortValues(a?.[fallbackKey] ?? '', b?.[fallbackKey] ?? '');
  });
  return list;
}

function SortableTableHead({ column, sortState, onToggle, className = '', children }) {
  const active = sortState?.key === column?.key;
  const Icon = !column?.sortable ? null : active ? (sortState?.dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
  const rightAligned = className.includes('text-right');
  return (
    <TableHead className={className}>
      {column?.sortable === false ? (
        children ?? column?.label
      ) : (
        <button
          type="button"
          className={`inline-flex w-full items-center gap-1 font-medium text-left ${rightAligned ? 'justify-end ml-auto' : ''}`}
          onClick={() => onToggle?.(column?.key)}
        >
          <span>{children ?? column?.label}</span>
          <span className="inline-flex h-3.5 w-3.5 items-center justify-center">
            {Icon ? <Icon className="h-3.5 w-3.5 text-slate-500" /> : null}
          </span>
        </button>
      )}
    </TableHead>
  );
}

function requestElementFullscreen(target) {
  const element = target;
  if (!element || typeof element.requestFullscreen !== 'function') return;
  try {
    element.requestFullscreen();
  } catch {
    // ignore
  }
}

function fullscreenPitchStyle(aspectRatio) {
  return {
    width: `min(100vw, calc(100vh * ${aspectRatio}))`,
    maxWidth: '100vw',
    maxHeight: '100vh',
  };
}

function FullscreenMapShell({ title = 'Map', enabled = true, children }) {
  const rootRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const rendered = typeof children === 'function' ? children(isFullscreen) : children;

  useEffect(() => {
    const handleChange = () => {
      setIsFullscreen(document.fullscreenElement === rootRef.current);
    };
    document.addEventListener('fullscreenchange', handleChange);
    return () => document.removeEventListener('fullscreenchange', handleChange);
  }, []);

  const handleExpand = (event) => {
    if (!enabled) return;
    if (document.fullscreenElement === rootRef.current) return;
    if (document.fullscreenElement && document.fullscreenElement !== rootRef.current) return;
    event?.stopPropagation?.();
    requestElementFullscreen(rootRef.current);
  };

  const fullscreenStyle = isFullscreen
    ? {
        width: '100vw',
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#000',
        padding: 0,
        margin: 0,
        overflow: 'hidden',
      }
    : undefined;

  return (
    <div
      ref={rootRef}
      className="relative"
      style={fullscreenStyle}
    >
      {rendered}
      {enabled && !isFullscreen ? (
        <Button
          type="button"
          variant="outline"
          size="icon"
          data-fullscreen-block="true"
          className="absolute bottom-3 right-3 z-10 h-8 w-8 rounded-full border-white/70 bg-black/55 text-white hover:bg-black/70"
          onClick={handleExpand}
          title={`Expand ${title}`}
        >
          <Maximize2 className="h-4 w-4" />
        </Button>
      ) : null}
    </div>
  );
}

function hexToRgba(color, alpha = 0.08) {
  const value = String(color || '').trim();
  const fallback = `rgba(148, 163, 184, ${alpha})`;
  if (!value.startsWith('#')) return fallback;
  const hex = value.slice(1);
  const normalized = hex.length === 3
    ? hex.split('').map((c) => c + c).join('')
    : hex.length === 6
      ? hex
      : null;
  if (!normalized) return fallback;
  const int = Number.parseInt(normalized, 16);
  if (!Number.isFinite(int)) return fallback;
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function teamRowTint(teamSide, homeColor, awayColor, alpha = 0.08) {
  const color = teamSide === 'away' ? (awayColor || '#ef4444') : (homeColor || '#22c55e');
  return { backgroundColor: hexToRgba(color, alpha) };
}

function metricBandStyle(color, side) {
  return {
    [side]: 0,
    background: `linear-gradient(180deg, ${color || '#94a3b8'} 0%, ${color || '#94a3b8'} 100%)`,
  };
}

function ComparisonMetricsCard({ homeTeam, awayTeam, teamMode = 'both', title = 'Metrics', rows = [], cardClassName = 'w-full lg:w-[48%] lg:max-w-[48%] mr-auto', metricColWidth = '180px' }) {
  const showHome = teamMode === 'both' || teamMode === 'home';
  const showAway = teamMode === 'both' || teamMode === 'away';
  const metricCol = metricColWidth;

  return (
    <Card className={`border-2 border-slate-400 bg-gradient-to-br from-slate-50 via-white to-white shadow-md ${cardClassName}`.trim()}>
      <CardContent className="p-4 space-y-4">
        <div className="font-semibold text-slate-900">{title}</div>
        <div className="relative overflow-hidden rounded-xl border border-slate-300/90 bg-white/80 px-4 py-3 shadow-sm">
          <div className="absolute inset-y-0 left-0 w-2" style={metricBandStyle(homeTeam?.color || '#22c55e', 'left')} />
          <div className="absolute inset-y-0 right-0 w-2" style={metricBandStyle(awayTeam?.color || '#ef4444', 'right')} />
          <div className="grid items-center gap-3 text-slate-600" style={{ gridTemplateColumns: `minmax(0,1fr) ${metricCol} minmax(0,1fr)` }}>
            <div className="min-w-0 justify-self-start pr-2 text-base font-semibold text-slate-900">
              <span className="truncate">{homeTeam?.name || 'Home'}</span>
            </div>
            <div className="text-center text-[1rem] font-bold text-slate-700">Metric</div>
            <div className="min-w-0 justify-self-end pl-2 text-right text-base font-semibold text-slate-900">
              <span className="truncate">{awayTeam?.name || 'Away'}</span>
            </div>
          </div>
        </div>
        <div className="grid gap-2">
          {rows.map((row) => (
            <div key={row.label} className="rounded-lg border border-slate-300 bg-white px-3 py-2 shadow-sm">
              <div className="grid items-center gap-3" style={{ gridTemplateColumns: `minmax(0,1fr) ${metricCol} minmax(0,1fr)` }}>
                <div className={`text-left tabular-nums ${row.strong ? 'font-semibold text-slate-900' : 'text-slate-900'}`}>
                  {showHome ? row.home : ''}
                </div>
                <div className="text-center text-sm font-semibold text-slate-700">{row.label}</div>
                <div className={`text-right tabular-nums ${row.strong ? 'font-semibold text-slate-900' : 'text-slate-900'}`}>
                  {showAway ? row.away : ''}
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function computeImputedNormalizedTimes(stats) {
  const list = Array.isArray(stats) ? stats.filter(Boolean) : [];
  const out = new Map();

  const byHalf = new Map();
  list.forEach((stat, inputIndex) => {
    const key = String(stat?.half || 'first');
    const bucket = byHalf.get(key) || [];
    bucket.push({ stat, inputIndex });
    byHalf.set(key, bucket);
  });

  for (const bucket of byHalf.values()) {
    const sorted = bucket.slice().sort((a, b) => {
      const pa = Number(a?.stat?.play_id);
      const pb = Number(b?.stat?.play_id);
      if (Number.isFinite(pa) && Number.isFinite(pb) && pa !== pb) return pa - pb;
      const ta = Number(a?.stat?.normalized_time_s);
      const tb = Number(b?.stat?.normalized_time_s);
      if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
      return a.inputIndex - b.inputIndex;
    });

    const prev = new Array(sorted.length).fill(null);
    const next = new Array(sorted.length).fill(null);

    let lastT = null;
    for (let i = 0; i < sorted.length; i += 1) {
      const t = Number(sorted[i]?.stat?.normalized_time_s);
      if (Number.isFinite(t)) lastT = Math.max(0, t);
      prev[i] = lastT;
    }

    let nextT = null;
    for (let i = sorted.length - 1; i >= 0; i -= 1) {
      const t = Number(sorted[i]?.stat?.normalized_time_s);
      if (Number.isFinite(t)) nextT = Math.max(0, t);
      next[i] = nextT;
    }

    for (let i = 0; i < sorted.length; i += 1) {
      const s = sorted[i]?.stat;
      const id = s?.id;
      if (!id) continue;
      const t = Number(s?.normalized_time_s);
      if (Number.isFinite(t)) {
        out.set(id, Math.max(0, t));
        continue;
      }
      const a = prev[i];
      const b = next[i];
      if (Number.isFinite(a) && Number.isFinite(b)) out.set(id, Math.max(0, (a + b) / 2));
      else if (Number.isFinite(a)) out.set(id, Math.max(0, a));
      else if (Number.isFinite(b)) out.set(id, Math.max(0, b));
    }
  }

  return out;
}

function formatTeamLabel(side) {
  if (side === 'home') return 'Home';
  if (side === 'away') return 'Away';
  return 'NA';
}

function humanizeKey(k) {
  const key = String(k || '');
  const map = {
    // common
    counter_attack: 'Set Defence',
    team_side: 'Team',
    // selections / roles
    intended_recipient: 'Intended Recipient',
    won_by: 'Won By',
    lost_by: 'Lost By',
    broken_by: 'Broken By',
    recovered_by: 'Recovered By',
    forced_by: 'Forced By',
    foul_by: 'Foul By',
    foul_on_or_forced_by: 'Foul On / Forced By',
    // shot
    shot_type: 'Shot Type',
    // carry / pass
    take_on_attempted: 'Take On Attempted',
    take_on_completed: 'Take On Completed',
    pressure_on_carrier: 'Pressure',
    pressure_on_passer: 'Pressure',
    pass_er: 'Passer',
    solo_plus_go: 'Solo & Go',
    // turnover / foul
    turnover_type: 'Turnover Type',
    foul_type: 'Foul Type',
    // misc
    raw_x_position: 'Raw X',
    raw_y_position: 'Raw Y',
    raw_end_x_position: 'Raw End X',
    raw_end_y_position: 'Raw End Y',
    end_x_position: 'End X',
    end_y_position: 'End Y',
    x_position: 'X',
    y_position: 'Y',
  };
  if (map[key]) return map[key];
  return toTitleCase(key);
}

function presentablePathLabel(path) {
  const parts = String(path || '').split('.').filter(Boolean);
  if (!parts.length) return 'NA';
  if (parts.length === 1) return humanizeKey(parts[0]);
  const [section, ...rest] = parts;
  const sectionKey = String(section || '');
  const single = rest.length === 1 ? String(rest[0] || '') : '';

  // For action sections, show cleaner labels for common role keys (avoid "Pass Er", etc).
  if (rest.length === 1 && ['pass', 'carry', 'kickout', 'turnover', 'throw_in', 'shot', 'foul'].includes(sectionKey)) {
    if (single && !single.startsWith(sectionKey + '_')) {
      return humanizeKey(single);
    }
  }
  // Avoid labels like "Foul Foul Type" when the inner key already includes the section prefix.
  if (rest.length === 1) {
    const r0 = String(rest[0] || '');
    const sec = String(section || '');
    if (r0 === sec) return toTitleCase(section);
    if (r0.startsWith(sec + '_')) return `${toTitleCase(section)} ${humanizeKey(r0.slice(sec.length + 1))}`.trim();
  }
  // De-duplicate labels like "Turnover Foul Foul Type" -> "Turnover Foul Type".
  const tokens = [toTitleCase(section), ...rest.map(humanizeKey)].filter(Boolean);
  for (let i = 0; i < tokens.length - 1;) {
    const a = tokens[i];
    const b = tokens[i + 1];
    if (b.startsWith(a + ' ')) tokens.splice(i, 1);
    else i += 1;
  }
  return tokens.join(' ').trim();
}

function formatExtraValue(v, path = '') {
  if (v == null) return 'NA';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NA';
  if (typeof v === 'string') {
    const raw = String(v);
    const trimmed = raw.trim();
    if (!trimmed) return 'NA';
    const lowerPath = String(path || '').toLowerCase();
    const isPassAccuracy = lowerPath.endsWith('.accuracy') || lowerPath === 'pass_accuracy';
    if (isPassAccuracy && ['++', '+', '-', '--'].includes(trimmed)) return trimmed;
    // Older rows can contain encoded dash placeholders for empty values (e.g. "â€”").
    if (['—', '–', '-', 'â€”', 'â€“', 'â€"'].includes(trimmed)) return 'NA';
    return toTitleCase(trimmed);
  }
  if (Array.isArray(v)) {
    if (!v.length) return 'NA';
    if (v.length <= 6) return v.map((x) => formatExtraValue(x)).join(', ');
    return `${v.length} items`;
  }
  if (typeof v === 'object') {
    // Common team/player selection objects we store in extra_data.
    if ('kind' in v) {
      if (v.kind === 'none') return 'None';
      if (v.kind === 'team') return `${formatTeamLabel(v.team_side)} Team`;
      if (v.kind === 'player') {
        const n = v.number ? `#${v.number}` : '';
        const name = v.name ? String(v.name) : '';
        const label = `${n} ${name}`.trim() || 'Player';
        const side = v.team_side ? ` (${formatTeamLabel(v.team_side)})` : '';
        return `${label}${side}`;
      }
    }

    // Fallback: compact object summary.
    const keys = Object.keys(v);
    if (!keys.length) return 'NA';
    if (keys.length <= 4) {
      return keys.map((k) => `${toTitleCase(k)}: ${formatExtraValue(v[k])}`).join(' | ');
    }
    return `${keys.length} fields`;
  }
  return String(v);
}

function flattenExtra(extra) {
  const rows = [];
  const walk = (obj, prefix, depth) => {
    if (!obj || typeof obj !== 'object') return;
    if (depth > 3) return;
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v == null) {
        rows.push({ key, value: v });
        continue;
      }
      if (typeof v === 'object' && !Array.isArray(v)) {
        // Stop descending into selection objects; render them as values.
        if ('kind' in v) {
          rows.push({ key, value: v });
          continue;
        }
        walk(v, key, depth + 1);
        continue;
      }
      rows.push({ key, value: v });
    }
  };
  walk(extra, '', 0);
  return rows;
}

function deriveOutcome(stat, extra) {
  if (!stat) return '';
  const t = stat.stat_type;
  if (t === 'shot') return extra?.shot?.outcome || '';
  if (t === 'pass') {
    const outcome = normalizeOutcomeAlias(extra?.pass?.outcome);
    if (outcome === 'foul' && isRetainedActionFoul(stat, extra, 'pass')) return 'completed';
    return outcome;
  }
  if (t === 'carry') {
    const outcome = normalizeOutcomeAlias(extra?.carry?.outcome);
    if (outcome === 'foul' && isRetainedActionFoul(stat, extra, 'carry')) return 'completed';
    return outcome;
  }
  if (t === 'kickout') return normalizeOutcomeAlias(extra?.kickout?.outcome);
  if (t === 'turnover') return normalizeOutcomeAlias(extra?.turnover?.turnover_type, 'turnover');
  if (t === 'throw_in') return normalizeOutcomeAlias(extra?.throw_in?.outcome);
  if (t === 'foul') return extra?.foul?.foul_type || '';
  return '';
}

function isRetainedActionFoul(stat, extra, actionType) {
  if (!stat || !extra) return false;
  if (extra?.turnover) return false;
  const action = actionType === 'pass' ? extra?.pass : extra?.carry;
  const actor = actionType === 'pass' ? action?.passer : action?.carrier;
  const actorSide = actor?.team_side || stat?.team_side;
  const foul = action?.foul || extra?.foul || null;
  if (!foul) return true;
  const foulBy = foul?.foul_by?.team_side;
  const foulOn = foul?.foul_on?.team_side || foul?.foul_on_or_forced_by?.team_side;
  if (foulOn && actorSide && foulOn === actorSide) return true;
  if (foulBy && actorSide && foulBy !== actorSide) return true;
  return false;
}

function statMatchesActionType(stat, actionType) {
  const normalized = String(actionType || '');
  if (!normalized || String(stat?.stat_type || '') === normalized) return true;
  const extra = safeParseJSON(stat?.extra_data || '{}', {});
  if (normalized === 'foul') return !!extractFoulFromStat(stat);
  if (normalized === 'turnover') {
    return statHasEmbeddedTurnover(stat);
  }
  return false;
}

function MultiSelect({ label, options, values, onChange, placeholder = 'All', className = '', triggerClassName = '', labelClassName = '' }) {
  const valuesSet = useMemo(() => new Set(Array.isArray(values) ? values : []), [values]);

  const toggle = (v) => {
    const next = new Set(valuesSet);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange(Array.from(next));
  };

  const summaryText = (() => {
    if (!valuesSet.size) return placeholder;
    if (valuesSet.size === 1) {
      const only = Array.from(valuesSet)[0];
      const match = options.find((o) => String(o.value) === String(only));
      return match?.label || String(only);
    }
    return `${valuesSet.size} Selected`;
  })();

  return (
    <div className={'space-y-1 ' + className}>
      <Label className={`text-xs text-slate-600 ${labelClassName}`.trim()}>{label}</Label>
      <Popover>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="sm" className={`h-8 w-full justify-between text-xs ${triggerClassName}`.trim()}>
            <span className="truncate">{summaryText}</span>
            <span className="text-slate-400">▾</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-2">
          <div className="max-h-72 overflow-y-auto space-y-1">
            {options.map((opt) => {
              const checked = valuesSet.has(opt.value);
              return (
                <button
                  key={opt.value}
                  type="button"
                  className="w-full flex items-center gap-2 rounded-md px-2 py-1 hover:bg-slate-50 text-left"
                  onClick={() => toggle(opt.value)}
                >
                  <Checkbox checked={checked} onCheckedChange={() => toggle(opt.value)} />
                  <div className="text-xs text-slate-900 truncate">{opt.label}</div>
                </button>
              );
            })}
          </div>
          <div className="pt-2 flex items-center justify-between gap-2">
            <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => onChange([])}>
              Clear
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => onChange(options.map((o) => o.value))}
            >
              Select All
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function collectPlayerIds(extra) {
  // Traverse extra_data and collect selection objects that look like { kind:'player', id:'...' }.
  const ids = new Set();
  const walk = (v) => {
    if (!v || typeof v !== 'object') return;
    if (v.kind === 'player' && (typeof v.id === 'string' || typeof v.id === 'number')) ids.add(String(v.id));
    for (const k of Object.keys(v)) walk(v[k]);
  };
  walk(extra);
  return ids;
}

function collectPlayerSelectionKeys(extra) {
  const keys = new Set();
  const walk = (v) => {
    if (!v || typeof v !== 'object') return;
    if (v.kind === 'player' && (typeof v.id === 'string' || typeof v.id === 'number') && (v.team_side === 'home' || v.team_side === 'away')) {
      keys.add(`${v.team_side}|${String(v.id)}`);
    }
    for (const key of Object.keys(v)) walk(v[key]);
  };
  walk(extra);
  return keys;
}

function sortKeyForTime(s) {
  const tn = Number(s?.normalized_time_s);
  if (Number.isFinite(tn)) return { k: 0, v: tn };
  const t = Number(s?.time_s);
  if (Number.isFinite(t)) return { k: 1, v: t };
  const pid = Number(s?.play_id);
  if (Number.isFinite(pid)) return { k: 2, v: pid };
  return { k: 9, v: 0 };
}

function groupByPossession(stats) {
  const list = Array.isArray(stats) ? stats : [];
  const groups = new Map();
  for (const s of list) {
    const pid = Number(s?.possession_id);
    const pside = s?.possession_team_side;
    if (!Number.isFinite(pid) || (pside !== 'home' && pside !== 'away')) continue;
    const key = `${pside}-${pid}`;
    const arr = groups.get(key) || [];
    arr.push(s);
    groups.set(key, arr);
  }
  for (const arr of groups.values()) {
    arr.sort((a, b) => {
      const ka = sortKeyForTime(a);
      const kb = sortKeyForTime(b);
      if (ka.k !== kb.k) return ka.k - kb.k;
      if (ka.v !== kb.v) return ka.v - kb.v;
      return String(a?.id || '').localeCompare(String(b?.id || ''));
    });
  }
  return groups;
}

function possessionHasOpp45Entry(evs, teamSide) {
  return isAttackPossession(evs, teamSide);
}

function derivePossessionOutcome(evs, teamSide) {
  return derivePossessionOutcomeShared(evs, teamSide);
}

function inferPossessionStartSource(groupStats, teamSide, previousContext) {
  const ALLOWED = new Set(['Turnover Won', 'Kickout Won', 'Throw In Won', 'Shot Short', 'Shot Blocked', 'Shot Post', 'Shot Saved', 'Open Play']);
  const finish = (label) => (ALLOWED.has(label) ? label : 'Open Play');
  const firstAny = Array.isArray(groupStats) && groupStats.length ? groupStats[0] : null;
  if (firstAny?.__possession_start_source) return finish(firstAny.__possession_start_source);
  const acting = (Array.isArray(groupStats) ? groupStats : []).filter((e) => e && e.team_side === teamSide);
  const first = acting[0];
  const firstExtra = safeParseJSON(first?.extra_data || '{}', {});
  const previousStats = Array.isArray(previousContext)
    ? previousContext.filter(Boolean)
    : previousContext ? [previousContext] : [];
  const prev = previousStats.length ? previousStats[previousStats.length - 1] : null;
  const getTurnoverWinSide = (extra, stat = null) => {
    const turnoverType = String(extra?.turnover?.turnover_type || extra?.turnover?.type || '');
    if (!turnoverType) return null;
    if (normalizeOutcomeAlias(turnoverType, 'turnover') === 'foul' && stat) {
      const foul = extractFoulFromStat(stat);
      const foulOn = foul?.foul_on?.team_side || foul?.foul_on_or_forced_by?.team_side || null;
      if (foulOn === 'home' || foulOn === 'away') return foulOn;
    }
    const recoveredSide = extra?.turnover?.recovered_by?.team_side;
    const forcedSide = extra?.turnover?.forced_by?.team_side;
    if (recoveredSide === 'home' || recoveredSide === 'away') return recoveredSide;
    if (forcedSide === 'home' || forcedSide === 'away') return forcedSide;
    return null;
  };

  const firstAll = firstAny;
  const firstAllExtra = safeParseJSON(firstAll?.extra_data || '{}', {});
  if (firstAll?.stat_type === 'kickout') {
    if (inferRestartWinnerSide(firstAll, null) === teamSide) return finish('Kickout Won');
  }
  if (firstAll?.stat_type === 'throw_in') {
    if (inferRestartWinnerSide(firstAll, null) === teamSide) return finish('Throw In Won');
  }

  const prevExtra = safeParseJSON(prev?.extra_data || '{}', {});
  if (getTurnoverWinSide(prevExtra, prev) === teamSide) return finish('Turnover Won');
  if (prev?.stat_type === 'shot') {
    const result = String(prevExtra?.shot?.result || '');
    const outcome = String(prevExtra?.shot?.outcome || '');
    if (result === 'opposition' && outcome === 'short' && prev?.team_side !== teamSide) return finish('Shot Short');
    if (result === 'opposition' && outcome === 'blocked' && prev?.team_side !== teamSide) return finish('Shot Blocked');
    if (result === 'opposition' && outcome === 'post' && prev?.team_side !== teamSide) return finish('Shot Post');
    if (result === 'opposition' && outcome === 'saved' && prev?.team_side !== teamSide) return finish('Shot Saved');
  }
  if (prev?.stat_type === 'kickout') {
    if (inferRestartWinnerSide(prev, firstAll) === teamSide) return finish('Kickout Won');
  }
  if (prev?.stat_type === 'throw_in') {
    if (inferRestartWinnerSide(prev, firstAll) === teamSide) return finish('Throw In Won');
  }

  if (getTurnoverWinSide(firstAllExtra, firstAll) === teamSide) return finish('Turnover Won');

  if (!first) return finish('Open Play');
  if (first?.stat_type === 'kickout') return finish('Kickout Won');
  if (first?.stat_type === 'throw_in') return finish('Throw In Won');
  if (first?.stat_type === 'shot') {
    const outcome = String(firstExtra?.shot?.outcome || '');
    if (firstExtra?.shot?.result === 'opposition' && outcome === 'short') return finish('Shot Short');
    if (firstExtra?.shot?.result === 'opposition' && outcome === 'blocked') return finish('Shot Blocked');
    if (firstExtra?.shot?.result === 'opposition' && outcome === 'post') return finish('Shot Post');
    if (firstExtra?.shot?.result === 'opposition' && outcome === 'saved') return finish('Shot Saved');
    return finish('Open Play');
  }
  if (first?.stat_type === 'pass' || first?.stat_type === 'carry') return finish('Open Play');
  return finish('Open Play');
}

function selectionKey(sel) {
  const player = normalizePlayerRef(sel);
  if (!player?.id || (player.team_side !== 'home' && player.team_side !== 'away')) return null;
  return `${player.team_side}|${player.id}`;
}

function normalizePlayerRef(sel) {
  if (!sel) return null;
  if (sel.kind === 'player' && sel.id && (sel.team_side === 'home' || sel.team_side === 'away')) {
    return {
      id: sel.id,
      team_side: sel.team_side,
      name: sel.name || '',
      number: sel.number ?? null,
      position: sel.position || '',
    };
  }
  if (sel.id && (sel.team_side === 'home' || sel.team_side === 'away')) {
    return {
      id: sel.id,
      team_side: sel.team_side,
      name: sel.name || '',
      number: sel.number ?? null,
      position: sel.position || '',
    };
  }
  if ((sel.team_side === 'home' || sel.team_side === 'away') && (sel.number != null || sel.name)) {
    return {
      id: sel.id || `legacy:${sel.team_side}:${sel.number ?? ''}:${sel.name || ''}`,
      team_side: sel.team_side,
      name: sel.name || '',
      number: sel.number ?? null,
      position: sel.position || '',
    };
  }
  return null;
}

function getPrimaryActorSelection(stat, extra) {
  if (!stat) return null;
  if (stat.stat_type === 'shot') {
    return extra?.shot?.player || (
      (stat.team_side === 'home' || stat.team_side === 'away') && (stat.player_number != null || stat.player_name)
        ? {
            kind: 'player',
            id: `legacy:${stat.team_side}:${stat.player_number ?? ''}:${stat.player_name || ''}`,
            team_side: stat.team_side,
            name: stat.player_name || '',
            number: stat.player_number ?? null,
          }
        : null
    );
  }
  if (stat.stat_type === 'pass') return extra?.pass?.passer || null;
  if (stat.stat_type === 'carry') return extra?.carry?.carrier || null;
  if (stat.stat_type === 'turnover') return extra?.turnover?.forced_by || extra?.turnover?.lost_by || null;
  if (stat.stat_type === 'throw_in') return extra?.throw_in?.won_by || extra?.throw_in?.broken_by || null;
  if (stat.stat_type === 'foul') return extra?.foul?.foul_by || null;
  return null;
}

function getCompletedReceiptSelection(stat, extra) {
  if (!stat) return null;
  if (stat.stat_type === 'pass') {
    if (deriveOutcome(stat, extra) !== 'completed') return null;
    return extra?.pass?.won_by?.kind === 'player' ? extra.pass.won_by : (extra?.pass?.intended_recipient?.kind === 'player' ? extra.pass.intended_recipient : null);
  }
  if (stat.stat_type === 'kickout') {
    if (!['clean', 'break'].includes(String(extra?.kickout?.outcome || ''))) return null;
    return extra?.kickout?.won_by?.kind === 'player' ? extra.kickout.won_by : null;
  }
  if (stat.stat_type === 'throw_in') {
    if (!['clean', 'break'].includes(String(extra?.throw_in?.outcome || ''))) return null;
    return extra?.throw_in?.won_by?.kind === 'player' ? extra.throw_in.won_by : null;
  }
  return null;
}

function isDirectTouchAction(stat) {
  return ['pass', 'carry', 'shot', 'turnover', 'kickout', 'throw_in'].includes(String(stat?.stat_type || ''));
}

function deriveCounterAttackState(actingStats) {
  const relevant = (Array.isArray(actingStats) ? actingStats : []).filter((s) => s && s.stat_type !== 'kickout' && getSetDefenceValue(s, null) != null);
  if (!relevant.length) return 'No';
  const flags = relevant.map((s) => !!getSetDefenceValue(s, false));
  const last = flags[flags.length - 1];
  return last ? 'Yes' : 'No';
}

function deriveAttackTypeState(actingStats) {
  const relevant = (Array.isArray(actingStats) ? actingStats : []).filter((s) => s && s.stat_type !== 'kickout' && getSetDefenceValue(s, null) != null);
  if (!relevant.length) return 'Set';
  const flags = relevant.map((s) => !!getSetDefenceValue(s, false));
  if (flags.every(Boolean)) return 'Set';
  if (flags.every((flag) => !flag)) return 'Transition';
  let sawTransition = false;
  for (const flag of flags) {
    if (!flag) sawTransition = true;
    if (sawTransition && flag) return 'Transition->Set';
  }
  return flags[0] ? 'Set' : 'Transition';
}

function defenceSetStateKey(state) {
  return state === 'Yes' ? 'defence_set_yes' : 'defence_set_no';
}

function attackTypeStateKey(state) {
  if (state === 'Transition') return 'attack_type_transition';
  if (state === 'Transition->Set') return 'attack_type_transition_to_set';
  return 'attack_type_set';
}

function getPossessionStartZone(actingStats) {
  const first = (Array.isArray(actingStats) ? actingStats : []).find((s) => Number.isFinite(Number(s?.x_position)));
  const sx = Number(first?.x_position);
  if (!Number.isFinite(sx)) return 'NA';
  if (sx < PITCH_W / 3) return 'Defensive Third';
  if (sx < (2 * PITCH_W) / 3) return 'Middle Third';
  return 'Attacking Third';
}

function isGoalkeeperPlayer(player) {
  if (!player) return false;
  if (String(player.position || '') === 'Goalkeeper') return true;
  return !player.position && Number(player.number) === 1;
}

function getKeeperCandidate(players, teamSide) {
  const sidePlayers = (Array.isArray(players) ? players : []).filter((p) => p?.team_side === teamSide && isGoalkeeperPlayer(p));
  if (!sidePlayers.length) return null;
  return sidePlayers
    .slice()
    .sort((a, b) => {
      const aScore = String(a.position || '') === 'Goalkeeper' ? 0 : (Number(a.number) === 1 ? 1 : 2);
      const bScore = String(b.position || '') === 'Goalkeeper' ? 0 : (Number(b.number) === 1 ? 1 : 2);
      if (aScore !== bScore) return aScore - bScore;
      return Number(a.number || 999) - Number(b.number || 999);
    })[0];
}

function buildShotAssistCredits(stats) {
  const out = [];
  const groups = groupByPossession(stats);
  for (const [key, evs] of groups.entries()) {
    const [teamSide] = String(key).split('-');
    if (teamSide !== 'home' && teamSide !== 'away') continue;
    const acting = evs.filter((e) => e && e.team_side === teamSide);
    for (let i = 0; i < acting.length; i += 1) {
      const shot = acting[i];
      if (shot?.stat_type !== 'shot') continue;
      if (shouldExcludeFromTotals(shot)) continue;
      for (let j = i - 1; j >= 0; j -= 1) {
        const prev = acting[j];
        if (prev?.stat_type !== 'pass') continue;
        if (shouldExcludeFromTotals(prev)) continue;
        const extra = safeParseJSON(prev.extra_data || '{}', {});
        if (deriveOutcome(prev, extra) !== 'completed') continue;
        const passer = extra?.pass?.passer;
        if (passer?.kind === 'player') {
          out.push({ passer, shot, sourceStat: prev, possessionKey: key, teamSide });
        }
        break;
      }
    }
  }
  return out;
}

function blendHexColors(a, b, t = 0.5) {
  const normalizeHex = (value) => {
    const raw = String(value || '').trim();
    if (!raw.startsWith('#')) return null;
    const hex = raw.slice(1);
    if (hex.length === 3) return hex.split('').map((c) => c + c).join('');
    if (hex.length === 6) return hex;
    return null;
  };
  const ah = normalizeHex(a);
  const bh = normalizeHex(b);
  if (!ah || !bh) return '#8b5cf6';
  const ai = Number.parseInt(ah, 16);
  const bi = Number.parseInt(bh, 16);
  const tt = Math.max(0, Math.min(1, Number(t) || 0));
  const ar = (ai >> 16) & 255;
  const ag = (ai >> 8) & 255;
  const ab = ai & 255;
  const br = (bi >> 16) & 255;
  const bg = (bi >> 8) & 255;
  const bb = bi & 255;
  const rr = Math.round(ar + ((br - ar) * tt));
  const rg = Math.round(ag + ((bg - ag) * tt));
  const rb = Math.round(ab + ((bb - ab) * tt));
  return `#${[rr, rg, rb].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function getPassMethodColor(kickShare) {
  if (!Number.isFinite(kickShare)) return '#8b5cf6';
  const share = Math.max(0, Math.min(1, kickShare));
  if (share <= 0.5) return blendHexColors('#dc2626', '#8b5cf6', share / 0.5);
  return blendHexColors('#8b5cf6', '#2563eb', (share - 0.5) / 0.5);
}

function getNormalizedSonarPoint(stat, point = 'start') {
  const useEnd = point === 'end';
  const x = Number(useEnd ? stat?.end_x_position : stat?.x_position);
  const y = Number(useEnd ? stat?.end_y_position : stat?.y_position);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function buildTouchEvents(stats, playerOptions = []) {
  const out = [];
  const add = (sel, stat, x, y, reason) => {
    const player = normalizePlayerRef(sel);
    if (!player) return;
    const xx = Number(x);
    const yy = Number(y);
    out.push({
      key: `${stat?.id || 'stat'}:${player.team_side}:${player.id}:${reason}:${out.length}`,
      player,
      stat,
      x: Number.isFinite(xx) ? xx : null,
      y: Number.isFinite(yy) ? yy : null,
      reason,
    });
  };

  for (const stat of Array.isArray(stats) ? stats : []) {
    if (!stat) continue;
    if (shouldExcludeFromTotals(stat)) continue;
    const extra = safeParseJSON(stat.extra_data || '{}', {});

    if (stat.stat_type === 'pass') {
      add(getCompletedReceiptSelection(stat, extra), stat, stat?.end_x_position, stat?.end_y_position, 'Pass Won');
      if (normalizeOutcomeAlias(extra?.pass?.outcome) === 'broken_retained') {
        add(extra?.pass?.recovered_by, stat, stat?.end_x_position, stat?.end_y_position, 'Broken Retained');
      }
      if (extra?.pass?.deadball) {
        add(extra?.pass?.passer, stat, stat?.x_position, stat?.y_position, 'Deadball Pass');
      }
      continue;
    }

    if (stat.stat_type === 'turnover' || extra?.turnover) {
      const turnoverType = normalizeOutcomeAlias(extra?.turnover?.turnover_type, 'turnover');
      if (turnoverType !== 'foul') {
        add(extra?.turnover?.recovered_by, stat, stat?.end_x_position ?? stat?.x_position, stat?.end_y_position ?? stat?.y_position, 'Turnover Recovery');
      }
      continue;
    }

    if (stat.stat_type === 'kickout') {
      add(extra?.kickout?.won_by, stat, stat?.end_x_position, stat?.end_y_position, 'Kickout Won');
      continue;
    }

    if (stat.stat_type === 'throw_in') {
      add(extra?.throw_in?.won_by, stat, stat?.end_x_position, stat?.end_y_position, 'Throw In Won');
      continue;
    }

    if (stat.stat_type === 'shot') {
      const outcome = String(extra?.shot?.outcome || '');
      const result = String(extra?.shot?.result || '');
      if (['short', 'blocked', 'saved', 'post'].includes(outcome) && ['retained', 'opposition'].includes(result)) {
        add(extra?.shot?.recovered_by, stat, stat?.end_x_position ?? stat?.x_position, stat?.end_y_position ?? stat?.y_position, 'Shot Recovery');
      }
      const situation = String(extra?.shot?.situation || '');
      if (['free_ground', 'free_hands', '45', 'penalty'].includes(situation)) {
        add(extra?.shot?.player, stat, stat?.x_position, stat?.y_position, 'Placed Ball Shot');
      }
      continue;
    }

    if (stat.stat_type === 'carry') {
      if (extra?.carry?.deadball) {
        add(extra?.carry?.carrier, stat, stat?.x_position, stat?.y_position, 'Deadball Carry');
      }
      if (extra?.carry?.solo_plus_go) {
        add(extra?.carry?.carrier, stat, stat?.x_position, stat?.y_position, 'Solo & Go');
      }
      if (String(extra?.carry?.outcome || '') === 'dispossessed_retained') {
        add(extra?.carry?.recovered_by, stat, stat?.end_x_position ?? stat?.x_position, stat?.end_y_position ?? stat?.y_position, 'Dispossessed Retained');
      }
    }
  }

  return out;
}

function buildTouchesMap(stats, playerOptions = []) {
  const out = new Map();
  for (const touch of buildTouchEvents(stats, playerOptions)) {
    const key = selectionKey(touch.player);
    if (!key) continue;
    out.set(key, (out.get(key) || 0) + 1);
  }

  return out;
}

function buildDefensiveActions(stats) {
  const teamActions = [];
  const playerActions = [];
  const playerSeen = new Set();
  const addPlayerAction = (stat, sel, reason, x, y) => {
    const player = normalizePlayerRef(sel);
    if (!player) return;
    const key = `${stat?.id || 'stat'}:${player.team_side}:${player.id}`;
    if (playerSeen.has(key)) return;
    playerSeen.add(key);
    playerActions.push({
      key,
      stat,
      player,
      teamSide: player.team_side,
      reason,
      x: Number.isFinite(Number(x)) ? Number(x) : Number(stat?.x_position),
      y: Number.isFinite(Number(y)) ? Number(y) : Number(stat?.y_position),
    });
  };

  for (const stat of Array.isArray(stats) ? stats : []) {
    if (!stat) continue;
    if (shouldExcludeFromTotals(stat)) continue;
    const extra = safeParseJSON(stat.extra_data || '{}', {});
    const actionsForRow = new Set();

    const addTeamAction = (teamSide, reason, x, y, frameTeamSide = null) => {
      if (teamSide !== 'home' && teamSide !== 'away') return;
      const key = `${stat?.id || 'stat'}:${teamSide}`;
      if (actionsForRow.has(key)) return;
      actionsForRow.add(key);
      teamActions.push({
        key,
        stat,
        teamSide,
        colorTeamSide: teamSide,
        frameTeamSide: frameTeamSide === 'home' || frameTeamSide === 'away' ? frameTeamSide : null,
        reason,
        x: Number.isFinite(Number(x)) ? Number(x) : Number(stat?.x_position),
        y: Number.isFinite(Number(y)) ? Number(y) : Number(stat?.y_position),
      });
    };

    if (stat.stat_type === 'turnover' || extra?.turnover) {
      const turnoverType = normalizeOutcomeAlias(extra?.turnover?.turnover_type, 'turnover');
      const recovered = normalizePlayerRef(extra?.turnover?.recovered_by);
      const forced = normalizePlayerRef(extra?.turnover?.forced_by);
      const teamSide =
        recovered?.team_side
        || forced?.team_side
        || (turnoverType === 'foul'
          ? normalizePlayerRef(extractFoulFromStat(stat)?.foul_on || extractFoulFromStat(stat)?.foul_on_or_forced_by)?.team_side
          : null);
      const frameTeamSide =
        normalizePlayerRef(extra?.turnover?.lost_by)?.team_side
        || stat?.team_side
        || null;
      // Turnover defensive actions are plotted at the regain/turnover endpoint.
      addTeamAction(teamSide, 'Turnover Forced', stat?.end_x_position ?? stat?.x_position, stat?.end_y_position ?? stat?.y_position, frameTeamSide);
      if (turnoverType !== 'foul') {
        addPlayerAction(stat, recovered, 'Turnover Recovered', stat?.end_x_position ?? stat?.x_position, stat?.end_y_position ?? stat?.y_position);
      }
      addPlayerAction(stat, forced, 'Turnover Forced', stat?.end_x_position ?? stat?.x_position, stat?.end_y_position ?? stat?.y_position);
      if (stat.stat_type === 'carry' && String(extra?.carry?.pressure_on_carrier || '').toLowerCase() === 'high') {
        addPlayerAction(stat, extra?.carry?.defender, 'High Pressure Carry', stat?.x_position, stat?.y_position);
      }
      continue;
    }

    if (stat.stat_type === 'carry') {
      const carrierSide = extra?.carry?.carrier?.team_side || stat?.team_side;
      if (String(extra?.carry?.pressure_on_carrier || '').toLowerCase() === 'high') {
        const defendingSide = oppositeTeamSide(carrierSide);
        // Pressure defensive actions stay at the event point.
        addTeamAction(defendingSide, 'High Pressure Carry', stat?.x_position, stat?.y_position, carrierSide);
        addPlayerAction(stat, extra?.carry?.defender, 'High Pressure Carry', stat?.x_position, stat?.y_position);
      }
      continue;
    }

    if (stat.stat_type === 'pass') {
      const passerSide = extra?.pass?.passer?.team_side || stat?.team_side;
      if (String(extra?.pass?.pressure_on_passer || '').toLowerCase() === 'high') {
        addTeamAction(oppositeTeamSide(passerSide), 'High Pressure Pass', stat?.x_position, stat?.y_position, passerSide);
      }
      continue;
    }

    if (stat.stat_type === 'shot') {
      const shooterSide = extra?.shot?.player?.team_side || stat?.team_side;
      if (String(extra?.shot?.pressure || '').toLowerCase() === 'high') {
        addTeamAction(oppositeTeamSide(shooterSide), 'High Pressure Shot', stat?.x_position, stat?.y_position, shooterSide);
      }
    }
  }

  return { teamActions, playerActions };
}

function DirectionBadge({ className = '', label = 'Attacking ->' }) {
  return (
    <div className={`absolute left-2 top-2 z-10 rounded-full border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-700 shadow-sm ${className}`}>
      {label}
    </div>
  );
}

function transformDisplayPoint(x, y, teamSide, mirrorAway = true) {
  const xx = Number(x);
  const yy = Number(y);
  if (!Number.isFinite(xx) || !Number.isFinite(yy)) return null;
  if (mirrorAway !== false && teamSide === 'away') {
    return { x: PITCH_W - xx, y: PITCH_H - yy };
  }
  return { x: xx, y: yy };
}

function inferRestartTeamSide(stat, extra) {
  const restart = stat?.stat_type === 'kickout' ? extra?.kickout : stat?.stat_type === 'throw_in' ? extra?.throw_in : null;
  if (!restart) return stat?.team_side || null;
  const explicit = restart?.team_side;
  if (explicit === 'home' || explicit === 'away') return explicit;
  const lostSide = restart?.lost_by?.team_side;
  if (lostSide === 'home' || lostSide === 'away') return lostSide;
  const intendedSide = restart?.intended_recipient?.team_side;
  if (intendedSide === 'home' || intendedSide === 'away') return intendedSide;
  const wonSide = restart?.won_by?.team_side;
  if (wonSide === 'home' || wonSide === 'away') {
    const opposite = oppositeTeamSide(wonSide);
    if (opposite === 'home' || opposite === 'away') return opposite;
  }
  return stat?.team_side || null;
}

function selectionTooltipLabel(sel) {
  if (!sel || typeof sel !== 'object') return '';
  if (sel.kind === 'player') {
    const number = sel.number != null && sel.number !== '' ? `#${sel.number}` : '';
    const name = String(sel.name || '').trim();
    return [number, name].filter(Boolean).join(' ').trim();
  }
  if (sel.kind === 'team') return toTitleCase(sel.team_side || 'team');
  return '';
}

function PitchViz({
  stats,
  contextStats = null,
  homeColor,
  awayColor,
  colorBy,
  showColorControls = true,
  verticalScale = REPORT_PITCH_VERTICAL_SCALE,
  mirrorAwayWhenBoth = true,
  directionLabel = 'Home ->',
  kickoutOutcomeDots = false,
  kickoutCircleMode = false,
  turnoverEndpointOnly = false,
  pitchScale = REPORT_PITCH_SCALE,
  onOpenVideoAt = null,
  fullscreenEnabled = true,
  fullscreenTitle = 'Map',
  align = 'center',
  onStatClick = null,
  selectedStatId = null,
}) {
  const defaultActionPalette = {
    shot: '#111827',
    kickout: '#0f766e',
    pass: '#2563eb',
    carry: '#7c3aed',
    turnover: '#dc2626',
    foul: '#d97706',
    throw_in: '#0891b2',
  };

  const defaultOutcomePalette = {
    // "positive" outcomes (blue by default; not green so it doesn't blend with pitch)
    completed: '#2563eb',
    clean: '#2563eb',
    point: '#2563eb',
    '2_point': '#2563eb',
    goal: '#2563eb',

    // "negative" outcomes
    turnover: '#dc2626',
    foul: '#dc2626',
    sideline_against: '#dc2626',

    // shot misc
    wide: '#334155',
    short: '#334155',
    post: '#334155',
    saved: '#334155',
    blocked: '#334155',
  };

  const loadPalette = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const v = JSON.parse(raw);
      return v && typeof v === 'object' ? { ...fallback, ...v } : fallback;
    } catch {
      return fallback;
    }
  };

  const [actionPalette, setActionPalette] = React.useState(() => loadPalette('gstl_viz_action_palette_v1', defaultActionPalette));
  const [outcomePalette, setOutcomePalette] = React.useState(() => loadPalette('gstl_viz_outcome_palette_v1', defaultOutcomePalette));
  const [teamPalette, setTeamPalette] = React.useState(() => loadPalette('gstl_viz_team_palette_v1', {
    home: homeColor || '#22c55e',
    away: awayColor || '#ef4444',
  }));

  const nextContextById = useMemo(() => {
    const ordered = (Array.isArray(contextStats) && contextStats.length ? contextStats : stats || []).slice().sort((a, b) => {
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
    const out = new Map();
    for (let i = 0; i < ordered.length; i += 1) {
      out.set(ordered[i]?.id, ordered[i + 1] || null);
    }
    return out;
  }, [contextStats, stats]);

  const persist = (key, obj) => {
    try { localStorage.setItem(key, JSON.stringify(obj)); } catch { /* ignore */ }
  };
  const tooltipText = (s, extra) => {
    const lines = [];
    const team = s.team_side === 'away' ? 'Away' : 'Home';
    lines.push(`Team: ${team}`);
    lines.push(`Half: ${toTitleCase(s.half)}`);
    lines.push(`Action: ${toTitleCase(s.stat_type)}`);
    const out = deriveOutcome(s, extra);
    if (out) lines.push(`Outcome: ${toTitleCase(out)}`);
    const actor = getPrimaryActorSelection(s, extra);
    const actorLabel = selectionTooltipLabel(actor);
    if (s.stat_type === 'touch') {
      const touchPlayer = selectionTooltipLabel(extra?.touch?.player);
      if (touchPlayer) lines.push(`Player: ${touchPlayer}`);
      if (extra?.touch?.reason) lines.push(`Touch: ${toTitleCase(extra.touch.reason)}`);
    }
    if (s.stat_type === 'defensive_action' && extra?.defensive_action?.reason) {
      lines.push(`Defensive Action: ${toTitleCase(extra.defensive_action.reason)}`);
    }
    if (actorLabel) lines.push(`Player: ${actorLabel}`);
    else if (s.player_name || s.player_number) lines.push(`Player: ${[s.player_number ? `#${s.player_number}` : '', s.player_name || ''].filter(Boolean).join(' ')}`);
    const kickoutWinner = s.stat_type === 'kickout'
      ? selectionTooltipLabel(extra?.kickout?.won_by)
      : '';
    const kickoutLoser = s.stat_type === 'kickout'
      ? selectionTooltipLabel(extra?.kickout?.lost_by)
      : '';
    const kickoutBrokenBy = s.stat_type === 'kickout'
      ? selectionTooltipLabel(extra?.kickout?.broken_by)
      : '';
    const recipient = getCompletedReceiptSelection(s, extra);
    const recipientLabel = selectionTooltipLabel(recipient);
    if (s.stat_type === 'kickout') {
      lines.push(`Won By: ${kickoutWinner || '—'}`);
      lines.push(`Lost By: ${kickoutLoser || '—'}`);
      lines.push(`Broken By: ${kickoutBrokenBy || '—'}`);
    } else if (recipientLabel && s.stat_type !== 'shot') {
      lines.push(`Recipient: ${recipientLabel}`);
    }
    // Prefer normalized match time for display across the Stats pages.
    const normT = Number(s.normalized_time_s);
    const rawT = Number(s.time_s);
    if (Number.isFinite(normT)) lines.push(`Time: ${formatMMSS(normT)}`);
    else if (Number.isFinite(rawT)) lines.push(`Time: ${formatMMSS(rawT)}`);
    if (Number.isFinite(Number(s.play_id))) lines.push(`Play: ${Number(s.play_id)}`);
    if (Number.isFinite(Number(s.possession_id))) lines.push(`Poss: ${Number(s.possession_id)}`);
    return lines.join('\n');
  };

  const getColor = (s, extra) => {
    if (colorBy === 'action') {
      return actionPalette?.[s.stat_type] || defaultActionPalette[s.stat_type] || '#111827';
    }
    if (colorBy === 'outcome') {
      const o = deriveOutcome(s, extra);
      if (!o) return '#111827';
      return outcomePalette?.[o] || defaultOutcomePalette[o] || '#111827';
    }
    // default: team
    const colorSide = s?.color_team_side || s?.team_side;
    return colorSide === 'away'
      ? (teamPalette?.away || awayColor || '#ef4444')
      : (teamPalette?.home || homeColor || '#22c55e');
  };

  const openVideoForStat = (stat) => {
    const timeS = Number(stat?.time_s);
    if (Number.isFinite(timeS)) onOpenVideoAt?.(timeS);
  };

  const renderContent = (isFullscreen = false) => (
    <div className={`w-full overflow-hidden ${isFullscreen ? '' : 'rounded-xl border border-slate-200 bg-white'}`}>
        <div
          data-fullscreen-trigger="true"
          className={`relative ${isFullscreen ? 'mx-auto w-full' : align === 'left' ? 'mr-auto' : 'mx-auto'}`}
          style={{
            ...(isFullscreen ? fullscreenPitchStyle(PITCH_W / (PITCH_H * verticalScale)) : { width: pitchScale }),
            aspectRatio: `${PITCH_W} / ${PITCH_H * verticalScale}`,
            backgroundImage: `url(${pitchImg})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        >
          <DirectionBadge label={directionLabel} />
        <svg className="absolute inset-0 w-full h-full" viewBox={`-5 -5 ${PITCH_W + 10} ${PITCH_H + 10}`} preserveAspectRatio="none">
          <defs>
            {/* Reusable arrow marker that inherits the line stroke color (supported in modern browsers). */}
            <marker id="gstl_arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" stroke="context-stroke" />
            </marker>
          </defs>
          {stats.map((s) => {
            const extra = safeParseJSON(s.extra_data || '{}', {});
            const col = getColor(s, extra);
            const tip = tooltipText(s, extra);
            const isSelected = selectedStatId != null && String(selectedStatId) === String(s?.id);
            const start = transformDisplayPoint(s.x_position, s.y_position, s.team_side, mirrorAwayWhenBoth);
            if (!start) return null;
            const end = transformDisplayPoint(s.end_x_position, s.end_y_position, s.team_side, mirrorAwayWhenBoth);
            const x1 = start.x;
            const y1 = start.y;
            const x2 = end?.x;
            const y2 = end?.y;

            // Lines for directional actions with end coords; dots otherwise.
            const hasEnd = !!end && !(Number(end?.x) === 0 && Number(end?.y) === 0);
            const isLineAction = ['pass', 'carry', 'kickout', 'throw_in'].includes(String(s.stat_type || ''));
            if (isLineAction && hasEnd && String(s.stat_type || '') !== 'throw_in') {
              const isEmbeddedTurnover =
                String(extra?.pass?.outcome || '') === 'turnover'
                || String(extra?.carry?.outcome || '') === 'turnover'
                || s.stat_type === 'turnover'
                || !!extra?.turnover;
              if (turnoverEndpointOnly && isEmbeddedTurnover) {
                return (
                  <g
                    key={s.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      onStatClick?.(s);
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      openVideoForStat(s);
                    }}
                  >
                    <title>{tip}</title>
                    {isSelected ? <circle cx={x2} cy={y2} r="2.5" fill="none" stroke="#111827" strokeWidth="0.5" opacity="0.95" /> : null}
                    <circle cx={x2} cy={y2} r="1.6" fill={col} opacity={isSelected ? '1' : '0.95'} />
                  </g>
                );
              }
              const strokeW = s.stat_type === 'pass' ? 0.55 : (s.stat_type === 'carry' ? 0.65 : 0.75);
              const kickOutcome = String(extra?.kickout?.outcome || '');
              const kickTeamSide = s.stat_type === 'kickout'
                ? inferRestartTeamSide(s, extra)
                : inferRestartTeamSide(s, extra);
              const kickoutTeamColor = kickTeamSide === 'away'
                ? (teamPalette?.away || awayColor || '#ef4444')
                : (teamPalette?.home || homeColor || '#22c55e');
              const kickWonSide = inferRestartWinnerSide(s, nextContextById.get(s.id));
              const kickoutDotUsesOutcome = ['clean', 'break', 'sideline_for', 'sideline_against', 'foul'].includes(kickOutcome);
              const kickoutOutcomeFill = s.stat_type === 'kickout'
                ? (kickoutDotUsesOutcome && kickWonSide && kickTeamSide && kickWonSide === kickTeamSide ? '#16a34a' : '#dc2626')
                : col;
              const kickoutEndColor = kickoutOutcomeDots && s.stat_type === 'kickout'
                ? kickoutOutcomeFill
                : col;
              const lineColor = s.stat_type === 'kickout' && kickoutOutcomeDots ? kickoutTeamColor : col;
              if (kickoutCircleMode && s.stat_type === 'kickout') {
                return (
                  <g
                    key={s.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      onStatClick?.(s);
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      openVideoForStat(s);
                    }}
                  >
                    <title>{tip}</title>
                    {isSelected ? <circle cx={x2} cy={y2} r="2.9" fill="none" stroke="#111827" strokeWidth="0.55" opacity="0.95" /> : null}
                    <circle cx={x2} cy={y2} r="1.9" fill="#ffffff" stroke={kickoutTeamColor} strokeWidth={isSelected ? "0.95" : "0.7"} opacity="0.98" />
                    <circle cx={x2} cy={y2} r="1.05" fill={kickoutOutcomeFill} opacity="0.98" />
                  </g>
                );
              }
              return (
                <g
                  key={s.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    onStatClick?.(s);
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    openVideoForStat(s);
                  }}
                >
                  <title>{tip}</title>
                  <line
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke={lineColor}
                    strokeWidth={isSelected ? strokeW + 0.25 : strokeW}
                    opacity={isSelected ? '1' : '0.95'}
                    markerEnd="url(#gstl_arrow)"
                  />
                  {(s.stat_type === 'kickout') && (
                    <>
                      <circle cx={x1} cy={y1} r={isSelected ? "1.35" : "1.15"} fill={lineColor} />
                      <circle cx={x2} cy={y2} r={isSelected ? "1.35" : "1.15"} fill={kickoutEndColor} stroke={lineColor} strokeWidth={isSelected ? "0.5" : "0.35"} />
                    </>
                  )}
                </g>
              );
            }
            return (
              <g
                key={s.id}
                onClick={(e) => {
                  e.stopPropagation();
                  onStatClick?.(s);
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  openVideoForStat(s);
                }}
              >
                <title>{tip}</title>
                {isSelected ? <circle cx={x1} cy={y1} r="2.5" fill="none" stroke="#111827" strokeWidth="0.5" opacity="0.95" /> : null}
                <circle cx={x1} cy={y1} r="1.6" fill={col} opacity={isSelected ? '1' : '0.95'} />
              </g>
            );
          })}
        </svg>
      </div>

      {!isFullscreen && showColorControls && (colorBy === 'action' || colorBy === 'outcome' || colorBy === 'team') && (
        <div className="border-t bg-slate-50 px-3 py-2">
          <div className="text-xs font-semibold text-slate-700">Colors</div>
          <div className="pt-2 grid grid-cols-2 gap-2">
            {(colorBy === 'team'
              ? [
                { key: 'home', label: 'Home' },
                { key: 'away', label: 'Away' },
              ]
              : (colorBy === 'action'
                ? ['shot', 'kickout', 'pass', 'carry', 'turnover', 'foul', 'throw_in'].map((k) => ({ key: k, label: toTitleCase(k) }))
                : Array.from(new Set(stats.map((s) => deriveOutcome(s, safeParseJSON(s.extra_data || '{}', {}))).filter(Boolean)))
                  .sort((a, b) => String(a).localeCompare(String(b)))
                  .map((k) => ({ key: k, label: toTitleCase(k) }))
              )
            ).map((item) => {
              const key = item.key;
              const value = colorBy === 'team'
                ? (teamPalette?.[key] || (key === 'away' ? (awayColor || '#ef4444') : (homeColor || '#22c55e')))
                : (colorBy === 'action'
                  ? (actionPalette?.[key] || defaultActionPalette[key] || '#111827')
                  : (outcomePalette?.[key] || defaultOutcomePalette[key] || '#111827'));
              return (
                <div key={key} className="flex items-center justify-between gap-2 rounded-md bg-white border border-slate-200 px-2 py-1">
                  <div className="text-xs text-slate-700 truncate">{item.label}</div>
                  <input
                    type="color"
                    value={value}
                    onChange={(e) => {
                      const next = e.target.value;
                      if (colorBy === 'team') {
                        const updated = { ...(teamPalette || {}), [key]: next };
                        setTeamPalette(updated);
                        persist('gstl_viz_team_palette_v1', updated);
                      } else if (colorBy === 'action') {
                        const updated = { ...(actionPalette || {}), [key]: next };
                        setActionPalette(updated);
                        persist('gstl_viz_action_palette_v1', updated);
                      } else {
                        const updated = { ...(outcomePalette || {}), [key]: next };
                        setOutcomePalette(updated);
                        persist('gstl_viz_outcome_palette_v1', updated);
                      }
                    }}
                    className="h-6 w-8 border-0 bg-transparent p-0"
                    title="Pick color"
                  />
                </div>
              );
            })}
          </div>
          <div className="pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => {
                if (colorBy === 'team') {
                  const def = { home: homeColor || '#22c55e', away: awayColor || '#ef4444' };
                  setTeamPalette(def);
                  persist('gstl_viz_team_palette_v1', def);
                } else if (colorBy === 'action') {
                  setActionPalette(defaultActionPalette);
                  persist('gstl_viz_action_palette_v1', defaultActionPalette);
                } else {
                  setOutcomePalette(defaultOutcomePalette);
                  persist('gstl_viz_outcome_palette_v1', defaultOutcomePalette);
                }
              }}
            >
              Reset Colors
            </Button>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <FullscreenMapShell title={fullscreenTitle} enabled={fullscreenEnabled}>
      {(isFullscreen) => renderContent(isFullscreen)}
    </FullscreenMapShell>
  );
}

function AttackChannelPitch({ homeTeam, awayTeam, teamMode, homeColor, awayColor, rows, fullscreenEnabled = true, compact = false, cardClassName = '' }) {
  const rowFor = (channel) => rows.find((r) => r.channel === channel) || {};
  const channels = ['Left', 'Middle', 'Right'];
  const allPcts = channels.flatMap((channel) => {
    const row = rowFor(channel);
    return [Number(row?.homePct) || 0, Number(row?.awayPct) || 0];
  });
  const maxPct = Math.max(1, ...allPcts);

  const ArrowRow = ({ row, color }) => {
    const pct = row.pct;
    const count = row.count;
    const label = `${Number.isFinite(pct) ? pct.toFixed(1) : 'NA'}%`;
    const strength = Number.isFinite(pct) ? Math.max(0.2, pct / maxPct) : 0.2;
    const x1 = 18;
    const arrowLength = 20 + (strength * 16);
    const headLength = 5 + (strength * 3);
    const shaftHeight = 2.2 + (strength * 2.2);
    const x2 = Math.min(58, x1 + arrowLength);
    const shaftEnd = x2 - headLength;
    const textX = 4;
    const y = row.channel === 'Left' ? 18 : row.channel === 'Middle' ? 42.5 : 67;
    return (
      <g>
        <text x={textX} y={y - 2.4} textAnchor="start" fontSize="4.2" fontWeight="700" fill="#000000">{label}</text>
        <text x={textX} y={y + 2.8} textAnchor="start" fontSize="3.2" fontWeight="600" fill="#000000">{row.channel}</text>
        <text x={textX} y={y + 7.1} textAnchor="start" fontSize="2.7" fill="#000000">
          {Number.isFinite(count) ? `${count} attacks` : 'NA'}
        </text>
        <line
          x1={x1}
          y1={y}
          x2={shaftEnd}
          y2={y}
          stroke={color}
          strokeWidth={shaftHeight}
          strokeLinecap="round"
          opacity="0.92"
        />
        <polygon
          points={`${shaftEnd - 0.6},${y - (shaftHeight * 1.55)} ${x2},${y} ${shaftEnd - 0.6},${y + (shaftHeight * 1.55)}`}
          fill={color}
          opacity="0.92"
        />
      </g>
    );
  };

  const TeamHalf = ({ side, title, color }) => {
    const panelRows = channels.map((channel) => ({
      channel,
      count: side === 'home' ? rowFor(channel).homeCount : rowFor(channel).awayCount,
      pct: side === 'home' ? rowFor(channel).homePct : rowFor(channel).awayPct,
    }));
    return (
      <div className={`flex h-full w-full flex-col rounded-2xl border-2 border-slate-400 bg-slate-50/70 p-3 shadow-sm ${compact ? 'max-w-[310px]' : 'max-w-[440px]'}`}>
        <div className="flex h-full flex-col space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-semibold text-slate-900">{title} Attack Entry Channels</div>
            <div className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-900">
              Attacking left to right
            </div>
          </div>
          <div className="flex-1 overflow-hidden rounded-2xl border-2 border-slate-300 bg-white/90 shadow-sm">
            <div
              className="relative h-full w-full overflow-hidden rounded-[1.25rem]"
              style={{
                backgroundImage: `url(${pitchImg})`,
                backgroundSize: '200% 100%',
                backgroundPosition: 'right center',
              }}
            >
              <DirectionBadge className="left-3 top-3 text-black" label="Attacking ->" />
              <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${PITCH_W / 2} ${PITCH_H}`} preserveAspectRatio="none">
                {panelRows.map((row) => (
                  <g key={`${side}-${row.channel}`}>
                    <title>{`${title} - ${row.channel}: ${row.count || 0} attacks (${Number.isFinite(row.pct) ? row.pct.toFixed(1) : 'NA'}%)`}</title>
                    <ArrowRow row={row} color={color} />
                  </g>
                ))}
              </svg>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className={`h-full w-full ${cardClassName}`.trim()}>
      <div className={`grid h-full gap-4 justify-items-start ${compact ? 'sm:grid-cols-2' : 'lg:grid-cols-2'}`}>
        <TeamHalf side="home" title={homeTeam?.name || 'Home'} color={homeColor || '#2563eb'} />
        <TeamHalf side="away" title={awayTeam?.name || 'Away'} color={awayColor || '#ef4444'} />
      </div>
    </div>
  );
}

function PassNetwork({ passes, side, minCount, teamColor, teamLabel, showTable = true, showPitch = true, pitchScale = REPORT_PITCH_SCALE, centralityRowsOverride = null, hiddenPlayerIds = null, fullscreenEnabled = true, nodeSizeMode = 'volume' }) {
  // Build undirected edges between passer and intended recipient for completed passes.
  const edges = new Map(); // key "a|b" -> { a, b, count_ab, count_ba, total }
  const passesMade = new Map(); // playerId -> count
  const passesReceived = new Map(); // playerId -> count
  const pos = new Map(); // playerId -> { sumX, sumY, n }
  const meta = new Map(); // playerId -> { number, name }

  const addPos = (id, x, y) => {
    if (!id || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const cur = pos.get(id) || { sumX: 0, sumY: 0, n: 0 };
    cur.sumX += x;
    cur.sumY += y;
    cur.n += 1;
    pos.set(id, cur);
  };

  for (const s of passes) {
    const extra = safeParseJSON(s.extra_data || '{}', {});
    const p = extra?.pass?.passer;
    const outcome = extra?.pass?.outcome;

    if (outcome !== 'completed') continue;
    if (p?.kind !== 'player') continue;

    // Receiver for pass networks should represent who actually won/received the pass.
    // Prefer won_by when it's a player; fall back to intended_recipient as a best-effort.
    const r = (extra?.pass?.won_by?.kind === 'player')
      ? extra.pass.won_by
      : extra?.pass?.intended_recipient;

    if (r?.kind !== 'player') continue;
    if (p.team_side !== side || r.team_side !== side) continue;

    const a = p.id;
    const b = r.id;
    if (!a || !b || a === b) continue;

    // Meta (best effort; names may be blank).
    if (!meta.has(a)) meta.set(a, { number: p.number ?? null, name: p.name || '' });
    if (!meta.has(b)) meta.set(b, { number: r.number ?? null, name: r.name || '' });

    // Directional counts.
    passesMade.set(a, (passesMade.get(a) || 0) + 1);
    passesReceived.set(b, (passesReceived.get(b) || 0) + 1);

    // Positions (normalized): passer start, recipient end.
    addPos(a, Number(s.x_position), Number(s.y_position));
    addPos(b, Number(s.end_x_position), Number(s.end_y_position));

    const [u, v] = a < b ? [a, b] : [b, a];
    const key = `${u}|${v}`;
    const cur = edges.get(key) || { a: u, b: v, count_ab: 0, count_ba: 0, total: 0 };
    if (a === u && b === v) cur.count_ab += 1;
    else cur.count_ba += 1;
    cur.total += 1;
    edges.set(key, cur);
  }

  const edgeList = Array.from(edges.values()).filter((e) => e.total >= minCount);
  const nodeIds = new Set();
  edgeList.forEach((e) => { nodeIds.add(e.a); nodeIds.add(e.b); });

  const adjacency = new Map();
  for (const id of nodeIds) adjacency.set(id, new Set());
  for (const edge of edgeList) {
    adjacency.get(edge.a)?.add(edge.b);
    adjacency.get(edge.b)?.add(edge.a);
  }

  const weightedDegree = new Map();
  for (const id of nodeIds) weightedDegree.set(id, 0);
  for (const edge of edgeList) {
    weightedDegree.set(edge.a, (weightedDegree.get(edge.a) || 0) + edge.total);
    weightedDegree.set(edge.b, (weightedDegree.get(edge.b) || 0) + edge.total);
  }

  const betweenness = new Map();
  for (const id of nodeIds) betweenness.set(id, 0);
  const nodeList = Array.from(nodeIds);
  for (const source of nodeList) {
    const stack = [];
    const predecessors = new Map(nodeList.map((id) => [id, []]));
    const sigma = new Map(nodeList.map((id) => [id, 0]));
    const distance = new Map(nodeList.map((id) => [id, -1]));
    sigma.set(source, 1);
    distance.set(source, 0);
    const queue = [source];
    while (queue.length) {
      const v = queue.shift();
      stack.push(v);
      for (const w of adjacency.get(v) || []) {
        if (distance.get(w) < 0) {
          queue.push(w);
          distance.set(w, distance.get(v) + 1);
        }
        if (distance.get(w) === distance.get(v) + 1) {
          sigma.set(w, (sigma.get(w) || 0) + (sigma.get(v) || 0));
          predecessors.get(w).push(v);
        }
      }
    }
    const dependency = new Map(nodeList.map((id) => [id, 0]));
    while (stack.length) {
      const w = stack.pop();
      for (const v of predecessors.get(w) || []) {
        const sigmaW = sigma.get(w) || 1;
        const contribution = ((sigma.get(v) || 0) / sigmaW) * (1 + (dependency.get(w) || 0));
        dependency.set(v, (dependency.get(v) || 0) + contribution);
      }
      if (w !== source) {
        betweenness.set(w, (betweenness.get(w) || 0) + (dependency.get(w) || 0));
      }
    }
  }
  for (const id of nodeList) betweenness.set(id, (betweenness.get(id) || 0) / 2);

  const nodes = Array.from(nodeIds).map((id) => {
    const p = pos.get(id) || { sumX: 0, sumY: 0, n: 0 };
    const n = Math.max(p.n, 1);
    return {
      id,
      x: p.n ? (p.sumX / n) : 0,
      y: p.n ? (p.sumY / n) : 0,
      made: passesMade.get(id) || 0,
      received: passesReceived.get(id) || 0,
      weightedDegree: weightedDegree.get(id) || 0,
      betweenness: betweenness.get(id) || 0,
      number: meta.get(id)?.number ?? null,
      name: meta.get(id)?.name || '',
    };
  });

  const hiddenSet = hiddenPlayerIds instanceof Set ? hiddenPlayerIds : new Set(Array.isArray(hiddenPlayerIds) ? hiddenPlayerIds : []);
  const visibleNodes = nodes.filter((n) => !hiddenSet.has(n.id));
  const visibleNodeIdSet = new Set(visibleNodes.map((n) => n.id));
  const visibleEdgeList = edgeList.filter((e) => visibleNodeIdSet.has(e.a) && visibleNodeIdSet.has(e.b));
  const maxEdge = visibleEdgeList.reduce((m, e) => Math.max(m, e.total), 1);
  const maxTouches = nodes.reduce((m, n) => Math.max(m, n.made + n.received), 1);

  const strokeBase = teamColor || (side === 'away' ? '#ef4444' : '#22c55e');
  const displayPoint = (x, y) => transformDisplayPoint(x, y, side, false);

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const computedCentralityRows = nodes
    .slice()
    .sort((a, b) => (b.weightedDegree - a.weightedDegree) || (b.betweenness - a.betweenness));
  const centralityRows = Array.isArray(centralityRowsOverride) ? centralityRowsOverride : computedCentralityRows;
  const visibleCentralityRows = centralityRows.filter((row) => !hiddenSet.has(row.id));
  const [tableSort, setTableSort] = useState({ key: 'weightedDegree', dir: 'desc' });
  const [showAllRows, setShowAllRows] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const tableColumns = useMemo(() => ([
    { key: 'number', label: 'Number', sortValue: (row) => row.number ?? Number.MAX_SAFE_INTEGER },
    { key: 'name', label: 'Name', sortValue: (row) => row.name || '' },
    { key: 'made', label: 'Passes', sortValue: (row) => row.made },
    { key: 'received', label: 'Received', sortValue: (row) => row.received },
    { key: 'weightedDegree', label: 'Activity Score', sortValue: (row) => row.weightedDegree },
    { key: 'betweenness', label: 'Connector Score', sortValue: (row) => row.betweenness },
  ]), []);
  const sortedCentralityRows = useMemo(() => sortRows(visibleCentralityRows, tableSort, tableColumns, 'id'), [visibleCentralityRows, tableSort, tableColumns]);
  const rankedCentralityRows = useMemo(
    () => sortedCentralityRows.map((row, index) => ({ ...row, rank: index + 1 })),
    [sortedCentralityRows],
  );
  const displayedCentralityRows = useMemo(
    () => (showAllRows ? rankedCentralityRows : rankedCentralityRows.slice(0, 8)),
    [showAllRows, rankedCentralityRows],
  );
  const toggleTableSort = (key) => setTableSort((current) => current.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' || key === 'number' ? 'asc' : 'desc' });

  useEffect(() => {
    if (!selectedNodeId) return;
    if (!visibleNodeIdSet.has(selectedNodeId)) {
      setSelectedNodeId(null);
    }
  }, [selectedNodeId, visibleNodeIdSet]);

  const selectedConnections = useMemo(() => {
    if (!selectedNodeId) return new Set();
    const connected = new Set([selectedNodeId]);
    visibleEdgeList.forEach((edge) => {
      if (edge.a === selectedNodeId) connected.add(edge.b);
      if (edge.b === selectedNodeId) connected.add(edge.a);
    });
    return connected;
  }, [selectedNodeId, visibleEdgeList]);

  const renderContent = (isFullscreen = false) => (
    <div className="w-full space-y-3">
        {!isFullscreen && <div className="font-semibold text-slate-900">{teamLabel || toTitleCase(side)} Pass Network</div>}
        {showPitch && (
          <div className={`w-full overflow-hidden ${isFullscreen ? '' : 'rounded-xl border border-slate-200 bg-white'}`}>
            <div
              data-fullscreen-trigger="true"
              className={`relative ${isFullscreen ? 'mx-auto w-full' : 'mx-auto'}`}
              style={{
                ...(isFullscreen ? fullscreenPitchStyle(PITCH_W / PITCH_H) : { width: pitchScale }),
                aspectRatio: `${PITCH_W} / ${PITCH_H}`,
                backgroundImage: `url(${pitchImg})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
              }}
            >
              <DirectionBadge />
              <svg className="absolute inset-0 w-full h-full" viewBox={`-5 -5 ${PITCH_W + 10} ${PITCH_H + 10}`} preserveAspectRatio="none">
            {visibleEdgeList.map((e) => {
              const a = nodeById.get(e.a);
              const b = nodeById.get(e.b);
              if (!a || !b) return null;
              const aPoint = displayPoint(a.x, a.y);
              const bPoint = displayPoint(b.x, b.y);
              if (!aPoint || !bPoint) return null;
              const w = 0.35 + (e.total / maxEdge) * 2.4;
              const isSelectedEdge = !!selectedNodeId && (e.a === selectedNodeId || e.b === selectedNodeId);
              const aLabel = (a.number != null ? `#${a.number}` : 'Player') + (a.name ? ` ${a.name}` : '');
              const bLabel = (b.number != null ? `#${b.number}` : 'Player') + (b.name ? ` ${b.name}` : '');
              return (
                <g key={`${e.a}|${e.b}`}>
                  <title>{`${aLabel} -> ${bLabel}: ${e.count_ab}\n${bLabel} -> ${aLabel}: ${e.count_ba}\nTotal: ${e.total}`}</title>
                  <line
                    x1={aPoint.x}
                    y1={aPoint.y}
                    x2={bPoint.x}
                    y2={bPoint.y}
                    stroke={strokeBase}
                    strokeOpacity={selectedNodeId ? (isSelectedEdge ? 0.92 : 0.14) : 0.5}
                    strokeWidth={selectedNodeId ? (isSelectedEdge ? w + 0.8 : Math.max(0.3, w * 0.72)) : w}
                  />
                </g>
              );
            })}

            {visibleNodes.map((n) => {
              const touches = n.made + n.received;
              const point = displayPoint(n.x, n.y);
              if (!point) return null;
              const isFixedSize = nodeSizeMode === 'fixed';
              const r = isFixedSize
                ? 2
                : Math.min(5.2, 1.8 + (touches / maxTouches) * 3.4);
              const label = (n.number != null ? `#${n.number}` : 'Player') + (n.name ? ` ${n.name}` : '');
              const isSelectedNode = n.id === selectedNodeId;
              const isConnectedNode = selectedConnections.has(n.id);
              const nodeOpacity = selectedNodeId ? (isConnectedNode ? 1 : 0.3) : 1;
              return (
                <g key={n.id}>
                  <title>{`${label}\nPasses: ${n.made}\nPasses Received: ${n.received}\nActivity Score: ${n.weightedDegree}\nConnector Score: ${Math.round(n.betweenness)}`}</title>
                  {isSelectedNode ? (
                    <circle
                      cx={point.x}
                      cy={point.y}
                      r={r + (isFixedSize ? 0.95 : 1.25)}
                      fill="none"
                      stroke="#111827"
                      strokeWidth="0.85"
                    />
                  ) : null}
                  <circle
                    cx={point.x}
                    cy={point.y}
                    r={isSelectedNode ? r + 0.25 : r}
                    fill={strokeBase}
                    fillOpacity={isSelectedNode ? 1 : (nodeOpacity * 0.9)}
                    stroke="#ffffff"
                    strokeWidth={isSelectedNode ? '0.9' : (isFixedSize ? '0.18' : '0.6')}
                  />
                  {n.number != null && (
                    <text
                      x={point.x}
                      y={point.y}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontSize="2.8"
                      fontWeight="700"
                      fill="#ffffff"
                    >
                      {String(n.number)}
                    </text>
                  )}
                </g>
              );
            })}
              </svg>
            </div>
          </div>
        )}
        {showTable && visibleCentralityRows.length > 0 && (
          <div data-fullscreen-block="true" className={`${isFullscreen ? 'rounded-xl bg-white/95 p-4' : ''}`}>
          <div className="mb-2 flex items-center justify-end gap-3">
            {sortedCentralityRows.length > 8 ? (
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
                <TableHead>Rank</TableHead>
                {tableColumns.map((column) => (
                  <SortableTableHead
                    key={column.key}
                    column={column}
                    sortState={tableSort}
                    onToggle={toggleTableSort}
                    className={column.key === 'name' ? undefined : 'text-right'}
                  />
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayedCentralityRows.map((row, index) => {
                const isSelectedRow = row.id === selectedNodeId;
                const rowTint = hexToRgba(strokeBase, index % 2 === 0 ? 0.05 : 0.1);
                const selectedTint = hexToRgba(strokeBase, 0.18);
                return (
                <TableRow
                  key={row.id}
                  className="cursor-pointer"
                  style={{ backgroundColor: isSelectedRow ? selectedTint : rowTint }}
                  onClick={() => setSelectedNodeId((current) => current === row.id ? null : row.id)}
                >
                  <TableCell className="font-medium text-slate-600">{row.rank}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.number ?? '—'}</TableCell>
                  <TableCell className="font-medium">{row.name || 'Player'}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.made}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.received}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.weightedDegree}</TableCell>
                  <TableCell className="text-right tabular-nums">{Math.round(row.betweenness)}</TableCell>
                </TableRow>
              )})}
            </TableBody>
          </Table>
          </div>
        )}
    </div>
  );

  return (
    <FullscreenMapShell title={teamLabel || `${toTitleCase(side)} Pass Network`} enabled={fullscreenEnabled}>
      {(isFullscreen) => renderContent(isFullscreen)}
    </FullscreenMapShell>
  );
}

function describeSector(cx, cy, innerR, outerR, startAngle, endAngle) {
  const startOuter = {
    x: cx + outerR * Math.cos(startAngle),
    y: cy + outerR * Math.sin(startAngle),
  };
  const endOuter = {
    x: cx + outerR * Math.cos(endAngle),
    y: cy + outerR * Math.sin(endAngle),
  };
  const startInner = {
    x: cx + innerR * Math.cos(endAngle),
    y: cy + innerR * Math.sin(endAngle),
  };
  const endInner = {
    x: cx + innerR * Math.cos(startAngle),
    y: cy + innerR * Math.sin(startAngle),
  };
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  return [
    `M ${startOuter.x} ${startOuter.y}`,
    `A ${outerR} ${outerR} 0 ${largeArc} 1 ${endOuter.x} ${endOuter.y}`,
    `L ${startInner.x} ${startInner.y}`,
    `A ${innerR} ${innerR} 0 ${largeArc} 0 ${endInner.x} ${endInner.y}`,
    'Z',
  ].join(' ');
}

function describeSectorVertical(cx, cy, innerR, outerR, startAngle, endAngle) {
  const rotation = -Math.PI / 2;
  return describeSector(cx, cy, innerR, outerR, startAngle + rotation, endAngle + rotation);
}

function buildPassSonarData(passes, { side = null, playerId = null, bins = 12, includeOverall = false } = {}) {
  const zoneBuckets = {
    ...(includeOverall ? { Overall: [] } : {}),
    'Defensive Third': [],
    'Middle Third': [],
    'Attacking Third': [],
  };
  for (const stat of Array.isArray(passes) ? passes : []) {
    if (!stat || stat.stat_type !== 'pass') continue;
    if (shouldExcludeFromTotals(stat)) continue;
    const extra = safeParseJSON(stat.extra_data || '{}', {});
    const passer = normalizePlayerRef(extra?.pass?.passer);
    if (!passer) continue;
    if (side && passer.team_side !== side) continue;
    if (playerId && String(passer.id) !== String(playerId)) continue;
    const start = getNormalizedSonarPoint(stat, 'start');
    const end = getNormalizedSonarPoint(stat, 'end');
    if (!start || !end) continue;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) continue;
    const sonarAngle = Math.atan2(dy, dx);
    const normalizedAngle = sonarAngle < 0 ? sonarAngle + (Math.PI * 2) : sonarAngle;
    const bin = Math.min(bins - 1, Math.floor((normalizedAngle / (Math.PI * 2)) * bins));
    const startX = start.x;
    const zone = startX < 45 ? 'Defensive Third' : startX < (PITCH_W - 45) ? 'Middle Third' : 'Attacking Third';
    if (!zoneBuckets[zone]) continue;
    const method = String(extra?.pass?.method || '').toLowerCase();
    const isKick = method === 'left' || method === 'right';
    const isHand = method === 'hand';
    zoneBuckets[zone].push({
      stat,
      bin,
      kickCount: isKick ? 1 : 0,
      handCount: isHand ? 1 : 0,
    });
    if (includeOverall && zoneBuckets.Overall) {
      zoneBuckets.Overall.push({
        stat,
        bin,
        kickCount: isKick ? 1 : 0,
        handCount: isHand ? 1 : 0,
      });
    }
  }

  return Object.entries(zoneBuckets).map(([zone, events]) => {
    const buckets = Array.from({ length: bins }, (_, index) => ({
      index,
      count: 0,
      kickCount: 0,
      handCount: 0,
      kickShare: NaN,
      color: '#8b5cf6',
      events: [],
    }));
    events.forEach((event) => {
      const bucket = buckets[event.bin];
      bucket.count += 1;
      bucket.kickCount += event.kickCount || 0;
      bucket.handCount += event.handCount || 0;
      bucket.events.push(event);
    });
    buckets.forEach((bucket) => {
      if (bucket.count > 0) {
        const comparable = bucket.kickCount + bucket.handCount;
        bucket.kickShare = comparable > 0 ? bucket.kickCount / comparable : NaN;
        bucket.color = getPassMethodColor(bucket.kickShare);
      }
    });
    return { zone, total: events.length, buckets };
  });
}

function PassSonar({ passes, side = null, playerId = null, title = 'Pass Sonar', subtitle = '', fullscreenEnabled = true, zoneOrder = ['Defensive Third', 'Middle Third', 'Attacking Third'], stacked = false, includeOverall = false }) {
  const zones = useMemo(() => {
    const built = buildPassSonarData(passes, { side, playerId, includeOverall });
    const orderMap = new Map(zoneOrder.map((zone, index) => [zone, index]));
    return built.slice().sort((a, b) => (orderMap.get(a.zone) ?? 999) - (orderMap.get(b.zone) ?? 999));
  }, [passes, side, playerId, zoneOrder, includeOverall]);
  const renderContent = (isFullscreen = false) => (
    <div className="w-full space-y-3">
      {!isFullscreen && (
        <div>
          <div className="font-semibold text-slate-900">{title}</div>
          {subtitle ? <div className="text-xs text-slate-500">{subtitle}</div> : null}
        </div>
      )}
      <div className={`grid gap-4 ${stacked ? 'grid-cols-1' : (zones.length > 1 ? 'lg:grid-cols-3' : '')}`}>
        {zones.map((zone) => {
          const size = 260;
          const cx = size / 2;
          const cy = size / 2;
          const maxCount = Math.max(1, ...zone.buckets.map((bucket) => bucket.count));
          return (
            <div key={zone.zone} className={`rounded-xl ${isFullscreen ? 'bg-white/95 p-4' : 'border border-slate-200 bg-white p-4'}`}>
              <div className="mb-2">
                <div className="font-medium text-slate-900">{zone.zone}</div>
                <div className="text-xs text-slate-500">{zone.total} passes</div>
              </div>
              <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-[260px] mx-auto">
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
                {zone.buckets.map((bucket) => {
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
        })}
      </div>
    </div>
  );

  return (
    <FullscreenMapShell title={title} enabled={fullscreenEnabled}>
      {(isFullscreen) => renderContent(isFullscreen)}
    </FullscreenMapShell>
  );
}

function TouchMap({ touchEvents, playerId, title = 'Touch Map', homeColor, awayColor, fullscreenEnabled = true, onOpenVideoAt = null, mirrorAwayWhenBoth = true, directionLabel = 'Attacking ->', cardless = false }) {
  const filtered = useMemo(() => {
    return (Array.isArray(touchEvents) ? touchEvents : []).filter((event) => !playerId || event?.player?.id === playerId);
  }, [touchEvents, playerId]);

  const stats = useMemo(() => filtered.map((event) => ({
    id: event.key,
    stat_type: 'touch',
    team_side: event.player?.team_side,
    x_position: event.x,
    y_position: event.y,
    time_s: event?.stat?.time_s,
    normalized_time_s: event?.stat?.normalized_time_s,
    play_id: event?.stat?.play_id,
    possession_id: event?.stat?.possession_id,
    extra_data: JSON.stringify({
      touch: {
        player: { kind: 'player', ...event.player },
        reason: event.reason,
      },
    }),
  })), [filtered]);

  const content = (
    <>
      <div className="font-semibold text-slate-900">{title}</div>
      {stats.length ? (
        <PitchViz
          stats={stats}
          homeColor={homeColor}
          awayColor={awayColor}
          colorBy="team"
          showColorControls={false}
          mirrorAwayWhenBoth={mirrorAwayWhenBoth}
          directionLabel={directionLabel}
          fullscreenEnabled={fullscreenEnabled}
          fullscreenTitle={title}
          onOpenVideoAt={onOpenVideoAt}
        />
      ) : (
        <div className="text-sm text-slate-500">Select a player to view their touches.</div>
      )}
    </>
  );

  if (cardless) {
    return <div className="space-y-3">{content}</div>;
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        {content}
      </CardContent>
    </Card>
  );
}

function ReportFiltersFields({
  reportFilters,
  playerOptions,
  homeTeam,
  awayTeam,
  showPlayer = true,
  showAction = true,
  showOutcome = true,
  actionLabel = 'Action',
  timeBeforeAction = false,
}) {
  const allowedActionTypes = Array.isArray(reportFilters?.allowedActionTypes) && reportFilters.allowedActionTypes.length
    ? reportFilters.allowedActionTypes
    : null;

  const actionOptions = useMemo(() => (
    Array.from(new Set((reportFilters?.allStats || [])
      .map((s) => String(s?.stat_type || ''))
      .filter((v) => v && (!allowedActionTypes || allowedActionTypes.includes(v)))))
      .sort((a, b) => a.localeCompare(b))
      .map((value) => ({ value, label: toTitleCase(value) }))
  ), [reportFilters?.allStats, allowedActionTypes]);

  const effectiveActionValues = useMemo(() => {
    const selected = Array.isArray(reportFilters?.actionTypes) ? reportFilters.actionTypes : [];
    const available = new Set(actionOptions.map((option) => option.value));
    return selected.filter((value) => available.has(value));
  }, [reportFilters?.actionTypes, actionOptions]);

  const outcomeOptions = useMemo(() => (
    Array.from(new Set((reportFilters?.allStats || [])
      .filter((s) => {
        const statType = String(s?.stat_type || '');
        if (allowedActionTypes && !allowedActionTypes.some((value) => statMatchesActionType(s, value))) return false;
        if (effectiveActionValues.length && !effectiveActionValues.some((value) => statMatchesActionType(s, value))) return false;
        return true;
      })
      .map((s) => deriveOutcome(s, safeParseJSON(s.extra_data || '{}', {})))
      .filter(Boolean)))
      .sort((a, b) => a.localeCompare(b))
      .map((value) => ({ value, label: toTitleCase(value) }))
  ), [reportFilters?.allStats, allowedActionTypes, effectiveActionValues]);
  const effectiveOutcomeValues = useMemo(() => {
    const selected = Array.isArray(reportFilters?.outcomes) ? reportFilters.outcomes : [];
    const available = new Set(outcomeOptions.map((option) => option.value));
    return selected.filter((value) => available.has(value));
  }, [reportFilters?.outcomes, outcomeOptions]);

  const timeField = (
    <MatchTimeRangeSlider
      compact
      timeMin={reportFilters.timeMin}
      timeMax={reportFilters.timeMax}
      match={reportFilters.match}
      stats={reportFilters.allStats}
      imputedTimeById={reportFilters.imputedTimeById}
      onChange={({ timeMin, timeMax }) => {
        reportFilters.setTimeMin(timeMin);
        reportFilters.setTimeMax(timeMax);
      }}
    />
  );

  const actionField = showAction ? (
    <MultiSelect
      label={actionLabel}
      placeholder="All"
      values={effectiveActionValues}
      onChange={reportFilters.setActionTypes}
      options={actionOptions}
    />
  ) : null;

  const outcomeField = showOutcome ? (
    <MultiSelect
      label="Outcome"
      placeholder="All"
      values={effectiveOutcomeValues}
      onChange={reportFilters.setOutcomes}
      options={outcomeOptions}
    />
  ) : null;

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label className="text-xs text-slate-600">Team</Label>
        <Select value={reportFilters.team} onValueChange={reportFilters.setTeam}>
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
        values={reportFilters.halves}
        onChange={reportFilters.setHalves}
        options={['first', 'second', 'et_first', 'et_second'].map((v) => ({ value: v, label: toTitleCase(v) }))}
      />

      {timeBeforeAction ? timeField : null}

      {showPlayer ? (
        <MultiSelect
          label="Player"
          placeholder="Any"
          values={reportFilters.playerIds}
          onChange={reportFilters.setPlayerIds}
          options={(playerOptions || []).map((p) => ({ value: p.id, label: (p.team_side === 'away' ? 'Away: ' : 'Home: ') + p.label }))}
        />
      ) : null}

      {actionField}
      {outcomeField}

      {!timeBeforeAction ? timeField : null}
    </div>
  );
}

function ReportFiltersCard({ reportFilters, playerOptions, homeTeam, awayTeam }) {
  const [open, setOpen] = useState(false);
  const activeCount =
    (reportFilters?.team && reportFilters.team !== 'both' ? 1 : 0)
    + (Array.isArray(reportFilters?.halves) ? reportFilters.halves.length : 0)
    + (Array.isArray(reportFilters?.playerIds) ? reportFilters.playerIds.length : 0)
    + (Array.isArray(reportFilters?.actionTypes) ? reportFilters.actionTypes.length : 0)
    + (Array.isArray(reportFilters?.outcomes) ? reportFilters.outcomes.length : 0)
    + (String(reportFilters?.timeMin ?? '') !== '' ? 1 : 0)
    + (String(reportFilters?.timeMax ?? '') !== '' ? 1 : 0);

  return (
    <Card className={open ? 'w-[300px] max-w-full self-start' : 'w-fit self-start'}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-semibold text-slate-900">Filters</div>
            {!open && <div className="text-[11px] text-slate-500">{activeCount ? `${activeCount} active` : 'Collapsed'}</div>}
          </div>
          <Button type="button" variant="outline" size="sm" className="h-8 px-2 text-xs" onClick={() => setOpen((v) => !v)}>
            {open ? 'Hide Filters' : 'Show Filters'}
            <ChevronDown className={`ml-1 h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
          </Button>
        </div>
        {open ? <ReportFiltersFields reportFilters={reportFilters} playerOptions={playerOptions} homeTeam={homeTeam} awayTeam={awayTeam} /> : null}
      </CardContent>
    </Card>
  );
}

function shotSideFromY(y) {
  const yy = Number(y);
  if (!Number.isFinite(yy)) return '';
  if (yy < PITCH_H / 3) return 'left';
  if (yy > (2 * PITCH_H) / 3) return 'right';
  return 'centre';
}

function shotZoneFromDistance(d) {
  const dist = Number(d);
  if (!Number.isFinite(dist)) return '';
  if (dist <= 21) return 'inside_21';
  if (dist <= 45) return '21_45';
  if (dist <= 65) return '45_65';
  return '65_plus';
}

function ShotMapLegend({ teamMode, homeColor, awayColor }) {
  const outlineColor = teamMode === 'both' ? '#111827' : '#cbd5e1';
  const iconClass = 'flex h-5 w-5 items-center justify-center shrink-0 text-slate-700';
  const rowClass = 'flex items-center gap-2.5 text-xs text-slate-700';

  return (
    <div className="space-y-2 rounded-xl border border-slate-300 bg-slate-50 p-3 shadow-sm">
      <div className="space-y-0.5">
        <div className="text-sm font-semibold text-slate-900">Key</div>
        <div className="grid gap-0.5 text-[11px] text-slate-500">
          <div>Shape = attempt type</div>
          <div>Fill = outcome</div>
          <div>Outline = team</div>
        </div>
      </div>

      <div className="space-y-2 border-t border-slate-200 pt-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Attempt Type</div>
        <div className="flex items-center justify-between gap-3">
          <div className={rowClass}>
            <span className={iconClass}>
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="8" cy="8" r="4" fill="#16a34a" stroke={outlineColor} strokeWidth="1.4" />
              </svg>
            </span>
            <span>1 point</span>
          </div>
          <div className={rowClass}>
            <span className={iconClass}>
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <rect x="4" y="4" width="8" height="8" transform="rotate(45 8 8)" fill="#16a34a" stroke={outlineColor} strokeWidth="1.4" />
              </svg>
            </span>
            <span>2 point</span>
          </div>
          <div className={rowClass}>
            <span className={iconClass}>
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <rect x="4" y="4" width="8" height="8" fill="#16a34a" stroke={outlineColor} strokeWidth="1.4" />
              </svg>
            </span>
            <span>goal</span>
          </div>
        </div>
      </div>

      <div className="space-y-2 border-t border-slate-200 pt-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Outcome</div>
        <div className="space-y-1.5">
          <div className={rowClass}>
            <span className={iconClass}>
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="8" cy="8" r="4" fill="#16a34a" stroke={outlineColor} strokeWidth="1.4" />
              </svg>
            </span>
            <span>green fill = score</span>
          </div>
          <div className={rowClass}>
            <span className={iconClass}>
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="8" cy="8" r="4" fill="#dc2626" stroke={outlineColor} strokeWidth="1.4" />
              </svg>
            </span>
            <span>red fill = miss / saved / blocked / post / short</span>
          </div>
        </div>
      </div>

      <div className="space-y-2 border-t border-slate-200 pt-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Team</div>
        <div className={rowClass}>
          <span className={iconClass}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="8" cy="8" r="4" fill="#f8fafc" stroke={teamMode === 'both' ? (homeColor || '#2563eb') : outlineColor} strokeWidth="1.8" />
            </svg>
          </span>
          <span>ring / outline colour = team identifier</span>
        </div>
      </div>
    </div>
  );
}

function ShotMap({ shots, mode, setMode, teamMode = 'both', homeColor, awayColor, onOpenVideoAt = null, fullscreenEnabled = true }) {
  const list = Array.isArray(shots) ? shots : [];

  const colors = {
    score: '#16a34a',
    wide: '#dc2626',
    short: '#dc2626',
    saved: '#dc2626',
    blocked: '#dc2626',
    post: '#dc2626',
    other: '#dc2626',
  };

  const visible = list.filter((s) => {
    if (s?.broughtBackAdv) return mode === 'all';
    if (mode === 'all') return true;
    const g = shotOutcomeGroup(s.outcome);
    if (mode === 'scores') return g === 'score';
    if (mode === 'misses') return g !== 'score';
    if (mode === 'blocked_saved') return g === 'blocked' || g === 'saved';
    return true;
  });

  const renderContent = (isFullscreen = false) => (
    <div className="space-y-3 w-full">
        {!isFullscreen && (
        <div data-fullscreen-block="true" className="flex items-center justify-between gap-2">
          <div className="font-semibold text-slate-900">Shot Map</div>
          <div className="inline-flex items-center gap-2">
            {[
              ['all', 'All Shots'],
              ['scores', 'Scores Only'],
              ['misses', 'Misses Only'],
              ['blocked_saved', 'Blocked/Saved'],
            ].map(([v, label]) => (
              <Button
                key={v}
                type="button"
                variant={mode === v ? 'default' : 'outline'}
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => setMode(v)}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>
        )}

        <div className={isFullscreen ? '' : 'grid gap-2 lg:grid-cols-[minmax(0,1fr)_220px] lg:items-start'}>
          <div
            data-fullscreen-trigger="true"
            className={`relative overflow-hidden ${isFullscreen ? 'w-full mx-auto' : 'rounded-xl border border-slate-200'}`}
            style={{
              ...(isFullscreen ? fullscreenPitchStyle(PITCH_W / (PITCH_H * REPORT_PITCH_VERTICAL_SCALE)) : { width: '100%' }),
              aspectRatio: `${PITCH_W} / ${PITCH_H * REPORT_PITCH_VERTICAL_SCALE}`,
              backgroundImage: `url(${pitchImg})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
          >
            <DirectionBadge label="Home ->" />
            <svg className="absolute inset-0 w-full h-full" viewBox={`-5 -5 ${PITCH_W + 10} ${PITCH_H + 10}`} preserveAspectRatio="none">
              {visible.map((s) => {
                const point = transformDisplayPoint(s.x, s.y, s.team_side, true);
                if (!point) return null;
                const x = point.x;
                const y = point.y;
                const g = shotOutcomeGroup(s.outcome);
                const outcomeColor = colors[g] || colors.other;
                const isAdv = !!s.broughtBackAdv;
                const teamColor = s.team_side === 'away' ? (awayColor || '#ef4444') : (homeColor || '#2563eb');
                const fillColor = isAdv ? teamColor : outcomeColor;
                const strokeColor = isAdv ? teamColor : (teamMode === 'both' ? teamColor : '#ffffff');
                const shape = ['point', '2_point', 'goal'].includes(String(s.outcome || ''))
                  ? String(s.outcome)
                  : s.shotType;
                const size = 1.87;
                const advInnerSize = size * 0.48;
                const blackStrokeWidth = isAdv ? 0.45 : (teamMode === 'both' ? 1 : 0.425);
                const teamStrokeWidth = isAdv ? 0.95 : (teamMode === 'both' ? 0.95 : 0.6);
                const tip = [
                  `Player: ${s.playerLabel || 'NA'}`,
                  `Time: ${s.timeLabel || 'NA'}`,
                  `Shot Type: ${toTitleCase(s.shotType)}`,
                  `Situation: ${toTitleCase(s.situation)}`,
                  `Pressure: ${toTitleCase(s.pressure)}`,
                  `Outcome: ${toTitleCase(s.outcome)}`,
                  `xP: ${Number.isFinite(s.xp) ? s.xp.toFixed(2) : 'N/A'}`,
                  Number.isFinite(s.distance) ? `Distance: ${s.distance.toFixed(1)}` : null,
                  s.possessionLabel ? `Possession: ${s.possessionLabel}` : null,
                ].filter(Boolean).join('\n');

                if (shape === 'goal') {
                  return (
                    <g
                      key={s.id}
                      onClick={(e) => e.stopPropagation()}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        const timeS = Number(s?.raw?.time_s ?? s?.time_s);
                        if (Number.isFinite(timeS)) onOpenVideoAt?.(timeS);
                      }}
                    >
                      <rect
                        x={x - size}
                        y={y - size}
                        width={size * 2}
                        height={size * 2}
                        fill="none"
                        stroke="#111827"
                        strokeWidth={blackStrokeWidth}
                      />
                      <rect
                        x={x - size}
                        y={y - size}
                        width={size * 2}
                        height={size * 2}
                        fill={fillColor}
                        opacity="0.9"
                      >
                        <title>{tip}</title>
                      </rect>
                      {isAdv && (
                        <rect
                          x={x - advInnerSize}
                          y={y - advInnerSize}
                          width={advInnerSize * 2}
                          height={advInnerSize * 2}
                          fill="#ffffff"
                          opacity="0.98"
                        />
                      )}
                      <rect
                        x={x - size}
                        y={y - size}
                        width={size * 2}
                        height={size * 2}
                        fill="none"
                        stroke={strokeColor}
                        strokeWidth={teamStrokeWidth}
                      />
                    </g>
                  );
                }
                if (shape === '2_point') {
                  return (
                    <g
                      key={s.id}
                      onClick={(e) => e.stopPropagation()}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        const timeS = Number(s?.raw?.time_s ?? s?.time_s);
                        if (Number.isFinite(timeS)) onOpenVideoAt?.(timeS);
                      }}
                    >
                      <rect
                        x={x - size}
                        y={y - size}
                        width={size * 2}
                        height={size * 2}
                        fill="none"
                        transform={`rotate(45 ${x} ${y})`}
                        stroke="#111827"
                        strokeWidth={blackStrokeWidth}
                      />
                      <rect
                        x={x - size}
                        y={y - size}
                        width={size * 2}
                        height={size * 2}
                        fill={fillColor}
                        opacity="0.9"
                        transform={`rotate(45 ${x} ${y})`}
                      >
                        <title>{tip}</title>
                      </rect>
                      {isAdv && (
                        <rect
                          x={x - advInnerSize}
                          y={y - advInnerSize}
                          width={advInnerSize * 2}
                          height={advInnerSize * 2}
                          fill="#ffffff"
                          opacity="0.98"
                          transform={`rotate(45 ${x} ${y})`}
                        />
                      )}
                      <rect
                        x={x - size}
                        y={y - size}
                        width={size * 2}
                        height={size * 2}
                        fill="none"
                        transform={`rotate(45 ${x} ${y})`}
                        stroke={strokeColor}
                        strokeWidth={teamStrokeWidth}
                      />
                    </g>
                  );
                }
                return (
                  <g
                    key={s.id}
                    onClick={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      const timeS = Number(s?.raw?.time_s ?? s?.time_s);
                      if (Number.isFinite(timeS)) onOpenVideoAt?.(timeS);
                    }}
                  >
                    <circle
                      cx={x}
                      cy={y}
                      r={size}
                      fill="none"
                      stroke="#111827"
                      strokeWidth={blackStrokeWidth}
                    />
                    <circle
                      cx={x}
                      cy={y}
                      r={size}
                      fill={fillColor}
                      opacity="0.9"
                    >
                      <title>{tip}</title>
                    </circle>
                    {isAdv && (
                      <circle
                        cx={x}
                        cy={y}
                        r={advInnerSize}
                        fill="#ffffff"
                        opacity="0.98"
                      />
                    )}
                    <circle
                      cx={x}
                      cy={y}
                      r={size}
                      fill="none"
                      stroke={strokeColor}
                      strokeWidth={teamStrokeWidth}
                    />
                  </g>
                );
              })}
            </svg>
          </div>

          {!isFullscreen ? (
            <ShotMapLegend teamMode={teamMode} homeColor={homeColor} awayColor={awayColor} />
          ) : null}
        </div>
    </div>
  );

  return (
    <FullscreenMapShell title="Shot Map" enabled={fullscreenEnabled}>
      {(isFullscreen) => renderContent(isFullscreen)}
    </FullscreenMapShell>
  );
}

function applyNonTeamReportFilters(stats, reportFilters) {
  const list = Array.isArray(stats) ? stats : [];
  const halves = Array.isArray(reportFilters?.halves) ? reportFilters.halves : [];
  const playerIds = Array.isArray(reportFilters?.playerIds) ? reportFilters.playerIds : [];
  const actionTypes = Array.isArray(reportFilters?.actionTypes) ? reportFilters.actionTypes : [];
  const outcomes = Array.isArray(reportFilters?.outcomes) ? reportFilters.outcomes : [];
  const imputed = reportFilters?.imputedTimeById;
  const match = reportFilters?.match;

  return list.filter((s) => {
    if (!s) return false;
    if (halves.length && !halves.includes(s.half)) return false;
    if (actionTypes.length && !actionTypes.some((value) => statMatchesActionType(s, value))) return false;
    if (outcomes.length) {
      const extra = safeParseJSON(s.extra_data || '{}', {});
      const outcome = deriveOutcome(s, extra);
      if (!outcomes.includes(outcome)) return false;
    }
    if (playerIds.length) {
      const extra = safeParseJSON(s.extra_data || '{}', {});
      const ids = collectPlayerIds(extra);
      const any = playerIds.some((id) => ids.has(String(id)));
      if (!any) return false;
    }
    if (!statMatchesDisplayTimeRange(s, {
      timeMin: reportFilters?.timeMin,
      timeMax: reportFilters?.timeMax,
      match,
      imputedTimeById: imputed,
      stats: reportFilters?.allStats || list,
    })) return false;
    return true;
  });
}

export {
  REPORT_PITCH_VERTICAL_SCALE,
  REPORT_PITCH_SCALE,
  safeParseJSON,
  toTitleCase,
  formatMMSS,
  formatMatchTimeLabel,
  formatAddedTime,
  formatMatchClock,
  formatPct,
  clampTimeRange,
  normalizeTimeRangeForSlider,
  statMatchesDisplayTimeRange,
  sortRows,
  SortableTableHead,
  requestElementFullscreen,
  RangeSliderField,
  MatchTimeRangeSlider,
  ComparisonMetricsCard,
  teamRowTint,
  computeImputedNormalizedTimes,
  formatTeamLabel,
  humanizeKey,
  presentablePathLabel,
  formatExtraValue,
  flattenExtra,
  deriveOutcome,
  statMatchesActionType,
  MultiSelect,
  collectPlayerIds,
  collectPlayerSelectionKeys,
  sortKeyForTime,
  groupByPossession,
  possessionHasOpp45Entry,
  derivePossessionOutcome,
  selectionKey,
  normalizePlayerRef,
  getPrimaryActorSelection,
  getCompletedReceiptSelection,
  isDirectTouchAction,
  deriveCounterAttackState,
  deriveAttackTypeState,
  inferPossessionStartSource,
  getPossessionStartZone,
  isGoalkeeperPlayer,
  getKeeperCandidate,
  buildShotAssistCredits,
  buildDefensiveActions,
  buildTouchEvents,
  buildTouchesMap,
  buildPassSonarData,
  getPassMethodColor,
  DirectionBadge,
  transformDisplayPoint,
  PitchViz,
  AttackChannelPitch,
  PassNetwork,
  PassSonar,
  TouchMap,
  defenceSetStateKey,
  attackTypeStateKey,
  ReportFiltersFields,
  ReportFiltersCard,
  shotSideFromY,
  shotZoneFromDistance,
  ShotMap,
  applyNonTeamReportFilters,
  FullscreenMapShell,
};

