import React, { useEffect, useMemo, useState } from 'react';
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
  PITCH_W,
  PITCH_H,
  OPP_45_X,
  calcAngleToGoal,
  calcDistanceToGoal,
  classifyTerminalOutcome,
  derivePossessionOutcome as derivePossessionOutcomeShared,
  extractFoulFromStat,
  findScorableFreeConcededRows,
  getAttackEntryChannelForPossession,
  getFieldTiltContribution,
  getMatchSectionOffsets,
  getMatchTimeS,
  getProgressiveMeters,
  getScoringZoneEntry,
  isAttackPossession,
  isProgressive as isProgressiveShared,
  shotOutcomeGroup,
  shotPointsForOutcome,
  statHasEnteredOpp45,
  normalizeFoulType,
} from '@/lib/reportAnalytics';
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
  return null;
}

function getPrimaryActorSelection(stat, extra) {
  if (!stat) return null;
  if (stat.stat_type === 'shot') return extra?.shot?.player || null;
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
          out.push({ passer, shot, possessionKey: key, teamSide });
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

function DirectionBadge({ className = '' }) {
  return (
    <div className={`absolute left-2 top-2 z-10 rounded-full bg-white/92 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-700 shadow-sm ${className}`}>
      Attacking -&gt;
    </div>
  );
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
        <DirectionBadge />
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
            className="relative w-full"
            style={{
              aspectRatio: `${PITCH_W / 2} / ${PITCH_H}`,
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
            className="relative w-full"
            style={{
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

function ReportFiltersCard({ reportFilters, playerOptions, homeTeam, awayTeam }) {
  const [open, setOpen] = useState(false);
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

  const activeCount =
    (reportFilters?.team && reportFilters.team !== 'both' ? 1 : 0)
    + (Array.isArray(reportFilters?.halves) ? reportFilters.halves.length : 0)
    + (Array.isArray(reportFilters?.playerIds) ? reportFilters.playerIds.length : 0)
    + effectiveActionValues.length
    + effectiveOutcomeValues.length
    + (String(reportFilters?.timeMin ?? '') !== '' ? 1 : 0)
    + (String(reportFilters?.timeMax ?? '') !== '' ? 1 : 0);

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-semibold text-slate-900">Filters</div>
            {!open && (
              <div className="text-[11px] text-slate-500">
                {activeCount ? `${activeCount} active` : 'Collapsed'}
              </div>
            )}
          </div>
          <Button type="button" variant="outline" size="sm" className="h-8 px-2 text-xs" onClick={() => setOpen((v) => !v)}>
            {open ? 'Hide Filters' : 'Show Filters'}
            <ChevronDown className={`ml-1 h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
          </Button>
        </div>

        {!open ? null : (
        <>
        {/* Vertical filters to keep things consistent across all tabs (and reduce horizontal squeeze). */}
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
        </>
        )}
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
          <DirectionBadge />
          <svg className="absolute inset-0 w-full h-full" viewBox={`0 0 ${PITCH_W} ${PITCH_H}`} preserveAspectRatio="none">
            {visible.map((s) => {
              const x = Number(s.x);
              const y = Number(s.y);
              if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
              const g = shotOutcomeGroup(s.outcome);
              const outcomeColor = colors[g] || colors.other;
              const teamColor = s.team_side === 'away' ? (awayColor || '#ef4444') : (homeColor || '#2563eb');
              const fillColor = teamMode === 'both' ? teamColor : outcomeColor;
              const strokeColor = teamMode === 'both' ? outcomeColor : '#ffffff';
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
                s.possessionLabel ? `Possession: ${s.possessionLabel}` : null,
              ].filter(Boolean).join('\n');

              if (shape === 'goal') {
                return (
                  <rect
                    key={s.id}
                    x={x - size}
                    y={y - size}
                    width={size * 2}
                    height={size * 2}
                    fill={fillColor}
                    opacity="0.9"
                    stroke={strokeColor}
                    strokeWidth={teamMode === 'both' ? '1.2' : '0.6'}
                  >
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
                    fill={fillColor}
                    opacity="0.9"
                    transform={`rotate(45 ${x} ${y})`}
                    stroke={strokeColor}
                    strokeWidth={teamMode === 'both' ? '1.2' : '0.6'}
                  >
                    <title>{tip}</title>
                  </rect>
                );
              }
              return (
                <circle key={s.id} cx={x} cy={y} r={size} fill={fillColor} opacity="0.9" stroke={strokeColor} strokeWidth={teamMode === 'both' ? '1.2' : '0.6'}>
                  <title>{tip}</title>
                </circle>
              );
            })}
          </svg>
        </div>

        <div className="text-[11px] text-slate-500">
          Shape: circle = 1 point, diamond = 2 point, square = goal. {teamMode === 'both' ? 'Fill = team, outline = outcome group.' : 'Colour = outcome group.'}
        </div>
      </CardContent>
    </Card>
  );
}

function ScoringTab({ stats, homeTeam, awayTeam, playerOptions, reportFilters }) {
  const scopedReportFilters = useMemo(() => ({ ...reportFilters, allowedActionTypes: ['shot'] }), [reportFilters]);
  const teamMode = String(reportFilters?.team || 'both');
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
    const calc = (side) => {
      const sh = filteredShots.filter((s) => s.team_side === side);
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
      const fromPlayPct = shotsN ? (play.length / shotsN) * 100 : NaN;
      const placed = sh.filter((s) => s.isPlacedBall);
      const placedScores = placed.filter((s) => s.isScore).length;
      const placedConv = placed.length ? (placedScores / placed.length) * 100 : NaN;
      const lowPressure = sh.filter((s) => String(s.pressure) === 'low').length;
      const typeBreakdown = ['point', '2_point', 'goal'].reduce((acc, type) => {
        const attempts = sh.filter((s) => s.shotType === type).length;
        const scored = sh.filter((s) => s.shotType === type && s.outcome === type).length;
        acc[type] = { attempts, scored };
        return acc;
      }, {});
      return {
        shotsN,
        scoresN,
        conv,
        pps,
        avgDist,
        playConv,
        fromPlayPct,
        placedConv,
        lowPressurePct: shotsN ? (lowPressure / shotsN) * 100 : NaN,
        typeBreakdown,
      };
    };
    return { home: calc('home'), away: calc('away') };
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
      if (teamMode !== 'both' && s.team_side !== teamMode) continue;
      const key = s.playerId || s.playerLabel || 'NA';
      const cur = rows.get(key) || {
        key,
        player: s.playerLabel || 'NA',
        shots: 0,
        scores: 0,
        points: 0,
        distSum: 0,
        distN: 0,
        pointMade: 0,
        pointAtt: 0,
        twoMade: 0,
        twoAtt: 0,
        goalMade: 0,
        goalAtt: 0,
        playShots: 0,
        placedShots: 0,
      };
      cur.shots += 1;
      if (s.isScore) cur.scores += 1;
      cur.points += s.points || 0;
      if (Number.isFinite(s.distance)) { cur.distSum += s.distance; cur.distN += 1; }
      if (s.shotType === 'point') { cur.pointAtt += 1; if (s.outcome === 'point') cur.pointMade += 1; }
      if (s.shotType === '2_point') { cur.twoAtt += 1; if (s.outcome === '2_point') cur.twoMade += 1; }
      if (s.shotType === 'goal') { cur.goalAtt += 1; if (s.outcome === 'goal') cur.goalMade += 1; }
      if (s.isFromPlay) cur.playShots += 1;
      if (s.isPlacedBall) cur.placedShots += 1;
      rows.set(key, cur);
    }
    const out = Array.from(rows.values()).map((r) => ({
      ...r,
      conv: r.shots ? (r.scores / r.shots) * 100 : NaN,
      pps: r.shots ? r.points / r.shots : NaN,
      avgDist: r.distN ? r.distSum / r.distN : NaN,
    }));
    out.sort((a, b) => b.points - a.points);
    return out;
  }, [filteredShots, teamMode]);

  const display = (selector) => {
    if (teamMode === 'home') return selector(kpis.home);
    if (teamMode === 'away') return selector(kpis.away);
    return `${selector(kpis.home)} / ${selector(kpis.away)}`;
  };

  const pieColors = {
    score: '#2563eb',
    wide: '#334155',
    short: '#64748b',
    saved: '#f59e0b',
    blocked: '#dc2626',
    post: '#7c3aed',
  };

  return (
    <div className="grid lg:grid-cols-[300px_minmax(0,1fr)] gap-4">
      <div className="space-y-4 min-w-0">
        <ReportFiltersCard reportFilters={scopedReportFilters} playerOptions={playerOptions} homeTeam={homeTeam} awayTeam={awayTeam} />

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
            { label: 'Shots', value: display((k) => String(k.shotsN)) },
            { label: 'Scores', value: display((k) => String(k.scoresN)) },
            { label: 'Shot Conversion %', value: display((k) => formatPct(k.conv)) },
            { label: 'Points Per Shot', value: display((k) => Number.isFinite(k.pps) ? k.pps.toFixed(2) : 'NA') },
            { label: 'Average Shot Distance', value: display((k) => Number.isFinite(k.avgDist) ? k.avgDist.toFixed(1) : 'NA') },
            { label: 'Play-Shot Conversion %', value: display((k) => formatPct(k.playConv)) },
            { label: '% Shots From Play', value: display((k) => formatPct(k.fromPlayPct)) },
            { label: 'Placed-Ball Conversion %', value: display((k) => formatPct(k.placedConv)) },
            { label: '1 Point Scores', value: display((k) => `${k.typeBreakdown.point.scored}/${k.typeBreakdown.point.attempts}`) },
            { label: '2 Point Scores', value: display((k) => `${k.typeBreakdown['2_point'].scored}/${k.typeBreakdown['2_point'].attempts}`) },
            { label: 'Goal Scores', value: display((k) => `${k.typeBreakdown.goal.scored}/${k.typeBreakdown.goal.attempts}`) },
            { label: '% Low Pressure Shots', value: display((k) => formatPct(k.lowPressurePct)) },
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
            <ShotMap shots={filteredShots} mode={shotMapMode} setMode={setShotMapMode} teamMode={teamMode} homeColor={homeTeam?.color} awayColor={awayTeam?.color} />

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
                      <TableHead className="text-right">1 Pt</TableHead>
                      <TableHead className="text-right">2 Pt</TableHead>
                      <TableHead className="text-right">Goals</TableHead>
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
                        <TableCell className="text-right tabular-nums">{`${r.pointMade}/${r.pointAtt}`}</TableCell>
                        <TableCell className="text-right tabular-nums">{`${r.twoMade}/${r.twoAtt}`}</TableCell>
                        <TableCell className="text-right tabular-nums">{`${r.goalMade}/${r.goalAtt}`}</TableCell>
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

function PossessionsTab({ stats, homeTeam, awayTeam, playerOptions, reportFilters, onVisualisePossession }) {
  const scopedReportFilters = useMemo(() => ({ ...reportFilters, allowedActionTypes: ['pass', 'carry', 'shot', 'turnover', 'kickout', 'throw_in', 'foul'] }), [reportFilters]);
  const base = useMemo(() => applyNonTeamReportFilters(stats, scopedReportFilters), [stats, scopedReportFilters]);
  const teamMode = String(reportFilters?.team || 'both'); // both|home|away
  const [counterFilter, setCounterFilter] = useState('any'); // any|set_attack|counter_attack|counter_to_set

  const possessions = useMemo(() => {
    const groups = groupByPossession(base);

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

      const isAttack = isAttackPossession(evs, teamSide);
      const passes = acting.filter((e) => e.stat_type === 'pass' && deriveOutcome(e, safeParseJSON(e.extra_data || '{}', {})) === 'completed').length;
      const shots = acting.filter((e) => e.stat_type === 'shot').length;
      const counterState = deriveCounterAttackState(acting);
      const attackEntryChannel = isAttack ? getAttackEntryChannelForPossession(evs, teamSide) : '';
      const startZone = getPossessionStartZone(acting);

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
        counterState,
        attackEntryChannel,
        startZone,
        stats: evs,
      });
    }

    out.sort((a, b) => {
      if (Number.isFinite(a.possessionId) && Number.isFinite(b.possessionId) && a.possessionId !== b.possessionId) return a.possessionId - b.possessionId;
      if (a.teamSide !== b.teamSide) return String(a.teamSide).localeCompare(String(b.teamSide));
      return String(a.key).localeCompare(String(b.key));
    });
    return out;
  }, [base, reportFilters]);

  const possessionsFiltered = useMemo(() => {
    if (counterFilter === 'any') return possessions;
    const map = {
      set_attack: 'Set Attack',
      counter_attack: 'Counter Attack',
      counter_to_set: 'Counter -> Set',
    };
    return possessions.filter((p) => p.counterState === map[counterFilter]);
  }, [possessions, counterFilter]);

  const attacks = useMemo(() => possessionsFiltered.filter((p) => p.isAttack), [possessionsFiltered]);

  const sideKpis = useMemo(() => {
    const calc = (rows) => {
      const possN = rows.length;
      const att = rows.filter((p) => p.isAttack);
      const attN = att.length;
      const totalPts = rows.reduce((a, p) => a + (p.points || 0), 0);
      const pointsPerPossession = possN ? totalPts / possN : NaN;
      const ds = rows.map((p) => p.duration).filter(Number.isFinite);
      const avgDur = ds.length ? ds.reduce((a, b) => a + b, 0) / ds.length : NaN;
      const possToAttack = possN ? (attN / possN) * 100 : NaN;
      const possToShot = possN ? (rows.filter((p) => p.shots > 0).length / possN) * 100 : NaN;
      const attToShot = attN ? (att.filter((p) => p.shots > 0).length / attN) * 100 : NaN;
      const passesPerPoss = possN ? rows.reduce((a, p) => a + (p.passes || 0), 0) / possN : NaN;
      const scoringPoss = possN ? (rows.filter((p) => p.outcome === 'Score').length / possN) * 100 : NaN;
      const counterPoss = possN ? (rows.filter((p) => p.counterState === 'Counter Attack').length / possN) * 100 : NaN;
      const channels = { Left: 0, Middle: 0, Right: 0 };
      rows.filter((p) => p.isAttack).forEach((p) => {
        if (channels[p.attackEntryChannel] != null) channels[p.attackEntryChannel] += 1;
      });
      return { possN, attN, pointsPerPossession, avgDur, possToAttack, possToShot, attToShot, passesPerPoss, scoringPoss, counterPoss, channels };
    };
    const home = calc(possessionsFiltered.filter((p) => p.teamSide === 'home'));
    const away = calc(possessionsFiltered.filter((p) => p.teamSide === 'away'));
    return { home, away };
  }, [possessionsFiltered]);

  const display = (fmtFn) => {
    if (teamMode === 'home') return fmtFn(sideKpis.home);
    if (teamMode === 'away') return fmtFn(sideKpis.away);
    return `${fmtFn(sideKpis.home)} / ${fmtFn(sideKpis.away)}`;
  };

  const byTeam = (rows) => {
    const out = {
      home: { Score: 0, 'Missed Shot': 0, Turnover: 0, 'Half End': 0 },
      away: { Score: 0, 'Missed Shot': 0, Turnover: 0, 'Half End': 0 },
    };
    for (const r of rows) {
      const side = r.teamSide;
      if (!out[side]) continue;
      const k = String(r.outcome || 'Turnover');
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
  const attackChannelRows = useMemo(() => {
    const homeTotal = Object.values(sideKpis.home.channels || {}).reduce((a, b) => a + b, 0);
    const awayTotal = Object.values(sideKpis.away.channels || {}).reduce((a, b) => a + b, 0);
    return ['Left', 'Middle', 'Right'].map((channel) => ({
      channel,
      homeCount: sideKpis.home.channels?.[channel] || 0,
      awayCount: sideKpis.away.channels?.[channel] || 0,
      homePct: homeTotal ? ((sideKpis.home.channels?.[channel] || 0) / homeTotal) * 100 : NaN,
      awayPct: awayTotal ? ((sideKpis.away.channels?.[channel] || 0) / awayTotal) * 100 : NaN,
    }));
  }, [sideKpis]);

  return (
    <div className="grid lg:grid-cols-[300px_minmax(0,1fr)] gap-4">
      <div className="space-y-4 min-w-0">
        <ReportFiltersCard reportFilters={scopedReportFilters} playerOptions={playerOptions} homeTeam={homeTeam} awayTeam={awayTeam} />
        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="font-semibold text-slate-900">Local Filters</div>
            <div className="space-y-1">
              <Label className="text-xs text-slate-600">Counter Attack</Label>
              <Select value={counterFilter} onValueChange={setCounterFilter}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any</SelectItem>
                  <SelectItem value="set_attack">Set Attack</SelectItem>
                  <SelectItem value="counter_attack">Counter Attack</SelectItem>
                  <SelectItem value="counter_to_set">Counter -&gt; Set</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: 'Possessions', value: display((k) => String(k.possN)) },
            { label: 'Attacks', value: display((k) => String(k.attN)) },
            { label: 'Points Per Possession', value: display((k) => Number.isFinite(k.pointsPerPossession) ? k.pointsPerPossession.toFixed(2) : 'NA') },
            { label: 'Avg Possession Duration', value: display((k) => Number.isFinite(k.avgDur) ? `${k.avgDur.toFixed(1)}s` : 'NA') },
            { label: 'Possession To Attack %', value: display((k) => formatPct(k.possToAttack)) },
            { label: 'Possession To Shot %', value: display((k) => formatPct(k.possToShot)) },
            { label: 'Attack To Shot %', value: display((k) => formatPct(k.attToShot)) },
            { label: 'Completed Passes Per Possession', value: display((k) => Number.isFinite(k.passesPerPoss) ? k.passesPerPoss.toFixed(2) : 'NA') },
            { label: 'Scoring Possession %', value: display((k) => formatPct(k.scoringPoss)) },
            { label: 'Counter Attack Possession %', value: display((k) => formatPct(k.counterPoss)) },
          ].map((k) => (
            <Card key={k.label}>
              <CardContent className="p-3">
                <div className="text-[11px] text-slate-600">{k.label}</div>
                <div className="text-lg font-semibold text-slate-900 tabular-nums">{k.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        {possessionsFiltered.length === 0 ? (
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
                        { k: 'Score', c: '#1d4ed8' },
                        { k: 'Missed Shot', c: '#64748b' },
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
                  <ChartContainer id="attack-outcomes-poss" className="h-[240px] w-full" config={{}}>
                    <BarChart data={attackOutcomeData} margin={{ top: 10, right: 16, left: 0, bottom: 6 }}>
                      <CartesianGrid vertical={false} />
                      <XAxis dataKey="team" className="text-xs" />
                      <YAxis allowDecimals={false} className="text-xs" />
                      <Tooltip content={<ChartTooltipContent />} />
                      <Legend />
                      {[
                        { k: 'Score', c: '#1d4ed8' },
                        { k: 'Missed Shot', c: '#64748b' },
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

            <AttackChannelPitch
              homeTeam={homeTeam}
              awayTeam={awayTeam}
              teamMode={teamMode}
              homeColor={homeTeam?.color}
              awayColor={awayTeam?.color}
              rows={attackChannelRows}
            />

            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="font-semibold text-slate-900">Possession Table</div>
                <div className="overflow-x-auto">
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
                      <TableHead className="text-right">Completed Passes</TableHead>
                      <TableHead className="text-right">Pts</TableHead>
                      <TableHead className="text-right">Attack</TableHead>
                      <TableHead>Start Zone</TableHead>
                      <TableHead>Transition</TableHead>
                      <TableHead className="text-right"> </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {possessionsFiltered.slice(0, 250).map((p) => {
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
                          <TableCell className="text-right tabular-nums">{p.points}</TableCell>
                          <TableCell className="text-right tabular-nums">{p.isAttack ? 'Yes' : 'No'}</TableCell>
                          <TableCell>{p.startZone}</TableCell>
                          <TableCell>{p.counterState}</TableCell>
                          <TableCell className="text-right">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 text-xs"
                              onClick={() => onVisualisePossession?.(p)}
                            >
                              Visualise
                            </Button>
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
  const scopedReportFilters = useMemo(() => ({ ...reportFilters, allowedActionTypes: ['pass', 'carry'] }), [reportFilters]);
  const base = useMemo(() => applyNonTeamReportFilters(stats, scopedReportFilters), [stats, scopedReportFilters]);
  const teamMode = String(reportFilters?.team || 'both');
  const events = useMemo(() => base.filter((s) => s && (s.stat_type === 'pass' || s.stat_type === 'carry')), [base]);

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

  const kpis = useMemo(() => {
    const possessionGroups = groupByPossession(base);
    const shotAssistCredits = buildShotAssistCredits(filtered);
    const calc = (side) => {
      const sideEvents = filtered.filter((s) => s.team_side === side);
      const pass = sideEvents.filter((s) => s.stat_type === 'pass');
      const carry = sideEvents.filter((s) => s.stat_type === 'carry');
      const passComp = pass.filter((s) => deriveOutcome(s, safeParseJSON(s.extra_data || '{}', {})) === 'completed').length;
      const carryComp = carry.filter((s) => deriveOutcome(s, safeParseJSON(s.extra_data || '{}', {})) === 'completed').length;
      const progPass = pass.filter((s) => isProgressiveShared(s)).length;
      const progPassComp = pass.filter((s) => isProgressiveShared(s) && deriveOutcome(s, safeParseJSON(s.extra_data || '{}', {})) === 'completed').length;
      const progCarry = carry.filter((s) => isProgressiveShared(s)).length;
      const progCarryComp = carry.filter((s) => isProgressiveShared(s) && deriveOutcome(s, safeParseJSON(s.extra_data || '{}', {})) === 'completed').length;
      const scoringEntries = sideEvents.filter((s) => getScoringZoneEntry(s)).length;
      const passesIntoScoringZone = pass.filter((s) => deriveOutcome(s, safeParseJSON(s.extra_data || '{}', {})) === 'completed' && getScoringZoneEntry(s)).length;
      const turnovers = sideEvents.filter((s) => classifyTerminalOutcome(s, side) === 'TURNOVER').length;
      const shotAssists = shotAssistCredits.filter((row) => row.teamSide === side).length;

      const buildUpSamples = [];
      const channels = { Left: 0, Middle: 0, Right: 0 };
      const startZones = { 'Defensive Third': 0, 'Middle Third': 0, 'Attacking Third': 0 };
      for (const [key, evs] of possessionGroups.entries()) {
        if (!String(key).startsWith(side + '-')) continue;
        const acting = evs.filter((e) => e && e.team_side === side);
        if (!acting.length) continue;
        const zone = getPossessionStartZone(acting);
        if (startZones[zone] != null) startZones[zone] += 1;
        if (!isAttackPossession(acting, side)) continue;
        const channel = getAttackEntryChannelForPossession(acting, side);
        if (channel) channels[channel] += 1;

        const startTime = getMatchTimeS(acting[0], reportFilters?.match, reportFilters?.imputedTimeById);
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
        passPct: pass.length ? (passComp / pass.length) * 100 : NaN,
        carries: carry.length,
        carryPct: carry.length ? (carryComp / carry.length) * 100 : NaN,
        progPass,
        progPassPct: progPass ? (progPassComp / progPass) * 100 : NaN,
        progCarry,
        progCarryPct: progCarry ? (progCarryComp / progCarry) * 100 : NaN,
        scoringEntries,
        passesIntoScoringZone,
        shotAssists,
        shotsCreated: shotAssists,
        fieldTiltEvents: sideEvents.filter((s) => getFieldTiltContribution(s)).length,
        turnovers,
        buildUpSpeed: buildUpSamples.length ? buildUpSamples.reduce((a, b) => a + b, 0) / buildUpSamples.length : NaN,
        channels,
        startZones,
      };
    };
    return { home: calc('home'), away: calc('away') };
  }, [base, filtered, reportFilters]);

  const fieldTiltPct = useMemo(() => {
    const total = (kpis.home.fieldTiltEvents || 0) + (kpis.away.fieldTiltEvents || 0);
    return {
      home: total ? ((kpis.home.fieldTiltEvents || 0) / total) * 100 : NaN,
      away: total ? ((kpis.away.fieldTiltEvents || 0) / total) * 100 : NaN,
    };
  }, [kpis]);

  const display = (selector) => {
    if (teamMode === 'home') return selector(kpis.home);
    if (teamMode === 'away') return selector(kpis.away);
    return `${selector(kpis.home)} / ${selector(kpis.away)}`;
  };

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

  return (
    <div className="grid lg:grid-cols-[280px_minmax(0,1fr)] gap-4">
      <div className="space-y-4 min-w-0">
        <ReportFiltersCard reportFilters={scopedReportFilters} playerOptions={playerOptions} homeTeam={homeTeam} awayTeam={awayTeam} />
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
            { label: 'Passes Attempted', value: display((k) => String(k.passes)) },
            { label: 'Pass Completion %', value: display((k) => formatPct(k.passPct)) },
            { label: 'Carries', value: display((k) => String(k.carries)) },
            { label: 'Carry Completion %', value: display((k) => formatPct(k.carryPct)) },
            { label: 'Progressive Passes Attempted', value: display((k) => String(k.progPass)) },
            { label: 'Progressive Pass Success %', value: display((k) => formatPct(k.progPassPct)) },
            { label: 'Progressive Carries Attempted', value: display((k) => String(k.progCarry)) },
            { label: 'Progressive Carry Success %', value: display((k) => formatPct(k.progCarryPct)) },
            { label: 'Scoring Zone Entries', value: display((k) => String(k.scoringEntries)) },
            { label: 'Passes Into Scoring Zone', value: display((k) => String(k.passesIntoScoringZone)) },
            { label: 'Shot Assists', value: display((k) => String(k.shotAssists)) },
            { label: 'Shots Created', value: display((k) => String(k.shotsCreated)) },
            { label: 'Field Tilt', value: teamMode === 'home' ? formatPct(fieldTiltPct.home) : teamMode === 'away' ? formatPct(fieldTiltPct.away) : `${formatPct(fieldTiltPct.home)} / ${formatPct(fieldTiltPct.away)}` },
            { label: 'Build-Up Turnovers', value: display((k) => String(k.turnovers)) },
            { label: 'Build-Up Speed', value: display((k) => Number.isFinite(k.buildUpSpeed) ? `${k.buildUpSpeed.toFixed(1)}s` : 'NA') },
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
                <PitchViz stats={filtered} homeColor={homeTeam?.color} awayColor={awayTeam?.color} colorBy={teamMode === 'both' ? 'team' : 'outcome'} showColorControls={false} />
              </CardContent>
            </Card>

            <AttackChannelPitch
              homeTeam={homeTeam}
              awayTeam={awayTeam}
              teamMode={teamMode}
              homeColor={homeTeam?.color}
              awayColor={awayTeam?.color}
              rows={channelRows}
            />

            <Card>
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
                  </div>
                  <PassNetwork
                    passes={filtered.filter((s) => s.stat_type === 'pass')}
                    side={teamMode === 'both' ? pnSide : teamMode}
                    minCount={pnMin}
                    teamLabel={(teamMode === 'both' ? pnSide : teamMode) === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home')}
                    teamColor={((teamMode === 'both' ? pnSide : teamMode) === 'away' ? awayTeam?.color : homeTeam?.color) || '#111827'}
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="font-semibold text-slate-900">Possession Start Zones</div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Zone</TableHead>
                      {(teamMode === 'both' || teamMode === 'home') && <TableHead className="text-right">{homeTeam?.name || 'Home'}</TableHead>}
                      {(teamMode === 'both' || teamMode === 'away') && <TableHead className="text-right">{awayTeam?.name || 'Away'}</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {['Defensive Third', 'Middle Third', 'Attacking Third'].map((zone) => (
                      <TableRow key={zone}>
                        <TableCell className="font-medium">{zone}</TableCell>
                        {(teamMode === 'both' || teamMode === 'home') && (
                          <TableCell className="text-right tabular-nums">{kpis.home.startZones?.[zone] || 0}</TableCell>
                        )}
                        {(teamMode === 'both' || teamMode === 'away') && (
                          <TableCell className="text-right tabular-nums">{kpis.away.startZones?.[zone] || 0}</TableCell>
                        )}
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

function RestartsTab({ stats, homeTeam, awayTeam, playerOptions, reportFilters }) {
  const scopedReportFilters = useMemo(() => ({ ...reportFilters, allowedActionTypes: ['kickout', 'throw_in'] }), [reportFilters]);
  const base = useMemo(() => applyNonTeamReportFilters(stats, scopedReportFilters), [stats, scopedReportFilters]);
  const teamMode = String(reportFilters?.team || 'both');

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

  const display = (selector) => {
    if (teamMode === 'home') return selector(kpis.home);
    if (teamMode === 'away') return selector(kpis.away);
    return `${selector(kpis.home)} | ${selector(kpis.away)}`;
  };

  const visibleKickouts = useMemo(() => {
    if (teamMode === 'both') return kickouts;
    return kickouts.filter((s) => {
      const ex = safeParseJSON(s.extra_data || '{}', {});
      return ex?.kickout?.team_side === teamMode || s?.team_side === teamMode;
    });
  }, [kickouts, teamMode]);

  return (
    <div className="grid lg:grid-cols-[340px_1fr] gap-4">
      <div className="space-y-4">
        <ReportFiltersCard reportFilters={scopedReportFilters} playerOptions={playerOptions} homeTeam={homeTeam} awayTeam={awayTeam} />
      </div>

      <div className="space-y-4">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            {
              label: 'Own Kickout Win %',
              value: display((k) => `${k.ownKickoutsWon}/${k.ownKickoutsTaken} (${formatPct(k.ownKickoutsTaken ? (k.ownKickoutsWon / k.ownKickoutsTaken) * 100 : NaN)})`),
            },
            {
              label: 'Opposition Kickout Disruption %',
              value: display((k) => `${k.oppDisrupted}/${k.oppKickoutsTaken} (${formatPct(k.oppKickoutsTaken ? (k.oppDisrupted / k.oppKickoutsTaken) * 100 : NaN)})`),
            },
            {
              label: 'Clean Kickout Win %',
              value: display((k) => `${k.ownCleanWon}/${k.ownKickoutsTaken} (${formatPct(k.ownKickoutsTaken ? (k.ownCleanWon / k.ownKickoutsTaken) * 100 : NaN)})`),
            },
            {
              label: 'Break-Ball Recovery %',
              value: teamMode === 'home'
                ? `${kpis.breakWonHome}/${kpis.breakAll} (${formatPct(kpis.breakAll ? (kpis.breakWonHome / kpis.breakAll) * 100 : NaN)})`
                : teamMode === 'away'
                  ? `${kpis.breakWonAway}/${kpis.breakAll} (${formatPct(kpis.breakAll ? (kpis.breakWonAway / kpis.breakAll) * 100 : NaN)})`
                  : `${kpis.breakWonHome}/${kpis.breakAll} (${formatPct(kpis.breakAll ? (kpis.breakWonHome / kpis.breakAll) * 100 : NaN)}) | ${kpis.breakWonAway}/${kpis.breakAll} (${formatPct(kpis.breakAll ? (kpis.breakWonAway / kpis.breakAll) * 100 : NaN)})`,
            },
            {
              label: 'Restart-to-Shot %',
              value: display((k) => `${k.restartToShot}/${k.restartWins} (${formatPct(k.restartWins ? (k.restartToShot / k.restartWins) * 100 : NaN)})`),
            },
            {
              label: 'Restart-to-Score %',
              value: display((k) => `${k.restartToScore}/${k.restartWins} (${formatPct(k.restartWins ? (k.restartToScore / k.restartWins) * 100 : NaN)})`),
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

        {visibleKickouts.length === 0 ? (
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
                <PitchViz stats={visibleKickouts} homeColor={homeTeam?.color} awayColor={awayTeam?.color} colorBy={teamMode === 'both' ? 'team' : 'outcome'} showColorControls={false} />
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
                    {kickoutTargets.filter((r) => teamMode === 'both' || r.team === teamMode).slice(0, 200).map((r, idx) => (
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
  const scopedReportFilters = useMemo(() => ({ ...reportFilters, allowedActionTypes: ['throw_in'] }), [reportFilters]);
  const base = useMemo(() => applyNonTeamReportFilters(stats, scopedReportFilters), [stats, scopedReportFilters]);
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
        <ReportFiltersCard reportFilters={scopedReportFilters} playerOptions={playerOptions} homeTeam={homeTeam} awayTeam={awayTeam} />
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
  const analysisFilters = useMemo(() => ({ ...reportFilters, team: 'both', allowedActionTypes: ['turnover', 'defensive_contact', 'foul'] }), [reportFilters]);
  const base = useMemo(() => applyNonTeamReportFilters(stats, analysisFilters), [stats, analysisFilters]);
  const teamMode = String(reportFilters?.team || 'both');
  const [eventCategory, setEventCategory] = useState('all');
  const [turnoverResult, setTurnoverResult] = useState('both');
  const [turnoverTypes, setTurnoverTypes] = useState([]);
  const [defTypes, setDefTypes] = useState([]);

  const turnovers = useMemo(() => base.filter((s) => s?.stat_type === 'turnover' || (safeParseJSON(s?.extra_data || '{}', {})?.turnover)), [base]);
  const defActions = useMemo(() => base.filter((s) => s?.stat_type === 'defensive_contact'), [base]);
  const defensiveFouls = useMemo(() => base.filter((s) => {
    const f = extractFoulFromStat(s);
    if (!f?.foul_by?.team_side) return false;
    return ['pull', 'push', 'tackle', 'high_tackle'].includes(normalizeFoulType(f?.foul_type));
  }), [base]);

  const classifyTurnover = (s) => {
    const ex = safeParseJSON(s?.extra_data || '{}', {});
    const t = ex?.turnover || {};
    const foul = extractFoulFromStat(s);
    const lost = t?.lost_by?.team_side || foul?.foul_by?.team_side || null;
    const rec = t?.recovered_by?.team_side || foul?.foul_on_or_forced_by?.team_side || foul?.foul_on?.team_side || null;
    const unforced = !!t?.unforced;
    const typ = String(t?.type || t?.turnover_type || ex?.turnover_type || foul?.foul_type || '');
    return { lost, rec, unforced, typ };
  };

  const teamRelevant = (row, side) => {
    if (!row || side === 'both') return true;
    return row.rec === side || row.lost === side;
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
      const oppCompletedPasses = base.filter((s) => {
        if (s?.stat_type !== 'pass' || s?.team_side !== oppSide) return false;
        const ex = safeParseJSON(s.extra_data || '{}', {});
        return ex?.pass?.outcome === 'completed';
      }).length;
      const defActionCount =
        won +
        defActions.filter((s) => s?.team_side === teamSide).length +
        defensiveFouls.filter((s) => extractFoulFromStat(s)?.foul_by?.team_side === teamSide).length;

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

      const possessionCount = Array.from(byPoss.keys()).filter((k) => String(k).startsWith(`${teamSide}-`)).length;

      return {
        won,
        lost,
        diff: won - lost,
        forcedPct,
        avgHeight,
        shotsFrom,
        scoresFrom,
        scoresConceded,
        defActionCount,
        ppda: defActionCount ? oppCompletedPasses / defActionCount : NaN,
        turnoverRate: possessionCount ? lost / possessionCount : NaN,
      };
    };
    return { home: calc('home'), away: calc('away') };
  }, [turnovers, base, defActions, defensiveFouls]);

  const typeRows = useMemo(() => {
    const rows = new Map();
    for (const s of turnovers) {
      const c = classifyTurnover(s);
      if (!teamRelevant(c, teamMode)) continue;
      const typ = toTitleCase(c.typ || 'Unknown');
      const cur = rows.get(typ) || { type: typ, won: 0, lost: 0 };
      if (c.rec && (teamMode === 'both' || c.rec === teamMode)) cur.won += 1;
      if (c.lost && (teamMode === 'both' || c.lost === teamMode)) cur.lost += 1;
      rows.set(typ, cur);
    }
    return Array.from(rows.values()).sort((a, b) => String(a.type).localeCompare(String(b.type)));
  }, [turnovers, teamMode]);

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

  const filteredDefActions = useMemo(() => defActions.filter((s) => {
    if (teamMode !== 'both' && s?.team_side !== teamMode) return false;
    if (!defTypes.length) return true;
    const ex = safeParseJSON(s?.extra_data || '{}', {});
    return defTypes.includes(String(ex?.defensive_contact?.type || ''));
  }), [defActions, defTypes, teamMode]);

  const mapStats = useMemo(() => {
    if (eventCategory === 'turnovers') return filteredTurnovers;
    if (eventCategory === 'def_actions') return filteredDefActions;
    return [...filteredTurnovers, ...filteredDefActions];
  }, [eventCategory, filteredTurnovers, filteredDefActions]);

  const display = (selector) => {
    if (teamMode === 'home') return selector(kpis.home);
    if (teamMode === 'away') return selector(kpis.away);
    return `${selector(kpis.home)} / ${selector(kpis.away)}`;
  };

  return (
    <div className="grid lg:grid-cols-[340px_1fr] gap-4">
      <div className="space-y-4">
        <ReportFiltersCard reportFilters={analysisFilters} playerOptions={playerOptions} homeTeam={homeTeam} awayTeam={awayTeam} />
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="font-semibold text-slate-900">Local Filters</div>
            <div className="space-y-1">
              <Label className="text-xs text-slate-600">Event Category</Label>
              <Select value={eventCategory} onValueChange={setEventCategory}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="turnovers">Turnovers</SelectItem>
                  <SelectItem value="def_actions">Defensive Actions</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-slate-600">Turnover Result</Label>
              <Select value={turnoverResult} onValueChange={setTurnoverResult}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="both">Both</SelectItem>
                  <SelectItem value="won">Won</SelectItem>
                  <SelectItem value="lost">Lost</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <MultiSelect
              label="Turnover Type"
              placeholder="Any"
              values={turnoverTypes}
              onChange={setTurnoverTypes}
              options={typeRows.map((r) => ({ value: String(r.type || '').toLowerCase().replace(/\s+/g, '_'), label: r.type }))}
            />
            <MultiSelect
              label="Defensive Action Type"
              placeholder="All"
              values={defTypes}
              onChange={setDefTypes}
              options={[
                { value: 'contact', label: 'Contact' },
                { value: 'dispossession', label: 'Dispossess' },
                { value: 'block', label: 'Block' },
              ]}
            />
          </CardContent>
        </Card>
      </div>
      <div className="space-y-4">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: 'Turnovers Won', value: display((k) => String(k.won)) },
            { label: 'Turnovers Lost', value: display((k) => String(k.lost)) },
            { label: 'Turnover Differential', value: display((k) => String(k.diff)) },
            { label: 'Forced Turnover %', value: display((k) => formatPct(k.forcedPct)) },
            { label: 'Average Regain Height (x)', value: display((k) => Number.isFinite(k.avgHeight) ? k.avgHeight.toFixed(1) : 'NA') },
            { label: 'Defensive Actions', value: display((k) => String(k.defActionCount)) },
            { label: 'PPDA', value: display((k) => Number.isFinite(k.ppda) ? k.ppda.toFixed(2) : 'NA') },
            { label: 'Turnover Rate', value: display((k) => formatPct(Number.isFinite(k.turnoverRate) ? k.turnoverRate * 100 : NaN)) },
            { label: 'Shots From Regains', value: display((k) => String(k.shotsFrom)) },
            { label: 'Scores From Regains', value: display((k) => String(k.scoresFrom)) },
            { label: 'Scores Conceded After Lost Turnovers', value: display((k) => String(k.scoresConceded)) },
          ].map((k) => (
            <Card key={k.label}>
              <CardContent className="p-3">
                <div className="text-[11px] text-slate-600">{k.label}</div>
                <div className="text-lg font-semibold text-slate-900 tabular-nums">{k.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        {mapStats.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-sm text-slate-600 text-center">No defensive events available for current filters.</CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="font-semibold text-slate-900">Defensive Map</div>
                <PitchViz stats={mapStats} homeColor={homeTeam?.color} awayColor={awayTeam?.color} colorBy={teamMode === 'both' ? 'team' : 'action'} showColorControls={false} />
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

function FoulsDisciplineTab({ stats, homeTeam, awayTeam, playerOptions, reportFilters }) {
  const analysisFilters = useMemo(() => ({ ...reportFilters, team: 'both', allowedActionTypes: ['foul', 'pass', 'carry', 'turnover', 'kickout', 'throw_in'] }), [reportFilters]);
  const base = useMemo(() => applyNonTeamReportFilters(stats, analysisFilters), [stats, analysisFilters]);
  const teamMode = String(reportFilters?.team || 'both');
  const fouls = useMemo(() => base.filter((s) => !!extractFoulFromStat(s)), [base]);
  const scorableFreeRows = useMemo(() => findScorableFreeConcededRows(base), [base]);

  const kpis = useMemo(() => {
    const by = {
      home: { won: 0, conceded: 0, yellow: 0, black: 0, red: 0, scorable: 0 },
      away: { won: 0, conceded: 0, yellow: 0, black: 0, red: 0, scorable: 0 },
    };
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
    for (const row of scorableFreeRows) {
      if (row.concedingSide === 'home') by.home.scorable += 1;
      if (row.concedingSide === 'away') by.away.scorable += 1;
    }
    return by;
  }, [fouls, scorableFreeRows]);

  const visibleFouls = useMemo(() => {
    if (teamMode === 'both') return fouls;
    return fouls.filter((s) => {
      const f = extractFoulFromStat(s);
      return f?.foul_by?.team_side === teamMode || f?.foul_on_or_forced_by?.team_side === teamMode;
    });
  }, [fouls, teamMode]);

  const typeRows = useMemo(() => {
    const rows = new Map();
    for (const s of visibleFouls) {
      const f = extractFoulFromStat(s);
      const typ = toTitleCase(f?.foul_type || 'Unknown');
      const cur = rows.get(typ) || { type: typ, count: 0 };
      cur.count += 1;
      rows.set(typ, cur);
    }
    return Array.from(rows.values()).sort((a, b) => b.count - a.count);
  }, [visibleFouls]);

  const display = (selector) => {
    if (teamMode === 'home') return selector(kpis.home);
    if (teamMode === 'away') return selector(kpis.away);
    return `${selector(kpis.home)} / ${selector(kpis.away)}`;
  };

  return (
    <div className="grid lg:grid-cols-[340px_1fr] gap-4">
      <div className="space-y-4">
        <ReportFiltersCard reportFilters={analysisFilters} playerOptions={playerOptions} homeTeam={homeTeam} awayTeam={awayTeam} />
      </div>
      <div className="space-y-4">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: 'Fouls Won', value: display((k) => String(k.won)) },
            { label: 'Fouls Conceded', value: display((k) => String(k.conceded)) },
            { label: 'Foul Differential', value: display((k) => String(k.won - k.conceded)) },
            { label: 'Cards Total', value: display((k) => String(k.yellow + k.black + k.red)) },
            { label: 'Scorable Frees Conceded', value: display((k) => String(k.scorable)) },
          ].map((k) => (
            <Card key={k.label}>
              <CardContent className="p-3">
                <div className="text-[11px] text-slate-600">{k.label}</div>
                <div className="text-lg font-semibold text-slate-900 tabular-nums">{k.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        {visibleFouls.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-sm text-slate-600 text-center">No fouls available for current filters.</CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="font-semibold text-slate-900">Foul Map</div>
                <PitchViz stats={visibleFouls} homeColor={homeTeam?.color} awayColor={awayTeam?.color} colorBy="team" showColorControls={false} />
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

            <Card>
              <CardContent className="p-4 space-y-3">
                <div className="font-semibold text-slate-900">Scorable Free Conceded Events</div>
                {scorableFreeRows.length === 0 ? (
                  <div className="text-sm text-slate-600">No scorable frees conceded for current filters.</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Team</TableHead>
                        <TableHead>Foul Type</TableHead>
                        <TableHead>Restart</TableHead>
                        <TableHead className="text-right">Distance</TableHead>
                        <TableHead className="text-right">Play</TableHead>
                        <TableHead className="text-right">Possession</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {scorableFreeRows
                        .filter((row) => teamMode === 'both' || row.concedingSide === teamMode)
                        .slice(0, 200)
                        .map((row) => (
                          <TableRow key={`${row.playId}-${row.restartStat?.id || ''}`}>
                            <TableCell>{row.concedingSide === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home')}</TableCell>
                            <TableCell>{toTitleCase(row.foul?.foul_type || 'Unknown')}</TableCell>
                            <TableCell>{toTitleCase(row.restartType || 'Unknown')}</TableCell>
                            <TableCell className="text-right tabular-nums">{Number.isFinite(row.distance) ? row.distance.toFixed(1) : 'NA'}m</TableCell>
                            <TableCell className="text-right tabular-nums">{Number.isFinite(row.playId) ? row.playId : 'NA'}</TableCell>
                            <TableCell className="text-right tabular-nums">{Number.isFinite(row.possessionId) ? row.possessionId : 'NA'}</TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function PlayersAnalyticsTab({ stats, homeTeam, awayTeam, playerOptions, reportFilters }) {
  const scopedReportFilters = useMemo(() => ({ ...reportFilters, allowedActionTypes: ['shot', 'pass', 'carry', 'turnover', 'foul', 'kickout', 'throw_in', 'defensive_contact'] }), [reportFilters]);
  const [focusPlayerId, setFocusPlayerId] = useState('all');
  const [playerBucket, setPlayerBucket] = useState('scoring');
  const [lbSort, setLbSort] = useState({ key: 'points', dir: 'desc' }); // key + dir
  const base = useMemo(() => applyNonTeamReportFilters(stats, scopedReportFilters), [stats, scopedReportFilters]);
  const teamMode = String(reportFilters?.team || 'both');

  const playerMetaByKey = useMemo(() => {
    const map = new Map();
    for (const p of playerOptions || []) {
      if (p?.id && (p.team_side === 'home' || p.team_side === 'away')) {
        map.set(`${p.team_side}|${p.id}`, p);
      }
    }
    return map;
  }, [playerOptions]);

  const shotAssistCredits = useMemo(() => buildShotAssistCredits(base), [base]);
  const touchMap = useMemo(() => buildTouchesMap(base), [base]);

  const leaderboard = useMemo(() => {
    const rows = new Map();
    const ensure = (sel) => {
      const player = normalizePlayerRef(sel);
      if (!player) return null;
      const key = `${player.team_side}|${player.id}`;
      const meta = playerMetaByKey.get(key) || {};
      const cur = rows.get(key) || {
        key,
        id: player.id,
        player: formatExtraValue({ kind: 'player', ...meta, ...player }),
        team: player.team_side || 'unknown',
        number: meta.number ?? player.number ?? null,
        name: meta.name || player.name || '',
        position: meta.position || player.position || '',
        shots: 0,
        scores: 0,
        points: 0,
        passes: 0,
        passComp: 0,
        carries: 0,
        carryComp: 0,
        turnoversWon: 0,
        turnoversLost: 0,
        foulsWon: 0,
        foulsConceded: 0,
        defActions: 0,
        contacts: 0,
        dispossessions: 0,
        blocks: 0,
        progPassAtt: 0,
        progPassComp: 0,
        progPassRecv: 0,
        progCarries: 0,
        progMeters: 0,
        scoringZoneEntriesCreated: 0,
        passesIntoScoringZone: 0,
        shotAssists: 0,
        shotsCreated: 0,
        attacksInvolved: 0,
        scoringPossessionsInvolved: 0,
        kickoutTargets: 0,
        kickoutWins: 0,
        throwInsWon: 0,
        marks: 0,
        touches: 0,
        avgShotDistTotal: 0,
        avgShotDistCount: 0,
        kickoutsTaken: 0,
        ownKickoutsWon: 0,
        cleanKickoutsWon: 0,
        shortKickoutsTaken: 0,
        longKickoutsTaken: 0,
        shortKickoutsWon: 0,
        longKickoutsWon: 0,
        goalShotsSaved: 0,
        goalShotsAgainst: 0,
        pressBreakdown: {
          m2m: { taken: 0, won: 0, shortTaken: 0, shortWon: 0, longTaken: 0, longWon: 0 },
          zonal: { taken: 0, won: 0, shortTaken: 0, shortWon: 0, longTaken: 0, longWon: 0 },
          conceded: { taken: 0, won: 0, shortTaken: 0, shortWon: 0, longTaken: 0, longWon: 0 },
        },
      };
      rows.set(key, cur);
      return cur;
    };

    const homeKeeper = getKeeperCandidate(playerOptions, 'home');
    const awayKeeper = getKeeperCandidate(playerOptions, 'away');
    ensure(homeKeeper);
    ensure(awayKeeper);

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
          const dist = calcDistanceToGoal(Number(s.x_position), Number(s.y_position));
          if (Number.isFinite(dist)) {
            r.avgShotDistTotal += dist;
            r.avgShotDistCount += 1;
          }
        }
        const goalShotType = String(ex?.shot?.shot_type || ex?.shot?.type || '') === 'goal';
        if (goalShotType && ['goal', 'saved'].includes(String(ex?.shot?.outcome || ''))) {
          const keeperSide = s.team_side === 'away' ? 'home' : 'away';
          const savedBy = normalizePlayerRef(ex?.shot?.saved_by);
          const keeperRow = ensure(savedBy?.team_side === keeperSide ? savedBy : (keeperSide === 'home' ? homeKeeper : awayKeeper));
          if (keeperRow) {
            if (ex?.shot?.outcome === 'saved') keeperRow.goalShotsSaved += 1;
            if (ex?.shot?.outcome === 'goal') keeperRow.goalShotsAgainst += 1;
          }
        }
      }
      if (s.stat_type === 'pass') {
        const pass = ex?.pass || {};
        const p = pass?.passer;
        const r = ensure(p);
        const isProg = isProgressiveShared(s);
        const isCompleted = pass?.outcome === 'completed';
        if (r) {
          r.passes += 1;
          if (isCompleted) r.passComp += 1;
          if (isProg) {
            r.progPassAtt += 1;
            if (isCompleted) r.progPassComp += 1;
            r.progMeters += getProgressiveMeters(s);
          }
          if (isCompleted && getScoringZoneEntry(s)) {
            r.passesIntoScoringZone += 1;
            r.scoringZoneEntriesCreated += 1;
          }
        }
        if (isProg && isCompleted) {
          const recv = pass?.won_by?.kind === 'player' ? pass?.won_by : pass?.intended_recipient;
          const rr = ensure(recv);
          if (rr) rr.progPassRecv += 1;
        }
      }
      if (s.stat_type === 'carry') {
        const p = ex?.carry?.carrier;
        const r = ensure(p);
        if (r) {
          r.carries += 1;
          if (deriveOutcome(s, ex) === 'completed') r.carryComp += 1;
          if (isProgressiveShared(s)) {
            r.progCarries += 1;
            r.progMeters += getProgressiveMeters(s);
          }
          if (getScoringZoneEntry(s)) r.scoringZoneEntriesCreated += 1;
        }
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
        if (r) {
          r.defActions += 1;
          const type = String(ex?.defensive_contact?.type || '');
          if (type === 'contact') r.contacts += 1;
          if (type === 'dispossess' || type === 'dispossession') r.dispossessions += 1;
          if (type === 'block') r.blocks += 1;
        }
      }
      if (s.stat_type === 'kickout') {
        const kick = ex?.kickout || {};
        const koTeam = kick?.team_side;
        const keeper = ensure(koTeam === 'home' ? homeKeeper : koTeam === 'away' ? awayKeeper : null);
        if (keeper) {
          keeper.kickoutsTaken += 1;
          const won = (kick?.outcome === 'clean' || kick?.outcome === 'break') && kick?.won_by?.team_side === koTeam;
          const cleanWon = kick?.outcome === 'clean' && kick?.won_by?.team_side === koTeam;
          if (won) keeper.ownKickoutsWon += 1;
          if (cleanWon) keeper.cleanKickoutsWon += 1;
          const isLong = Number(s.end_x_position) >= OPP_45_X;
          const pressKey = ['m2m', 'zonal', 'conceded'].includes(String(kick?.press || '').toLowerCase()) ? String(kick.press).toLowerCase() : null;
          if (isLong) {
            keeper.longKickoutsTaken += 1;
            if (won) keeper.longKickoutsWon += 1;
          } else {
            keeper.shortKickoutsTaken += 1;
            if (won) keeper.shortKickoutsWon += 1;
          }
          if (pressKey && keeper.pressBreakdown?.[pressKey]) {
            keeper.pressBreakdown[pressKey].taken += 1;
            if (won) keeper.pressBreakdown[pressKey].won += 1;
            if (isLong) {
              keeper.pressBreakdown[pressKey].longTaken += 1;
              if (won) keeper.pressBreakdown[pressKey].longWon += 1;
            } else {
              keeper.pressBreakdown[pressKey].shortTaken += 1;
              if (won) keeper.pressBreakdown[pressKey].shortWon += 1;
            }
          }
        }
        const target = ensure(kick?.intended_recipient);
        if (target) target.kickoutTargets += 1;
        const wonBy = ensure(kick?.won_by);
        if (wonBy) {
          wonBy.kickoutWins += 1;
          if (kick?.mark) wonBy.marks += 1;
        }
      }
      if (s.stat_type === 'throw_in') {
        const won = ensure(ex?.throw_in?.won_by);
        if (won) won.throwInsWon += 1;
      }
    }

    for (const row of shotAssistCredits) {
      const passer = ensure(row.passer);
      if (passer) {
        passer.shotAssists += 1;
        passer.shotsCreated += 1;
      }
    }

    const possessionGroups = groupByPossession(base);
    for (const [key, evs] of possessionGroups.entries()) {
      const [teamSide] = String(key).split('-');
      if (teamSide !== 'home' && teamSide !== 'away') continue;
      const acting = evs.filter((e) => e && e.team_side === teamSide);
      if (!acting.length) continue;
      const involved = new Set();
      for (const e of acting) {
        const extra = safeParseJSON(e.extra_data || '{}', {});
        for (const playerKey of collectPlayerSelectionKeys(extra)) involved.add(playerKey);
      }
      const isAttack = isAttackPossession(evs, teamSide);
      const outcome = derivePossessionOutcome(evs, teamSide);
      for (const playerKey of involved) {
        const row = rows.get(playerKey);
        if (!row) continue;
        if (isAttack) row.attacksInvolved += 1;
        if (outcome === 'Score') row.scoringPossessionsInvolved += 1;
      }
    }

    for (const [key, count] of touchMap.entries()) {
      const row = rows.get(key);
      if (row) row.touches = count;
    }

    return Array.from(rows.values()).map((row) => {
      const passPct = row.passes ? (row.passComp / row.passes) * 100 : NaN;
      const carryPct = row.carries ? (row.carryComp / row.carries) * 100 : NaN;
      const progPassPct = row.progPassAtt ? (row.progPassComp / row.progPassAtt) * 100 : NaN;
      const totalBallActions = row.passes + row.carries + row.shots;
      const turnoverRate = totalBallActions ? (row.turnoversLost / totalBallActions) * 100 : NaN;
      const avgShotDist = row.avgShotDistCount ? row.avgShotDistTotal / row.avgShotDistCount : NaN;
      const goalShotSavePct = (row.goalShotsSaved + row.goalShotsAgainst)
        ? (row.goalShotsSaved / (row.goalShotsSaved + row.goalShotsAgainst)) * 100
        : NaN;
      const ownKickoutWinPct = row.kickoutsTaken ? (row.ownKickoutsWon / row.kickoutsTaken) * 100 : NaN;
      const cleanKickoutWinPct = row.kickoutsTaken ? (row.cleanKickoutsWon / row.kickoutsTaken) * 100 : NaN;
      const shortKickoutWinPct = row.shortKickoutsTaken ? (row.shortKickoutsWon / row.shortKickoutsTaken) * 100 : NaN;
      const longKickoutWinPct = row.longKickoutsTaken ? (row.longKickoutsWon / row.longKickoutsTaken) * 100 : NaN;
      return {
        ...row,
        passPct,
        carryPct,
        progPassPct,
        turnoverRate,
        avgShotDist,
        goalShotSavePct,
        ownKickoutWinPct,
        cleanKickoutWinPct,
        shortKickoutWinPct,
        longKickoutWinPct,
      };
    });
  }, [base, playerMetaByKey, playerOptions, shotAssistCredits, touchMap]);

  const sortedLeaderboard = useMemo(() => {
    const bucketFilters = {
      scoring: () => true,
      progression: () => true,
      retention: () => true,
      creation: () => true,
      defense: () => true,
      restarts: () => true,
      goalkeepers: (r) => isGoalkeeperPlayer(r),
    };
    const list = (Array.isArray(leaderboard) ? leaderboard : [])
      .filter((r) => teamMode === 'both' || r.team === teamMode)
      .filter((r) => (focusPlayerId === 'all' ? true : r.id === focusPlayerId))
      .filter(bucketFilters[playerBucket] || (() => true))
      .slice();
    const dir = lbSort?.dir === 'asc' ? 1 : -1;
    const key = String(lbSort?.key || 'points');
    const get = (r) => {
      if (!r) return 0;
      const v = r[key];
      if (typeof v === 'number') return v;
      return 0;
    };
    list.sort((a, b) => (get(a) - get(b)) * dir || String(a?.player || '').localeCompare(String(b?.player || '')));
    return list;
  }, [leaderboard, lbSort, teamMode, focusPlayerId, playerBucket]);

  const toggleSort = (key) => {
    setLbSort((cur) => {
      if (cur?.key === key) return { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' };
      return { key, dir: 'desc' };
    });
  };

  const bucketColumns = useMemo(() => ({
    scoring: [
      { key: 'player', label: 'Player' },
      { key: 'team', label: 'Team', render: (r) => r.team === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home') },
      { key: 'shots', label: 'Shots', numeric: true },
      { key: 'scores', label: 'Scores', numeric: true },
      { key: 'points', label: 'Points', numeric: true },
      { key: 'shotConvPct', label: 'Shot Conv %', numeric: true, sortValue: (r) => (r.shots ? (r.scores / r.shots) * 100 : -1), render: (r) => r.shots ? formatPct((r.scores / r.shots) * 100) : 'NA' },
      { key: 'pointsPerShot', label: 'Pts/Shot', numeric: true, sortValue: (r) => (r.shots ? r.points / r.shots : -1), render: (r) => r.shots ? (r.points / r.shots).toFixed(2) : 'NA' },
      { key: 'avgShotDist', label: 'Avg Dist', numeric: true, sortValue: (r) => r.avgShotDist, render: (r) => Number.isFinite(r.avgShotDist) ? r.avgShotDist.toFixed(1) : 'NA' },
    ],
    progression: [
      { key: 'player', label: 'Player' },
      { key: 'team', label: 'Team', render: (r) => r.team === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home') },
      { key: 'progPassAtt', label: 'Prog Pass Att', numeric: true },
      { key: 'progPassComp', label: 'Prog Pass Comp', numeric: true },
      { key: 'progPassPct', label: 'Prog Pass %', numeric: true, sortValue: (r) => r.progPassPct, render: (r) => formatPct(r.progPassPct) },
      { key: 'progPassRecv', label: 'Prog Pass Rec', numeric: true },
      { key: 'progCarries', label: 'Prog Carries', numeric: true },
      { key: 'progMeters', label: 'Prog Meters', numeric: true, render: (r) => Number.isFinite(r.progMeters) ? r.progMeters.toFixed(1) : '0.0' },
      { key: 'scoringZoneEntriesCreated', label: 'Scoring Zone Entries', numeric: true },
      { key: 'passesIntoScoringZone', label: 'Passes Into Scoring Zone', numeric: true },
    ],
    retention: [
      { key: 'player', label: 'Player' },
      { key: 'team', label: 'Team', render: (r) => r.team === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home') },
      { key: 'passes', label: 'Passes', numeric: true },
      { key: 'passPct', label: 'Pass %', numeric: true, sortValue: (r) => r.passPct, render: (r) => formatPct(r.passPct) },
      { key: 'carries', label: 'Carries', numeric: true },
      { key: 'carryPct', label: 'Carry %', numeric: true, sortValue: (r) => r.carryPct, render: (r) => formatPct(r.carryPct) },
      { key: 'turnoversLost', label: 'TO Lost', numeric: true },
      { key: 'turnoverRate', label: 'TO Rate', numeric: true, sortValue: (r) => r.turnoverRate, render: (r) => formatPct(r.turnoverRate) },
      { key: 'touches', label: 'Touches', numeric: true },
    ],
    creation: [
      { key: 'player', label: 'Player' },
      { key: 'team', label: 'Team', render: (r) => r.team === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home') },
      { key: 'shotAssists', label: 'Shot Assists', numeric: true },
      { key: 'shotsCreated', label: 'Shots Created', numeric: true },
      { key: 'attacksInvolved', label: 'Attacks Involved', numeric: true },
      { key: 'scoringPossessionsInvolved', label: 'Scoring Possessions', numeric: true },
    ],
    defense: [
      { key: 'player', label: 'Player' },
      { key: 'team', label: 'Team', render: (r) => r.team === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home') },
      { key: 'turnoversWon', label: 'TO Won', numeric: true },
      { key: 'defActions', label: 'Def. Actions', numeric: true },
      { key: 'contacts', label: 'Contacts', numeric: true },
      { key: 'dispossessions', label: 'Dispossessions', numeric: true },
      { key: 'blocks', label: 'Blocks', numeric: true },
      { key: 'foulsWon', label: 'Fouls Won', numeric: true },
      { key: 'foulsConceded', label: 'Fouls Conceded', numeric: true },
    ],
    restarts: [
      { key: 'player', label: 'Player' },
      { key: 'team', label: 'Team', render: (r) => r.team === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home') },
      { key: 'kickoutTargets', label: 'KO Targets', numeric: true },
      { key: 'kickoutWins', label: 'KO Wins', numeric: true },
      { key: 'throwInsWon', label: 'Throw-Ins Won', numeric: true },
      { key: 'marks', label: 'Marks', numeric: true },
    ],
    goalkeepers: [
      { key: 'player', label: 'Player' },
      { key: 'team', label: 'Team', render: (r) => r.team === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home') },
      { key: 'kickoutsTaken', label: 'KOs Taken', numeric: true },
      { key: 'ownKickoutWinPct', label: 'Own KO Win %', numeric: true, sortValue: (r) => r.ownKickoutWinPct, render: (r) => r.kickoutsTaken ? `${r.ownKickoutsWon}/${r.kickoutsTaken} (${formatPct(r.ownKickoutWinPct)})` : 'NA' },
      { key: 'cleanKickoutWinPct', label: 'Clean KO Win %', numeric: true, sortValue: (r) => r.cleanKickoutWinPct, render: (r) => r.kickoutsTaken ? `${r.cleanKickoutsWon}/${r.kickoutsTaken} (${formatPct(r.cleanKickoutWinPct)})` : 'NA' },
      { key: 'shortKickoutsTaken', label: 'Short KOs', numeric: true },
      { key: 'longKickoutsTaken', label: 'Long KOs', numeric: true },
      { key: 'shortKickoutWinPct', label: 'Short Win %', numeric: true, sortValue: (r) => r.shortKickoutWinPct, render: (r) => r.shortKickoutsTaken ? `${r.shortKickoutsWon}/${r.shortKickoutsTaken} (${formatPct(r.shortKickoutWinPct)})` : 'NA' },
      { key: 'longKickoutWinPct', label: 'Long Win %', numeric: true, sortValue: (r) => r.longKickoutWinPct, render: (r) => r.longKickoutsTaken ? `${r.longKickoutsWon}/${r.longKickoutsTaken} (${formatPct(r.longKickoutWinPct)})` : 'NA' },
      { key: 'goalShotSavePct', label: 'Goal Shot Saves', numeric: true, sortValue: (r) => r.goalShotSavePct, render: (r) => (r.goalShotsSaved + r.goalShotsAgainst) ? `${r.goalShotsSaved}/${r.goalShotsSaved + r.goalShotsAgainst} (${formatPct(r.goalShotSavePct)})` : 'NA' },
    ],
  }), [homeTeam, awayTeam]);

  React.useEffect(() => {
    const defaults = {
      scoring: 'points',
      progression: 'progMeters',
      retention: 'touches',
      creation: 'shotsCreated',
      defense: 'turnoversWon',
      restarts: 'kickoutWins',
      goalkeepers: 'kickoutsTaken',
    };
    const nextKey = defaults[playerBucket] || 'points';
    const columns = bucketColumns[playerBucket] || [];
    if (!columns.some((c) => c.key === lbSort.key)) {
      setLbSort({ key: nextKey, dir: 'desc' });
    }
  }, [playerBucket, bucketColumns, lbSort.key]);

  const focusStats = useMemo(() => {
    if (focusPlayerId === 'all') return [];
    return base.filter((s) => {
      if (teamMode !== 'both' && s?.team_side !== teamMode) return false;
      const extra = safeParseJSON(s.extra_data || '{}', {});
      const ids = collectPlayerIds(extra);
      return ids.has(focusPlayerId);
    });
  }, [base, focusPlayerId, teamMode]);

  const currentColumns = bucketColumns[playerBucket] || bucketColumns.scoring;

  const formatBreakdownCell = (won, taken) => {
    if (!taken) return 'NA';
    return `${won}/${taken} (${formatPct((won / taken) * 100)})`;
  };

  const goalkeeperPressCards = useMemo(() => {
    if (playerBucket !== 'goalkeepers') return [];
    const cards = [];
    for (const row of sortedLeaderboard) {
      const pressRows = ['m2m', 'zonal', 'conceded']
        .map((press) => {
          const info = row.pressBreakdown?.[press];
          if (!info) return null;
          return {
            key: `${row.key}-${press}`,
            press: press === 'm2m' ? 'M2M' : toTitleCase(press),
            overall: formatBreakdownCell(info.won, info.taken),
            short: formatBreakdownCell(info.shortWon, info.shortTaken),
            long: formatBreakdownCell(info.longWon, info.longTaken),
          };
        })
        .filter(Boolean);
      if (!pressRows.length) continue;
      cards.push({
        key: row.key,
        player: row.player,
        team: row.team,
        ownKickoutsWon: row.ownKickoutsWon,
        kickoutsTaken: row.kickoutsTaken,
        pressRows,
      });
    }
    return cards;
  }, [playerBucket, sortedLeaderboard]);

  return (
    <div className="grid lg:grid-cols-[272px_minmax(0,1fr)] gap-4">
      <div className="space-y-4">
        <ReportFiltersCard reportFilters={scopedReportFilters} playerOptions={playerOptions} homeTeam={homeTeam} awayTeam={awayTeam} />
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
            <div className="flex flex-wrap gap-2">
              {[
                ['scoring', 'Scoring'],
                ['progression', 'Progression'],
                ['retention', 'Retention'],
                ['creation', 'Creation'],
                ['defense', 'Defense'],
                ['restarts', 'Restarts'],
                ['goalkeepers', 'Goalkeepers'],
              ].map(([value, label]) => (
                <Button
                  key={value}
                  type="button"
                  variant={playerBucket === value ? 'default' : 'outline'}
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setPlayerBucket(value)}
                >
                  {label}
                </Button>
              ))}
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  {currentColumns.map((col) => (
                    <TableHead
                      key={col.key}
                      className={col.numeric ? 'text-right cursor-pointer select-none' : 'cursor-pointer select-none'}
                      onClick={() => toggleSort(col.key)}
                    >
                      {col.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedLeaderboard.slice(0, 250).map((r) => (
                  <TableRow key={r.key}>
                    {currentColumns.map((col) => (
                      <TableCell key={col.key} className={col.numeric ? 'text-right tabular-nums' : (col.key === 'player' ? 'font-medium' : '')}>
                        {col.render ? col.render(r) : r[col.key]}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {playerBucket === 'goalkeepers' && goalkeeperPressCards.length > 0 && (
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="font-semibold text-slate-900">Kickout Press Breakdown</div>
              <div className="grid gap-3 lg:grid-cols-2">
                {goalkeeperPressCards.map((card) => (
                  <div key={card.key} className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-3">
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
                            <TableHead className="text-right">Short</TableHead>
                            <TableHead className="text-right">Long</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {card.pressRows.map((row) => (
                            <TableRow key={row.key}>
                              <TableCell className="font-medium">{row.press}</TableCell>
                              <TableCell className="text-right tabular-nums">{row.overall}</TableCell>
                              <TableCell className="text-right tabular-nums">{row.short}</TableCell>
                              <TableCell className="text-right tabular-nums">{row.long}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
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
  const [vizCounters, setVizCounters] = useState([]); // [] means any, otherwise possession transition states
  const [vizPlayerIds, setVizPlayerIds] = useState([]); // [] means all
  const [vizColorBy, setVizColorBy] = useState('team'); // team|action|outcome
  const [vizFiltersOpen, setVizFiltersOpen] = useState(false);
  const [sharedVizOpen, setSharedVizOpen] = useState(false);
  const [sharedVizTitle, setSharedVizTitle] = useState('');
  const [sharedVizStats, setSharedVizStats] = useState([]);
  const [activeTab, setActiveTab] = useState('summary');

  const [overviewHalf, setOverviewHalf] = useState('all'); // all|first|second

  // Shared "report" filters for the Scoring / Build-Up / Possessions tabs.
  const [reportTeam, setReportTeam] = useState('both'); // both|home|away
  const [reportHalves, setReportHalves] = useState([]); // [] means all
  const [reportPlayerIds, setReportPlayerIds] = useState([]); // [] means any
  const [reportActionTypes, setReportActionTypes] = useState([]); // [] means all
  const [reportOutcomes, setReportOutcomes] = useState([]); // [] means all
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
      .map((p) => ({
        id: p.id,
        team_side: p.team_side,
        label: label(p) || p.id,
        name: p.name || '',
        number: p.number ?? null,
        position: p.position || '',
      }));
  }, [homePlayers, awayPlayers]);

  const reportFilters = useMemo(() => ({
    team: reportTeam,
    setTeam: setReportTeam,
    halves: reportHalves,
    setHalves: setReportHalves,
    playerIds: reportPlayerIds,
    setPlayerIds: setReportPlayerIds,
    actionTypes: reportActionTypes,
    setActionTypes: setReportActionTypes,
    outcomes: reportOutcomes,
    setOutcomes: setReportOutcomes,
    timeMin: reportTimeMin,
    setTimeMin: setReportTimeMin,
    timeMax: reportTimeMax,
    setTimeMax: setReportTimeMax,
    imputedTimeById,
    match,
    allStats: stats,
  }), [reportTeam, reportHalves, reportPlayerIds, reportActionTypes, reportOutcomes, reportTimeMin, reportTimeMax, imputedTimeById, match, stats]);

  useEffect(() => {
    const allowedByTab = {
      scoring: ['shot'],
      possessions: ['pass', 'carry', 'shot', 'turnover', 'kickout', 'throw_in', 'foul'],
      build_up: ['pass', 'carry'],
      kickouts: ['kickout', 'throw_in'],
      misc: ['throw_in'],
      defense: ['turnover', 'defensive_contact', 'foul'],
      fouls: ['foul', 'pass', 'carry', 'turnover', 'kickout', 'throw_in'],
      players_ana: ['shot', 'pass', 'carry', 'turnover', 'foul', 'kickout', 'throw_in', 'defensive_contact'],
    };
    const allowed = allowedByTab[activeTab] || null;
    if (!allowed) return;

    const allowedSet = new Set(allowed);
    const nextActionTypes = (Array.isArray(reportActionTypes) ? reportActionTypes : []).filter((value) => allowedSet.has(value));
    const actionChanged =
      nextActionTypes.length !== reportActionTypes.length
      || nextActionTypes.some((value, index) => value !== reportActionTypes[index]);
    if (actionChanged) {
      setReportActionTypes(nextActionTypes);
    }

    const validOutcomes = new Set(
      (Array.isArray(stats) ? stats : [])
        .filter((s) => {
          const statType = String(s?.stat_type || '');
          if (!allowedSet.has(statType)) return false;
          if (nextActionTypes.length && !nextActionTypes.includes(statType)) return false;
          return true;
        })
        .map((s) => deriveOutcome(s, safeParseJSON(s?.extra_data || '{}', {})))
        .filter(Boolean)
    );

    const nextOutcomes = (Array.isArray(reportOutcomes) ? reportOutcomes : []).filter((value) => validOutcomes.has(value));
    const outcomesChanged =
      nextOutcomes.length !== reportOutcomes.length
      || nextOutcomes.some((value, index) => value !== reportOutcomes[index]);
    if (outcomesChanged) {
      setReportOutcomes(nextOutcomes);
    }
  }, [activeTab, reportActionTypes, reportOutcomes, stats]);

  const filteredForReport = useMemo(() => {
    const list = Array.isArray(stats) ? stats : [];
    const minM = Number(reportTimeMin);
    const maxM = Number(reportTimeMax);
    const minS = Number.isFinite(minM) && reportTimeMin !== '' ? minM * 60 : null;
    const maxS = Number.isFinite(maxM) && reportTimeMax !== '' ? maxM * 60 : null;

    return list.filter((s) => {
      if (!s) return false;
      if (reportHalves.length && !reportHalves.includes(s.half)) return false;
      if (reportActionTypes.length && !reportActionTypes.includes(String(s.stat_type || ''))) return false;
      if (reportOutcomes.length) {
        const extra = safeParseJSON(s.extra_data || '{}', {});
        const out = deriveOutcome(s, extra);
        if (!reportOutcomes.includes(out)) return false;
      }
      if (reportPlayerIds.length) {
        const extra = safeParseJSON(s.extra_data || '{}', {});
        const ids = collectPlayerIds(extra);
        const any = reportPlayerIds.some((id) => ids.has(id));
        if (!any) return false;
      }
      if (minS != null || maxS != null) {
        const t = getMatchTimeS(s, match, imputedTimeById);
        if (!Number.isFinite(t)) return false;
        if (minS != null && t < minS) return false;
        if (maxS != null && t > maxS) return false;
      }
      return true;
    });
  }, [stats, reportTeam, reportHalves, reportPlayerIds, reportActionTypes, reportOutcomes, reportTimeMin, reportTimeMax, imputedTimeById, match]);

  const filteredForViz = useMemo(() => {
    const list = Array.isArray(stats) ? stats : [];
    const possessionGroups = groupByPossession(list);
    const counterStateByPossession = new Map(
      Array.from(possessionGroups.entries()).map(([key, evs]) => {
        const [teamSide] = String(key).split('-');
        const acting = (Array.isArray(evs) ? evs : []).filter((e) => e && e.team_side === teamSide);
        return [key, deriveCounterAttackState(acting)];
      })
    );
    return list.filter((s) => {
      if (!s) return false;
      if (vizTeam !== 'both' && s.team_side !== vizTeam) return false;
      if (vizActions.length && !vizActions.includes(s.stat_type)) return false;
      if (vizHalves.length && !vizHalves.includes(s.half)) return false;
      if (vizCounters.length) {
        const possKey = `${s?.possession_team_side || 'unknown'}-${s?.possession_id ?? 'na'}`;
        const state = counterStateByPossession.get(possKey) || 'Set Attack';
        const stateKey = state === 'Counter Attack' ? 'counter_attack' : state === 'Counter -> Set' ? 'counter_to_set' : 'set_attack';
        if (!vizCounters.includes(stateKey)) return false;
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

  const SHARED_VIZ_PRE_ROLL_S = 7;

  const openSharedVideoAt = (timeS) => {
    const t = Number(timeS);
    if (!matchId || !Number.isFinite(t)) return;
    const seekTo = Math.max(0, Math.floor(t - SHARED_VIZ_PRE_ROLL_S));
    const url = `${window.location.origin}${window.location.pathname}#${createPageUrl(`Video?matchId=${matchId}`)}`;
    window.open(url, 'gstl_video', 'popup=yes,width=1100,height=650');
    try {
      const ch = new BroadcastChannel('gstl_video');
      const msg = { matchId, type: 'SEEK_TO', time_s: seekTo };
      ch.postMessage(msg);
      setTimeout(() => ch.postMessage(msg), 350);
      setTimeout(() => { ch.postMessage(msg); ch.close(); }, 900);
    } catch {
      // ignore
    }
  };

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

  const overviewPossessionOutcome = useMemo(() => {
    const groups = groupByPossession(overviewStats);
    const init = () => ({ Score: 0, 'Missed Shot': 0, Turnover: 0, 'Half End': 0 });
    const outcomes = { home: init(), away: init() };

    for (const [key, evs] of groups.entries()) {
      const [teamSide] = String(key).split('-');
      if (teamSide !== 'home' && teamSide !== 'away') continue;
      const acting = (Array.isArray(evs) ? evs : []).filter((e) => e && e.team_side === teamSide);
      if (!acting.length) continue;

      const outcome = derivePossessionOutcome(evs, teamSide);

      if (outcomes[teamSide][outcome] == null) outcomes[teamSide][outcome] = 0;
      outcomes[teamSide][outcome] += 1;
    }

    return [
      { team: homeTeam?.name || 'Home', side: 'home', ...outcomes.home },
      { team: awayTeam?.name || 'Away', side: 'away', ...outcomes.away },
    ];
  }, [overviewStats, homeTeam, awayTeam]);

  const overviewMomentum = useMemo(() => {
    const list = Array.isArray(overviewStats) ? overviewStats : [];
    const withTime = list
      .map((s) => ({ stat: s, matchTime: getMatchTimeS(s, match, imputedTimeById) }))
      .filter((entry) => Number.isFinite(entry.matchTime))
      .sort((a, b) => a.matchTime - b.matchTime);
    if (!withTime.length) return { mode: 'none', rows: [] };

    const share = (a, b) => {
      const d = a + b;
      if (!Number.isFinite(d) || d <= 0) return 0.5;
      return a / d;
    };

    const turnoverLostSide = (s) => {
      const ex = safeParseJSON(s?.extra_data || '{}', {});
      const lost = ex?.turnover?.lost_by?.team_side;
      if (lost === 'home' || lost === 'away') return lost;
      return null;
    };

    const possessionStarts = [];
    const groups = groupByPossession(withTime.map((entry) => entry.stat));
    for (const [key, events] of groups.entries()) {
      const times = events
        .map((event) => getMatchTimeS(event, match, imputedTimeById))
        .filter(Number.isFinite)
        .sort((a, b) => a - b);
      if (!times.length) continue;
      possessionStarts.push({
        key,
        side: String(key).startsWith('away-') ? 'away' : 'home',
        time: times[0],
      });
    }

    const offsets = getMatchSectionOffsets(match);
    const actualMax = withTime.reduce((m, entry) => Math.max(m, entry.matchTime), 0);
    const baseMax = offsets.second * 2;
    const axisMax = Math.max(baseMax, actualMax);
    const lastMinute = Math.max(1, Math.ceil(axisMax / 60));

    const rows = Array.from({ length: lastMinute + 1 }, (_, minuteIndex) => {
      const minuteMark = minuteIndex * 60;
      const windowStart = Math.max(0, minuteMark - 5 * 60);
      const windowStats = withTime.filter((entry) => entry.matchTime > windowStart && entry.matchTime <= minuteMark);
      const statsBySide = {
        home: { pts: 0, shots: 0, poss: new Set(), toLost: 0, possWins: 0 },
        away: { pts: 0, shots: 0, poss: new Set(), toLost: 0, possWins: 0 },
      };

      for (const { stat } of windowStats) {
        const pid = Number(stat?.possession_id);
        const pside = stat?.possession_team_side;
        if (Number.isFinite(pid) && (pside === 'home' || pside === 'away')) {
          statsBySide[pside].poss.add(`${pside}-${pid}`);
        }

        if (stat.stat_type === 'shot') {
          const ex = safeParseJSON(stat.extra_data || '{}', {});
          const o = ex?.shot?.outcome;
          const add = shotPointsForOutcome(o);
          if (stat.team_side === 'home') {
            statsBySide.home.shots += 1;
            statsBySide.home.pts += add;
          }
          if (stat.team_side === 'away') {
            statsBySide.away.shots += 1;
            statsBySide.away.pts += add;
          }
        }

        if (stat.stat_type === 'turnover' || safeParseJSON(stat?.extra_data || '{}', {})?.turnover) {
          const lostSide = turnoverLostSide(stat);
          if (lostSide) statsBySide[lostSide].toLost += 1;
        }
      }

      for (const pos of possessionStarts) {
        if (pos.time > windowStart && pos.time <= minuteMark) {
          statsBySide[pos.side].possWins += 1;
        }
      }

      const homePoss = statsBySide.home.poss.size;
      const awayPoss = statsBySide.away.poss.size;

      const homeProd = homePoss ? statsBySide.home.pts / homePoss : 0;
      const awayProd = awayPoss ? statsBySide.away.pts / awayPoss : 0;

      const homeTC = homePoss ? (1 - statsBySide.home.toLost / homePoss) : 0;
      const awayTC = awayPoss ? (1 - statsBySide.away.toLost / awayPoss) : 0;

      const homeEff = statsBySide.home.shots ? (statsBySide.home.pts / statsBySide.home.shots) : 0;
      const awayEff = statsBySide.away.shots ? (statsBySide.away.pts / statsBySide.away.shots) : 0;

      const pointShareHome = share(statsBySide.home.pts, statsBySide.away.pts);
      const prodShareHome = share(homeProd, awayProd);
      const tcShareHome = share(homeTC, awayTC);
      const pwShareHome = share(statsBySide.home.possWins, statsBySide.away.possWins);
      const effShareHome = share(homeEff, awayEff);

      const mHome = 100 * (0.35 * pointShareHome + 0.25 * prodShareHome + 0.20 * tcShareHome + 0.10 * pwShareHome + 0.10 * effShareHome);
      const mAway = 100 - mHome;

      return {
        minute: minuteMark / 60,
        label: formatMMSS(minuteMark),
        home: Number.isFinite(mHome) ? mHome : 50,
        away: Number.isFinite(mAway) ? mAway : 50,
        home_pts: statsBySide.home.pts,
        away_pts: statsBySide.away.pts,
        home_poss: homePoss,
        away_poss: awayPoss,
        home_to: statsBySide.home.toLost,
        away_to: statsBySide.away.toLost,
      };
    });

    return { mode: 'rolling', rows, axisMaxMinutes: Math.ceil(axisMax / 60) };
  }, [overviewStats, match, imputedTimeById]);

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
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <TabsList>
              <TabsTrigger value="summary">Overview</TabsTrigger>
              <TabsTrigger value="scoring">Scoring</TabsTrigger>
              <TabsTrigger value="possessions">Possessions</TabsTrigger>
              <TabsTrigger value="build_up">Build-Up</TabsTrigger>
              <TabsTrigger value="kickouts">Kickouts</TabsTrigger>
              <TabsTrigger value="misc">Misc</TabsTrigger>
              <TabsTrigger value="defense">Defense</TabsTrigger>
              <TabsTrigger value="fouls">Fouls</TabsTrigger>
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

                  <div className="grid grid-cols-[minmax(0,1fr)_180px_minmax(0,1fr)] items-center gap-3 text-xs text-slate-600 pt-2">
                    <div className="inline-flex items-center gap-2 min-w-0 justify-self-start">
                      <span className="inline-block w-2 h-2 rounded-full" style={{ background: homeTeam?.color || '#22c55e' }} />
                      <span className="truncate">{homeTeam?.name || 'Home'}</span>
                    </div>
                    <div className="font-medium text-center">Metric</div>
                    <div className="inline-flex items-center gap-2 min-w-0 justify-end justify-self-end">
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
                          // Zero-sum differential based on turnover wins.
                          home: summary.home.turnoversWon - summary.away.turnoversWon,
                          away: summary.away.turnoversWon - summary.home.turnoversWon,
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
                          <div className="grid grid-cols-[minmax(0,1fr)_180px_minmax(0,1fr)] items-center gap-3">
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
                            <LineChart data={overviewMomentum.rows} margin={{ top: 10, right: 16, left: 0, bottom: 6 }}>
                              <CartesianGrid vertical={false} />
                              <XAxis
                                dataKey="minute"
                                type="number"
                                domain={[0, Math.max(5, overviewMomentum.axisMaxMinutes || 5)]}
                                tickCount={Math.max(4, Math.ceil((overviewMomentum.axisMaxMinutes || 5) / 10))}
                                tickFormatter={(value) => `${Math.round(value)}`}
                                className="text-xs"
                              />
                              <YAxis className="text-xs" domain={[0, 100]} tick={false} axisLine={false} tickLine={false} />
                              <Tooltip content={<ChartTooltipContent />} />
                              <Legend />
                              <ReferenceLine y={50} stroke="#94a3b8" strokeDasharray="4 4" />
                              <Line
                                type="monotone"
                                dataKey="home"
                                stroke={homeTeam?.color || '#22c55e'}
                                strokeWidth={3}
                                dot={false}
                                activeDot={{ r: 4 }}
                              />
                              <Line
                                type="monotone"
                                dataKey="away"
                                stroke={awayTeam?.color || '#ef4444'}
                                strokeWidth={3}
                                dot={false}
                                activeDot={{ r: 4 }}
                              />
                            </LineChart>
                          </ChartContainer>
                        )}
                        <div className="text-[11px] text-slate-500">Composite share using a rolling 5-minute window (points, productivity, turnover control, possession wins, efficiency).</div>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardContent className="p-4 space-y-3">
                        <div className="font-semibold text-slate-900">Possession Outcomes</div>
                        <ChartContainer
                          id="possession-outcomes-overview"
                          className="h-[240px] w-full"
                          config={{}}
                        >
                          <BarChart data={overviewPossessionOutcome} margin={{ top: 10, right: 16, left: 0, bottom: 6 }}>
                            <CartesianGrid vertical={false} />
                            <XAxis dataKey="team" className="text-xs" />
                            <YAxis allowDecimals={false} className="text-xs" />
                            <Tooltip content={<ChartTooltipContent />} />
                            <Legend />
                            {[
                              { k: 'Score', c: '#1d4ed8' },
                              { k: 'Missed Shot', c: '#64748b' },
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
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="visualiser">
            <div className="grid lg:grid-cols-[340px_1fr] gap-4">
              <Card>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-semibold text-slate-900">Filters</div>
                      {!vizFiltersOpen && <div className="text-[11px] text-slate-500">Collapsed</div>}
                    </div>
                    <Button type="button" variant="outline" size="sm" className="h-8 px-2 text-xs" onClick={() => setVizFiltersOpen((v) => !v)}>
                      {vizFiltersOpen ? 'Hide Filters' : 'Show Filters'}
                      <ChevronDown className={`ml-1 h-3.5 w-3.5 transition-transform ${vizFiltersOpen ? 'rotate-180' : ''}`} />
                    </Button>
                  </div>

                  {!vizFiltersOpen ? (
                    <div className="text-xs text-slate-500">Showing {filteredForViz.length} events.</div>
                  ) : (
                    <>
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
                          { value: 'set_attack', label: 'Set Attack' },
                          { value: 'counter_attack', label: 'Counter Attack' },
                          { value: 'counter_to_set', label: 'Counter -> Set' },
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

                      <div className="text-xs text-slate-500 pt-2">Showing {filteredForViz.length} events.</div>
                    </>
                  )}
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
              onVisualisePossession={(p) => {
                const titleTeam = p?.teamSide === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home');
                setSharedVizStats(Array.isArray(p?.stats) ? p.stats : []);
                setSharedVizTitle(`Possession #${p?.possessionId ?? 'NA'} - ${titleTeam}`);
                setSharedVizOpen(true);
              }}
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
              match={match}
              stats={stats}
              homeTeam={homeTeam}
              awayTeam={awayTeam}
              homePlayers={homePlayers}
              awayPlayers={awayPlayers}
            />
          </TabsContent>
        </Tabs>
      </main>

      <Dialog open={sharedVizOpen} onOpenChange={setSharedVizOpen}>
        <DialogContent className="sm:max-w-4xl p-4">
          <DialogHeader>
            <div className="flex items-center justify-between gap-2">
              <DialogTitle className="text-base">{sharedVizTitle || 'Visualise'}</DialogTitle>
              {(() => {
                const times = (sharedVizStats || []).map((s) => Number(s?.time_s)).filter(Number.isFinite);
                if (!times.length) return null;
                const t = Math.min(...times);
                return (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 px-3 text-xs"
                    onClick={() => openSharedVideoAt(t)}
                    title="Open the video popout and jump to this timestamp"
                  >
                    Open Video @ {formatMMSS(Math.max(0, t - SHARED_VIZ_PRE_ROLL_S))}
                  </Button>
                );
              })()}
            </div>
          </DialogHeader>
          <div className="pt-2">
            <PitchViz
              stats={sharedVizStats}
              homeColor={homeTeam?.color}
              awayColor={awayTeam?.color}
              colorBy="team"
              showColorControls={false}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DataTab({ matchId, match, stats, homeTeam, awayTeam, homePlayers, awayPlayers }) {
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
        let t = getMatchTimeS(s, match, imputedTimeById);
        if (!Number.isFinite(t)) return false;
        if (minS != null && t < minS) return false;
        if (maxS != null && t > maxS) return false;
      }
      return true;
    });
  }, [stats, team, actions, halves, playerIds, timeMin, timeMax, imputedTimeById, match]);

  const filteredSorted = useMemo(() => {
    const list = Array.isArray(filtered) ? [...filtered] : [];
    const timeKey = (s) => {
      const mt = getMatchTimeS(s, match, imputedTimeById);
      if (Number.isFinite(mt)) return { kind: 0, v: mt };
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
  }, [filtered, imputedTimeById, match]);

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
        attack: false,
        attack_entry_channel: '',
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
        const tn = getMatchTimeS(s, match, imputedTimeById);
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
      for (const row of arr) {
        const [side] = String(row.key || '').split('-');
        const groupStats = filtered.filter((s) => keyForGroup(s) === row.key);
        row.attack = isAttackPossession(groupStats, side);
        row.attack_entry_channel = row.attack ? getAttackEntryChannelForPossession(groupStats, side) : '';
        row.end_outcome = derivePossessionOutcome(groupStats, side);
      }
      arr.sort((a, b) => {
        const ta = a.start_time_norm_s;
        const tb = b.start_time_norm_s;
        if (ta != null && tb != null && ta !== tb) return ta - tb;
        if (a._minPlay != null && b._minPlay != null && a._minPlay !== b._minPlay) return a._minPlay - b._minPlay;
        return String(a.key).localeCompare(String(b.key));
      });
      return arr;
    }
    return arr.sort((a, b) => String(a.key).localeCompare(String(b.key)));
  }, [filtered, groupBy, match, imputedTimeById]);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4">
          <div className="font-semibold text-slate-900 mb-3">Filters</div>
          <div className="grid lg:grid-cols-7 gap-3 items-end">
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
            <div className="space-y-1">
              <Label className="text-xs text-slate-600">Start Time</Label>
              <Input className="h-8 text-xs" inputMode="numeric" value={timeMin} onChange={(e) => setTimeMin(e.target.value)} placeholder="e.g. 0" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-slate-600">End Time</Label>
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
                      <TableHead>End Outcome</TableHead>
                      <TableHead>Attack</TableHead>
                      <TableHead>Entry</TableHead>
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
                        return (
                          <>
                            <TableCell className="font-mono text-xs">#{num || 'NA'}</TableCell>
                            <TableCell className="font-medium">{teamName}</TableCell>
                            <TableCell>{toTitleCase(r.start_half || '')}</TableCell>
                            <TableCell className="text-right font-mono text-xs">{start}</TableCell>
                            <TableCell className="text-right font-mono text-xs">{end}</TableCell>
                            <TableCell className="text-right font-mono text-xs">{dur}</TableCell>
                            <TableCell>{r.start_source || 'NA'}</TableCell>
                            <TableCell>{r.end_outcome || 'NA'}</TableCell>
                            <TableCell>{r.attack ? 'Yes' : 'No'}</TableCell>
                            <TableCell>{r.attack_entry_channel || 'NA'}</TableCell>
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
                          {(() => {
                            const mt = getMatchTimeS(s, match, imputedTimeById);
                            return Number.isFinite(mt) ? formatMatchClock(mt, match, s.half) : '--:--';
                          })()}
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
                                  const t = getMatchTimeS(s, match, imputedTimeById);
                                  return Number.isFinite(t) ? formatMatchClock(t, match, s.half) : 'NA';
                                })() },
                                { label: 'X, Y', value: Number.isFinite(Number(s.x_position)) && Number.isFinite(Number(s.y_position)) ? `${Number(s.x_position).toFixed(2)}, ${Number(s.y_position).toFixed(2)}` : 'NA' },
                                { label: 'End X, Y', value: Number.isFinite(Number(s.end_x_position)) && Number.isFinite(Number(s.end_y_position)) ? `${Number(s.end_x_position).toFixed(2)}, ${Number(s.end_y_position).toFixed(2)}` : 'NA' },
                                { label: 'Raw X, Y', value: Number.isFinite(Number(s.raw_x_position)) && Number.isFinite(Number(s.raw_y_position)) ? `${Number(s.raw_x_position).toFixed(2)}, ${Number(s.raw_y_position).toFixed(2)}` : 'NA' },
                                { label: 'Raw End', value: Number.isFinite(Number(s.raw_end_x_position)) && Number.isFinite(Number(s.raw_end_y_position)) ? `${Number(s.raw_end_x_position).toFixed(2)}, ${Number(s.raw_end_y_position).toFixed(2)}` : 'NA' },
                              ];

                              const extraItems = flattenExtra(extra)
                                .filter((r) => r.key !== 'counter_attack') // already shown above
                                // Hide any pitch dimension/debug keys that can appear in older rows.
                                .filter((r) => !/(^|\\b)pitch([._-]?(w|h|width|height|length))\\b/i.test(String(r.key || '')))
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
