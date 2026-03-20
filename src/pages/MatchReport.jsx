import React, { useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, BarChart3 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { createPageUrl } from '@/utils';
import pitchImg from '@/assets/pitch.png';

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

function PitchViz({ stats, homeColor, awayColor, colorBy }) {
  const tooltipText = (s, extra) => {
    const lines = [];
    const team = s.team_side === 'away' ? 'Away' : 'Home';
    lines.push(`Team: ${team}`);
    lines.push(`Half: ${toTitleCase(s.half)}`);
    lines.push(`Action: ${toTitleCase(s.stat_type)}`);
    const out = deriveOutcome(s, extra);
    if (out) lines.push(`Outcome: ${toTitleCase(out)}`);
    if (s.player_number) lines.push(`Player: #${s.player_number}`);
    if (Number.isFinite(Number(s.time_s))) lines.push(`Time: ${formatMMSS(Number(s.time_s))}`);
    if (Number.isFinite(Number(s.normalized_time_s))) lines.push(`Norm: ${formatMMSS(Number(s.normalized_time_s))}`);
    if (Number.isFinite(Number(s.play_id))) lines.push(`Play: ${Number(s.play_id)}`);
    if (Number.isFinite(Number(s.possession_id))) lines.push(`Poss: ${Number(s.possession_id)}`);
    return lines.join('\n');
  };

  const getColor = (s, extra) => {
    if (colorBy === 'action') {
      // Deterministic palette by stat type.
      const map = {
        shot: '#111827',
        kickout: '#0f766e',
        pass: '#2563eb',
        carry: '#7c3aed',
        turnover: '#dc2626',
        foul: '#d97706',
        throw_in: '#0891b2',
        defensive_contact: '#334155',
      };
      return map[s.stat_type] || '#111827';
    }
    if (colorBy === 'outcome') {
      const o = deriveOutcome(s, extra);
      if (!o) return '#111827';
      if (o === 'completed' || o === 'clean' || o === 'point' || o === '2_point' || o === 'goal') return '#16a34a';
      if (o === 'turnover' || o === 'foul' || o === 'sideline_against') return '#dc2626';
      return '#111827';
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
      carries: 0,
      takeOnsAttempted: 0,
      takeOnsCompleted: 0,
      defensiveActions: 0,
      possessions: 0,
      attacks: 0,
    };
    const out = { home: { ...empty }, away: { ...empty } };
    const list = Array.isArray(stats) ? stats : [];

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
  }, [stats]);

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
              <TabsTrigger value="summary">Summary</TabsTrigger>
              <TabsTrigger value="visualiser">Visualiser</TabsTrigger>
              <TabsTrigger value="data">Data</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="summary">
            <Card>
              <CardContent className="p-4">
                <div className="font-semibold text-slate-900 mb-3">Summary (Per Team)</div>

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        <span className="inline-flex items-center gap-2">
                          <span className="inline-block w-2 h-2 rounded-full" style={{ background: homeTeam?.color || '#22c55e' }} />
                          {homeTeam?.name || 'Home'}
                        </span>
                      </TableHead>
                      <TableHead className="text-center">Metric</TableHead>
                      <TableHead>
                        <span className="inline-flex items-center gap-2">
                          <span className="inline-block w-2 h-2 rounded-full" style={{ background: awayTeam?.color || '#ef4444' }} />
                          {awayTeam?.name || 'Away'}
                        </span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(() => {
                      const homePts = summary.home.points1 + summary.home.points2 * 2;
                      const awayPts = summary.away.points1 + summary.away.points2 * 2;
                      return (
                        <TableRow key="score">
                          <TableCell className="font-semibold">{`${summary.home.goals}:${homePts}`}</TableCell>
                          <TableCell className="font-medium text-center">Score</TableCell>
                          <TableCell className="font-semibold">{`${summary.away.goals}:${awayPts}`}</TableCell>
                        </TableRow>
                      );
                    })()}
                    {[
                      ['Shots', summary.home.shots, summary.away.shots],
                      ['Goals', summary.home.goals, summary.away.goals],
                      ['1 Pointers', summary.home.points1, summary.away.points1],
                      ['2 Pointers', summary.home.points2, summary.away.points2],
                      ['Total Points', summary.home.totalPoints, summary.away.totalPoints],
                      ['Passes', summary.home.passes, summary.away.passes],
                      ['Turnovers (Lost)', summary.home.turnovers, summary.away.turnovers],
                      ['Kickouts Taken', summary.home.kickoutsTaken, summary.away.kickoutsTaken],
                      ['Kickouts Won', summary.home.kickoutsWon, summary.away.kickoutsWon],
                      ['Carries', summary.home.carries, summary.away.carries],
                      ['Take Ons Attempted', summary.home.takeOnsAttempted, summary.away.takeOnsAttempted],
                      ['Take Ons Completed', summary.home.takeOnsCompleted, summary.away.takeOnsCompleted],
                      ['Defensive Actions', summary.home.defensiveActions, summary.away.defensiveActions],
                      ['Possessions', summary.home.possessions, summary.away.possessions],
                      ['Attacks (Entered Opp 45)', summary.home.attacks, summary.away.attacks],
                    ].map(([label, h, a]) => (
                      <TableRow key={label}>
                        <TableCell>{h}</TableCell>
                        <TableCell className="font-medium text-center">{label}</TableCell>
                        <TableCell>{a}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
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

          <TabsContent value="data">
            <DataTab
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

function DataTab({ stats, homeTeam, awayTeam, homePlayers, awayPlayers }) {
  const [team, setTeam] = useState('both');
  const [actions, setActions] = useState([]); // [] means all
  const [halves, setHalves] = useState([]); // [] means all
  const [counters, setCounters] = useState([]); // [] means any
  const [groupBy, setGroupBy] = useState('none'); // none|team|player|action|half|outcome

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

  const pivot = useMemo(() => {
    if (groupBy === 'none') return null;
    const rows = new Map();

    const getKey = (s, extra) => {
      if (groupBy === 'team') return s.team_side || 'unknown';
      if (groupBy === 'action') return s.stat_type || 'unknown';
      if (groupBy === 'half') return s.half || 'unknown';
      if (groupBy === 'outcome') return deriveOutcome(s, extra) || 'unknown';
      if (groupBy === 'player') {
        // Primary player only for now (fast + reliable).
        if (s.player_number) return `#${s.player_number}`;
        return 'None';
      }
      return 'unknown';
    };

    for (const s of filtered) {
      const extra = safeParseJSON(s.extra_data || '{}', {});
      const key = getKey(s, extra);
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
                  <TableRow key={r.key}>
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
              <div className="text-xs text-slate-500">{filtered.length} rows</div>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Half</TableHead>
                  <TableHead>Team</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Outcome</TableHead>
                  <TableHead>Player</TableHead>
                  <TableHead>Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.slice(0, 200).map((s) => {
                  const extra = safeParseJSON(s.extra_data || '{}', {});
                  return (
                    <TableRow key={s.id}>
                      <TableCell>{toTitleCase(s.half)}</TableCell>
                      <TableCell>{s.team_side === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home')}</TableCell>
                      <TableCell>{toTitleCase(s.stat_type)}</TableCell>
                      <TableCell>{toTitleCase(deriveOutcome(s, extra))}</TableCell>
                      <TableCell>{s.player_number ? `#${s.player_number}` : ''}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {Number.isFinite(Number(s.time_s)) ? formatMMSS(Number(s.time_s)) : '--:--'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {filtered.length > 200 && (
              <div className="text-xs text-slate-500 pt-2">Showing first 200 rows. Add a group-by to summarise.</div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
