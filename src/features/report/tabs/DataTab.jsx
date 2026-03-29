import React, { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { createPageUrl } from '@/utils';
import { getAttackEntryChannelForPossession, getMatchTimeS, isAttackPossession } from '@/lib/reportAnalytics';
import {
  safeParseJSON,
  toTitleCase,
  formatMMSS,
  formatMatchClock,
  formatExtraValue,
  flattenExtra,
  presentablePathLabel,
  collectPlayerIds,
  PitchViz,
  MultiSelect,
  computeImputedNormalizedTimes,
  deriveOutcome,
  derivePossessionOutcome,
} from '../shared';

function DataTab({ matchId, match, stats, homeTeam, awayTeam, homePlayers, awayPlayers }) {
  const [team, setTeam] = useState('both');
  const [actions, setActions] = useState([]);
  const [halves, setHalves] = useState([]);
  const [playerIds, setPlayerIds] = useState([]);
  const [timeMin, setTimeMin] = useState('');
  const [timeMax, setTimeMax] = useState('');
  const [groupBy, setGroupBy] = useState('none');
  const [vizOpen, setVizOpen] = useState(false);
  const [vizTitle, setVizTitle] = useState('');
  const [vizStats, setVizStats] = useState([]);
  const [expandedRowId, setExpandedRowId] = useState(null);

  const VIDEO_PRE_ROLL_S = 7;

  const openVideoAt = (timeS) => {
    const t = Number(timeS);
    if (!matchId || !Number.isFinite(t)) return;
    const seekTo = Math.max(0, Math.floor(t - VIDEO_PRE_ROLL_S));
    const url = `${window.location.origin}${window.location.pathname}#${createPageUrl(`Video?matchId=${matchId}`)}`;
    window.open(url, 'gstl_video', 'popup=yes,width=1100,height=650');
    try {
      const ch = new BroadcastChannel('gstl_video');
      const msg = { matchId, type: 'SEEK_TO', time_s: seekTo };
      ch.postMessage(msg);
      setTimeout(() => ch.postMessage(msg), 350);
      setTimeout(() => {
        ch.postMessage(msg);
        ch.close();
      }, 900);
    } catch {
      // ignore
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
        const t = getMatchTimeS(s, match, imputedTimeById);
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
                                {
                                  label: 'Time',
                                  value: (() => {
                                    const rowTime = getMatchTimeS(s, match, imputedTimeById);
                                    return Number.isFinite(rowTime) ? formatMatchClock(rowTime, match, s.half) : 'NA';
                                  })(),
                                },
                                { label: 'X, Y', value: Number.isFinite(Number(s.x_position)) && Number.isFinite(Number(s.y_position)) ? `${Number(s.x_position).toFixed(2)}, ${Number(s.y_position).toFixed(2)}` : 'NA' },
                                { label: 'End X, Y', value: Number.isFinite(Number(s.end_x_position)) && Number.isFinite(Number(s.end_y_position)) ? `${Number(s.end_x_position).toFixed(2)}, ${Number(s.end_y_position).toFixed(2)}` : 'NA' },
                                { label: 'Raw X, Y', value: Number.isFinite(Number(s.raw_x_position)) && Number.isFinite(Number(s.raw_y_position)) ? `${Number(s.raw_x_position).toFixed(2)}, ${Number(s.raw_y_position).toFixed(2)}` : 'NA' },
                                { label: 'Raw End', value: Number.isFinite(Number(s.raw_end_x_position)) && Number.isFinite(Number(s.raw_end_y_position)) ? `${Number(s.raw_end_x_position).toFixed(2)}, ${Number(s.raw_end_y_position).toFixed(2)}` : 'NA' },
                              ];

                              const extraItems = flattenExtra(extra)
                                .filter((r) => r.key !== 'counter_attack')
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
                              for (let i = 0; i < items.length; i += 2) pairs.push([items[i], items[i + 1] || null]);

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

export default DataTab;
