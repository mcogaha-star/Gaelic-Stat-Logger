import React, { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ChevronDown } from 'lucide-react';
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
  isAttackPossession,
  getMatchSectionOffsets,
  getMatchTimeS,
  getProgressiveMeters,
  normalizeFoulType,
  shotOutcomeGroup,
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
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--';
  const offsets = getMatchSectionOffsets(match);
  if (half === 'first') {
    return seconds > offsets.second ? formatAddedTime(offsets.second, seconds) : formatMMSS(seconds);
  }
  if (half === 'second') {
    const fullTime = offsets.second * 2;
    return seconds > fullTime ? formatAddedTime(fullTime, seconds) : formatMMSS(seconds);
  }
  if (half === 'et_first') {
    const etFirstEnd = offsets.et_first + 10 * 60;
    return seconds > etFirstEnd ? formatAddedTime(etFirstEnd, seconds) : formatMMSS(seconds);
  }
  if (half === 'et_second') {
    const etSecondEnd = offsets.et_second + 10 * 60;
    return seconds > etSecondEnd ? formatAddedTime(etSecondEnd, seconds) : formatMMSS(seconds);
  }
  return formatMMSS(seconds);
}

function formatPct(n) {
  if (!Number.isFinite(n)) return 'NA';
  return `${n.toFixed(1)}%`;
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

function ComparisonMetricsCard({ homeTeam, awayTeam, teamMode = 'both', title = 'Metrics', rows = [] }) {
  const showHome = teamMode === 'both' || teamMode === 'home';
  const showAway = teamMode === 'both' || teamMode === 'away';
  const metricCol = '180px';

  return (
    <Card className="w-full lg:w-[48%] lg:max-w-[48%] mr-auto">
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
  // Sort by play order if possible, otherwise keep stable input order.
  const sorted = list.slice().sort((a, b) => {
    const pa = Number(a?.play_id);
    const pb = Number(b?.play_id);
    if (Number.isFinite(pa) && Number.isFinite(pb) && pa !== pb) return pa - pb;
    const ta = Number(a?.normalized_time_s);
    const tb = Number(b?.normalized_time_s);
    if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
    return String(a?.id || '').localeCompare(String(b?.id || ''));
  });

  const prev = new Array(sorted.length).fill(null);
  const next = new Array(sorted.length).fill(null);

  let lastT = null;
  for (let i = 0; i < sorted.length; i += 1) {
    const t = Number(sorted[i]?.normalized_time_s);
    if (Number.isFinite(t)) lastT = Math.max(0, t);
    prev[i] = lastT;
  }

  let nextT = null;
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const t = Number(sorted[i]?.normalized_time_s);
    if (Number.isFinite(t)) nextT = Math.max(0, t);
    next[i] = nextT;
  }

  const out = new Map();
  for (let i = 0; i < sorted.length; i += 1) {
    const s = sorted[i];
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
    counter_attack: 'Counter Attack',
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
  if (rest.length === 1 && ['pass', 'carry', 'kickout', 'turnover', 'throw_in', 'shot', 'foul', 'defensive_contact'].includes(sectionKey)) {
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

function formatExtraValue(v) {
  if (v == null) return 'NA';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NA';
  if (typeof v === 'string') {
    const raw = String(v);
    const trimmed = raw.trim();
    if (!trimmed) return 'NA';
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
  if (t === 'pass') return extra?.pass?.outcome || '';
  if (t === 'carry') return extra?.carry?.outcome || '';
  if (t === 'kickout') return extra?.kickout?.outcome || '';
  if (t === 'turnover') return extra?.turnover?.turnover_type || '';
  if (t === 'throw_in') return extra?.throw_in?.outcome || '';
  if (t === 'foul') return extra?.foul?.foul_type || '';
  if (t === 'defensive_contact') return extra?.defensive_contact?.type || '';
  return '';
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

function inferPossessionStartSource(groupStats, teamSide, previousStat) {
  const acting = (Array.isArray(groupStats) ? groupStats : []).filter((e) => e && e.team_side === teamSide);
  const first = acting[0];
  const firstExtra = safeParseJSON(first?.extra_data || '{}', {});
  const prev = previousStat || null;
  const prevExtra = safeParseJSON(prev?.extra_data || '{}', {});

  if (prev) {
    if (prev?.stat_type === 'turnover') {
      const turnoverType = String(prevExtra?.turnover?.turnover_type || '');
      const recoveredSide = prevExtra?.turnover?.recovered_by?.team_side;
      if (turnoverType && turnoverType !== 'foul' && recoveredSide === teamSide) return 'Turnover Won';
    }
    if (prev?.stat_type === 'shot') {
      const result = String(prevExtra?.shot?.result || '');
      const outcome = String(prevExtra?.shot?.outcome || '');
      if (result === 'retained' && prev?.team_side === teamSide) return 'Shot Retained';
      if (result === 'opposition' && outcome === 'short' && prev?.team_side !== teamSide) return 'Shot Short';
      if (result === 'opposition' && outcome === 'blocked' && prev?.team_side !== teamSide) return 'Shot Blocked';
      if (result === 'opposition' && prev?.team_side !== teamSide) return 'Opposition Shot Won';
    }
    if (prev?.stat_type === 'kickout') {
      const outcome = String(prevExtra?.kickout?.outcome || '');
      const wonSide = prevExtra?.kickout?.won_by?.team_side;
      if ((outcome === 'clean' || outcome === 'break') && wonSide === teamSide) return 'Kickout Won';
    }
    if (prev?.stat_type === 'throw_in') {
      const outcome = String(prevExtra?.throw_in?.outcome || '');
      const wonSide = prevExtra?.throw_in?.won_by?.team_side;
      if ((outcome === 'clean' || outcome === 'break') && wonSide === teamSide) return 'Throw In Won';
    }
    if (prev?.stat_type === 'foul') {
      const foul = extractFoulFromStat(prev);
      const foulOn = foul?.foul_on?.team_side || foul?.foul_on_or_forced_by?.team_side;
      if (foulOn === teamSide) return 'Foul Won';
    }
  }

  if (!first) return 'Open Play';
  if (first?.stat_type === 'kickout') return 'Kickout Won';
  if (first?.stat_type === 'turnover') return 'Turnover Won';
  if (first?.stat_type === 'throw_in') return 'Throw In Won';
  if (first?.stat_type === 'foul') return 'Foul Won';
  if (first?.stat_type === 'shot') {
    const outcome = String(firstExtra?.shot?.outcome || '');
    if (firstExtra?.shot?.result === 'retained') return 'Shot Retained';
    if (firstExtra?.shot?.result === 'opposition' && outcome === 'short') return 'Shot Short';
    if (firstExtra?.shot?.result === 'opposition' && outcome === 'blocked') return 'Shot Blocked';
    if (firstExtra?.shot?.result === 'opposition') return 'Opposition Shot Won';
    return 'Shot Phase';
  }
  if (first?.stat_type === 'pass' && firstExtra?.pass?.deadball) return 'Restart';
  if (first?.stat_type === 'carry' && firstExtra?.carry?.solo_plus_go) return 'Restart Carry';
  if (first?.stat_type === 'pass' || first?.stat_type === 'carry') return 'Open Play';
  return toTitleCase(first?.stat_type || 'Open Play');
}

function selectionKey(sel) {
  if (!sel || sel.kind !== 'player' || !sel.id) return null;
  return `${sel.team_side || 'unknown'}|${sel.id}`;
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
  if (stat.stat_type === 'defensive_contact') return extra?.defensive_contact?.player || null;
  if (stat.stat_type === 'foul') return extra?.foul?.foul_by || null;
  return null;
}

function getCompletedReceiptSelection(stat, extra) {
  if (!stat) return null;
  if (stat.stat_type === 'pass') {
    if (extra?.pass?.outcome !== 'completed') return null;
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
  if (!relevant.length) return 'Set Attack';
  const flags = relevant.map((s) => !!s.counter_attack);
  if (flags.every(Boolean)) return 'Counter Attack';
  if (flags.every((v) => !v)) return 'Set Attack';
  let sawCounter = false;
  for (const flag of flags) {
    if (flag) sawCounter = true;
    if (sawCounter && !flag) return 'Counter -> Set';
  }
  return 'Set Attack';
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
      for (let j = i - 1; j >= 0; j -= 1) {
        const prev = acting[j];
        if (prev?.stat_type !== 'pass') continue;
        const extra = safeParseJSON(prev.extra_data || '{}', {});
        if (extra?.pass?.outcome !== 'completed') continue;
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

function buildTouchesMap(stats) {
  const out = new Map();
  const add = (sel) => {
    const key = selectionKey(sel);
    if (!key) return;
    out.set(key, (out.get(key) || 0) + 1);
  };

  for (const stat of Array.isArray(stats) ? stats : []) {
    if (!stat) continue;
    const extra = safeParseJSON(stat.extra_data || '{}', {});

    if (stat.stat_type === 'pass') {
      if (extra?.pass?.outcome === 'completed') {
        add(extra?.pass?.won_by?.kind === 'player' ? extra.pass.won_by : extra?.pass?.intended_recipient);
      }
      if (extra?.pass?.deadball) {
        add(extra?.pass?.passer);
      }
      continue;
    }

    if (stat.stat_type === 'kickout') {
      if (['clean', 'break'].includes(String(extra?.kickout?.outcome || ''))) add(extra?.kickout?.won_by);
      continue;
    }

    if (stat.stat_type === 'throw_in') {
      if (['clean', 'break'].includes(String(extra?.throw_in?.outcome || ''))) add(extra?.throw_in?.won_by);
      continue;
    }

    if (stat.stat_type === 'turnover' || extra?.turnover) {
      add(extra?.turnover?.recovered_by);
      continue;
    }

    if (stat.stat_type === 'carry') {
      if (extra?.carry?.solo_plus_go) add(extra?.carry?.carrier);
      continue;
    }

    if (stat.stat_type === 'shot') {
      const situation = String(extra?.shot?.situation || '');
      if (['free_ground', 'free_hands', '45', 'penalty'].includes(situation)) {
        add(extra?.shot?.player);
      }
      const result = String(extra?.shot?.result || '');
      if (['retained', 'opposition'].includes(result)) {
        add(extra?.shot?.recovered_by);
      }
    }
  }

  return out;
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

function PitchViz({
  stats,
  homeColor,
  awayColor,
  colorBy,
  showColorControls = true,
  verticalScale = REPORT_PITCH_VERTICAL_SCALE,
  mirrorAwayWhenBoth = true,
  directionLabel = 'Home ->',
}) {
  const defaultActionPalette = {
    shot: '#111827',
    kickout: '#0f766e',
    pass: '#2563eb',
    carry: '#7c3aed',
    turnover: '#dc2626',
    foul: '#d97706',
    throw_in: '#0891b2',
    defensive_contact: '#334155',
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
    if (s.player_number) lines.push(`Player: #${s.player_number}`);
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
    return s.team_side === 'away'
      ? (teamPalette?.away || awayColor || '#ef4444')
      : (teamPalette?.home || homeColor || '#22c55e');
  };

  return (
    <div className="w-full rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div
        className="relative mx-auto"
        style={{
          width: REPORT_PITCH_SCALE,
          aspectRatio: `${PITCH_W} / ${PITCH_H * verticalScale}`,
          backgroundImage: `url(${pitchImg})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        <DirectionBadge label={directionLabel} />
        <svg className="absolute inset-0 w-full h-full" viewBox={`0 0 ${PITCH_W} ${PITCH_H}`} preserveAspectRatio="none">
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
              const strokeW = s.stat_type === 'pass' ? 0.55 : (s.stat_type === 'carry' ? 0.65 : 0.75);
              return (
                <g key={s.id}>
                  <title>{tip}</title>
                  <line
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke={col}
                    strokeWidth={strokeW}
                    opacity="0.95"
                    markerEnd="url(#gstl_arrow)"
                  />
                  {(s.stat_type === 'kickout') && (
                    <>
                      <circle cx={x1} cy={y1} r="1.15" fill={col} />
                      <circle cx={x2} cy={y2} r="1.15" fill={col} />
                    </>
                  )}
                </g>
              );
            }
            return (
              <g key={s.id}>
                <title>{tip}</title>
                <circle cx={x1} cy={y1} r="1.6" fill={col} opacity="0.95" />
              </g>
            );
          })}
        </svg>
      </div>

      {showColorControls && (colorBy === 'action' || colorBy === 'outcome' || colorBy === 'team') && (
        <div className="border-t bg-slate-50 px-3 py-2">
          <div className="text-xs font-semibold text-slate-700">Colors</div>
          <div className="pt-2 grid grid-cols-2 gap-2">
            {(colorBy === 'team'
              ? [
                { key: 'home', label: 'Home' },
                { key: 'away', label: 'Away' },
              ]
              : (colorBy === 'action'
                ? ['shot', 'kickout', 'pass', 'carry', 'turnover', 'foul', 'throw_in', 'defensive_contact'].map((k) => ({ key: k, label: toTitleCase(k) }))
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
}

function AttackChannelPitch({ homeTeam, awayTeam, teamMode, homeColor, awayColor, rows }) {
  const rowFor = (channel) => rows.find((r) => r.channel === channel) || {};
  const channels = ['Left', 'Middle', 'Right'];

  const ArrowRow = ({ row, color }) => {
    const pct = row.pct;
    const count = row.count;
    const label = `${Number.isFinite(pct) ? pct.toFixed(1) : 'NA'}%`;
    const x1 = 14;
    const x2 = 60;
    const textX = 4;
    const y = row.channel === 'Left' ? 18 : row.channel === 'Middle' ? 42.5 : 67;
    return (
      <g>
        <text x={textX} y={y - 2.4} textAnchor="start" fontSize="4.3" fontWeight="700" fill="#0f172a">{label}</text>
        <text x={textX} y={y + 2.8} textAnchor="start" fontSize="3.1" fill="#475569">{row.channel}</text>
        <text x={textX} y={y + 7.2} textAnchor="start" fontSize="2.7" fill="#64748b">
          {Number.isFinite(count) ? `${count} attacks` : 'NA'}
        </text>
        <line x1={x1} y1={y} x2={x2} y2={y} stroke={color} strokeWidth="3" strokeLinecap="round" markerEnd="url(#attack_arrow_right)" />
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
      <div className="space-y-2">
        <div className="text-sm font-medium text-slate-900">{title}</div>
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div
            className="relative mx-auto"
            style={{
              width: REPORT_PITCH_SCALE,
              aspectRatio: `${PITCH_W / 2} / ${PITCH_H * REPORT_PITCH_VERTICAL_SCALE}`,
              backgroundImage: `url(${pitchImg})`,
              backgroundSize: '200% 100%',
              backgroundPosition: 'right center',
            }}
          >
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
    );
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="font-semibold text-slate-900">Attack Entry Channels</div>
        <svg width="0" height="0" className="absolute">
          <defs>
            <marker id="attack_arrow_right" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" stroke="context-stroke" />
            </marker>
          </defs>
        </svg>
        {teamMode === 'both' ? (
          <div className="grid lg:grid-cols-2 gap-4">
            <TeamHalf side="home" title={homeTeam?.name || 'Home'} color={homeColor || '#2563eb'} />
            <TeamHalf side="away" title={awayTeam?.name || 'Away'} color={awayColor || '#ef4444'} />
          </div>
        ) : (
          <TeamHalf
            side={teamMode === 'away' ? 'away' : 'home'}
            title={teamMode === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home')}
            color={teamMode === 'away' ? (awayColor || '#ef4444') : (homeColor || '#2563eb')}
          />
        )}
      </CardContent>
    </Card>
  );
}

function PassNetwork({ passes, side, minCount, teamColor, teamLabel }) {
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

  const maxEdge = edgeList.reduce((m, e) => Math.max(m, e.total), 1);
  const maxTouches = nodes.reduce((m, n) => Math.max(m, n.made + n.received), 1);

  const strokeBase = teamColor || (side === 'away' ? '#ef4444' : '#22c55e');

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const centralityRows = nodes
    .slice()
    .sort((a, b) => (b.weightedDegree - a.weightedDegree) || (b.betweenness - a.betweenness))
    .slice(0, 8);

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="font-semibold text-slate-900">{teamLabel || toTitleCase(side)} Pass Network</div>
        <div className="w-full rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div
            className="relative mx-auto"
            style={{
              width: REPORT_PITCH_SCALE,
              aspectRatio: `${PITCH_W} / ${PITCH_H}`,
              backgroundImage: `url(${pitchImg})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
          >
            <DirectionBadge />
            <svg className="absolute inset-0 w-full h-full" viewBox={`0 0 ${PITCH_W} ${PITCH_H}`} preserveAspectRatio="none">
          {edgeList.map((e) => {
            const a = nodeById.get(e.a);
            const b = nodeById.get(e.b);
            if (!a || !b) return null;
            const w = 0.35 + (e.total / maxEdge) * 2.4;
            const aLabel = (a.number != null ? `#${a.number}` : 'Player') + (a.name ? ` ${a.name}` : '');
            const bLabel = (b.number != null ? `#${b.number}` : 'Player') + (b.name ? ` ${b.name}` : '');
            return (
              <g key={`${e.a}|${e.b}`}>
                <title>{`${aLabel} -> ${bLabel}: ${e.count_ab}\n${bLabel} -> ${aLabel}: ${e.count_ba}\nTotal: ${e.total}`}</title>
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={strokeBase}
                  strokeOpacity="0.5"
                  strokeWidth={w}
                />
              </g>
            );
          })}

          {nodes.map((n) => {
            const touches = n.made + n.received;
            // Radius scaled by touches (clamped).
            const r = Math.min(5.2, 1.8 + (touches / maxTouches) * 3.4);
            const label = (n.number != null ? `#${n.number}` : 'Player') + (n.name ? ` ${n.name}` : '');
            return (
              <g key={n.id}>
                <title>{`${label}\nPasses: ${n.made}\nPasses Received: ${n.received}\nWeighted Degree: ${n.weightedDegree}\nBetweenness: ${n.betweenness.toFixed(2)}`}</title>
                <circle cx={n.x} cy={n.y} r={r} fill={strokeBase} fillOpacity="0.9" stroke="#ffffff" strokeWidth="0.6" />
                {n.number != null && (
                  <text
                    x={n.x}
                    y={n.y}
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
        {centralityRows.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Player</TableHead>
                <TableHead className="text-right">Passes</TableHead>
                <TableHead className="text-right">Received</TableHead>
                <TableHead className="text-right">Weighted Degree</TableHead>
                <TableHead className="text-right">Betweenness</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {centralityRows.map((row) => (
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
        if (allowedActionTypes && !allowedActionTypes.includes(statType)) return false;
        if (effectiveActionValues.length && !effectiveActionValues.includes(statType)) return false;
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


function ShotMap({ shots, mode, setMode, teamMode = 'both', homeColor, awayColor }) {
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
    if (mode === 'all') return true;
    const g = shotOutcomeGroup(s.outcome);
    if (mode === 'scores') return g === 'score';
    if (mode === 'misses') return g !== 'score';
    if (mode === 'blocked_saved') return g === 'blocked' || g === 'saved';
    return true;
  });

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
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

        <div
          className="relative mx-auto rounded-xl border border-slate-200 overflow-hidden"
          style={{
            width: REPORT_PITCH_SCALE,
            aspectRatio: `${PITCH_W} / ${PITCH_H * REPORT_PITCH_VERTICAL_SCALE}`,
            backgroundImage: `url(${pitchImg})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        >
          <DirectionBadge label="Home ->" />
          <svg className="absolute inset-0 w-full h-full" viewBox={`0 0 ${PITCH_W} ${PITCH_H}`} preserveAspectRatio="none">
            {visible.map((s) => {
              const point = transformDisplayPoint(s.x, s.y, s.team_side, true);
              if (!point) return null;
              const x = point.x;
              const y = point.y;
              const g = shotOutcomeGroup(s.outcome);
              const outcomeColor = colors[g] || colors.other;
              const teamColor = s.team_side === 'away' ? (awayColor || '#ef4444') : (homeColor || '#2563eb');
              const fillColor = outcomeColor;
              const strokeColor = teamMode === 'both' ? teamColor : '#ffffff';
              const shape = s.shotType; // point|2_point|goal
              const size = 1.87;
              const blackStrokeWidth = teamMode === 'both' ? 1 : 0.425;
              const teamStrokeWidth = teamMode === 'both' ? 0.95 : 0.6;
              const tip = [
                `Player: ${s.playerLabel || 'NA'}`,
                `Time: ${s.timeLabel || 'NA'}`,
                `Shot Type: ${toTitleCase(shape)}`,
                `Situation: ${toTitleCase(s.situation)}`,
                `Pressure: ${toTitleCase(s.pressure)}`,
                `Outcome: ${toTitleCase(s.outcome)}`,
                Number.isFinite(s.distance) ? `Distance: ${s.distance.toFixed(1)}` : null,
                s.possessionLabel ? `Possession: ${s.possessionLabel}` : null,
              ].filter(Boolean).join('\n');

              if (shape === 'goal') {
                return (
                  <g key={s.id}>
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
                  <g key={s.id}>
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
                <g key={s.id}>
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

        <div className="text-[11px] text-slate-500">
          Shape: circle = 1 point, diamond = 2 point, square = goal. {teamMode === 'both' ? 'Fill = score / miss, outline = team.' : 'Colour = score / miss.'}
        </div>
      </CardContent>
    </Card>
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
    if (actionTypes.length && !actionTypes.includes(String(s.stat_type || ''))) return false;
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
  ComparisonMetricsCard,
  teamRowTint,
  computeImputedNormalizedTimes,
  formatTeamLabel,
  humanizeKey,
  presentablePathLabel,
  formatExtraValue,
  flattenExtra,
  deriveOutcome,
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
  buildTouchesMap,
  DirectionBadge,
  transformDisplayPoint,
  PitchViz,
  AttackChannelPitch,
  PassNetwork,
  ReportFiltersFields,
  ReportFiltersCard,
  shotSideFromY,
  shotZoneFromDistance,
  ShotMap,
  applyNonTeamReportFilters,
};
