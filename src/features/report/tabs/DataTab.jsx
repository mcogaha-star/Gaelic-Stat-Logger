const db = globalThis.__B44_DB__ || {
  entities: new Proxy({}, { get: () => ({ filter: async () => [], get: async () => null, create: async () => ({}), update: async () => ({}), delete: async () => ({}) }) }),
};

import React, { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
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
  inferPossessionStartSource,
} from '../shared';

function sortStatsForEditing(list, match, imputedTimeById) {
  const timeKey = (s) => {
    const play = Number(s?.play_id);
    if (Number.isFinite(play)) return { kind: 0, v: play };
    const mt = getMatchTimeS(s, match, imputedTimeById);
    if (Number.isFinite(mt)) return { kind: 1, v: mt };
    const t = Number(s?.time_s);
    if (Number.isFinite(t)) return { kind: 2, v: t };
    const ts = Date.parse(String(s?.timestamp || ''));
    if (Number.isFinite(ts)) return { kind: 3, v: ts };
    return { kind: 9, v: 0 };
  };

  return [...(Array.isArray(list) ? list : [])].sort((a, b) => {
    const ka = timeKey(a);
    const kb = timeKey(b);
    if (ka.kind !== kb.kind) return ka.kind - kb.kind;
    if (ka.v !== kb.v) return ka.v - kb.v;
    return String(a?.id || '').localeCompare(String(b?.id || ''));
  });
}

function getPossessionKey(stat) {
  const pid = Number(stat?.possession_id);
  const side = stat?.possession_team_side;
  return Number.isFinite(pid) && (side === 'home' || side === 'away') ? `${side}-${pid}` : 'unknown';
}

function getContiguousRange(ordered, index, mode) {
  if (!Array.isArray(ordered) || index < 0 || index >= ordered.length) return [];
  if (mode === 'row_only') return [index];
  const key = getPossessionKey(ordered[index]);
  if (mode === 'row_tail') {
    const indices = [];
    for (let i = index; i < ordered.length; i += 1) {
      if (i > index && getPossessionKey(ordered[i]) !== key) break;
      indices.push(i);
    }
    return indices;
  }
  if (mode === 'entire_possession') {
    let start = index;
    let end = index;
    while (start - 1 >= 0 && getPossessionKey(ordered[start - 1]) === key) start -= 1;
    while (end + 1 < ordered.length && getPossessionKey(ordered[end + 1]) === key) end += 1;
    return Array.from({ length: end - start + 1 }, (_, offset) => start + offset);
  }
  return [index];
}

function findAdjacentPossession(ordered, index, direction) {
  if (!Array.isArray(ordered) || index < 0 || index >= ordered.length) return null;
  const currentKey = getPossessionKey(ordered[index]);
  const step = direction === 'next' ? 1 : -1;
  for (let i = index + step; i >= 0 && i < ordered.length; i += step) {
    const key = getPossessionKey(ordered[i]);
    if (key !== currentKey) return ordered[i];
  }
  return null;
}

function formatTeamName(side, homeTeam, awayTeam) {
  if (side === 'away') return awayTeam?.name || 'Away';
  if (side === 'home') return homeTeam?.name || 'Home';
  return 'NA';
}

function summarizeRow(stat, match, imputedTimeById, homeTeam, awayTeam) {
  if (!stat) return 'NA';
  const mt = getMatchTimeS(stat, match, imputedTimeById);
  const timeLabel = Number.isFinite(mt) ? formatMatchClock(mt, match, stat.half) : 'NA';
  const playLabel = Number.isFinite(Number(stat?.play_id)) ? `Play ${Number(stat.play_id)}` : 'Play NA';
  return `${playLabel} - ${toTitleCase(stat?.stat_type)} - ${formatTeamName(stat?.team_side, homeTeam, awayTeam)} - ${timeLabel}`;
}

function resequenceOrderedStats(ordered) {
  return ordered.map((stat, index) => ({ ...stat, play_id: index + 1 }));
}

