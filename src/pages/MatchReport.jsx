import React, { useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, BarChart3, ChevronDown } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { ChartContainer, ChartTooltipContent } from '@/components/ui/chart';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { createPageUrl } from '@/utils';
import pitchImg from '@/assets/pitch.png';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';

const PITCH_W = 145;
const PITCH_H = 85;
const OPP_45_X = PITCH_W - 45; // 100

const db = globalThis.__B44_DB__ || {
  entities: new Proxy({}, {
    get: () => ({
      filter: async () => [],
      get: async () => null,
    }),
  }),
};

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

function formatPct(n) {
  if (!Number.isFinite(n)) return 'NA';
  return `${n.toFixed(1)}%`;
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
    if (Number.isFinite(t)) lastT = t;
    prev[i] = lastT;
  }

  let nextT = null;
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const t = Number(sorted[i]?.normalized_time_s);
    if (Number.isFinite(t)) nextT = t;
    next[i] = nextT;
  }

  const out = new Map();
  for (let i = 0; i < sorted.length; i += 1) {
    const s = sorted[i];
    const id = s?.id;
    if (!id) continue;
    const t = Number(s?.normalized_time_s);
    if (Number.isFinite(t)) {
      out.set(id, t);
      continue;
    }
    const a = prev[i];
    const b = next[i];
    if (Number.isFinite(a) && Number.isFinite(b)) out.set(id, (a + b) / 2);
    else if (Number.isFinite(a)) out.set(id, a);
    else if (Number.isFinite(b)) out.set(id, b);
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
  const right = rest.map(humanizeKey).join(' ');
  return `${toTitleCase(section)} ${right}`.trim();
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

function statHasEnteredOpp45(stat) {
  // Normalized coords are stored so that the acting team is always L->R.
  const sx = Number(stat?.x_position);
  const ex = Number(stat?.end_x_position);
  return (Number.isFinite(sx) && sx >= OPP_45_X) || (Number.isFinite(ex) && ex >= OPP_45_X);
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
  const list = Array.isArray(evs) ? evs : [];
  for (const s of list) {
    if (!s || s.team_side !== teamSide) continue;
    if (statHasEnteredOpp45(s)) return true;
  }
  return false;
}

function derivePossessionOutcome(evs, teamSide) {
  const list = Array.isArray(evs) ? evs : [];
  const acting = list.filter((e) => e && e.team_side === teamSide);
  if (!acting.length) return 'Other';

  const hasScore = acting.some((e) => {
    if (e.stat_type !== 'shot') return false;
    const ex = safeParseJSON(e.extra_data || '{}', {});
    return shotOutcomeGroup(ex?.shot?.outcome) === 'score';
  });
  const hasShot = acting.some((e) => e.stat_type === 'shot');

  const last = acting[acting.length - 1];
  const lastExtra = safeParseJSON(last?.extra_data || '{}', {});
  const lastOutcome = String(deriveOutcome(last, lastExtra) || '');

  if (hasScore) return 'Score';
  if (hasShot) return 'Missed Shot';
  if (last?.stat_type === 'period_end') return 'Half End';
  if (last?.stat_type === 'turnover' || lastOutcome === 'turnover') return 'Turnover';
  if (last?.stat_type === 'foul' || lastOutcome === 'foul') return 'Foul Won';
  if (lastOutcome.includes('sideline')) return 'Sideline';
  if (lastOutcome.includes('45')) return '45';
  if (lastOutcome.includes('goal kick') || lastOutcome.includes('goal_kick')) return 'Goal Kick';
  return 'Other';
}

function PitchViz({ stats, homeColor, awayColor, colorBy, showColorControls = true }) {
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
        className="relative w-full"
        style={{
          aspectRatio: `${PITCH_W} / ${PITCH_H}`,
          backgroundImage: `url(${pitchImg})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
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
            const x1 = Number(s.x_position);
            const y1 = Number(s.y_position);
            const x2 = Number(s.end_x_position);
            const y2 = Number(s.end_y_position);

            if (!Number.isFinite(x1) || !Number.isFinite(y1)) return null;

            // Lines for directional actions with end coords; dots otherwise.
            const hasEnd = Number.isFinite(x2) && Number.isFinite(y2);
            const isLineAction = ['pass', 'carry', 'kickout', 'throw_in'].includes(String(s.stat_type || ''));
            if (isLineAction && hasEnd) {
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
                  {(s.stat_type === 'kickout' || s.stat_type === 'throw_in') && (
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

function PassNetwork({ passes, side, minCount, teamColor }) {
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

  const nodes = Array.from(nodeIds).map((id) => {
    const p = pos.get(id) || { sumX: 0, sumY: 0, n: 0 };
    const n = Math.max(p.n, 1);
    return {
      id,
      x: p.n ? (p.sumX / n) : 0,
      y: p.n ? (p.sumY / n) : 0,
      made: passesMade.get(id) || 0,
      received: passesReceived.get(id) || 0,
      number: meta.get(id)?.number ?? null,
      name: meta.get(id)?.name || '',
    };
  });

  const maxEdge = edgeList.reduce((m, e) => Math.max(m, e.total), 1);
  const maxTouches = nodes.reduce((m, n) => Math.max(m, n.made + n.received), 1);

  const strokeBase = teamColor || (side === 'away' ? '#ef4444' : '#22c55e');

  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  return (
    <div className="w-full rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div
        className="relative w-full"
        style={{
          aspectRatio: `${PITCH_W} / ${PITCH_H}`,
          backgroundImage: `url(${pitchImg})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
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
                <title>{`${label}\nPasses: ${n.made}\nPasses Received: ${n.received}`}</title>
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
  );
}

function ReportFiltersCard({ reportFilters, playerOptions, homeTeam, awayTeam }) {
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="font-semibold text-slate-900">Filters</div>

        {/* Keep the 5 core filters on one line on desktop to reduce vertical scroll. */}
        <div className="grid md:grid-cols-5 gap-3">
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

          <div className="space-y-1">
            <Label className="text-xs text-slate-600">Start Time (min)</Label>
            <Input
              className="h-8 text-xs"
              inputMode="numeric"
              value={reportFilters.timeMin}
              onChange={(e) => reportFilters.setTimeMin(e.target.value)}
              placeholder="e.g. 0"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-slate-600">End Time (min)</Label>
            <Input
              className="h-8 text-xs"
              inputMode="numeric"
              value={reportFilters.timeMax}
              onChange={(e) => reportFilters.setTimeMax(e.target.value)}
              placeholder="e.g. 35"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function calcDistanceToGoal(x, y) {
  const gx = PITCH_W;
  const gy = PITCH_H / 2;
  const dx = gx - Number(x);
  const dy = gy - Number(y);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return NaN;
  return Math.sqrt(dx * dx + dy * dy);
}

function calcAngleToGoal(x, y) {
  // Approximate goal mouth as 6.5m wide in this 145x85 plane (meters).
  const gx = PITCH_W;
  const gy = PITCH_H / 2;
  const halfW = 3.25;
  const p1 = { x: gx, y: gy - halfW };
  const p2 = { x: gx, y: gy + halfW };
  const vx1 = p1.x - Number(x);
  const vy1 = p1.y - Number(y);
  const vx2 = p2.x - Number(x);
  const vy2 = p2.y - Number(y);
  if (![vx1, vy1, vx2, vy2].every(Number.isFinite)) return NaN;
  const a1 = Math.atan2(vy1, vx1);
  const a2 = Math.atan2(vy2, vx2);
  let ang = Math.abs(a2 - a1);
  if (ang > Math.PI) ang = 2 * Math.PI - ang;
  return (ang * 180) / Math.PI;
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

function shotOutcomeGroup(outcome) {
  const o = String(outcome || '');
  if (['goal', 'point', '2_point'].includes(o)) return 'score';
  if (o === 'wide') return 'wide';
  if (o === 'short') return 'short';
  if (o === 'saved') return 'saved';
  if (o === 'blocked') return 'blocked';
  if (o === 'post') return 'post';
  return 'other';
}

function shotPointsForOutcome(outcome) {
  if (outcome === 'goal') return 3;
  if (outcome === '2_point') return 2;
  if (outcome === 'point') return 1;
  return 0;
}

function ShotMap({ shots, mode, setMode }) {
  const list = Array.isArray(shots) ? shots : [];

  const colors = {
    score: '#2563eb',
    wide: '#334155',
    short: '#64748b',
    saved: '#f59e0b',
    blocked: '#dc2626',
    post: '#7c3aed',
    other: '#111827',
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
          className="relative w-full rounded-xl border border-slate-200 overflow-hidden"
          style={{
            aspectRatio: `${PITCH_W} / ${PITCH_H}`,
            backgroundImage: `url(${pitchImg})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        >
          <svg className="absolute inset-0 w-full h-full" viewBox={`0 0 ${PITCH_W} ${PITCH_H}`} preserveAspectRatio="none">
            {visible.map((s) => {
              const x = Number(s.x);
              const y = Number(s.y);
              if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
              const g = shotOutcomeGroup(s.outcome);
              const col = colors[g] || colors.other;
              const shape = s.shotType; // point|2_point|goal
              const size = 2.2;
              const tip = [
                `Player: ${s.playerLabel || 'NA'}`,
                `Time: ${s.timeLabel || 'NA'}`,
                `Shot Type: ${toTitleCase(shape)}`,
                `Situation: ${toTitleCase(s.situation)}`,
                `Pressure: ${toTitleCase(s.pressure)}`,
                `Outcome: ${toTitleCase(s.outcome)}`,
                Number.isFinite(s.distance) ? `Distance: ${s.distance.toFixed(1)}` : null,
                s.attackId ? `Attack: ${s.attackId}` : null,
              ].filter(Boolean).join('\n');

              if (shape === 'goal') {
                return (
                  <rect key={s.id} x={x - size} y={y - size} width={size * 2} height={size * 2} fill={col} opacity="0.9">
                    <title>{tip}</title>
                  </rect>
                );
              }
              if (shape === '2_point') {
                return (
                  <rect
                    key={s.id}
                    x={x - size}
                    y={y - size}
                    width={size * 2}
                    height={size * 2}
                    fill={col}
                    opacity="0.9"
                    transform={`rotate(45 ${x} ${y})`}
                  >
                    <title>{tip}</title>
                  </rect>
                );
              }
              return (
                <circle key={s.id} cx={x} cy={y} r={size} fill={col} opacity="0.9">
                  <title>{tip}</title>
                </circle>
              );
            })}
          </svg>
        </div>

        <div className="text-[11px] text-slate-500">
          Shape: circle = 1 point, diamond = 2 point, square = goal. Colour: outcome group.
        </div>
      </CardContent>
    </Card>
  );
}

function ScoringTab({ stats, homeTeam, awayTeam, playerOptions, reportFilters }) {
  const [shotType, setShotType] = useState([]); // [] all
  const [situation, setSituation] = useState([]); // [] all
  const [pressure, setPressure] = useState([]); // [] all
  const [outcome, setOutcome] = useState([]); // [] all
  const [zone, setZone] = useState([]); // [] all
  const [shotMapMode, setShotMapMode] = useState('all');

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
      const playerLabel = (() => {
        if (playerSel?.kind === 'player') {
          const n = playerSel.number ? `#${playerSel.number}` : '';
          const name = playerSel.name ? String(playerSel.name) : '';
          return `${n} ${name}`.trim() || 'Player';
        }
        if (s.player_number) return `#${s.player_number}`;
        return 'NA';
      })();

      const tNorm = Number(s.normalized_time_s);
      const timeLabel = Number.isFinite(tNorm) ? formatMMSS(tNorm) : 'NA';

      const attackId = (s.possession_team_side && Number.isFinite(Number(s.possession_id)))
        ? `${s.possession_team_side}-${Number(s.possession_id)}`
        : '';

      out.push({
        id: s.id,
        raw: s,
        extra,
        team_side: s.team_side === 'away' ? 'away' : 'home',
        half: s.half,
        possession_id: s.possession_id,
        attackId,
        x,
        y,
        shotType: stNorm || 'point',
        situation: sit,
        method: String(sh.method || ''),
        pressure: pr,
        outcome: o,
        distance: dist,
        angle: calcAngleToGoal(x, y),
        zone: z,
        side: shotSideFromY(y),
        isScore: shotOutcomeGroup(o) === 'score',
        points: shotPointsForOutcome(o),
        isFromPlay: sit === 'play',
        isPlacedBall: sit && sit !== 'play',
        playerLabel,
        playerId: playerSel?.id || null,
        timeLabel,
      });
    }
    return out;
  }, [stats]);

  const filteredShots = useMemo(() => {
    return shots.filter((s) => {
      if (shotType.length && !shotType.includes(s.shotType)) return false;
      if (situation.length && !situation.includes(s.situation)) return false;
      if (pressure.length && !pressure.includes(s.pressure)) return false;
      if (outcome.length && !outcome.includes(s.outcome)) return false;
      if (zone.length && !zone.includes(s.zone)) return false;
      return true;
    });
  }, [shots, shotType, situation, pressure, outcome, zone]);

  const kpis = useMemo(() => {
    const sh = filteredShots;
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

    const placed = sh.filter((s) => s.isPlacedBall);
    const placedScores = placed.filter((s) => s.isScore).length;
    const placedConv = placed.length ? (placedScores / placed.length) * 100 : NaN;

    const high = sh.filter((s) => String(s.pressure) === 'high');
    const highScores = high.filter((s) => s.isScore).length;
    const highConv = high.length ? (highScores / high.length) * 100 : NaN;

    return { shotsN, scoresN, conv, pps, avgDist, playConv, placedConv, highConv };
  }, [filteredShots]);

  const shotTypeSummary = useMemo(() => {
    const order = ['point', '2_point', 'goal'];
    const label = { point: '1 Point', '2_point': '2 Point', goal: 'Goal' };
    const m = new Map();
    for (const s of filteredShots) {
      const t = String(s.shotType || 'point');
      const cur = m.get(t) || { type: t, attempts: 0, scores: 0, points: 0 };
      cur.attempts += 1;
      if (s.isScore) cur.scores += 1;
      cur.points += s.points || 0;
      m.set(t, cur);
    }
    const rows = Array.from(m.values()).map((r) => ({
      ...r,
      label: label[r.type] || toTitleCase(r.type),
      conv: r.attempts ? (r.scores / r.attempts) * 100 : NaN,
      pps: r.attempts ? r.points / r.attempts : NaN,
    }));
    rows.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type));
    return rows;
  }, [filteredShots]);

  const pressureSummary = useMemo(() => {
    const levels = ['low', 'medium', 'high'];
    return levels.map((p) => {
      const list = filteredShots.filter((s) => String(s.pressure) === p);
      const attempts = list.length;
      const scores = list.filter((s) => s.isScore).length;
      const points = list.reduce((a, s) => a + (s.points || 0), 0);
      return {
        pressure: toTitleCase(p),
        attempts,
        scores,
        conv: attempts ? (scores / attempts) * 100 : NaN,
        pps: attempts ? points / attempts : NaN,
      };
    });
  }, [filteredShots]);

  const outcomeSummary = useMemo(() => {
    const groups = ['score', 'wide', 'short', 'saved', 'blocked', 'post'];
    return groups.map((g) => ({
      key: g,
      label: toTitleCase(g),
      count: filteredShots.filter((s) => shotOutcomeGroup(s.outcome) === g).length,
    }));
  }, [filteredShots]);

  const situationSummary = useMemo(() => {
    const cats = ['play', 'free_ground', 'free_hands', '45', 'penalty', 'mark'];
    return cats.map((c) => {
      const list = filteredShots.filter((s) => String(s.situation) === c);
      const attempts = list.length;
      const scores = list.filter((s) => s.isScore).length;
      const points = list.reduce((a, s) => a + (s.points || 0), 0);
      return {
        situation: toTitleCase(c),
        attempts,
        conv: attempts ? (scores / attempts) * 100 : NaN,
        pps: attempts ? points / attempts : NaN,
      };
    });
  }, [filteredShots]);

  const playerSummary = useMemo(() => {
    const rows = new Map();
    for (const s of filteredShots) {
      const key = s.playerId || s.playerLabel || 'NA';
      const cur = rows.get(key) || {
        key,
        player: s.playerLabel || 'NA',
        shots: 0,
        scores: 0,
        points: 0,
        distSum: 0,
        distN: 0,
        highShots: 0,
        highScores: 0,
        playShots: 0,
        placedShots: 0,
      };
      cur.shots += 1;
      if (s.isScore) cur.scores += 1;
      cur.points += s.points || 0;
      if (Number.isFinite(s.distance)) { cur.distSum += s.distance; cur.distN += 1; }
      if (String(s.pressure) === 'high') {
        cur.highShots += 1;
        if (s.isScore) cur.highScores += 1;
      }
      if (s.isFromPlay) cur.playShots += 1;
      if (s.isPlacedBall) cur.placedShots += 1;
      rows.set(key, cur);
    }
    const out = Array.from(rows.values()).map((r) => ({
      ...r,
      conv: r.shots ? (r.scores / r.shots) * 100 : NaN,
      pps: r.shots ? r.points / r.shots : NaN,
      avgDist: r.distN ? r.distSum / r.distN : NaN,
      highConv: r.highShots ? (r.highScores / r.highShots) * 100 : NaN,
    }));
    out.sort((a, b) => b.points - a.points);
    return out;
  }, [filteredShots]);

  const pieColors = {
    score: '#2563eb',
    wide: '#334155',
    short: '#64748b',
    saved: '#f59e0b',
    blocked: '#dc2626',
    post: '#7c3aed',
  };

  return (
    <div className="grid lg:grid-cols-[340px_1fr] gap-4">
      <div className="space-y-4">
        <ReportFiltersCard reportFilters={reportFilters} playerOptions={playerOptions} homeTeam={homeTeam} awayTeam={awayTeam} />

        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="font-semibold text-slate-900">Local Filters</div>
            <MultiSelect
              label="Shot Type"
              placeholder="All"
              values={shotType}
              onChange={setShotType}
              options={[
                { value: 'point', label: '1 Point' },
                { value: '2_point', label: '2 Point' },
                { value: 'goal', label: 'Goal' },
              ]}
            />
            <MultiSelect
              label="Situation"
              placeholder="All"
              values={situation}
              onChange={setSituation}
              options={['play', 'free_ground', 'free_hands', '45', 'penalty', 'mark'].map((v) => ({ value: v, label: toTitleCase(v) }))}
            />
            <MultiSelect
              label="Pressure"
              placeholder="All"
              values={pressure}
              onChange={setPressure}
              options={['low', 'medium', 'high'].map((v) => ({ value: v, label: toTitleCase(v) }))}
            />
            <MultiSelect
              label="Outcome"
              placeholder="All"
              values={outcome}
              onChange={setOutcome}
              options={['goal', 'point', '2_point', 'wide', 'short', 'post', 'saved', 'blocked'].map((v) => ({ value: v, label: toTitleCase(v) }))}
            />
            <MultiSelect
              label="Shot Zone"
              placeholder="All"
              values={zone}
              onChange={setZone}
              options={[
                { value: 'inside_21', label: 'Inside 21' },
                { value: '21_45', label: '21-45' },
                { value: '45_65', label: '45-65' },
                { value: '65_plus', label: '65+' },
              ]}
            />
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: 'Shots', value: kpis.shotsN },
            { label: 'Scores', value: kpis.scoresN },
            { label: 'Shot Conversion %', value: formatPct(kpis.conv) },
            { label: 'Points Per Shot', value: Number.isFinite(kpis.pps) ? kpis.pps.toFixed(2) : 'NA' },
            { label: 'Average Shot Distance', value: Number.isFinite(kpis.avgDist) ? kpis.avgDist.toFixed(1) : 'NA' },
            { label: 'Play-Shot Conversion %', value: formatPct(kpis.playConv) },
            { label: 'Placed-Ball Conversion %', value: formatPct(kpis.placedConv) },
            { label: 'High-Pressure Conversion %', value: formatPct(kpis.highConv) },
          ].map((k) => (
            <Card key={k.label}>
              <CardContent className="p-3">
                <div className="text-[11px] text-slate-600">{k.label}</div>
                <div className="text-lg font-semibold text-slate-900 tabular-nums">{k.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        {filteredShots.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-sm text-slate-600 text-center">
              No shots available for current filters.
            </CardContent>
          </Card>
        ) : (
          <>
            <ShotMap shots={filteredShots} mode={shotMapMode} setMode={setShotMapMode} />

            <div className="grid lg:grid-cols-2 gap-4">
              <Card>
                <CardContent className="p-4 space-y-3">
                  <div className="font-semibold text-slate-900">Shot Type Breakdown</div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Type</TableHead>
                        <TableHead className="text-right">Attempts</TableHead>
                        <TableHead className="text-right">Scores</TableHead>
                        <TableHead className="text-right">Conv %</TableHead>
                        <TableHead className="text-right">Pts/Shot</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {shotTypeSummary.map((r) => (
                        <TableRow key={r.type}>
                          <TableCell className="font-medium">{r.label}</TableCell>
                          <TableCell className="text-right tabular-nums">{r.attempts}</TableCell>
                          <TableCell className="text-right tabular-nums">{r.scores}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatPct(r.conv)}</TableCell>
                          <TableCell className="text-right tabular-nums">{Number.isFinite(r.pps) ? r.pps.toFixed(2) : 'NA'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4 space-y-3">
                  <div className="font-semibold text-slate-900">Pressure vs Conversion</div>
                  <ChartContainer
                    id="pressure-conv"
                    className="h-[220px] w-full"
                    config={{
                      attempts: { label: 'Attempts', color: '#94a3b8' },
                    }}
                  >
                    <BarChart data={pressureSummary} margin={{ top: 10, right: 12, left: 0, bottom: 6 }}>
                      <CartesianGrid vertical={false} />
                      <XAxis dataKey="pressure" className="text-xs" />
                      <YAxis allowDecimals={false} className="text-xs" />
                      <Tooltip
                        content={
                          <ChartTooltipContent
                            formatter={(value, name, item) => {
                              const row = item?.payload;
                              if (!row) return null;
                              return (
                                <div className="text-xs space-y-1">
                                  <div>Attempts: <span className="font-mono">{row.attempts}</span></div>
                                  <div>Scores: <span className="font-mono">{row.scores}</span></div>
                                  <div>Conversion: <span className="font-mono">{formatPct(row.conv)}</span></div>
                                  <div>Pts/Shot: <span className="font-mono">{Number.isFinite(row.pps) ? row.pps.toFixed(2) : 'NA'}</span></div>
                                </div>
                              );
                            }}
                            labelFormatter={(_, payload) => payload?.[0]?.payload?.pressure || 'Pressure'}
                          />
                        }
                      />
                      <Bar dataKey="attempts" fill="var(--color-attempts)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ChartContainer>
                </CardContent>
              </Card>
            </div>

            <div className="grid lg:grid-cols-2 gap-4">
              <Card>
                <CardContent className="p-4 space-y-3">
                  <div className="font-semibold text-slate-900">Shot Outcome Breakdown</div>
                  <ChartContainer
                    id="shot-outcomes"
                    className="h-[240px] w-full"
                    config={{
                      score: { label: 'Score', color: pieColors.score },
                      wide: { label: 'Wide', color: pieColors.wide },
                      short: { label: 'Short', color: pieColors.short },
                      saved: { label: 'Saved', color: pieColors.saved },
                      blocked: { label: 'Blocked', color: pieColors.blocked },
                      post: { label: 'Post', color: pieColors.post },
                    }}
                  >
                    <PieChart>
                      <Tooltip content={<ChartTooltipContent />} />
                      <Legend />
                      <Pie data={outcomeSummary} dataKey="count" nameKey="label" cx="50%" cy="50%" outerRadius={85}>
                        {outcomeSummary.map((r) => (
                          <Cell key={r.key} fill={pieColors[r.key] || '#111827'} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ChartContainer>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4 space-y-3">
                  <div className="font-semibold text-slate-900">Shot Situation Breakdown</div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Situation</TableHead>
                        <TableHead className="text-right">Attempts</TableHead>
                        <TableHead className="text-right">Conv %</TableHead>
                        <TableHead className="text-right">Pts/Shot</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {situationSummary.map((r) => (
                        <TableRow key={r.situation}>
                          <TableCell className="font-medium">{r.situation}</TableCell>
                          <TableCell className="text-right tabular-nums">{r.attempts}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatPct(r.conv)}</TableCell>
                          <TableCell className="text-right tabular-nums">{Number.isFinite(r.pps) ? r.pps.toFixed(2) : 'NA'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="font-semibold text-slate-900">Player Shooting</div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Player</TableHead>
                      <TableHead className="text-right">Shots</TableHead>
                      <TableHead className="text-right">Scores</TableHead>
                      <TableHead className="text-right">Conv %</TableHead>
                      <TableHead className="text-right">Points</TableHead>
                      <TableHead className="text-right">Pts/Shot</TableHead>
                      <TableHead className="text-right">Avg Dist</TableHead>
                      <TableHead className="text-right">High Shots</TableHead>
                      <TableHead className="text-right">High Conv %</TableHead>
                      <TableHead className="text-right">Play Shots</TableHead>
                      <TableHead className="text-right">Placed Shots</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {playerSummary.map((r) => (
                      <TableRow key={r.key}>
                        <TableCell className="font-medium">{r.player}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.shots}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.scores}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatPct(r.conv)}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.points}</TableCell>
                        <TableCell className="text-right tabular-nums">{Number.isFinite(r.pps) ? r.pps.toFixed(2) : 'NA'}</TableCell>
                        <TableCell className="text-right tabular-nums">{Number.isFinite(r.avgDist) ? r.avgDist.toFixed(1) : 'NA'}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.highShots}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatPct(r.highConv)}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.playShots}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.placedShots}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function PossessionsTab({ stats, homeTeam, awayTeam, playerOptions, reportFilters }) {
  const base = useMemo(() => applyNonTeamReportFilters(stats, reportFilters), [stats, reportFilters]);
  const imputed = reportFilters?.imputedTimeById;

  const possessions = useMemo(() => {
    const groups = groupByPossession(base);

    const timeFor = (s) => {
      const t = Number(s?.normalized_time_s);
      if (Number.isFinite(t)) return Math.max(0, t);
      const it = imputed && typeof imputed.get === 'function' ? Number(imputed.get(s?.id)) : NaN;
      return Number.isFinite(it) ? Math.max(0, it) : NaN;
    };

    const sortKey = (s) => {
      const t = timeFor(s);
      if (Number.isFinite(t)) return { k: 0, v: t };
      const p = Number(s?.play_id);
      if (Number.isFinite(p)) return { k: 1, v: p };
      return { k: 9, v: 0 };
    };

    const out = [];
    for (const [key, evs0] of groups.entries()) {
      const [teamSide, pidStr] = String(key).split('-');
      const pid = Number(pidStr);
      if (teamSide !== 'home' && teamSide !== 'away') continue;
      if (!Number.isFinite(pid)) continue;

      const evs = (Array.isArray(evs0) ? evs0 : []).slice().sort((a, b) => {
        const ka = sortKey(a);
        const kb = sortKey(b);
        if (ka.k !== kb.k) return ka.k - kb.k;
        if (ka.v !== kb.v) return ka.v - kb.v;
        return String(a?.id || '').localeCompare(String(b?.id || ''));
      });

      const acting = evs.filter((e) => e && e.team_side === teamSide);
      if (!acting.length) continue;

      const shotOutcomes = acting
        .filter((e) => e.stat_type === 'shot')
        .map((e) => String(safeParseJSON(e.extra_data || '{}', {})?.shot?.outcome || ''))
        .filter(Boolean);

      const scoreType = (() => {
        if (shotOutcomes.includes('goal')) return 'Goal';
        if (shotOutcomes.includes('2_point')) return '2 Point';
        if (shotOutcomes.includes('point')) return '1 Point';
        return '';
      })();

      const hasShot = shotOutcomes.length > 0;
      const last = acting[acting.length - 1];
      const lastExtra = safeParseJSON(last?.extra_data || '{}', {});
      const lastOutcome = String(deriveOutcome(last, lastExtra) || '');

      const outcome = (() => {
        if (scoreType) return scoreType;
        if (hasShot) return 'Miss';
        if (last?.stat_type === 'period_end') return 'Half End';
        if (last?.stat_type === 'turnover' || lastOutcome === 'turnover') return 'Turnover';
        return 'Turnover';
      })();

      const times = evs.map(timeFor).filter(Number.isFinite);
      const startTime = times.length ? Math.min(...times) : NaN;
      const endTime = times.length ? Math.max(...times) : NaN;
      const duration = Number.isFinite(startTime) && Number.isFinite(endTime) ? Math.max(0, endTime - startTime) : NaN;

      const points = acting.reduce((a, e) => {
        if (e.stat_type !== 'shot') return a;
        const ex = safeParseJSON(e.extra_data || '{}', {});
        return a + shotPointsForOutcome(ex?.shot?.outcome);
      }, 0);

      const startSource = (() => {
        const f = acting[0];
        const ex = safeParseJSON(f?.extra_data || '{}', {});
        if (f?.stat_type === 'kickout') return 'Kickout Won';
        if (f?.stat_type === 'turnover') return 'Turnover Won';
        if (f?.stat_type === 'throw_in') return 'Throw In Won';
        if (f?.stat_type === 'foul') return 'Foul Won';
        if (ex?.pass?.deadball) return 'Restart';
        return 'Other';
      })();

      const isAttack = possessionHasOpp45Entry(evs, teamSide);
      const passes = acting.filter((e) => e.stat_type === 'pass').length;
      const shots = acting.filter((e) => e.stat_type === 'shot').length;
      const counter = acting.some((e) => !!e.counter_attack);

      out.push({
        key,
        teamSide,
        possessionId: pid,
        half: acting[0]?.half || '',
        startTime,
        endTime,
        duration,
        startSource,
        outcome,
        isAttack,
        passes,
        shots,
        points,
        counter,
      });
    }

    out.sort((a, b) => {
      if (Number.isFinite(a.startTime) && Number.isFinite(b.startTime) && a.startTime !== b.startTime) return a.startTime - b.startTime;
      return String(a.key).localeCompare(String(b.key));
    });
    return out;
  }, [base, imputed]);

  const attacks = useMemo(() => possessions.filter((p) => p.isAttack), [possessions]);

  const kpis = useMemo(() => {
    const possN = possessions.length;
    const attN = attacks.length;
    const totalPts = possessions.reduce((a, p) => a + (p.points || 0), 0);
    const ppp = possN ? totalPts / possN : NaN;
    const ds = possessions.map((p) => p.duration).filter(Number.isFinite);
    const avgDur = ds.length ? ds.reduce((a, b) => a + b, 0) / ds.length : NaN;
    const possToAttack = possN ? (attN / possN) * 100 : NaN;
    const possToShot = possN ? (possessions.filter((p) => p.shots > 0).length / possN) * 100 : NaN;
    const attToShot = attN ? (attacks.filter((p) => p.shots > 0).length / attN) * 100 : NaN;
    const passesPerPoss = possN ? possessions.reduce((a, p) => a + (p.passes || 0), 0) / possN : NaN;
    const scoringPoss = possN ? (possessions.filter((p) => ['Goal', '2 Point', '1 Point'].includes(p.outcome)).length / possN) * 100 : NaN;
    const counterPoss = possN ? (possessions.filter((p) => p.counter).length / possN) * 100 : NaN;
    return { possN, attN, ppp, avgDur, possToAttack, possToShot, attToShot, passesPerPoss, scoringPoss, counterPoss };
  }, [possessions, attacks]);

  const byTeam = (rows) => {
    const out = {
      home: { Goal: 0, '2 Point': 0, '1 Point': 0, Miss: 0, Turnover: 0, 'Half End': 0 },
      away: { Goal: 0, '2 Point': 0, '1 Point': 0, Miss: 0, Turnover: 0, 'Half End': 0 },
    };
    for (const r of rows) {
      const side = r.teamSide;
      if (!out[side]) continue;
      const k = String(r.outcome || 'Turnover');
      if (out[side][k] == null) out[side][k] = 0;
      out[side][k] += 1;
    }
    return [
      { team: homeTeam?.name || 'Home', side: 'home', ...out.home },
      { team: awayTeam?.name || 'Away', side: 'away', ...out.away },
    ];
  };

  const possessionOutcomeData = useMemo(() => byTeam(possessions), [possessions, homeTeam, awayTeam]);
  const attackOutcomeData = useMemo(() => byTeam(attacks), [attacks, homeTeam, awayTeam]);

  return (
    <div className="grid lg:grid-cols-[340px_1fr] gap-4">
      <div className="space-y-4">
        <ReportFiltersCard reportFilters={reportFilters} playerOptions={playerOptions} homeTeam={homeTeam} awayTeam={awayTeam} />
      </div>

      <div className="space-y-4">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: 'Possessions', value: kpis.possN },
            { label: 'Attacks', value: kpis.attN },
            { label: 'PPP', value: Number.isFinite(kpis.ppp) ? kpis.ppp.toFixed(2) : 'NA' },
            { label: 'Avg Possession Duration', value: Number.isFinite(kpis.avgDur) ? `${kpis.avgDur.toFixed(1)}s` : 'NA' },
            { label: 'Possession To Attack %', value: formatPct(kpis.possToAttack) },
            { label: 'Possession To Shot %', value: formatPct(kpis.possToShot) },
            { label: 'Attack To Shot %', value: formatPct(kpis.attToShot) },
            { label: 'Passes Per Possession', value: Number.isFinite(kpis.passesPerPoss) ? kpis.passesPerPoss.toFixed(2) : 'NA' },
            { label: 'Scoring Possession %', value: formatPct(kpis.scoringPoss) },
            { label: 'Counter Attack Possession %', value: formatPct(kpis.counterPoss) },
          ].map((k) => (
            <Card key={k.label}>
              <CardContent className="p-3">
                <div className="text-[11px] text-slate-600">{k.label}</div>
                <div className="text-lg font-semibold text-slate-900 tabular-nums">{k.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        {possessions.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-sm text-slate-600 text-center">
              No possessions available for current filters.
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid lg:grid-cols-2 gap-4">
              <Card>
                <CardContent className="p-4 space-y-3">
                  <div className="font-semibold text-slate-900">Possession Outcomes</div>
                  <ChartContainer id="possession-outcomes" className="h-[240px] w-full" config={{}}>
                    <BarChart data={possessionOutcomeData} margin={{ top: 10, right: 16, left: 0, bottom: 6 }}>
                      <CartesianGrid vertical={false} />
                      <XAxis dataKey="team" className="text-xs" />
                      <YAxis allowDecimals={false} className="text-xs" />
                      <Tooltip content={<ChartTooltipContent />} />
                      <Legend />
                      {[
                        { k: 'Goal', c: '#1d4ed8' },
                        { k: '2 Point', c: '#6366f1' },
                        { k: '1 Point', c: '#0ea5e9' },
                        { k: 'Miss', c: '#64748b' },
                        { k: 'Turnover', c: '#dc2626' },
                        { k: 'Half End', c: '#94a3b8' },
                      ].map((o) => (
                        <Bar key={o.k} dataKey={o.k} stackId="a" fill={o.c} />
                      ))}
                    </BarChart>
                  </ChartContainer>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4 space-y-3">
                  <div className="font-semibold text-slate-900">Attack Outcomes</div>
                  <div className="text-xs text-slate-500">Attack = possession that enters the opposition 45 (x >= {OPP_45_X}).</div>
                  <ChartContainer id="attack-outcomes-poss" className="h-[240px] w-full" config={{}}>
                    <BarChart data={attackOutcomeData} margin={{ top: 10, right: 16, left: 0, bottom: 6 }}>
                      <CartesianGrid vertical={false} />
                      <XAxis dataKey="team" className="text-xs" />
                      <YAxis allowDecimals={false} className="text-xs" />
                      <Tooltip content={<ChartTooltipContent />} />
                      <Legend />
                      {[
                        { k: 'Goal', c: '#1d4ed8' },
                        { k: '2 Point', c: '#6366f1' },
                        { k: '1 Point', c: '#0ea5e9' },
                        { k: 'Miss', c: '#64748b' },
                        { k: 'Turnover', c: '#dc2626' },
                        { k: 'Half End', c: '#94a3b8' },
                      ].map((o) => (
                        <Bar key={o.k} dataKey={o.k} stackId="a" fill={o.c} />
                      ))}
                    </BarChart>
                  </ChartContainer>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="font-semibold text-slate-900">Possession Table</div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Poss</TableHead>
                      <TableHead>Team</TableHead>
                      <TableHead>Half</TableHead>
                      <TableHead className="text-right">Start</TableHead>
                      <TableHead className="text-right">End</TableHead>
                      <TableHead className="text-right">Dur</TableHead>
                      <TableHead>Start Source</TableHead>
                      <TableHead>Outcome</TableHead>
                      <TableHead className="text-right">Passes</TableHead>
                      <TableHead className="text-right">Shots</TableHead>
                      <TableHead className="text-right">Pts</TableHead>
                      <TableHead className="text-right">Attack</TableHead>
                      <TableHead className="text-right">Counter</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {possessions.slice(0, 250).map((p) => {
                      const teamName = p.teamSide === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home');
                      return (
                        <TableRow key={p.key}>
                          <TableCell className="font-mono text-xs">#{p.possessionId}</TableCell>
                          <TableCell className="font-medium">{teamName}</TableCell>
                          <TableCell>{toTitleCase(p.half)}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{Number.isFinite(p.startTime) ? formatMMSS(p.startTime) : 'NA'}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{Number.isFinite(p.endTime) ? formatMMSS(p.endTime) : 'NA'}</TableCell>
                          <TableCell className="text-right font-mono text-xs">{Number.isFinite(p.duration) ? `${p.duration.toFixed(1)}s` : 'NA'}</TableCell>
                          <TableCell>{p.startSource}</TableCell>
                          <TableCell>{p.outcome}</TableCell>
                          <TableCell className="text-right tabular-nums">{p.passes}</TableCell>
                          <TableCell className="text-right tabular-nums">{p.shots}</TableCell>
                          <TableCell className="text-right tabular-nums">{p.points}</TableCell>
                          <TableCell className="text-right tabular-nums">{p.isAttack ? 'Yes' : 'No'}</TableCell>
                          <TableCell className="text-right tabular-nums">{p.counter ? 'Yes' : 'No'}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function BuildUpTab({ stats, homeTeam, awayTeam, playerOptions, reportFilters }) {
  const [eventTypes, setEventTypes] = useState([]); // [] both
  const [pressure, setPressure] = useState([]); // [] any
  const [outcome, setOutcome] = useState([]); // [] any
  const [progressiveOnly, setProgressiveOnly] = useState(false);
  const [pnSide, setPnSide] = useState('home'); // home|away
  const [pnMin, setPnMin] = useState(3);

  const events = useMemo(() => {
    const list = Array.isArray(stats) ? stats : [];
    return list.filter((s) => s && (s.stat_type === 'pass' || s.stat_type === 'carry'));
  }, [stats]);

  const deriveProgression = (s) => {
    const sx = Number(s.x_position);
    const ex = Number(s.end_x_position);
    if (!Number.isFinite(sx) || !Number.isFinite(ex)) return 0;
    return Math.max(0, ex - sx);
  };

  const isProgressive = (s) => {
    const prog = deriveProgression(s);
    const sx = Number(s.x_position);
    const advanced = Number.isFinite(sx) ? sx >= OPP_45_X : false;
    const threshold = advanced ? 5 : 10;
    if (prog >= threshold) return true;
    const ex = Number(s.end_x_position);
    return Number.isFinite(ex) && ex >= OPP_45_X;
  };

  const filtered = useMemo(() => {
    return events.filter((s) => {
      if (eventTypes.length && !eventTypes.includes(s.stat_type)) return false;
      const extra = safeParseJSON(s.extra_data || '{}', {});
      const p = s.stat_type === 'pass' ? extra?.pass?.pressure_on_passer : extra?.carry?.pressure_on_carrier;
      const o = deriveOutcome(s, extra);
      if (pressure.length && !pressure.includes(String(p || ''))) return false;
      if (outcome.length && !outcome.includes(String(o || ''))) return false;
      if (progressiveOnly && !isProgressive(s)) return false;
      return true;
    });
  }, [events, eventTypes, pressure, outcome, progressiveOnly]);

  const kpis = useMemo(() => {
    const pass = events.filter((s) => s.stat_type === 'pass');
    const carry = events.filter((s) => s.stat_type === 'carry');
    const passComp = pass.filter((s) => deriveOutcome(s, safeParseJSON(s.extra_data || '{}', {})) === 'completed').length;
    const carryComp = carry.filter((s) => deriveOutcome(s, safeParseJSON(s.extra_data || '{}', {})) === 'completed').length;
    const passPct = pass.length ? (passComp / pass.length) * 100 : NaN;
    const carryPct = carry.length ? (carryComp / carry.length) * 100 : NaN;
    const progPass = pass.filter((s) => isProgressive(s)).length;
    const progCarry = carry.filter((s) => isProgressive(s)).length;
    const entries = events.filter((s) => {
      const sx = Number(s.x_position);
      const ex = Number(s.end_x_position);
      return Number.isFinite(sx) && Number.isFinite(ex) && sx < OPP_45_X && ex >= OPP_45_X;
    }).length;
    const turnovers = events.filter((s) => {
      const extra = safeParseJSON(s.extra_data || '{}', {});
      const o = deriveOutcome(s, extra);
      return o === 'turnover' || o === 'foul' || (extra?.turnover && typeof extra.turnover === 'object');
    }).length;
    return {
      passes: pass.length,
      passPct,
      carries: carry.length,
      carryPct,
      progPass,
      progCarry,
      entries,
      turnovers,
    };
  }, [events]);

  return (
    <div className="grid lg:grid-cols-[340px_1fr] gap-4">
      <div className="space-y-4">
        <ReportFiltersCard reportFilters={reportFilters} playerOptions={playerOptions} homeTeam={homeTeam} awayTeam={awayTeam} />
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="font-semibold text-slate-900">Local Filters</div>
            <MultiSelect
              label="Event Type"
              placeholder="Both"
              values={eventTypes}
              onChange={setEventTypes}
              options={[
                { value: 'pass', label: 'Pass' },
                { value: 'carry', label: 'Carry' },
              ]}
            />
            <MultiSelect
              label="Pressure"
              placeholder="Any"
              values={pressure}
              onChange={setPressure}
              options={[
                { value: 'low', label: 'Low' },
                { value: 'medium', label: 'Medium' },
                { value: 'high', label: 'High' },
              ]}
            />
            <MultiSelect
              label="Outcome"
              placeholder="Any"
              values={outcome}
              onChange={setOutcome}
              options={[
                { value: 'completed', label: 'Completed' },
                { value: 'turnover', label: 'Turnover' },
                { value: 'foul', label: 'Foul' },
                { value: 'sideline_for', label: 'Sideline For' },
                { value: 'sideline_against', label: 'Sideline Against' },
                { value: '45_for', label: '45 For' },
                { value: 'goal_kick_for', label: 'Goal Kick For' },
                { value: 'goal_kick_against', label: 'Goal Kick Against' },
              ]}
            />
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs text-slate-600">Progressive Only</div>
              <Checkbox checked={progressiveOnly} onCheckedChange={(v) => setProgressiveOnly(!!v)} />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: 'Passes Attempted', value: kpis.passes },
            { label: 'Pass Completion %', value: formatPct(kpis.passPct) },
            { label: 'Carries', value: kpis.carries },
            { label: 'Carry Completion %', value: formatPct(kpis.carryPct) },
            { label: 'Progressive Passes', value: kpis.progPass },
            { label: 'Progressive Carries', value: kpis.progCarry },
            { label: 'Dangerous-Zone Entries', value: kpis.entries },
            { label: 'Build-Up Turnovers', value: kpis.turnovers },
          ].map((k) => (
            <Card key={k.label}>
              <CardContent className="p-3">
                <div className="text-[11px] text-slate-600">{k.label}</div>
                <div className="text-lg font-semibold text-slate-900 tabular-nums">{k.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        {filtered.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-sm text-slate-600 text-center">
              No passes or carries available for current filters.
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="font-semibold text-slate-900">Pass / Carry Map</div>
                <PitchViz stats={filtered} homeColor={homeTeam?.color} awayColor={awayTeam?.color} colorBy="outcome" showColorControls={false} />
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="font-semibold text-slate-900">Pass Network</div>
                <div className="text-xs text-slate-500">Built from completed passes (passer to receiver).</div>

                <div className="grid lg:grid-cols-[340px_1fr] gap-4">
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-600">Team</Label>
                      <Select value={pnSide} onValueChange={setPnSide}>
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
                  </div>

                  <PassNetwork
                    passes={events.filter((s) => s.stat_type === 'pass')}
                    side={pnSide}
                    minCount={pnMin}
                    teamColor={(pnSide === 'away' ? awayTeam?.color : homeTeam?.color) || '#111827'}
                  />
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function applyNonTeamReportFilters(stats, reportFilters) {
  const list = Array.isArray(stats) ? stats : [];
  const halves = Array.isArray(reportFilters?.halves) ? reportFilters.halves : [];
  const playerIds = Array.isArray(reportFilters?.playerIds) ? reportFilters.playerIds : [];
  const minM = Number(reportFilters?.timeMin);
  const maxM = Number(reportFilters?.timeMax);
  const minS = Number.isFinite(minM) && String(reportFilters?.timeMin ?? '') !== '' ? minM * 60 : null;
  const maxS = Number.isFinite(maxM) && String(reportFilters?.timeMax ?? '') !== '' ? maxM * 60 : null;
  const imputed = reportFilters?.imputedTimeById;

  return list.filter((s) => {
    if (!s) return false;
    if (halves.length && !halves.includes(s.half)) return false;
    if (playerIds.length) {
      const extra = safeParseJSON(s.extra_data || '{}', {});
      const ids = collectPlayerIds(extra);
      const any = playerIds.some((id) => ids.has(id));
      if (!any) return false;
    }
    if (minS != null || maxS != null) {
      let t = Number(s.normalized_time_s);
      if (!Number.isFinite(t) && imputed && typeof imputed.get === 'function') {
        t = Number(imputed.get(s.id));
      }
      if (!Number.isFinite(t)) return false;
      t = Math.max(0, t);
      if (minS != null && t < minS) return false;
      if (maxS != null && t > maxS) return false;
    }
    return true;
  });
}

function RestartsTab({ stats, homeTeam, awayTeam, playerOptions, reportFilters }) {
  const base = useMemo(() => applyNonTeamReportFilters(stats, reportFilters), [stats, reportFilters]);

  const kickouts = useMemo(() => base.filter((s) => s?.stat_type === 'kickout'), [base]);

  const kpis = useMemo(() => {
    const byPoss = groupByPossession(base);

    const calcForTeam = (teamSide) => {
      const ownKickouts = [];
      const oppKickouts = [];
      for (const s of kickouts) {
        const ex = safeParseJSON(s.extra_data || '{}', {});
        const koTeam = ex?.kickout?.team_side;
        const o = ex?.kickout?.outcome;
        const won = ex?.kickout?.won_by;
        if (koTeam === teamSide) ownKickouts.push({ o, won, koTeam });
        if (koTeam && koTeam !== teamSide) oppKickouts.push({ o, won, koTeam });
      }

      const ownTaken = ownKickouts.length;
      const ownWon = ownKickouts.filter((r) => (r.o === 'clean' || r.o === 'break') && r.won?.team_side === teamSide).length;
      const ownCleanWon = ownKickouts.filter((r) => r.o === 'clean' && r.won?.team_side === teamSide).length;

      const oppTaken = oppKickouts.length;
      const oppDisrupted = oppKickouts.filter((r) => {
        const oppSide = r.koTeam;
        if (r.o !== 'clean') return true;
        return r.won?.team_side !== oppSide;
      }).length;

      // Restart-to-shot/score (best-effort): check possessions associated with won restarts.
      const restartPossKeys = new Set();
      for (const s of kickouts) {
        const ex = safeParseJSON(s.extra_data || '{}', {});
        const koTeam = ex?.kickout?.team_side;
        if (koTeam !== teamSide) continue;
        const o = ex?.kickout?.outcome;
        const won = ex?.kickout?.won_by;
        if (!((o === 'clean' || o === 'break') && won?.team_side === teamSide)) continue;
        const pid = Number(s?.possession_id);
        const pside = s?.possession_team_side;
        if (Number.isFinite(pid) && pside === teamSide) restartPossKeys.add(`${pside}-${pid}`);
      }

      const restartPoss = Array.from(restartPossKeys).map((k) => byPoss.get(k) || []);
      const restartWins = restartPoss.length;
      const restartToShot = restartPoss.filter((evs) => evs.some((e) => e.team_side === teamSide && e.stat_type === 'shot')).length;
      const restartToScore = restartPoss.filter((evs) => evs.some((e) => {
        if (e.team_side !== teamSide || e.stat_type !== 'shot') return false;
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
    const breakAll = kickouts.filter((s) => safeParseJSON(s.extra_data || '{}', {})?.kickout?.outcome === 'break');
    const breakWonHome = breakAll.filter((s) => {
      const ex = safeParseJSON(s.extra_data || '{}', {});
      const won = ex?.kickout?.won_by;
      return won?.team_side === 'home';
    }).length;
    const breakWonAway = breakAll.filter((s) => {
      const ex = safeParseJSON(s.extra_data || '{}', {});
      const won = ex?.kickout?.won_by;
      return won?.team_side === 'away';
    }).length;

    return {
      home: calcForTeam('home'),
      away: calcForTeam('away'),
      breakAll: breakAll.length,
      breakWonHome,
      breakWonAway,
    };
  }, [kickouts, base]);

  const kickoutTargets = useMemo(() => {
    const rows = new Map();
    for (const s of kickouts) {
      const ex = safeParseJSON(s.extra_data || '{}', {});
      const koTeam = ex?.kickout?.team_side;
      if (koTeam !== 'home' && koTeam !== 'away') continue;
      const r = ex?.kickout?.intended_recipient;
      const key = r?.kind === 'player' ? r.id : (r?.kind === 'team' ? 'team' : (r?.kind === 'none' ? 'none' : 'unknown'));
      const cur = rows.get(`${koTeam}|${key}`) || { team: koTeam, key, label: formatExtraValue(r), targeted: 0, won: 0, clean: 0, break: 0, marks: 0 };
      cur.targeted += 1;
      const o = ex?.kickout?.outcome;
      const wonBy = ex?.kickout?.won_by;
      if ((o === 'clean' || o === 'break') && wonBy?.team_side === koTeam) cur.won += 1;
      if (o === 'clean' && wonBy?.team_side === koTeam) cur.clean += 1;
      if (o === 'break' && wonBy?.team_side === koTeam) cur.break += 1;
      if (ex?.kickout?.mark) cur.marks += 1;
      rows.set(`${koTeam}|${key}`, cur);
    }
    return Array.from(rows.values()).sort((a, b) => b.targeted - a.targeted || String(a.label).localeCompare(String(b.label)));
  }, [kickouts]);

  return (
    <div className="grid lg:grid-cols-[340px_1fr] gap-4">
      <div className="space-y-4">
        <ReportFiltersCard reportFilters={reportFilters} playerOptions={playerOptions} homeTeam={homeTeam} awayTeam={awayTeam} />
      </div>

      <div className="space-y-4">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            {
              label: 'Own Kickout Win %',
              value: `${kpis.home.ownKickoutsWon}/${kpis.home.ownKickoutsTaken} (${formatPct(kpis.home.ownKickoutsTaken ? (kpis.home.ownKickoutsWon / kpis.home.ownKickoutsTaken) * 100 : NaN)}) | ${kpis.away.ownKickoutsWon}/${kpis.away.ownKickoutsTaken} (${formatPct(kpis.away.ownKickoutsTaken ? (kpis.away.ownKickoutsWon / kpis.away.ownKickoutsTaken) * 100 : NaN)})`,
            },
            {
              label: 'Opposition Kickout Disruption %',
              value: `${kpis.home.oppDisrupted}/${kpis.home.oppKickoutsTaken} (${formatPct(kpis.home.oppKickoutsTaken ? (kpis.home.oppDisrupted / kpis.home.oppKickoutsTaken) * 100 : NaN)}) | ${kpis.away.oppDisrupted}/${kpis.away.oppKickoutsTaken} (${formatPct(kpis.away.oppKickoutsTaken ? (kpis.away.oppDisrupted / kpis.away.oppKickoutsTaken) * 100 : NaN)})`,
            },
            {
              label: 'Clean Kickout Win %',
              value: `${kpis.home.ownCleanWon}/${kpis.home.ownKickoutsTaken} (${formatPct(kpis.home.ownKickoutsTaken ? (kpis.home.ownCleanWon / kpis.home.ownKickoutsTaken) * 100 : NaN)}) | ${kpis.away.ownCleanWon}/${kpis.away.ownKickoutsTaken} (${formatPct(kpis.away.ownKickoutsTaken ? (kpis.away.ownCleanWon / kpis.away.ownKickoutsTaken) * 100 : NaN)})`,
            },
            {
              label: 'Break-Ball Recovery %',
              value: `${kpis.breakWonHome}/${kpis.breakAll} (${formatPct(kpis.breakAll ? (kpis.breakWonHome / kpis.breakAll) * 100 : NaN)}) | ${kpis.breakWonAway}/${kpis.breakAll} (${formatPct(kpis.breakAll ? (kpis.breakWonAway / kpis.breakAll) * 100 : NaN)})`,
            },
            {
              label: 'Restart-to-Shot %',
              value: `${kpis.home.restartToShot}/${kpis.home.restartWins} (${formatPct(kpis.home.restartWins ? (kpis.home.restartToShot / kpis.home.restartWins) * 100 : NaN)}) | ${kpis.away.restartToShot}/${kpis.away.restartWins} (${formatPct(kpis.away.restartWins ? (kpis.away.restartToShot / kpis.away.restartWins) * 100 : NaN)})`,
            },
            {
              label: 'Restart-to-Score %',
              value: `${kpis.home.restartToScore}/${kpis.home.restartWins} (${formatPct(kpis.home.restartWins ? (kpis.home.restartToScore / kpis.home.restartWins) * 100 : NaN)}) | ${kpis.away.restartToScore}/${kpis.away.restartWins} (${formatPct(kpis.away.restartWins ? (kpis.away.restartToScore / kpis.away.restartWins) * 100 : NaN)})`,
            },
          ].map((k) => (
            <Card key={k.label}>
              <CardContent className="p-3">
                <div className="text-[11px] text-slate-600">{k.label}</div>
                <div className="text-lg font-semibold text-slate-900 tabular-nums">{k.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        {kickouts.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-sm text-slate-600 text-center">
              No kickouts available for current filters.
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="font-semibold text-slate-900">Kickout Map</div>
                <PitchViz stats={kickouts} homeColor={homeTeam?.color} awayColor={awayTeam?.color} colorBy="outcome" showColorControls={false} />
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="font-semibold text-slate-900">Kickout Targets</div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Team</TableHead>
                      <TableHead>Target</TableHead>
                      <TableHead className="text-right">Targeted</TableHead>
                      <TableHead className="text-right">Won</TableHead>
                      <TableHead className="text-right">Win %</TableHead>
                      <TableHead className="text-right">Clean</TableHead>
                      <TableHead className="text-right">Break</TableHead>
                      <TableHead className="text-right">Marks</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {kickoutTargets.slice(0, 200).map((r, idx) => (
                      <TableRow key={`${r.team}-${r.key}-${idx}`}>
                        <TableCell>{r.team === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home')}</TableCell>
                        <TableCell className="font-medium">{r.label || 'NA'}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.targeted}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.won}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatPct(r.targeted ? (r.won / r.targeted) * 100 : NaN)}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.clean}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.break}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.marks}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function MiscTab({ stats, homeTeam, awayTeam, playerOptions, reportFilters }) {
  const base = useMemo(() => applyNonTeamReportFilters(stats, reportFilters), [stats, reportFilters]);
  const throwIns = useMemo(() => base.filter((s) => s?.stat_type === 'throw_in'), [base]);

  const kpis = useMemo(() => {
    const calc = (teamSide) => {
      const contested = throwIns.length;
      const won = throwIns.filter((s) => {
        const ex = safeParseJSON(s.extra_data || '{}', {});
        const out = ex?.throw_in?.outcome;
        const w = ex?.throw_in?.won_by;
        return (out === 'clean' || out === 'break') && w?.team_side === teamSide;
      }).length;
      const cleanWon = throwIns.filter((s) => {
        const ex = safeParseJSON(s.extra_data || '{}', {});
        const out = ex?.throw_in?.outcome;
        const w = ex?.throw_in?.won_by;
        return out === 'clean' && w?.team_side === teamSide;
      }).length;
      const breakWon = throwIns.filter((s) => {
        const ex = safeParseJSON(s.extra_data || '{}', {});
        const out = ex?.throw_in?.outcome;
        const w = ex?.throw_in?.won_by;
        return out === 'break' && w?.team_side === teamSide;
      }).length;
      return { contested, won, cleanWon, breakWon };
    };
    return { home: calc('home'), away: calc('away') };
  }, [throwIns]);

  const outcomeRows = useMemo(() => {
    const rows = new Map();
    for (const s of throwIns) {
      const ex = safeParseJSON(s.extra_data || '{}', {});
      const out = String(ex?.throw_in?.outcome || 'unknown');
      rows.set(out, (rows.get(out) || 0) + 1);
    }
    return Array.from(rows.entries())
      .map(([k, v]) => ({ outcome: toTitleCase(k), count: v }))
      .sort((a, b) => b.count - a.count || String(a.outcome).localeCompare(String(b.outcome)));
  }, [throwIns]);

  const playerRows = useMemo(() => {
    const rows = new Map();
    const bump = (sel, field) => {
      if (!sel) return;
      const key = JSON.stringify({ kind: sel.kind, id: sel.id || '', team_side: sel.team_side || '' });
      const cur = rows.get(key) || { key, player: formatExtraValue(sel), team: sel.team_side || 'unknown', won: 0, lost: 0, broken: 0 };
      cur[field] += 1;
      rows.set(key, cur);
    };
    for (const s of throwIns) {
      const ex = safeParseJSON(s.extra_data || '{}', {});
      const ti = ex?.throw_in || {};
      bump(ti.won_by, 'won');
      bump(ti.lost_by, 'lost');
      bump(ti.broken_by, 'broken');
    }
    return Array.from(rows.values()).sort((a, b) => (b.won + b.lost + b.broken) - (a.won + a.lost + a.broken));
  }, [throwIns]);

  return (
    <div className="grid lg:grid-cols-[340px_1fr] gap-4">
      <div className="space-y-4">
        <ReportFiltersCard reportFilters={reportFilters} playerOptions={playerOptions} homeTeam={homeTeam} awayTeam={awayTeam} />
      </div>
      <div className="space-y-4">
        {throwIns.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-sm text-slate-600 text-center">No throw-ins available for current filters.</CardContent>
          </Card>
        ) : (
          <>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                {
                  label: 'Throw-In Win %',
                  value: `${kpis.home.won}/${kpis.home.contested} (${formatPct(kpis.home.contested ? (kpis.home.won / kpis.home.contested) * 100 : NaN)}) • ${kpis.away.won}/${kpis.away.contested} (${formatPct(kpis.away.contested ? (kpis.away.won / kpis.away.contested) * 100 : NaN)})`,
                },
                { label: 'Clean Wins', value: `${kpis.home.cleanWon} • ${kpis.away.cleanWon}` },
                { label: 'Break Wins', value: `${kpis.home.breakWon} • ${kpis.away.breakWon}` },
                { label: 'Throw-Ins Contested', value: throwIns.length },
              ].map((k) => (
                <Card key={k.label}>
                  <CardContent className="p-3">
                    <div className="text-[11px] text-slate-600">{k.label}</div>
                    <div className="text-lg font-semibold text-slate-900 tabular-nums">{k.value}</div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="grid lg:grid-cols-2 gap-4">
              <Card>
                <CardContent className="p-4 space-y-3">
                  <div className="font-semibold text-slate-900">Throw-In Outcomes</div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Outcome</TableHead>
                        <TableHead className="text-right">Count</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {outcomeRows.map((r) => (
                        <TableRow key={r.outcome}>
                          <TableCell className="font-medium">{r.outcome}</TableCell>
                          <TableCell className="text-right tabular-nums">{r.count}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-4 space-y-3">
                  <div className="font-semibold text-slate-900">Throw-In Players</div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Player</TableHead>
                        <TableHead>Team</TableHead>
                        <TableHead className="text-right">Won</TableHead>
                        <TableHead className="text-right">Lost</TableHead>
                        <TableHead className="text-right">Broken</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {playerRows.slice(0, 200).map((r) => (
                        <TableRow key={r.key}>
                          <TableCell className="font-medium">{r.player}</TableCell>
                          <TableCell>{r.team === 'away' ? (awayTeam?.name || 'Away') : (r.team === 'home' ? (homeTeam?.name || 'Home') : 'NA')}</TableCell>
                          <TableCell className="text-right tabular-nums">{r.won}</TableCell>
                          <TableCell className="text-right tabular-nums">{r.lost}</TableCell>
                          <TableCell className="text-right tabular-nums">{r.broken}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function DefenseTab({ stats, homeTeam, awayTeam, playerOptions, reportFilters }) {
  const base = useMemo(() => applyNonTeamReportFilters(stats, reportFilters), [stats, reportFilters]);
  const turnovers = useMemo(() => base.filter((s) => s?.stat_type === 'turnover' || (safeParseJSON(s?.extra_data || '{}', {})?.turnover)), [base]);
  const defActions = useMemo(() => base.filter((s) => s?.stat_type === 'defensive_contact'), [base]);

  const classifyTurnover = (s) => {
    const ex = safeParseJSON(s?.extra_data || '{}', {});
    const t = ex?.turnover || {};
    const lost = t?.lost_by?.team_side;
    const rec = t?.recovered_by?.team_side;
    const unforced = !!t?.unforced;
    const typ = String(t?.type || t?.turnover_type || ex?.turnover_type || '');
    return { lost, rec, unforced, typ };
  };

  const kpis = useMemo(() => {
    const calc = (teamSide) => {
      const won = turnovers.filter((s) => classifyTurnover(s).rec === teamSide).length;
      const lost = turnovers.filter((s) => classifyTurnover(s).lost === teamSide).length;
      const total = turnovers.filter((s) => {
        const c = classifyTurnover(s);
        return c.rec === teamSide || c.lost === teamSide;
      }).length;
      const forced = turnovers.filter((s) => {
        const c = classifyTurnover(s);
        return (c.rec === teamSide || c.lost === teamSide) && !c.unforced;
      }).length;
      const forcedPct = total ? (forced / total) * 100 : NaN;

      const winXs = turnovers
        .filter((s) => classifyTurnover(s).rec === teamSide)
        .map((s) => Number(s?.x_position))
        .filter(Number.isFinite);
      const avgHeight = winXs.length ? (winXs.reduce((a, b) => a + b, 0) / winXs.length) : NaN;

      const byPoss = groupByPossession(base);
      const startKeys = new Set();
      for (const s of turnovers) {
        const c = classifyTurnover(s);
        if (c.rec !== teamSide) continue;
        const pid = Number(s?.possession_id);
        const pside = s?.possession_team_side;
        if (Number.isFinite(pid) && pside === teamSide) startKeys.add(`${pside}-${pid}`);
      }
      const poss = Array.from(startKeys).map((k) => byPoss.get(k) || []);
      const shotsFrom = poss.filter((evs) => evs.some((e) => e.team_side === teamSide && e.stat_type === 'shot')).length;
      const scoresFrom = poss.filter((evs) => evs.some((e) => {
        if (e.team_side !== teamSide || e.stat_type !== 'shot') return false;
        const ex = safeParseJSON(e.extra_data || '{}', {});
        return shotOutcomeGroup(ex?.shot?.outcome) === 'score';
      })).length;

      const oppSide = teamSide === 'home' ? 'away' : 'home';
      const concededKeys = new Set();
      for (const s of turnovers) {
        const c = classifyTurnover(s);
        if (c.lost !== teamSide) continue;
        const pid = Number(s?.possession_id);
        const pside = s?.possession_team_side;
        if (Number.isFinite(pid) && pside === oppSide) concededKeys.add(`${pside}-${pid}`);
      }
      const concededPoss = Array.from(concededKeys).map((k) => byPoss.get(k) || []);
      const scoresConceded = concededPoss.filter((evs) => evs.some((e) => {
        if (e.team_side !== oppSide || e.stat_type !== 'shot') return false;
        const ex = safeParseJSON(e.extra_data || '{}', {});
        return shotOutcomeGroup(ex?.shot?.outcome) === 'score';
      })).length;

      return { won, lost, diff: won - lost, forcedPct, avgHeight, shotsFrom, scoresFrom, scoresConceded };
    };
    return { home: calc('home'), away: calc('away') };
  }, [turnovers, base]);

  const typeRows = useMemo(() => {
    const rows = new Map();
    for (const s of turnovers) {
      const c = classifyTurnover(s);
      const typ = toTitleCase(c.typ || 'Unknown');
      const cur = rows.get(typ) || { type: typ, won: 0, lost: 0 };
      if (c.rec) cur.won += 1;
      if (c.lost) cur.lost += 1;
      rows.set(typ, cur);
    }
    return Array.from(rows.values()).sort((a, b) => String(a.type).localeCompare(String(b.type)));
  }, [turnovers]);

  return (
    <div className="grid lg:grid-cols-[340px_1fr] gap-4">
      <div className="space-y-4">
        <ReportFiltersCard reportFilters={reportFilters} playerOptions={playerOptions} homeTeam={homeTeam} awayTeam={awayTeam} />
      </div>
      <div className="space-y-4">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: 'Turnovers Won', value: `${kpis.home.won} / ${kpis.away.won}` },
            { label: 'Turnovers Lost', value: `${kpis.home.lost} / ${kpis.away.lost}` },
            { label: 'Turnover Differential', value: `${kpis.home.diff} / ${kpis.away.diff}` },
            { label: 'Forced Turnover %', value: `${formatPct(kpis.home.forcedPct)} / ${formatPct(kpis.away.forcedPct)}` },
            { label: 'Average Regain Height (x)', value: `${Number.isFinite(kpis.home.avgHeight) ? kpis.home.avgHeight.toFixed(1) : 'NA'} / ${Number.isFinite(kpis.away.avgHeight) ? kpis.away.avgHeight.toFixed(1) : 'NA'}` },
            { label: 'Shots From Regains', value: `${kpis.home.shotsFrom} / ${kpis.away.shotsFrom}` },
            { label: 'Scores From Regains', value: `${kpis.home.scoresFrom} / ${kpis.away.scoresFrom}` },
            { label: 'Scores Conceded After Lost Turnovers', value: `${kpis.home.scoresConceded} / ${kpis.away.scoresConceded}` },
          ].map((k) => (
            <Card key={k.label}>
              <CardContent className="p-3">
                <div className="text-[11px] text-slate-600">{k.label}</div>
                <div className="text-lg font-semibold text-slate-900 tabular-nums">{k.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        {turnovers.length === 0 && defActions.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-sm text-slate-600 text-center">No defensive events available for current filters.</CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="font-semibold text-slate-900">Defensive Map</div>
                <PitchViz stats={[...turnovers, ...defActions]} homeColor={homeTeam?.color} awayColor={awayTeam?.color} colorBy="action" showColorControls={false} />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="font-semibold text-slate-900">Turnover Type Breakdown</div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Count</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {typeRows.map((r) => (
                      <TableRow key={r.type}>
                        <TableCell className="font-medium">{r.type}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.won + r.lost}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="text-[11px] text-slate-500">Counts are best-effort from turnover.type and embedded turnover fields.</div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function extractFoulFromStat(s) {
  const ex = safeParseJSON(s?.extra_data || '{}', {});
  if (s?.stat_type === 'foul' && ex?.foul) return ex.foul;
  if (ex?.turnover?.type === 'foul' && ex?.turnover?.foul) return ex.turnover.foul;
  if (ex?.pass?.outcome === 'foul' && ex?.pass?.foul) return ex.pass.foul;
  if (ex?.carry?.outcome === 'foul' && ex?.carry?.foul) return ex.carry.foul;
  if (ex?.kickout?.outcome === 'foul' && ex?.kickout?.foul) return ex.kickout.foul;
  if (ex?.throw_in?.outcome === 'foul' && ex?.throw_in?.foul) return ex.throw_in.foul;
  return null;
}

function FoulsDisciplineTab({ stats, homeTeam, awayTeam, playerOptions, reportFilters }) {
  const base = useMemo(() => applyNonTeamReportFilters(stats, reportFilters), [stats, reportFilters]);
  const fouls = useMemo(() => base.filter((s) => !!extractFoulFromStat(s)), [base]);

  const kpis = useMemo(() => {
    const by = { home: { won: 0, conceded: 0, yellow: 0, black: 0, red: 0 }, away: { won: 0, conceded: 0, yellow: 0, black: 0, red: 0 } };
    for (const s of fouls) {
      const f = extractFoulFromStat(s);
      const foulBy = f?.foul_by?.team_side;
      const foulOn = f?.foul_on_or_forced_by?.team_side;
      const card = String(f?.card || 'none');
      if (foulOn === 'home') by.home.won += 1;
      if (foulOn === 'away') by.away.won += 1;
      if (foulBy === 'home') by.home.conceded += 1;
      if (foulBy === 'away') by.away.conceded += 1;
      if (foulBy === 'home') {
        if (card === 'yellow') by.home.yellow += 1;
        if (card === 'black') by.home.black += 1;
        if (card === 'red') by.home.red += 1;
      }
      if (foulBy === 'away') {
        if (card === 'yellow') by.away.yellow += 1;
        if (card === 'black') by.away.black += 1;
        if (card === 'red') by.away.red += 1;
      }
    }
    return by;
  }, [fouls]);

  const typeRows = useMemo(() => {
    const rows = new Map();
    for (const s of fouls) {
      const f = extractFoulFromStat(s);
      const typ = toTitleCase(f?.foul_type || 'Unknown');
      const cur = rows.get(typ) || { type: typ, count: 0 };
      cur.count += 1;
      rows.set(typ, cur);
    }
    return Array.from(rows.values()).sort((a, b) => b.count - a.count);
  }, [fouls]);

  return (
    <div className="grid lg:grid-cols-[340px_1fr] gap-4">
      <div className="space-y-4">
        <ReportFiltersCard reportFilters={reportFilters} playerOptions={playerOptions} homeTeam={homeTeam} awayTeam={awayTeam} />
      </div>
      <div className="space-y-4">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: 'Fouls Won', value: `${kpis.home.won} / ${kpis.away.won}` },
            { label: 'Fouls Conceded', value: `${kpis.home.conceded} / ${kpis.away.conceded}` },
            { label: 'Foul Differential', value: `${kpis.home.won - kpis.home.conceded} / ${kpis.away.won - kpis.away.conceded}` },
            { label: 'Cards Total', value: `${kpis.home.yellow + kpis.home.black + kpis.home.red} / ${kpis.away.yellow + kpis.away.black + kpis.away.red}` },
          ].map((k) => (
            <Card key={k.label}>
              <CardContent className="p-3">
                <div className="text-[11px] text-slate-600">{k.label}</div>
                <div className="text-lg font-semibold text-slate-900 tabular-nums">{k.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        {fouls.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-sm text-slate-600 text-center">No fouls available for current filters.</CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="font-semibold text-slate-900">Foul Map</div>
                <PitchViz stats={fouls} homeColor={homeTeam?.color} awayColor={awayTeam?.color} colorBy="team" showColorControls={false} />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="font-semibold text-slate-900">Foul Types</div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Count</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {typeRows.map((r) => (
                      <TableRow key={r.type}>
                        <TableCell className="font-medium">{r.type}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.count}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function PlayersAnalyticsTab({ stats, homeTeam, awayTeam, playerOptions, reportFilters }) {
  const [focusPlayerId, setFocusPlayerId] = useState('all');
  const [lbSort, setLbSort] = useState({ key: 'points', dir: 'desc' }); // key + dir
  const base = useMemo(() => applyNonTeamReportFilters(stats, reportFilters), [stats, reportFilters]);

  const leaderboard = useMemo(() => {
    const rows = new Map();
    const ensure = (sel) => {
      if (!sel || sel.kind !== 'player') return null;
      const key = `${sel.team_side || 'unknown'}|${sel.id || ''}`;
      const cur = rows.get(key) || {
        key,
        player: formatExtraValue(sel),
        team: sel.team_side || 'unknown',
        shots: 0,
        scores: 0,
        points: 0,
        passes: 0,
        carries: 0,
        turnoversWon: 0,
        turnoversLost: 0,
        foulsWon: 0,
        foulsConceded: 0,
        defActions: 0,
      };
      rows.set(key, cur);
      return cur;
    };

    for (const s of base) {
      const ex = safeParseJSON(s.extra_data || '{}', {});
      if (s.stat_type === 'shot') {
        const p = ex?.shot?.player;
        const r = ensure(p);
        if (r) {
          r.shots += 1;
          const o = ex?.shot?.outcome;
          if (shotOutcomeGroup(o) === 'score') r.scores += 1;
          r.points += shotPointsForOutcome(o);
        }
      }
      if (s.stat_type === 'pass') {
        const p = ex?.pass?.passer;
        const r = ensure(p);
        if (r) r.passes += 1;
      }
      if (s.stat_type === 'carry') {
        const p = ex?.carry?.carrier;
        const r = ensure(p);
        if (r) r.carries += 1;
      }
      if (s.stat_type === 'turnover' || ex?.turnover) {
        const t = ex?.turnover || {};
        const rec = ensure(t?.recovered_by);
        const lost = ensure(t?.lost_by);
        if (rec) rec.turnoversWon += 1;
        if (lost) lost.turnoversLost += 1;
      }
      const f = extractFoulFromStat(s);
      if (f) {
        const won = ensure(f?.foul_on_or_forced_by);
        const con = ensure(f?.foul_by);
        if (won) won.foulsWon += 1;
        if (con) con.foulsConceded += 1;
      }
      if (s.stat_type === 'defensive_contact') {
        const p = ex?.defensive_contact?.player;
        const r = ensure(p);
        if (r) r.defActions += 1;
      }
    }
    return Array.from(rows.values());
  }, [base]);

  const sortedLeaderboard = useMemo(() => {
    const list = Array.isArray(leaderboard) ? leaderboard.slice() : [];
    const dir = lbSort?.dir === 'asc' ? 1 : -1;
    const key = String(lbSort?.key || 'points');
    const get = (r) => {
      if (!r) return 0;
      const v = r[key];
      return typeof v === 'number' ? v : 0;
    };
    list.sort((a, b) => (get(a) - get(b)) * dir || String(a?.player || '').localeCompare(String(b?.player || '')));
    return list;
  }, [leaderboard, lbSort]);

  const toggleSort = (key) => {
    setLbSort((cur) => {
      if (cur?.key === key) return { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' };
      return { key, dir: 'desc' };
    });
  };

  const focusStats = useMemo(() => {
    if (focusPlayerId === 'all') return [];
    return base.filter((s) => {
      const extra = safeParseJSON(s.extra_data || '{}', {});
      const ids = collectPlayerIds(extra);
      return ids.has(focusPlayerId);
    });
  }, [base, focusPlayerId]);

  return (
    <div className="grid lg:grid-cols-[340px_1fr] gap-4">
      <div className="space-y-4">
        <ReportFiltersCard reportFilters={reportFilters} playerOptions={playerOptions} homeTeam={homeTeam} awayTeam={awayTeam} />
        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="font-semibold text-slate-900">Player</div>
            <Select value={focusPlayerId} onValueChange={setFocusPlayerId}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Players</SelectItem>
                {(playerOptions || []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {(p.team_side === 'away' ? 'Away: ' : 'Home: ') + p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      </div>
      <div className="space-y-4">
        {focusPlayerId !== 'all' && focusStats.length > 0 && (
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="font-semibold text-slate-900">Player Events</div>
              <PitchViz stats={focusStats} homeColor={homeTeam?.color} awayColor={awayTeam?.color} colorBy="action" showColorControls={false} />
            </CardContent>
          </Card>
        )}
        <Card>
          <CardContent className="p-4 space-y-3">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Player</TableHead>
                  <TableHead>Team</TableHead>
                  <TableHead className="text-right cursor-pointer select-none" onClick={() => toggleSort('shots')}>Shots</TableHead>
                  <TableHead className="text-right cursor-pointer select-none" onClick={() => toggleSort('scores')}>Scores</TableHead>
                  <TableHead className="text-right cursor-pointer select-none" onClick={() => toggleSort('points')}>Points</TableHead>
                  <TableHead className="text-right cursor-pointer select-none" onClick={() => toggleSort('passes')}>Passes</TableHead>
                  <TableHead className="text-right cursor-pointer select-none" onClick={() => toggleSort('carries')}>Carries</TableHead>
                  <TableHead className="text-right cursor-pointer select-none" onClick={() => toggleSort('turnoversWon')}>TO Won</TableHead>
                  <TableHead className="text-right cursor-pointer select-none" onClick={() => toggleSort('turnoversLost')}>TO Lost</TableHead>
                  <TableHead className="text-right cursor-pointer select-none" onClick={() => toggleSort('foulsWon')}>Fouls Won</TableHead>
                  <TableHead className="text-right cursor-pointer select-none" onClick={() => toggleSort('foulsConceded')}>Fouls Conceded</TableHead>
                  <TableHead className="text-right cursor-pointer select-none" onClick={() => toggleSort('defActions')}>Def. Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedLeaderboard.slice(0, 250).map((r) => (
                  <TableRow key={r.key}>
                    <TableCell className="font-medium">{r.player}</TableCell>
                    <TableCell>{r.team === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home')}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.shots}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.scores}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.points}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.passes}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.carries}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.turnoversWon}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.turnoversLost}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.foulsWon}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.foulsConceded}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.defActions}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function MatchReport() {
  const location = useLocation();
  const urlParams = new URLSearchParams(location?.search || '');
  const matchId = urlParams.get('id');

  const { data: matchArr = [] } = useQuery({
    queryKey: ['match', matchId],
    queryFn: () => db.entities.Match.filter({ id: matchId }),
    enabled: !!matchId,
  });

  const match = matchArr?.[0] || null;
  const halfAnchors = useMemo(() => safeParseJSON(match?.video_half_start_time_s || '{}', {}), [match?.video_half_start_time_s]);

  const { data: homeTeamArr = [] } = useQuery({
    queryKey: ['team', match?.home_team_id],
    queryFn: () => db.entities.Team.filter({ id: match?.home_team_id }),
    enabled: !!match?.home_team_id,
  });

  const { data: awayTeamArr = [] } = useQuery({
    queryKey: ['team', match?.away_team_id],
    queryFn: () => db.entities.Team.filter({ id: match?.away_team_id }),
    enabled: !!match?.away_team_id,
  });

  const homeTeam = homeTeamArr?.[0] || null;
  const awayTeam = awayTeamArr?.[0] || null;

  const { data: homePlayers = [] } = useQuery({
    queryKey: ['players', 'home', match?.home_team_id],
    queryFn: () => db.entities.Player.filter({ team_id: match?.home_team_id }),
    enabled: !!match?.home_team_id,
  });

  const { data: awayPlayers = [] } = useQuery({
    queryKey: ['players', 'away', match?.away_team_id],
    queryFn: () => db.entities.Player.filter({ team_id: match?.away_team_id }),
    enabled: !!match?.away_team_id,
  });

  const { data: stats = [] } = useQuery({
    queryKey: ['stats', matchId],
    queryFn: () => db.entities.StatEntry.filter({ match_id: matchId }),
    enabled: !!matchId,
  });

  const [vizTeam, setVizTeam] = useState('both'); // home|away|both
  const [vizActions, setVizActions] = useState([]); // [] means all
  const [vizHalves, setVizHalves] = useState([]); // [] means all
  const [vizCounters, setVizCounters] = useState([]); // [] means any, otherwise ['yes','no']
  const [vizPlayerIds, setVizPlayerIds] = useState([]); // [] means all
  const [vizColorBy, setVizColorBy] = useState('team'); // team|action|outcome

  const [overviewHalf, setOverviewHalf] = useState('all'); // all|first|second

  // Shared "report" filters for the Scoring / Build-Up / Possessions tabs.
  const [reportTeam, setReportTeam] = useState('both'); // both|home|away
  const [reportHalves, setReportHalves] = useState([]); // [] means all
  const [reportPlayerIds, setReportPlayerIds] = useState([]); // [] means any
  const [reportTimeMin, setReportTimeMin] = useState(''); // minutes (string)
  const [reportTimeMax, setReportTimeMax] = useState(''); // minutes (string)
  const imputedTimeById = useMemo(() => computeImputedNormalizedTimes(stats), [stats]);

  const overviewStats = useMemo(() => {
    const list = Array.isArray(stats) ? stats : [];
    if (overviewHalf === 'first') return list.filter((s) => s?.half === 'first');
    if (overviewHalf === 'second') return list.filter((s) => s?.half === 'second');
    return list;
  }, [stats, overviewHalf]);

  const playerOptions = useMemo(() => {
    const all = [
      ...(homePlayers || []).map((p) => ({ ...p, team_side: 'home' })),
      ...(awayPlayers || []).map((p) => ({ ...p, team_side: 'away' })),
    ];
    const label = (p) => `#${p.number || ''} ${p.name || ''}`.trim();
    return all
      .slice()
      .sort((a, b) => (a.team_side === b.team_side ? (a.number || 0) - (b.number || 0) : (a.team_side === 'home' ? -1 : 1)))
      .map((p) => ({ id: p.id, team_side: p.team_side, label: label(p) || p.id }));
  }, [homePlayers, awayPlayers]);

  const reportFilters = useMemo(() => ({
    team: reportTeam,
    setTeam: setReportTeam,
    halves: reportHalves,
    setHalves: setReportHalves,
    playerIds: reportPlayerIds,
    setPlayerIds: setReportPlayerIds,
    timeMin: reportTimeMin,
    setTimeMin: setReportTimeMin,
    timeMax: reportTimeMax,
    setTimeMax: setReportTimeMax,
    imputedTimeById,
  }), [reportTeam, reportHalves, reportPlayerIds, reportTimeMin, reportTimeMax, imputedTimeById]);

  const filteredForReport = useMemo(() => {
    const list = Array.isArray(stats) ? stats : [];
    const minM = Number(reportTimeMin);
    const maxM = Number(reportTimeMax);
    const minS = Number.isFinite(minM) && reportTimeMin !== '' ? minM * 60 : null;
    const maxS = Number.isFinite(maxM) && reportTimeMax !== '' ? maxM * 60 : null;

    return list.filter((s) => {
      if (!s) return false;
      if (reportTeam !== 'both' && s.team_side !== reportTeam) return false;
      if (reportHalves.length && !reportHalves.includes(s.half)) return false;
      if (reportPlayerIds.length) {
        const extra = safeParseJSON(s.extra_data || '{}', {});
        const ids = collectPlayerIds(extra);
        const any = reportPlayerIds.some((id) => ids.has(id));
        if (!any) return false;
      }
      if (minS != null || maxS != null) {
        let t = Number(s.normalized_time_s);
        if (!Number.isFinite(t)) t = Number(imputedTimeById.get(s.id));
        if (!Number.isFinite(t)) return false;
        t = Math.max(0, t);
        if (minS != null && t < minS) return false;
        if (maxS != null && t > maxS) return false;
      }
      return true;
    });
  }, [stats, reportTeam, reportHalves, reportPlayerIds, reportTimeMin, reportTimeMax, imputedTimeById]);

  const filteredForViz = useMemo(() => {
    const list = Array.isArray(stats) ? stats : [];
    return list.filter((s) => {
      if (!s) return false;
      if (vizTeam !== 'both' && s.team_side !== vizTeam) return false;
      if (vizActions.length && !vizActions.includes(s.stat_type)) return false;
      if (vizHalves.length && !vizHalves.includes(s.half)) return false;
      if (vizCounters.length) {
        const isYes = !!s.counter_attack;
        if (isYes && !vizCounters.includes('yes')) return false;
        if (!isYes && !vizCounters.includes('no')) return false;
      }
      if (vizPlayerIds.length) {
        const extra = safeParseJSON(s.extra_data || '{}', {});
        const ids = collectPlayerIds(extra);
        const any = vizPlayerIds.some((id) => ids.has(id));
        if (!any) return false;
      }
      return true;
    });
  }, [stats, vizTeam, vizActions, vizHalves, vizCounters, vizPlayerIds]);

  const summary = useMemo(() => {
    const empty = {
      shots: 0,
      goals: 0,
      points1: 0,
      points2: 0,
      totalPoints: 0,
      passes: 0,
      turnovers: 0, // lost
      turnoversWon: 0,
      kickoutsTaken: 0,
      kickoutsWon: 0,
      ownKickoutsTaken: 0,
      ownKickoutsWon: 0,
      carries: 0,
      takeOnsAttempted: 0,
      takeOnsCompleted: 0,
      defensiveActions: 0,
      possessions: 0,
      attacks: 0,
    };
    const out = { home: { ...empty }, away: { ...empty } };
    const list = Array.isArray(overviewStats) ? overviewStats : [];

    const possessionIdsBySide = {
      home: new Set(),
      away: new Set(),
    };

    // For "attacks": track possessions that enter opposition 45.
    const attacksBySide = {
      home: new Set(),
      away: new Set(),
    };

    for (const s of list) {
      if (!s) continue;
      const side = s.team_side === 'away' ? 'away' : 'home';
      const extra = safeParseJSON(s.extra_data || '{}', {});

      if (side === 'home' || side === 'away') {
        if (Number.isFinite(Number(s.possession_id)) && (s.possession_team_side === 'home' || s.possession_team_side === 'away')) {
          possessionIdsBySide[s.possession_team_side].add(String(s.possession_id));
        }
      }

      // Determine "attack" per possession team side using normalized coordinates.
      if ((s.possession_team_side === 'home' || s.possession_team_side === 'away') && s.team_side === s.possession_team_side) {
        if (statHasEnteredOpp45(s)) attacksBySide[s.possession_team_side].add(String(s.possession_id));
      }

      if (s.stat_type === 'shot') {
        out[side].shots += 1;
        const o = extra?.shot?.outcome;
        if (o === 'goal') out[side].goals += 1;
        if (o === 'point') out[side].points1 += 1;
        if (o === '2_point') out[side].points2 += 1;
      }

      if (s.stat_type === 'pass') out[side].passes += 1;
      if (s.stat_type === 'carry') out[side].carries += 1;

      if (s.stat_type === 'carry') {
        if (extra?.carry?.take_on_attempted) out[side].takeOnsAttempted += 1;
        if (extra?.carry?.take_on_attempted && extra?.carry?.take_on_completed) out[side].takeOnsCompleted += 1;
      }

      if (s.stat_type === 'defensive_contact') out[side].defensiveActions += 1;

      if (s.stat_type === 'kickout') {
        out[side].kickoutsTaken += 1;
        const o = extra?.kickout?.outcome;
        const won = extra?.kickout?.won_by;
        if ((o === 'clean' || o === 'break') && won?.team_side && (won.team_side === 'home' || won.team_side === 'away')) {
          out[won.team_side].kickoutsWon += 1;
        }

        // "Own" kickouts: taken by the team that is restarting (extra.kickout.team_side).
        const koTeam = extra?.kickout?.team_side;
        if (koTeam === 'home' || koTeam === 'away') {
          out[koTeam].ownKickoutsTaken += 1;
          if ((o === 'clean' || o === 'break') && won?.team_side === koTeam) out[koTeam].ownKickoutsWon += 1;
        }
      }

      // Turnovers: count as "lost" by the lost_by selection when present.
      const turnover = extra?.turnover;
      if (s.stat_type === 'turnover' || (turnover && typeof turnover === 'object')) {
        const lost = turnover?.lost_by;
        const rec = turnover?.recovered_by;
        if (lost?.team_side === 'home' || lost?.team_side === 'away') {
          out[lost.team_side].turnovers += 1;
        } else {
          // Fallback: attribute to acting team.
          out[side].turnovers += 1;
        }
        if (rec?.team_side === 'home' || rec?.team_side === 'away') {
          out[rec.team_side].turnoversWon += 1;
        }
      }
    }

    out.home.totalPoints = out.home.goals * 3 + out.home.points1 + out.home.points2 * 2;
    out.away.totalPoints = out.away.goals * 3 + out.away.points1 + out.away.points2 * 2;

    out.home.possessions = possessionIdsBySide.home.size;
    out.away.possessions = possessionIdsBySide.away.size;

    out.home.attacks = attacksBySide.home.size;
    out.away.attacks = attacksBySide.away.size;

    return out;
  }, [overviewStats]);

  const scoreTimeline = useMemo(() => {
    const list = Array.isArray(overviewStats) ? overviewStats : [];
    const scoring = [];

    for (const s of list) {
      if (!s || s.stat_type !== 'shot') continue;
      const extra = safeParseJSON(s.extra_data || '{}', {});
      const o = extra?.shot?.outcome;
      if (!['point', '2_point', 'goal'].includes(o)) continue;
      scoring.push({ s, extra, outcome: o });
    }

    if (!scoring.length) {
      return { mode: 'none', points: [] };
    }

    const allHaveTime = scoring.every((e) => Number.isFinite(Number(e.s.time_s)));
    const mode = allHaveTime ? 'time' : 'play';
    // When the user filters to a specific half, use that half's anchor so the chart "starts at 00:00".
    // In "All Halves" mode, we anchor from the first-half start.
    const preferAnchorKey = overviewHalf === 'second' ? 'second' : 'first';
    const t0 = (() => {
      const v = Number(halfAnchors?.[preferAnchorKey]);
      if (Number.isFinite(v)) return v;
      const v1 = Number(halfAnchors?.first);
      if (Number.isFinite(v1)) return v1;
      return 0;
    })();

    const getX = (e) => {
      if (mode === 'time') return Math.max(0, Number(e.s.time_s) - t0);
      return Number.isFinite(Number(e.s.play_id)) ? Number(e.s.play_id) : 0;
    };

    scoring.sort((a, b) => getX(a) - getX(b));

    let homeTotal = 0, awayTotal = 0;
    let homeGoals = 0, awayGoals = 0;
    let homePts = 0, awayPts = 0; // points (1p + 2p*2), excludes goals

    const points = [];
    points.push({
      x: 0,
      home_total: 0,
      away_total: 0,
      home_goals: 0,
      away_goals: 0,
      home_points: 0,
      away_points: 0,
      label: mode === 'time' ? '00:00' : '0',
    });

    for (const e of scoring) {
      const side = e.s.team_side === 'away' ? 'away' : 'home';
      const add = e.outcome === 'goal' ? 3 : (e.outcome === '2_point' ? 2 : 1);
      if (side === 'home') {
        homeTotal += add;
        if (e.outcome === 'goal') homeGoals += 1;
        else homePts += add;
      } else {
        awayTotal += add;
        if (e.outcome === 'goal') awayGoals += 1;
        else awayPts += add;
      }

      const x = getX(e);
      points.push({
        x,
        home_total: homeTotal,
        away_total: awayTotal,
        home_goals: homeGoals,
        away_goals: awayGoals,
        home_points: homePts,
        away_points: awayPts,
        label: mode === 'time' ? formatMMSS(x) : String(x),
      });
    }

    const htX = (() => {
      if (mode !== 'time') return null;
      if (overviewHalf !== 'all') return null;
      const second = Number(halfAnchors?.second);
      if (!Number.isFinite(second)) return null;
      return Math.max(0, second - t0);
    })();

    return { mode, points, htX };
  }, [overviewStats, halfAnchors, overviewHalf]);

  const overviewAttackOutcome = useMemo(() => {
    const groups = groupByPossession(overviewStats);
    const outcomes = {
      home: { Goal: 0, '2 Point': 0, '1 Point': 0, Miss: 0, Turnover: 0 },
      away: { Goal: 0, '2 Point': 0, '1 Point': 0, Miss: 0, Turnover: 0 },
    };

    for (const [key, evs] of groups.entries()) {
      const [teamSide] = String(key).split('-');
      if (teamSide !== 'home' && teamSide !== 'away') continue;
      if (!possessionHasOpp45Entry(evs, teamSide)) continue; // attack = entry to opp 45 (one per possession)
      const acting = (Array.isArray(evs) ? evs : []).filter((e) => e && e.team_side === teamSide);
      const shots = acting.filter((e) => e.stat_type === 'shot');
      let scoreType = '';
      for (const e of shots) {
        const ex = safeParseJSON(e.extra_data || '{}', {});
        const o = String(ex?.shot?.outcome || '');
        if (o === 'goal') { scoreType = 'Goal'; break; }
        if (o === '2_point') scoreType = scoreType || '2 Point';
        if (o === 'point') scoreType = scoreType || '1 Point';
      }
      if (scoreType) outcomes[teamSide][scoreType] += 1;
      else if (shots.length) outcomes[teamSide].Miss += 1;
      else outcomes[teamSide].Turnover += 1;
    }

    const data = [
      { team: homeTeam?.name || 'Home', side: 'home', ...outcomes.home },
      { team: awayTeam?.name || 'Away', side: 'away', ...outcomes.away },
    ];
    return { outcomes, data };
  }, [overviewStats, homeTeam, awayTeam]);

  const overviewMomentum = useMemo(() => {
    const list = Array.isArray(overviewStats) ? overviewStats : [];
    const withTime = list.filter((s) => Number.isFinite(Number(s?.normalized_time_s)));
    if (!withTime.length) return { mode: 'none', rows: [] };

    const groups = groupByPossession(withTime);
    const possStartBucket = new Map(); // key -> bucket index
    for (const [k, evs] of groups.entries()) {
      const t = evs.map((e) => Number(e.normalized_time_s)).filter(Number.isFinite);
      if (!t.length) continue;
      possStartBucket.set(k, Math.floor(Math.min(...t) / 300));
    }

    const bucketStats = new Map(); // bucket -> {home:{...},away:{...}}
    const ensure = (b) => {
      const cur = bucketStats.get(b) || {
        home: { pts: 0, shots: 0, poss: new Set(), toLost: 0, possWins: 0, eff: 0 },
        away: { pts: 0, shots: 0, poss: new Set(), toLost: 0, possWins: 0, eff: 0 },
      };
      bucketStats.set(b, cur);
      return cur;
    };

    const turnoverLostSide = (s) => {
      const ex = safeParseJSON(s?.extra_data || '{}', {});
      const lost = ex?.turnover?.lost_by?.team_side;
      if (lost === 'home' || lost === 'away') return lost;
      return null;
    };

    for (const s of withTime) {
      const b = Math.floor(Math.max(0, Number(s.normalized_time_s)) / 300);
      const cur = ensure(b);

      const pid = Number(s?.possession_id);
      const pside = s?.possession_team_side;
      if (Number.isFinite(pid) && (pside === 'home' || pside === 'away')) cur[pside].poss.add(`${pside}-${pid}`);

      if (s.stat_type === 'shot') {
        const ex = safeParseJSON(s.extra_data || '{}', {});
        const o = ex?.shot?.outcome;
        const add = shotPointsForOutcome(o);
        if (s.team_side === 'home') {
          cur.home.shots += 1;
          cur.home.pts += add;
        }
        if (s.team_side === 'away') {
          cur.away.shots += 1;
          cur.away.pts += add;
        }
      }

      if (s.stat_type === 'turnover' || safeParseJSON(s?.extra_data || '{}', {})?.turnover) {
        const lostSide = turnoverLostSide(s);
        if (lostSide) cur[lostSide].toLost += 1;
      }
    }

    // Possession wins (start-of-possession, best-effort): count possessions whose start bucket is b
    for (const [k, b] of possStartBucket.entries()) {
      const side = String(k).startsWith('away-') ? 'away' : 'home';
      const cur = ensure(b);
      cur[side].possWins += 1;
    }

    const buckets = Array.from(bucketStats.keys()).sort((a, b) => a - b);
    const rows = buckets.map((b) => {
      const cur = bucketStats.get(b);
      const homePoss = cur.home.poss.size;
      const awayPoss = cur.away.poss.size;

      const homeProd = homePoss ? cur.home.pts / homePoss : 0;
      const awayProd = awayPoss ? cur.away.pts / awayPoss : 0;

      const homeTC = homePoss ? (1 - cur.home.toLost / homePoss) : 0;
      const awayTC = awayPoss ? (1 - cur.away.toLost / awayPoss) : 0;

      const homeEff = cur.home.shots ? (cur.home.pts / cur.home.shots) : 0;
      const awayEff = cur.away.shots ? (cur.away.pts / cur.away.shots) : 0;

      const share = (a, b) => {
        const d = a + b;
        if (!Number.isFinite(d) || d <= 0) return 0.5;
        return a / d;
      };

      const pointShareHome = share(cur.home.pts, cur.away.pts);
      const prodShareHome = share(homeProd, awayProd);
      const tcShareHome = share(homeTC, awayTC);
      const pwShareHome = share(cur.home.possWins, cur.away.possWins);
      const effShareHome = share(homeEff, awayEff);

      const mHome = 100 * (0.35 * pointShareHome + 0.25 * prodShareHome + 0.20 * tcShareHome + 0.10 * pwShareHome + 0.10 * effShareHome);
      const mAway = 100 - mHome;

      return {
        bucket: b,
        label: `${b * 5}-${b * 5 + 5}`,
        home: Number.isFinite(mHome) ? mHome : 50,
        away: Number.isFinite(mAway) ? mAway : 50,
        home_pts: cur.home.pts,
        away_pts: cur.away.pts,
        home_poss: homePoss,
        away_poss: awayPoss,
        home_to: cur.home.toLost,
        away_to: cur.away.toLost,
      };
    });

    return { mode: 'time', rows };
  }, [overviewStats]);

  if (!matchId) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <Card className="max-w-md w-full">
          <CardContent className="p-6 text-center space-y-4">
            <div className="w-12 h-12 bg-slate-900 rounded-xl flex items-center justify-center mx-auto">
              <BarChart3 className="w-6 h-6 text-white" />
            </div>
            <div className="text-slate-900 font-semibold">No match selected</div>
            <Link to={createPageUrl('Home')}>
              <Button>Go to Dashboard</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link to={createPageUrl(`MatchStats?id=${matchId}`)}>
              <Button variant="ghost" size="sm" className="gap-2">
                <ArrowLeft className="w-4 h-4" /> Back
              </Button>
            </Link>
            <div className="min-w-0">
              <div className="font-semibold text-slate-900 truncate">
                {homeTeam?.name || 'Home'} vs {awayTeam?.name || 'Away'}
              </div>
              <div className="text-xs text-slate-500 truncate">
                {match?.date || ''}{match?.venue ? ` - ${match.venue}` : ''}
              </div>
            </div>
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 py-5">
        <Tabs defaultValue="summary">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <TabsList>
              <TabsTrigger value="summary">Overview</TabsTrigger>
              <TabsTrigger value="scoring">Scoring</TabsTrigger>
              <TabsTrigger value="possessions">Possessions / Attacks</TabsTrigger>
              <TabsTrigger value="build_up">Build-Up</TabsTrigger>
              <TabsTrigger value="kickouts">Kickouts</TabsTrigger>
              <TabsTrigger value="misc">Misc</TabsTrigger>
              <TabsTrigger value="defense">Defense</TabsTrigger>
              <TabsTrigger value="fouls">Fouls / Discipline</TabsTrigger>
              <TabsTrigger value="players_ana">Players</TabsTrigger>
              <TabsTrigger value="visualiser">Visualiser</TabsTrigger>
              <TabsTrigger value="data">Data</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="summary">
            <div className="max-w-5xl mx-auto">
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <div className="w-40" />
                    <div className="font-semibold text-slate-900 text-center flex-1">Overview</div>
                    <div className="w-40">
                      <Select value={overviewHalf} onValueChange={setOverviewHalf}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Halves</SelectItem>
                          <SelectItem value="first">1st Half</SelectItem>
                          <SelectItem value="second">2nd Half</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="pb-4">
                    <div className="flex items-center justify-between gap-2 pb-2">
                      <div className="text-sm font-semibold text-slate-900">Score Timeline</div>
                      <div className="text-xs text-slate-500">
                        {scoreTimeline.mode === 'time' ? 'Time' : (scoreTimeline.mode === 'play' ? 'Play Order' : '')}
                      </div>
                    </div>

                    {scoreTimeline.mode === 'none' ? (
                      <div className="text-xs text-slate-500">No scoring events yet.</div>
                    ) : (
                      <ChartContainer
                        id="score-timeline"
                        className="h-[220px] w-full"
                        config={{
                          home: { label: homeTeam?.name || 'Home', color: homeTeam?.color || '#22c55e' },
                          away: { label: awayTeam?.name || 'Away', color: awayTeam?.color || '#ef4444' },
                        }}
                      >
                        <LineChart data={scoreTimeline.points} margin={{ top: 10, right: 16, left: 8, bottom: 8 }}>
                          <CartesianGrid vertical={false} />
                          <XAxis
                            dataKey="x"
                            tickFormatter={(v) => (scoreTimeline.mode === 'time' ? formatMMSS(Number(v)) : String(v))}
                            className="text-xs"
                          />
                          <YAxis allowDecimals={false} className="text-xs" />
                          <Tooltip
                            cursor={{ stroke: '#cbd5e1' }}
                            content={
                              <ChartTooltipContent
                                indicator="line"
                                formatter={(value, name, item) => {
                                  const isHome = name === 'home_total' || name === 'home';
                                  const row = item?.payload;
                                  const goals = isHome ? row?.home_goals : row?.away_goals;
                                  const pts = isHome ? row?.home_points : row?.away_points;
                                  const label = isHome ? (homeTeam?.name || 'Home') : (awayTeam?.name || 'Away');
                                  return (
                                    <div className="flex w-full justify-between gap-4">
                                      <span className="text-muted-foreground">{label}</span>
                                      <span className="font-mono font-medium tabular-nums text-foreground">
                                        {Number(value)} ({goals}:{pts})
                                      </span>
                                    </div>
                                  );
                                }}
                                labelFormatter={(_, payload) => {
                                  const row = payload?.[0]?.payload;
                                  const x = Number(row?.x);
                                  return scoreTimeline.mode === 'time' ? `Time: ${formatMMSS(x)}` : `Play: ${String(x)}`;
                                }}
                              />
                            }
                          />
                          {Number.isFinite(Number(scoreTimeline.htX)) && (
                            <ReferenceLine x={Number(scoreTimeline.htX)} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: 'HT', position: 'insideTop', fill: '#475569', fontSize: 10 }} />
                          )}
                          <Line
                            type="stepAfter"
                            dataKey="home_total"
                            name="home_total"
                            stroke="var(--color-home)"
                            strokeWidth={2}
                            dot={false}
                            isAnimationActive={false}
                          />
                          <Line
                            type="stepAfter"
                            dataKey="away_total"
                            name="away_total"
                            stroke="var(--color-away)"
                            strokeWidth={2}
                            dot={false}
                            isAnimationActive={false}
                          />
                        </LineChart>
                      </ChartContainer>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-3 text-xs text-slate-600 pt-2">
                    <div className="inline-flex items-center gap-2 min-w-0">
                      <span className="inline-block w-2 h-2 rounded-full" style={{ background: homeTeam?.color || '#22c55e' }} />
                      <span className="truncate">{homeTeam?.name || 'Home'}</span>
                    </div>
                    <div className="font-medium">Metric</div>
                    <div className="inline-flex items-center gap-2 min-w-0 justify-end">
                      <span className="truncate">{awayTeam?.name || 'Away'}</span>
                      <span className="inline-block w-2 h-2 rounded-full" style={{ background: awayTeam?.color || '#ef4444' }} />
                    </div>
                  </div>

                  <div className="grid gap-2 pt-2">
                    {(() => {
                      const homePts = summary.home.points1 + summary.home.points2 * 2;
                      const awayPts = summary.away.points1 + summary.away.points2 * 2;
                      const homeScores = summary.home.goals + summary.home.points1 + summary.home.points2;
                      const awayScores = summary.away.goals + summary.away.points1 + summary.away.points2;
                      const metrics = [
                        {
                          label: 'Score',
                          home: `${summary.home.goals}:${homePts} (${summary.home.totalPoints})`,
                          away: `${summary.away.goals}:${awayPts} (${summary.away.totalPoints})`,
                          strong: true,
                        },
                        { label: 'Shots', home: summary.home.shots, away: summary.away.shots },
                        {
                          label: 'Shot Conversion %',
                          home: summary.home.shots ? formatPct((homeScores / summary.home.shots) * 100) : 'NA',
                          away: summary.away.shots ? formatPct((awayScores / summary.away.shots) * 100) : 'NA',
                        },
                        {
                          label: 'Own Kickout Win %',
                          home: (() => {
                            const taken = summary.home.ownKickoutsTaken;
                            const won = summary.home.ownKickoutsWon;
                            const pct = taken ? (won / taken) * 100 : NaN;
                            return `${won} / ${taken} (${formatPct(pct)})`;
                          })(),
                          away: (() => {
                            const taken = summary.away.ownKickoutsTaken;
                            const won = summary.away.ownKickoutsWon;
                            const pct = taken ? (won / taken) * 100 : NaN;
                            return `${won} / ${taken} (${formatPct(pct)})`;
                          })(),
                        },
                        {
                          label: 'Turnover Differential',
                          home: summary.home.turnoversWon - summary.home.turnovers,
                          away: summary.away.turnoversWon - summary.away.turnovers,
                        },
                        {
                          label: 'Points Per Possession',
                          home: summary.home.possessions ? (summary.home.totalPoints / summary.home.possessions).toFixed(2) : 'NA',
                          away: summary.away.possessions ? (summary.away.totalPoints / summary.away.possessions).toFixed(2) : 'NA',
                        },
                        {
                          label: 'Points Per Shot',
                          home: summary.home.shots ? (summary.home.totalPoints / summary.home.shots).toFixed(2) : 'NA',
                          away: summary.away.shots ? (summary.away.totalPoints / summary.away.shots).toFixed(2) : 'NA',
                        },
                      ];

                      return metrics.map((m) => (
                        <div
                          key={m.label}
                          className="rounded-lg border border-slate-200 bg-white px-3 py-2"
                        >
                          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                            <div className={`text-left tabular-nums ${m.strong ? 'font-semibold text-slate-900' : 'text-slate-900'}`}>
                              {m.home}
                            </div>
                            <div className="text-center text-xs font-medium text-slate-600">
                              {m.label}
                            </div>
                            <div className={`text-right tabular-nums ${m.strong ? 'font-semibold text-slate-900' : 'text-slate-900'}`}>
                              {m.away}
                            </div>
                          </div>
                        </div>
                      ));
                    })()}
                  </div>

                  <div className="pt-5 space-y-4">
                    <Card>
                      <CardContent className="p-4 space-y-3">
                        <div className="font-semibold text-slate-900">Momentum</div>
                        {overviewMomentum.mode === 'none' ? (
                          <div className="text-xs text-slate-500">No timeline data available (no normalized time values).</div>
                        ) : (
                          <ChartContainer
                            id="momentum"
                            className="h-[220px] w-full"
                            config={{
                              home: { label: homeTeam?.name || 'Home', color: homeTeam?.color || '#22c55e' },
                              away: { label: awayTeam?.name || 'Away', color: awayTeam?.color || '#ef4444' },
                            }}
                          >
                            <BarChart data={overviewMomentum.rows} margin={{ top: 10, right: 16, left: 0, bottom: 6 }}>
                              <CartesianGrid vertical={false} />
                              <XAxis dataKey="label" className="text-xs" />
                              <YAxis className="text-xs" domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                              <Tooltip content={<ChartTooltipContent />} />
                              <Legend />
                              <Bar dataKey="home" stackId="a" fill={homeTeam?.color || '#22c55e'} radius={[4, 4, 0, 0]} />
                              <Bar dataKey="away" stackId="a" fill={awayTeam?.color || '#ef4444'} radius={[4, 4, 0, 0]} />
                            </BarChart>
                          </ChartContainer>
                        )}
                        <div className="text-[11px] text-slate-500">Composite share by 5-minute windows (points, productivity, turnover control, possession wins, efficiency).</div>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardContent className="p-4 space-y-3">
                        <div className="font-semibold text-slate-900">Attack Outcomes</div>
                        <div className="text-xs text-slate-500">Attack = possession that enters the opposition 45 (x >= {OPP_45_X}).</div>
                        <ChartContainer
                          id="attack-outcomes"
                          className="h-[240px] w-full"
                          config={{}}
                        >
                          <BarChart data={overviewAttackOutcome.data} margin={{ top: 10, right: 16, left: 0, bottom: 6 }}>
                            <CartesianGrid vertical={false} />
                            <XAxis dataKey="team" className="text-xs" />
                            <YAxis allowDecimals={false} className="text-xs" />
                            <Tooltip content={<ChartTooltipContent />} />
                            <Legend />
                            {[
                              { k: 'Goal', c: '#1d4ed8' },
                              { k: '2 Point', c: '#6366f1' },
                              { k: '1 Point', c: '#0ea5e9' },
                              { k: 'Miss', c: '#64748b' },
                              { k: 'Turnover', c: '#dc2626' },
                            ].map((o) => (
                              <Bar key={o.k} dataKey={o.k} stackId="a" fill={o.c} />
                            ))}
                          </BarChart>
                        </ChartContainer>
                      </CardContent>
                    </Card>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="visualiser">
            <div className="grid lg:grid-cols-[340px_1fr] gap-4">
              <Card>
                <CardContent className="p-4 space-y-3">
                  <div className="font-semibold text-slate-900">Filters</div>

                  <div className="space-y-1">
                    <Label className="text-xs text-slate-600">Team</Label>
                    <Select value={vizTeam} onValueChange={setVizTeam}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="both">Both</SelectItem>
                        <SelectItem value="home">{homeTeam?.name || 'Home'}</SelectItem>
                        <SelectItem value="away">{awayTeam?.name || 'Away'}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <MultiSelect
                    label="Action"
                    values={vizActions}
                    onChange={setVizActions}
                    options={['shot', 'kickout', 'pass', 'carry', 'turnover', 'foul', 'defensive_contact', 'throw_in'].map((v) => ({ value: v, label: toTitleCase(v) }))}
                  />

                  <MultiSelect
                    label="Half"
                    values={vizHalves}
                    onChange={setVizHalves}
                    options={['first', 'second', 'et_first', 'et_second'].map((v) => ({ value: v, label: toTitleCase(v) }))}
                  />

                  <MultiSelect
                    label="Counter Attack"
                    placeholder="Any"
                    values={vizCounters}
                    onChange={setVizCounters}
                    options={[
                      { value: 'yes', label: 'Yes' },
                      { value: 'no', label: 'No' },
                    ]}
                  />

                  <MultiSelect
                    label="Player"
                    values={vizPlayerIds}
                    onChange={setVizPlayerIds}
                    options={playerOptions.map((p) => ({ value: p.id, label: (p.team_side === 'away' ? 'Away: ' : 'Home: ') + p.label }))}
                  />

                  <div className="space-y-1">
                    <Label className="text-xs text-slate-600">Color By</Label>
                    <Select value={vizColorBy} onValueChange={setVizColorBy}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="team">Team</SelectItem>
                        <SelectItem value="action">Action</SelectItem>
                        <SelectItem value="outcome">Outcome</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="text-xs text-slate-500 pt-2">
                    Showing {filteredForViz.length} events.
                  </div>
                </CardContent>
              </Card>

              <PitchViz stats={filteredForViz} homeColor={homeTeam?.color} awayColor={awayTeam?.color} colorBy={vizColorBy} />
            </div>
          </TabsContent>

          <TabsContent value="scoring">
            <ScoringTab
              stats={filteredForReport}
              homeTeam={homeTeam}
              awayTeam={awayTeam}
              playerOptions={playerOptions}
              reportFilters={reportFilters}
            />
          </TabsContent>

          <TabsContent value="possessions">
            <PossessionsTab
              stats={filteredForReport}
              homeTeam={homeTeam}
              awayTeam={awayTeam}
              playerOptions={playerOptions}
              reportFilters={reportFilters}
            />
          </TabsContent>

          <TabsContent value="build_up">
            <BuildUpTab
              stats={filteredForReport}
              homeTeam={homeTeam}
              awayTeam={awayTeam}
              playerOptions={playerOptions}
              reportFilters={reportFilters}
            />
          </TabsContent>

          <TabsContent value="kickouts">
            <RestartsTab
              stats={stats}
              homeTeam={homeTeam}
              awayTeam={awayTeam}
              playerOptions={playerOptions}
              reportFilters={reportFilters}
            />
          </TabsContent>

          <TabsContent value="misc">
            <MiscTab
              stats={stats}
              homeTeam={homeTeam}
              awayTeam={awayTeam}
              playerOptions={playerOptions}
              reportFilters={reportFilters}
            />
          </TabsContent>

          <TabsContent value="defense">
            <DefenseTab
              stats={stats}
              homeTeam={homeTeam}
              awayTeam={awayTeam}
              playerOptions={playerOptions}
              reportFilters={reportFilters}
            />
          </TabsContent>

          <TabsContent value="fouls">
            <FoulsDisciplineTab
              stats={stats}
              homeTeam={homeTeam}
              awayTeam={awayTeam}
              playerOptions={playerOptions}
              reportFilters={reportFilters}
            />
          </TabsContent>

          <TabsContent value="players_ana">
            <PlayersAnalyticsTab
              stats={stats}
              homeTeam={homeTeam}
              awayTeam={awayTeam}
              playerOptions={playerOptions}
              reportFilters={reportFilters}
            />
          </TabsContent>

          <TabsContent value="data">
            <DataTab
              matchId={matchId}
              stats={stats}
              homeTeam={homeTeam}
              awayTeam={awayTeam}
              homePlayers={homePlayers}
              awayPlayers={awayPlayers}
            />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function DataTab({ matchId, stats, homeTeam, awayTeam, homePlayers, awayPlayers }) {
  const [team, setTeam] = useState('both');
  const [actions, setActions] = useState([]); // [] means all
  const [halves, setHalves] = useState([]); // [] means all
  const [playerIds, setPlayerIds] = useState([]); // [] means any
  const [timeMin, setTimeMin] = useState(''); // minutes (string)
  const [timeMax, setTimeMax] = useState(''); // minutes (string)
  const [groupBy, setGroupBy] = useState('none'); // none|team|player|action|half|outcome|possession
  const [vizOpen, setVizOpen] = useState(false);
  const [vizTitle, setVizTitle] = useState('');
  const [vizStats, setVizStats] = useState([]);
  const [expandedRowId, setExpandedRowId] = useState(null);

  const VIDEO_PRE_ROLL_S = 7;

  const openVideoAt = (timeS) => {
    const t = Number(timeS);
    if (!matchId || !Number.isFinite(t)) return;
    const seekTo = Math.max(0, Math.floor(t - VIDEO_PRE_ROLL_S));

    // Reuse the existing video popout window (recommended) so users don't end up with multiple players.
    const url = `${window.location.origin}${window.location.pathname}#${createPageUrl(`Video?matchId=${matchId}`)}`;
    window.open(url, 'gstl_video', 'popup=yes,width=1100,height=650');

    // Ask the video popout to seek. Send a few times in case the window is still initializing.
    try {
      const ch = new BroadcastChannel('gstl_video');
      const msg = { matchId, type: 'SEEK_TO', time_s: seekTo };
      ch.postMessage(msg);
      setTimeout(() => ch.postMessage(msg), 350);
      setTimeout(() => { ch.postMessage(msg); ch.close(); }, 900);
    } catch {
      // ignore (browser/channel not available)
    }
  };

  const playerOptions = useMemo(() => {
    const all = [
      ...(homePlayers || []).map((p) => ({ ...p, team_side: 'home' })),
      ...(awayPlayers || []).map((p) => ({ ...p, team_side: 'away' })),
    ];
    const label = (p) => `#${p.number || ''} ${p.name || ''}`.trim();
    return all
      .slice()
      .sort((a, b) => (a.team_side === b.team_side ? (a.number || 0) - (b.number || 0) : (a.team_side === 'home' ? -1 : 1)))
      .map((p) => ({ id: p.id, team_side: p.team_side, label: label(p) || p.id }));
  }, [homePlayers, awayPlayers]);

  const imputedTimeById = useMemo(() => computeImputedNormalizedTimes(stats), [stats]);

  const filtered = useMemo(() => {
    const list = Array.isArray(stats) ? stats : [];
    const minM = Number(timeMin);
    const maxM = Number(timeMax);
    const minS = Number.isFinite(minM) && timeMin !== '' ? minM * 60 : null;
    const maxS = Number.isFinite(maxM) && timeMax !== '' ? maxM * 60 : null;
    return list.filter((s) => {
      if (!s) return false;
      if (team !== 'both' && s.team_side !== team) return false;
      if (actions.length && !actions.includes(s.stat_type)) return false;
      if (halves.length && !halves.includes(s.half)) return false;
      if (playerIds.length) {
        const extra = safeParseJSON(s.extra_data || '{}', {});
        const ids = collectPlayerIds(extra);
        const any = playerIds.some((id) => ids.has(id));
        if (!any) return false;
      }
      if (minS != null || maxS != null) {
        let t = Number(s.normalized_time_s);
        if (!Number.isFinite(t)) t = Number(imputedTimeById.get(s.id));
        if (!Number.isFinite(t)) return false;
        t = Math.max(0, t);
        if (minS != null && t < minS) return false;
        if (maxS != null && t > maxS) return false;
      }
      return true;
    });
  }, [stats, team, actions, halves, playerIds, timeMin, timeMax, imputedTimeById]);

  const filteredSorted = useMemo(() => {
    const list = Array.isArray(filtered) ? [...filtered] : [];
    const timeKey = (s) => {
      const tn = Number(s?.normalized_time_s);
      if (Number.isFinite(tn)) return { kind: 0, v: Math.max(0, tn) };
      const it = Number(imputedTimeById.get(s?.id));
      if (Number.isFinite(it)) return { kind: 0, v: Math.max(0, it) };
      const t = Number(s?.time_s);
      if (Number.isFinite(t)) return { kind: 0, v: t };
      const pid = Number(s?.play_id);
      if (Number.isFinite(pid)) return { kind: 1, v: pid };
      const ts = Date.parse(String(s?.timestamp || ''));
      if (Number.isFinite(ts)) return { kind: 2, v: ts };
      return { kind: 9, v: 0 };
    };
    list.sort((a, b) => {
      const ka = timeKey(a);
      const kb = timeKey(b);
      if (ka.kind !== kb.kind) return ka.kind - kb.kind;
      if (ka.v !== kb.v) return ka.v - kb.v;
      return String(a?.id || '').localeCompare(String(b?.id || ''));
    });
    return list;
  }, [filtered, imputedTimeById]);

  const keyForGroup = (s) => {
    const extra = safeParseJSON(s?.extra_data || '{}', {});
    if (groupBy === 'team') return s?.team_side || 'unknown';
    if (groupBy === 'action') return s?.stat_type || 'unknown';
    if (groupBy === 'half') return s?.half || 'unknown';
    if (groupBy === 'outcome') return deriveOutcome(s, extra) || 'unknown';
    if (groupBy === 'possession') {
      const pid = Number(s?.possession_id);
      const pside = s?.possession_team_side;
      if (Number.isFinite(pid) && (pside === 'home' || pside === 'away')) return `${pside}-${pid}`;
      return 'unknown';
    }
    if (groupBy === 'player') {
      if (s?.player_number) return `#${s.player_number}`;
      return 'None';
    }
    return 'unknown';
  };

  const pivot = useMemo(() => {
    if (groupBy === 'none') return null;
    const rows = new Map();

    for (const s of filtered) {
      const extra = safeParseJSON(s.extra_data || '{}', {});
      const key = keyForGroup(s);
      const cur = rows.get(key) || {
        key,
        count: 0,
        shotPoints: 0,
        // possession summary fields (only used when grouping by possession)
        start_time_s: null,
        end_time_s: null,
        start_time_norm_s: null,
        end_time_norm_s: null,
        start_action: '',
        end_action: '',
        start_half: '',
        end_half: '',
        start_source: '',
        end_outcome: '',
      };
      cur.count += 1;
      if (s.stat_type === 'shot') {
        const o = extra?.shot?.outcome;
        if (o === 'goal') cur.shotPoints += 3;
        if (o === 'point') cur.shotPoints += 1;
        if (o === '2_point') cur.shotPoints += 2;
      }

      if (groupBy === 'possession') {
        const t = Number(s?.time_s);
        if (Number.isFinite(t)) {
          cur.start_time_s = cur.start_time_s == null ? t : Math.min(cur.start_time_s, t);
          cur.end_time_s = cur.end_time_s == null ? t : Math.max(cur.end_time_s, t);
        }
        const tn = Number(s?.normalized_time_s);
        if (Number.isFinite(tn)) {
          cur.start_time_norm_s = cur.start_time_norm_s == null ? tn : Math.min(cur.start_time_norm_s, tn);
          cur.end_time_norm_s = cur.end_time_norm_s == null ? tn : Math.max(cur.end_time_norm_s, tn);
        }
        const act = s?.stat_type || '';
        const out = deriveOutcome(s, extra) || '';

        // start/end action heuristics based on play order when time is missing
        const pid = Number(s?.play_id);
        if (Number.isFinite(pid)) {
          if (cur._minPlay == null || pid < cur._minPlay) {
            cur._minPlay = pid;
            cur.start_action = act;
            cur.start_half = s?.half || '';
            cur.start_source = (() => {
              if (act === 'kickout') return 'Kickout Won';
              if (act === 'turnover') return 'Turnover Won';
              if (act === 'throw_in') return 'Throw In Won';
              if (act === 'foul') return 'Foul Won';
              if (extra?.pass?.deadball) return 'Restart';
              return toTitleCase(act);
            })();
          }
          if (cur._maxPlay == null || pid > cur._maxPlay) {
            cur._maxPlay = pid;
            cur.end_action = act;
            cur.end_half = s?.half || '';
            cur.end_outcome = out;
          }
        }
      }

      rows.set(key, cur);
    }

    const arr = Array.from(rows.values());
    if (groupBy === 'possession') {
      // Sort by start time (if available), otherwise by play order.
      arr.sort((a, b) => {
        const ta = a.start_time_s;
        const tb = b.start_time_s;
        if (ta != null && tb != null && ta !== tb) return ta - tb;
        if (a._minPlay != null && b._minPlay != null && a._minPlay !== b._minPlay) return a._minPlay - b._minPlay;
        return String(a.key).localeCompare(String(b.key));
      });
      return arr;
    }
    return arr.sort((a, b) => String(a.key).localeCompare(String(b.key)));
  }, [filtered, groupBy]);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4">
          <div className="font-semibold text-slate-900 mb-3">Filters</div>
          <div className="grid md:grid-cols-5 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-slate-600">Team</Label>
              <Select value={team} onValueChange={setTeam}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="both">Both</SelectItem>
                  <SelectItem value="home">{homeTeam?.name || 'Home'}</SelectItem>
                  <SelectItem value="away">{awayTeam?.name || 'Away'}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <MultiSelect
              label="Action"
              values={actions}
              onChange={setActions}
              options={['shot', 'kickout', 'pass', 'carry', 'turnover', 'foul', 'defensive_contact', 'throw_in'].map((v) => ({ value: v, label: toTitleCase(v) }))}
            />
            <MultiSelect
              label="Half"
              values={halves}
              onChange={setHalves}
              options={['first', 'second', 'et_first', 'et_second'].map((v) => ({ value: v, label: toTitleCase(v) }))}
            />
            <MultiSelect
              label="Player"
              placeholder="Any"
              values={playerIds}
              onChange={setPlayerIds}
              options={playerOptions.map((p) => ({ value: p.id, label: (p.team_side === 'away' ? 'Away: ' : 'Home: ') + p.label }))}
            />
            <div className="space-y-1">
              <Label className="text-xs text-slate-600">Group By</Label>
              <Select value={groupBy} onValueChange={setGroupBy}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  <SelectItem value="team">Team</SelectItem>
                  <SelectItem value="action">Action</SelectItem>
                  <SelectItem value="half">Half</SelectItem>
                  <SelectItem value="outcome">Outcome</SelectItem>
                  <SelectItem value="player">Player (Primary)</SelectItem>
                  <SelectItem value="possession">Possession</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid md:grid-cols-5 gap-3 pt-3">
            <div className="space-y-1 md:col-span-1">
              <Label className="text-xs text-slate-600">Start Time (min)</Label>
              <Input className="h-8 text-xs" inputMode="numeric" value={timeMin} onChange={(e) => setTimeMin(e.target.value)} placeholder="e.g. 0" />
            </div>
            <div className="space-y-1 md:col-span-1">
              <Label className="text-xs text-slate-600">End Time (min)</Label>
              <Input className="h-8 text-xs" inputMode="numeric" value={timeMax} onChange={(e) => setTimeMax(e.target.value)} placeholder="e.g. 35" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={vizOpen} onOpenChange={setVizOpen}>
        <DialogContent className="sm:max-w-4xl p-4">
          <DialogHeader>
            <div className="flex items-center justify-between gap-2">
              <DialogTitle className="text-base">{vizTitle || 'Visualise'}</DialogTitle>
              {(() => {
                const times = (vizStats || []).map((s) => Number(s?.time_s)).filter(Number.isFinite);
                if (!times.length) return null;
                const t = Math.min(...times);
                return (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 px-3 text-xs"
                    onClick={() => openVideoAt(t)}
                    title="Open the video popout and jump to this timestamp"
                  >
                    Open Video @ {formatMMSS(Math.max(0, t - VIDEO_PRE_ROLL_S))}
                  </Button>
                );
              })()}
            </div>
          </DialogHeader>
          <div className="pt-2">
            <PitchViz
              stats={vizStats}
              homeColor={homeTeam?.color}
              awayColor={awayTeam?.color}
              colorBy="team"
              showColorControls={false}
            />
          </div>
        </DialogContent>
      </Dialog>

      {pivot ? (
        <Card>
          <CardContent className="p-4">
            <div className="font-semibold text-slate-900 mb-3">Pivot</div>
            <Table>
              <TableHeader>
                <TableRow>
                  {groupBy === 'possession' ? (
                    <>
                      <TableHead>Possession</TableHead>
                      <TableHead>Team</TableHead>
                      <TableHead>Half</TableHead>
                      <TableHead className="text-right">Start</TableHead>
                      <TableHead className="text-right">End</TableHead>
                      <TableHead className="text-right">Dur</TableHead>
                      <TableHead>Start Source</TableHead>
                      <TableHead>End</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                      <TableHead className="text-right">Shot Pts</TableHead>
                    </>
                  ) : (
                    <>
                      <TableHead>{toTitleCase(groupBy)}</TableHead>
                      <TableHead>Count</TableHead>
                      <TableHead>Shot Points</TableHead>
                    </>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {pivot.map((r) => (
                  <TableRow
                    key={r.key}
                    className="cursor-pointer"
                    onClick={() => {
                      const groupStats = filtered.filter((s) => keyForGroup(s) === r.key);
                      setVizStats(groupStats);
                      if (groupBy === 'possession') {
                        const [side, num] = String(r.key || '').split('-');
                        const teamName = side === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home');
                        setVizTitle(`Possession ${num || ''} - ${teamName} - ${groupStats.length} events`);
                      } else {
                        setVizTitle(`${toTitleCase(groupBy)}: ${toTitleCase(r.key)} (${groupStats.length})`);
                      }
                      setVizOpen(true);
                    }}
                  >
                    {groupBy === 'possession' ? (
                      (() => {
                        const [side, num] = String(r.key || '').split('-');
                        const teamName = side === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home');
                        const start = Number.isFinite(Number(r.start_time_norm_s)) ? formatMMSS(Number(r.start_time_norm_s)) : 'NA';
                        const end = Number.isFinite(Number(r.end_time_norm_s)) ? formatMMSS(Number(r.end_time_norm_s)) : 'NA';
                        const dur = (Number.isFinite(Number(r.start_time_norm_s)) && Number.isFinite(Number(r.end_time_norm_s)))
                          ? `${Math.max(0, Number(r.end_time_norm_s) - Number(r.start_time_norm_s)).toFixed(1)}s`
                          : 'NA';
                        const endLabel = [toTitleCase(r.end_action), r.end_outcome ? `(${toTitleCase(r.end_outcome)})` : ''].filter(Boolean).join(' ');
                        return (
                          <>
                            <TableCell className="font-mono text-xs">#{num || 'NA'}</TableCell>
                            <TableCell className="font-medium">{teamName}</TableCell>
                            <TableCell>{toTitleCase(r.start_half || '')}</TableCell>
                            <TableCell className="text-right font-mono text-xs">{start}</TableCell>
                            <TableCell className="text-right font-mono text-xs">{end}</TableCell>
                            <TableCell className="text-right font-mono text-xs">{dur}</TableCell>
                            <TableCell>{r.start_source || 'NA'}</TableCell>
                            <TableCell>{endLabel || 'NA'}</TableCell>
                            <TableCell className="text-right tabular-nums">{r.count}</TableCell>
                            <TableCell className="text-right tabular-nums">{r.shotPoints}</TableCell>
                          </>
                        );
                      })()
                    ) : (
                      <>
                        <TableCell className="font-medium">{toTitleCase(r.key)}</TableCell>
                        <TableCell>{r.count}</TableCell>
                        <TableCell>{r.shotPoints}</TableCell>
                      </>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="font-semibold text-slate-900">Rows</div>
              <div className="text-xs text-slate-500">{filteredSorted.length} rows</div>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[36px]"> </TableHead>
                  <TableHead>Half</TableHead>
                  <TableHead>Team</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Outcome</TableHead>
                  <TableHead>Player</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead className="w-[90px]"> </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSorted.slice(0, 200).map((s) => {
                  const extra = safeParseJSON(s.extra_data || '{}', {});
                  const t = Number(s?.time_s);
                  const hasTime = Number.isFinite(t);
                  const isOpen = expandedRowId === s.id;
                  return (
                    <React.Fragment key={s.id}>
                      <TableRow>
                        <TableCell className="align-middle">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            aria-label={isOpen ? 'Collapse row' : 'Expand row'}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setExpandedRowId((cur) => (cur === s.id ? null : s.id));
                            }}
                          >
                            <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                          </Button>
                        </TableCell>
                        <TableCell>{toTitleCase(s.half)}</TableCell>
                        <TableCell>{s.team_side === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home')}</TableCell>
                        <TableCell>{toTitleCase(s.stat_type)}</TableCell>
                        <TableCell>{toTitleCase(deriveOutcome(s, extra))}</TableCell>
                        <TableCell>{s.player_number ? `#${s.player_number}` : ''}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {Number.isFinite(Number(s.normalized_time_s)) ? formatMMSS(Number(s.normalized_time_s)) : '--:--'}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              disabled={!hasTime}
                              title={hasTime ? `Open video at ${formatMMSS(Math.max(0, t - VIDEO_PRE_ROLL_S))}` : 'No video time recorded for this row'}
                              onClick={() => hasTime && openVideoAt(t)}
                            >
                              Open Video
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() => {
                                setVizStats([s]);
                                setVizTitle(`${toTitleCase(s.stat_type)} - ${toTitleCase(s.half)} - ${s.team_side === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home')}`);
                                setVizOpen(true);
                              }}
                            >
                              Visualise
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>

                      {isOpen && (
                        <TableRow className="bg-slate-50/60">
                          <TableCell colSpan={8} className="p-3">
                            {(() => {
                              const baseItems = [
                                { label: 'Play', value: Number.isFinite(Number(s.play_id)) ? String(Number(s.play_id)) : 'NA' },
                                { label: 'Possession', value: Number.isFinite(Number(s.possession_id)) ? String(Number(s.possession_id)) : 'NA' },
                                { label: 'Possession Team', value: s.possession_team_side === 'away' ? (awayTeam?.name || 'Away') : (s.possession_team_side === 'home' ? (homeTeam?.name || 'Home') : 'NA') },
                                { label: 'Counter Attack', value: s.counter_attack ? 'Yes' : 'No' },
                                { label: 'Video', value: Number.isFinite(Number(s.time_s)) ? formatMMSS(Number(s.time_s)) : 'NA' },
                                { label: 'Time', value: (() => {
                                  const t = Number(s.normalized_time_s);
                                  if (Number.isFinite(t)) return formatMMSS(Math.max(0, t));
                                  const it = Number(imputedTimeById.get(s.id));
                                  return Number.isFinite(it) ? formatMMSS(Math.max(0, it)) : 'NA';
                                })() },
                                { label: 'X, Y', value: Number.isFinite(Number(s.x_position)) && Number.isFinite(Number(s.y_position)) ? `${Number(s.x_position).toFixed(2)}, ${Number(s.y_position).toFixed(2)}` : 'NA' },
                                { label: 'End X, Y', value: Number.isFinite(Number(s.end_x_position)) && Number.isFinite(Number(s.end_y_position)) ? `${Number(s.end_x_position).toFixed(2)}, ${Number(s.end_y_position).toFixed(2)}` : 'NA' },
                                { label: 'Raw X, Y', value: Number.isFinite(Number(s.raw_x_position)) && Number.isFinite(Number(s.raw_y_position)) ? `${Number(s.raw_x_position).toFixed(2)}, ${Number(s.raw_y_position).toFixed(2)}` : 'NA' },
                                { label: 'Raw End', value: Number.isFinite(Number(s.raw_end_x_position)) && Number.isFinite(Number(s.raw_end_y_position)) ? `${Number(s.raw_end_x_position).toFixed(2)}, ${Number(s.raw_end_y_position).toFixed(2)}` : 'NA' },
                              ];

                              const extraItems = flattenExtra(extra)
                                .filter((r) => r.key !== 'counter_attack') // already shown above
                                .filter((r) => !/pitch_(w|h|width|height)/i.test(String(r.key || '')))
                                .map((r) => ({ label: presentablePathLabel(r.key), value: formatExtraValue(r.value) }));

                              const seen = new Set();
                              const items = [];
                              for (const it of [...baseItems, ...extraItems]) {
                                const k = String(it.label || '');
                                if (!k || seen.has(k)) continue;
                                seen.add(k);
                                items.push(it);
                              }

                              const pairs = [];
                              for (let i = 0; i < items.length; i += 2) {
                                pairs.push([items[i], items[i + 1] || null]);
                              }

                              return (
                                <div className="rounded-lg border border-slate-200 bg-white p-3">
                                  <div className="text-xs font-semibold text-slate-900 mb-2">Details</div>
                                  <div className="max-h-56 overflow-auto rounded-md border border-slate-200">
                                    <Table>
                                      <TableBody>
                                        {pairs.map(([a, b], idx) => (
                                          <TableRow key={idx}>
                                            <TableCell className="py-1 text-xs text-slate-500 whitespace-nowrap">{a.label}</TableCell>
                                            <TableCell className="py-1 text-xs font-mono tabular-nums">{a.value}</TableCell>
                                            <TableCell className="py-1 text-xs text-slate-500 whitespace-nowrap">{b ? b.label : ''}</TableCell>
                                            <TableCell className="py-1 text-xs font-mono tabular-nums">{b ? b.value : ''}</TableCell>
                                          </TableRow>
                                        ))}
                                      </TableBody>
                                    </Table>
                                  </div>
                                </div>
                              );
                            })()}
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  );
                })}
              </TableBody>
            </Table>
            {filteredSorted.length > 200 && (
              <div className="text-xs text-slate-500 pt-2">Showing first 200 rows. Add a group-by to summarise.</div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
