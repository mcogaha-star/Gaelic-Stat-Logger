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
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine } from 'recharts';

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
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(1)}%`;
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
    return s.team_side === 'away' ? (awayColor || '#ef4444') : (homeColor || '#22c55e');
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
          {stats.map((s) => {
            const extra = safeParseJSON(s.extra_data || '{}', {});
            const col = getColor(s, extra);
            const tip = tooltipText(s, extra);
            const x1 = Number(s.x_position);
            const y1 = Number(s.y_position);
            const x2 = Number(s.end_x_position);
            const y2 = Number(s.end_y_position);

            if (!Number.isFinite(x1) || !Number.isFinite(y1)) return null;

            // Lines for passes/carries with end coords; dots otherwise.
            const hasEnd = Number.isFinite(x2) && Number.isFinite(y2);
            if ((s.stat_type === 'pass' || s.stat_type === 'carry') && hasEnd) {
              return (
                <g key={s.id}>
                  <title>{tip}</title>
                  <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={col} strokeWidth="0.7" opacity="0.95" />
                  <circle cx={x1} cy={y1} r="1.25" fill={col} />
                  <circle cx={x2} cy={y2} r="1.25" fill={col} />
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

      {showColorControls && (colorBy === 'action' || colorBy === 'outcome') && (
        <div className="border-t bg-slate-50 px-3 py-2">
          <div className="text-xs font-semibold text-slate-700">Colors</div>
          <div className="pt-2 grid grid-cols-2 gap-2">
            {(colorBy === 'action'
              ? ['shot', 'kickout', 'pass', 'carry', 'turnover', 'foul', 'throw_in', 'defensive_contact'].map((k) => ({ key: k, label: toTitleCase(k) }))
              : Array.from(new Set(stats.map((s) => deriveOutcome(s, safeParseJSON(s.extra_data || '{}', {}))).filter(Boolean)))
                .sort((a, b) => String(a).localeCompare(String(b)))
                .map((k) => ({ key: k, label: toTitleCase(k) }))
            ).map((item) => {
              const key = item.key;
              const value = colorBy === 'action'
                ? (actionPalette?.[key] || defaultActionPalette[key] || '#111827')
                : (outcomePalette?.[key] || defaultOutcomePalette[key] || '#111827');
              return (
                <div key={key} className="flex items-center justify-between gap-2 rounded-md bg-white border border-slate-200 px-2 py-1">
                  <div className="text-xs text-slate-700 truncate">{item.label}</div>
                  <input
                    type="color"
                    value={value}
                    onChange={(e) => {
                      const next = e.target.value;
                      if (colorBy === 'action') {
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
                if (colorBy === 'action') {
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
                <title>{`${aLabel} → ${bLabel}: ${e.count_ab}\n${bLabel} → ${aLabel}: ${e.count_ba}\nTotal: ${e.total}`}</title>
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

  const [pnSide, setPnSide] = useState('home'); // home|away
  const [pnMin, setPnMin] = useState(3);

  const [overviewHalf, setOverviewHalf] = useState('all'); // all|first|second

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
      turnovers: 0,
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
        if (lost?.team_side === 'home' || lost?.team_side === 'away') {
          out[lost.team_side].turnovers += 1;
        } else {
          // Fallback: attribute to acting team.
          out[side].turnovers += 1;
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
                {match?.date || ''}{match?.venue ? ` • ${match.venue}` : ''}
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
              <TabsTrigger value="visualiser">Visualiser</TabsTrigger>
              <TabsTrigger value="pass_network">Pass Network</TabsTrigger>
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
                      const metrics = [
                        {
                          label: 'Score',
                          home: `${summary.home.goals}:${homePts} (${summary.home.totalPoints})`,
                          away: `${summary.away.goals}:${awayPts} (${summary.away.totalPoints})`,
                          strong: true,
                        },
                        { label: 'Shots', home: summary.home.shots, away: summary.away.shots },
                        {
                          label: 'Points Per Shot',
                          home: summary.home.shots ? (summary.home.totalPoints / summary.home.shots).toFixed(2) : '—',
                          away: summary.away.shots ? (summary.away.totalPoints / summary.away.shots).toFixed(2) : '—',
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
                        { label: 'Turnovers Lost', home: summary.home.turnovers, away: summary.away.turnovers },
                        {
                          label: 'Points Per Possession',
                          home: summary.home.possessions ? (summary.home.totalPoints / summary.home.possessions).toFixed(2) : '—',
                          away: summary.away.possessions ? (summary.away.totalPoints / summary.away.possessions).toFixed(2) : '—',
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

          <TabsContent value="pass_network">
            <div className="grid lg:grid-cols-[340px_1fr] gap-4">
              <Card>
                <CardContent className="p-4 space-y-3">
                  <div className="font-semibold text-slate-900">Pass Network</div>
                  <div className="text-xs text-slate-500">
                    Built from completed passes (passer to receiver).
                  </div>

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
                      className="h-8 text-xs"
                      value={pnMin}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (!Number.isFinite(v)) return;
                        setPnMin(Math.max(1, Math.floor(v)));
                      }}
                    />
                  </div>

                  <div className="text-xs text-slate-500 pt-2">
                    Tip: set a higher threshold (e.g. 4 to 8) to reduce clutter.
                  </div>
                </CardContent>
              </Card>

              <PassNetwork
                passes={(Array.isArray(stats) ? stats : []).filter((s) => s?.stat_type === 'pass')}
                side={pnSide}
                minCount={pnMin}
                teamColor={pnSide === 'away' ? awayTeam?.color : homeTeam?.color}
              />
            </div>
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
  const [counters, setCounters] = useState([]); // [] means any
  const [groupBy, setGroupBy] = useState('none'); // none|team|player|action|half|outcome
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

  const filtered = useMemo(() => {
    const list = Array.isArray(stats) ? stats : [];
    return list.filter((s) => {
      if (!s) return false;
      if (team !== 'both' && s.team_side !== team) return false;
      if (actions.length && !actions.includes(s.stat_type)) return false;
      if (halves.length && !halves.includes(s.half)) return false;
      if (counters.length) {
        const isYes = !!s.counter_attack;
        if (isYes && !counters.includes('yes')) return false;
        if (!isYes && !counters.includes('no')) return false;
      }
      return true;
    });
  }, [stats, team, actions, halves, counters]);

  const filteredSorted = useMemo(() => {
    const list = Array.isArray(filtered) ? [...filtered] : [];
    const timeKey = (s) => {
      const tn = Number(s?.normalized_time_s);
      if (Number.isFinite(tn)) return { kind: 0, v: tn };
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
  }, [filtered]);

  const keyForGroup = (s) => {
    const extra = safeParseJSON(s?.extra_data || '{}', {});
    if (groupBy === 'team') return s?.team_side || 'unknown';
    if (groupBy === 'action') return s?.stat_type || 'unknown';
    if (groupBy === 'half') return s?.half || 'unknown';
    if (groupBy === 'outcome') return deriveOutcome(s, extra) || 'unknown';
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
      const cur = rows.get(key) || { key, count: 0, shotPoints: 0 };
      cur.count += 1;
      if (s.stat_type === 'shot') {
        const o = extra?.shot?.outcome;
        if (o === 'goal') cur.shotPoints += 3;
        if (o === 'point') cur.shotPoints += 1;
        if (o === '2_point') cur.shotPoints += 2;
      }
      rows.set(key, cur);
    }

    return Array.from(rows.values()).sort((a, b) => String(a.key).localeCompare(String(b.key)));
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
              label="Counter Attack"
              placeholder="Any"
              values={counters}
              onChange={setCounters}
              options={[
                { value: 'yes', label: 'Yes' },
                { value: 'no', label: 'No' },
              ]}
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
                </SelectContent>
              </Select>
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
                const firstWithTime = (vizStats || []).find((s) => Number.isFinite(Number(s?.time_s)));
                if (!firstWithTime) return null;
                const t = Number(firstWithTime.time_s);
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
                  <TableHead>{toTitleCase(groupBy)}</TableHead>
                  <TableHead>Count</TableHead>
                  <TableHead>Shot Points</TableHead>
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
                      setVizTitle(`${toTitleCase(groupBy)}: ${toTitleCase(r.key)} (${groupStats.length})`);
                      setVizOpen(true);
                    }}
                  >
                    <TableCell className="font-medium">{toTitleCase(r.key)}</TableCell>
                    <TableCell>{r.count}</TableCell>
                    <TableCell>{r.shotPoints}</TableCell>
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
                                setVizTitle(`${toTitleCase(s.stat_type)} • ${toTitleCase(s.half)} • ${s.team_side === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home')}`);
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
                            <div className="grid md:grid-cols-3 gap-3">
                              <div className="rounded-lg border border-slate-200 bg-white p-3">
                                <div className="text-xs font-semibold text-slate-900 mb-2">Core</div>
                                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                                  <div className="text-slate-500">Play</div>
                                  <div className="font-mono">{Number.isFinite(Number(s.play_id)) ? Number(s.play_id) : '—'}</div>
                                  <div className="text-slate-500">Possession</div>
                                  <div className="font-mono">{Number.isFinite(Number(s.possession_id)) ? Number(s.possession_id) : '—'}</div>
                                  <div className="text-slate-500">Counter</div>
                                  <div className="font-mono">{s.counter_attack ? 'Yes' : 'No'}</div>
                                  <div className="text-slate-500">Video</div>
                                  <div className="font-mono">{Number.isFinite(Number(s.time_s)) ? formatMMSS(Number(s.time_s)) : '—'}</div>
                                  <div className="text-slate-500">Time</div>
                                  <div className="font-mono">{Number.isFinite(Number(s.normalized_time_s)) ? formatMMSS(Number(s.normalized_time_s)) : '—'}</div>
                                </div>
                              </div>

                              <div className="rounded-lg border border-slate-200 bg-white p-3">
                                <div className="text-xs font-semibold text-slate-900 mb-2">Coordinates</div>
                                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                                  <div className="text-slate-500">X, Y</div>
                                  <div className="font-mono">
                                    {Number.isFinite(Number(s.x_position)) && Number.isFinite(Number(s.y_position))
                                      ? `${Number(s.x_position).toFixed(2)}, ${Number(s.y_position).toFixed(2)}`
                                      : '—'}
                                  </div>
                                  <div className="text-slate-500">End X, Y</div>
                                  <div className="font-mono">
                                    {Number.isFinite(Number(s.end_x_position)) && Number.isFinite(Number(s.end_y_position))
                                      ? `${Number(s.end_x_position).toFixed(2)}, ${Number(s.end_y_position).toFixed(2)}`
                                      : '—'}
                                  </div>
                                  <div className="text-slate-500">Raw X, Y</div>
                                  <div className="font-mono">
                                    {Number.isFinite(Number(s.raw_x_position)) && Number.isFinite(Number(s.raw_y_position))
                                      ? `${Number(s.raw_x_position).toFixed(2)}, ${Number(s.raw_y_position).toFixed(2)}`
                                      : '—'}
                                  </div>
                                  <div className="text-slate-500">Raw End</div>
                                  <div className="font-mono">
                                    {Number.isFinite(Number(s.raw_end_x_position)) && Number.isFinite(Number(s.raw_end_y_position))
                                      ? `${Number(s.raw_end_x_position).toFixed(2)}, ${Number(s.raw_end_y_position).toFixed(2)}`
                                      : '—'}
                                  </div>
                                </div>
                              </div>

                              <div className="rounded-lg border border-slate-200 bg-white p-3">
                                <div className="text-xs font-semibold text-slate-900 mb-2">Details</div>
                                <details>
                                  <summary className="text-xs text-slate-600 cursor-pointer select-none">Show extra data</summary>
                                  <pre className="mt-2 text-[11px] leading-snug bg-slate-950 text-slate-50 rounded-md p-2 overflow-auto max-h-40">
                                    {JSON.stringify(extra, null, 2)}
                                  </pre>
                                </details>
                              </div>
                            </div>
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