function DataTab({ matchId, match, stats, homeTeam, awayTeam, homePlayers, awayPlayers }) {
  const queryClient = useQueryClient();
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
  const [editOpen, setEditOpen] = useState(false);
  const [editStatId, setEditStatId] = useState(null);
  const [editScope, setEditScope] = useState('row_tail');
  const [targetPossessionId, setTargetPossessionId] = useState('');
  const [targetPossessionTeam, setTargetPossessionTeam] = useState('home');
  const [newPossessionTeam, setNewPossessionTeam] = useState('home');
  const [moveTargetId, setMoveTargetId] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [advancedPlayId, setAdvancedPlayId] = useState('');
  const [advancedPossessionId, setAdvancedPossessionId] = useState('');
  const [advancedPossessionTeam, setAdvancedPossessionTeam] = useState('home');
  const [rawEditOpen, setRawEditOpen] = useState(false);
  const [rawStatType, setRawStatType] = useState('');
  const [rawTeamSide, setRawTeamSide] = useState('home');
  const [rawHalf, setRawHalf] = useState('first');
  const [rawTimeS, setRawTimeS] = useState('');
  const [rawNormalizedTimeS, setRawNormalizedTimeS] = useState('');
  const [rawPlayerName, setRawPlayerName] = useState('');
  const [rawPlayerNumber, setRawPlayerNumber] = useState('');
  const [rawRecipientName, setRawRecipientName] = useState('');
  const [rawRecipientNumber, setRawRecipientNumber] = useState('');
  const [rawExtraJson, setRawExtraJson] = useState('{}');

  const VIDEO_PRE_ROLL_S = 7;

  const persistMutation = useMutation({
    mutationFn: async (updates) => {
      for (const update of updates) {
        await db.entities.StatEntry.update(update.id, update.data);
      }
      return updates.length;
    },
    onSuccess: async (count) => {
      await queryClient.invalidateQueries({ queryKey: ['stats', matchId] });
      await queryClient.refetchQueries({ queryKey: ['stats', matchId], type: 'active' });
      toast.success(count === 1 ? 'ID update saved' : `${count} rows updated`);
      setEditOpen(false);
    },
    onError: (error) => {
      toast.error(error?.message || 'Failed to update IDs');
    },
  });

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
  const orderedAllStats = useMemo(() => sortStatsForEditing(stats, match, imputedTimeById), [stats, match, imputedTimeById]);
  const maxPossessionId = useMemo(() => orderedAllStats.reduce((max, stat) => {
    const pid = Number(stat?.possession_id);
    return Number.isFinite(pid) ? Math.max(max, pid) : max;
  }, 0), [orderedAllStats]);

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

  const filteredSorted = useMemo(() => sortStatsForEditing(filtered, match, imputedTimeById), [filtered, match, imputedTimeById]);

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
    const previousByPossessionKey = new Map();
    const statsByPossessionKey = new Map();

    if (groupBy === 'possession') {
      for (let i = 0; i < filteredSorted.length; i += 1) {
        const stat = filteredSorted[i];
        const key = getPossessionKey(stat);
        if (key === 'unknown') continue;
        const arr = statsByPossessionKey.get(key) || [];
        arr.push(stat);
        statsByPossessionKey.set(key, arr);
        if (!previousByPossessionKey.has(key)) previousByPossessionKey.set(key, i > 0 ? filteredSorted[i - 1] : null);
      });
    }

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
            cur.start_source = inferPossessionStartSource(
              statsByPossessionKey.get(key) || [s],
              s?.possession_team_side,
              previousByPossessionKey.get(key) || [],
            );
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

  const editStat = useMemo(() => orderedAllStats.find((stat) => stat?.id === editStatId) || null, [orderedAllStats, editStatId]);
  const editIndex = useMemo(() => orderedAllStats.findIndex((stat) => stat?.id === editStatId), [orderedAllStats, editStatId]);
  const editPrev = editIndex > 0 ? orderedAllStats[editIndex - 1] : null;
  const editNext = editIndex >= 0 && editIndex + 1 < orderedAllStats.length ? orderedAllStats[editIndex + 1] : null;
  const editRangeIndices = useMemo(() => getContiguousRange(orderedAllStats, editIndex, editScope), [orderedAllStats, editIndex, editScope]);
  const editRangeStats = useMemo(() => editRangeIndices.map((index) => orderedAllStats[index]).filter(Boolean), [orderedAllStats, editRangeIndices]);
  const previousPossession = useMemo(() => findAdjacentPossession(orderedAllStats, editIndex, 'previous'), [orderedAllStats, editIndex]);
  const nextPossession = useMemo(() => findAdjacentPossession(orderedAllStats, editIndex, 'next'), [orderedAllStats, editIndex]);
  const moveTargetOptions = useMemo(() => orderedAllStats.filter((stat) => stat?.id !== editStatId), [orderedAllStats, editStatId]);

  const openEditDialogForStat = (stat) => {
    if (!stat?.id) return;
    const currentTeam = stat.possession_team_side === 'away' ? 'away' : 'home';
    setEditStatId(stat.id);
    setEditScope('row_tail');
    setTargetPossessionId(Number.isFinite(Number(stat?.possession_id)) ? String(Number(stat.possession_id)) : '');
    setTargetPossessionTeam(currentTeam);
    setNewPossessionTeam(currentTeam);
    setMoveTargetId('');
    setAdvancedOpen(false);
    setAdvancedPlayId(Number.isFinite(Number(stat?.play_id)) ? String(Number(stat.play_id)) : '');
    setAdvancedPossessionId(Number.isFinite(Number(stat?.possession_id)) ? String(Number(stat.possession_id)) : '');
    setAdvancedPossessionTeam(currentTeam);
    setRawEditOpen(false);
    setRawStatType(stat?.stat_type || '');
    setRawTeamSide(stat?.team_side === 'away' ? 'away' : 'home');
    setRawHalf(stat?.half || 'first');
    setRawTimeS(Number.isFinite(Number(stat?.time_s)) ? String(Number(stat.time_s)) : '');
    setRawNormalizedTimeS(Number.isFinite(Number(stat?.normalized_time_s)) ? String(Number(stat.normalized_time_s)) : '');
    setRawPlayerName(stat?.player_name || '');
    setRawPlayerNumber(stat?.player_number == null ? '' : String(stat.player_number));
    setRawRecipientName(stat?.recipient_name || '');
    setRawRecipientNumber(stat?.recipient_number == null ? '' : String(stat.recipient_number));
    setRawExtraJson(JSON.stringify(safeParseJSON(stat?.extra_data || '{}', {}), null, 2));
    setEditOpen(true);
  };

  const buildPossessionUpdates = (targetId, targetTeam) => editRangeStats.map((stat) => ({
    id: stat.id,
    data: {
      possession_id: targetId,
      possession_team_side: targetTeam,
    },
  }));

  const runPossessionAction = ({ label, targetId, targetTeam }) => {
    if (!editStat || !editRangeStats.length) return;
    if (!Number.isFinite(Number(targetId)) || Number(targetId) <= 0) {
      toast.error('Choose a valid possession number');
      return;
    }
    const updates = buildPossessionUpdates(Number(targetId), targetTeam);
    const summary = `${updates.length} row${updates.length === 1 ? '' : 's'} will move to Possession ${Number(targetId)} (${formatTeamName(targetTeam, homeTeam, awayTeam)}).`;
    if (!window.confirm(`${label}\n\n${summary}`)) return;
    persistMutation.mutate(updates);
  };

  const runPlayMove = ({ label, getNewOrder }) => {
    if (!editStat || editIndex < 0) return;
    const updatedOrdered = resequenceOrderedStats(getNewOrder([...orderedAllStats]));
    const updates = updatedOrdered
      .filter((stat, index) => Number(stat?.play_id) !== Number(orderedAllStats[index]?.play_id))
      .map((stat) => ({ id: stat.id, data: { play_id: stat.play_id } }));
    if (!updates.length) return;
    const first = Math.min(...updates.map((row) => Number(row.data.play_id)));
    const last = Math.max(...updates.map((row) => Number(row.data.play_id)));
    const summary = `${updates.length} row${updates.length === 1 ? '' : 's'} will be resequenced across plays ${first}-${last}.`;
    if (!window.confirm(`${label}\n\n${summary}`)) return;
    persistMutation.mutate(updates);
  };

  const applyAdvanced = () => {
    if (!editStat) return;
    const nextPossessionId = Number(advancedPossessionId);
    const nextPlayId = Number(advancedPlayId);
    if (!Number.isFinite(nextPossessionId) || nextPossessionId <= 0) {
      toast.error('Enter a valid possession number');
      return;
    }
    if (!Number.isFinite(nextPlayId) || nextPlayId <= 0) {
      toast.error('Enter a valid play number');
      return;
    }

    const remaining = orderedAllStats.filter((stat) => stat.id !== editStat.id);
    const clampedIndex = Math.max(0, Math.min(remaining.length, Math.round(nextPlayId) - 1));
    const inserted = [...remaining.slice(0, clampedIndex), editStat, ...remaining.slice(clampedIndex)];
    const resequenced = resequenceOrderedStats(inserted);
    const playUpdates = resequenced
      .filter((stat, index) => Number(stat?.play_id) !== Number(inserted[index]?.play_id))
      .map((stat) => ({ id: stat.id, data: { play_id: stat.play_id } }));

    const possessionUpdates = editRangeStats.map((stat) => ({
      id: stat.id,
      data: {
        possession_id: nextPossessionId,
        possession_team_side: advancedPossessionTeam,
      },
    }));

    const merged = new Map();
    for (const row of [...playUpdates, ...possessionUpdates]) {
      const current = merged.get(row.id) || { id: row.id, data: {} };
      current.data = { ...current.data, ...row.data };
      merged.set(row.id, current);
    }
    const updates = Array.from(merged.values());
    const summary = `${updates.length} row${updates.length === 1 ? '' : 's'} will be updated. Possession rows will move to Possession ${nextPossessionId} (${formatTeamName(advancedPossessionTeam, homeTeam, awayTeam)}), and play order will be resequenced.`;
    if (!window.confirm(`Apply advanced raw ID changes?\n\n${summary}`)) return;
    persistMutation.mutate(updates);
  };

  const applyRawStatChanges = () => {
    if (!editStat) return;
    let parsedExtra;
    try {
      parsedExtra = JSON.parse(String(rawExtraJson || '{}'));
      if (!parsedExtra || typeof parsedExtra !== 'object') throw new Error('Extra data must be an object');
    } catch {
      toast.error('Extra JSON is invalid');
      return;
    }

    const nextTime = rawTimeS === '' ? null : Number(rawTimeS);
    const nextNormTime = rawNormalizedTimeS === '' ? null : Number(rawNormalizedTimeS);
    const nextPlayerNumber = rawPlayerNumber === '' ? null : Number(rawPlayerNumber);
    const nextRecipientNumber = rawRecipientNumber === '' ? null : Number(rawRecipientNumber);
    if (rawTimeS !== '' && !Number.isFinite(nextTime)) return toast.error('Time (s) must be numeric');
    if (rawNormalizedTimeS !== '' && !Number.isFinite(nextNormTime)) return toast.error('Match Time (s) must be numeric');
    if (rawPlayerNumber !== '' && !Number.isFinite(nextPlayerNumber)) return toast.error('Player # must be numeric');
    if (rawRecipientNumber !== '' && !Number.isFinite(nextRecipientNumber)) return toast.error('Recipient # must be numeric');

    const update = {
      id: editStat.id,
      data: {
        stat_type: String(rawStatType || editStat.stat_type || ''),
        team_side: rawTeamSide,
        half: rawHalf,
        time_s: nextTime,
        normalized_time_s: nextNormTime,
        player_name: rawPlayerName || null,
        player_number: nextPlayerNumber,
        recipient_name: rawRecipientName || null,
        recipient_number: nextRecipientNumber,
        extra_data: JSON.stringify(parsedExtra),
      },
    };
    if (!window.confirm('Apply raw stat field changes to this row?')) return;
    persistMutation.mutate([update]);
  };

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
                  <Button type="button" variant="outline" size="sm" className="h-8 px-3 text-xs" onClick={() => openVideoAt(t)} title="Open the video popout and jump to this timestamp">
                    Open Video @ {formatMMSS(Math.max(0, t - VIDEO_PRE_ROLL_S))}
                  </Button>
                );
              })()}
            </div>
          </DialogHeader>
          <div className="pt-2">
            <PitchViz stats={vizStats} homeColor={homeTeam?.color} awayColor={awayTeam?.color} colorBy="team" showColorControls={false} />
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-4xl p-4 max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base">Edit Play / Possession IDs</DialogTitle>
          </DialogHeader>
          {editStat ? (
            <div className="space-y-4 text-sm">
              <div className="grid md:grid-cols-2 gap-4">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
                  <div className="font-semibold text-slate-900">Current Row</div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div><span className="text-slate-500">Play:</span> <span className="font-mono">{Number.isFinite(Number(editStat.play_id)) ? Number(editStat.play_id) : 'NA'}</span></div>
                    <div><span className="text-slate-500">Possession:</span> <span className="font-mono">{Number.isFinite(Number(editStat.possession_id)) ? Number(editStat.possession_id) : 'NA'}</span></div>
                    <div><span className="text-slate-500">Possession Team:</span> {formatTeamName(editStat.possession_team_side, homeTeam, awayTeam)}</div>
                    <div><span className="text-slate-500">Grouping:</span> <span className="font-mono">{getPossessionKey(editStat)}</span></div>
                  </div>
                  <div className="text-xs text-slate-600">{summarizeRow(editStat, match, imputedTimeById, homeTeam, awayTeam)}</div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-2">
                  <div className="font-semibold text-slate-900">Context</div>
                  <div className="text-xs"><span className="text-slate-500">Previous:</span> {summarizeRow(editPrev, match, imputedTimeById, homeTeam, awayTeam)}</div>
                  <div className="text-xs"><span className="text-slate-500">Next:</span> {summarizeRow(editNext, match, imputedTimeById, homeTeam, awayTeam)}</div>
                  <div className="text-xs"><span className="text-slate-500">Scope:</span> {editRangeStats.length} row{editRangeStats.length === 1 ? '' : 's'} selected</div>
                </div>
              </div>
              <div className="grid md:grid-cols-4 gap-3 items-end">
                <div className="space-y-1">
                  <Label className="text-xs text-slate-600">Scope</Label>
                  <Select value={editScope} onValueChange={setEditScope}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="row_only">This row only</SelectItem>
                      <SelectItem value="row_tail">This row + following rows</SelectItem>
                      <SelectItem value="entire_possession">Entire current possession</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="md:col-span-3 text-xs text-slate-500 rounded-md border border-dashed border-slate-200 p-2">
                  Row + following rows stops at the next possession break. Play reordering applies to the selected row and then resequences play IDs safely.
                </div>
              </div>

              <div className="grid lg:grid-cols-2 gap-4">
                <div className="rounded-lg border border-slate-200 p-3 space-y-3">
                  <div className="font-semibold text-slate-900">Guided Possession Tools</div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button type="button" variant="outline" size="sm" disabled={!previousPossession || persistMutation.isPending} onClick={() => previousPossession && runPossessionAction({ label: 'Move to previous possession', targetId: Number(previousPossession.possession_id), targetTeam: previousPossession.possession_team_side })}>Move to Previous Possession</Button>
                    <Button type="button" variant="outline" size="sm" disabled={!nextPossession || persistMutation.isPending} onClick={() => nextPossession && runPossessionAction({ label: 'Move to next possession', targetId: Number(nextPossession.possession_id), targetTeam: nextPossession.possession_team_side })}>Move to Next Possession</Button>
                  </div>
                  <div className="grid grid-cols-3 gap-2 items-end">
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-600">Possession #</Label>
                      <Input className="h-8 text-xs" inputMode="numeric" value={targetPossessionId} onChange={(e) => setTargetPossessionId(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-600">Team</Label>
                      <Select value={targetPossessionTeam} onValueChange={setTargetPossessionTeam}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="home">{homeTeam?.name || 'Home'}</SelectItem>
                          <SelectItem value="away">{awayTeam?.name || 'Away'}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Button type="button" size="sm" disabled={persistMutation.isPending} onClick={() => runPossessionAction({ label: 'Move to chosen possession', targetId: targetPossessionId, targetTeam: targetPossessionTeam })}>Move to Chosen Poss.</Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 items-end">
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-600">Change possession team</Label>
                      <Select value={newPossessionTeam} onValueChange={setNewPossessionTeam}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="home">{homeTeam?.name || 'Home'}</SelectItem>
                          <SelectItem value="away">{awayTeam?.name || 'Away'}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <Button type="button" variant="outline" size="sm" disabled={persistMutation.isPending} onClick={() => runPossessionAction({ label: 'Change possession team', targetId: Number(editStat.possession_id), targetTeam: newPossessionTeam })}>Change Possession Team</Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2 items-end">
                    <div className="text-xs text-slate-500">Starts a new possession at this row using the selected team.</div>
                    <Button type="button" variant="outline" size="sm" disabled={persistMutation.isPending} onClick={() => runPossessionAction({ label: 'Start new possession here', targetId: maxPossessionId + 1, targetTeam: newPossessionTeam })}>Start New Possession Here</Button>
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 p-3 space-y-3">
                  <div className="font-semibold text-slate-900">Guided Play Order Tools</div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button type="button" variant="outline" size="sm" disabled={editIndex <= 0 || persistMutation.isPending} onClick={() => runPlayMove({ label: 'Move earlier', getNewOrder: (ordered) => { const next = [...ordered]; const [row] = next.splice(editIndex, 1); next.splice(Math.max(0, editIndex - 1), 0, row); return next; } })}>Move Earlier</Button>
                    <Button type="button" variant="outline" size="sm" disabled={editIndex < 0 || editIndex >= orderedAllStats.length - 1 || persistMutation.isPending} onClick={() => runPlayMove({ label: 'Move later', getNewOrder: (ordered) => { const next = [...ordered]; const [row] = next.splice(editIndex, 1); next.splice(Math.min(next.length, editIndex + 1), 0, row); return next; } })}>Move Later</Button>
                  </div>
                  <div className="grid grid-cols-3 gap-2 items-end">
                    <div className="col-span-2 space-y-1">
                      <Label className="text-xs text-slate-600">Target row</Label>
                      <Select value={moveTargetId} onValueChange={setMoveTargetId}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Choose a row" /></SelectTrigger>
                        <SelectContent>
                          {moveTargetOptions.map((stat) => (
                            <SelectItem key={stat.id} value={stat.id}>{summarizeRow(stat, match, imputedTimeById, homeTeam, awayTeam)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="text-xs text-slate-500">Selected row only</div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button type="button" variant="outline" size="sm" disabled={!moveTargetId || persistMutation.isPending} onClick={() => { runPlayMove({ label: 'Move before chosen row', getNewOrder: (ordered) => { const currentIndex = ordered.findIndex((stat) => stat.id === editStat.id); const next = [...ordered]; const [row] = next.splice(currentIndex, 1); const insertAt = next.findIndex((stat) => stat.id === moveTargetId); next.splice(Math.max(0, insertAt), 0, row); return next; } }); }}>Move Before Chosen Row</Button>
                    <Button type="button" variant="outline" size="sm" disabled={!moveTargetId || persistMutation.isPending} onClick={() => { runPlayMove({ label: 'Move after chosen row', getNewOrder: (ordered) => { const currentIndex = ordered.findIndex((stat) => stat.id === editStat.id); const next = [...ordered]; const [row] = next.splice(currentIndex, 1); const insertAt = next.findIndex((stat) => stat.id === moveTargetId); next.splice(insertAt + 1, 0, row); return next; } }); }}>Move After Chosen Row</Button>
                  </div>
                </div>
              </div>

              <details className="rounded-lg border border-amber-200 bg-amber-50/60 p-3" open={advancedOpen} onToggle={(e) => setAdvancedOpen(e.currentTarget.open)}>
                <summary className="cursor-pointer font-semibold text-amber-900">Advanced Raw IDs</summary>
                <div className="space-y-3 pt-3">
                  <div className="text-xs text-amber-800">Raw changes can affect possession analysis and ordering. Play ID changes are normalized safely after save.</div>
                  <div className="grid md:grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-600">Play ID</Label>
                      <Input className="h-8 text-xs" inputMode="numeric" value={advancedPlayId} onChange={(e) => setAdvancedPlayId(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-600">Possession ID</Label>
                      <Input className="h-8 text-xs" inputMode="numeric" value={advancedPossessionId} onChange={(e) => setAdvancedPossessionId(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-600">Possession Team</Label>
                      <Select value={advancedPossessionTeam} onValueChange={setAdvancedPossessionTeam}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="home">{homeTeam?.name || 'Home'}</SelectItem>
                          <SelectItem value="away">{awayTeam?.name || 'Away'}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <Button type="button" size="sm" variant="outline" disabled={persistMutation.isPending} onClick={applyAdvanced}>Apply Advanced Changes</Button>
                  </div>
                </div>
              </details>

              <details className="rounded-lg border border-slate-200 bg-slate-50/60 p-3" open={rawEditOpen} onToggle={(e) => setRawEditOpen(e.currentTarget.open)}>
                <summary className="cursor-pointer font-semibold text-slate-900">Raw Stat Fields</summary>
                <div className="space-y-3 pt-3">
                  <div className="text-xs text-slate-600">Edit the actual row fields without changing coordinates or possession structure.</div>
                  <div className="grid md:grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-600">Stat Type</Label>
                      <Input className="h-8 text-xs" value={rawStatType} onChange={(e) => setRawStatType(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-600">Team</Label>
                      <Select value={rawTeamSide} onValueChange={setRawTeamSide}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="home">{homeTeam?.name || 'Home'}</SelectItem>
                          <SelectItem value="away">{awayTeam?.name || 'Away'}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-600">Half</Label>
                      <Select value={rawHalf} onValueChange={setRawHalf}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="first">First</SelectItem>
                          <SelectItem value="second">Second</SelectItem>
                          <SelectItem value="et_first">ET First</SelectItem>
                          <SelectItem value="et_second">ET Second</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid md:grid-cols-4 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-600">Time (s)</Label>
                      <Input className="h-8 text-xs" inputMode="numeric" value={rawTimeS} onChange={(e) => setRawTimeS(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-600">Match Time (s)</Label>
                      <Input className="h-8 text-xs" inputMode="numeric" value={rawNormalizedTimeS} onChange={(e) => setRawNormalizedTimeS(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-600">Player #</Label>
                      <Input className="h-8 text-xs" inputMode="numeric" value={rawPlayerNumber} onChange={(e) => setRawPlayerNumber(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-600">Recipient #</Label>
                      <Input className="h-8 text-xs" inputMode="numeric" value={rawRecipientNumber} onChange={(e) => setRawRecipientNumber(e.target.value)} />
                    </div>
                  </div>
                  <div className="grid md:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-600">Player Name</Label>
                      <Input className="h-8 text-xs" value={rawPlayerName} onChange={(e) => setRawPlayerName(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-slate-600">Recipient Name</Label>
                      <Input className="h-8 text-xs" value={rawRecipientName} onChange={(e) => setRawRecipientName(e.target.value)} />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-slate-600">Extra JSON</Label>
                    <textarea
                      className="min-h-[160px] w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-mono"
                      value={rawExtraJson}
                      onChange={(e) => setRawExtraJson(e.target.value)}
                    />
                  </div>
                  <div className="flex justify-end">
                    <Button type="button" size="sm" variant="outline" disabled={persistMutation.isPending} onClick={applyRawStatChanges}>Apply Raw Stat Changes</Button>
                  </div>
                </div>
              </details>
            </div>
          ) : null}
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
                      <TableHead className="text-right">Edit</TableHead>
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
                  <TableRow key={r.key} className="cursor-pointer" onClick={() => {
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
                  }}>
                    {groupBy === 'possession' ? (() => {
                      const [side, num] = String(r.key || '').split('-');
                      const teamName = side === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home');
                      const start = Number.isFinite(Number(r.start_time_norm_s)) ? formatMMSS(Number(r.start_time_norm_s)) : 'NA';
                      const end = Number.isFinite(Number(r.end_time_norm_s)) ? formatMMSS(Number(r.end_time_norm_s)) : 'NA';
                      const dur = (Number.isFinite(Number(r.start_time_norm_s)) && Number.isFinite(Number(r.end_time_norm_s))) ? `${Math.max(0, Number(r.end_time_norm_s) - Number(r.start_time_norm_s)).toFixed(1)}s` : 'NA';
                      const groupStats = filtered.filter((s) => keyForGroup(s) === r.key);
                      const firstStat = sortStatsForEditing(groupStats, match, imputedTimeById)[0] || null;
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
                          <TableCell className="text-right">
                            <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={!firstStat} onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (firstStat) openEditDialogForStat(firstStat); }}>Edit IDs</Button>
                          </TableCell>
                        </>
                      );
                    })() : (
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
                  <TableHead className="w-[180px]"> </TableHead>
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
                          <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" aria-label={isOpen ? 'Collapse row' : 'Expand row'} onClick={(e) => { e.preventDefault(); e.stopPropagation(); setExpandedRowId((cur) => (cur === s.id ? null : s.id)); }}>
                            <ChevronDown className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                          </Button>
                        </TableCell>
                        <TableCell>{toTitleCase(s.half)}</TableCell>
                        <TableCell>{s.team_side === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home')}</TableCell>
                        <TableCell>{toTitleCase(s.stat_type)}</TableCell>
                        <TableCell>{toTitleCase(deriveOutcome(s, extra))}</TableCell>
                        <TableCell>{s.player_number ? `#${s.player_number}` : ''}</TableCell>
                        <TableCell className="font-mono text-xs">{(() => { const mt = getMatchTimeS(s, match, imputedTimeById); return Number.isFinite(mt) ? formatMatchClock(mt, match, s.half) : '--:--'; })()}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2 flex-wrap">
                            <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={!hasTime} title={hasTime ? `Open video at ${formatMMSS(Math.max(0, t - VIDEO_PRE_ROLL_S))}` : 'No video time recorded for this row'} onClick={() => hasTime && openVideoAt(t)}>Open Video</Button>
                            <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => { setVizStats([s]); setVizTitle(`${toTitleCase(s.stat_type)} - ${toTitleCase(s.half)} - ${s.team_side === 'away' ? (awayTeam?.name || 'Away') : (homeTeam?.name || 'Home')}`); setVizOpen(true); }}>Visualise</Button>
                          </div>
                        </TableCell>
                      </TableRow>

                      {isOpen && (
                        <TableRow className="bg-slate-50/60">
                          <TableCell colSpan={8} className="p-3">
                            <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-3">
                              <div className="flex items-center justify-between gap-2">
                                <div className="text-xs font-semibold text-slate-900">Details</div>
                                <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => openEditDialogForStat(s)}>Edit IDs</Button>
                              </div>
                              <div className="max-h-56 overflow-auto rounded-md border border-slate-200">
                                <Table>
                                  <TableBody>
                                    {(() => {
                                      const baseItems = [
                                        { label: 'Play', value: Number.isFinite(Number(s.play_id)) ? String(Number(s.play_id)) : 'NA' },
                                        { label: 'Possession', value: Number.isFinite(Number(s.possession_id)) ? String(Number(s.possession_id)) : 'NA' },
                                        { label: 'Possession Team', value: s.possession_team_side === 'away' ? (awayTeam?.name || 'Away') : (s.possession_team_side === 'home' ? (homeTeam?.name || 'Home') : 'NA') },
                                        { label: 'Counter Attack', value: s.counter_attack ? 'Yes' : 'No' },
                                        { label: 'Video', value: Number.isFinite(Number(s.time_s)) ? formatMMSS(Number(s.time_s)) : 'NA' },
                                        { label: 'Time', value: (() => { const rowTime = getMatchTimeS(s, match, imputedTimeById); return Number.isFinite(rowTime) ? formatMatchClock(rowTime, match, s.half) : 'NA'; })() },
                                        { label: 'X, Y', value: Number.isFinite(Number(s.x_position)) && Number.isFinite(Number(s.y_position)) ? `${Number(s.x_position).toFixed(2)}, ${Number(s.y_position).toFixed(2)}` : 'NA' },
                                        { label: 'End X, Y', value: Number.isFinite(Number(s.end_x_position)) && Number.isFinite(Number(s.end_y_position)) ? `${Number(s.end_x_position).toFixed(2)}, ${Number(s.end_y_position).toFixed(2)}` : 'NA' },
                                        { label: 'Raw X, Y', value: Number.isFinite(Number(s.raw_x_position)) && Number.isFinite(Number(s.raw_y_position)) ? `${Number(s.raw_x_position).toFixed(2)}, ${Number(s.raw_y_position).toFixed(2)}` : 'NA' },
                                        { label: 'Raw End', value: Number.isFinite(Number(s.raw_end_x_position)) && Number.isFinite(Number(s.raw_end_y_position)) ? `${Number(s.raw_end_x_position).toFixed(2)}, ${Number(s.raw_end_y_position).toFixed(2)}` : 'NA' },
                                      ];
                                      const extraItems = flattenExtra(extra)
                                        .filter((r) => r.key !== 'counter_attack')
                                        .filter((r) => !/(^|\\b)pitch([._-]?(w|h|width|height|length))\\b/i.test(String(r.key || '')))
                                        .map((r) => ({ label: presentablePathLabel(r.key), value: formatExtraValue(r.value) }));
                                      const items = [...baseItems, ...extraItems].filter((it, idx, arr) => it.label && arr.findIndex((other) => other.label === it.label) === idx);
                                      const pairs = [];
                                      for (let i = 0; i < items.length; i += 2) pairs.push([items[i], items[i + 1] || null]);
                                      return pairs.map(([a, b], idx) => (
                                        <TableRow key={idx}>
                                          <TableCell className="py-1 text-xs text-slate-500 whitespace-nowrap">{a.label}</TableCell>
                                          <TableCell className="py-1 text-xs font-mono tabular-nums">{a.value}</TableCell>
                                          <TableCell className="py-1 text-xs text-slate-500 whitespace-nowrap">{b ? b.label : ''}</TableCell>
                                          <TableCell className="py-1 text-xs font-mono tabular-nums">{b ? b.value : ''}</TableCell>
                                        </TableRow>
                                      ));
                                    })()}
                                  </TableBody>
                                </Table>
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
            {filteredSorted.length > 200 && <div className="text-xs text-slate-500 pt-2">Showing first 200 rows. Add a group-by to summarise.</div>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default DataTab;
