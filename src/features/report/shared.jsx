import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  formatMatchClock as formatMatchClockFromAnalytics,
  getProgressiveMeters,
  isBroughtBackAdvantageStat,
  normalizeFoulType,
  normalizeOutcomeAlias,
  shotOutcomeGroup,
  statHasEmbeddedTurnover,
  statHasEnteredOpp45,
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
  return (
    <TableHead className={className}>
      {column?.sortable === false ? (
        children ?? column?.label
      ) : (
        <button
          type="button"
          className={`inline-flex items-center gap-1 font-medium text-left ${className.includes('text-right') ? 'ml-auto' : ''}`}
          onClick={() => onToggle?.(column?.key)}
        >
          <span>{children ?? column?.label}</span>
          {Icon ? <Icon className="h-3.5 w-3.5 text-slate-500" /> : null}
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

function ComparisonMetricsCard({ homeTeam, awayTeam, teamMode = 'both', title = 'Metrics', rows = [], cardClassName = 'w-full lg:w-[48%] lg:max-w-[48%] mr-auto', metricColWidth = '180px' }) {
  const showHome = teamMode === 'both' || teamMode === 'home';
  const showAway = teamMode === 'both' || teamMode === 'away';
  const metricCol = metricColWidth;

  return (
    <Card className={cardClassName}>
      <CardContent className="p-4 space-y-4">
        <div className="font-semibold text-slate-900">{title}</div>
        <div className="grid items-center gap-3 text-xs text-slate-600" style={{ gridTemplateColumns: `minmax(0,1fr) ${metricCol} minmax(0,1fr)` }}>
          <div className="inline-flex items-center gap-2 min-w-0 justify-self-start">
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: homeTeam?.color || '#22c55e' }} />
            <span className="truncate">{homeTeam?.name || 'Home'}</span>
          </div>
          <div className="text-center text-[1.05rem] font-bold text-slate-700">Metric</div>
          <div className="inline-flex items-center gap-2 min-w-0 justify-end justify-self-end">
            <span className="truncate">{awayTeam?.name || 'Away'}</span>
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: awayTeam?.color || '#ef4444' }} />
          </div>
        </div>
        <div className="grid gap-2">
          {rows.map((row) => (
            <div key={row.label} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
              <div className="grid items-center gap-3" style={{ gridTemplateColumns: `minmax(0,1fr) ${metricCol} minmax(0,1fr)` }}>
                <div className={`text-left tabular-nums ${row.strong ? 'font-semibold text-slate-900' : 'text-slate-900'}`}>
                  {showHome ? row.home : ''}
                </div>
                <div className="text-center text-xs font-medium text-slate-600">{row.label}</div>
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

function MultiSelect({ label, options, values, onChange, placeholder = 'All', className = '' }) {
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
      <Label className="text-xs text-slate-600">{label}</Label>
      <Popover>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size="sm" className="h-8 w-full justify-between text-xs">
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
    if (v.kind === 'player' && typeof v.id === 'string') ids.add(v.id);
    for (const k of Object.keys(v)) walk(v[k]);
  };
  walk(extra);
  return ids;
}

function collectPlayerSelectionKeys(extra) {
  const keys = new Set();
  const walk = (v) => {
    if (!v || typeof v !== 'object') return;
    if (v.kind === 'player' && typeof v.id === 'string' && (v.team_side === 'home' || v.team_side === 'away')) {
      keys.add(`${v.team_side}|${v.id}`);
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
  const relevant = (Array.isArray(actingStats) ? actingStats : []).filter((s) => s && s.stat_type !== 'kickout' && typeof s.counter_attack === 'boolean');
  if (!relevant.length) return 'No';
  const flags = relevant.map((s) => !!s.counter_attack);
  const last = flags[flags.length - 1];
  return last ? 'Yes' : 'No';
}

function defenceSetStateKey(state) {
  return state === 'Yes' ? 'defence_set_yes' : 'defence_set_no';
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
      if (isBroughtBackAdvantageStat(shot)) continue;
      for (let j = i - 1; j >= 0; j -= 1) {
        const prev = acting[j];
        if (prev?.stat_type !== 'pass') continue;
        if (isBroughtBackAdvantageStat(prev)) continue;
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

function getAccuracyScore(value) {
  const v = String(value || '').trim();
  if (v === '++') return 3;
  if (v === '+') return 1;
  if (v === '-') return -1;
  if (v === '--') return -3;
  return 0;
}

function getAccuracyColor(value) {
  if (!Number.isFinite(value)) return '#cbd5e1';
  if (value <= -2) return '#dc2626';
  if (value < 0) return '#f97316';
  if (value < 1) return '#facc15';
  if (value < 3) return '#86efac';
  return '#166534';
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
    if (isBroughtBackAdvantageStat(stat)) continue;
    const extra = safeParseJSON(stat.extra_data || '{}', {});

    if (stat.stat_type === 'pass') {
      add(extra?.pass?.won_by, stat, stat?.end_x_position, stat?.end_y_position, 'Pass Won');
      if (normalizeOutcomeAlias(extra?.pass?.outcome) === 'broken_retained') {
        add(extra?.pass?.recovered_by, stat, stat?.end_x_position, stat?.end_y_position, 'Broken Retained');
      }
      if (extra?.pass?.deadball) {
        add(extra?.pass?.passer, stat, stat?.x_position, stat?.y_position, 'Deadball Pass');
      }
      continue;
    }

    if (stat.stat_type === 'turnover' || extra?.turnover) {
      add(extra?.turnover?.recovered_by, stat, stat?.end_x_position ?? stat?.x_position, stat?.end_y_position ?? stat?.y_position, 'Turnover Recovery');
      continue;
    }

    if (stat.stat_type === 'kickout') {
      add(extra?.kickout?.won_by, stat, stat?.end_x_position, stat?.end_y_position, 'Kickout Won');
      const kickTeam = inferRestartTeamSide(stat, extra);
      if (kickTeam) {
        const keeper = getKeeperCandidate(playerOptions, kickTeam);
        add(
          keeper
            ? { kind: 'player', ...keeper }
            : null,
          stat,
          stat?.x_position,
          stat?.y_position,
          'Own Kickout Taken',
        );
      }
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
    if (isBroughtBackAdvantageStat(stat)) continue;
    const extra = safeParseJSON(stat.extra_data || '{}', {});
    const actionsForRow = new Set();

    const addTeamAction = (teamSide, reason, x, y) => {
      if (teamSide !== 'home' && teamSide !== 'away') return;
      const key = `${stat?.id || 'stat'}:${teamSide}`;
      if (actionsForRow.has(key)) return;
      actionsForRow.add(key);
      teamActions.push({
        key,
        stat,
        teamSide,
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
      addTeamAction(teamSide, 'Turnover Forced', stat?.end_x_position ?? stat?.x_position, stat?.end_y_position ?? stat?.y_position);
      addPlayerAction(stat, recovered, 'Turnover Recovered', stat?.end_x_position ?? stat?.x_position, stat?.end_y_position ?? stat?.y_position);
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
        addTeamAction(defendingSide, 'High Pressure Carry', stat?.x_position, stat?.y_position);
        addPlayerAction(stat, extra?.carry?.defender, 'High Pressure Carry', stat?.x_position, stat?.y_position);
      }
      continue;
    }

    if (stat.stat_type === 'pass') {
      const passerSide = extra?.pass?.passer?.team_side || stat?.team_side;
      if (String(extra?.pass?.pressure_on_passer || '').toLowerCase() === 'high') {
        addTeamAction(oppositeTeamSide(passerSide), 'High Pressure Pass', stat?.x_position, stat?.y_position);
      }
      continue;
    }

    if (stat.stat_type === 'shot') {
      const shooterSide = extra?.shot?.player?.team_side || stat?.team_side;
      if (String(extra?.shot?.pressure || '').toLowerCase() === 'high') {
        addTeamAction(oppositeTeamSide(shooterSide), 'High Pressure Shot', stat?.x_position, stat?.y_position);
      }
    }
  }

  return { teamActions, playerActions };
}

function DirectionBadge({ className = '', label = 'Attacking ->' }) {
  return (
    <div className={`absolute left-2 top-2 z-10 rounded-full bg-white/92 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-700 shadow-sm ${className}`}>
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
  turnoverEndpointOnly = false,
  pitchScale = REPORT_PITCH_SCALE,
  onOpenVideoAt = null,
  fullscreenEnabled = true,
  fullscreenTitle = 'Map',
  align = 'center',
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
    const recipient = getCompletedReceiptSelection(s, extra);
    const recipientLabel = selectionTooltipLabel(recipient);
    if (kickoutWinner) lines.push(`Won By: ${kickoutWinner}`);
    else if (recipientLabel && s.stat_type !== 'shot') lines.push(`Recipient: ${recipientLabel}`);
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
                    onClick={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      openVideoForStat(s);
                    }}
                  >
                    <title>{tip}</title>
                    <circle cx={x2} cy={y2} r="1.6" fill={col} opacity="0.95" />
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
              const kickoutEndColor = kickoutOutcomeDots && s.stat_type === 'kickout'
                ? (kickoutDotUsesOutcome && kickWonSide && kickTeamSide && kickWonSide === kickTeamSide ? '#16a34a' : '#dc2626')
                : col;
              const lineColor = s.stat_type === 'kickout' && kickoutOutcomeDots ? kickoutTeamColor : col;
              return (
                <g
                  key={s.id}
                  onClick={(e) => e.stopPropagation()}
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
                    strokeWidth={strokeW}
                    opacity="0.95"
                    markerEnd="url(#gstl_arrow)"
                  />
                  {(s.stat_type === 'kickout') && (
                    <>
                      <circle cx={x1} cy={y1} r="1.15" fill={lineColor} />
                      <circle cx={x2} cy={y2} r="1.15" fill={kickoutEndColor} stroke={lineColor} strokeWidth="0.35" />
                    </>
                  )}
                </g>
              );
            }
            return (
              <g
                key={s.id}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  openVideoForStat(s);
                }}
              >
                <title>{tip}</title>
                <circle cx={x1} cy={y1} r="1.6" fill={col} opacity="0.95" />
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

function AttackChannelPitch({ homeTeam, awayTeam, teamMode, homeColor, awayColor, rows, fullscreenEnabled = true }) {
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
    const x1 = 14;
    const arrowLength = 26 + (strength * 28);
    const headLength = 7 + (strength * 5);
    const shaftHeight = 2.3 + (strength * 3.7);
    const x2 = Math.min(64, x1 + arrowLength);
    const shaftEnd = x2 - headLength;
    const textX = 4;
    const y = row.channel === 'Left' ? 18 : row.channel === 'Middle' ? 42.5 : 67;
    return (
      <g>
        <text x={textX} y={y - 2.4} textAnchor="start" fontSize="4.3" fontWeight="700" fill="#0f172a">{label}</text>
        <text x={textX} y={y + 2.8} textAnchor="start" fontSize="3.1" fill="#475569">{row.channel}</text>
        <text x={textX} y={y + 7.2} textAnchor="start" fontSize="2.7" fill="#64748b">
          {Number.isFinite(count) ? `${count} attacks` : 'NA'}
        </text>
        <rect
          x={x1}
          y={y - (shaftHeight / 2)}
          width={Math.max(1, shaftEnd - x1)}
          height={shaftHeight}
          rx={shaftHeight / 2}
          fill={color}
          opacity="0.95"
        />
        <polygon
          points={`${shaftEnd},${y - (shaftHeight * 1.55)} ${x2},${y} ${shaftEnd},${y + (shaftHeight * 1.55)}`}
          fill={color}
          opacity="0.95"
        />
      </g>
    );
  };

  const TeamHalf = ({ side, title, color, isFullscreen = false }) => {
    const panelRows = channels.map((channel) => ({
      channel,
      count: side === 'home' ? rowFor(channel).homeCount : rowFor(channel).awayCount,
      pct: side === 'home' ? rowFor(channel).homePct : rowFor(channel).awayPct,
    }));
    return (
      <div className="space-y-2">
        <div className="text-sm font-medium text-slate-900">{title}</div>
        <div className={`overflow-hidden ${isFullscreen ? '' : 'rounded-xl border border-slate-200 bg-white'}`}>
          <div
            data-fullscreen-trigger="true"
            className={`relative ${isFullscreen ? 'mx-auto' : ''}`}
            style={{
              ...(isFullscreen ? fullscreenPitchStyle((PITCH_W / 2) / PITCH_H) : { width: '73%' }),
              aspectRatio: `${PITCH_W / 2} / ${PITCH_H * REPORT_PITCH_VERTICAL_SCALE}`,
              backgroundImage: `url(${pitchImg})`,
              backgroundSize: '200% 100%',
              backgroundPosition: 'right center',
            }}
          >
            <svg className="absolute inset-0 h-full w-full" viewBox={`-4 -4 ${(PITCH_W / 2) + 8} ${PITCH_H + 8}`} preserveAspectRatio="none">
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
    );
  };

  const renderContent = (isFullscreen = false) => (
    <div className="w-full space-y-3">
        {!isFullscreen && <div className="font-semibold text-slate-900">Attack Entry Channels</div>}
        {teamMode === 'both' ? (
          <div className={`grid gap-4 ${isFullscreen ? 'grid-cols-2' : 'lg:grid-cols-2'}`}>
            <TeamHalf side="home" title={homeTeam?.name || 'Home'} color={homeColor || '#2563eb'} isFullscreen={isFullscreen} />
            <TeamHalf side="away" title={awayTeam?.name || 'Away'} color={awayColor || '#ef4444'} isFullscreen={isFullscreen} />
          </div>
        ) : (
          <TeamHalf
            side={teamMode === 'away' ? 'away' : 'home'}
            title={teamMode === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home')}
            color={teamMode === 'away' ? (awayColor || '#ef4444') : (homeColor || '#2563eb')}
            isFullscreen={isFullscreen}
          />
        )}
    </div>
  );

  return (
    <FullscreenMapShell title="Attack Entry Channels" enabled={fullscreenEnabled}>
      {(isFullscreen) => renderContent(isFullscreen)}
    </FullscreenMapShell>
  );
}

function PassNetwork({ passes, side, minCount, teamColor, teamLabel, showTable = true, showPitch = true, pitchScale = REPORT_PITCH_SCALE, centralityRowsOverride = null, hiddenPlayerIds = null, fullscreenEnabled = true }) {
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
  const displayPoint = (x, y) => transformDisplayPoint(x, y, side, true);

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const computedCentralityRows = nodes
    .slice()
    .sort((a, b) => (b.weightedDegree - a.weightedDegree) || (b.betweenness - a.betweenness))
    .slice(0, 8);
  const centralityRows = Array.isArray(centralityRowsOverride) ? centralityRowsOverride : computedCentralityRows;
  const visibleCentralityRows = centralityRows.filter((row) => !hiddenSet.has(row.id));
  const [tableSort, setTableSort] = useState({ key: 'weightedDegree', dir: 'desc' });
  const tableColumns = useMemo(() => ([
    { key: 'player', label: 'Player', sortValue: (row) => `${row.number ?? ''} ${row.name || ''}`.trim() },
    { key: 'made', label: 'Passes', sortValue: (row) => row.made },
    { key: 'received', label: 'Received', sortValue: (row) => row.received },
    { key: 'weightedDegree', label: 'Weighted Degree', sortValue: (row) => row.weightedDegree },
    { key: 'betweenness', label: 'Betweenness', sortValue: (row) => row.betweenness },
  ]), []);
  const sortedCentralityRows = useMemo(() => sortRows(visibleCentralityRows, tableSort, tableColumns, 'id'), [visibleCentralityRows, tableSort, tableColumns]);
  const toggleTableSort = (key) => setTableSort((current) => current.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'player' ? 'asc' : 'desc' });

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
                    strokeOpacity="0.5"
                    strokeWidth={w}
                  />
                </g>
              );
            })}

            {visibleNodes.map((n) => {
              const touches = n.made + n.received;
              const point = displayPoint(n.x, n.y);
              if (!point) return null;
              const r = Math.min(5.2, 1.8 + (touches / maxTouches) * 3.4);
              const label = (n.number != null ? `#${n.number}` : 'Player') + (n.name ? ` ${n.name}` : '');
              return (
                <g key={n.id}>
                  <title>{`${label}\nPasses: ${n.made}\nPasses Received: ${n.received}\nWeighted Degree: ${n.weightedDegree}\nBetweenness: ${n.betweenness.toFixed(2)}`}</title>
                  <circle cx={point.x} cy={point.y} r={r} fill={strokeBase} fillOpacity="0.9" stroke="#ffffff" strokeWidth="0.6" />
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
          <Table>
            <TableHeader>
              <TableRow>
                {tableColumns.map((column) => (
                  <SortableTableHead
                    key={column.key}
                    column={column}
                    sortState={tableSort}
                    onToggle={toggleTableSort}
                    className={column.key === 'player' ? undefined : 'text-right'}
                  />
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedCentralityRows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{(row.number != null ? `#${row.number}` : 'Player') + (row.name ? ` ${row.name}` : '')}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.made}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.received}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.weightedDegree}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.betweenness.toFixed(2)}</TableCell>
                </TableRow>
              ))}
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

function buildPassSonarData(passes, { side = null, playerId = null, bins = 12 } = {}) {
  const zoneBuckets = {
    'Defensive Third': [],
    'Middle Third': [],
    'Attacking Third': [],
  };
  for (const stat of Array.isArray(passes) ? passes : []) {
    if (!stat || stat.stat_type !== 'pass') continue;
    if (isBroughtBackAdvantageStat(stat)) continue;
    const extra = safeParseJSON(stat.extra_data || '{}', {});
    const passer = normalizePlayerRef(extra?.pass?.passer);
    if (!passer) continue;
    if (side && passer.team_side !== side) continue;
    if (playerId && passer.id !== playerId) continue;
    const start = transformDisplayPoint(stat?.x_position, stat?.y_position, passer.team_side, true);
    const end = transformDisplayPoint(stat?.end_x_position, stat?.end_y_position, passer.team_side, true);
    if (!start || !end) continue;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) continue;
    const angle = Math.atan2(dy, dx);
    const normalizedAngle = angle < 0 ? angle + (Math.PI * 2) : angle;
    const bin = Math.min(bins - 1, Math.floor((normalizedAngle / (Math.PI * 2)) * bins));
    const attackingX = start.x;
    const thirdWidth = PITCH_W / 3;
    const zone = attackingX < thirdWidth ? 'Defensive Third' : attackingX < (thirdWidth * 2) ? 'Middle Third' : 'Attacking Third';
    if (!zoneBuckets[zone]) continue;
    zoneBuckets[zone].push({
      stat,
      bin,
      accuracyScore: getAccuracyScore(extra?.pass?.accuracy),
      accuracyLabel: String(extra?.pass?.accuracy || '+'),
    });
  }

  return Object.entries(zoneBuckets).map(([zone, events]) => {
    const buckets = Array.from({ length: bins }, (_, index) => ({
      index,
      count: 0,
      accuracyTotal: 0,
      averageAccuracy: NaN,
      color: '#cbd5e1',
      events: [],
    }));
    events.forEach((event) => {
      const bucket = buckets[event.bin];
      bucket.count += 1;
      bucket.accuracyTotal += event.accuracyScore;
      bucket.events.push(event);
    });
    buckets.forEach((bucket) => {
      if (bucket.count > 0) {
        bucket.averageAccuracy = bucket.accuracyTotal / bucket.count;
        bucket.color = getAccuracyColor(bucket.averageAccuracy);
      }
    });
    return { zone, total: events.length, buckets };
  });
}

function PassSonar({ passes, side = null, playerId = null, title = 'Pass Sonar', subtitle = '', fullscreenEnabled = true, zoneOrder = ['Defensive Third', 'Middle Third', 'Attacking Third'] }) {
  const zones = useMemo(() => {
    const built = buildPassSonarData(passes, { side, playerId });
    const orderMap = new Map(zoneOrder.map((zone, index) => [zone, index]));
    return built.slice().sort((a, b) => (orderMap.get(a.zone) ?? 999) - (orderMap.get(b.zone) ?? 999));
  }, [passes, side, playerId, zoneOrder]);
  const renderContent = (isFullscreen = false) => (
    <div className="w-full space-y-3">
      {!isFullscreen && (
        <div>
          <div className="font-semibold text-slate-900">{title}</div>
          {subtitle ? <div className="text-xs text-slate-500">{subtitle}</div> : null}
        </div>
      )}
      <div className={`grid gap-4 ${zones.length > 1 ? 'lg:grid-cols-3' : ''}`}>
        {zones.map((zone) => {
          const size = 220;
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
                    r={80 * ratio}
                    fill="none"
                    stroke="rgba(148,163,184,0.35)"
                    strokeWidth="1"
                  />
                ))}
                {zone.buckets.map((bucket) => {
                  const startAngle = ((bucket.index / zone.buckets.length) * Math.PI * 2) - (Math.PI / zone.buckets.length) - (Math.PI / 2);
                  const endAngle = (((bucket.index + 1) / zone.buckets.length) * Math.PI * 2) - (Math.PI / zone.buckets.length) - (Math.PI / 2);
                  const outerR = 18 + ((bucket.count / maxCount) * 62);
                  const path = describeSector(cx, cy, 10, outerR, startAngle, endAngle);
                  const accuracyLabel = Number.isFinite(bucket.averageAccuracy) ? bucket.averageAccuracy.toFixed(2) : 'NA';
                  return (
                    <path key={bucket.index} d={path} fill={bucket.color} opacity={bucket.count ? 0.92 : 0.15} stroke="rgba(15,23,42,0.35)" strokeWidth="1">
                      <title>{`Direction ${bucket.index + 1}\nPasses: ${bucket.count}\nAvg Accuracy Score: ${accuracyLabel}`}</title>
                    </path>
                  );
                })}
                <text x={cx} y={14} textAnchor="middle" fontSize="10" fill="#475569">Toward Goal</text>
                <text x={size - 8} y={cy + 3} textAnchor="end" fontSize="10" fill="#475569">Right</text>
                <text x={8} y={cy + 3} fontSize="10" fill="#475569">Left</text>
                <text x={cx} y={size - 6} textAnchor="middle" fontSize="10" fill="#475569">Back</text>
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

function TouchMap({ touchEvents, playerId, title = 'Touch Map', homeColor, awayColor, fullscreenEnabled = true, onOpenVideoAt = null }) {
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

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="font-semibold text-slate-900">{title}</div>
        {stats.length ? (
          <PitchViz
            stats={stats}
            homeColor={homeColor}
            awayColor={awayColor}
            colorBy="team"
            showColorControls={false}
            fullscreenEnabled={fullscreenEnabled}
            fullscreenTitle={title}
            onOpenVideoAt={onOpenVideoAt}
          />
        ) : (
          <div className="text-sm text-slate-500">Select a player to view their touches.</div>
        )}
      </CardContent>
    </Card>
  );
}

function ReportFiltersFields({ reportFilters, playerOptions, homeTeam, awayTeam }) {
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

      <MultiSelect
        label="Player"
        placeholder="Any"
        values={reportFilters.playerIds}
        onChange={reportFilters.setPlayerIds}
        options={(playerOptions || []).map((p) => ({ value: p.id, label: (p.team_side === 'away' ? 'Away: ' : 'Home: ') + p.label }))}
      />

      <MultiSelect
        label="Action"
        placeholder="All"
        values={effectiveActionValues}
        onChange={reportFilters.setActionTypes}
        options={actionOptions}
      />

      <MultiSelect
        label="Outcome"
        placeholder="All"
        values={effectiveOutcomeValues}
        onChange={reportFilters.setOutcomes}
        options={outcomeOptions}
      />

      <div className="space-y-1">
        <Label className="text-xs text-slate-600">Start Time</Label>
        <Input
          className="h-8 text-xs"
          inputMode="numeric"
          value={reportFilters.timeMin}
          onChange={(e) => reportFilters.setTimeMin(e.target.value)}
          placeholder="e.g. 0"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs text-slate-600">End Time</Label>
        <Input
          className="h-8 text-xs"
          inputMode="numeric"
          value={reportFilters.timeMax}
          onChange={(e) => reportFilters.setTimeMax(e.target.value)}
          placeholder="e.g. 35"
        />
      </div>
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

        <div
          data-fullscreen-trigger="true"
          className={`relative overflow-hidden ${isFullscreen ? 'w-full mx-auto' : 'mx-auto rounded-xl border border-slate-200'}`}
          style={{
            ...(isFullscreen ? fullscreenPitchStyle(PITCH_W / (PITCH_H * REPORT_PITCH_VERTICAL_SCALE)) : { width: REPORT_PITCH_SCALE }),
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
                : s.shotType; // point|2_point|goal
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
                isAdv ? 'Brought Back Advantage: excluded from scoring stats' : null,
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

        {!isFullscreen && <div className="text-[11px] text-slate-500">
          Shape: circle = 1 point, diamond = 2 point, square = goal. {teamMode === 'both' ? 'Fill = score / miss, outline = team.' : 'Colour = score / miss.'}
        </div>}
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
  const minM = Number(reportFilters?.timeMin);
  const maxM = Number(reportFilters?.timeMax);
  const minS = Number.isFinite(minM) && String(reportFilters?.timeMin ?? '') !== '' ? minM * 60 : null;
  const maxS = Number.isFinite(maxM) && String(reportFilters?.timeMax ?? '') !== '' ? maxM * 60 : null;
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
      const any = playerIds.some((id) => ids.has(id));
      if (!any) return false;
    }
    if (minS != null || maxS != null) {
      const t = getMatchTimeS(s, match, imputed);
      if (!Number.isFinite(t)) return false;
      if (minS != null && t < minS) return false;
      if (maxS != null && t > maxS) return false;
    }
    return true;
  });
}

export {
  REPORT_PITCH_VERTICAL_SCALE,
  REPORT_PITCH_SCALE,
  safeParseJSON,
  toTitleCase,
  formatMMSS,
  formatAddedTime,
  formatMatchClock,
  formatPct,
  sortRows,
  SortableTableHead,
  requestElementFullscreen,
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
  inferPossessionStartSource,
  getPossessionStartZone,
  isGoalkeeperPlayer,
  getKeeperCandidate,
  buildShotAssistCredits,
  buildDefensiveActions,
  buildTouchEvents,
  buildTouchesMap,
  buildPassSonarData,
  DirectionBadge,
  transformDisplayPoint,
  PitchViz,
  AttackChannelPitch,
  PassNetwork,
  PassSonar,
  TouchMap,
  defenceSetStateKey,
  ReportFiltersFields,
  ReportFiltersCard,
  shotSideFromY,
  shotZoneFromDistance,
  ShotMap,
  applyNonTeamReportFilters,
  FullscreenMapShell,
};

